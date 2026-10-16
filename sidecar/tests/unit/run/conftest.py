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


@pytest.fixture
def plans(tmp_path: Path) -> Path:
    """Dossier des plans de run, a creer par le test qui y ecrit."""
    return tmp_path / "plans"


@pytest.fixture
def dumps(tmp_path: Path) -> Path:
    """Dossier des dumps de tags, deja cree."""
    folder = tmp_path / "dumps"
    folder.mkdir()
    return folder
