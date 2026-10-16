"""Tests du lecteur de dump `vlc_media.db`.

La collation `FILENAME` est propre a VLC : `sqlite3` ne la connait pas, et toute
requete touchant `Media.filename` echoue tant qu'elle n'est pas enregistree. Les
dumps de test la declarent donc, pour valoir dump reel (ADR-019).
"""

import sqlite3
from contextlib import closing
from pathlib import Path
from typing import TYPE_CHECKING

import pytest
from vlc_dump import PLAYLIST_MAIN, PLAYLIST_OTHER, TRACKS, build_dump

from tagger.playlists import vlc
from tagger.playlists.errors import (
    IncompatibleDumpSchemaError,
    PlaylistNotFoundError,
    UnreadableDumpError,
    UnreadablePlaylistFileError,
)

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator


@pytest.fixture
def connection(vlc_dump: Path) -> Iterator[sqlite3.Connection]:
    with closing(vlc.connect(vlc_dump)) as opened:
        yield opened


def test_recognises_a_real_dump_by_its_header(vlc_dump: Path) -> None:
    recognised = vlc.is_vlc_dump(vlc_dump)

    assert recognised is True


@pytest.mark.parametrize(
    "contents",
    [b"#EXTM3U\ntrack.mp3\n", b"SQLite"],
    ids=["text-file", "too-short"],
)
def test_rejects_a_file_without_the_sqlite_header(tmp_path: Path, contents: bytes) -> None:
    fake = tmp_path / "vlc_media.db"
    fake.write_bytes(contents)

    recognised = vlc.is_vlc_dump(fake)

    assert recognised is False


def test_converts_a_missing_file_into_a_business_error_on_detection(tmp_path: Path) -> None:
    missing = tmp_path / "does_not_exist.db"

    with pytest.raises(UnreadablePlaylistFileError) as excinfo:
        vlc.is_vlc_dump(missing)

    assert excinfo.value.code == "playlist_file_unreadable"


def test_accepts_a_dump_carrying_the_expected_schema(connection: sqlite3.Connection) -> None:
    """Le cas positif face aux deux rejets : sans lui, une implementation qui
    refuserait tout dump passerait les tests de table et de colonne manquantes.
    """
    media_count = connection.execute("SELECT count(*) FROM Media").fetchone()[0]

    assert media_count == len(TRACKS)


@pytest.mark.parametrize(
    ("omit_table", "omit_column", "missing"),
    [
        ("PlaylistMediaRelation", None, "PlaylistMediaRelation"),
        (None, "Media.filename", "Media.filename"),
    ],
    ids=["table", "column"],
)
def test_reports_what_the_schema_lacks_by_name(
    tmp_path: Path, omit_table: str | None, omit_column: str | None, missing: str
) -> None:
    amputated = build_dump(
        tmp_path / "amputated.db", omit_table=omit_table, omit_column=omit_column
    )

    with pytest.raises(IncompatibleDumpSchemaError) as excinfo:
        vlc.connect(amputated)

    assert excinfo.value.params["missing"] == [missing]


def test_accepts_table_and_column_names_whatever_their_case(tmp_path: Path) -> None:
    shouting = tmp_path / "shouting.db"
    with closing(sqlite3.connect(shouting)) as setup:
        setup.execute("CREATE TABLE PLAYLIST(ID_PLAYLIST INTEGER, NAME TEXT)")
        setup.execute("CREATE TABLE PLAYLISTMEDIARELATION(PLAYLIST_ID INTEGER, MEDIA_ID INTEGER)")
        setup.execute("CREATE TABLE MEDIA(ID_MEDIA INTEGER, FILENAME TEXT)")
        setup.commit()

    with closing(vlc.connect(shouting)) as verified:
        media_count = verified.execute("SELECT count(*) FROM MEDIA").fetchone()[0]

    assert media_count == 0


def test_opens_the_dump_read_only(connection: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.OperationalError, match="readonly"):
        connection.execute("DELETE FROM Media")


