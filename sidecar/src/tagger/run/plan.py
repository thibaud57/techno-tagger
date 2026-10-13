"""Plan de run : chaque decision d'un run, persistee au fil de l'eau avant tout fichier
ecrit (ADR-010), relue pour la reprise et purgee au demarrage.

Deux politiques de version voisines, a ne pas aligner (ADR-018) : le plan, jetable sous
30 jours, refuse une version inconnue ; le rapport, permanent, se migre.
"""

import asyncio
import copy
import logging
from pathlib import Path
from typing import TYPE_CHECKING, ClassVar, Final, Self, override

from pydantic import AwareDatetime, BaseModel, ConfigDict, model_validator

from tagger.core.errors import TaggerError
from tagger.core.paths import app_data_dir
from tagger.core.run_files import (
    PENDING_SUFFIX,
    exact_version,
    find_by_run_id,
    newest_first,
    purge_stamped,
    read_versioned,
    stamped_name,
    unlink_logged,
    write_atomically,
)
from tagger.resolution.matching import (
    MatchingThresholds,
    QueryOrigin,
    ScoredCandidate,
    TrackQuery,
    check_thresholds,
)
from tagger.resolution.scraper_client import Source, TrackCandidate
from tagger.run.tagging import (
    FailureReason,
    PendingArbitration,
    Resolution,
    SourceList,
    TrackState,
    is_decided,
)

if TYPE_CHECKING:
    from datetime import datetime

    from tagger.run.tagging import LiveRun, TrackFailureReason, TrackRecord

logger = logging.getLogger(__name__)

SCHEMA_VERSION: Final = 1
_SUFFIX: Final = ".json"


