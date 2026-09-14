"""Tests de l'extraction vers le dossier destination."""

import errno
from pathlib import Path

import pytest

from tagger import extraction
from tagger.extraction import (
    ExtractionFailure,
    ExtractionFailureReason,
    ExtractionMode,
    extract,
    failure_reason,
)


def test_copies_the_requested_tracks(music_library: Path, tmp_path: Path) -> None:
    destination = tmp_path / "work"

    result = extract(["alpha.mp3"], music_library, destination)

    assert (destination / "alpha.mp3").is_file()
    assert result.extracted == ("alpha.mp3",)


def test_leaves_the_source_untouched_when_copying(music_library: Path, tmp_path: Path) -> None:
    extract(["alpha.mp3"], music_library, tmp_path / "work")

    assert (music_library / "albums" / "alpha.mp3").is_file()


def test_removes_the_source_file_when_moving(music_library: Path, tmp_path: Path) -> None:
    destination = tmp_path / "work"

    extract(["alpha.mp3"], music_library, destination, mode=ExtractionMode.MOVE)

    assert not (music_library / "albums" / "alpha.mp3").exists()
    assert (destination / "alpha.mp3").is_file()


def test_creates_the_destination_folder(music_library: Path, tmp_path: Path) -> None:
    destination = tmp_path / "work" / "nested"

    extract(["alpha.mp3"], music_library, destination)

    assert destination.is_dir()


def test_finds_a_track_whatever_the_case_used(music_library: Path, tmp_path: Path) -> None:
    destination = tmp_path / "work"

    result = extract(["delta.MP3"], music_library, destination)

    assert result.extracted == ("delta.MP3",)
    assert len(list(destination.iterdir())) == 1


def test_records_the_duplicate_it_resolved(music_library: Path, tmp_path: Path) -> None:
    result = extract(["beta.mp3"], music_library, tmp_path / "work")

    assert len(result.duplicates) == 1
    assert result.duplicates[0].file_name == "beta.mp3"


def test_never_overwrites_an_existing_destination_file(music_library: Path, tmp_path: Path) -> None:
    destination = tmp_path / "work"
    destination.mkdir()
    (destination / "alpha.mp3").write_bytes(b"already retagged")

    result = extract(["alpha.mp3"], music_library, destination)

    assert (destination / "alpha.mp3").read_bytes() == b"already retagged"
    assert result.already_present == ("alpha.mp3",)
    assert result.extracted == ()


def test_returns_an_empty_result_for_an_empty_playlist(music_library: Path, tmp_path: Path) -> None:
    result = extract([], music_library, tmp_path / "work")

    assert result.extracted == ()
    assert result.missing == ()


def test_leaves_no_destination_folder_behind_for_an_empty_playlist(
    music_library: Path, tmp_path: Path
) -> None:
    destination = tmp_path / "work"

    extract([], music_library, destination)

    assert not destination.exists()


def test_moves_nothing_when_the_destination_is_the_source(music_library: Path) -> None:
    result = extract(["alpha.mp3"], music_library, music_library, mode=ExtractionMode.MOVE)

    assert (music_library / "albums" / "alpha.mp3").is_file()
    assert not (music_library / "alpha.mp3").exists()
    assert result.already_present == ("alpha.mp3",)
    assert result.extracted == ()


def test_ignores_a_destination_nested_in_the_source_on_a_second_run(
    music_library: Path,
) -> None:
    destination = music_library / "_export"
    extract(["alpha.mp3"], music_library, destination)

    result = extract(["alpha.mp3"], music_library, destination)

    assert result.already_present == ("alpha.mp3",)
    assert result.duplicates == ()


def test_records_a_duplicate_once_when_the_track_is_requested_twice(
    music_library: Path, tmp_path: Path
) -> None:
    result = extract(["beta.mp3", "beta.mp3"], music_library, tmp_path / "work")

    assert len(result.duplicates) == 1
    assert result.extracted == ("beta.mp3",)
    assert result.already_present == ("beta.mp3",)


def test_records_a_missing_track_and_carries_on(music_library: Path, tmp_path: Path) -> None:
    destination = tmp_path / "work"

    result = extract(["absent.mp3", "alpha.mp3"], music_library, destination)

    assert result.missing == ("absent.mp3",)
    assert result.extracted == ("alpha.mp3",)


def test_records_a_failed_copy_and_carries_on(
    music_library: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def refuse(self: Path, target: Path) -> None:
        raise PermissionError(13, "Permission denied")

    monkeypatch.setattr(Path, "copy", refuse)

    result = extract(["alpha.mp3"], music_library, tmp_path / "work")

    assert result.failures == (
        ExtractionFailure("alpha.mp3", ExtractionFailureReason.PERMISSION_DENIED),
    )


def test_a_failed_copy_does_not_stop_the_following_tracks(
    music_library: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[Path] = []

    def refuse_first(self: Path, target: Path) -> None:
        calls.append(self)
        if len(calls) == 1:
            raise OSError(28, "No space left on device")

    monkeypatch.setattr(Path, "copy", refuse_first)

    result = extract(["alpha.mp3", "delta.mp3"], music_library, tmp_path / "work")

    assert result.failures[0].reason is ExtractionFailureReason.DISK_FULL
    assert result.extracted == ("delta.mp3",)


def test_records_a_homonym_vanished_since_indexing_and_carries_on(
    music_library: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    stale_index = {
        "beta.mp3": (music_library / "singles" / "beta.mp3", music_library / "gone" / "beta.mp3"),
        "alpha.mp3": (music_library / "albums" / "alpha.mp3",),
    }
    monkeypatch.setattr(extraction, "build_source_index", lambda source, excluded: stale_index)

    result = extract(["beta.mp3", "alpha.mp3"], music_library, tmp_path / "work")

    assert result.failures == (ExtractionFailure("beta.mp3", ExtractionFailureReason.FILE_MISSING),)
    assert result.extracted == ("alpha.mp3",)


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        # winerror 32 fait de cette OSError une PermissionError : le code Windows
        # doit primer sur le type, sinon un verrou passe pour un refus de droits
        (
            OSError(32, "The process cannot access the file", None, 32),
            ExtractionFailureReason.FILE_LOCKED,
        ),
        (FileNotFoundError(2, "No such file or directory"), ExtractionFailureReason.FILE_MISSING),
        (OSError(errno.ENAMETOOLONG, "File name too long"), ExtractionFailureReason.PATH_TOO_LONG),
        (OSError(99, "unheard of"), ExtractionFailureReason.WRITE_FAILED),
    ],
    ids=["sharing_violation", "vanished_file", "overlong_path", "unknown_error"],
)
def test_maps_a_system_error_to_the_project_vocabulary(
    error: OSError, expected: ExtractionFailureReason
) -> None:
    reason = failure_reason(error)

    assert reason is expected


def test_reports_progress_once_per_track(music_library: Path, tmp_path: Path) -> None:
    seen: list[tuple[int, int]] = []

    extract(
        ["alpha.mp3", "absent.mp3", "delta.mp3"],
        music_library,
        tmp_path / "work",
        on_progress=lambda processed, total: seen.append((processed, total)),
    )

    assert seen == [(1, 3), (2, 3), (3, 3)]
