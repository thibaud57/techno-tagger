"""Parsing des playlists : dump SQLite VLC et M3U8.

Facade du package : les appelants passent un chemin, le format est reconnu a l'en-tete
du fichier, le decoupage interne entre lecteur de dump et parser texte ne fuit pas.
"""

from typing import TYPE_CHECKING, assert_never

from . import m3u8, vlc
from .errors import (
    IncompatibleDumpSchemaError,
    PlaylistError,
    PlaylistNameRequiredError,
    PlaylistNotFoundError,
    UnreadableDumpError,
    UnreadablePlaylistFileError,
    UnsupportedPlaylistFormatError,
)
from .models import PlaylistFormat, PlaylistListing, PlaylistSummary

if TYPE_CHECKING:
    from pathlib import Path

__all__ = [
    "IncompatibleDumpSchemaError",
    "PlaylistError",
    "PlaylistFormat",
    "PlaylistListing",
    "PlaylistNameRequiredError",
    "PlaylistNotFoundError",
    "PlaylistSummary",
    "UnreadableDumpError",
    "UnreadablePlaylistFileError",
    "UnsupportedPlaylistFormatError",
    "detect_format",
    "list_playlists",
    "read_playlist",
]


def detect_format(path: Path) -> PlaylistFormat:
    """Reconnait le format du fichier a son en-tete, jamais a son extension."""
    return PlaylistFormat.VLC_DUMP if vlc.is_vlc_dump(path) else PlaylistFormat.M3U8


def list_playlists(path: Path) -> PlaylistListing:
    """Playlists d'un fichier de playlist, avec le format reconnu.

    Un M3U8 n'en contient qu'une et rend `()` sans lever : cette commande sert aussi a
    faire reconnaitre le format par l'interface, qui n'a pas le droit de le deduire.
    Lever ici transformerait un canal d'erreur en canal d'information : un fichier
    illisible cesserait d'etre distinguable d'un M3U8 valide. Le decodage est donc
    tente quand meme, son resultat ignore : un binaire illisible (ex: JPEG) leve
    `UnsupportedPlaylistFormatError` comme `read_playlist`.
    """
    match detect_format(path):
        case PlaylistFormat.VLC_DUMP:
            return PlaylistListing(PlaylistFormat.VLC_DUMP, vlc.list_playlists(path))
        case PlaylistFormat.M3U8:
            m3u8.read_playlist(path)
            return PlaylistListing(PlaylistFormat.M3U8, ())
        case unknown:
            assert_never(unknown)


def read_playlist(path: Path, playlist_name: str | None = None) -> tuple[str, ...]:
    """Noms de fichiers de la playlist, quel que soit le format d'entree.

    `playlist_name` est requis pour un dump (il porte toute la mediatheque) et ignore
    pour un M3U8 (une seule playlist).

    Un dump rend des noms dedupliques et tries (la base fait foi), un M3U8 l'ordre du
    fichier, doublons compris : l'ordre de lecture DJ peut etre voulu.
    """
    match detect_format(path):
        case PlaylistFormat.VLC_DUMP:
            if playlist_name is None:
                raise PlaylistNameRequiredError()
            return vlc.read_playlist(path, playlist_name)
        case PlaylistFormat.M3U8:
            return m3u8.read_playlist(path)
        case unknown:
            assert_never(unknown)
