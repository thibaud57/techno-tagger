"""Etat d'un run de re-tagging : enums d'issue, fiche d'un morceau, run gele ou vivant,
evenements internes du pipeline. Aucun appel reseau ni fichier : le pipeline vit dans `tagging`.
"""

from dataclasses import dataclass, replace
from enum import UNIQUE, StrEnum, auto, verify
from typing import TYPE_CHECKING, override

from tagger.core.file_failures import FileFailureReason

if TYPE_CHECKING:
    from collections.abc import Callable, Sequence
    from pathlib import Path

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


def is_decided(
    state: TrackState | None, failure_reason: TrackFailureReason | None, *, on_hold: bool
) -> bool:
    """Tranche, ou en attente d'une decision humaine.

    Une source qui n'a pas repondu (`source_unavailable`) n'est pas une decision : le morceau
    repart sur le reseau a la reprise, une fois la panne ou la cle corrigee.
    """
    if on_hold:
        return True
    unavailable = (
        state is TrackState.UNRESOLVED and failure_reason is FailureReason.SOURCE_UNAVAILABLE
    )
    return state is not None and not unavailable


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


@dataclass(frozen=True, slots=True)
class TrackRecord:
    """Tout ce que le run sait d'un morceau. `state` vide : en attente d'arbitrage ou en cours."""

    track_id: str
    path: Path
    identity: IdentityTags
    query: TrackQuery | None = None
    state: TrackState | None = None
    resolution: Resolution | None = None
    failure_reason: TrackFailureReason | None = None
    source: Source | None = None
    candidate: TrackCandidate | None = None
    scored: ScoredCandidate | None = None
    artwork: Path | None = None
    arbitration: PendingArbitration | None = None
    written: WriteOutcome | None = None
    # Pour l'affichage seul, `None` si illisibles : le dump relit le fichier.
    tags_before: ShownTags | None = None
    # Une entree au dump du run : l'origine est sauvegardee, un rollback a de quoi la rendre.
    restorable: bool = False

    @property
    def file_name(self) -> str:
        """Nom du fichier, sous-texte de la colonne Avant."""
        return self.path.name

    @property
    def decided(self) -> bool:
        """Regle unique du « deja traite » : progression, reprise et pipeline selectif."""
        return is_decided(self.state, self.failure_reason, on_hold=self.arbitration is not None)

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

    def written_to(self, path: Path, outcome: WriteOutcome) -> TrackRecord:
        """Morceau ecrit ; `path` suit le renommage, `track_id` reste celui du run."""
        return replace(
            self,
            state=TrackState.WRITTEN,
            failure_reason=None,
            path=path,
            written=outcome,
            restorable=True,
        )

    def write_failed(self, reason: FileFailureReason, *, restorable: bool) -> TrackRecord:
        """Ecriture en echec : la resolution reste, la relance n'a rien a redemander.

        `restorable` faux quand l'origine n'a jamais pu etre lue, donc jamais mise au dump.
        """
        return replace(
            self,
            state=TrackState.WRITE_ERROR,
            failure_reason=reason,
            restorable=restorable,
        )

    def rolled_back(self, path: Path) -> TrackRecord:
        """Rendu a son origine : plus rien du candidat, la ligne retombe sur le fichier.

        `resolution` reste, `_resolved` l'exigeant : l'etat la masque a l'ecran.
        """
        return replace(
            self,
            state=TrackState.ROLLED_BACK,
            failure_reason=None,
            path=path,
            written=None,
            restorable=False,
            source=None,
            candidate=None,
            scored=None,
            artwork=None,
        )

    def unrestorable(self) -> TrackRecord:
        """Entree retiree du dump sans restauration : l'etat reste, plus rien n'est a rendre."""
        return replace(self, restorable=False)

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
        self._observer: Callable[[TrackRecord], None] | None = None

    @override
    def __repr__(self) -> str:
        return f"LiveRun(run_id={self.run_id!r}, tracks={len(self._records)})"

    def record(self, track_id: str) -> TrackRecord | None:
        return self._records.get(track_id)

    def position(self, track_id: str) -> int:
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

    run_id: str
    folder: Path
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
