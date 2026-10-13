"""Dossiers calibres sur la limite de chemin Windows, partages par les tests de renommage."""

from typing import TYPE_CHECKING

from tagger.core.paths import extended_path
from tagger.tags.renaming import MAX_PATH_LENGTH

if TYPE_CHECKING:
    from pathlib import Path


def folder_leaving(tmp_path: Path, room: int) -> Path:
    """Dossier dont le chemin ne laisse que `room` caracteres au nom du fichier."""
    folder = tmp_path / ("x" * (MAX_PATH_LENGTH - len(str(tmp_path)) - 2 - room))
    folder.mkdir()
    return folder


def folder_beyond_the_limit(tmp_path: Path) -> Path:
    """Dossier dont le chemin depasse a lui seul MAX_PATH, cree par son chemin prefixe."""
    folder = tmp_path / ("x" * 120) / ("y" * 120)
    extended_path(folder).mkdir(parents=True)
    return folder
