"""Parsing des playlists M3U8.

Format textuel et stable : un seul parser couvre Rekordbox, Traktor, foobar et VLC
desktop. Une seule playlist par fichier, donc aucune selection a proposer. Les chemins
absolus de la machine d'origine ne gardent que le nom de fichier : la resolution se
fait par nom, jamais par chemin (ADR-020).
"""

from typing import TYPE_CHECKING, Final

from .errors import UnreadablePlaylistFileError, UnsupportedPlaylistFormatError

if TYPE_CHECKING:
    from pathlib import Path

# Les deux separateurs sont traites ensemble : le fichier vient d'une autre machine
# que celle qui le lit, ce qu'une classe `PurePath` liee a la plateforme courante ne
# couvrirait pas.
SEPARATORS: Final = ("\\", "/")

DIRECTIVE_PREFIX: Final = "#"


def read_playlist(path: Path) -> tuple[str, ...]:
    """Noms de fichiers du M3U8, dans l'ordre du fichier.

    Lu en `utf-8-sig` : Rekordbox et VLC desktop posent un BOM, qui colle sinon
    `\\ufeff` au premier nom et le rend introuvable sur disque.

    La facade aiguille ici tout ce qui n'a pas d'en-tete SQLite : un fichier illisible
    en texte (ni dump ni playlist) ressort en erreur metier, pas en `UnicodeDecodeError`.
    Un fichier disparu ou verrouille entre la detection de format et cette lecture aussi,
    pas en `OSError` brute (symetrique a `vlc.is_vlc_dump`).
    """
    try:
        content = path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError as error:
        raise UnsupportedPlaylistFormatError(path) from error
    except OSError as error:
        raise UnreadablePlaylistFileError(path) from error

    return tuple(
        _file_name(stripped)
        for line in content.splitlines()
        if (stripped := line.strip()) and not stripped.startswith(DIRECTIVE_PREFIX)
    )


def _file_name(entry: str) -> str:
    for separator in SEPARATORS:
        entry = entry.rpartition(separator)[2]

    return entry
