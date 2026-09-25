"""Pipeline de resolution d'un run de re-tagging (use-case 2).

Orchestre `files`, `matching`, `scraper_client` et `cache` sans rien reimplementer,
et ignore le protocole NDJSON : les evenements sortent par un rappel, que le handler
traduit. Aucun fichier musical n'est ecrit ici (ADR-010).
"""

import asyncio
import logging
import secrets
from dataclasses import dataclass, replace
from enum import UNIQUE, StrEnum, auto, verify
from typing import TYPE_CHECKING, ClassVar, Final

import sentry_sdk

from tagger.cache import ArtworkUnavailableError
from tagger.errors import TaggerError
from tagger.files import IdentityTags, TagsUnreadableError, list_audio_files, read_identity
from tagger.matching import (
    DEFAULT_THRESHOLDS,
    MatchingThresholds,
    Outcome,
    ScoredCandidate,
    TrackQuery,
    build_query,
    classify,
)
from tagger.scraper_client import (
    ApiContractError,
    ApiKeyRejectedError,
    Source,
    SourceUnavailableError,
    TrackNotFoundError,
)

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable
    from pathlib import Path

    from tagger.cache import ArtworkFetcher
    from tagger.scraper_client import TechnoScraperClient, TrackCandidate

logger = logging.getLogger(__name__)

# Trois 403 consecutifs arretent le run (ARCHITECTURE.md § Cle API invalide ou revoquee).
API_KEY_REJECTION_LIMIT: Final = 3


@verify(UNIQUE)
class TrackState(StrEnum):
    """Etat d'un morceau apres la phase reseau. La Feature 5 ajoutera l'ecriture."""

    RESOLVED = auto()
    UNRESOLVED = auto()


@verify(UNIQUE)
class Resolution(StrEnum):
    """Par quel chemin un morceau a ete resolu, `none` pour un non resolu."""

    AUTO = auto()
    ARBITRATION = auto()
    URL = auto()
    NONE = auto()


@verify(UNIQUE)
class FailureReason(StrEnum):
    """Motif d'un non resolu : la correction a apporter n'est pas la meme."""

    EMPTY_QUERY = auto()
    NO_RESULT = auto()
    BELOW_THRESHOLD = auto()
    USER_REFUSED = auto()
    SOURCE_UNAVAILABLE = auto()


@dataclass(frozen=True, slots=True)
class PendingArbitration:
    """Candidats en zone grise d'une source, en attente d'une decision humaine."""

    source: Source
    candidates: tuple[ScoredCandidate, ...]
    beatport_unavailable: bool


@dataclass(frozen=True, slots=True)
class TrackRecord:
    """Tout ce que le run sait d'un morceau. `state` vide : en attente d'arbitrage ou en cours."""

    track_id: str
    path: Path
    identity: IdentityTags
    query: TrackQuery | None = None
    state: TrackState | None = None
    resolution: Resolution | None = None
    failure_reason: FailureReason | None = None
    source: Source | None = None
    candidate: TrackCandidate | None = None
    scored: ScoredCandidate | None = None
    artwork: Path | None = None
    arbitration: PendingArbitration | None = None

    @property
    def file_name(self) -> str:
        """Nom du fichier, sous-texte de la colonne Avant."""
        return self.path.name


@dataclass(frozen=True, slots=True)
class TaggingRun:
    """Etat complet d'un run en fin de phase reseau, que la Feature 6 persistera."""

    run_id: str
    folder: Path
    tracks: tuple[TrackRecord, ...]


@dataclass(frozen=True, slots=True)
class RunStarted:
    """Tous les morceaux du run avec leur identite lue, avant le premier appel reseau."""

    run_id: str
    tracks: tuple[TrackRecord, ...]


@dataclass(frozen=True, slots=True)
class TrackResolved:
    """Un morceau resolu ou non resolu."""

    record: TrackRecord


@dataclass(frozen=True, slots=True)
class ArbitrationRequired:
    """Un morceau mis en attente d'une decision humaine."""

    record: TrackRecord


@dataclass(frozen=True, slots=True)
class RunProgress:
    """Morceaux traites : resolus, non resolus ou en attente d'arbitrage."""

    processed: int
    total: int


type RunEvent = RunStarted | TrackResolved | ArbitrationRequired | RunProgress


class ApiKeyRejectedRunError(TaggerError):
    """Run arrete apres trois 403 consecutifs : la cle est a corriger dans les Settings."""

    code: ClassVar[str] = "api_key_rejected"

    def __init__(self) -> None:
        super().__init__("run stopped after repeated api key rejections")


