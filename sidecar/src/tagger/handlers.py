"""Execution d'une commande validee : du modele du protocole au metier, puis a
l'evenement.

Separe de `__main__.py` pour que le point d'entree reste le moteur et le routage,
le contrat etant appele a grandir bien au-dela des commandes actuelles.
"""

import asyncio
import logging
from collections import Counter
from contextlib import AsyncExitStack
from datetime import UTC, datetime
from typing import TYPE_CHECKING, NamedTuple, assert_never, override

from tagger import __version__, arbitration, tagging, url_recovery, writing
from tagger.api_key import ApiKeyMissingError, read_api_key, store_api_key
from tagger.arbitration import Arbitration
from tagger.cache import ArtworkFetcher, DiskCache, ResponseCache, resolve_host
from tagger.extraction import extract
from tagger.files import after_tags, project_tags, shown_key, tag_system_of
from tagger.matching import DEFAULT_THRESHOLDS, MatchingThresholds, credited_artists, full_title
from tagger.paths import app_data_dir
from tagger.playlists import list_playlists, read_playlist
from tagger.protocol import (
    ArbitrationRequired,
    ArbitrationUpdated,
    CandidatePayload,
    DuplicatePayload,
    ExtractionFinished,
    ExtractPlaylist,
    FailurePayload,
    ListPlaylists,
    Phase,
    PlaylistEntry,
    PlaylistsListed,
    Progress,
    Rollback,
    RollbackFailurePayload,
    RollbackFinished,
    RollbackRun,
    RollbackTarget,
    RunFinished,
    RunPhase,
    RunStarted,
    SetApiKey,
    StartTagging,
    TagsBeforePayload,
    TagValuePayload,
    TrackEntry,
    TrackNames,
    TrackResolved,
    TrackScores,
    Version,
)
from tagger.reports import ReportContext, write_extraction_report
from tagger.rollback import find_rollback_target, roll_back
from tagger.scraper_client import TechnoScraperClient
from tagger.sources import RunSources
from tagger.tag_dump import TagDumpError, dump_dir
from tagger.tagging import open_run, resolve_run
from tagger.url_recovery import UrlRecovery
from tagger.writing import RunWriter

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping
    from pathlib import Path

    import httpx2

    from tagger.arbitration import ArbitrationEvent
    from tagger.cache import HostResolver
    from tagger.files import ShownTags, TagField, TagSystem
    from tagger.matching import ScoredCandidate
    from tagger.protocol import Event
    from tagger.scraper_client import TrackCandidate
    from tagger.tagging import LiveRun, TaggingRun, TrackRecord
    from tagger.url_recovery import UrlRecoveryEvent
    from tagger.writing import WriteEvent

logger = logging.getLogger(__name__)


def handle_get_version() -> Version:
    """Version nue et presence d'une cle : jamais la cle elle-meme (ADR-012)."""
    return Version(
        event="version",
        version=__version__,
        api_key_configured=read_api_key() is not None,
    )


def handle_set_api_key(command: SetApiKey) -> Version:
    """Range la cle puis rend la version : l'interface y lit que la cle existe."""
    store_api_key(command.api_key)
    return handle_get_version()


def handle_list_playlists(command: ListPlaylists) -> PlaylistsListed:
    """Liste les playlists d'un dump VLC pour alimenter le selecteur."""
    listing = list_playlists(command.playlist_path)

    return PlaylistsListed(
        event="playlists_listed",
        playlist_format=listing.playlist_format,
        playlists=tuple(
            PlaylistEntry.model_validate(summary, from_attributes=True)
            for summary in listing.playlists
        ),
    )


def handle_extract_playlist(
    command: ExtractPlaylist, on_progress: Callable[[Progress], None]
) -> ExtractionFinished:
    """Lit la playlist, extrait ses morceaux, ecrit le rapport.

    Le module d'extraction ignore le protocole : il recoit un rappel `(traites,
    total)` que ce handler traduit en evenement.
    """
    file_names = read_playlist(command.playlist_path, command.playlist_name)

    def report_progress(processed: int, total: int) -> None:
        on_progress(
            Progress(event="progress", phase=Phase.EXTRACTION, processed=processed, total=total)
        )

    result = extract(
        file_names,
        command.source_folder,
        command.destination_folder,
        mode=command.mode,
        on_progress=report_progress,
    )

    paths = write_extraction_report(
        result,
        ReportContext(
            source_folder=command.source_folder,
            destination_folder=command.destination_folder,
            playlist_path=command.playlist_path,
            playlist_name=command.playlist_name,
            mode=command.mode,
            generated_at=datetime.now(UTC),
        ),
    )
    # Sans compteurs : aucune cle du jeu logfmt fixe ne les porte, et le rapport ecrit
    # juste avant les detaille deja.
    logger.info("extraction finished")

    return ExtractionFinished(
        event="extraction_finished",
        extracted=result.extracted,
        already_present=result.already_present,
        missing=result.missing,
        # Les modeles de frontiere reprennent champ pour champ les dataclasses du
        # metier : `from_attributes` les recopie, `discarded` compris, plutot qu'une
        # enumeration a tenir a jour ici et dans le rapport (cf. `reports.py`).
        duplicates=tuple(
            DuplicatePayload.model_validate(duplicate, from_attributes=True)
            for duplicate in result.duplicates
        ),
        failures=tuple(
            FailurePayload.model_validate(failure, from_attributes=True)
            for failure in result.failures
        ),
        report_path=paths.json_path,
    )


