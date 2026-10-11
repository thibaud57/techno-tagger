"""Tests de la phase d'ecriture d'un run : dump, tags, renommage, echecs et relance."""

import logging
from pathlib import Path
from typing import TYPE_CHECKING
from unittest.mock import patch

import pytest
from audio_samples import BLANK_WRITERS, held_open, tag
from mutagen import MutagenError
from mutagen.id3 import ID3
from path_limits import folder_leaving
from scraper_responses import payload_candidate
from stubs import raising
from tagging_api import CREATED, JPEG

from tagger import files, renaming, writing
from tagger.file_failures import FileFailureReason
from tagger.files import (
    IdentityTags,
    TagField,
    TagsUnreadableError,
    UnreadableReason,
    project_tags,
    read_original_tags,
)
from tagger.renaming import RenamedTrack, RenameError
from tagger.rollback import roll_back
from tagger.scraper_client import Source
from tagger.tag_dump import (
    TagDump,
    TagDumpWriteError,
    dump_path,
    load_dump,
    record_renamed_path,
    remove_entries,
)
from tagger.tagging import (
    FailureReason,
    LiveRun,
    Resolution,
    TrackRecord,
    TrackResolved,
    TrackState,
    WriteOutcome,
)
from tagger.writing import RunWriter, WriteProgress, WriteSummary

if TYPE_CHECKING:
    from collections.abc import Callable

pytestmark = pytest.mark.asyncio

BEATPORT = payload_candidate()
WRITTEN_NAME = "Lior Vance - Dim Orbit (Extended Mix)"


def _track(
    folder: Path,
    name: str,
    state: TrackState | None = TrackState.RESOLVED,
    artwork: Path | None = None,
) -> TrackRecord:
    """Fichier tague « lior vance / dim orbit » et son morceau dans l'etat demande."""
    path = BLANK_WRITERS[name.rsplit(".", 1)[1]](folder / name)
    tag(path, artist=["lior vance"], title=["dim orbit"])
    record = TrackRecord(track_id=name, path=path, identity=IdentityTags("lior vance", "dim orbit"))
    match state:
        case TrackState.RESOLVED:
            return record.resolved(Resolution.AUTO, Source.BEATPORT, BEATPORT, None, artwork)
        case TrackState.UNRESOLVED:
            return record.unresolved(FailureReason.NO_RESULT)
        case _:
            return record


def _run(*records: TrackRecord) -> LiveRun:
    return LiveRun("a3f9c1", records[0].path.parent, records)


def _writer(
    live: LiveRun, tmp_path: Path, events: list[writing.WriteEvent] | None = None
) -> RunWriter:
    sink = events if events is not None else []
    return RunWriter(live, tmp_path / "dumps", sink.append, now=lambda: CREATED)


def _dump(tmp_path: Path, live: LiveRun) -> Path:
    return dump_path(tmp_path / "dumps", TagDump(run_id=live.run_id, created_at=CREATED))


def _record(live: LiveRun, track_id: str) -> TrackRecord:
    record = live.record(track_id)
    assert record is not None
    return record


def _names(folder: Path) -> list[str]:
    return sorted(path.name for path in folder.iterdir())


@pytest.fixture
def music(tmp_path: Path) -> Path:
    folder = tmp_path / "music"
    folder.mkdir()
    return folder


async def test_writes_and_renames_every_resolved_track(tmp_path: Path, music: Path) -> None:
    live = _run(_track(music, "a.mp3"), _track(music, "b.flac"))

    summary = await _writer(live, tmp_path).write()

    assert summary == WriteSummary(written=2, failed=0)
    for track_id, suffix in (("a.mp3", ".mp3"), ("b.flac", ".flac")):
        record = _record(live, track_id)
        assert record.state is TrackState.WRITTEN
        assert record.path == music / f"{WRITTEN_NAME}{suffix}"
        assert read_original_tags(record.path).fields[TagField.TITLE] == (
            "Dim Orbit (Extended Mix)",
        )


