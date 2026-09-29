"""Morceau du run et candidat score partages par les tests de traduction du protocole."""

from pathlib import Path
from typing import TYPE_CHECKING, Final

from scraper_responses import track_candidate

from tagger.files import IdentityTags
from tagger.matching import ScoredCandidate
from tagger.tagging import TrackRecord

if TYPE_CHECKING:
    from tagger.scraper_client import TrackCandidate

RECORD: Final = TrackRecord(
    track_id="a.mp3",
    path=Path("music/a.mp3"),
    identity=IdentityTags(artist="Adam Beyer", title="Your Mind"),
)


def scored_candidate(
    *, artist: float | None = 96.4, title: float = 91.6, candidate: TrackCandidate | None = None
) -> ScoredCandidate:
    """Candidat sans ecart de version ni de numero ; la moyenne suit les deux scores."""
    picked = candidate if candidate is not None else track_candidate()
    average = title if artist is None else (artist + title) / 2
    return ScoredCandidate(
        picked, artist, title, average, version_mismatch=False, number_mismatch=False
    )