def _corrupt(folder: Path) -> Path:
    corrupt = folder / "corrupt.db"
    corrupt.write_bytes(vlc.SQLITE_HEADER + b"\x00" * 64)
    return corrupt


def _missing(folder: Path) -> Path:
    return folder / "does_not_exist.db"


def _relative(folder: Path) -> Path:
    """`Path.as_uri()` leve `ValueError` sur un chemin relatif, pas seulement
    `sqlite3.DatabaseError` : ce cas garde la capture large de `connect()`.
    """
    build_dump(folder / "vlc_media.db")
    return Path("vlc_media.db")


@pytest.mark.parametrize(
    "make_dump", [_corrupt, _missing, _relative], ids=["corrupt", "missing", "relative-path"]
)
def test_converts_an_unopenable_dump_into_a_business_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, make_dump: Callable[[Path], Path]
) -> None:
    monkeypatch.chdir(tmp_path)
    dump = make_dump(tmp_path)

    with pytest.raises(UnreadableDumpError) as excinfo:
        vlc.connect(dump)

    assert excinfo.value.code == "unreadable_dump"


def test_opens_a_dump_whose_directory_name_contains_special_uri_characters(
    tmp_path: Path,
) -> None:
    """`#`/`%` sont legaux dans un chemin Windows mais coupent/decodent une URI
    SQLite mal construite (ex: `f"file:{path}?mode=ro"`) : ce test couvre la
    construction par `Path.as_uri()`, qui les encode correctement.
    """
    special_dir = tmp_path / "Sets #2"
    special_dir.mkdir(parents=True)
    dump = build_dump(special_dir / "vlc_media.db")

    summaries = vlc.list_playlists(dump)

    assert [summary.name for summary in summaries] == [PLAYLIST_OTHER, PLAYLIST_MAIN]


def test_lists_every_playlist_of_the_dump(vlc_dump: Path) -> None:
    summaries = vlc.list_playlists(vlc_dump)

    assert [summary.name for summary in summaries] == [PLAYLIST_OTHER, PLAYLIST_MAIN]


def test_counts_distinct_tracks_not_relations(vlc_dump: Path) -> None:
    summaries = vlc.list_playlists(vlc_dump)

    counts = {summary.name: summary.track_count for summary in summaries}
    assert counts[PLAYLIST_MAIN] == len(TRACKS)


def test_ignores_the_unreliable_denormalised_counter(vlc_dump: Path) -> None:
    summaries = vlc.list_playlists(vlc_dump)

    assert all(summary.track_count > 0 for summary in summaries)


def test_carries_the_playlist_identifier(vlc_dump: Path) -> None:
    summaries = vlc.list_playlists(vlc_dump)

    assert {summary.playlist_id for summary in summaries} == {1, 2}


def test_extracts_the_file_names_of_the_requested_playlist(vlc_dump: Path) -> None:
    names = vlc.read_playlist(vlc_dump, PLAYLIST_MAIN)

    assert set(names) == set(TRACKS)


def test_deduplicates_a_track_listed_twice(vlc_dump: Path) -> None:
    names = vlc.read_playlist(vlc_dump, PLAYLIST_MAIN)

    assert len(names) == len(set(names))


def test_sorts_case_insensitively(vlc_dump: Path) -> None:
    names = vlc.read_playlist(vlc_dump, PLAYLIST_MAIN)

    assert list(names) == sorted(names, key=str.lower)


def test_returns_file_names_never_paths(vlc_dump: Path) -> None:
    names = vlc.read_playlist(vlc_dump, PLAYLIST_MAIN)

    assert not any("/" in name or "\\" in name for name in names)


def test_raises_when_the_playlist_does_not_exist(vlc_dump: Path) -> None:
    with pytest.raises(PlaylistNotFoundError) as excinfo:
        vlc.read_playlist(vlc_dump, "absente")

    assert excinfo.value.params["playlist_name"] == "absente"


def test_extracts_only_the_tracks_of_the_requested_playlist(vlc_dump: Path) -> None:
    names = vlc.read_playlist(vlc_dump, PLAYLIST_OTHER)

    assert names == (TRACKS[0],)
