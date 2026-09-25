"""Tests de l'enumeration des fichiers audio du dossier a re-tagger."""

from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from tagger.files import TaggingFolderUnreadableError, list_audio_files

if TYPE_CHECKING:
    from collections.abc import Iterator


def _touch(root: Path, *relative_paths: str) -> None:
    for relative in relative_paths:
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"\x00")


def _relative(root: Path, paths: tuple[Path, ...]) -> list[str]:
    return [path.relative_to(root).as_posix() for path in paths]


def test_lists_audio_files_recursively_and_ignores_other_extensions(tmp_path: Path) -> None:
    _touch(
        tmp_path,
        "a.mp3",
        "b.wav",
        "sub/c.aiff",
        "sub/deep/d.flac",
        "e.aif",
        "cover.jpg",
        "playlist.m3u8",
        "notes.txt",
    )

    found = list_audio_files(tmp_path)

    assert _relative(tmp_path, found) == [
        "a.mp3",
        "b.wav",
        "e.aif",
        "sub/c.aiff",
        "sub/deep/d.flac",
    ]


def test_recognises_extensions_regardless_of_case(tmp_path: Path) -> None:
    _touch(tmp_path, "a.MP3", "b.Aif", "c.FLAC")

    found = list_audio_files(tmp_path)

    assert _relative(tmp_path, found) == ["a.MP3", "b.Aif", "c.FLAC"]


def test_returns_files_sorted_by_relative_path_case_insensitively(tmp_path: Path) -> None:
    _touch(tmp_path, "b.mp3", "A.mp3", "sub/c.flac", "Sub2/a.wav")

    found = list_audio_files(tmp_path)

    assert _relative(tmp_path, found) == ["A.mp3", "b.mp3", "sub/c.flac", "Sub2/a.wav"]


def test_ignores_a_folder_named_like_an_audio_file(tmp_path: Path) -> None:
    (tmp_path / "album.mp3").mkdir()
    _touch(tmp_path, "album.mp3/track.flac")

    found = list_audio_files(tmp_path)

    assert _relative(tmp_path, found) == ["album.mp3/track.flac"]


def test_returns_an_empty_tuple_for_a_folder_without_audio_files(tmp_path: Path) -> None:
    _touch(tmp_path, "cover.jpg")

    found = list_audio_files(tmp_path)

    assert found == ()


def test_raises_a_tagging_folder_error_for_a_missing_path(tmp_path: Path) -> None:
    missing = tmp_path / "missing"

    with pytest.raises(TaggingFolderUnreadableError, match="unreadable tagging folder") as error:
        list_audio_files(missing)

    assert error.value.code == "tagging_folder_unreadable"
    assert error.value.params == {"folder": "missing"}


def test_raises_a_tagging_folder_error_for_a_path_that_is_a_file(tmp_path: Path) -> None:
    _touch(tmp_path, "track.mp3")

    with pytest.raises(TaggingFolderUnreadableError, match="unreadable tagging folder"):
        list_audio_files(tmp_path / "track.mp3")


def test_raises_a_tagging_folder_error_when_the_folder_vanishes_during_the_walk(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Parcours simule : `rglob` avale l'OSError de son scandir, une liste tronquee
    passerait sinon pour un dossier sans musique.
    """
    folder = tmp_path / "library"
    _touch(folder, "a.mp3")

    def vanishing_rglob(_self: Path, _pattern: str) -> Iterator[Path]:
        yield folder / "a.mp3"
        (folder / "a.mp3").unlink()
        folder.rmdir()

    monkeypatch.setattr(Path, "rglob", vanishing_rglob)

    with pytest.raises(TaggingFolderUnreadableError, match="unreadable tagging folder"):
        list_audio_files(folder)