async def run_tagging(
    folder: Path,
    *,
    client: TechnoScraperClient,
    artworks: ArtworkFetcher,
    on_event: Callable[[RunEvent], None],
    thresholds: MatchingThresholds = DEFAULT_THRESHOLDS,
) -> TaggingRun:
    """Resout tous les morceaux du dossier et rend l'etat du run.

    Le pipeline ne s'arrete jamais sur un morceau : une zone grise est mise en
    attente, un incident devient un motif d'echec. Seuls trois 403 consecutifs
    arretent le run, par `ApiKeyRejectedRunError`.
    """
    paths = await asyncio.to_thread(list_audio_files, folder)
    run_id = secrets.token_hex(3)
    records = await _read_identities(run_id, folder, paths)
    on_event(RunStarted(run_id, tuple(records)))

    runner = _Runner(run_id, len(records), client, artworks, thresholds, on_event)
    try:
        async with asyncio.TaskGroup() as group:
            tasks = [
                group.create_task(runner.process(position, record), name=f"track:{position}")
                for position, record in enumerate(records, start=1)
            ]
    except* ApiKeyRejectedRunError:
        raise ApiKeyRejectedRunError from None

    return TaggingRun(run_id, folder, tuple(task.result() for task in tasks))


async def _read_identities(run_id: str, folder: Path, paths: tuple[Path, ...]) -> list[TrackRecord]:
    """Identites lues avant tout appel reseau : la liste s'affiche entiere des le depart.

    Les lectures partent en parallele sur le pool de threads : enchainees, plusieurs
    centaines d'ouvertures de fichier tenaient la liste vide pendant des secondes.
    `return_exceptions=True` garde chaque tag illisible local a son morceau, la
    seule erreur qui doive arreter le run etant celle de `list_audio_files`, deja levee.
    """
    reads = await asyncio.gather(
        *(asyncio.to_thread(read_identity, path) for path in paths), return_exceptions=True
    )
    records: list[TrackRecord] = []
    for position, (path, read) in enumerate(zip(paths, reads, strict=True), start=1):
        match read:
            case IdentityTags():
                identity = read
            case TagsUnreadableError():
                logger.warning(
                    "tags unreadable, file name used run=%s track=%d reason=%s",
                    run_id,
                    position,
                    read.reason,
                )
                identity = IdentityTags(artist="", title="")
            case _:
                raise read
        track_id = path.relative_to(folder).as_posix()
        records.append(TrackRecord(track_id=track_id, path=path, identity=identity))
    return records


class _RejectionGuard:
    """Compte les 403 consecutifs, remis a zero par toute autre reponse de l'API."""

    def __init__(self) -> None:
        self._consecutive = 0

    def rejected(self) -> None:
        """Un 403 de plus ; au troisieme d'affilee, le run s'arrete."""
        self._consecutive += 1
        if self._consecutive >= API_KEY_REJECTION_LIMIT:
            raise ApiKeyRejectedRunError()

    def answered(self) -> None:
        """Toute reponse de l'API qui n'est pas un 403 prouve que la cle est acceptee."""
        self._consecutive = 0


