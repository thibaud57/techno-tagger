"""Tests des erreurs du domaine playlist."""

from pathlib import Path

from tagger.playlists.errors import (
    IncompatibleDumpSchemaError,
    PlaylistError,
    PlaylistNotFoundError,
    UnsupportedPlaylistFormatError,
)


class TestPlaylistError:
    """Erreur de base du domaine playlist."""

    def test_code_is_set(self) -> None:
        error = PlaylistError("test message")

        assert error.code == "playlist_error"

    def test_params_stored(self) -> None:
        error = PlaylistError("test message", foo="bar", count=42)

        assert error.params == {"foo": "bar", "count": 42}

    def test_no_params(self) -> None:
        error = PlaylistError("test message")

        assert error.params == {}


class TestUnsupportedPlaylistFormat:
    """Fichier qui n'est ni un dump SQLite ni une playlist texte."""

    def test_code_is_set(self) -> None:
        path = Path("file.txt")
        error = UnsupportedPlaylistFormatError(path)

        assert error.code == "unsupported_playlist_format"

    def test_filename_in_params(self) -> None:
        path = Path("my_playlist.wav")
        error = UnsupportedPlaylistFormatError(path)

        assert error.params == {"filename": "my_playlist.wav"}

    def test_message_includes_filename(self) -> None:
        path = Path("broken.bin")
        error = UnsupportedPlaylistFormatError(path)

        assert "broken.bin" in str(error)


class TestIncompatibleDumpSchema:
    """Dump ne portant pas les tables et colonnes attendues."""

    def test_code_is_set(self) -> None:
        error = IncompatibleDumpSchemaError(["Playlist", "Media.filename"])

        assert error.code == "vlc_schema_mismatch"

    def test_single_missing_element(self) -> None:
        error = IncompatibleDumpSchemaError(["Playlist"])

        assert error.params == {"missing": ["Playlist"]}

    def test_multiple_missing_elements(self) -> None:
        missing = ["Playlist", "Media.filename", "PlaylistMediaRelation.media_id"]
        error = IncompatibleDumpSchemaError(missing)

        assert error.params == {"missing": missing}

    def test_message_lists_missing(self) -> None:
        error = IncompatibleDumpSchemaError(["Playlist", "Media"])

        error_str = str(error)
        assert "Playlist" in error_str
        assert "Media" in error_str


class TestPlaylistNotFound:
    """Aucune playlist de ce nom dans le dump."""

    def test_code_is_set(self) -> None:
        error = PlaylistNotFoundError("My Playlist")

        assert error.code == "playlist_not_found"

    def test_playlist_name_in_params(self) -> None:
        error = PlaylistNotFoundError("Test Playlist")

        assert error.params == {"playlist_name": "Test Playlist"}

    def test_message_includes_name(self) -> None:
        error = PlaylistNotFoundError("Favorites")

        assert "Favorites" in str(error)
