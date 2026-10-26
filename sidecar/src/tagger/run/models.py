"""Etat d'un run de re-tagging : enums d'issue, fiche d'un morceau, run gele ou vivant,
evenements internes du pipeline. Aucun appel reseau ni fichier : le pipeline vit dans
`run/tagging.py`.
"""

import copy
from dataclasses import dataclass
from enum import UNIQUE, StrEnum, auto, verify
from typing import TYPE_CHECKING, ClassVar, Literal, TypeIs, assert_never, override

from tagger.core.file_failures import FileFailureReason

if TYPE_CHECKING:
    from collections.abc import Callable, Sequence
    from pathlib import Path

    from tagger.core.identifiers import RunId, TrackId
    from tagger.resolution.matching import ScoredCandidate, TrackQuery
    from tagger.resolution.scraper_client import Source, TrackCandidate
    from tagger.tags.files import IdentityTags, ShownTags, WrittenTags


@verify(UNIQUE)
class TrackState(StrEnum):
    """Etat d'un morceau, apres la phase reseau, l'ecriture ou un rollback."""

    RESOLVED = auto()
    UNRESOLVED = auto()
    WRITTEN = auto()
    WRITE_ERROR = auto()
    ROLLED_BACK = auto()


@verify(UNIQUE)
class Resolution(StrEnum):
    """Par quel chemin un morceau a ete resolu, `none` pour un non resolu."""

    AUTO = auto()
    ARBITRATION = auto()
    URL = auto()
    NONE = auto()


@verify(UNIQUE)
class FailureReason(StrEnum):
    """Motif d'un morceau non resolu, ou que le rollback n'a pas rendu : la correction a apporter
    n'est pas la meme. Les pannes de fichier sont `FileFailureReason`.
    """

    EMPTY_QUERY = auto()
    NO_RESULT = auto()
    BELOW_THRESHOLD = auto()
    USER_REFUSED = auto()
    SOURCE_UNAVAILABLE = auto()
    # Motif du rollback seul, hors `FileFailureReason` : l'ecriture suffixe un nom pris, alors que
    # la restauration refuse de l'ecraser. Y mettre `FileFailureReason` l'ouvrirait au rapport
    # d'extraction, qui ne le produit jamais.
    NAME_TAKEN = auto()


# Un seul champ `failure_reason` au protocole : les deux enums y partagent le meme espace de
# chaines, que `test_file_failures` garde disjoint.
type TrackFailureReason = FailureReason | FileFailureReason


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
class WriteOutcome:
    """Ce que l'ecriture a pose sur le fichier, pour le rapport."""

    written: WrittenTags
    truncated: bool


type ResolvedBy = Literal[Resolution.AUTO, Resolution.ARBITRATION, Resolution.URL]


@dataclass(frozen=True, slots=True)
class Retained:
    """Candidat retenu pour un morceau, de la resolution a l'ecriture.

    `scored` nul : une URL collee n'a traverse aucun scoring.
    """

    resolution: ResolvedBy
    source: Source
    candidate: TrackCandidate
    scored: ScoredCandidate | None
    artwork: Path | None

    @property
    def by_url(self) -> bool:
        return self.resolution is Resolution.URL


# Chaque issue porte ses projections (`state`, `resolution`, `failure_reason`, `restorable`,
# `recoverable`, `decided`) : `TrackRecord` les lit sans les deduire, un oubli casse au typage.
@dataclass(frozen=True, slots=True)
class Waiting:
    """Jamais traite."""

    state: ClassVar[None] = None
    resolution: ClassVar[None] = None
    failure_reason: ClassVar[None] = None
    restorable: ClassVar[bool] = False
    recoverable: ClassVar[bool] = False
    decided: ClassVar[bool] = False


@dataclass(frozen=True, slots=True)
class AwaitingArbitration:
    """Zone grise : une liste de candidats attend la decision humaine."""

    query: TrackQuery
    pending: PendingArbitration

    state: ClassVar[None] = None
    resolution: ClassVar[None] = None
    failure_reason: ClassVar[None] = None
    restorable: ClassVar[bool] = False
    recoverable: ClassVar[bool] = False
    decided: ClassVar[bool] = True


@dataclass(frozen=True, slots=True)
class Unresolved:
    """Aucun candidat retenu ; `query` nul pour `empty_query`."""

    query: TrackQuery | None
    reason: FailureReason

    state: ClassVar[TrackState] = TrackState.UNRESOLVED
    resolution: ClassVar[Resolution] = Resolution.NONE
    restorable: ClassVar[bool] = False
    recoverable: ClassVar[bool] = True

    @property
    def failure_reason(self) -> FailureReason:
        return self.reason

    @property
    def decided(self) -> bool:
        """Une source qui n'a pas repondu (`source_unavailable`) n'est pas une decision : le
        morceau repart sur le reseau a la reprise, une fois la panne ou la cle corrigee.
        """
        return self.reason is not FailureReason.SOURCE_UNAVAILABLE


