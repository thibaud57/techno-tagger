"""Morceau, requete et candidat score d'exemple : « Your Mind » d'Adam Beyer."""

from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Final

import pytest
from scraper_responses import track_candidate

from tagger.core.file_failures import FileFailureReason
from tagger.core.identifiers import RunId, TrackId
from tagger.resolution.matching import QueryOrigin, ScoredCandidate, TrackQuery
from tagger.resolution.scraper_client import Source
from tagger.run.models import (
    AwaitingArbitration,
    FailureReason,
    PendingArbitration,
    Resolution,
    Resolved,
    Retained,
    RolledBack,
    TrackRecord,
    Unresolved,
    Waiting,
    WriteFailed,
    WriteOutcome,
    Written,
    rolled_back,
)
from tagger.tags.files import IdentityTags, TagField, WrittenTags

if TYPE_CHECKING:
    from tagger.resolution.scraper_client import TrackCandidate
    from tagger.run.models import ResolvedBy

MUSIC: Final = Path("music")
RUN_ID: Final = RunId("a3f9c1")
# Autres runs, distincts de RUN_ID et entre eux, pour un test qui en croise plusieurs.
SECOND_RUN_ID: Final = RunId("9e8f7a")
THIRD_RUN_ID: Final = RunId("1b2c3d")
FOURTH_RUN_ID: Final = RunId("4d5e6f")
# Runs qu'aucun fichier ne porte : le premier n'a jamais existe, le second est un motif de glob.
UNKNOWN_RUN: Final = RunId("000000")
GLOB_RUN: Final = RunId("*")
CREATED: Final = datetime(2026, 10, 6, 21, 14, 3, tzinfo=UTC)
FIRST_TRACK: Final = TrackId("a.mp3")
SECOND_TRACK: Final = TrackId("b.mp3")
THIRD_TRACK: Final = TrackId("c.mp3")
# Absent du run comme du disque.
UNKNOWN_TRACK: Final = TrackId("ghost.mp3")
RECORD: Final = TrackRecord(
    track_id=FIRST_TRACK,
    path=MUSIC / FIRST_TRACK,
    identity=IdentityTags(artist="Adam Beyer", title="Your Mind"),
    outcome=Waiting(),
)
QUERY: Final = TrackQuery(artist="Adam Beyer", title="Your Mind", origin=QueryOrigin.TAGS)
# Contenus d'un fichier versionne que son chargeur refuse sans y lire de version ; chaque
# test y ajoute son JSON valide a la syntaxe mais invalide pour son modele.
UNREADABLE_CONTENTS: Final = [
    pytest.param("{not json", id="corrupt"),
    pytest.param("[]", id="not-an-object"),
]


def named(name: str) -> TrackRecord[Waiting]:
    """`RECORD` sous un autre nom de fichier, dont le morceau prend l'identifiant."""
    return replace(RECORD, track_id=TrackId(name), path=MUSIC / name)


def tags_query(artist: str, title: str) -> TrackQuery:
    """Requete issue des tags du fichier, sans nettoyage ni repli sur le nom."""
    return TrackQuery(artist=artist, title=title, origin=QueryOrigin.TAGS)


def scored_candidate(
    *, artist: float | None = 96.4, title: float = 91.6, candidate: TrackCandidate | None = None
) -> ScoredCandidate:
    """Candidat sans ecart de version ni de numero ; la moyenne suit les deux scores."""
    picked = candidate if candidate is not None else track_candidate()
    average = title if artist is None else (artist + title) / 2
    return ScoredCandidate(
        candidate=picked,
        artist_score=artist,
        title_score=title,
        score=average,
        version_mismatch=False,
        number_mismatch=False,
    )


def held() -> PendingArbitration:
    """Zone grise de Beatport, joignable : un seul candidat a trancher."""
    return PendingArbitration(Source.BEATPORT, (scored_candidate(),), beatport_unavailable=False)


def waiting(record: TrackRecord) -> TrackRecord[Waiting]:
    """Morceau jamais atteint : ni decision, ni attente."""
    return record.with_outcome(Waiting())


def awaiting(
    record: TrackRecord, pending: PendingArbitration | None = None, *, query: TrackQuery = QUERY
) -> TrackRecord[AwaitingArbitration]:
    """Morceau en zone grise : une liste (`held()` par defaut) a trancher."""
    return record.with_outcome(
        AwaitingArbitration(query, pending if pending is not None else held())
    )


def unresolved(
    record: TrackRecord, reason: FailureReason, query: TrackQuery | None = QUERY
) -> TrackRecord[Unresolved]:
    return record.with_outcome(Unresolved(query, reason))


def resolved(
    record: TrackRecord,
    resolution: ResolvedBy = Resolution.AUTO,
    *,
    source: Source = Source.BEATPORT,
    candidate: TrackCandidate | None = None,
    scored: ScoredCandidate | None = None,
    artwork: Path | None = None,
    query: TrackQuery | None = QUERY,
) -> TrackRecord[Resolved]:
    """Morceau resolu sur `candidate` (`track_candidate()` par defaut), non score par defaut."""
    picked = candidate if candidate is not None else track_candidate()
    retained = Retained(resolution, source, picked, scored, artwork)
    return record.with_outcome(Resolved(query, retained))


def written_record(
    record: TrackRecord[Resolved | WriteFailed],
    outcome: WriteOutcome | None = None,
    *,
    path: Path | None = None,
) -> TrackRecord[Written]:
    """Morceau ecrit ; `path` suit le renommage, comme a l'ecriture."""
    posed = (
        outcome
        if outcome is not None
        else WriteOutcome(WrittenTags((TagField.TITLE,), artwork=False), truncated=False)
    )
    return replace(
        record.with_outcome(
            Written(record.outcome.query, record.outcome.retained, posed, restorable=True)
        ),
        path=record.path if path is None else path,
    )


def write_failed_record(
    record: TrackRecord[Resolved | WriteFailed],
    reason: FileFailureReason = FileFailureReason.FILE_LOCKED,
    *,
    restorable: bool = False,
) -> TrackRecord[WriteFailed]:
    outcome = record.outcome
    return record.with_outcome(WriteFailed(outcome.query, outcome.retained, reason, restorable))


def rolled_back_record(
    record: TrackRecord[Written | WriteFailed], path: Path | None = None
) -> TrackRecord[RolledBack]:
    """Morceau rendu a son origine ; `path` est celui du fichier restaure."""
    return rolled_back(record, record.path if path is None else path)
