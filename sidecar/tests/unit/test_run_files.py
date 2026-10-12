"""Tests des fichiers horodates d'un run, partages par les dumps et les plans."""

from datetime import timedelta
from pathlib import Path

import pytest
from tagging_api import CREATED

from tagger.run_files import (
    created_at_of,
    newest_first,
    run_id_of,
    stamped_name,
    write_atomically,
)


def test_reads_back_the_time_of_a_stamped_name(tmp_path: Path) -> None:
    path = tmp_path / stamped_name(CREATED, "a3f9c1", ".json")

    created = created_at_of(path)

    assert created == CREATED


@pytest.mark.parametrize(
    "suffix", [".json", ".tmp", ".renames.ndjson"], ids=["json", "pending", "journal"]
)
def test_reads_back_the_run_of_a_stamped_name_whatever_its_suffix(
    tmp_path: Path, suffix: str
) -> None:
    path = tmp_path / stamped_name(CREATED, "a3f9c1", suffix)

    run_id = run_id_of(path)

    assert run_id == "a3f9c1"


def test_reads_no_time_on_a_name_that_is_not_stamped(tmp_path: Path) -> None:
    created = created_at_of(tmp_path / "notes.json")

    assert created is None


def test_lists_the_newest_files_first_and_skips_the_other_names(tmp_path: Path) -> None:
    oldest = tmp_path / stamped_name(CREATED - timedelta(days=2), "1b2c3d", ".json")
    newest = tmp_path / stamped_name(CREATED, "4d5e6f", ".json")
    for path in (
        oldest,
        newest,
        tmp_path / "notes.json",
        tmp_path / stamped_name(CREATED, "x", ".tmp"),
    ):
        path.write_text("{}", encoding="utf-8")

    listed = newest_first(tmp_path, ".json")

    assert listed == [newest, oldest]


def test_lists_nothing_in_a_missing_folder(tmp_path: Path) -> None:
    listed = newest_first(tmp_path / "absent", ".json")

    assert listed == []


def test_leaves_no_partial_file_when_the_replacement_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target = tmp_path / stamped_name(CREATED, "a3f9c1", ".json")

    def full_disk(_self: Path, _target: Path) -> Path:
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(Path, "replace", full_disk)

    with pytest.raises(OSError, match="No space left"):
        write_atomically(target, "{}")

    assert not any(tmp_path.iterdir())