async def test_numbers_the_second_track_targeting_the_same_name(
    tmp_path: Path, music: Path
) -> None:
    live = _run(_track(music, "a.mp3"), _track(music, "b.mp3"))

    await _writer(live, tmp_path).write()

    assert _record(live, "a.mp3").path == music / f"{WRITTEN_NAME}.mp3"
    assert _record(live, "b.mp3").path == music / f"{WRITTEN_NAME} (2).mp3"


async def test_never_touches_unresolved_or_pending_tracks(tmp_path: Path, music: Path) -> None:
    unresolved = _track(music, "u.mp3", TrackState.UNRESOLVED)
    pending = _track(music, "p.mp3", None)
    before = {record.track_id: record.path.read_bytes() for record in (unresolved, pending)}
    live = _run(_track(music, "a.mp3"), unresolved, pending)

    await _writer(live, tmp_path).write()

    for track_id, content in before.items():
        assert _record(live, track_id).path.read_bytes() == content
    assert (_record(live, "u.mp3").state, _record(live, "p.mp3").state) == (
        TrackState.UNRESOLVED,
        None,
    )
    assert set(load_dump(_dump(tmp_path, live)).entries) == {"a.mp3"}


async def test_dumps_every_origin_before_writing_the_first_file(
    tmp_path: Path, music: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    live = _run(_track(music, "a.mp3"), _track(music, "b.mp3"))
    dumped_at_first_write: list[set[str]] = []
    real_write = files.write_tags

    def spying_write(*args: object) -> object:
        if not dumped_at_first_write:
            dumped_at_first_write.append(set(load_dump(_dump(tmp_path, live)).entries))
        return real_write(*args)  # type: ignore[arg-type]

    monkeypatch.setattr(writing, "write_tags", spying_write)

    await _writer(live, tmp_path).write()

    assert dumped_at_first_write == [{"a.mp3", "b.mp3"}]
    entry = load_dump(_dump(tmp_path, live)).entries["a.mp3"]
    assert entry.fields[TagField.TITLE] == ("dim orbit",)
    assert entry.renamed_path == music / f"{WRITTEN_NAME}.mp3"


async def test_stops_before_any_file_and_settles_no_track_when_the_dump_cannot_be_saved(
    tmp_path: Path, music: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    unreadable, readable = _track(music, "u.mp3"), _track(music, "a.mp3")
    before = {record.track_id: record.path.read_bytes() for record in (unreadable, readable)}
    live = _run(unreadable, readable)
    events: list[writing.WriteEvent] = []
    real_read = files.read_original_tags

    def held_one(path: Path) -> object:
        if path == unreadable.path:
            raise TagsUnreadableError(path, UnreadableReason.LOCKED)
        return real_read(path)

    monkeypatch.setattr(writing, "read_original_tags", held_one)
    monkeypatch.setattr(writing, "save_entries", raising(TagDumpWriteError(tmp_path)))

    with pytest.raises(TagDumpWriteError):
        await _writer(live, tmp_path, events).write()

    assert events == []
    assert [record.state for record in live.snapshot().tracks] == [TrackState.RESOLVED] * 2
    assert {record.track_id: record.path.read_bytes() for record in (unreadable, readable)} == (
        before
    )


async def test_marks_a_locked_file_and_carries_on(tmp_path: Path, music: Path) -> None:
    locked = _track(music, "locked.mp3")
    live = _run(locked, _track(music, "a.mp3"))

    with held_open(locked.path):
        summary = await _writer(live, tmp_path).write()

    assert summary == WriteSummary(written=1, failed=1)
    record = _record(live, "locked.mp3")
    assert (record.state, record.failure_reason) == (
        TrackState.WRITE_ERROR,
        FailureReason.FILE_LOCKED,
    )


async def test_never_writes_a_track_whose_origin_cannot_be_read(
    tmp_path: Path, music: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    track = _track(music, "a.mp3")
    before = track.path.read_bytes()
    live = _run(track)
    held = MutagenError("file in use")
    held.__cause__ = PermissionError(13, "Permission denied")
    unreadable = TagsUnreadableError(track.path, UnreadableReason.LOCKED)
    unreadable.__cause__ = held
    monkeypatch.setattr(writing, "read_original_tags", raising(unreadable))

    summary = await _writer(live, tmp_path).write()

    assert summary == WriteSummary(written=0, failed=1)
    assert _record(live, "a.mp3").failure_reason is FailureReason.FILE_LOCKED
    assert track.path.read_bytes() == before


async def test_marks_a_file_that_vanished_since_the_run_as_missing(
    tmp_path: Path, music: Path
) -> None:
    track = _track(music, "a.mp3")
    track.path.unlink()
    live = _run(track)

    summary = await _writer(live, tmp_path).write()

    assert summary == WriteSummary(written=0, failed=1)
    assert _record(live, "a.mp3").failure_reason is FailureReason.FILE_MISSING


async def test_marks_a_failed_rename_after_written_tags(
    tmp_path: Path, music: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    track = _track(music, "a.mp3")
    live = _run(track)
    monkeypatch.setattr(
        writing, "rename_track", raising(RenameError(track.path, FileFailureReason.FILE_LOCKED))
    )

    await _writer(live, tmp_path).write()

    record = _record(live, "a.mp3")
    assert (record.state, record.path) == (TrackState.WRITE_ERROR, track.path)
    assert read_original_tags(track.path).fields[TagField.TITLE] == ("Dim Orbit (Extended Mix)",)


async def test_notes_the_rename_target_before_the_file_moves(
    tmp_path: Path, music: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    live = _run(_track(music, "a.mp3"))
    seen: list[tuple[Path | None, bool]] = []
    real_rename = renaming.rename_track

    def spying_rename(
        path: Path, artist: str | None, title: str | None, before_rename: Callable[[Path], None]
    ) -> RenamedTrack:
        def spy(target: Path) -> None:
            before_rename(target)
            noted = load_dump(_dump(tmp_path, live)).entries["a.mp3"].renamed_path
            seen.append((noted, path.is_file()))

        return real_rename(path, artist, title, spy)

    monkeypatch.setattr(writing, "rename_track", spying_rename)

    await _writer(live, tmp_path).write()

    assert seen == [(music / f"{WRITTEN_NAME}.mp3", True)]


@pytest.mark.parametrize(
    "error",
    [TagDumpWriteError(Path("dump.json")), KeyError("a.mp3")],
    ids=["dump_not_written", "entry_gone"],
)
async def test_refuses_the_rename_when_the_dump_cannot_note_it(
    tmp_path: Path, music: Path, monkeypatch: pytest.MonkeyPatch, error: Exception
) -> None:
    track = _track(music, "a.mp3")
    live = _run(track)
    writer = _writer(live, tmp_path)
    monkeypatch.setattr(writing, "record_renamed_path", raising(error))

    summary = await writer.write()

    record = _record(live, "a.mp3")
    assert summary == WriteSummary(written=0, failed=1)
    assert (record.state, record.failure_reason, record.path) == (
        TrackState.WRITE_ERROR,
        FailureReason.WRITE_FAILED,
        track.path,
    )
    assert _names(music) == ["a.mp3"]
    assert load_dump(_dump(tmp_path, live)).entries["a.mp3"].renamed_path is None


async def test_rolls_back_the_tags_of_a_track_whose_rename_was_refused(
    tmp_path: Path, music: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    live = _run(_track(music, "a.mp3"))
    writer = _writer(live, tmp_path)
    with monkeypatch.context() as patched:
        patched.setattr(writing, "record_renamed_path", raising(TagDumpWriteError(tmp_path)))
        await writer.write()

    summary = await roll_back(tmp_path / "dumps", live.run_id, None, lambda *_: None)

    assert summary.restored == ("a.mp3",)
    assert summary.failed == ()
    assert read_original_tags(music / "a.mp3").fields[TagField.TITLE] == ("dim orbit",)


def _failing_after_the_note(
    path: Path, _artist: str | None, _title: str | None, note: Callable[[Path], None]
) -> RenamedTrack:
    """Renommage qui note sa cible puis echoue, comme un fichier verrouille au dernier moment."""
    note(path.with_name("Nova Pulse - Midnight Static.mp3"))
    raise RenameError(path, FileFailureReason.FILE_LOCKED)


async def test_forgets_the_noted_target_when_the_rename_then_fails(
    tmp_path: Path, music: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    live = _run(_track(music, "a.mp3"))
    monkeypatch.setattr(writing, "rename_track", _failing_after_the_note)

    await _writer(live, tmp_path).write()

    record = _record(live, "a.mp3")
    assert (record.state, record.failure_reason) == (
        TrackState.WRITE_ERROR,
        FailureReason.FILE_LOCKED,
    )
    assert load_dump(_dump(tmp_path, live)).entries["a.mp3"].renamed_path is None


async def test_keeps_the_failure_when_the_noted_target_cannot_be_forgotten(
    tmp_path: Path, music: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    live = _run(_track(music, "a.mp3"))

    def forgetting_fails(
        folder: Path, dump: TagDump, track_id: str, renamed: Path | None
    ) -> TagDump:
        if renamed is None:
            raise TagDumpWriteError(folder)
        return record_renamed_path(folder, dump, track_id, renamed)

    monkeypatch.setattr(writing, "rename_track", _failing_after_the_note)
    monkeypatch.setattr(writing, "record_renamed_path", forgetting_fails)

    summary = await _writer(live, tmp_path).write()

    assert summary == WriteSummary(written=0, failed=1)
    assert _record(live, "a.mp3").failure_reason is FailureReason.FILE_LOCKED
    assert "reason=rename_note_kept" in caplog.text


async def test_settles_a_track_hit_by_an_unexpected_error_and_writes_the_others(
    tmp_path: Path, music: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    broken = _track(music, "broken.mp3")
    live = _run(broken, _track(music, "a.mp3"))
    real_write = files.write_tags
    corruption = ValueError("unexpected frame")

    def corrupt_one(path: Path, *args: object) -> object:
        if path == broken.path:
            raise corruption
        return real_write(path, *args)  # type: ignore[arg-type]

    monkeypatch.setattr(writing, "write_tags", corrupt_one)
    caplog.set_level(logging.INFO, logger="tagger.writing")

    with patch("tagger.writing.sentry_sdk.capture_exception", autospec=True) as capture:
        summary = await _writer(live, tmp_path).write()

    assert summary == WriteSummary(written=1, failed=1)
    assert _record(live, "broken.mp3").failure_reason is FailureReason.WRITE_FAILED
    assert _record(live, "a.mp3").state is TrackState.WRITTEN
    errors = [r.getMessage() for r in caplog.records if r.levelno == logging.ERROR]
    private = [str(tmp_path), "broken.mp3", "a.mp3", "Dim Orbit", "Lior Vance"]
    assert any("reason=write_failed" in message for message in errors)
    assert [message for message in errors for secret in private if secret in message] == []
    capture.assert_called_once_with(corruption)


async def test_settles_a_track_whose_origin_read_fails_unexpectedly(
    tmp_path: Path, music: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    broken = _track(music, "broken.mp3")
    before = broken.path.read_bytes()
    live = _run(broken, _track(music, "a.mp3"))
    real_read = files.read_original_tags
    corruption = ValueError("unexpected frame")

    def corrupt_one(path: Path) -> object:
        if path == broken.path:
            raise corruption
        return real_read(path)

    monkeypatch.setattr(writing, "read_original_tags", corrupt_one)

    with patch("tagger.writing.sentry_sdk.capture_exception", autospec=True) as capture:
        summary = await _writer(live, tmp_path).write()

    assert summary == WriteSummary(written=1, failed=1)
    assert _record(live, "broken.mp3").failure_reason is FailureReason.WRITE_FAILED
    assert broken.path.read_bytes() == before
    assert set(load_dump(_dump(tmp_path, live)).entries) == {"a.mp3"}
    assert "reason=write_failed" in caplog.text
    capture.assert_called_once_with(corruption)


async def test_retries_only_the_failures_and_keeps_the_dumped_origin(
    tmp_path: Path, music: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    failing = _track(music, "a.mp3")
    live = _run(failing, _track(music, "b.mp3"))
    writer = _writer(live, tmp_path)
    real_rename = renaming.rename_track

    def held_once(path: Path, *args: object) -> object:
        if path == failing.path:
            raise RenameError(path, FileFailureReason.FILE_LOCKED)
        return real_rename(path, *args)  # type: ignore[arg-type]

    with monkeypatch.context() as patched:
        patched.setattr(writing, "rename_track", held_once)
        await writer.write()
    written_paths: list[Path] = []
    real_write = files.write_tags

    def recording_write(path: Path, *args: object) -> object:
        written_paths.append(path)
        return real_write(path, *args)  # type: ignore[arg-type]

    monkeypatch.setattr(writing, "write_tags", recording_write)

    summary = await writer.retry()

    assert summary == WriteSummary(written=1, failed=0)
    assert written_paths == [failing.path]
    assert load_dump(_dump(tmp_path, live)).entries["a.mp3"].fields[TagField.TITLE] == (
        "dim orbit",
    )


async def test_retry_reads_the_origin_a_failed_read_missed(
    tmp_path: Path, music: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    track = _track(music, "a.mp3")
    live = _run(track)
    writer = _writer(live, tmp_path)
    with monkeypatch.context() as patched:
        patched.setattr(
            writing,
            "read_original_tags",
            raising(TagsUnreadableError(track.path, UnreadableReason.LOCKED)),
        )
        await writer.write()

    summary = await writer.retry()

    assert summary == WriteSummary(written=1, failed=0)
    assert set(load_dump(_dump(tmp_path, live)).entries) == {"a.mp3"}


async def test_retry_dumps_again_an_origin_a_rollback_consumed(tmp_path: Path, music: Path) -> None:
    """Un rollback du run affiche retire du disque l'entree d'un echec que le writer garde."""
    locked = _track(music, "a.mp3")
    live = _run(locked)
    writer = _writer(live, tmp_path)
    with held_open(locked.path):
        await writer.write()
    remove_entries(tmp_path / "dumps", load_dump(_dump(tmp_path, live)), {"a.mp3"})

    await writer.retry()

    assert load_dump(_dump(tmp_path, live)).entries["a.mp3"].fields[TagField.TITLE] == (
        "dim orbit",
    )


async def test_emits_each_track_then_the_progress(tmp_path: Path, music: Path) -> None:
    live = _run(_track(music, "a.mp3"), _track(music, "b.mp3"))
    events: list[writing.WriteEvent] = []

    await _writer(live, tmp_path, events).write()

    kinds = [type(event) for event in events]
    assert kinds == [TrackResolved, WriteProgress, TrackResolved, WriteProgress]
    assert events[-1] == WriteProgress(processed=2, total=2)


async def test_keeps_a_correctly_named_file_and_records_no_rename(
    tmp_path: Path, music: Path
) -> None:
    track = _track(music, f"{WRITTEN_NAME}.mp3")
    live = _run(track)

    await _writer(live, tmp_path).write()

    record = _record(live, track.track_id)
    assert (record.state, record.path) == (TrackState.WRITTEN, track.path)
    assert load_dump(_dump(tmp_path, live)).entries[track.track_id].renamed_path is None


async def test_records_a_rename_that_only_changes_the_case(tmp_path: Path, music: Path) -> None:
    track = _track(music, "lior vance - dim orbit (extended mix).mp3")
    live = _run(track)

    await _writer(live, tmp_path).write()

    noted = load_dump(_dump(tmp_path, live)).entries[track.track_id].renamed_path
    assert str(noted) == str(music / f"{WRITTEN_NAME}.mp3")
    assert _names(music) == [f"{WRITTEN_NAME}.mp3"]


async def test_marks_a_corrupt_file_as_write_failed(tmp_path: Path, music: Path) -> None:
    path = music / "broken.mp3"
    path.write_bytes(b"not an audio file" * 16)
    record = TrackRecord(track_id="broken.mp3", path=path, identity=IdentityTags("", ""))
    live = _run(record.resolved(Resolution.AUTO, Source.BEATPORT, BEATPORT, None, None))

    await _writer(live, tmp_path).write()

    assert _record(live, "broken.mp3").failure_reason is FailureReason.WRITE_FAILED


def _cover(tmp_path: Path) -> Path:
    """Pochette telle que le cache la donne : un fichier JPEG."""
    cover = tmp_path / "cover.jpg"
    cover.write_bytes(JPEG)
    return cover


async def test_writes_the_cached_cover_onto_the_file(tmp_path: Path, music: Path) -> None:
    live = _run(_track(music, "a.mp3", artwork=_cover(tmp_path)))

    await _writer(live, tmp_path).write()

    record = _record(live, "a.mp3")
    assert [frame.data for frame in ID3(record.path).getall("APIC")] == [JPEG]
    assert record.written is not None
    assert record.written.artwork is True


@pytest.mark.parametrize("with_cover", [True, False], ids=["with-cover", "without-cover"])
async def test_reports_what_the_write_put_on_the_file(
    tmp_path: Path, music: Path, with_cover: bool
) -> None:
    cover = _cover(tmp_path) if with_cover else None
    live = _run(_track(music, "a.mp3", artwork=cover))

    await _writer(live, tmp_path).write()

    assert _record(live, "a.mp3").written == WriteOutcome(
        fields=tuple(project_tags(BEATPORT)), artwork=with_cover, truncated=False
    )


async def test_reports_a_name_cut_to_fit_the_path_limit(tmp_path: Path) -> None:
    music = folder_leaving(tmp_path, room=40)
    live = _run(_track(music, "a.mp3"))

    await _writer(live, tmp_path).write()

    record = _record(live, "a.mp3")
    assert record.state is TrackState.WRITTEN
    assert record.written is not None
    assert record.written.truncated is True
    assert len(record.path.name) == 40


async def test_logs_the_phase_and_each_failure_without_any_file_name_or_title(
    tmp_path: Path, music: Path, caplog: pytest.LogCaptureFixture
) -> None:
    """Les logs partent vers Sentry : un nom de fichier ou un titre y serait une fuite."""
    gone = _track(music, "gone.mp3")
    gone.path.unlink()
    live = _run(_track(music, "a.mp3"), gone)
    caplog.set_level(logging.INFO, logger="tagger.writing")

    await _writer(live, tmp_path).write()

    records = [record for record in caplog.records if record.name == "tagger.writing"]
    messages = [record.getMessage() for record in records]
    private = [str(tmp_path), "a.mp3", "gone.mp3", WRITTEN_NAME, "Dim Orbit", "Lior Vance"]
    assert [(record.levelno, record.getMessage()) for record in records] == [
        (logging.INFO, f"write phase started run={live.run_id}"),
        (
            logging.ERROR,
            f"write failed run={live.run_id} track={live.position('gone.mp3')} reason=file_missing",
        ),
        (logging.INFO, f"write phase finished run={live.run_id}"),
    ]
    assert [message for message in messages for secret in private if secret in message] == []
