import json
import logging
from pathlib import Path
from typing import TYPE_CHECKING, Final

import mutagen
import pytest
from audio_samples import held_open, locked_by_another_process, tagged_audio, write_not_audio
from cdn_doubles import JPEG, write_cover
from fs_listing import names
from log_capture import leaked
from mutagen.id3 import ID3
from path_limits import folder_leaving
from scraper_responses import BEATPORT_CANDIDATE
from stubs import failing_when, ignore, raising, spying
from tagging_api import must_record
from tagging_records import CREATED, RUN_ID

from tagger.core.file_failures import FileFailureReason
from tagger.resolution.scraper_client import Source
from tagger.run import writing
from tagger.run.models import (
    FailureReason,
    LiveRun,
    Resolution,
    TrackRecord,
    TrackResolved,
    TrackState,
    WriteOutcome,
)
from tagger.run.rollback import roll_back
from tagger.run.writing import RunWriter, WriteProgress
from tagger.tags import files
from tagger.tags.files import (
    IdentityTags,
    TagField,
    TagsUnreadableError,
    WrittenTags,
    project_tags,
    read_original_tags,
)
from tagger.tags.renaming import RenamedTrack, RenameError, RenamePlan
from tagger.tags.tag_dump import (
    TagDump,
    TagDumpEntryMissingError,
    TagDumpWriteError,
    dump_path,
    journal_path,
    load_dump,
    record_renamed_path,
    remove_entries,
)

if TYPE_CHECKING:
    from collections.abc import Callable
    from typing import NoReturn
    from unittest.mock import MagicMock

pytestmark = pytest.mark.asyncio

WRITTEN_STEM: Final = "Adam Beyer - Your Mind (Extended Mix)"


def _track(
    folder: Path,
    name: str,
    state: TrackState | None = TrackState.RESOLVED,
    artwork: Path | None = None,
) -> TrackRecord:
    """Fichier tague « adam beyer / your mind » et son morceau dans l'etat demande."""
    path = tagged_audio(folder, name, "adam beyer", "your mind")
    record = TrackRecord(
        track_id=name, path=path, identity=IdentityTags(artist="adam beyer", title="your mind")
    )
    match state:
        case TrackState.RESOLVED:
            return record.resolved(
                Resolution.AUTO, Source.BEATPORT, BEATPORT_CANDIDATE, None, artwork
            )
        case TrackState.UNRESOLVED:
            return record.unresolved(FailureReason.NO_RESULT)
        case _:
            return record


def _run(*records: TrackRecord) -> LiveRun:
    return LiveRun(RUN_ID, records[0].path.parent, records)


def _writer(
    live: LiveRun, dumps: Path, events: list[writing.WriteEvent] | None = None
) -> RunWriter:
    sink = events if events is not None else []
    return RunWriter(live, dumps, sink.append, now=lambda: CREATED)


def _dump(dumps: Path, live: LiveRun) -> Path:
    return dump_path(dumps, TagDump(run_id=live.run_id, created_at=CREATED, folder=live.folder))


async def test_writes_and_renames_every_resolved_track(music_folder: Path, dumps: Path) -> None:
    live = _run(_track(music_folder, "a.mp3"), _track(music_folder, "b.flac"))

    await _writer(live, dumps).write()

    for track_id, suffix in (("a.mp3", ".mp3"), ("b.flac", ".flac")):
        record = must_record(live, track_id)
        assert (record.state, record.restorable) == (TrackState.WRITTEN, True)
        assert record.path == music_folder / f"{WRITTEN_STEM}{suffix}"
        assert read_original_tags(record.path).fields[TagField.TITLE] == (
            "Your Mind (Extended Mix)",
        )


async def test_numbers_the_second_track_targeting_the_same_name(
    music_folder: Path, dumps: Path
) -> None:
    live = _run(_track(music_folder, "a.mp3"), _track(music_folder, "b.mp3"))

    await _writer(live, dumps).write()

    assert must_record(live, "a.mp3").path == music_folder / f"{WRITTEN_STEM}.mp3"
    assert must_record(live, "b.mp3").path == music_folder / f"{WRITTEN_STEM} (2).mp3"


