"""Tests de l'index du dossier source et du departage des homonymes."""

from typing import TYPE_CHECKING

import pytest

from tagger.extraction import (
    DuplicateCriterion,
    SourceFolderUnreadableError,
    build_source_index,
    pick_file,
)

if TYPE_CHECKING:
    from pathlib import Path


def test_indexes_files_across_subfolders(music_library: Path) -> None:
    index = build_source_index(music_library)

    assert "alpha.mp3" in index


def test_groups_homonyms_under_one_key(music_library: Path) -> None:
    index = build_source_index(music_library)

    assert len(index["beta.mp3"]) == 2


def test_keys_are_lowercased_for_windows(music_library: Path) -> None:
    index = build_source_index(music_library)

    assert "delta.mp3" in index


def test_ignores_directories(music_library: Path) -> None:
    index = build_source_index(music_library)

    assert "albums" not in index


def test_leaves_no_entry_for_a_name_the_source_does_not_hold(music_library: Path) -> None:
    index = build_source_index(music_library)

    assert "absent.mp3" not in index


def test_skips_an_excluded_subfolder(music_library: Path) -> None:
    index = build_source_index(music_library, excluded=music_library / "singles")

    assert "delta.mp3" not in index
    assert len(index["beta.mp3"]) == 1


def test_raises_on_a_missing_source_folder(tmp_path: Path) -> None:
    missing = tmp_path / "absent"

    with pytest.raises(SourceFolderUnreadableError) as excinfo:
        build_source_index(missing)

    assert excinfo.value.params == {"folder": "absent"}


def test_raises_when_the_source_is_a_file(tmp_path: Path) -> None:
    not_a_folder = tmp_path / "track.mp3"
    not_a_folder.write_bytes(b"\x00")

    with pytest.raises(SourceFolderUnreadableError):
        build_source_index(not_a_folder)


def test_keeps_the_largest_of_two_homonyms(music_library: Path) -> None:
    index = build_source_index(music_library)

    kept, resolution = pick_file("beta.mp3", index["beta.mp3"])

    assert kept.parent.name == "singles"
    assert resolution is not None
    assert resolution.criterion is DuplicateCriterion.LARGEST_FILE


def test_records_the_discarded_candidate_with_path_and_size(music_library: Path) -> None:
    index = build_source_index(music_library)

    _, resolution = pick_file("beta.mp3", index["beta.mp3"])

    assert resolution is not None
    assert [(candidate.path.parent.name, candidate.size) for candidate in resolution.discarded] == [
        ("albums", 5_000)
    ]


def test_breaks_a_size_tie_on_path_order(music_library: Path) -> None:
    index = build_source_index(music_library)

    kept, resolution = pick_file("gamma.mp3", index["gamma.mp3"])

    assert kept.parent.name == "aaa"
    assert resolution is not None
    assert resolution.criterion is DuplicateCriterion.PATH_ORDER


def test_is_deterministic_across_two_runs(music_library: Path) -> None:
    first, _ = pick_file("gamma.mp3", build_source_index(music_library)["gamma.mp3"])
    second, _ = pick_file("gamma.mp3", build_source_index(music_library)["gamma.mp3"])

    assert first == second


def test_reports_no_resolution_for_a_single_candidate(music_library: Path) -> None:
    index = build_source_index(music_library)

    kept, resolution = pick_file("alpha.mp3", index["alpha.mp3"])

    assert kept.name == "alpha.mp3"
    assert resolution is None
