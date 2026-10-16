import logging
import shutil
import time
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Final, NamedTuple

import pytest
from audio_samples import held_open, tagged_mp3
from log_capture import leaked, messages_of
from rename_samples import ORIGINAL_NAME, rename_now
from scraper_responses import BEATPORT_CANDIDATE
from stubs import failing_first, ignore, raising
from tagging_records import RUN_ID

from tagger.core.file_failures import FileFailureReason
from tagger.run import rollback
from tagger.run.models import FailureReason
from tagger.run.rollback import (
    RollbackFailure,
    RollbackTarget,
    RollbackUnavailableError,
    find_rollback_target,
    roll_back,
)
from tagger.tags.files import (
    OriginalTags,
    TagField,
    TagsWriteError,
    project_tags,
    read_original_tags,
    restore_tags,
    write_tags,
)
from tagger.tags.tag_dump import (
    DumpEntry,
    TagDump,
    TagDumpWriteError,
    dump_path,
    load_dump,
    save_entries,
)

if TYPE_CHECKING:
    from pathlib import Path

WRITTEN_AT: Final = datetime(2026, 10, 5, 21, 14, 3, tzinfo=UTC)
LOGGER: Final = "tagger.run.rollback"


class _Written(NamedTuple):
    """Morceau ecrit puis renomme comme par une phase d'ecriture, et son origine."""

    original: Path
    renamed: Path
    origin: OriginalTags
    entry: DumpEntry


def _write(folder: Path, name: str) -> _Written:
    path = tagged_mp3(folder, name, "adam beyer", "your mind")
    origin = read_original_tags(path)
    values = project_tags(BEATPORT_CANDIDATE)
    write_tags(path, values, None)
    renamed = rename_now(path, values.get(TagField.ARTIST), values.get(TagField.TITLE)).path
    entry = DumpEntry.of(path, origin).model_copy(update={"renamed_path": renamed})
    return _Written(path, renamed, origin, entry)


def _dumped(
    folder: Path,
    *tracks: _Written,
    run_id: str = RUN_ID,
    written_at: datetime = WRITTEN_AT,
    run_folder: Path | None = None,
) -> TagDump:
    entries = {track.original.name: track.entry for track in tracks}
    run = TagDump(
        run_id=run_id,
        created_at=written_at,
        folder=run_folder or tracks[0].original.parent,
    )
    return save_entries(folder, run, entries)


def _remove_tree(folder: Path) -> None:
    """Un fichier ecrit a l'instant peut rester tenu un court moment (antivirus, indexeur Windows) :
    `rmtree` echoue alors en `ENOTEMPTY` sans qu'aucun handle du sidecar ne fuie.
    """
    for attempt in range(5):
        try:
            shutil.rmtree(folder)
        except OSError:
            if attempt == 4:
                raise
            time.sleep(0.1)
        else:
            return


@pytest.mark.asyncio
async def test_gives_a_renamed_file_back_its_name_and_tags(music_folder: Path, dumps: Path) -> None:
    track = _write(music_folder, ORIGINAL_NAME)
    _dumped(dumps, track)
    restored: list[tuple[str, Path]] = []

    summary = await roll_back(
        dumps, RUN_ID, None, lambda track_id, path: restored.append((track_id, path))
    )

    assert (summary.restored, summary.failed) == ((ORIGINAL_NAME,), ())
    assert restored == [(ORIGINAL_NAME, track.original)]
    assert not track.renamed.exists()
    assert read_original_tags(track.original) == track.origin


@pytest.mark.asyncio
async def test_leaves_a_track_whose_original_name_is_taken_untouched(
    music_folder: Path, dumps: Path
) -> None:
    track = _write(music_folder, ORIGINAL_NAME)
    dump = _dumped(dumps, track)
    track.original.write_bytes(b"newcomer")
    written = read_original_tags(track.renamed)

    summary = await roll_back(dumps, RUN_ID, None, ignore)

    assert summary.failed == (
        RollbackFailure(
            track_id=ORIGINAL_NAME, file_name=track.renamed.name, reason=FailureReason.NAME_TAKEN
        ),
    )
    assert read_original_tags(track.renamed) == written
    assert track.original.read_bytes() == b"newcomer"
    assert load_dump(dump_path(dumps, dump)).entries.keys() == {ORIGINAL_NAME}


@pytest.mark.asyncio
async def test_reports_a_file_gone_under_both_names(music_folder: Path, dumps: Path) -> None:
    track = _write(music_folder, ORIGINAL_NAME)
    _dumped(dumps, track)
    track.renamed.unlink()

    summary = await roll_back(dumps, RUN_ID, None, ignore)

    assert summary.failed == (
        RollbackFailure(
            track_id=ORIGINAL_NAME,
            file_name=track.renamed.name,
            reason=FileFailureReason.FILE_MISSING,
        ),
    )


@pytest.mark.asyncio
async def test_leaves_the_tags_of_a_locked_file_untouched(music_folder: Path, dumps: Path) -> None:
    track = _write(music_folder, ORIGINAL_NAME)
    _dumped(dumps, track)
    written = read_original_tags(track.renamed)

    with held_open(track.renamed):
        summary = await roll_back(dumps, RUN_ID, None, ignore)

    assert [failure.reason for failure in summary.failed] == [FileFailureReason.FILE_LOCKED]
    assert read_original_tags(track.renamed) == written


