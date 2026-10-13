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
from pathlib import PurePosixPath
from typing import TYPE_CHECKING, NamedTuple, assert_never, override

import sentry_sdk

from tagger import __version__
from tagger.core.api_key import ApiKeyMissingError, read_api_key, store_api_key
from tagger.core.errors import RunNotFoundError
from tagger.core.paths import app_data_dir
from tagger.playlists import list_playlists, read_playlist
from tagger.playlists.extraction import extract
from tagger.protocol import (
    ArbitrationRequired,
    ArbitrationUpdated,
    CandidatePayload,
    DuplicatePayload,
    ExtractionFinished,
    ExtractPlaylist,
    FailurePayload,
    InterruptedRunEvent,
    InterruptedRunPayload,
    ListPlaylists,
    LoadRun,
    PastRunPayload,
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
    RunLoaded,
    RunPhase,
    RunsListed,
    RunStarted,
    SetApiKey,
    StartTagging,
    TagsBeforePayload,
    TagValuePayload,
    TrackEntry,
    TrackLoaded,
    TrackNames,
    TrackResolved,
    TrackScores,
    UnreadablePlanPayload,
    Version,
)
from tagger.reports.extraction import ReportContext, ReportWriteError, write_extraction_report
from tagger.reports.index import IndexEntry, index_path, list_reports, record_report
from tagger.reports.tagging import (
    after_rows,
    load_tagging_report,
    report_paths,
    tag_rows,
    write_tagging_report,
)
from tagger.resolution.cache import (
    ArtworkFetcher,
    ArtworkUnavailableError,
    DiskCache,
    ResponseCache,
    resolve_host,
)
from tagger.resolution.matching import (
    DEFAULT_THRESHOLDS,
    MatchingThresholds,
    credited_artists,
    full_title,
)
from tagger.resolution.scraper_client import TechnoScraperClient
from tagger.resolution.sources import RunSources
from tagger.run import arbitration, tagging, url_recovery, writing
from tagger.run.arbitration import Arbitration
from tagger.run.plan import SCHEMA_VERSION as PLAN_SCHEMA_VERSION
from tagger.run.plan import PlanRecorder, RunPlan, plan_dir
from tagger.run.resume import InterruptedRun, UnreadablePlan, detect_interrupted, reopen_run
from tagger.run.rollback import find_rollback_target, roll_back
from tagger.run.tagging import open_run, resolve_run
from tagger.run.url_recovery import UrlRecovery
from tagger.run.writing import RunWriter
from tagger.tags.files import TagField
from tagger.tags.tag_dump import TagDumpError, dump_dir

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable
    from pathlib import Path

    import httpx2

    from tagger.protocol import Event
    from tagger.reports.extraction import ReportPaths
    from tagger.reports.tagging import ReportTagValue, TaggingReport, TaggingReportTrack
    from tagger.resolution.cache import HostResolver
    from tagger.resolution.matching import ScoredCandidate
    from tagger.resolution.scraper_client import TrackCandidate
    from tagger.run.arbitration import ArbitrationEvent
    from tagger.run.resume import DetectedPlan
    from tagger.run.tagging import LiveRun, TaggingRun, TrackRecord
    from tagger.run.url_recovery import UrlRecoveryEvent
    from tagger.run.writing import WriteEvent
    from tagger.tags.files import TagSystem

logger = logging.getLogger(__name__)


def handle_get_version() -> Version:
    """Version nue et presence d'une cle : jamais la cle elle-meme (ADR-012)."""
    return Version(
        event="version",
        version=__version__,
        api_key_configured=read_api_key() is not None,
    )


def handle_get_interrupted_run(active_run_id: str | None) -> InterruptedRunEvent:
    """Relu sur le disque a chaque appel : un abandon change le plan a proposer."""
    detected = detect_interrupted(plan_dir(), dump_dir(), active_run_id=active_run_id)
    return InterruptedRunEvent(event="interrupted_run", run=_detected(detected))


