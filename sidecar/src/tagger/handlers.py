"""Execution d'une commande validee, du modele du protocole a l'evenement.

Separe de `__main__.py` pour que le point d'entree reste le moteur et le routage.
"""

import asyncio
import logging
from contextlib import AsyncExitStack
from datetime import UTC, datetime
from pathlib import PurePosixPath
from typing import TYPE_CHECKING, NamedTuple, assert_never, override

from tagger import RELEASE, __version__
from tagger.core.api_key import ApiKeyMissingError, read_api_key, store_api_key
from tagger.core.errors import RunNotFoundError
from tagger.core.logger import LOG_FILE_NAME
from tagger.core.observability import capture_unexpected, selftest_requested
from tagger.core.paths import log_dir
from tagger.core.tasks import cancel_all
from tagger.playlists import list_playlists, read_playlist
from tagger.playlists.extraction import extract
from tagger.protocol import (
    CacheCleared,
    CacheSize,
    DuplicatePayload,
    ExtractionFinished,
    ExtractPlaylist,
    FailurePayload,
    FeedbackReady,
    InterruptedRunEvent,
    InterruptedRunPayload,
    ListPlaylists,
    LoadRun,
    PastRunPayload,
    Phase,
    PlaylistEntry,
    PlaylistsListed,
    PrepareFeedback,
    Progress,
    Rollback,
    RollbackFailurePayload,
    RollbackFinished,
    RollbackRun,
    RollbackTarget,
    RunLoaded,
    RunPhase,
    RunsListed,
    SetApiKey,
    StartTagging,
    ThresholdsPayload,
    TrackLoaded,
    TrackNames,
    UnreadablePlanPayload,
    Version,
)
from tagger.reports.extraction import ReportContext, ReportWriteError, write_extraction_report
from tagger.reports.feedback import feedback_dir, feedback_issue_url, write_feedback_export
from tagger.reports.index import IndexEntry, index_path, list_reports, record_report
from tagger.reports.tagging import (
    load_tagging_report,
    report_paths,
    write_tagging_report,
)
from tagger.resolution.cache import (
    ArtworkFetcher,
    ArtworkUnavailableError,
    DiskCache,
    ResponseCache,
    cache_dir,
    cache_size,
    clear_cache,
    resolve_host,
)
from tagger.resolution.matching import (
    DEFAULT_THRESHOLDS,
    MatchingThresholds,
)
from tagger.resolution.scraper_client import TechnoScraperClient
from tagger.resolution.sources import RunSources
from tagger.run.arbitration import Arbitration
from tagger.run.models import TrackState
from tagger.run.plan import SCHEMA_VERSION as PLAN_SCHEMA_VERSION
from tagger.run.plan import PlanRecorder, RunPlan, plan_dir
from tagger.run.resume import InterruptedRun, UnreadablePlan, detect_interrupted, reopen_run
from tagger.run.rollback import find_rollback_target, roll_back
from tagger.run.tagging import open_run, resolve_run
from tagger.run.url_recovery import UrlRecovery
from tagger.run.writing import RunWriter
from tagger.tags.files import TagField
from tagger.tags.tag_dump import TagDumpError, dump_dir
from tagger.translation import (
    payload_rows,
    relay_into,
    resolved_event,
    rounded_scores,
    run_finished_event,
    tags_before_payload,
    to_protocol_event,
)

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable, Mapping
    from pathlib import Path

    import httpx2

    from tagger.protocol import Event
    from tagger.reports.extraction import ReportPaths
    from tagger.reports.tagging import TaggingReport, TaggingReportTrack
    from tagger.resolution.cache import HostResolver
    from tagger.run.models import LiveRun
    from tagger.run.resume import DetectedPlan
    from tagger.translation import PipelineEvent

logger = logging.getLogger(__name__)