@pytest.mark.asyncio
async def test_replays_a_track_whose_tags_failed_after_its_name_came_back(
    monkeypatch: pytest.MonkeyPatch, music_folder: Path, dumps: Path
) -> None:
    track = _write(music_folder, ORIGINAL_NAME)
    dump = _dumped(dumps, track)
    locked = TagsWriteError(track.original, FileFailureReason.FILE_LOCKED)
    monkeypatch.setattr(rollback, "restore_tags", failing_first(restore_tags, locked))

    first = await roll_back(dumps, RUN_ID, None, ignore)
    name_back = track.original.is_file() and not track.renamed.exists()
    kept = set(load_dump(dump_path(dumps, dump)).entries)
    second = await roll_back(dumps, RUN_ID, None, ignore)

    assert first.failed == (
        RollbackFailure(
            track_id=ORIGINAL_NAME, file_name=ORIGINAL_NAME, reason=FileFailureReason.FILE_LOCKED
        ),
    )
    assert (name_back, kept) == (True, {ORIGINAL_NAME})
    assert (second.restored, second.failed) == ((ORIGINAL_NAME,), ())
    assert read_original_tags(track.original) == track.origin


@pytest.mark.asyncio
async def test_restores_a_file_already_back_under_its_name(music_folder: Path, dumps: Path) -> None:
    track = _write(music_folder, ORIGINAL_NAME)
    _dumped(dumps, track)
    track.renamed.rename(track.original)

    summary = await roll_back(dumps, RUN_ID, None, ignore)

    assert summary.restored == (ORIGINAL_NAME,)
    assert read_original_tags(track.original) == track.origin


@pytest.mark.asyncio
async def test_gives_names_back_in_the_reverse_order_of_the_writing(
    music_folder: Path, dumps: Path
) -> None:
    first = _write(music_folder, "a.mp3")
    # Le second morceau prend, une fois le premier renomme, le nom d'origine de celui-ci.
    second_original = tagged_mp3(music_folder, "b.mp3", "adam beyer", "your mind")
    second_origin = read_original_tags(second_original)
    second_renamed = second_original.rename(first.original)
    second_entry = DumpEntry.of(second_original, second_origin).model_copy(
        update={"renamed_path": second_renamed}
    )
    _dumped(
        dumps,
        first,
        _Written(second_original, second_renamed, second_origin, second_entry),
    )

    summary = await roll_back(dumps, RUN_ID, None, ignore)

    assert summary.failed == ()
    assert summary.restored == ("b.mp3", "a.mp3")


@pytest.mark.asyncio
async def test_forgets_restored_and_vanished_tracks_and_keeps_the_others(
    music_folder: Path, dumps: Path
) -> None:
    restorable, vanished, taken = (
        _write(music_folder, name) for name in ("a.mp3", "b.mp3", "c.mp3")
    )
    dump = _dumped(dumps, restorable, vanished, taken)
    vanished.renamed.unlink()
    taken.original.write_bytes(b"newcomer")

    summary = await roll_back(dumps, RUN_ID, None, ignore)

    assert load_dump(dump_path(dumps, dump)).entries.keys() == {"c.mp3"}
    assert summary.forgotten == ("b.mp3",)


@pytest.mark.asyncio
async def test_keeps_the_dump_entry_of_a_track_whose_whole_folder_is_gone(
    music_folder: Path, dumps: Path
) -> None:
    track = _write(music_folder, ORIGINAL_NAME)
    dump = _dumped(dumps, track)
    _remove_tree(music_folder)

    summary = await roll_back(dumps, RUN_ID, None, ignore)

    assert [failure.reason for failure in summary.failed] == [FileFailureReason.FILE_MISSING]
    assert load_dump(dump_path(dumps, dump)).entries.keys() == {ORIGINAL_NAME}
    assert summary.forgotten == ()


@pytest.mark.asyncio
async def test_does_not_report_a_vanished_track_forgotten_when_the_dump_cannot_be_updated(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, music_folder: Path, dumps: Path
) -> None:
    track = _write(music_folder, ORIGINAL_NAME)
    dump = _dumped(dumps, track)
    track.renamed.unlink()
    monkeypatch.setattr(rollback, "remove_entries", raising(TagDumpWriteError(tmp_path)))

    summary = await roll_back(dumps, RUN_ID, None, ignore)

    assert summary.forgotten == ()
    assert load_dump(dump_path(dumps, dump)).entries.keys() == {ORIGINAL_NAME}


@pytest.mark.asyncio
async def test_deletes_the_dump_once_every_track_is_restored(
    music_folder: Path, dumps: Path
) -> None:
    dump = _dumped(dumps, _write(music_folder, ORIGINAL_NAME))

    await roll_back(dumps, RUN_ID, None, ignore)

    assert not dump_path(dumps, dump).exists()