def _detected(
    detected: DetectedPlan | None,
) -> InterruptedRunPayload | UnreadablePlanPayload | None:
    match detected:
        case None:
            return None
        case InterruptedRun():
            return InterruptedRunPayload(
                run_id=detected.run_id,
                started_at=detected.started_at,
                folder=detected.folder,
                processed=detected.processed,
                total=detected.total,
                folder_missing=detected.folder_missing,
            )
        case UnreadablePlan():
            return UnreadablePlanPayload(
                run_id=detected.run_id,
                started_at=detected.started_at,
                found=detected.error.found,
                expected=PLAN_SCHEMA_VERSION,
            )
        case _:
            assert_never(detected)


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
        plan: PlanRecorder | None = None,
    ) -> None:
        self.live = live
        self.sources = sources
        self.arbitration = arbitration
        self.url_recovery = url_recovery
        # `None` pour un dossier sans morceau : rien a reprendre.
        self.plan = plan
        # Pose a la confirmation : sa presence fige le run, plus aucune decision n'y entre.
        self.writer: RunWriter | None = None
        # Noms du rapport, choisis a la premiere ecriture et gardes meme si elle echoue : une
        # relance reecrit le meme couple, jamais un `-2`.
        self.report_names: ReportPaths | None = None
        # Dernier rapport ecrit avec succes, celui que `run_finished` annonce.
        self.report: ReportPaths | None = None
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
        """`finally` : une annulation du `gather` en attente ne doit pas empecher la fermeture.

        Le plan est vide, jamais supprime : c'est lui que la reprise cherchera.
        """
        try:
            await self._cancel_gestures()
        finally:
            try:
                if self.plan is not None:
                    await self.plan.flush()
            finally:
                await self._stack.aclose()

    async def abandon(self) -> None:
        """Run remplace par un nouveau : son plan non confirme part, sans etre vide d'abord."""
        try:
            await self._cancel_gestures()
            if self.plan is not None:
                await self.plan.discard()
        finally:
            await self._stack.aclose()

    async def _cancel_gestures(self) -> None:
        for gesture in self._gestures:
            gesture.cancel()
        await asyncio.gather(*self._gestures, return_exceptions=True)


async def _open_clients(stack: AsyncExitStack) -> tuple[TechnoScraperClient, ArtworkFetcher]:
    """Cle, caches, client et pochettes d'un run, poses dans `stack` : un run neuf et un run
    repris partagent tout ce qui precede l'ouverture du run lui-meme."""
    api_key = await asyncio.to_thread(read_api_key)
    if api_key is None:
        raise ApiKeyMissingError

    # Deux scans independants, superposes plutot qu'enchaines. `TaskGroup` et non
    # `gather` : si l'un leve, il annule l'autre au lieu de le laisser courir seul.
    async with asyncio.TaskGroup() as opening:
        responses_disk = opening.create_task(
            asyncio.to_thread(DiskCache, _cache_dir("responses")), name="cache:responses"
        )
        artworks_disk = opening.create_task(
            asyncio.to_thread(DiskCache, _cache_dir("artworks")), name="cache:artworks"
        )
    transports = tagging_transports()
    client = await stack.enter_async_context(
        TechnoScraperClient(
            api_key, transport=transports.api, cache=ResponseCache(responses_disk.result())
        )
    )
    artworks = await stack.enter_async_context(_artwork_fetcher(artworks_disk.result(), transports))
    return client, artworks


def _cache_dir(name: str) -> Path:
    return app_data_dir() / "cache" / name


def _artwork_fetcher(disk: DiskCache, transports: TaggingTransports) -> ArtworkFetcher:
    return ArtworkFetcher(disk, transport=transports.cdn, resolve=transports.resolve)


def _build_current_run(
    stack: AsyncExitStack,
    live: LiveRun,
    sources: RunSources,
    relay: Callable[[PipelineEvent], None],
    plan: PlanRecorder | None,
) -> CurrentRun:
    desk = Arbitration(live, sources, relay)
    recovery = UrlRecovery(live, sources, relay)
    return CurrentRun(stack.pop_all(), live, sources, desk, recovery, plan)


async def open_tagging(command: StartTagging, emit: Callable[[Event], None]) -> CurrentRun:
    """Ouvre clients et run neuf, branche l'arbitrage ; client et fetcher survivent dans la pile
    rendue au `CurrentRun` et une ouverture ratee referme ce qu'elle a deja ouvert."""
    async with AsyncExitStack() as stack:
        client, artworks = await _open_clients(stack)
        relay = _relay(emit)
        live = await open_run(command.folder, on_event=relay)
        thresholds = _thresholds(command)
        sources = RunSources(live.run_id, client, artworks, thresholds)
        plan = await _open_plan(live, thresholds)
        return _build_current_run(stack, live, sources, relay, plan)


async def open_resumed_tagging(plan: RunPlan, emit: Callable[[Event], None]) -> CurrentRun:
    """Rouvre le run d'un plan avec ses seuils ; son plan continue dans le meme fichier."""
    async with AsyncExitStack() as stack:
        client, artworks = await _open_clients(stack)
        relay = _relay(emit)
        thresholds = plan.thresholds.to_matching()
        sources = RunSources(plan.run_id, client, artworks, thresholds)
        live = await reopen_run(plan, sources, on_event=relay)
        recorder = await _open_plan(live, thresholds, started_at=plan.started_at)
        return _build_current_run(stack, live, sources, relay, recorder)