def handle_get_version() -> Version:
    """Version nue et presence d'une cle : jamais la cle elle-meme (ADR-012)."""
    return Version(
        event="version",
        version=__version__,
        api_key_configured=read_api_key() is not None,
        sentry_selftest=selftest_requested(),
        default_thresholds=ThresholdsPayload.model_validate(
            DEFAULT_THRESHOLDS, from_attributes=True
        ),
        log_file=log_dir() / LOG_FILE_NAME,
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
            return InterruptedRunPayload.model_validate(detected, from_attributes=True)
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
    """Le module d'extraction ignore le protocole : son rappel `(traites, total)` devient ici
    l'evenement `progress`.
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
    # Sans compteurs : aucune cle du jeu logfmt fixe ne les porte, le rapport ecrit juste
    # avant les detaille deja.
    logger.info("extraction finished")

    return ExtractionFinished(
        event="extraction_finished",
        extracted=result.extracted,
        already_present=result.already_present,
        missing=result.missing,
        # Les modeles de frontiere reprennent champ pour champ les dataclasses du
        # metier : `from_attributes` les recopie, `discarded` compris, plutot qu'une
        # enumeration a tenir a jour ici et dans le rapport (cf. `reports/extraction.py`).
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
    """Transports du client et du CDN avec le resolveur d'hote des pochettes : `None` et
    le resolveur reel en production.
    """

    api: httpx2.AsyncBaseTransport | None
    cdn: httpx2.AsyncBaseTransport | None
    resolve: HostResolver


def tagging_transports() -> TaggingTransports:
    """Remplace au complet par les tests : un CDN simule partirait sinon au DNS."""
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

    @property
    def awaits_write(self) -> bool:
        """Ses pochettes servent encore : ecriture a confirmer, ou echecs que `retry_write`
        rejouera. `write_tags` les lit dans le cache au moment d'ecrire."""
        return not self.committed or any(
            record.state is TrackState.WRITE_ERROR for record in self.live.snapshot().tracks
        )

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
        await cancel_all(self._gestures)


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
    return cache_dir() / name


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
        relay = relay_into(emit)
        live = await open_run(command.folder, on_event=relay)
        thresholds = _thresholds(command)
        sources = RunSources(live.run_id, client, artworks, thresholds)
        plan = await _open_plan(live, thresholds)
        return _build_current_run(stack, live, sources, relay, plan)


async def open_resumed_tagging(plan: RunPlan, emit: Callable[[Event], None]) -> CurrentRun:
    """Rouvre le run d'un plan avec ses seuils ; son plan continue dans le meme fichier."""
    async with AsyncExitStack() as stack:
        client, artworks = await _open_clients(stack)
        relay = relay_into(emit)
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
    take_over: Callable[[CurrentRun], Awaitable[None]],
) -> None:
    """Rejoue le run interrompu, puis ne lance la phase reseau que sur ses morceaux restants.

    `take_over` attend le run repris ouvert : un refus ne coute rien au run affiche.
    """
    current = await open_resumed_tagging(plan, emit)
    await take_over(current)
    await _network_phase(current, emit)


async def _network_phase(current: CurrentRun, emit: Callable[[Event], None]) -> None:
    """Phase reseau d'un run neuf ou repris ; sa fin ouvre le rattrapage, dont la progression
    suit `run_finished`."""
    await resolve_run(current.live, current.sources, on_event=relay_into(emit))
    emit(run_finished_event(current.live.snapshot(), RunPhase.NETWORK))
    emit(url_progress(current))


def commit(current: CurrentRun, emit: Callable[[Event], None]) -> RunWriter:
    """Fige le run a l'acceptation de `commit_run`, avant que l'ecriture ne demarre : une
    decision lue juste apres n'y entre plus. Le `RunWriter` reste au run, pour la relance."""
    current.writer = RunWriter(current.live, dump_dir(), relay_into(emit))
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
    return run_finished_event(current.live.snapshot(), RunPhase.WRITE, current.report)


async def handle_retry_write(current: CurrentRun, writer: RunWriter) -> Event:
    await writer.retry()
    await _write_report(current)
    return run_finished_event(current.live.snapshot(), RunPhase.WRITE, current.report)


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
        capture_unexpected(error)
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


def _report_of(run_id: str) -> TaggingReport:
    """Rapport d'un run de l'index, migre si besoin.

    Leve `RunNotFoundError` (run absent) ou `TaggingReportUnreadableError` (rapport illisible).
    """
    entry = next((known for known in list_reports(index_path()) if known.run_id == run_id), None)
    if entry is None:
        raise RunNotFoundError(run_id)
    return load_tagging_report(entry.report_path)