@pytest.mark.asyncio
async def test_restores_the_tracks_even_when_the_dump_cannot_be_updated(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    music_folder: Path,
    dumps: Path,
) -> None:
    track = _write(music_folder, ORIGINAL_NAME)
    dump = _dumped(dumps, track)
    monkeypatch.setattr(rollback, "remove_entries", raising(TagDumpWriteError(tmp_path)))
    caplog.set_level(logging.WARNING, logger=LOGGER)

    summary = await roll_back(dumps, RUN_ID, None, ignore)

    assert (summary.restored, summary.failed) == ((ORIGINAL_NAME,), ())
    assert read_original_tags(track.original) == track.origin
    assert messages_of(caplog, LOGGER) == [f"tag dump not updated after rollback run={RUN_ID}"]
    assert load_dump(dump_path(dumps, dump)).entries.keys() == {ORIGINAL_NAME}


@pytest.mark.asyncio
async def test_logs_a_rollback_without_any_file_name_path_or_title(
    tmp_path: Path, caplog: pytest.LogCaptureFixture, music_folder: Path, dumps: Path
) -> None:
    """Les logs partent vers Sentry : un nom de fichier ou un titre y serait une fuite."""
    restorable, vanished = (
        _write(music_folder, ORIGINAL_NAME),
        _write(music_folder, "02 - untitled.mp3"),
    )
    _dumped(dumps, restorable, vanished)
    vanished.renamed.unlink()
    caplog.set_level(logging.INFO, logger=LOGGER)

    await roll_back(dumps, RUN_ID, None, ignore)

    messages = messages_of(caplog, LOGGER)
    private = [
        str(tmp_path),
        restorable.original.name,
        restorable.renamed.name,
        vanished.original.name,
        vanished.renamed.name,
        "Your Mind",
        "Adam Beyer",
    ]
    assert messages == [
        f"rollback started run={RUN_ID}",
        f"rollback failed run={RUN_ID} reason=file_missing",
        f"rollback finished run={RUN_ID}",
    ]
    assert leaked(messages, private) == []


@pytest.mark.asyncio
async def test_rolls_back_a_single_track_only(music_folder: Path, dumps: Path) -> None:
    first, second = _write(music_folder, "a.mp3"), _write(music_folder, "b.mp3")
    dump = _dumped(dumps, first, second)

    summary = await roll_back(dumps, RUN_ID, "a.mp3", ignore)

    assert summary.restored == ("a.mp3",)
    assert second.renamed.is_file()
    assert load_dump(dump_path(dumps, dump)).entries.keys() == {"b.mp3"}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("run_id", "track_id"),
    [("000000", None), (RUN_ID, "absent.mp3")],
    ids=["run-without-dump", "track-absent-from-dump"],
)
async def test_refuses_what_the_dump_cannot_restore(
    run_id: str, track_id: str | None, music_folder: Path, dumps: Path
) -> None:
    _dumped(dumps, _write(music_folder, ORIGINAL_NAME))

    with pytest.raises(RollbackUnavailableError) as error:
        await roll_back(dumps, run_id, track_id, ignore)

    assert error.value.params == {"run_id": run_id, "track_id": track_id}


def test_targets_the_newest_run_left_to_restore(music_folder: Path, dumps: Path) -> None:
    _dumped(
        dumps,
        _write(music_folder, "a.mp3"),
        run_id="b7e2d4",
        written_at=WRITTEN_AT - timedelta(days=1),
    )
    _dumped(dumps, _write(music_folder, "b.mp3"), _write(music_folder, "c.mp3"))

    target = find_rollback_target(dumps)

    assert target == RollbackTarget(
        run_id=RUN_ID, written_at=WRITTEN_AT, folder=music_folder, tracks=2
    )


def test_targets_the_folder_the_dump_records_not_one_deduced_from_the_files(
    music_folder: Path, dumps: Path
) -> None:
    _dumped(dumps, _write(music_folder / "sets", "a.mp3"), run_folder=music_folder)

    target = find_rollback_target(dumps)

    assert target is not None
    assert target.folder == music_folder


@pytest.mark.asyncio
async def test_targets_the_previous_run_once_the_newest_is_restored(
    music_folder: Path, dumps: Path
) -> None:
    _dumped(
        dumps,
        _write(music_folder, "a.mp3"),
        run_id="b7e2d4",
        written_at=WRITTEN_AT - timedelta(days=1),
    )
    _dumped(dumps, _write(music_folder, "b.mp3"))
    await roll_back(dumps, RUN_ID, None, ignore)

    target = find_rollback_target(dumps)

    assert target is not None
    assert target.run_id == "b7e2d4"


def test_skips_an_unreadable_dump(music_folder: Path, dumps: Path) -> None:
    _dumped(dumps, _write(music_folder, ORIGINAL_NAME))
    (dumps / "20261006T080000Z-b7e2d4.json").write_text("{", encoding="utf-8")

    target = find_rollback_target(dumps)

    assert target is not None
    assert target.run_id == RUN_ID


def test_targets_nothing_without_a_dump(dumps: Path) -> None:
    target = find_rollback_target(dumps)

    assert target is None