async def test_never_touches_unresolved_or_pending_tracks(music_folder: Path, dumps: Path) -> None:
    unresolved = _track(music_folder, "u.mp3", TrackState.UNRESOLVED)
    pending = _track(music_folder, "p.mp3", None)
    before = {record.track_id: record.path.read_bytes() for record in (unresolved, pending)}
    live = _run(_track(music_folder, "a.mp3"), unresolved, pending)

    await _writer(live, dumps).write()

    for track_id, content in before.items():
        assert must_record(live, track_id).path.read_bytes() == content
    assert (must_record(live, "u.mp3").state, must_record(live, "p.mp3").state) == (
        TrackState.UNRESOLVED,
        None,
    )
    assert set(load_dump(_dump(dumps, live)).entries) == {"a.mp3"}


async def test_dumps_every_origin_before_writing_the_first_file(
    music_folder: Path, monkeypatch: pytest.MonkeyPatch, dumps: Path
) -> None:
    live = _run(_track(music_folder, "a.mp3"), _track(music_folder, "b.mp3"))
    dumped_at_first_write: list[set[str]] = []
    real_write = files.write_tags

    def spying_write(*args: object) -> object:
        if not dumped_at_first_write:
            dumped_at_first_write.append(set(load_dump(_dump(dumps, live)).entries))
        # Espion a signature libre : les arguments sont ceux que `write_tags` recoit.
        return real_write(*args)  # type: ignore[arg-type]

    monkeypatch.setattr(writing, "write_tags", spying_write)

    await _writer(live, dumps).write()

    assert dumped_at_first_write == [{"a.mp3", "b.mp3"}]
    entry = load_dump(_dump(dumps, live)).entries["a.mp3"]
    assert entry.fields[TagField.TITLE] == ("your mind",)
    assert entry.renamed_path == music_folder / f"{WRITTEN_STEM}.mp3"


async def test_stops_before_any_file_and_settles_no_track_when_the_dump_cannot_be_saved(
    tmp_path: Path, music_folder: Path, monkeypatch: pytest.MonkeyPatch, dumps: Path
) -> None:
    unreadable, readable = _track(music_folder, "u.mp3"), _track(music_folder, "a.mp3")
    before = {record.track_id: record.path.read_bytes() for record in (unreadable, readable)}
    live = _run(unreadable, readable)
    events: list[writing.WriteEvent] = []
    held = TagsUnreadableError(unreadable.path, FileFailureReason.FILE_LOCKED)
    monkeypatch.setattr(
        writing,
        "read_original_tags",
        failing_when(files.read_original_tags, held, lambda path: path == unreadable.path),
    )
    monkeypatch.setattr(writing, "save_entries", raising(TagDumpWriteError(tmp_path)))

    with pytest.raises(TagDumpWriteError):
        await _writer(live, dumps, events).write()

    assert events == []
    assert [record.state for record in live.snapshot().tracks] == [TrackState.RESOLVED] * 2
    assert {record.track_id: record.path.read_bytes() for record in (unreadable, readable)} == (
        before
    )


async def test_marks_a_locked_file_and_carries_on(music_folder: Path, dumps: Path) -> None:
    locked = _track(music_folder, "locked.mp3")
    live = _run(locked, _track(music_folder, "a.mp3"))

    with held_open(locked.path):
        await _writer(live, dumps).write()

    record = must_record(live, "locked.mp3")
    assert (record.state, record.failure_reason, record.restorable) == (
        TrackState.WRITE_ERROR,
        FileFailureReason.FILE_LOCKED,
        True,
    )
    assert must_record(live, "a.mp3").state is TrackState.WRITTEN


async def test_never_writes_a_track_whose_origin_cannot_be_read(
    music_folder: Path, monkeypatch: pytest.MonkeyPatch, dumps: Path
) -> None:
    track = _track(music_folder, "a.mp3")
    before = track.path.read_bytes()
    live = _run(track)
    monkeypatch.setattr(mutagen, "File", locked_by_another_process)

    await _writer(live, dumps).write()

    record = must_record(live, "a.mp3")
    assert (record.failure_reason, record.restorable) == (FileFailureReason.FILE_LOCKED, False)
    assert track.path.read_bytes() == before


