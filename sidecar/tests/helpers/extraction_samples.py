"""Echantillon d'`ExtractionResult` couvrant les cinq categories du resultat.

Un seul jeu de donnees pour tous les tests de rapport : ce qui est verifie est le
rendu, jamais la construction de l'echantillon.
"""

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Final

from tagger.extraction import (
    DiscardedCandidate,
    DuplicateCriterion,
    DuplicateResolution,
    ExtractionFailure,
    ExtractionFailureReason,
    ExtractionMode,
    ExtractionResult,
)
from tagger.reports import ReportContext

if TYPE_CHECKING:
    from pathlib import Path

# Instant fige : le nom du fichier de rapport en depend, donc les tests aussi.
GENERATED_AT: Final = datetime(2026, 9, 8, 22, 15, 0, tzinfo=UTC)
EXPECTED_STAMP: Final = "20260908T221500Z"

CYRILLIC_TRACK: Final = "Artist Two - Дорога.mp3"


def sample_result(library: Path) -> ExtractionResult:
    """Resultat portant les cinq categories, dont un homonyme departage."""
    return ExtractionResult(
        extracted=("alpha.mp3", CYRILLIC_TRACK),
        already_present=("delta.mp3",),
        missing=("absent.mp3",),
        duplicates=(
            DuplicateResolution(
                file_name="beta.mp3",
                kept_path=library / "singles" / "beta.mp3",
                kept_size=12_000,
                discarded=(DiscardedCandidate(path=library / "albums" / "beta.mp3", size=5_000),),
                criterion=DuplicateCriterion.LARGEST_FILE,
            ),
        ),
        failures=(
            ExtractionFailure(file_name="locked.mp3", reason=ExtractionFailureReason.FILE_LOCKED),
        ),
    )


def sample_context(library: Path, destination: Path) -> ReportContext:
    """Contexte d'un run d'extraction depuis un dump VLC."""
    return ReportContext(
        source_folder=library,
        destination_folder=destination,
        playlist_path=library / "vlc_media.db",
        playlist_name="test playlist",
        mode=ExtractionMode.COPY,
        generated_at=GENERATED_AT,
    )
