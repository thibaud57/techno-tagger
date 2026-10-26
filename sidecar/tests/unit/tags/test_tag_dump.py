import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import MappingProxyType
from typing import TYPE_CHECKING, Final

import pytest
from fs_listing import names
from pydantic import ValidationError
from stubs import raising, unlink_except
from tagging_records import (
    CREATED,
    FIRST_TRACK,
    GLOB_RUN,
    RUN_ID,
    SECOND_RUN_ID,
    SECOND_TRACK,
    UNKNOWN_RUN,
    UNREADABLE_CONTENTS,
)

from tagger.core.run_files import PENDING_SUFFIX
from tagger.tags.files import OriginalTags, TagField, TagSystem
from tagger.tags.tag_dump import (
    DumpEntry,
    TagDump,
    TagDumpEntryMissingError,
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

if TYPE_CHECKING:
    from tagger.core.identifiers import RunId, TrackId

ORIGIN: Final = OriginalTags(
    TagSystem.ID3,
    3,
    MappingProxyType({TagField.ARTIST: ("adam beyer",), TagField.BPM: ("130",)}),
)
VORBIS_ORIGIN: Final = OriginalTags(
    TagSystem.VORBIS,
    None,
    MappingProxyType({TagField.KEY: ("8A",)}),
    MappingProxyType({"INITIALKEY": ("8A",)}),
)
WRITTEN: Final = OriginalTags(
    TagSystem.ID3, 3, MappingProxyType({TagField.ARTIST: ("Adam Beyer",)})
)
RUN_FOLDER: Final = Path("D:/Sets/Octobre")
MIDNIGHT: Final = RUN_FOLDER / "Nova Pulse - Midnight Static.mp3"


def _entry(name: str, original: OriginalTags = ORIGIN) -> DumpEntry:
    return DumpEntry.of(RUN_FOLDER / name, original)


def _dump() -> TagDump:
    return TagDump(run_id=RUN_ID, created_at=CREATED, folder=RUN_FOLDER)


def _saved(folder: Path, *track_ids: TrackId) -> TagDump:
    """Dump du run `_dump()` ecrit dans `folder`, une entree d'origine par nom."""
    return save_entries(folder, _dump(), {track_id: _entry(track_id) for track_id in track_ids})


@pytest.mark.parametrize(
    "created_at",
    [CREATED, CREATED.astimezone(timezone(timedelta(hours=2)))],
    ids=["utc", "other-local-offset"],
)
def test_names_the_dump_after_its_utc_time_and_run(tmp_path: Path, created_at: datetime) -> None:
    dump = TagDump(run_id=RUN_ID, created_at=created_at, folder=RUN_FOLDER)

    path = dump_path(tmp_path, dump)

    assert path == tmp_path / "20261006T211403Z-a3f9c1.json"


def test_refuses_a_dump_dated_without_a_time_zone() -> None:
    with pytest.raises(ValidationError):
        TagDump(run_id=RUN_ID, created_at=CREATED.replace(tzinfo=None), folder=RUN_FOLDER)


@pytest.mark.parametrize("original", [ORIGIN, VORBIS_ORIGIN], ids=["id3", "vorbis-mirrors"])
def test_reloads_the_entries_it_saved(tmp_path: Path, original: OriginalTags) -> None:
    saved = save_entries(tmp_path, _dump(), {FIRST_TRACK: _entry(FIRST_TRACK, original)})

    reloaded = load_dump(dump_path(tmp_path, saved))

    assert reloaded == saved
    assert reloaded.entries[FIRST_TRACK].original_tags() == original


def test_never_replaces_an_entry_already_saved(tmp_path: Path) -> None:
    first = _saved(tmp_path, FIRST_TRACK)

    second = save_entries(
        tmp_path,
        first,
        {FIRST_TRACK: _entry(FIRST_TRACK, WRITTEN), SECOND_TRACK: _entry(SECOND_TRACK)},
    )

    reloaded = load_dump(dump_path(tmp_path, second))
    assert reloaded.entries[FIRST_TRACK].original_tags() == ORIGIN
    assert set(reloaded.entries) == {FIRST_TRACK, SECOND_TRACK}


def test_merges_onto_the_dump_on_disk(tmp_path: Path) -> None:
    _saved(tmp_path, FIRST_TRACK)

    saved = _saved(tmp_path, SECOND_TRACK)

    assert set(load_dump(dump_path(tmp_path, saved)).entries) == {FIRST_TRACK, SECOND_TRACK}


def test_records_the_renamed_path_without_rereading_the_disk(tmp_path: Path) -> None:
    saved = _saved(tmp_path, FIRST_TRACK, SECOND_TRACK)
    dump_path(tmp_path, saved).write_text("{not json", encoding="utf-8")

    updated = record_renamed_path(tmp_path, saved, FIRST_TRACK, MIDNIGHT)

    assert set(updated.entries) == {FIRST_TRACK, SECOND_TRACK}
    assert updated.entries[FIRST_TRACK].renamed_path == MIDNIGHT


def test_notes_a_rename_in_the_journal_without_rewriting_the_dump(tmp_path: Path) -> None:
    saved = _saved(tmp_path, FIRST_TRACK)
    before = dump_path(tmp_path, saved).read_bytes()

    record_renamed_path(tmp_path, saved, FIRST_TRACK, MIDNIGHT)

    assert dump_path(tmp_path, saved).read_bytes() == before
    lines = journal_path(dump_path(tmp_path, saved)).read_text(encoding="utf-8").splitlines()
    assert [json.loads(line) for line in lines] == [
        {"track_id": FIRST_TRACK, "renamed_path": str(MIDNIGHT)}
    ]


def test_forces_the_note_onto_the_disk_before_returning(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    saved = _saved(tmp_path, FIRST_TRACK)
    journal = journal_path(dump_path(tmp_path, saved))
    synced: list[bool] = []
    real_fsync = os.fsync

    def checking_fsync(descriptor: int) -> None:
        synced.append(journal.exists() and journal.stat().st_size > 0)
        real_fsync(descriptor)

    monkeypatch.setattr(os, "fsync", checking_fsync)

    record_renamed_path(tmp_path, saved, FIRST_TRACK, MIDNIGHT)

    assert synced == [True]


def test_merges_the_journal_into_the_entries_on_reload(tmp_path: Path) -> None:
    saved = _saved(tmp_path, FIRST_TRACK, SECOND_TRACK)
    record_renamed_path(tmp_path, saved, FIRST_TRACK, MIDNIGHT)

    reloaded = load_dump(dump_path(tmp_path, saved))

    assert reloaded.entries[FIRST_TRACK].renamed_path == MIDNIGHT
    assert reloaded.entries[SECOND_TRACK].renamed_path is None


def test_keeps_the_last_note_of_a_track(tmp_path: Path) -> None:
    saved = _saved(tmp_path, FIRST_TRACK)
    first = record_renamed_path(tmp_path, saved, FIRST_TRACK, MIDNIGHT)
    record_renamed_path(tmp_path, first, FIRST_TRACK, RUN_FOLDER / "Adam Beyer - Your Mind.mp3")

    reloaded = load_dump(dump_path(tmp_path, saved))

    assert reloaded.entries[FIRST_TRACK].renamed_path == RUN_FOLDER / "Adam Beyer - Your Mind.mp3"


def test_ignores_a_journal_line_cut_short_by_a_power_failure(tmp_path: Path) -> None:
    saved = _saved(tmp_path, FIRST_TRACK, SECOND_TRACK)
    noted = record_renamed_path(tmp_path, saved, FIRST_TRACK, MIDNIGHT)
    with journal_path(dump_path(tmp_path, saved)).open("ab") as journal:
        journal.write(b'{"track_id": "b.mp3", "renamed_pa')

    reloaded = load_dump(dump_path(tmp_path, saved))

    assert reloaded == noted


def test_ignores_a_note_of_a_track_the_dump_no_longer_holds(tmp_path: Path) -> None:
    saved = _saved(tmp_path, FIRST_TRACK)
    with journal_path(dump_path(tmp_path, saved)).open("a", encoding="utf-8") as journal:
        journal.write('{"track_id": "gone.mp3", "renamed_path": null}\n')

    reloaded = load_dump(dump_path(tmp_path, saved))

    assert reloaded == saved


def test_leaves_no_half_written_line_when_the_journal_cannot_be_synced(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    saved = _saved(tmp_path, FIRST_TRACK)
    noted = record_renamed_path(tmp_path, saved, FIRST_TRACK, MIDNIGHT)
    journal = journal_path(dump_path(tmp_path, saved))
    before = journal.read_bytes()

    monkeypatch.setattr(os, "fsync", raising(OSError(28, "No space left on device")))

    with pytest.raises(TagDumpWriteError, match="tag dump not written"):
        record_renamed_path(tmp_path, noted, FIRST_TRACK, None)

    assert journal.read_bytes() == before


def test_refuses_to_note_a_track_the_dump_does_not_hold(tmp_path: Path) -> None:
    saved = _saved(tmp_path, FIRST_TRACK)

    with pytest.raises(TagDumpEntryMissingError):
        record_renamed_path(tmp_path, saved, SECOND_TRACK, MIDNIGHT)

    assert not journal_path(dump_path(tmp_path, saved)).exists()


def test_rewrites_the_dump_with_the_merged_paths_then_deletes_the_journal(
    tmp_path: Path,
) -> None:
    saved = _saved(tmp_path, FIRST_TRACK)
    noted = record_renamed_path(tmp_path, saved, FIRST_TRACK, MIDNIGHT)

    rewrite_dump(tmp_path, noted)

    raw = json.loads(dump_path(tmp_path, saved).read_text(encoding="utf-8"))
    assert raw["entries"][FIRST_TRACK]["renamed_path"] == str(MIDNIGHT)
    assert not journal_path(dump_path(tmp_path, saved)).exists()


def test_leaves_the_dump_alone_when_there_is_no_journal_to_merge(tmp_path: Path) -> None:
    saved = _saved(tmp_path, FIRST_TRACK)
    dump_path(tmp_path, saved).write_text("kept as is", encoding="utf-8")

    rewrite_dump(tmp_path, saved)

    assert dump_path(tmp_path, saved).read_text(encoding="utf-8") == "kept as is"


def test_does_not_list_the_journal_as_a_dump(tmp_path: Path) -> None:
    saved = _saved(tmp_path, FIRST_TRACK)
    record_renamed_path(tmp_path, saved, FIRST_TRACK, MIDNIGHT)

    listed = dumps_newest_first(tmp_path)

    assert listed == [dump_path(tmp_path, saved)]


def test_merges_the_journal_before_adding_entries(tmp_path: Path) -> None:
    saved = _saved(tmp_path, FIRST_TRACK)
    record_renamed_path(tmp_path, saved, FIRST_TRACK, MIDNIGHT)

    merged = _saved(tmp_path, SECOND_TRACK)

    assert merged.entries[FIRST_TRACK].renamed_path == MIDNIGHT
    assert not journal_path(dump_path(tmp_path, saved)).exists()


def test_forgets_a_renamed_path_when_given_none(tmp_path: Path) -> None:
    saved = _saved(tmp_path, FIRST_TRACK)
    noted = record_renamed_path(tmp_path, saved, FIRST_TRACK, MIDNIGHT)

    updated = record_renamed_path(tmp_path, noted, FIRST_TRACK, None)

    assert load_dump(dump_path(tmp_path, updated)).entries[FIRST_TRACK].renamed_path is None


def test_moves_a_renamed_entry_after_the_others(tmp_path: Path) -> None:
    """Renomme en relance, apres les autres : le rollback doit lui rendre son nom en premier."""
    saved = _saved(tmp_path, FIRST_TRACK, SECOND_TRACK)

    updated = record_renamed_path(
        tmp_path, saved, FIRST_TRACK, tmp_path / "Adam Beyer - Your Mind.mp3"
    )

    assert list(load_dump(dump_path(tmp_path, updated)).entries) == [SECOND_TRACK, FIRST_TRACK]


def test_refuses_a_dump_of_an_unknown_version(tmp_path: Path) -> None:
    path = tmp_path / "20261006T211403Z-a3f9c1.json"
    path.write_text(json.dumps({"schema_version": 2, "run_id": "a3f9c1"}), encoding="utf-8")

    with pytest.raises(TagDumpUnreadableError, match="unreadable tag dump") as error:
        load_dump(path)

    assert error.value.params == {"file": path.name, "found": 2, "expected": 1}


@pytest.mark.parametrize(
    "content",
    [
        *UNREADABLE_CONTENTS,
        pytest.param('{"schema_version": 1, "run_id": 42}', id="invalid-fields"),
    ],
)
def test_refuses_an_unreadable_dump(tmp_path: Path, content: str) -> None:
    path = tmp_path / "20261006T211403Z-a3f9c1.json"
    path.write_text(content, encoding="utf-8")

    with pytest.raises(TagDumpUnreadableError):
        load_dump(path)


def test_forces_the_dump_onto_the_disk_before_it_takes_its_final_name(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target = dump_path(tmp_path, _dump())
    pending = target.with_suffix(PENDING_SUFFIX)
    synced: list[tuple[bool, bool]] = []
    real_fsync = os.fsync

    def checking_fsync(descriptor: int) -> None:
        synced.append((pending.stat().st_size > 0, target.exists()))
        real_fsync(descriptor)

    monkeypatch.setattr(os, "fsync", checking_fsync)

    _saved(tmp_path, FIRST_TRACK)

    assert synced == [(True, False)]


def test_leaves_no_partial_file_when_the_dump_cannot_be_written(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(Path, "replace", raising(OSError(28, "No space left on device")))

    with pytest.raises(TagDumpWriteError, match="tag dump not written"):
        _saved(tmp_path, FIRST_TRACK)

    assert names(tmp_path) == []


@pytest.mark.parametrize(
    ("expired", "kept"),
    [
        (
            ["20260905T211402Z-1b2c3d.json", "20260905T211402Z-1b2c3d.tmp"],
            [
                "20260919T000000Z-9e8f7a.json",
                "20260919T000000Z-9e8f7a.tmp",
                "notes.json",
                "notes.txt",
            ],
        ),
        (
            [
                "20260905T211402Z-1b2c3d.json",
                "20260905T211402Z-1b2c3d.renames.ndjson",
                "20260801T000000Z-9e8f7a.renames.ndjson",
            ],
            ["20260919T000000Z-4d5e6f.json", "20260919T000000Z-4d5e6f.renames.ndjson"],
        ),
    ],
    ids=["dumps-older-than-thirty-days", "journal-without-its-dump"],
)
def test_purges_the_files_of_runs_older_than_thirty_days(
    tmp_path: Path, expired: list[str], kept: list[str]
) -> None:
    for name in [*expired, *kept]:
        (tmp_path / name).write_text("{}", encoding="utf-8")

    purge_dumps(tmp_path, CREATED)

    assert names(tmp_path) == kept


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
    saved = _saved(tmp_path, FIRST_TRACK)
    other = TagDump(run_id=SECOND_RUN_ID, created_at=CREATED, folder=RUN_FOLDER)
    save_entries(tmp_path, other, {FIRST_TRACK: _entry(FIRST_TRACK)})

    found = find_dump(tmp_path, RUN_ID)

    assert found == dump_path(tmp_path, saved)


@pytest.mark.parametrize("run_id", [UNKNOWN_RUN, GLOB_RUN], ids=["unknown-run", "glob-pattern"])
def test_finds_no_dump_for_an_unknown_run(tmp_path: Path, run_id: RunId) -> None:
    _saved(tmp_path, FIRST_TRACK)

    found = find_dump(tmp_path, run_id)

    assert found is None


def test_lists_dumps_from_newest_to_oldest(tmp_path: Path) -> None:
    older = save_entries(
        tmp_path,
        TagDump(run_id=SECOND_RUN_ID, created_at=CREATED - timedelta(days=1), folder=RUN_FOLDER),
        {FIRST_TRACK: _entry(FIRST_TRACK)},
    )
    newer = _saved(tmp_path, FIRST_TRACK)

    listed = dumps_newest_first(tmp_path)

    assert listed == [dump_path(tmp_path, newer), dump_path(tmp_path, older)]


def test_lists_only_the_files_named_like_a_dump(tmp_path: Path) -> None:
    saved = _saved(tmp_path, FIRST_TRACK)
    (tmp_path / "notes.json").write_text("{}", encoding="utf-8")

    listed = dumps_newest_first(tmp_path)

    assert listed == [dump_path(tmp_path, saved)]


def test_lists_no_dump_in_a_missing_folder(tmp_path: Path) -> None:
    listed = dumps_newest_first(tmp_path / "absent")

    assert listed == []


def test_removes_restored_entries_and_keeps_the_others(tmp_path: Path) -> None:
    saved = _saved(tmp_path, FIRST_TRACK, SECOND_TRACK)

    updated = remove_entries(tmp_path, saved, {FIRST_TRACK})

    assert list(updated.entries) == [SECOND_TRACK]
    assert load_dump(dump_path(tmp_path, saved)) == updated


def test_deletes_a_dump_left_empty(tmp_path: Path) -> None:
    saved = _saved(tmp_path, FIRST_TRACK)

    remove_entries(tmp_path, saved, {FIRST_TRACK})

    assert not dump_path(tmp_path, saved).exists()


def test_removing_entries_rewrites_the_merged_dump_and_deletes_the_journal(
    tmp_path: Path,
) -> None:
    saved = _saved(tmp_path, FIRST_TRACK, SECOND_TRACK)
    record_renamed_path(tmp_path, saved, SECOND_TRACK, MIDNIGHT)

    remove_entries(tmp_path, load_dump(dump_path(tmp_path, saved)), {FIRST_TRACK})

    raw = json.loads(dump_path(tmp_path, saved).read_text(encoding="utf-8"))
    assert list(raw["entries"]) == [SECOND_TRACK]
    assert raw["entries"][SECOND_TRACK]["renamed_path"] == str(MIDNIGHT)
    assert not journal_path(dump_path(tmp_path, saved)).exists()


def test_deleting_a_dump_left_empty_deletes_its_journal(tmp_path: Path) -> None:
    saved = _saved(tmp_path, FIRST_TRACK)
    record_renamed_path(tmp_path, saved, FIRST_TRACK, MIDNIGHT)

    remove_entries(tmp_path, load_dump(dump_path(tmp_path, saved)), {FIRST_TRACK})

    assert names(tmp_path) == []