async def test_marks_a_file_that_vanished_since_the_run_as_missing(
    music_folder: Path, dumps: Path
) -> None:
    track = _track(music_folder, "a.mp3")
    track.path.unlink()
    live = _run(track)

    await _writer(live, dumps).write()

    assert must_record(live, "a.mp3").failure_reason is FileFailureReason.FILE_MISSING


async def test_marks_a_failed_rename_after_written_tags(
    music_folder: Path, monkeypatch: pytest.MonkeyPatch, dumps: Path
) -> None:
    track = _track(music_folder, "a.mp3")
    live = _run(track)
    monkeypatch.setattr(
        RenamePlan, "apply", raising(RenameError(track.path, FileFailureReason.FILE_LOCKED))
    )

    await _writer(live, dumps).write()

    record = must_record(live, "a.mp3")
    assert (record.state, record.path) == (TrackState.WRITE_ERROR, track.path)
    assert read_original_tags(track.path).fields[TagField.TITLE] == ("Your Mind (Extended Mix)",)


async def test_notes_the_rename_target_before_the_file_moves(
    music_folder: Path, monkeypatch: pytest.MonkeyPatch, dumps: Path
) -> None:
    live = _run(_track(music_folder, "a.mp3"))
    seen: list[tuple[Path | None, bool]] = []
    real_apply = RenamePlan.apply

    def spying_apply(plan: RenamePlan) -> RenamedTrack:
        noted = load_dump(_dump(dumps, live)).entries["a.mp3"].renamed_path
        seen.append((noted, plan.path.is_file()))
        return real_apply(plan)

    monkeypatch.setattr(RenamePlan, "apply", spying_apply)

    await _writer(live, dumps).write()

    assert seen == [(music_folder / f"{WRITTEN_STEM}.mp3", True)]


@pytest.mark.parametrize(
    "error",
    [TagDumpWriteError(Path("dump.json")), TagDumpEntryMissingError()],
    ids=["dump-not-written", "entry-gone"],
)
async def test_refuses_the_rename_when_the_dump_cannot_note_it(
    music_folder: Path, monkeypatch: pytest.MonkeyPatch, error: Exception, dumps: Path
) -> None:
    track = _track(music_folder, "a.mp3")
    live = _run(track)
    writer = _writer(live, dumps)
    monkeypatch.setattr(writing, "record_renamed_path", raising(error))

    await writer.write()

    record = must_record(live, "a.mp3")
    assert (record.state, record.failure_reason, record.path) == (
        TrackState.WRITE_ERROR,
        FileFailureReason.WRITE_FAILED,
        track.path,
    )
    assert names(music_folder) == ["a.mp3"]
    assert load_dump(_dump(dumps, live)).entries["a.mp3"].renamed_path is None


async def test_rewrites_the_dump_once_with_the_final_paths_when_the_phase_ends(
    music_folder: Path, dumps: Path
) -> None:
    live = _run(_track(music_folder, "a.mp3"), _track(music_folder, "b.mp3"))

    await _writer(live, dumps).write()

    raw = json.loads(_dump(dumps, live).read_text(encoding="utf-8"))
    assert raw["folder"] == str(music_folder)
    assert raw["entries"]["a.mp3"]["renamed_path"] == str(music_folder / f"{WRITTEN_STEM}.mp3")
    assert raw["entries"]["b.mp3"]["renamed_path"] == str(music_folder / f"{WRITTEN_STEM} (2).mp3")
    assert not journal_path(_dump(dumps, live)).exists()


async def test_keeps_the_journal_as_the_truth_when_the_final_rewrite_fails(
    tmp_path: Path,
    music_folder: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    dumps: Path,
) -> None:
    live = _run(_track(music_folder, "a.mp3"))
    monkeypatch.setattr(writing, "rewrite_dump", raising(TagDumpWriteError(tmp_path)))

    await _writer(live, dumps).write()

    assert must_record(live, "a.mp3").state is TrackState.WRITTEN
    assert journal_path(_dump(dumps, live)).is_file()
    assert load_dump(_dump(dumps, live)).entries["a.mp3"].renamed_path == (
        music_folder / f"{WRITTEN_STEM}.mp3"
    )
    assert "reason=journal_kept" in caplog.text