class TaggingTransports(NamedTuple):
    """Transports du client et du CDN, et resolveur d'hote des pochettes.

    `None` et le resolveur reel en production : les tests remplacent les trois d'un
    coup, sans quoi l'hote d'un CDN simule partirait quand meme au DNS.
    """

    api: httpx2.AsyncBaseTransport | None
    cdn: httpx2.AsyncBaseTransport | None
    resolve: HostResolver


def tagging_transports() -> TaggingTransports:
    """Transports de production ; remplaces au complet par les tests."""
    return TaggingTransports(None, None, resolve_host)


class CurrentRun:
    """Run arbitrable et rattrapable jusqu'au suivant : `cancel_run` arrete la phase reseau,
    pas les gestes."""

    def __init__(
        self,
        stack: AsyncExitStack,
        live: LiveRun,
        sources: RunSources,
        arbitration: Arbitration,
        url_recovery: UrlRecovery,
    ) -> None:
        self.live = live
        self.sources = sources
        self.arbitration = arbitration
        self.url_recovery = url_recovery
        # Pose a la confirmation : sa presence fige le run, plus aucune decision n'y entre.
        self.writer: RunWriter | None = None
        self._stack = stack
        self._gestures: set[asyncio.Task[None]] = set()

    @override
    def __repr__(self) -> str:
        return f"CurrentRun(run_id={self.live.run_id!r}, gestures={len(self._gestures)})"

    @property
    def committed(self) -> bool:
        return self.writer is not None

    @property
    def busy(self) -> bool:
        """Un geste d'arbitrage ou de rattrapage est en vol."""
        return any(not gesture.done() for gesture in self._gestures)

    def track(self, gesture: asyncio.Task[None]) -> None:
        """Reference forte sur un geste en vol, relachee a sa fin."""
        self._gestures.add(gesture)
        gesture.add_done_callback(self._gestures.discard)

    async def close(self) -> None:
        """`finally` : une annulation du `gather` en attente ne doit pas empecher la fermeture."""
        try:
            for gesture in self._gestures:
                gesture.cancel()
            await asyncio.gather(*self._gestures, return_exceptions=True)
        finally:
            await self._stack.aclose()


async def open_tagging(command: StartTagging, emit: Callable[[Event], None]) -> CurrentRun:
    """Ouvre caches et client, branche l'arbitrage ; client et fetcher survivent dans la pile
    rendue au `CurrentRun`, et une ouverture ratee referme ce qu'elle a deja ouvert."""
    api_key = await asyncio.to_thread(read_api_key)
    if api_key is None:
        raise ApiKeyMissingError

    cache_root = app_data_dir() / "cache"
    # Deux scans independants, superposes plutot qu'enchaines. `TaskGroup` et non
    # `gather` : si l'un leve, il annule l'autre au lieu de le laisser courir seul.
    async with asyncio.TaskGroup() as opening:
        responses_disk = opening.create_task(
            asyncio.to_thread(DiskCache, cache_root / "responses"), name="cache:responses"
        )
        artworks_disk = opening.create_task(
            asyncio.to_thread(DiskCache, cache_root / "artworks"), name="cache:artworks"
        )
    transports = tagging_transports()

    async with AsyncExitStack() as stack:
        client = await stack.enter_async_context(
            TechnoScraperClient(
                api_key, transport=transports.api, cache=ResponseCache(responses_disk.result())
            )
        )
        artworks = await stack.enter_async_context(
            ArtworkFetcher(
                artworks_disk.result(), transport=transports.cdn, resolve=transports.resolve
            )
        )
        relay = _relay(emit)
        live = await open_run(command.folder, on_event=relay)
        sources = RunSources(live.run_id, client, artworks, _thresholds(command))
        desk = Arbitration(live, sources, relay)
        recovery = UrlRecovery(live, sources, relay)
        return CurrentRun(stack.pop_all(), live, sources, desk, recovery)


