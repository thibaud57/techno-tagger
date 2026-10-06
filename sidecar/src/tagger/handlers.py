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

from tagger import __version__, arbitration, tagging, url_recovery
from tagger.api_key import ApiKeyMissingError, read_api_key, store_api_key
from tagger.arbitration import Arbitration
from tagger.cache import ArtworkFetcher, DiskCache, ResponseCache, resolve_host
from tagger.extraction import extract
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
    RunFinished,
    RunPhase,
    RunStarted,
    SetApiKey,
    StartTagging,
    TrackEntry,
    TrackNames,
    TrackResolved,
    TrackScores,
    Version,
)
from tagger.reports import ReportContext, write_extraction_report
from tagger.scraper_client import TechnoScraperClient
from tagger.sources import RunSources
from tagger.tagging import open_run, resolve_run
from tagger.url_recovery import UrlRecovery

if TYPE_CHECKING:
    from collections.abc import Callable

    import httpx2

    from tagger.arbitration import ArbitrationEvent
    from tagger.cache import HostResolver
    from tagger.matching import ScoredCandidate
    from tagger.protocol import Event
    from tagger.scraper_client import TrackCandidate
    from tagger.tagging import LiveRun, TaggingRun, TrackRecord
    from tagger.url_recovery import UrlRecoveryEvent

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
        self._stack = stack
        self._gestures: set[asyncio.Task[None]] = set()

    @override
    def __repr__(self) -> str:
        return f"CurrentRun(run_id={self.live.run_id!r}, gestures={len(self._gestures)})"

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
    emit(_run_finished(current.live.snapshot()))
    emit(url_progress(current))


def _thresholds(command: StartTagging) -> MatchingThresholds:
    """Sans seuils dans la commande, ceux du sidecar : une valeur, une source."""
    sent = command.thresholds
    return DEFAULT_THRESHOLDS if sent is None else sent.to_matching()


def _relay(
    emit: Callable[[Event], None],
) -> Callable[[tagging.RunEvent | ArbitrationEvent | UrlRecoveryEvent], None]:
    return lambda event: emit(to_protocol_event(event))


def to_protocol_event(event: tagging.RunEvent | ArbitrationEvent | UrlRecoveryEvent) -> Event:
    """Traduit un evenement pipeline, arbitrage ou rattrapage ; un cas oublie est une erreur
    de typage."""
    match event:
        case tagging.RunStarted():
            return RunStarted(
                event="run_started",
                run_id=event.run_id,
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
        case _:
            assert_never(event)


def _entry(record: TrackRecord) -> TrackEntry:
    return TrackEntry(
        track_id=record.track_id,
        file_name=record.file_name,
        artist=record.identity.artist,
        title=record.identity.title,
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


def _run_finished(run: TaggingRun) -> RunFinished:
    # Les trois compteurs se lisent sur le champ qui porte chaque issue, jamais sur
    # l'absence d'un autre : un `state` laisse vide pour une raison nouvelle gonflerait
    # sinon en silence le compte des arbitrages.
    states = Counter(record.state for record in run.tracks)
    return RunFinished(
        event="run_finished",
        phase=RunPhase.NETWORK,
        run_id=run.run_id,
        resolved=states[tagging.TrackState.RESOLVED],
        unresolved=states[tagging.TrackState.UNRESOLVED],
        awaiting_arbitration=sum(1 for record in run.tracks if record.arbitration is not None),
    )
