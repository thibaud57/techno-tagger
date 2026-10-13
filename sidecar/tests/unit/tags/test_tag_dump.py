"""Tests du fichier de dump : ecriture, ajout sans ecrasement, relecture, purge."""

import json
import os
from datetime import timedelta, timezone
from pathlib import Path
from types import MappingProxyType
from typing import Final

import pytest
from pydantic import ValidationError
from stubs import raising, unlink_except
from tagging_api import CREATED

from tagger.tags.files import OriginalTags, TagField, TagSystem
from tagger.tags.tag_dump import (
    DumpEntry,
    TagDump,
    TagDumpUnreadableError,
    TagDumpWriteError,
    dump_path,
    dumps_newest_first,
    find_dump,
    journal_path,
    load_dump,
    purge_dumps,
    record_renamed_path,
    remove_entries,
    rewrite_dump,
    save_entries,
)

ORIGIN: Final = OriginalTags(
    TagSystem.ID3,
    3,
    MappingProxyType({TagField.ARTIST: ("adam beyer",), TagField.BPM: ("130",)}),
)
WRITTEN: Final = OriginalTags(
    TagSystem.ID3, 3, MappingProxyType({TagField.ARTIST: ("Adam Beyer",)})
)


RUN_FOLDER: Final = Path("D:/Sets/Octobre")


def _entry(name: str, original: OriginalTags = ORIGIN) -> DumpEntry:
    return DumpEntry.of(RUN_FOLDER / name, original)


def _dump() -> TagDump:
    return TagDump(run_id="a3f9c1", created_at=CREATED, folder=RUN_FOLDER)


def test_names_the_dump_after_its_time_and_run(tmp_path: Path) -> None:
    path = dump_path(tmp_path, _dump())

    assert path == tmp_path / "20261006T211403Z-a3f9c1.json"


def test_stamps_the_dump_name_in_utc_whatever_the_local_offset(tmp_path: Path) -> None:
    paris = CREATED.astimezone(timezone(timedelta(hours=2)))

    path = dump_path(tmp_path, TagDump(run_id="a3f9c1", created_at=paris, folder=RUN_FOLDER))

    assert path.name == "20261006T211403Z-a3f9c1.json"


def test_refuses_a_dump_dated_without_a_time_zone() -> None:
    with pytest.raises(ValidationError):
        TagDump(run_id="a3f9c1", created_at=CREATED.replace(tzinfo=None), folder=RUN_FOLDER)


def test_reloads_the_entries_it_saved(tmp_path: Path) -> None:
    saved = save_entries(tmp_path, _dump(), {"your mind.mp3": _entry("your mind.mp3")})

    reloaded = load_dump(dump_path(tmp_path, saved))

    assert reloaded == saved
    assert reloaded.entries["your mind.mp3"].original_tags() == ORIGIN


def test_never_replaces_an_entry_already_saved(tmp_path: Path) -> None:
    first = save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3")})

    second = save_entries(
        tmp_path, first, {"a.mp3": _entry("a.mp3", WRITTEN), "b.mp3": _entry("b.mp3")}
    )

    reloaded = load_dump(dump_path(tmp_path, second))
    assert reloaded.entries["a.mp3"].original_tags() == ORIGIN
    assert set(reloaded.entries) == {"a.mp3", "b.mp3"}


def test_merges_onto_the_dump_on_disk(tmp_path: Path) -> None:
    save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3")})

    saved = save_entries(tmp_path, _dump(), {"b.mp3": _entry("b.mp3")})

    assert set(load_dump(dump_path(tmp_path, saved)).entries) == {"a.mp3", "b.mp3"}


MIDNIGHT: Final = Path("D:/Sets/Octobre/Nova Pulse - Midnight Static.mp3")


def test_records_the_renamed_path_without_rereading_the_disk(tmp_path: Path) -> None:
    saved = save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3"), "b.mp3": _entry("b.mp3")})
    dump_path(tmp_path, saved).write_text("{not json", encoding="utf-8")

    updated = record_renamed_path(tmp_path, saved, "a.mp3", MIDNIGHT)

    assert set(updated.entries) == {"a.mp3", "b.mp3"}
    assert updated.entries["a.mp3"].renamed_path == MIDNIGHT


