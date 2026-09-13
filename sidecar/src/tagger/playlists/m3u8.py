"""Parsing des playlists M3U8.

Textuel et stable, ce format couvre Rekordbox, Traktor, foobar et VLC desktop avec
un seul parser, et ne contient qu'une playlist, donc aucune selection a proposer.
Il porte les chemins absolus de la machine d'origine, dont seul le nom de fichier
est retenu : la resolution se fait par nom, jamais par chemin (ADR-020).
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
    """Rend les noms de fichiers du M3U8, dans l'ordre du fichier.

    Lu en `utf-8-sig` : Rekordbox et VLC desktop posent un BOM, qui colle sinon
    `\\ufeff` au premier nom et le rend introuvable sur disque.

    Un fichier illisible en texte n'est ni un dump ni une playlist : la facade y
    aiguille tout ce qui n'a pas d'en-tete SQLite, l'erreur de decodage doit donc
    ressortir en erreur metier plutot qu'en `UnicodeDecodeError`. Un fichier disparu
    ou verrouille entre la detection de format et cette lecture leve de meme en
    erreur metier plutot qu'en `OSError` brute (symetrique a `vlc.is_vlc_dump`).
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
    """Reduit une entree a son nom de fichier, quel que soit le separateur employe."""
    for separator in SEPARATORS:
        entry = entry.rpartition(separator)[2]

    return entry
