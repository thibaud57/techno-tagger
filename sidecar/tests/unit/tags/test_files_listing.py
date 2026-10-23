from pathlib import Path
from typing import TYPE_CHECKING

import pytest
from log_capture import messages_of
from unencodable_names import UNENCODABLE_NAME

from tagger.tags.files import TaggingFolderUnreadableError, has_audio_files, list_audio_files

if TYPE_CHECKING:
    from collections.abc import Iterator


def _touch(root: Path, *relative_paths: str) -> None:
    for relative in relative_paths:
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"\x00")


def _relative(root: Path, paths: tuple[Path, ...]) -> list[str]:
    return [path.relative_to(root).as_posix() for path in paths]


@pytest.mark.parametrize(
    ("present", "listed"),
    [
        (
            [
                "a.mp3",
                "b.wav",
                "sub/c.aiff",
                "sub/deep/d.flac",
                "e.aif",
                "cover.jpg",
                "playlist.m3u8",
                "notes.txt",
            ],
            ["a.mp3", "b.wav", "e.aif", "sub/c.aiff", "sub/deep/d.flac"],
        ),
        (["a.MP3", "b.Aif", "c.FLAC"], ["a.MP3", "b.Aif", "c.FLAC"]),
        (
            ["b.mp3", "A.mp3", "sub/c.flac", "Sub2/a.wav"],
            ["A.mp3", "b.mp3", "sub/c.flac", "Sub2/a.wav"],
        ),
        (["album.mp3/track.flac"], ["album.mp3/track.flac"]),
    ],
    ids=[
        "recursive-other-extensions-ignored",
        "extensions-regardless-of-case",
        "sorted-by-relative-path-case-insensitively",
        "folder-named-like-an-audio-file-ignored",
    ],
)
def test_lists_the_audio_files_of_a_folder(
    tmp_path: Path, present: list[str], listed: list[str]
) -> None:
    _touch(tmp_path, *present)

    found = list_audio_files(tmp_path)

    assert _relative(tmp_path, found) == listed


def test_skips_a_file_whose_name_utf8_cannot_encode_and_warns(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    """Regression : ce nom faisait lever `run_started` a l'emission et tuait le sidecar."""
    _touch(tmp_path, "a.mp3", UNENCODABLE_NAME)

    found = list_audio_files(tmp_path)

    assert _relative(tmp_path, found) == ["a.mp3"]
    assert messages_of(caplog, "tagger.core.paths") == ["audio file skipped reason=name_not_utf8"]


def test_finds_no_audio_file_when_the_only_one_has_a_name_utf8_cannot_encode(
    tmp_path: Path,
) -> None:
    _touch(tmp_path, UNENCODABLE_NAME)

    found = has_audio_files(tmp_path)

    assert found is False


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