def url_progress(current: CurrentRun) -> Event:
    """Progression du rattrapage, calculee sur l'etat du run a l'instant de l'appel."""
    return to_protocol_event(current.url_recovery.progress())


async def handle_start_tagging(
    command: StartTagging,
    emit: Callable[[Event], None],
    adopt: Callable[[CurrentRun], None],
) -> None:
    """Confie le run a la session avant la phase reseau : un morceau se tranche des qu'il attend.

    La fin de la phase reseau ouvre le rattrapage : sa progression suit `run_finished`.
    """
    current = await open_tagging(command, emit)
    adopt(current)
    await resolve_run(current.live, current.sources, on_event=_relay(emit))
    emit(_run_finished(current.live.snapshot(), RunPhase.NETWORK))
    emit(url_progress(current))


def commit(current: CurrentRun, emit: Callable[[Event], None]) -> RunWriter:
    """Fige le run a l'acceptation de `commit_run`, avant que l'ecriture ne demarre : une
    decision lue juste apres n'y entre plus. Le `RunWriter` reste au run, pour la relance."""
    current.writer = RunWriter(current.live, dump_dir(), _relay(emit))
    return current.writer


async def handle_commit_run(current: CurrentRun, writer: RunWriter) -> Event:
    """Un dump qui ne s'enregistre pas n'a touche aucun fichier : le run redevient confirmable."""
    try:
        await writer.write()
    except TagDumpError:
        current.writer = None
        raise
    return _run_finished(current.live.snapshot(), RunPhase.WRITE)


async def handle_retry_write(current: CurrentRun, writer: RunWriter) -> Event:
    await writer.retry()
    return _run_finished(current.live.snapshot(), RunPhase.WRITE)


def handle_get_rollback_target() -> RollbackTarget:
    """Relu sur le disque : le dernier run annulable peut venir d'une autre session."""
    target = find_rollback_target(dump_dir())
    return RollbackTarget(
        event="rollback_target",
        run=None if target is None else RollbackRun.model_validate(target, from_attributes=True),
    )


async def handle_rollback(
    command: Rollback, live: LiveRun | None, emit: Callable[[Event], None]
) -> RollbackFinished:
    """`live` : le run affiche quand c'est lui qu'on restaure, ses morceaux rendus passent en
    `rolled_back`.
    """

    def restored(track_id: str, path: Path) -> None:
        if live is None:
            return
        record = live.record(track_id)
        if record is None:
            return
        rolled_back = record.rolled_back(path)
        live.update(rolled_back)
        emit(_resolved(rolled_back))

    summary = await roll_back(dump_dir(), command.run_id, command.track_id, restored)
    # Entree retiree sans restauration : l'etat reste, mais l'interface ne doit plus proposer
    # une restauration qui rendrait `rollback_unavailable`.
    if live is not None:
        for track_id in summary.forgotten:
            record = live.record(track_id)
            if record is not None:
                unrestorable = record.unrestorable()
                live.update(unrestorable)
                emit(_resolved(unrestorable))
    return RollbackFinished(
        event="rollback_finished",
        run_id=summary.run_id,
        track_id=command.track_id,
        restored=summary.restored,
        failed=tuple(
            RollbackFailurePayload.model_validate(failure, from_attributes=True)
            for failure in summary.failed
        ),
    )


def _thresholds(command: StartTagging) -> MatchingThresholds:
    """Sans seuils dans la commande, ceux du sidecar : une valeur, une source."""
    sent = command.thresholds
    return DEFAULT_THRESHOLDS if sent is None else sent.to_matching()


type PipelineEvent = tagging.RunEvent | ArbitrationEvent | UrlRecoveryEvent | WriteEvent


def _relay(emit: Callable[[Event], None]) -> Callable[[PipelineEvent], None]:
    return lambda event: emit(to_protocol_event(event))


# PLR0911 : une sortie par evenement traduit, le `match` ferme par `assert_never` etant
# ce qui rend un oubli visible au typage.
def to_protocol_event(event: PipelineEvent) -> Event:  # noqa: PLR0911
    """Traduit un evenement pipeline, arbitrage, rattrapage ou ecriture."""
    match event:
        case tagging.RunStarted():
            return RunStarted(
                event="run_started",
                run_id=event.run_id,
                folder=event.folder,
                tracks=tuple(_entry(record) for record in event.tracks),
            )
        case tagging.TrackResolved():
            return _resolved(event.record)
        case tagging.ArbitrationRequired():
            return _arbitration_state(ArbitrationRequired, event.record)
        case arbitration.ArbitrationUpdated():
            return _arbitration_state(ArbitrationUpdated, event.record)
        case tagging.RunProgress():
            return Progress(
                event="progress",
                phase=Phase.TAGGING,
                processed=event.processed,
                total=event.total,
            )
        case url_recovery.UrlProgress():
            return Progress(
                event="progress",
                phase=Phase.URL_RECOVERY,
                processed=event.processed,
                total=event.total,
            )
        case writing.WriteProgress():
            return Progress(
                event="progress",
                phase=Phase.WRITE,
                processed=event.processed,
                total=event.total,
            )
        case _:
            assert_never(event)


