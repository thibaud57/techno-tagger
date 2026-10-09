"""Tests de la phase d'ecriture d'un run : dump, tags, renommage, echecs et relance."""

from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, NoReturn

import pytest
from audio_samples import BLANK_WRITERS, held_open, tag
from mutagen import MutagenError
from scraper_responses import track_payload

from tagger import files, renaming, writing
from tagger.file_failures import FileFailureReason
from tagger.files import (
    IdentityTags,
    TagField,
    TagsUnreadableError,
    UnreadableReason,
    read_original_tags,
)
from tagger.renaming import RenamedTrack, RenameError
from tagger.scraper_client import Source, TrackCandidate
from tagger.tag_dump import TagDump, TagDumpWriteError, dump_path, load_dump
from tagger.tagging import (
    FailureReason,
    LiveRun,
    Resolution,
    TrackRecord,
    TrackResolved,
    TrackState,
)
from tagger.writing import RunWriter, WriteProgress, WriteSummary

if TYPE_CHECKING:
    from collections.abc import Callable

pytestmark = pytest.mark.asyncio

CREATED = datetime(2026, 10, 6, 21, 14, 3, tzinfo=UTC)
BEATPORT = TrackCandidate.model_validate(track_payload())
WRITTEN_NAME = "Adam Beyer - Your Mind (Extended Mix)"


def _track(folder: Path, name: str, state: TrackState | None = TrackState.RESOLVED) -> TrackRecord:
    """Fichier tague « adam beyer / your mind » et son morceau dans l'etat demande."""
    path = BLANK_WRITERS[name.rsplit(".", 1)[1]](folder / name)
    tag(path, artist=["adam beyer"], title=["your mind"])
    record = TrackRecord(track_id=name, path=path, identity=IdentityTags("adam beyer", "your mind"))
    match state:
        case TrackState.RESOLVED:
            return record.resolved(Resolution.AUTO, Source.BEATPORT, BEATPORT, None, None)
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


def _raising(error: BaseException) -> Callable[..., NoReturn]:
    """Remplacant d'une fonction qui leve toujours `error`."""

    def raise_error(*_args: object) -> NoReturn:
        raise error

    return raise_error


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
            "Your Mind (Extended Mix)",
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
    assert entry.fields[TagField.TITLE] == ("your mind",)
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
    monkeypatch.setattr(writing, "save_entries", _raising(TagDumpWriteError(tmp_path)))

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
    monkeypatch.setattr(writing, "read_original_tags", _raising(unreadable))

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
        writing, "rename_track", _raising(RenameError(track.path, FileFailureReason.FILE_LOCKED))
    )

    await _writer(live, tmp_path).write()

    record = _record(live, "a.mp3")
    assert (record.state, record.path) == (TrackState.WRITE_ERROR, track.path)
    assert read_original_tags(track.path).fields[TagField.TITLE] == ("Your Mind (Extended Mix)",)


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
async def test_keeps_a_written_track_when_the_dump_cannot_note_its_rename(
    tmp_path: Path, music: Path, monkeypatch: pytest.MonkeyPatch, error: Exception
) -> None:
    live = _run(_track(music, "a.mp3"))
    monkeypatch.setattr(writing, "record_renamed_path", _raising(error))

    summary = await _writer(live, tmp_path).write()

    assert summary == WriteSummary(written=1, failed=0)
    assert (music / f"{WRITTEN_NAME}.mp3").is_file()
    assert load_dump(_dump(tmp_path, live)).entries["a.mp3"].renamed_path is None


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
        "your mind",
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
            _raising(TagsUnreadableError(track.path, UnreadableReason.LOCKED)),
        )
        await writer.write()

    summary = await writer.retry()

    assert summary == WriteSummary(written=1, failed=0)
    assert set(load_dump(_dump(tmp_path, live)).entries) == {"a.mp3"}


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
    track = _track(music, "adam beyer - your mind (extended mix).mp3")
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
