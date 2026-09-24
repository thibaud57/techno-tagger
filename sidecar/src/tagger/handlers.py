"""Execution d'une commande validee : du modele du protocole au metier, puis a
l'evenement.

Separe de `__main__.py` pour que le point d'entree reste le moteur et le routage,
le contrat etant appele a grandir bien au-dela des commandes actuelles.
"""

import asyncio
import logging
from collections import Counter
from datetime import UTC, datetime
from typing import TYPE_CHECKING, NamedTuple, assert_never

from tagger import __version__, tagging
from tagger.api_key import ApiKeyMissingError, read_api_key, store_api_key
from tagger.cache import ArtworkFetcher, DiskCache, ResponseCache, resolve_host
from tagger.extraction import extract
from tagger.matching import DEFAULT_THRESHOLDS, MatchingThresholds, credited_artists, full_title
from tagger.paths import app_data_dir
from tagger.playlists import list_playlists, read_playlist
from tagger.protocol import (
    ArbitrationRequired,
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
from tagger.tagging import run_tagging

if TYPE_CHECKING:
    from collections.abc import Callable

    import httpx2

    from tagger.cache import HostResolver
    from tagger.matching import ScoredCandidate
    from tagger.protocol import Event
    from tagger.scraper_client import TrackCandidate
    from tagger.tagging import TaggingRun, TrackRecord

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


async def handle_start_tagging(command: StartTagging, emit: Callable[[Event], None]) -> RunFinished:
    """Ouvre les caches, construit le client, lance le run et traduit ses evenements."""
    api_key = await asyncio.to_thread(read_api_key)
    if api_key is None:
        raise ApiKeyMissingError

    cache_root = app_data_dir() / "cache"
    # Deux scans independants, superposes plutot qu'enchaines. `TaskGroup` et non
    # `gather` : si l'un leve, il annule l'autre au lieu de le laisser courir seul.
    async with asyncio.TaskGroup() as opening:
        responses_disk = opening.create_task(asyncio.to_thread(DiskCache, cache_root / "responses"))
        artworks_disk = opening.create_task(asyncio.to_thread(DiskCache, cache_root / "artworks"))
    responses = ResponseCache(responses_disk.result())
    artwork_cache = artworks_disk.result()
    transports = tagging_transports()

    async with (
        TechnoScraperClient(api_key, transport=transports.api, cache=responses) as client,
        ArtworkFetcher(
            artwork_cache, transport=transports.cdn, resolve=transports.resolve
        ) as artworks,
    ):
        run = await run_tagging(
            command.folder,
            client=client,
            artworks=artworks,
            thresholds=_thresholds(command),
            on_event=lambda event: emit(to_protocol_event(event)),
        )

    return _run_finished(run)


def _thresholds(command: StartTagging) -> MatchingThresholds:
    """Sans seuils dans la commande, ceux du sidecar : une valeur, une source."""
    sent = command.thresholds
    return DEFAULT_THRESHOLDS if sent is None else sent.to_matching()


def to_protocol_event(event: tagging.RunEvent) -> Event:
    """Traduit un evenement du pipeline. Un cas oublie est une erreur de typage."""
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
            return _arbitration(event.record)
        case tagging.RunProgress():
            return Progress(
                event="progress",
                phase=Phase.TAGGING,
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


def _arbitration(record: TrackRecord) -> ArbitrationRequired:
    arbitration = record.arbitration
    if arbitration is None:
        logger.error("track without arbitration track=%s", record.track_id)
        raise ValueError("track without arbitration")
    return ArbitrationRequired(
        event="arbitration_required",
        track_id=record.track_id,
        source=arbitration.source,
        beatport_unavailable=arbitration.beatport_unavailable,
        candidates=tuple(
            CandidatePayload(
                artist=credited_artists(scored.candidate),
                title=full_title(scored.candidate),
                scores=_scores(scored),
            )
            for scored in arbitration.candidates
        ),
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
