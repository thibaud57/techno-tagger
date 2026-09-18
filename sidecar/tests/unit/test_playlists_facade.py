"""Tests de la facade du package `playlists`."""

from typing import TYPE_CHECKING

import pytest
from vlc_dump import PLAYLIST_MAIN, PLAYLIST_OTHER, TRACKS

if TYPE_CHECKING:
    from pathlib import Path

from tagger import playlists
from tagger.playlists.errors import PlaylistNameRequiredError, UnsupportedPlaylistFormatError
from tagger.playlists.models import PlaylistFormat


def test_detects_a_vlc_dump(vlc_dump: Path) -> None:
    detected = playlists.detect_format(vlc_dump)

    assert detected is PlaylistFormat.VLC_DUMP


def test_detects_an_m3u8_playlist(m3u8_playlist: Path) -> None:
    detected = playlists.detect_format(m3u8_playlist)

    assert detected is PlaylistFormat.M3U8


def test_routes_a_dump_to_the_sqlite_reader(vlc_dump: Path) -> None:
    names = playlists.read_playlist(vlc_dump, PLAYLIST_MAIN)

    assert set(names) == set(TRACKS)


def test_routes_a_playlist_file_to_the_text_parser(m3u8_playlist: Path) -> None:
    names = playlists.read_playlist(m3u8_playlist)

    assert "artist three - Zulu.flac" in names


def test_requires_a_playlist_name_for_a_dump(vlc_dump: Path) -> None:
    with pytest.raises(PlaylistNameRequiredError):
        playlists.read_playlist(vlc_dump)


def test_lists_no_playlist_for_a_text_file(m3u8_playlist: Path) -> None:
    listed = playlists.list_playlists(m3u8_playlist)

    assert listed.playlist_format is PlaylistFormat.M3U8
    assert listed.playlists == ()


def test_lists_every_playlist_of_a_vlc_dump(vlc_dump: Path) -> None:
    listed = playlists.list_playlists(vlc_dump)

    assert listed.playlist_format is PlaylistFormat.VLC_DUMP
    assert {summary.name for summary in listed.playlists} == {PLAYLIST_MAIN, PLAYLIST_OTHER}


def test_rejects_an_unreadable_binary_file(unreadable_binary_file: Path) -> None:
    with pytest.raises(UnsupportedPlaylistFormatError):
        playlists.list_playlists(unreadable_binary_file)
