"""Erreurs du domaine playlist."""

from typing import TYPE_CHECKING, ClassVar

from tagger.errors import TaggerError

if TYPE_CHECKING:
    from collections.abc import Sequence
    from pathlib import Path


class PlaylistError(TaggerError):
    """Base des erreurs de lecture de playlist."""

    code: ClassVar[str] = "playlist_error"


class UnsupportedPlaylistFormatError(PlaylistError):
    """Le fichier n'est ni un dump SQLite ni une playlist texte exploitable."""

    code: ClassVar[str] = "unsupported_playlist_format"

    def __init__(self, path: Path) -> None:
        super().__init__(f"unsupported playlist format: {path.name}", filename=path.name)


class IncompatibleDumpSchemaError(PlaylistError):
    """Le dump ne porte pas les tables et colonnes attendues.

    Un schema partiellement compatible est traite comme incompatible : extraire a
    moitie une playlist est pire qu'echouer clairement (ADR-019).
    """

    code: ClassVar[str] = "vlc_schema_mismatch"

    def __init__(self, missing: Sequence[str]) -> None:
        listed = ", ".join(missing)
        super().__init__(f"incompatible vlc_media.db schema: {listed}", missing=list(missing))


class PlaylistNotFoundError(PlaylistError):
    """Aucune playlist de ce nom dans le dump."""

    code: ClassVar[str] = "playlist_not_found"

    def __init__(self, name: str) -> None:
        super().__init__(f"playlist not found: {name}", playlist_name=name)


class UnreadablePlaylistFileError(PlaylistError):
    """Le fichier de playlist ne peut pas etre ouvert (disparu, permission refusee)."""

    code: ClassVar[str] = "playlist_file_unreadable"

    def __init__(self, path: Path) -> None:
        super().__init__(f"unreadable playlist file: {path.name}", filename=path.name)


class UnreadableDumpError(PlaylistError):
    """Le dump SQLite ne peut pas etre ouvert ou lu (fichier corrompu)."""

    code: ClassVar[str] = "unreadable_dump"

    def __init__(self, path: Path) -> None:
        super().__init__(f"unreadable vlc_media.db: {path.name}", filename=path.name)


class PlaylistNameRequiredError(PlaylistError):
    """`playlist_name` est requis pour lire un dump VLC, qui porte toute la mediatheque."""

    code: ClassVar[str] = "playlist_name_required"

    def __init__(self) -> None:
        super().__init__("playlist name is required for a VLC dump")