def _entry(record: TrackRecord) -> TrackEntry:
    before = record.tags_before
    return TrackEntry(
        track_id=record.track_id,
        file_name=record.file_name,
        artist=record.identity.artist,
        title=record.identity.title,
        tags_before=None if before is None else _tags_before(before),
    )


def _tags_before(shown: ShownTags) -> TagsBeforePayload:
    return TagsBeforePayload(
        system=shown.system, comment=shown.comment, fields=_rows(shown.fields, shown.system)
    )


def _tags_after(record: TrackRecord, candidate: TrackCandidate) -> tuple[TagValuePayload, ...]:
    """Sans origine lisible, le systeme se deduit de l'extension."""
    before = record.tags_before
    system = tag_system_of(record.path) if before is None else before.system
    return _rows(after_tags(project_tags(candidate), before), system)


def _rows(values: Mapping[TagField, str | None], system: TagSystem) -> tuple[TagValuePayload, ...]:
    return tuple(
        TagValuePayload(field=field, key=shown_key(field, system), value=value)
        for field, value in values.items()
    )


def _resolved(record: TrackRecord) -> TrackResolved:
    if record.state is None or record.resolution is None:
        logger.error("track without state track=%s", record.track_id)
        raise ValueError("track without state")
    candidate = record.candidate
    return TrackResolved(
        event="track_resolved",
        track_id=record.track_id,
        state=record.state,
        resolution=record.resolution,
        failure_reason=record.failure_reason,
        source=record.source,
        after=None if candidate is None else _names(candidate),
        scores=None if record.scored is None else _scores(record.scored),
        artwork_path=record.artwork,
        tags_after=None if candidate is None else _tags_after(record, candidate),
        restorable=record.restorable,
    )


def _arbitration_state(
    kind: type[ArbitrationRequired | ArbitrationUpdated], record: TrackRecord
) -> ArbitrationRequired | ArbitrationUpdated:
    pending = record.arbitration
    if pending is None:
        logger.error("track without arbitration track=%s", record.track_id)
        raise ValueError("track without arbitration")
    return kind(
        track_id=record.track_id,
        source=pending.source,
        beatport_unavailable=pending.beatport_unavailable,
        candidates=tuple(_candidate(scored) for scored in pending.candidates),
        empty_reason=pending.empty_reason,
        other_source=None if pending.other is None else pending.other.source,
    )


def _candidate(scored: ScoredCandidate) -> CandidatePayload:
    candidate = scored.candidate
    released = candidate.release.release_date if candidate.release else None
    return CandidatePayload(
        artist=credited_artists(candidate),
        title=full_title(candidate),
        label=None if candidate.label is None else candidate.label.name,
        year=None if released is None else released.year,
        scores=_scores(scored),
    )


def _names(candidate: TrackCandidate) -> TrackNames:
    """Ce que la source ecrira : regle de titre et d'artistes de l'ADR-011."""
    return TrackNames(artist=credited_artists(candidate), title=full_title(candidate))


def _scores(scored: ScoredCandidate) -> TrackScores:
    """Arrondis : l'ecran affiche « A 96 · T 92 »."""
    return TrackScores(
        artist=None if scored.artist_score is None else round(scored.artist_score),
        title=round(scored.title_score),
        average=round(scored.score),
    )


def _run_finished(run: TaggingRun, phase: RunPhase) -> RunFinished:
    # Chaque compteur se lit sur le champ de son issue, jamais sur l'absence d'un autre : un
    # `state` laisse vide gonflerait en silence le compte des arbitrages.
    states = Counter(record.state for record in run.tracks)
    return RunFinished(
        event="run_finished",
        phase=phase,
        run_id=run.run_id,
        resolved=states[tagging.TrackState.RESOLVED],
        unresolved=states[tagging.TrackState.UNRESOLVED],
        written=states[tagging.TrackState.WRITTEN],
        write_error=states[tagging.TrackState.WRITE_ERROR],
        awaiting_arbitration=sum(1 for record in run.tracks if record.arbitration is not None),
    )
