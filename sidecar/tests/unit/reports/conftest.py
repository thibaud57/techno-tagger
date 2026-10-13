from typing import TYPE_CHECKING

import pytest
from extraction_samples import sample_context, sample_result

from tagger.playlists.extraction import ExtractionResult

if TYPE_CHECKING:
    from pathlib import Path

    from tagger.reports.extraction import ReportContext


@pytest.fixture
def extraction_result(tmp_path: Path) -> ExtractionResult:
    """Resultat d'extraction couvrant les cinq categories."""
    return sample_result(tmp_path / "library")


@pytest.fixture
def empty_extraction_result() -> ExtractionResult:
    """Extraction qui n'a rien trouve : le rapport s'ecrit quand meme."""
    return ExtractionResult(
        extracted=(), already_present=(), missing=(), duplicates=(), failures=()
    )


@pytest.fixture
def report_context(tmp_path: Path) -> ReportContext:
    """Contexte de rapport pointant sur la meme arborescence."""
    return sample_context(tmp_path / "library", tmp_path / "work")
