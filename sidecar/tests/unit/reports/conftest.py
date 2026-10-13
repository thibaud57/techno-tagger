"""Fixtures des tests de rapports."""

from typing import TYPE_CHECKING

import pytest
from extraction_samples import sample_context, sample_result

if TYPE_CHECKING:
    from pathlib import Path

    from tagger.playlists.extraction import ExtractionResult
    from tagger.reports.extraction import ReportContext


@pytest.fixture
def extraction_result(tmp_path: Path) -> ExtractionResult:
    """Resultat d'extraction couvrant les cinq categories."""
    return sample_result(tmp_path / "library")


@pytest.fixture
def report_context(tmp_path: Path) -> ReportContext:
    """Contexte de rapport pointant sur la meme arborescence."""
    return sample_context(tmp_path / "library", tmp_path / "work")