async def test_rolls_back_a_renamed_file_after_a_cut_between_the_note_and_the_final_rewrite(
    music_folder: Path, monkeypatch: pytest.MonkeyPatch, dumps: Path
) -> None:
    live = _run(_track(music_folder, "a.mp3"))
    monkeypatch.setattr(writing, "rewrite_dump", ignore)
    await _writer(live, dumps).write()
    on_disk = json.loads(_dump(dumps, live).read_text(encoding="utf-8"))
    journal_kept = journal_path(_dump(dumps, live)).is_file()

    summary = await roll_back(dumps, live.run_id, None, ignore)

    assert on_disk["entries"]["a.mp3"]["renamed_path"] is None
    assert journal_kept
    assert summary.restored == ("a.mp3",)
    assert names(music_folder) == ["a.mp3"]
    assert read_original_tags(music_folder / "a.mp3").fields[TagField.TITLE] == ("your mind",)
    assert names(dumps) == []


async def test_rolls_back_the_tags_of_a_track_whose_rename_was_refused(
    tmp_path: Path, music_folder: Path, monkeypatch: pytest.MonkeyPatch, dumps: Path
) -> None:
    live = _run(_track(music_folder, "a.mp3"))
    writer = _writer(live, dumps)
    with monkeypatch.context() as patched:
        patched.setattr(writing, "record_renamed_path", raising(TagDumpWriteError(tmp_path)))
        await writer.write()

    summary = await roll_back(dumps, live.run_id, None, ignore)

    assert summary.restored == ("a.mp3",)
    assert summary.failed == ()
    assert read_original_tags(music_folder / "a.mp3").fields[TagField.TITLE] == ("your mind",)


def _failing_after_the_note() -> Callable[..., NoReturn]:
    """Renommage qui echoue apres sa note, comme un fichier verrouille au dernier moment."""
    return raising(RenameError(Path("a.mp3"), FileFailureReason.FILE_LOCKED))


async def test_forgets_the_noted_target_when_the_rename_then_fails(
    music_folder: Path, monkeypatch: pytest.MonkeyPatch, dumps: Path
) -> None:
    live = _run(_track(music_folder, "a.mp3"))
    monkeypatch.setattr(RenamePlan, "apply", _failing_after_the_note())

    await _writer(live, dumps).write()

    record = must_record(live, "a.mp3")
    assert (record.state, record.failure_reason) == (
        TrackState.WRITE_ERROR,
        FileFailureReason.FILE_LOCKED,
    )
    assert load_dump(_dump(dumps, live)).entries["a.mp3"].renamed_path is None


async def test_keeps_the_failure_when_the_noted_target_cannot_be_forgotten(
    music_folder: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    dumps: Path,
) -> None:
    live = _run(_track(music_folder, "a.mp3"))

    monkeypatch.setattr(RenamePlan, "apply", _failing_after_the_note())
    monkeypatch.setattr(
        writing,
        "record_renamed_path",
        failing_when(
            record_renamed_path,
            TagDumpWriteError(dumps),
            lambda _folder, _dump, _track_id, renamed: renamed is None,
        ),
    )

    await _writer(live, dumps).write()

    assert must_record(live, "a.mp3").failure_reason is FileFailureReason.FILE_LOCKED
    assert "reason=rename_note_kept" in caplog.text