class _Runner:
    """Etat partage par les taches d'un run : compteur et garde."""

    def __init__(
        self,
        run_id: str,
        total: int,
        client: TechnoScraperClient,
        artworks: ArtworkFetcher,
        thresholds: MatchingThresholds,
        on_event: Callable[[RunEvent], None],
    ) -> None:
        self._run_id = run_id
        self._total = total
        self._client = client
        self._artworks = artworks
        self._thresholds = thresholds
        self._on_event = on_event
        self._guard = _RejectionGuard()
        self._processed = 0

    async def process(self, position: int, record: TrackRecord) -> TrackRecord:
        done = await self._resolve(position, record)
        event = ArbitrationRequired(done) if done.arbitration else TrackResolved(done)
        self._on_event(event)
        self._processed += 1
        self._on_event(RunProgress(self._processed, self._total))
        return done

    # PLR0911 : une sortie par issue de la cascade (deux sources, trois classements
    # chacune) est plus lisible qu'un decoupage en sous-fonctions qui eclaterait l'etat.
    async def _resolve(self, position: int, record: TrackRecord) -> TrackRecord:  # noqa: PLR0911
        identity = record.identity
        query = build_query(identity.artist, identity.title, record.file_name)
        if query is None:
            return self._unresolved(position, record, FailureReason.EMPTY_QUERY)
        record = replace(record, query=query)

        beatport_unavailable = False
        had_candidates = False
        try:
            found = await self._call(self._client.search(Source.BEATPORT, query.text))
        except ApiKeyRejectedError:
            return self._unresolved(position, record, FailureReason.SOURCE_UNAVAILABLE)
        except (SourceUnavailableError, ApiContractError) as exc:
            self._log_source_failure(position, Source.BEATPORT, exc)
            beatport_unavailable = True
        else:
            had_candidates = bool(found)
            classification = classify(query, found, self._thresholds)
            match classification.outcome:
                case Outcome.AUTO:
                    return await self._accept(
                        position, record, Source.BEATPORT, classification.retained[0]
                    )
                case Outcome.GREY_ZONE:
                    return self._hold(
                        position,
                        record,
                        Source.BEATPORT,
                        classification.retained,
                        beatport_unavailable=False,
                    )
                case Outcome.EMPTY:
                    pass

        try:
            found = await self._call(self._client.search(Source.BANDCAMP, query.text))
        except ApiKeyRejectedError:
            return self._unresolved(position, record, FailureReason.SOURCE_UNAVAILABLE)
        except (SourceUnavailableError, ApiContractError) as exc:
            self._log_source_failure(position, Source.BANDCAMP, exc)
            return self._unresolved(position, record, FailureReason.SOURCE_UNAVAILABLE)
        had_candidates = had_candidates or bool(found)
        # Beatport injoignable : Bandcamp ne valide jamais seul (decision du 2026-09-19).
        classification = classify(
            query, found, self._thresholds, allow_auto=not beatport_unavailable
        )
        match classification.outcome:
            case Outcome.AUTO:
                return await self._accept(
                    position, record, Source.BANDCAMP, classification.retained[0]
                )
            case Outcome.GREY_ZONE:
                return self._hold(
                    position,
                    record,
                    Source.BANDCAMP,
                    classification.retained,
                    beatport_unavailable=beatport_unavailable,
                )
            case _:
                # `Outcome.EMPTY` en pratique : `case _` rend le match provablement
                # exhaustif pour mypy, qui sinon signale un retour manquant (StrEnum).
                reason = (
                    FailureReason.BELOW_THRESHOLD if had_candidates else FailureReason.NO_RESULT
                )
                return self._unresolved(position, record, reason)

    async def _accept(
        self, position: int, record: TrackRecord, source: Source, chosen: ScoredCandidate
    ) -> TrackRecord:
        candidate = await self._refetch(position, source, chosen.candidate)
        artwork = await self._artwork(position, candidate)
        logger.info(
            "candidate retained run=%s track=%d source=%s score=%.0f status=resolved",
            self._run_id,
            position,
            source,
            chosen.score,
        )
        return replace(
            record,
            state=TrackState.RESOLVED,
            resolution=Resolution.AUTO,
            source=source,
            candidate=candidate,
            scored=chosen,
            artwork=artwork,
        )

    def _hold(
        self,
        position: int,
        record: TrackRecord,
        source: Source,
        candidates: tuple[ScoredCandidate, ...],
        *,
        beatport_unavailable: bool,
    ) -> TrackRecord:
        logger.info(
            "arbitration required run=%s track=%d source=%s score=%.0f status=grey_zone",
            self._run_id,
            position,
            source,
            candidates[0].score,
        )
        return replace(
            record, arbitration=PendingArbitration(source, candidates, beatport_unavailable)
        )

    def _unresolved(self, position: int, record: TrackRecord, reason: FailureReason) -> TrackRecord:
        logger.info(
            "track unresolved run=%s track=%d status=unresolved reason=%s",
            self._run_id,
            position,
            reason,
        )
        return replace(
            record,
            state=TrackState.UNRESOLVED,
            resolution=Resolution.NONE,
            failure_reason=reason,
        )

    async def _refetch(
        self, position: int, source: Source, candidate: TrackCandidate
    ) -> TrackCandidate:
        """Metadonnees completes ; l'objet de recherche est garde si le refetch echoue."""
        try:
            match source:
                case Source.BEATPORT if candidate.id:
                    return await self._call(self._client.fetch_beatport_track(candidate.id))
                case Source.BANDCAMP if candidate.url:
                    return await self._call(self._client.fetch_bandcamp_track(candidate.url))
                case _:
                    return candidate
        except (
            ApiKeyRejectedError,
            SourceUnavailableError,
            TrackNotFoundError,
            ApiContractError,
        ) as exc:
            logger.warning(
                "refetch failed, search candidate kept run=%s track=%d source=%s reason=%s",
                self._run_id,
                position,
                source,
                exc.code,
            )
            return candidate

    async def _artwork(self, position: int, candidate: TrackCandidate) -> Path | None:
        url = candidate.release.artwork_url if candidate.release else None
        if url is None:
            return None
        try:
            return await self._artworks.fetch(url)
        except ArtworkUnavailableError as exc:
            logger.warning(
                "artwork unavailable run=%s track=%d reason=%s",
                self._run_id,
                position,
                exc.reason,
            )
            return None

    async def _call[T](self, request: Awaitable[T]) -> T:
        """Passe chaque appel par la garde des 403 et remonte un contrat casse a Sentry."""
        try:
            result = await request
        except ApiKeyRejectedError:
            self._guard.rejected()
            raise
        except ApiContractError as exc:
            self._guard.answered()
            logger.exception(
                "api contract broken run=%s request_id=%s", self._run_id, exc.request_id
            )
            sentry_sdk.capture_exception(exc)
            raise
        except SourceUnavailableError as exc:
            # Une erreur reseau n'est pas une reponse : elle ne remet pas la garde a zero.
            if exc.status is not None:
                self._guard.answered()
            raise
        except TrackNotFoundError:
            self._guard.answered()
            raise
        self._guard.answered()
        return result

    def _log_source_failure(
        self,
        position: int,
        source: Source,
        exc: SourceUnavailableError | ApiContractError,
    ) -> None:
        # ApiContractError est deja loguee et remontee a Sentry par `_call` : sans ce
        # log, c'est une source injoignable qui ne laisserait aucune trace.
        if isinstance(exc, SourceUnavailableError):
            logger.warning(
                "source unavailable run=%s track=%d source=%s status=%s reason=%s request_id=%s",
                self._run_id,
                position,
                source,
                exc.status,
                exc.reason,
                exc.request_id,
            )