@dataclass(frozen=True, slots=True)
class Resolved:
    """Candidat retenu, fichier intact ; `query` nul apres le rattrapage d'une requete vide.

    Aucun motif d'echec : un non resolu rattrape ne garde pas son `no_result`.
    """

    query: TrackQuery | None
    retained: Retained

    state: ClassVar[TrackState] = TrackState.RESOLVED
    failure_reason: ClassVar[None] = None
    restorable: ClassVar[bool] = False
    decided: ClassVar[bool] = True

    @property
    def resolution(self) -> ResolvedBy:
        return self.retained.resolution

    @property
    def recoverable(self) -> bool:
        return self.retained.by_url


@dataclass(frozen=True, slots=True)
class Written:
    """Ecrit sur le fichier. `restorable` : une entree au dump du run, l'origine est sauvegardee
    et un rollback a de quoi la rendre.
    """

    query: TrackQuery | None
    retained: Retained
    written: WriteOutcome
    restorable: bool

    state: ClassVar[TrackState] = TrackState.WRITTEN
    failure_reason: ClassVar[None] = None
    recoverable: ClassVar[bool] = False
    decided: ClassVar[bool] = True

    @property
    def resolution(self) -> ResolvedBy:
        return self.retained.resolution


@dataclass(frozen=True, slots=True)
class WriteFailed:
    """Ecriture en echec : le candidat reste, la relance n'a rien a redemander.

    `restorable` faux quand l'origine n'a jamais pu etre lue, donc jamais mise au dump.
    """

    query: TrackQuery | None
    retained: Retained
    reason: FileFailureReason
    restorable: bool

    state: ClassVar[TrackState] = TrackState.WRITE_ERROR
    recoverable: ClassVar[bool] = False
    decided: ClassVar[bool] = True

    @property
    def resolution(self) -> ResolvedBy:
        return self.retained.resolution

    @property
    def failure_reason(self) -> FileFailureReason:
        return self.reason


@dataclass(frozen=True, slots=True)
class RolledBack:
    """Rendu a son origine : plus rien du candidat, la ligne retombe sur le fichier.

    `resolution` reste, `resolved_event` l'exigeant : l'etat la masque a l'ecran.
    """

    resolution: ResolvedBy

    state: ClassVar[TrackState] = TrackState.ROLLED_BACK
    failure_reason: ClassVar[None] = None
    restorable: ClassVar[bool] = False
    recoverable: ClassVar[bool] = False
    decided: ClassVar[bool] = True


type Verdict = Unresolved | Resolved | AwaitingArbitration
type SettledOutcome = Unresolved | Resolved | Written | WriteFailed | RolledBack
type TrackOutcome = Waiting | AwaitingArbitration | SettledOutcome
# Ce que la phase reseau laisse : le plan s'arrete a la confirmation, avant toute ecriture.
type NetworkOutcome = Waiting | Verdict


@dataclass(frozen=True, slots=True)
class TrackRecord[O: TrackOutcome = TrackOutcome]:
    """Tout ce que le run sait d'un morceau ; `O` restreint l'issue pour qui en exige une."""

    track_id: TrackId
    path: Path
    identity: IdentityTags
    outcome: O
    # Pour l'affichage seul, `None` si illisibles : le dump relit le fichier.
    tags_before: ShownTags | None = None

    @property
    def file_name(self) -> str:
        """Nom du fichier, sous-texte de la colonne Avant."""
        return self.path.name

    @property
    def state(self) -> TrackState | None:
        return self.outcome.state

    @property
    def resolution(self) -> Resolution | None:
        """`none` pour un non resolu, nulle tant que rien n'est tranche."""
        return self.outcome.resolution

    @property
    def failure_reason(self) -> TrackFailureReason | None:
        return self.outcome.failure_reason

    @property
    def query(self) -> TrackQuery | None:
        # Elargit `O` pour que le `match` se ferme par `assert_never` sur l'union.
        outcome: TrackOutcome = self.outcome
        match outcome:
            case (
                AwaitingArbitration(query=query)
                | Unresolved(query=query)
                | Resolved(query=query)
                | Written(query=query)
                | WriteFailed(query=query)
            ):
                return query
            case Waiting() | RolledBack():
                return None
            case _:
                assert_never(outcome)

    @property
    def retained(self) -> Retained | None:
        outcome: TrackOutcome = self.outcome
        match outcome:
            case (
                Resolved(retained=retained)
                | Written(retained=retained)
                | WriteFailed(retained=retained)
            ):
                return retained
            case Waiting() | AwaitingArbitration() | Unresolved() | RolledBack():
                return None
            case _:
                assert_never(outcome)

    @property
    def restorable(self) -> bool:
        return self.outcome.restorable

    @property
    def recoverable(self) -> bool:
        """Regle unique du rattrapage par URL : un non resolu, ou un lien a corriger."""
        return self.outcome.recoverable

    @property
    def decided(self) -> bool:
        """Regle unique du « deja traite » : progression, reprise et pipeline selectif."""
        return self.outcome.decided

    def with_outcome[S: TrackOutcome](self, outcome: S) -> TrackRecord[S]:
        """Meme morceau, autre issue ; le chemin qui change passe par `copy.replace(..., path=)`."""
        # Champ par champ : `copy.replace` garderait le type d'issue d'origine.
        return TrackRecord(self.track_id, self.path, self.identity, outcome, self.tags_before)