class _PlanModel(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class PlanQuery(_PlanModel):
    artist: str
    title: str
    origin: QueryOrigin

    @classmethod
    def of(cls, query: TrackQuery) -> Self:
        return cls(artist=query.artist, title=query.title, origin=query.origin)

    def to_query(self) -> TrackQuery:
        return TrackQuery(self.artist, self.title, self.origin)


class PlanScores(_PlanModel):
    """Scores bruts, non arrondis : la reprise les rend tels que le scoring les a calcules."""

    artist: float | None
    title: float
    average: float
    version_mismatch: bool
    number_mismatch: bool

    @classmethod
    def of(cls, scored: ScoredCandidate) -> Self:
        return cls(
            artist=scored.artist_score,
            title=scored.title_score,
            average=scored.score,
            version_mismatch=scored.version_mismatch,
            number_mismatch=scored.number_mismatch,
        )

    def applied_to(self, candidate: TrackCandidate) -> ScoredCandidate:
        return ScoredCandidate(
            candidate,
            self.artist,
            self.title,
            self.average,
            version_mismatch=self.version_mismatch,
            number_mismatch=self.number_mismatch,
        )


class PlanScored(_PlanModel):
    candidate: TrackCandidate
    scores: PlanScores

    @classmethod
    def of(cls, scored: ScoredCandidate) -> Self:
        return cls(candidate=scored.candidate, scores=PlanScores.of(scored))

    def to_scored(self) -> ScoredCandidate:
        return self.scores.applied_to(self.candidate)


class PlanSourceList(_PlanModel):
    source: Source
    candidates: tuple[PlanScored, ...]
    empty_reason: FailureReason | None = None

    @classmethod
    def of(cls, kept: SourceList) -> Self:
        return cls(
            source=kept.source,
            candidates=tuple(PlanScored.of(scored) for scored in kept.candidates),
            empty_reason=kept.empty_reason,
        )

    def to_source_list(self) -> SourceList:
        return SourceList(
            self.source,
            tuple(scored.to_scored() for scored in self.candidates),
            self.empty_reason,
        )


class PlanArbitration(_PlanModel):
    """Listes deja obtenues : la reprise repropose l'arbitrage sans rappeler l'API."""

    source: Source
    candidates: tuple[PlanScored, ...]
    beatport_unavailable: bool
    empty_reason: FailureReason | None = None
    other: PlanSourceList | None = None

    @classmethod
    def of(cls, pending: PendingArbitration) -> Self:
        return cls(
            source=pending.source,
            candidates=tuple(PlanScored.of(scored) for scored in pending.candidates),
            beatport_unavailable=pending.beatport_unavailable,
            empty_reason=pending.empty_reason,
            other=None if pending.other is None else PlanSourceList.of(pending.other),
        )

    def to_pending(self) -> PendingArbitration:
        return PendingArbitration(
            self.source,
            tuple(scored.to_scored() for scored in self.candidates),
            self.beatport_unavailable,
            self.empty_reason,
            None if self.other is None else self.other.to_source_list(),
        )


class PlanThresholds(_PlanModel):
    """Seuils du run : la reprise classe les morceaux restants comme les premiers."""

    floor: float
    ceiling: float

    @model_validator(mode="after")
    def _within_bounds(self) -> Self:
        # Un plan aux seuils incoherents est illisible des la relecture, pas en pleine reprise.
        check_thresholds(self.floor, self.ceiling)
        return self

    def to_matching(self) -> MatchingThresholds:
        return MatchingThresholds(floor=self.floor, ceiling=self.ceiling)


class PlanTrack(_PlanModel):
    """Ce que le run a decide d'un morceau. Ni pochette (cache jetable, ADR-013), ni tags lus
    sur un fichier qui n'a pas bouge, ni rien de l'ecriture, que le plan ne suit plus."""

    state: TrackState | None = None
    resolution: Resolution | None = None
    failure_reason: FailureReason | None = None
    source: Source | None = None
    query: PlanQuery | None = None
    candidate: TrackCandidate | None = None
    scores: PlanScores | None = None
    arbitration: PlanArbitration | None = None

    @property
    def processed(self) -> bool:
        """Meme regle que `TrackRecord.decided`."""
        return is_decided(self.state, self.failure_reason, on_hold=self.arbitration is not None)

    @classmethod
    def of(cls, record: TrackRecord) -> Self:
        query, scored, pending = record.query, record.scored, record.arbitration
        return cls(
            state=record.state,
            resolution=record.resolution,
            failure_reason=_network_reason(record.failure_reason),
            source=record.source,
            query=None if query is None else PlanQuery.of(query),
            candidate=record.candidate,
            scores=None if scored is None else PlanScores.of(scored),
            arbitration=None if pending is None else PlanArbitration.of(pending),
        )

    def applied_to(self, record: TrackRecord) -> TrackRecord:
        """Decision du plan posee sur le morceau relu ; sa pochette se retelecharge a part."""
        candidate, scores = self.candidate, self.scores
        return copy.replace(
            record,
            state=self.state,
            resolution=self.resolution,
            failure_reason=self.failure_reason,
            source=self.source,
            query=None if self.query is None else self.query.to_query(),
            candidate=candidate,
            scored=None if scores is None or candidate is None else scores.applied_to(candidate),
            arbitration=None if self.arbitration is None else self.arbitration.to_pending(),
        )


class RunPlan(_PlanModel):
    """Plan tel qu'il est ecrit sur le disque, morceaux par `track_id` dans l'ordre du dossier."""

    schema_version: int = SCHEMA_VERSION
    run_id: str
    folder: Path
    started_at: AwareDatetime
    thresholds: PlanThresholds
    # Frontiere de la reprise : un run confirme a pu toucher des fichiers, il ne se reprend pas.
    committed: bool = False
    tracks: dict[str, PlanTrack]

    @classmethod
    def opened(cls, live: LiveRun, thresholds: MatchingThresholds, started_at: datetime) -> Self:
        return cls(
            run_id=live.run_id,
            folder=live.folder,
            started_at=started_at,
            thresholds=PlanThresholds(floor=thresholds.floor, ceiling=thresholds.ceiling),
            tracks={record.track_id: PlanTrack.of(record) for record in live.snapshot().tracks},
        )

    def with_track(self, record: TrackRecord) -> Self:
        """Le morceau garde sa place : une cle existante ne change pas de rang dans un dict."""
        return self.model_copy(
            update={"tracks": {**self.tracks, record.track_id: PlanTrack.of(record)}}
        )

    def processed_count(self) -> int:
        """Calcule et non stocke : un compteur ecrit a cote des morceaux finirait par deriver."""
        return sum(1 for track in self.tracks.values() if track.processed)


class RunPlanUnreadableError(TaggerError):
    """Plan illisible ou d'une version de schema inconnue, jamais migre."""

    code: ClassVar[str] = "run_plan_unreadable"

    def __init__(self, path: Path, found: int | str | None = None) -> None:
        self.found = found
        super().__init__(
            f"unreadable run plan: {path.name}",
            file=path.name,
            found=found,
            expected=SCHEMA_VERSION,
        )


def plan_dir() -> Path:
    return app_data_dir() / "plans"


def plan_path(folder: Path, plan: RunPlan) -> Path:
    return folder / stamped_name(plan.started_at, plan.run_id, _SUFFIX)


def plans_newest_first(folder: Path) -> list[Path]:
    return newest_first(folder, _SUFFIX)


def find_plan(folder: Path, run_id: str) -> Path | None:
    return find_by_run_id(folder, _SUFFIX, run_id)


def load_plan(path: Path) -> RunPlan:
    """Relit un plan ; une version inconnue est refusee, jamais migree."""
    return read_versioned(path, RunPlan, exact_version(SCHEMA_VERSION), RunPlanUnreadableError)


def discard_plan(path: Path) -> None:
    """Un plan impossible a supprimer sera repropose au lancement suivant : rien n'est perdu."""
    unlink_logged(path, "run plan not discarded")


class PlanRecorder:
    """Tient le plan d'un run et le vide sur le disque hors de la boucle.

    Une seule tache de vidage a la fois : elle ecrit le dernier etat, puis repart tant qu'un
    changement est arrive pendant l'ecriture. Une rafale de decisions ne coute que quelques
    ecritures, jamais deux en parallele. Le plan est un filet : un echec d'ecriture se logue
    et se retente, il n'arrete jamais le run.
    """

    def __init__(self, plan: RunPlan, folder: Path) -> None:
        self._plan = plan
        self._path = plan_path(folder, plan)
        self._dirty = True
        self._discarded = False
        self._flushing: asyncio.Task[None] | None = None

    @override
    def __repr__(self) -> str:
        return f"PlanRecorder(run_id={self._plan.run_id!r}, committed={self._plan.committed})"

    @property
    def plan(self) -> RunPlan:
        return self._plan

    def record(self, record: TrackRecord) -> None:
        """Observateur de `LiveRun.update` ; ecriture, relance et rollback ne changent rien."""
        if self._plan.committed or self._discarded:
            return
        self._plan = self._plan.with_track(record)
        self._wake()

    async def flush(self) -> None:
        """Attend que le disque porte l'etat courant ; un echec est logue, jamais leve.

        `shield` : l'ecriture va a son terme meme si l'appelant est annule (`shutdown`).
        """
        if self._dirty:
            self._wake()
        if self._flushing is not None:
            await asyncio.shield(self._flushing)

    async def commit(self) -> None:
        """Confirme le plan sur le disque avant que le premier fichier musical ne soit ecrit."""
        await self._set_committed(committed=True)

    async def reopen(self) -> None:
        """Le dump a echoue sans toucher aucun fichier : le run redevient confirmable."""
        await self._set_committed(committed=False)

    async def discard(self) -> None:
        """Run remplace avant sa confirmation : son plan part, plus rien ne l'ecrit.

        Un plan confirme reste a la purge du demarrage, comme tout run termine.
        """
        if self._plan.committed:
            return
        self._discarded = True
        if self._flushing is not None:
            await asyncio.shield(self._flushing)
        await asyncio.to_thread(discard_plan, self._path)

    async def _set_committed(self, *, committed: bool) -> None:
        self._plan = self._plan.model_copy(update={"committed": committed})
        self._wake()
        await self.flush()

    def _wake(self) -> None:
        self._dirty = True
        if self._discarded:
            return
        if self._flushing is None or self._flushing.done():
            self._flushing = asyncio.create_task(self._drain(), name=f"plan:{self._plan.run_id}")

    async def _drain(self) -> None:
        while self._dirty and not self._discarded:
            self._dirty = False
            plan = self._plan
            try:
                await asyncio.to_thread(_write, self._path, plan)
            except OSError as exc:
                # Reste a ecrire : le prochain `flush` ou la prochaine decision retente.
                self._dirty = True
                logger.error(  # noqa: TRY400  (une trace porterait le chemin complet)
                    "run plan not written run=%s reason=write_failed errno=%s",
                    plan.run_id,
                    exc.errno,
                )
                return


def purge_plans(folder: Path, now: datetime) -> None:
    """Supprime les plans qui ne serviront plus : confirmes, ou passes les 30 jours.

    Un plan illisible ou d'une version inconnue reste jusqu'a ses 30 jours : la reprise doit
    pouvoir dire pourquoi elle ne reprend pas. Un temporaire n'a aucun ecrivain au demarrage
    (instance unique) : c'est le reste d'une ecriture coupee.
    """
    purge_stamped(
        folder,
        (_SUFFIX, PENDING_SUFFIX),
        now,
        "run plan not purged",
        also_drop=lambda path: path.suffix == PENDING_SUFFIX or _committed(path),
    )


def _write(path: Path, plan: RunPlan) -> None:
    """Serialise ici et non dans la boucle : le plan est `frozen`, le thread le lit sans risque."""
    write_atomically(path, plan.model_dump_json(indent=2))


def _committed(path: Path) -> bool:
    try:
        return load_plan(path).committed
    except RunPlanUnreadableError:
        return False


def _network_reason(reason: TrackFailureReason | None) -> FailureReason | None:
    """Un motif de fichier n'apparait qu'apres la confirmation, que le plan ne suit plus."""
    return reason if isinstance(reason, FailureReason) else None