async def _open_plan(
    live: LiveRun, thresholds: MatchingThresholds, *, started_at: datetime | None = None
) -> PlanRecorder | None:
    """Plan ecrit avant la phase reseau, tous morceaux en attente ; sans morceau, aucun plan.

    `started_at` : l'instant de depart d'un run repris, qui garde ainsi le fichier de son plan.
    """
    if not live.snapshot().tracks:
        return None
    plan = RunPlan.opened(live, thresholds, started_at or datetime.now(UTC))
    recorder = PlanRecorder(plan, plan_dir())
    live.observe(recorder.record)
    await recorder.flush()
    return recorder


def url_progress(current: CurrentRun) -> Event:
    """Progression du rattrapage, calculee sur l'etat du run a l'instant de l'appel."""
    return to_protocol_event(current.url_recovery.progress())


async def handle_start_tagging(
    command: StartTagging,
    emit: Callable[[Event], None],
    adopt: Callable[[CurrentRun], None],
) -> None:
    """Confie le run a la session avant la phase reseau : un morceau se tranche des qu'il attend."""
    current = await open_tagging(command, emit)
    adopt(current)
    await _network_phase(current, emit)


async def handle_resume_run(
    plan: RunPlan,
    emit: Callable[[Event], None],
    adopt: Callable[[CurrentRun], None],
) -> None:
    """Rejoue le run interrompu, puis ne lance la phase reseau que sur ses morceaux restants."""
    current = await open_resumed_tagging(plan, emit)
    adopt(current)
    await _network_phase(current, emit)


async def _network_phase(current: CurrentRun, emit: Callable[[Event], None]) -> None:
    """Phase reseau d'un run neuf ou repris ; sa fin ouvre le rattrapage, dont la progression
    suit `run_finished`."""
    await resolve_run(current.live, current.sources, on_event=_relay(emit))
    emit(_run_finished(current.live.snapshot(), RunPhase.NETWORK))
    emit(url_progress(current))


def commit(current: CurrentRun, emit: Callable[[Event], None]) -> RunWriter:
    """Fige le run a l'acceptation de `commit_run`, avant que l'ecriture ne demarre : une
    decision lue juste apres n'y entre plus. Le `RunWriter` reste au run, pour la relance."""
    current.writer = RunWriter(current.live, dump_dir(), _relay(emit))
    return current.writer


async def handle_commit_run(current: CurrentRun, writer: RunWriter) -> Event:
    """Le plan est confirme sur le disque avant le premier fichier (write-ahead).

    Un dump qui ne s'enregistre pas n'a touche aucun fichier : le run et son plan redeviennent
    confirmables.
    """
    if current.plan is not None:
        await current.plan.commit()
    try:
        await writer.write()
    except TagDumpError:
        current.writer = None
        if current.plan is not None:
            await current.plan.reopen()
        raise
    await _write_report(current)
    return _run_finished(current.live.snapshot(), RunPhase.WRITE, current.report)


async def handle_retry_write(current: CurrentRun, writer: RunWriter) -> Event:
    await writer.retry()
    await _write_report(current)
    return _run_finished(current.live.snapshot(), RunPhase.WRITE, current.report)


async def _write_report(current: CurrentRun) -> None:
    """Rapport du run apres chaque phase d'ecriture, puis son inscription au registre.

    Les fichiers musicaux sont deja ecrits : un rapport refuse se logue, il ne casse pas la phase.
    """
    run = current.live.snapshot()
    written_at = datetime.now(UTC)
    names = current.report_names
    if names is None:
        names = await asyncio.to_thread(report_paths, run.folder, written_at)
        current.report_names = names
    try:
        await asyncio.to_thread(
            write_tagging_report, run, current.sources.thresholds, written_at, names
        )
    except ReportWriteError as error:
        cause = error.__cause__
        logger.error(  # noqa: TRY400  (une trace porterait le chemin complet)
            "tagging report not written run=%s reason=report_write_failed errno=%s",
            run.run_id,
            cause.errno if isinstance(cause, OSError) else None,
        )
        return
    except Exception as error:
        # Les fichiers musicaux sont ecrits : un bug du rapport ne doit pas priver l'interface de
        # la fin de phase. Pas de `BaseException` : l'annulation doit passer.
        logger.exception("tagging report failed unexpectedly run=%s", run.run_id)
        # `LoggingIntegration` est coupee : le log ne part pas, le bug doit remonter.
        sentry_sdk.capture_exception(error)
        return
    current.report = names
    entry = IndexEntry(
        run_id=run.run_id, written_at=written_at, folder=run.folder, report_path=names.json_path
    )
    await asyncio.to_thread(record_report, index_path(), entry)


def handle_list_runs() -> RunsListed:
    """Runs passes du registre, du plus recent au plus ancien, rapports disparus ecartes."""
    return RunsListed(
        event="runs_listed",
        runs=tuple(
            PastRunPayload.model_validate(entry, from_attributes=True)
            for entry in list_reports(index_path())
        ),
    )