def test_notes_a_rename_in_the_journal_without_rewriting_the_dump(tmp_path: Path) -> None:
    saved = save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3")})
    before = dump_path(tmp_path, saved).read_bytes()

    record_renamed_path(tmp_path, saved, "a.mp3", MIDNIGHT)

    assert dump_path(tmp_path, saved).read_bytes() == before
    lines = journal_path(dump_path(tmp_path, saved)).read_text(encoding="utf-8").splitlines()
    assert [json.loads(line) for line in lines] == [
        {"track_id": "a.mp3", "renamed_path": str(MIDNIGHT)}
    ]


def test_forces_the_note_onto_the_disk_before_returning(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    saved = save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3")})
    journal = journal_path(dump_path(tmp_path, saved))
    synced: list[bool] = []
    real_fsync = os.fsync

    def checking_fsync(descriptor: int) -> None:
        synced.append(journal.exists() and journal.stat().st_size > 0)
        real_fsync(descriptor)

    monkeypatch.setattr(os, "fsync", checking_fsync)

    record_renamed_path(tmp_path, saved, "a.mp3", MIDNIGHT)

    assert synced == [True]


def test_merges_the_journal_into_the_entries_on_reload(tmp_path: Path) -> None:
    saved = save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3"), "b.mp3": _entry("b.mp3")})
    record_renamed_path(tmp_path, saved, "a.mp3", MIDNIGHT)

    reloaded = load_dump(dump_path(tmp_path, saved))

    assert reloaded.entries["a.mp3"].renamed_path == MIDNIGHT
    assert reloaded.entries["b.mp3"].renamed_path is None


def test_keeps_the_last_note_of_a_track(tmp_path: Path) -> None:
    saved = save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3")})
    first = record_renamed_path(tmp_path, saved, "a.mp3", MIDNIGHT)
    record_renamed_path(tmp_path, first, "a.mp3", RUN_FOLDER / "Adam Beyer - Your Mind.mp3")

    reloaded = load_dump(dump_path(tmp_path, saved))

    assert reloaded.entries["a.mp3"].renamed_path == RUN_FOLDER / "Adam Beyer - Your Mind.mp3"


def test_ignores_a_journal_line_cut_short_by_a_power_failure(tmp_path: Path) -> None:
    saved = save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3"), "b.mp3": _entry("b.mp3")})
    noted = record_renamed_path(tmp_path, saved, "a.mp3", MIDNIGHT)
    with journal_path(dump_path(tmp_path, saved)).open("ab") as journal:
        journal.write(b'{"track_id": "b.mp3", "renamed_pa')

    reloaded = load_dump(dump_path(tmp_path, saved))

    assert reloaded == noted


def test_ignores_a_note_of_a_track_the_dump_no_longer_holds(tmp_path: Path) -> None:
    saved = save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3")})
    with journal_path(dump_path(tmp_path, saved)).open("a", encoding="utf-8") as journal:
        journal.write('{"track_id": "gone.mp3", "renamed_path": null}\n')

    reloaded = load_dump(dump_path(tmp_path, saved))

    assert reloaded == saved


def test_leaves_no_half_written_line_when_the_journal_cannot_be_synced(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    saved = save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3")})
    noted = record_renamed_path(tmp_path, saved, "a.mp3", MIDNIGHT)
    journal = journal_path(dump_path(tmp_path, saved))
    before = journal.read_bytes()

    monkeypatch.setattr(os, "fsync", raising(OSError(28, "No space left on device")))

    with pytest.raises(TagDumpWriteError, match="tag dump not written"):
        record_renamed_path(tmp_path, noted, "a.mp3", None)

    assert journal.read_bytes() == before


def test_refuses_to_note_a_track_the_dump_does_not_hold(tmp_path: Path) -> None:
    saved = save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3")})

    with pytest.raises(KeyError):
        record_renamed_path(tmp_path, saved, "b.mp3", MIDNIGHT)

    assert not journal_path(dump_path(tmp_path, saved)).exists()


def test_rewrites_the_dump_with_the_merged_paths_then_deletes_the_journal(
    tmp_path: Path,
) -> None:
    saved = save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3")})
    noted = record_renamed_path(tmp_path, saved, "a.mp3", MIDNIGHT)

    rewrite_dump(tmp_path, noted)

    raw = json.loads(dump_path(tmp_path, saved).read_text(encoding="utf-8"))
    assert raw["entries"]["a.mp3"]["renamed_path"] == str(MIDNIGHT)
    assert not journal_path(dump_path(tmp_path, saved)).exists()


def test_leaves_the_dump_alone_when_there_is_no_journal_to_merge(tmp_path: Path) -> None:
    saved = save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3")})
    dump_path(tmp_path, saved).write_text("kept as is", encoding="utf-8")

    rewrite_dump(tmp_path, saved)

    assert dump_path(tmp_path, saved).read_text(encoding="utf-8") == "kept as is"


def test_does_not_list_the_journal_as_a_dump(tmp_path: Path) -> None:
    saved = save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3")})
    record_renamed_path(tmp_path, saved, "a.mp3", MIDNIGHT)

    listed = dumps_newest_first(tmp_path)

    assert listed == [dump_path(tmp_path, saved)]


def test_merges_the_journal_before_adding_entries(tmp_path: Path) -> None:
    saved = save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3")})
    record_renamed_path(tmp_path, saved, "a.mp3", MIDNIGHT)

    merged = save_entries(tmp_path, _dump(), {"b.mp3": _entry("b.mp3")})

    assert merged.entries["a.mp3"].renamed_path == MIDNIGHT
    assert not journal_path(dump_path(tmp_path, saved)).exists()


def test_forgets_a_renamed_path_when_given_none(tmp_path: Path) -> None:
    saved = save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3")})
    noted = record_renamed_path(tmp_path, saved, "a.mp3", MIDNIGHT)

    updated = record_renamed_path(tmp_path, noted, "a.mp3", None)

    assert load_dump(dump_path(tmp_path, updated)).entries["a.mp3"].renamed_path is None


def test_moves_a_renamed_entry_after_the_others(tmp_path: Path) -> None:
    """Renomme en relance, apres les autres : le rollback doit lui rendre son nom en premier."""
    saved = save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3"), "b.mp3": _entry("b.mp3")})

    updated = record_renamed_path(tmp_path, saved, "a.mp3", tmp_path / "Adam Beyer - Your Mind.mp3")

    assert list(load_dump(dump_path(tmp_path, updated)).entries) == ["b.mp3", "a.mp3"]


def test_refuses_a_dump_of_an_unknown_version(tmp_path: Path) -> None:
    path = tmp_path / "20261006T211403Z-a3f9c1.json"
    path.write_text(json.dumps({"schema_version": 2, "run_id": "a3f9c1"}), encoding="utf-8")

    with pytest.raises(TagDumpUnreadableError, match="unreadable tag dump") as error:
        load_dump(path)

    assert error.value.params == {"file": path.name, "found": 2, "expected": 1}


@pytest.mark.parametrize(
    "content",
    ["{not json", '{"schema_version": 1, "run_id": 42}'],
    ids=["broken-json", "invalid-fields"],
)
def test_refuses_an_unreadable_dump(tmp_path: Path, content: str) -> None:
    path = tmp_path / "20261006T211403Z-a3f9c1.json"
    path.write_text(content, encoding="utf-8")

    with pytest.raises(TagDumpUnreadableError):
        load_dump(path)


def test_leaves_no_partial_file_when_the_dump_cannot_be_written(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(Path, "replace", raising(OSError(28, "No space left on device")))

    with pytest.raises(TagDumpWriteError, match="tag dump not written"):
        save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3")})

    assert list(tmp_path.iterdir()) == []


def test_purges_dumps_older_than_thirty_days(tmp_path: Path) -> None:
    names = [
        "20260905T211402Z-1b2c3d.json",
        "20260905T211402Z-1b2c3d.tmp",
        "20260919T000000Z-9e8f7a.json",
        "20260919T000000Z-9e8f7a.tmp",
        "notes.json",
        "notes.txt",
    ]
    for name in names:
        (tmp_path / name).write_text("{}", encoding="utf-8")

    purge_dumps(tmp_path, CREATED)

    assert sorted(path.name for path in tmp_path.iterdir()) == names[2:]


def test_purge_deletes_an_expired_journal_even_without_its_dump(tmp_path: Path) -> None:
    names = [
        "20260905T211402Z-1b2c3d.json",
        "20260905T211402Z-1b2c3d.renames.ndjson",
        "20260801T000000Z-9e8f7a.renames.ndjson",
        "20260919T000000Z-4d5e6f.json",
        "20260919T000000Z-4d5e6f.renames.ndjson",
    ]
    for name in names:
        (tmp_path / name).write_text("{}", encoding="utf-8")

    purge_dumps(tmp_path, CREATED)

    assert sorted(path.name for path in tmp_path.iterdir()) == names[3:]


def test_purge_ignores_a_missing_folder(tmp_path: Path) -> None:
    purge_dumps(tmp_path / "dumps", CREATED)

    assert not (tmp_path / "dumps").exists()


def test_purge_carries_on_after_a_dump_it_cannot_delete(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    locked = tmp_path / "20260801T000000Z-1b2c3d.json"
    expired = tmp_path / "20260905T211402Z-9e8f7a.json"
    for path in (locked, expired):
        path.write_text("{}", encoding="utf-8")

    monkeypatch.setattr(Path, "unlink", unlink_except(locked))

    purge_dumps(tmp_path, CREATED)

    assert locked.exists()
    assert not expired.exists()
    assert "tag dump not purged run=1b2c3d reason=unlink_failed" in caplog.messages


def test_finds_the_dump_of_a_run(tmp_path: Path) -> None:
    saved = save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3")})
    other = TagDump(run_id="b7e2d4", created_at=CREATED, folder=RUN_FOLDER)
    save_entries(tmp_path, other, {"a.mp3": _entry("a.mp3")})

    found = find_dump(tmp_path, "a3f9c1")

    assert found == dump_path(tmp_path, saved)


@pytest.mark.parametrize("run_id", ["000000", "*"], ids=["unknown-run", "glob-pattern"])
def test_finds_no_dump_for_an_unknown_run(tmp_path: Path, run_id: str) -> None:
    save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3")})

    found = find_dump(tmp_path, run_id)

    assert found is None


def test_lists_dumps_from_newest_to_oldest(tmp_path: Path) -> None:
    older = save_entries(
        tmp_path,
        TagDump(run_id="b7e2d4", created_at=CREATED - timedelta(days=1), folder=RUN_FOLDER),
        {"a.mp3": _entry("a.mp3")},
    )
    newer = save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3")})

    listed = dumps_newest_first(tmp_path)

    assert listed == [dump_path(tmp_path, newer), dump_path(tmp_path, older)]


def test_lists_only_the_files_named_like_a_dump(tmp_path: Path) -> None:
    saved = save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3")})
    (tmp_path / "notes.json").write_text("{}", encoding="utf-8")

    listed = dumps_newest_first(tmp_path)

    assert listed == [dump_path(tmp_path, saved)]


def test_lists_no_dump_in_a_missing_folder(tmp_path: Path) -> None:
    listed = dumps_newest_first(tmp_path / "absent")

    assert listed == []


def test_removes_restored_entries_and_keeps_the_others(tmp_path: Path) -> None:
    saved = save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3"), "b.mp3": _entry("b.mp3")})

    updated = remove_entries(tmp_path, saved, {"a.mp3"})

    assert list(updated.entries) == ["b.mp3"]
    assert load_dump(dump_path(tmp_path, saved)) == updated


def test_deletes_a_dump_left_empty(tmp_path: Path) -> None:
    saved = save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3")})

    remove_entries(tmp_path, saved, {"a.mp3"})

    assert not dump_path(tmp_path, saved).exists()


def test_removing_entries_rewrites_the_merged_dump_and_deletes_the_journal(
    tmp_path: Path,
) -> None:
    saved = save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3"), "b.mp3": _entry("b.mp3")})
    record_renamed_path(tmp_path, saved, "b.mp3", MIDNIGHT)

    remove_entries(tmp_path, load_dump(dump_path(tmp_path, saved)), {"a.mp3"})

    raw = json.loads(dump_path(tmp_path, saved).read_text(encoding="utf-8"))
    assert list(raw["entries"]) == ["b.mp3"]
    assert raw["entries"]["b.mp3"]["renamed_path"] == str(MIDNIGHT)
    assert not journal_path(dump_path(tmp_path, saved)).exists()


def test_deleting_a_dump_left_empty_deletes_its_journal(tmp_path: Path) -> None:
    saved = save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3")})
    record_renamed_path(tmp_path, saved, "a.mp3", MIDNIGHT)

    remove_entries(tmp_path, load_dump(dump_path(tmp_path, saved)), {"a.mp3"})

    assert list(tmp_path.iterdir()) == []
