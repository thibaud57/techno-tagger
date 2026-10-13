from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from pathlib import Path


@pytest.fixture
def music_folder(tmp_path: Path) -> Path:
    """Dossier vide, que les tests remplissent de vrais fichiers."""
    folder = tmp_path / "music"
    folder.mkdir()
    return folder