async def handle_load_run(command: LoadRun) -> RunLoaded:
    """Recapitulatif d'un run passe, relu dans son rapport (migration ADR-018 B), sans rien
    rejouer ; les pochettes passent par le cache puis le CDN, jamais par l'API."""
    entries = await asyncio.to_thread(list_reports, index_path())
    entry = next((known for known in entries if known.run_id == command.run_id), None)
    if entry is None:
        raise RunNotFoundError(command.run_id)
    report = await asyncio.to_thread(load_tagging_report, entry.report_path)
    artworks = await _artworks(report)
    return RunLoaded(
        event="run_loaded",
        run_id=report.run_id,
        folder=report.folder,
        generated_at=report.generated_at,
        tracks=tuple(_loaded(track, artworks.get(track.track_id)) for track in report.tracks),
    )


async def _artworks(report: TaggingReport) -> dict[str, Path]:
    """Pochettes retelechargees par un fetcher ouvert pour la tache, dont le pool est borne.

    Le cache du run vivant n'est pas emprunte : ses entrees expirent apres 30 jours, les rapports
    jamais. Une pochette partagee par plusieurs morceaux n'est demandee qu'une fois.
    """
    urls = dict.fromkeys(
        track.artwork_url for track in report.tracks if track.artwork_url is not None
    )
    if not urls:
        return {}
    disk = await asyncio.to_thread(DiskCache, _cache_dir("artworks"))
    async with (
        _artwork_fetcher(disk, tagging_transports()) as fetcher,
        asyncio.TaskGroup() as group,
    ):
        fetches = {
            url: group.create_task(_artwork_or_none(fetcher, url), name=f"artwork:{position}")
            for position, url in enumerate(urls, start=1)
        }
    paths = {url: path for url, fetch in fetches.items() if (path := fetch.result()) is not None}
    return {
        track.track_id: path
        for track in report.tracks
        if track.artwork_url is not None and (path := paths.get(track.artwork_url)) is not None
    }


async def _artwork_or_none(fetcher: ArtworkFetcher, url: str) -> Path | None:
    """Une pochette indisponible laisse le morceau sans image, jamais le run sans recapitulatif."""
    try:
        return await fetcher.fetch(url)
    except ArtworkUnavailableError:
        return None


def _loaded(track: TaggingReportTrack, artwork: Path | None) -> TrackLoaded:
    before = {row.field: row.value for row in track.tags_before or ()}
    scores = track.scores
    return TrackLoaded(
        track_id=track.track_id,
        file_name=PurePosixPath(track.file_before).name,
        file_after=None if track.file_after is None else PurePosixPath(track.file_after).name,
        artist=before.get(TagField.ARTIST) or "",
        title=before.get(TagField.TITLE) or "",
        state=track.state,
        resolution=track.resolution,
        failure_reason=track.failure_reason,
        source=track.source,
        after=None
        if track.artist is None or track.title is None
        else TrackNames(artist=track.artist, title=track.title),
        scores=None if scores is None else _rounded(scores.artist, scores.title, scores.average),
        # Systeme et lignes sont nuls ensemble : le rapport a lu les deux sur les memes tags.
        tags_before=None
        if track.system is None or track.tags_before is None
        else _tags_before(track.system, track.comment_before, track.tags_before),
        tags_after=None if track.tags_after is None else _payload_rows(track.tags_after),
        source_url=track.url,
        artwork_path=artwork,
    )


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
        tags_before=None
        if before is None
        else _tags_before(before.system, before.comment, tag_rows(before.fields, before.system)),
    )


def _tags_before(
    system: TagSystem, comment: str | None, rows: Iterable[ReportTagValue]
) -> TagsBeforePayload:
    return TagsBeforePayload(system=system, comment=comment, fields=_payload_rows(rows))


def _tags_after(record: TrackRecord, candidate: TrackCandidate) -> tuple[TagValuePayload, ...]:
    return _payload_rows(after_rows(record, candidate))


def _payload_rows(rows: Iterable[ReportTagValue]) -> tuple[TagValuePayload, ...]:
    """Une seule projection des lignes pour l'ecran et le rapport, ici seulement convertie."""
    return tuple(TagValuePayload.model_validate(row, from_attributes=True) for row in rows)


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
        source_url=None if candidate is None else candidate.url,
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
    return _rounded(scored.artist_score, scored.title_score, scored.score)


def _rounded(artist: float | None, title: float, average: float) -> TrackScores:
    return TrackScores(
        artist=None if artist is None else round(artist),
        title=round(title),
        average=round(average),
    )


def _run_finished(
    run: TaggingRun, phase: RunPhase, report: ReportPaths | None = None
) -> RunFinished:
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
        report_path=None if report is None else report.json_path,
    )
