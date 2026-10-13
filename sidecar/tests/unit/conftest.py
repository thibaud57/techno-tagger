"""Fixtures propres aux tests unitaires."""

from typing import TYPE_CHECKING

import pytest
from audio_samples import BLANK_WRITERS
from extraction_samples import sample_context, sample_result

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

    import httpx2

    from tagger.playlists.extraction import ExtractionResult
    from tagger.reports.extraction import ReportContext


@pytest.fixture
def requests() -> list[httpx2.Request]:
    """Journal des requetes emises, rempli par le handler du `MockTransport`.

    Une liste neuve par test : c'est la seule fenetre sur ce que le client a emis.
    """
    return []


@pytest.fixture
def blank_audio(tmp_path: Path) -> Callable[[str], Path]:
    """Fabrique de fichiers audio vierges, `"mp3"`, `"wav"`, `"aiff"` ou `"flac"`.

    Construits en octets par `helpers/audio_samples.py` : aucun binaire commite.
    """

    def make(audio_format: str) -> Path:
        return BLANK_WRITERS[audio_format](tmp_path / f"track.{audio_format}")

    return make


@pytest.fixture
def music_folder(tmp_path: Path) -> Path:
    """Dossier vide, que les tests remplissent de vrais fichiers."""
    folder = tmp_path / "music"
    folder.mkdir()
    return folder


@pytest.fixture
def extraction_result(tmp_path: Path) -> ExtractionResult:
    """Resultat d'extraction couvrant les cinq categories."""
    return sample_result(tmp_path / "library")


@pytest.fixture
def report_context(tmp_path: Path) -> ReportContext:
    """Contexte de rapport pointant sur la meme arborescence."""
    return sample_context(tmp_path / "library", tmp_path / "work")
