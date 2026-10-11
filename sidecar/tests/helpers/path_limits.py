"""Dossiers calibres sur la limite de chemin Windows, partages par les tests de renommage."""

from typing import TYPE_CHECKING

from tagger.renaming import MAX_PATH_LENGTH

if TYPE_CHECKING:
    from pathlib import Path


def folder_leaving(tmp_path: Path, room: int) -> Path:
    """Dossier dont le chemin ne laisse que `room` caracteres au nom du fichier."""
    folder = tmp_path / ("x" * (MAX_PATH_LENGTH - len(str(tmp_path)) - 2 - room))
    folder.mkdir()
    return folder
