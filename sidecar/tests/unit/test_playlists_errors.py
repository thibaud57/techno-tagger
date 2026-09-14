"""Tests des erreurs du domaine playlist.

Le `code` est la cle que l'interface traduit sous `errors.<code>`, les `params`
remplissent son message : un renommage doit casser un test, pas un ecran.
"""

from pathlib import Path

import pytest

from tagger.playlists.errors import (
    IncompatibleDumpSchemaError,
    PlaylistError,
    PlaylistNameRequiredError,
    PlaylistNotFoundError,
    UnreadableDumpError,
    UnreadablePlaylistFileError,
    UnsupportedPlaylistFormatError,
)


@pytest.mark.parametrize(
    ("error", "code", "params"),
    [
        (PlaylistError("playlist error"), "playlist_error", {}),
        (
            UnsupportedPlaylistFormatError(Path("C:/Users/dj/Music/broken.bin")),
            "unsupported_playlist_format",
            {"filename": "broken.bin"},
        ),
        (
            IncompatibleDumpSchemaError(["Playlist", "Media.filename"]),
            "vlc_schema_mismatch",
            {"missing": ["Playlist", "Media.filename"]},
        ),
        (PlaylistNotFoundError("Favorites"), "playlist_not_found", {"playlist_name": "Favorites"}),
        (
            UnreadablePlaylistFileError(Path("C:/Users/dj/Music/gone.m3u8")),
            "playlist_file_unreadable",
            {"filename": "gone.m3u8"},
        ),
        (
            UnreadableDumpError(Path("C:/Users/dj/Music/vlc_media.db")),
            "unreadable_dump",
            {"filename": "vlc_media.db"},
        ),
        (PlaylistNameRequiredError(), "playlist_name_required", {}),
    ],
    ids=[
        "base",
        "unsupported_format",
        "schema_mismatch",
        "playlist_not_found",
        "unreadable_file",
        "unreadable_dump",
        "name_required",
    ],
)
def test_carries_the_code_and_params_the_interface_translates(
    error: PlaylistError, code: str, params: dict[str, object]
) -> None:
    assert error.code == code
    assert error.params == params


@pytest.mark.parametrize(
    ("error", "named"),
    [
        (UnsupportedPlaylistFormatError(Path("broken.bin")), "broken.bin"),
        (IncompatibleDumpSchemaError(["Playlist", "Media.filename"]), "Playlist, Media.filename"),
        (PlaylistNotFoundError("Favorites"), "Favorites"),
        (UnreadablePlaylistFileError(Path("gone.m3u8")), "gone.m3u8"),
        (UnreadableDumpError(Path("vlc_media.db")), "vlc_media.db"),
    ],
    ids=["unsupported_format", "schema_mismatch", "playlist_not_found", "unreadable_file", "dump"],
)
def test_the_log_message_names_what_failed(error: PlaylistError, named: str) -> None:
    assert named in str(error)
