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
from typing import TYPE_CHECKING, override

from tagger.files import IdentityTags, TagsUnreadableError, list_audio_files, read_identity
from tagger.matching import (
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
)
from tagger.sources import ApiKeyRejectedRunError

if TYPE_CHECKING:
    from collections.abc import Callable, Sequence
    from pathlib import Path

    from tagger.scraper_client import TrackCandidate
    from tagger.sources import RunSources

logger = logging.getLogger(__name__)


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
class SourceList:
    """Liste d'une source mise de cote pendant qu'une autre est affichee."""

    source: Source
    candidates: tuple[ScoredCandidate, ...]
    empty_reason: FailureReason | None = None


@dataclass(frozen=True, slots=True)
class PendingArbitration:
    """Candidats de la source affichee ; `other` evite de rappeler l'API au retour arriere,
    `empty_reason` dit pourquoi une liste Bandcamp est vide."""

    source: Source
    candidates: tuple[ScoredCandidate, ...]
    beatport_unavailable: bool
    empty_reason: FailureReason | None = None
    other: SourceList | None = None


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

    def resolved(
        self,
        resolution: Resolution,
        source: Source,
        candidate: TrackCandidate,
        scored: ScoredCandidate | None,
        artwork: Path | None,
    ) -> TrackRecord:
        """Morceau resolu, sorti de l'attente d'arbitrage s'il y etait.

        `scored` nul : une URL collee n'a traverse aucun scoring. Le motif d'echec tombe,
        un non resolu rattrape ne doit pas garder son `no_result`.
        """
        return replace(
            self,
            state=TrackState.RESOLVED,
            resolution=resolution,
            failure_reason=None,
            source=source,
            candidate=candidate,
            scored=scored,
            artwork=artwork,
            arbitration=None,
        )

    def unresolved(self, reason: FailureReason) -> TrackRecord:
        """Morceau non resolu, sorti de l'attente d'arbitrage s'il y etait."""
        return replace(
            self,
            state=TrackState.UNRESOLVED,
            resolution=Resolution.NONE,
            failure_reason=reason,
            arbitration=None,
        )


@dataclass(frozen=True, slots=True)
class TaggingRun:
    """Etat gele d'un run."""

    run_id: str
    folder: Path
    tracks: tuple[TrackRecord, ...]


class LiveRun:
    """Etat vivant d'un run : l'arbitrage y tranche apres la phase reseau, jusqu'au run suivant."""

    def __init__(self, run_id: str, folder: Path, records: Sequence[TrackRecord]) -> None:
        self.run_id = run_id
        self.folder = folder
        self._records = {record.track_id: record for record in records}
        self._positions = {
            record.track_id: position for position, record in enumerate(records, start=1)
        }

    @override
    def __repr__(self) -> str:
        return f"LiveRun(run_id={self.run_id!r}, tracks={len(self._records)})"

    def record(self, track_id: str) -> TrackRecord | None:
        return self._records.get(track_id)

    def position(self, track_id: str) -> int:
        """Rang du morceau dans le dossier, la cle `track` des logs."""
        return self._positions[track_id]

    def update(self, record: TrackRecord) -> None:
        self._records[record.track_id] = record

    def snapshot(self) -> TaggingRun:
        return TaggingRun(self.run_id, self.folder, tuple(self._records.values()))


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


async def open_run(folder: Path, *, on_event: Callable[[RunEvent], None]) -> LiveRun:
    """Liste les fichiers et lit leur identite, avant tout appel reseau."""
    paths = await asyncio.to_thread(list_audio_files, folder)
    run_id = secrets.token_hex(3)
    records = await _read_identities(run_id, folder, paths)
    on_event(RunStarted(run_id, tuple(records)))
    return LiveRun(run_id, folder, records)


async def resolve_run(
    live: LiveRun, sources: RunSources, *, on_event: Callable[[RunEvent], None]
) -> None:
    """Ne s'arrete jamais sur un morceau : seuls trois 403 consecutifs arretent le run."""
    tracks = live.snapshot().tracks
    runner = _Runner(len(tracks), sources, live, on_event)
    try:
        async with asyncio.TaskGroup() as group:
            for position, record in enumerate(tracks, start=1):
                group.create_task(runner.process(position, record), name=f"track:{position}")
    except* ApiKeyRejectedRunError:
        raise ApiKeyRejectedRunError from None


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


class _Runner:
    """Etat partage par les taches d'un run : compteur et acces aux sources."""

    def __init__(
        self,
        total: int,
        sources: RunSources,
        live: LiveRun,
        on_event: Callable[[RunEvent], None],
    ) -> None:
        self._total = total
        self._sources = sources
        self._live = live
        self._on_event = on_event
        self._processed = 0

    async def process(self, position: int, record: TrackRecord) -> None:
        done = await self._resolve(position, record)
        self._live.update(done)
        event = ArbitrationRequired(done) if done.arbitration else TrackResolved(done)
        self._on_event(event)
        self._processed += 1
        self._on_event(RunProgress(self._processed, self._total))

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
            found = await self._sources.search(Source.BEATPORT, query)
        except ApiKeyRejectedError:
            return self._unresolved(position, record, FailureReason.SOURCE_UNAVAILABLE)
        except (SourceUnavailableError, ApiContractError) as exc:
            self._sources.log_source_failure(position, Source.BEATPORT, exc)
            beatport_unavailable = True
        else:
            had_candidates = bool(found)
            classification = classify(query, found, self._sources.thresholds)
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
            found = await self._sources.search(Source.BANDCAMP, query)
        except ApiKeyRejectedError:
            return self._unresolved(position, record, FailureReason.SOURCE_UNAVAILABLE)
        except (SourceUnavailableError, ApiContractError) as exc:
            self._sources.log_source_failure(position, Source.BANDCAMP, exc)
            return self._unresolved(position, record, FailureReason.SOURCE_UNAVAILABLE)
        had_candidates = had_candidates or bool(found)
        # Beatport injoignable : Bandcamp ne valide jamais seul (decision du 2026-09-19).
        classification = classify(
            query, found, self._sources.thresholds, allow_auto=not beatport_unavailable
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
        candidate, artwork = await self._sources.retained(position, source, chosen)
        logger.info(
            "candidate retained run=%s track=%d source=%s score=%.0f status=resolved",
            self._sources.run_id,
            position,
            source,
            chosen.score,
        )
        return record.resolved(Resolution.AUTO, source, candidate, chosen, artwork)

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
            self._sources.run_id,
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
            self._sources.run_id,
            position,
            reason,
        )
        return record.unresolved(reason)
