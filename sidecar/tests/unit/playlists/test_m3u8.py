from typing import TYPE_CHECKING

import pytest
from vlc_dump import TRACKS

from tagger.playlists import m3u8
from tagger.playlists.errors import UnreadablePlaylistFileError, UnsupportedPlaylistFormatError

if TYPE_CHECKING:
    from pathlib import Path


def test_extracts_every_entry_in_file_order(m3u8_playlist: Path) -> None:
    """Le fichier melange directives, BOM, chemins Windows et POSIX : l'egalite avec
    les noms propres couvre chacun de ces nettoyages.
    """
    names = m3u8.read_playlist(m3u8_playlist)

    assert names == TRACKS


def test_returns_nothing_for_a_file_holding_only_directives(tmp_path: Path) -> None:
    empty = tmp_path / "empty.m3u8"
    empty.write_text("#EXTM3U\n#EXTINF:1,nothing\n\n", encoding="utf-8")

    names = m3u8.read_playlist(empty)

    assert names == ()


def test_rejects_a_binary_file_as_an_unsupported_format(unreadable_binary_file: Path) -> None:
    with pytest.raises(UnsupportedPlaylistFormatError):
        m3u8.read_playlist(unreadable_binary_file)


def test_converts_a_missing_file_into_a_business_error(tmp_path: Path) -> None:
    missing = tmp_path / "does_not_exist.m3u8"

    with pytest.raises(UnreadablePlaylistFileError) as excinfo:
        m3u8.read_playlist(missing)

    assert excinfo.value.code == "playlist_file_unreadable"
