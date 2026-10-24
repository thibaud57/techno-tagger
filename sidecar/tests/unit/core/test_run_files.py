import os
from datetime import timedelta
from pathlib import Path

import pytest
from fs_listing import names
from stubs import raising
from tagging_records import CREATED, FOURTH_RUN_ID, RUN_ID, SECOND_RUN_ID, THIRD_RUN_ID

from tagger.core.run_files import (
    created_at_of,
    newest_first,
    run_id_of,
    stamped_name,
    write_atomically,
)


def test_reads_back_the_time_of_a_stamped_name(tmp_path: Path) -> None:
    path = tmp_path / stamped_name(CREATED, RUN_ID, ".json")

    created = created_at_of(path)

    assert created == CREATED


@pytest.mark.parametrize(
    "suffix", [".json", ".tmp", ".renames.ndjson"], ids=["json", "pending", "journal"]
)
def test_reads_back_the_run_of_a_stamped_name_whatever_its_suffix(
    tmp_path: Path, suffix: str
) -> None:
    path = tmp_path / stamped_name(CREATED, RUN_ID, suffix)

    run_id = run_id_of(path)

    assert run_id == RUN_ID


def test_reads_no_time_on_a_name_that_is_not_stamped(tmp_path: Path) -> None:
    created = created_at_of(tmp_path / "notes.json")

    assert created is None


def test_lists_the_newest_files_first_and_skips_the_other_names(tmp_path: Path) -> None:
    oldest = tmp_path / stamped_name(CREATED - timedelta(days=2), THIRD_RUN_ID, ".json")
    newest = tmp_path / stamped_name(CREATED, FOURTH_RUN_ID, ".json")
    for path in (
        oldest,
        newest,
        tmp_path / "notes.json",
        tmp_path / stamped_name(CREATED, SECOND_RUN_ID, ".tmp"),
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
    target = tmp_path / stamped_name(CREATED, RUN_ID, ".json")

    monkeypatch.setattr(Path, "replace", raising(OSError(28, "No space left on device")))

    with pytest.raises(OSError, match="No space left"):
        write_atomically(target, "{}")

    assert names(tmp_path) == []


@pytest.mark.parametrize(("durable", "synced"), [(True, 1), (False, 0)], ids=["durable", "default"])
def test_syncs_the_pending_file_only_when_asked_to(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, durable: bool, synced: int
) -> None:
    syncs: list[int] = []
    monkeypatch.setattr(os, "fsync", syncs.append)

    write_atomically(tmp_path / stamped_name(CREATED, RUN_ID, ".json"), "{}", durable=durable)

    assert len(syncs) == synced
