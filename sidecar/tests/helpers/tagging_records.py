"""Morceau, requete et candidat score d'exemple : « Your Mind » d'Adam Beyer."""

from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Final

import pytest
from scraper_responses import track_candidate

from tagger.resolution.matching import QueryOrigin, ScoredCandidate, TrackQuery
from tagger.resolution.scraper_client import Source
from tagger.run.models import PendingArbitration, TrackRecord
from tagger.tags.files import IdentityTags

if TYPE_CHECKING:
    from tagger.resolution.scraper_client import TrackCandidate

MUSIC: Final = Path("music")
RUN_ID: Final = "a3f9c1"
CREATED: Final = datetime(2026, 10, 6, 21, 14, 3, tzinfo=UTC)
RECORD: Final = TrackRecord(
    track_id="a.mp3",
    path=MUSIC / "a.mp3",
    identity=IdentityTags(artist="Adam Beyer", title="Your Mind"),
)
QUERY: Final = TrackQuery(artist="Adam Beyer", title="Your Mind", origin=QueryOrigin.TAGS)
# Contenus d'un fichier versionne que son chargeur refuse sans y lire de version ; chaque
# test y ajoute son JSON valide a la syntaxe mais invalide pour son modele.
UNREADABLE_CONTENTS: Final = [
    pytest.param("{not json", id="corrupt"),
    pytest.param("[]", id="not-an-object"),
]


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


def awaiting(record: TrackRecord, pending: PendingArbitration | None = None) -> TrackRecord:
    """Morceau en zone grise : ni etat ni motif, une liste (`held()` par defaut) a trancher."""
    return replace(
        record,
        state=None,
        resolution=None,
        failure_reason=None,
        arbitration=pending if pending is not None else held(),
    )
