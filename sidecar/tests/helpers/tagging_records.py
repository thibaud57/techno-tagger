"""Morceau, requete et candidat score d'exemple : « Your Mind » d'Adam Beyer."""

from pathlib import Path
from typing import TYPE_CHECKING, Final

from scraper_responses import track_candidate

from tagger.resolution.matching import QueryOrigin, ScoredCandidate, TrackQuery
from tagger.resolution.scraper_client import Source
from tagger.run.models import PendingArbitration, TrackRecord
from tagger.tags.files import IdentityTags

if TYPE_CHECKING:
    from tagger.resolution.scraper_client import TrackCandidate

RUN_ID: Final = "a3f9c1"
RECORD: Final = TrackRecord(
    track_id="a.mp3",
    path=Path("music/a.mp3"),
    identity=IdentityTags(artist="Adam Beyer", title="Your Mind"),
)
QUERY: Final = TrackQuery(artist="Adam Beyer", title="Your Mind", origin=QueryOrigin.TAGS)


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
