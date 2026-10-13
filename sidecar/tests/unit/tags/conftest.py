from typing import TYPE_CHECKING

import pytest
from audio_samples import BLANK_WRITERS

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path


@pytest.fixture
def blank_audio(tmp_path: Path) -> Callable[[str], Path]:
    """Fabrique de fichiers audio vierges, `"mp3"`, `"wav"`, `"aiff"` ou `"flac"`.

    Construits en octets par `helpers/audio_samples.py` : aucun binaire commite.
    """

    def make(audio_format: str) -> Path:
        return BLANK_WRITERS[audio_format](tmp_path / f"track.{audio_format}")

    return make