async def handle_load_run(command: LoadRun) -> RunLoaded:
    """Recapitulatif d'un run passe, relu dans son rapport (migration ADR-018 B), sans rien
    rejouer ; les pochettes passent par le cache puis le CDN, jamais par l'API."""
    report = await asyncio.to_thread(_report_of, command.run_id)
    artworks = await _artworks(report)
    return RunLoaded(
        event="run_loaded",
        run_id=report.run_id,
        folder=report.folder,
        generated_at=report.generated_at,
        tracks=tuple(_loaded(track, artworks) for track in report.tracks),
    )


def handle_prepare_feedback(command: PrepareFeedback) -> FeedbackReady:
    """L'export s'ecrit avant l'URL : celle-ci nomme le fichier a glisser dans l'issue."""
    report = _report_of(command.run_id)
    export = write_feedback_export(feedback_dir(), report, RELEASE)
    return FeedbackReady(
        event="feedback_ready",
        run_id=report.run_id,
        url=feedback_issue_url(report, RELEASE, export.name),
        export_path=export,
    )


async def _artworks(report: TaggingReport) -> dict[str, Path]:
    """Chemin des pochettes par URL, retelechargees par un fetcher ouvert pour la tache, dont le
    pool est borne.

    Le cache du run vivant n'est pas emprunte : ses entrees expirent apres `CACHE_TTL`, les rapports
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
    return {url: path for url, fetch in fetches.items() if (path := fetch.result()) is not None}


async def _artwork_or_none(fetcher: ArtworkFetcher, url: str) -> Path | None:
    """Une pochette indisponible laisse le morceau sans image, jamais le run sans recapitulatif."""
    try:
        return await fetcher.fetch(url)
    except ArtworkUnavailableError:
        return None


def _loaded(track: TaggingReportTrack, artworks: Mapping[str, Path]) -> TrackLoaded:
    before = {row.field: row.value for row in track.tags_before or ()}
    scores = track.scores
    return TrackLoaded(
        track_id=track.track_id,
        file_name=PurePosixPath(track.file_before).name,
        artist=before.get(TagField.ARTIST) or "",
        title=before.get(TagField.TITLE) or "",
        state=track.state,
        resolution=track.resolution,
        failure_reason=track.failure_reason,
        source=track.source,
        after=None
        if track.artist is None or track.title is None
        else TrackNames(artist=track.artist, title=track.title),
        scores=None
        if scores is None
        else rounded_scores(scores.artist, scores.title, scores.average),
        # Systeme et lignes sont nuls ensemble : le rapport a lu les deux sur les memes tags.
        tags_before=None
        if track.system is None or track.tags_before is None
        else tags_before_payload(track.system, track.comment_before, track.tags_before),
        tags_after=None if track.tags_after is None else payload_rows(track.tags_after),
        source_url=track.url,
        artwork_path=None if track.artwork_url is None else artworks.get(track.artwork_url),
    )


def handle_get_rollback_target() -> RollbackTarget:
    """Relu sur le disque : le dernier run annulable peut venir d'une autre session."""
    target = find_rollback_target(dump_dir())
    return RollbackTarget(
        event="rollback_target",
        run=None if target is None else RollbackRun.model_validate(target, from_attributes=True),
    )


def handle_get_cache_size() -> CacheSize:
    return CacheSize(event="cache_size", size_bytes=cache_size(cache_dir()))


def handle_clear_cache() -> CacheCleared:
    """Le garde est dans la session, seule a connaitre le run courant."""
    cleared = clear_cache(cache_dir())
    logger.info("cache cleared")
    return CacheCleared(
        event="cache_cleared", freed_bytes=cleared.freed_bytes, size_bytes=cleared.size_bytes
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
        emit(resolved_event(rolled_back))

    summary = await roll_back(dump_dir(), command.run_id, command.track_id, restored)
    # Entree retiree sans restauration : l'etat reste, mais l'interface ne doit plus proposer
    # une restauration qui rendrait `rollback_unavailable`.
    if live is not None:
        for track_id in summary.forgotten:
            record = live.record(track_id)
            if record is not None:
                unrestorable = record.unrestorable()
                live.update(unrestorable)
                emit(resolved_event(unrestorable))
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