@pytest.mark.parametrize(
    ("stage", "dumped"),
    [("write_tags", {"broken.mp3", "a.mp3"}), ("read_original_tags", {"a.mp3"})],
    ids=["write", "read-origin"],
)
async def test_settles_a_track_hit_by_an_unexpected_error_and_writes_the_others(
    tmp_path: Path,
    music_folder: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    captured_exceptions: MagicMock,
    dumps: Path,
    stage: str,
    dumped: set[str],
) -> None:
    broken = _track(music_folder, "broken.mp3")
    before = broken.path.read_bytes()
    live = _run(broken, _track(music_folder, "a.mp3"))
    corruption = ValueError("unexpected frame")
    monkeypatch.setattr(
        writing,
        stage,
        failing_when(getattr(files, stage), corruption, lambda path, *_: path == broken.path),
    )
    caplog.set_level(logging.INFO, logger="tagger.run.writing")

    await _writer(live, dumps).write()

    assert must_record(live, "broken.mp3").failure_reason is FileFailureReason.WRITE_FAILED
    assert must_record(live, "a.mp3").state is TrackState.WRITTEN
    assert broken.path.read_bytes() == before
    assert set(load_dump(_dump(dumps, live)).entries) == dumped
    errors = [r.getMessage() for r in caplog.records if r.levelno == logging.ERROR]
    private = [str(tmp_path), "broken.mp3", "a.mp3", "Your Mind", "Adam Beyer"]
    assert any("reason=write_failed" in message for message in errors)
    assert leaked(errors, private) == []
    captured_exceptions.assert_called_once_with(corruption)


async def test_retries_only_the_failures_and_keeps_the_dumped_origin(
    music_folder: Path, monkeypatch: pytest.MonkeyPatch, dumps: Path
) -> None:
    failing = _track(music_folder, "a.mp3")
    live = _run(failing, _track(music_folder, "b.mp3"))
    writer = _writer(live, dumps)
    held = RenameError(failing.path, FileFailureReason.FILE_LOCKED)
    with monkeypatch.context() as patched:
        patched.setattr(
            RenamePlan,
            "apply",
            failing_when(RenamePlan.apply, held, lambda plan: plan.path == failing.path),
        )
        await writer.write()
    written_paths: list[Path] = []
    monkeypatch.setattr(writing, "write_tags", spying(files.write_tags, written_paths))

    await writer.retry()

    assert must_record(live, "a.mp3").state is TrackState.WRITTEN
    assert written_paths == [failing.path]
    assert load_dump(_dump(dumps, live)).entries["a.mp3"].fields[TagField.TITLE] == ("your mind",)


async def test_retry_reads_the_origin_a_failed_read_missed(
    music_folder: Path, monkeypatch: pytest.MonkeyPatch, dumps: Path
) -> None:
    track = _track(music_folder, "a.mp3")
    live = _run(track)
    writer = _writer(live, dumps)
    with monkeypatch.context() as patched:
        patched.setattr(
            writing,
            "read_original_tags",
            raising(TagsUnreadableError(track.path, FileFailureReason.FILE_LOCKED)),
        )
        await writer.write()

    await writer.retry()

    assert must_record(live, "a.mp3").state is TrackState.WRITTEN
    assert set(load_dump(_dump(dumps, live)).entries) == {"a.mp3"}


async def test_retry_dumps_again_an_origin_a_rollback_consumed(
    music_folder: Path, dumps: Path
) -> None:
    """Un rollback du run affiche retire du disque l'entree d'un echec que le writer garde."""
    locked = _track(music_folder, "a.mp3")
    live = _run(locked)
    writer = _writer(live, dumps)
    with held_open(locked.path):
        await writer.write()
    remove_entries(dumps, load_dump(_dump(dumps, live)), {"a.mp3"})

    await writer.retry()

    assert load_dump(_dump(dumps, live)).entries["a.mp3"].fields[TagField.TITLE] == ("your mind",)


async def test_emits_each_track_then_the_progress(music_folder: Path, dumps: Path) -> None:
    live = _run(_track(music_folder, "a.mp3"), _track(music_folder, "b.mp3"))
    events: list[writing.WriteEvent] = []

    await _writer(live, dumps, events).write()

    kinds = [type(event) for event in events]
    assert kinds == [TrackResolved, WriteProgress, TrackResolved, WriteProgress]
    assert events[-1] == WriteProgress(processed=2, total=2)


async def test_keeps_a_correctly_named_file_and_records_no_rename(
    music_folder: Path, dumps: Path
) -> None:
    track = _track(music_folder, f"{WRITTEN_STEM}.mp3")
    live = _run(track)

    await _writer(live, dumps).write()

    record = must_record(live, track.track_id)
    assert (record.state, record.path) == (TrackState.WRITTEN, track.path)
    assert load_dump(_dump(dumps, live)).entries[track.track_id].renamed_path is None