def holds[S: TrackOutcome](record: TrackRecord, kind: type[S]) -> TypeIs[TrackRecord[S]]:
    """Retype la fiche sur son issue, sans la reconstruire."""
    return isinstance(record.outcome, kind)


def rolled_back(record: TrackRecord[Written | WriteFailed], path: Path) -> TrackRecord[RolledBack]:
    """Le fichier est de retour sous son nom d'origine."""
    outcome = RolledBack(record.outcome.retained.resolution)
    return copy.replace(record.with_outcome(outcome), path=path)


def unrestorable(record: TrackRecord[Written | WriteFailed]) -> TrackRecord[Written | WriteFailed]:
    """Entree retiree du dump sans restauration : l'etat reste, plus rien n'est a rendre."""
    outcome = record.outcome
    # Deux branches : `copy.replace` ne se type pas sur l'union des deux issues.
    match outcome:
        case Written():
            return record.with_outcome(copy.replace(outcome, restorable=False))
        case WriteFailed():
            return record.with_outcome(copy.replace(outcome, restorable=False))
        case _:
            assert_never(outcome)


@dataclass(frozen=True, slots=True)
class TaggingRun:
    """Etat gele d'un run."""

    run_id: RunId
    folder: Path
    tracks: tuple[TrackRecord, ...]


class LiveRun:
    """Etat vivant d'un run : l'arbitrage y tranche apres la phase reseau, jusqu'au run suivant."""

    def __init__(self, run_id: RunId, folder: Path, records: Sequence[TrackRecord]) -> None:
        self.run_id = run_id
        self.folder = folder
        self._records = {record.track_id: record for record in records}
        self._positions = {
            record.track_id: position for position, record in enumerate(records, start=1)
        }
        self._observer: Callable[[TrackRecord], None] | None = None

    @override
    def __repr__(self) -> str:
        return f"LiveRun(run_id={self.run_id!r}, tracks={len(self._records)})"

    def record(self, track_id: TrackId) -> TrackRecord | None:
        return self._records.get(track_id)

    def position(self, track_id: TrackId) -> int:
        """Rang du morceau dans le dossier, la cle `track` des logs."""
        return self._positions[track_id]

    def observe(self, observer: Callable[[TrackRecord], None]) -> None:
        """Appele a chaque `update` : le plan de run s'y branche sans que rien ne le sache."""
        self._observer = observer

    def update(self, record: TrackRecord) -> None:
        self._records[record.track_id] = record
        if self._observer is not None:
            self._observer(record)

    def snapshot(self) -> TaggingRun:
        return TaggingRun(self.run_id, self.folder, tuple(self._records.values()))


@dataclass(frozen=True, slots=True)
class RunStarted:
    """Tous les morceaux du run avec leur identite lue, avant le premier appel reseau."""

    run_id: RunId
    folder: Path
    tracks: tuple[TrackRecord, ...]


@dataclass(frozen=True, slots=True)
class TrackResolved:
    """Un morceau resolu ou non resolu."""

    record: TrackRecord[SettledOutcome]


@dataclass(frozen=True, slots=True)
class ArbitrationRequired:
    record: TrackRecord[AwaitingArbitration]


@dataclass(frozen=True, slots=True, kw_only=True)
class RunProgress:
    """Morceaux traites : resolus, non resolus ou en attente d'arbitrage."""

    processed: int
    total: int


type RunEvent = RunStarted | TrackResolved | ArbitrationRequired | RunProgress