async def test_records_a_rename_that_only_changes_the_case(music_folder: Path, dumps: Path) -> None:
    track = _track(music_folder, "adam beyer - your mind (extended mix).mp3")
    live = _run(track)

    await _writer(live, dumps).write()

    noted = load_dump(_dump(dumps, live)).entries[track.track_id].renamed_path
    assert str(noted) == str(music_folder / f"{WRITTEN_STEM}.mp3")
    assert names(music_folder) == [f"{WRITTEN_STEM}.mp3"]


async def test_marks_a_corrupt_file_as_write_failed(music_folder: Path, dumps: Path) -> None:
    path = write_not_audio(music_folder / "broken.mp3")
    record = TrackRecord(
        track_id="broken.mp3", path=path, identity=IdentityTags(artist="", title="")
    )
    live = _run(record.resolved(Resolution.AUTO, Source.BEATPORT, BEATPORT_CANDIDATE, None, None))

    await _writer(live, dumps).write()

    assert must_record(live, "broken.mp3").failure_reason is FileFailureReason.WRITE_FAILED


async def test_writes_the_cached_cover_onto_the_file(
    tmp_path: Path, music_folder: Path, dumps: Path
) -> None:
    live = _run(_track(music_folder, "a.mp3", artwork=write_cover(tmp_path)))

    await _writer(live, dumps).write()

    record = must_record(live, "a.mp3")
    assert [frame.data for frame in ID3(record.path).getall("APIC")] == [JPEG]
    assert record.written is not None
    assert record.written.written.artwork is True


@pytest.mark.parametrize(
    "make_cover", [write_cover, lambda _folder: None], ids=["with-cover", "without-cover"]
)
async def test_reports_what_the_write_put_on_the_file(
    tmp_path: Path, music_folder: Path, make_cover: Callable[[Path], Path | None], dumps: Path
) -> None:
    cover = make_cover(tmp_path)
    live = _run(_track(music_folder, "a.mp3", artwork=cover))

    await _writer(live, dumps).write()

    assert must_record(live, "a.mp3").written == WriteOutcome(
        WrittenTags(fields=tuple(project_tags(BEATPORT_CANDIDATE)), artwork=cover is not None),
        truncated=False,
    )


async def test_reports_a_name_cut_to_fit_the_path_limit(tmp_path: Path, dumps: Path) -> None:
    music_folder = folder_leaving(tmp_path, room=40)
    live = _run(_track(music_folder, "a.mp3"))

    await _writer(live, dumps).write()

    record = must_record(live, "a.mp3")
    assert record.state is TrackState.WRITTEN
    assert record.written is not None
    assert record.written.truncated is True
    assert len(record.path.name) == 40


async def test_logs_the_phase_and_each_failure_without_any_file_name_or_title(
    tmp_path: Path, music_folder: Path, caplog: pytest.LogCaptureFixture, dumps: Path
) -> None:
    """Les logs partent vers Sentry : un nom de fichier ou un titre y serait une fuite."""
    gone = _track(music_folder, "gone.mp3")
    gone.path.unlink()
    live = _run(_track(music_folder, "a.mp3"), gone)
    caplog.set_level(logging.INFO, logger="tagger.run.writing")

    await _writer(live, dumps).write()

    records = [record for record in caplog.records if record.name == "tagger.run.writing"]
    messages = [record.getMessage() for record in records]
    private = [str(tmp_path), "a.mp3", "gone.mp3", WRITTEN_STEM, "Your Mind", "Adam Beyer"]
    assert [(record.levelno, record.getMessage()) for record in records] == [
        (logging.INFO, f"write phase started run={live.run_id}"),
        (
            logging.ERROR,
            f"write failed run={live.run_id} track={live.position('gone.mp3')} reason=file_missing",
        ),
        (logging.INFO, f"write phase finished run={live.run_id}"),
    ]
    assert leaked(messages, private) == []
