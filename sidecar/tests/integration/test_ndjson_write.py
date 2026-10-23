import asyncio
from typing import TYPE_CHECKING
from unittest.mock import patch

import pytest
from ndjson_loop import (
    CHOOSE_ON_BEATPORT,
    EXPECT_TIMEOUT,
    LEAVING,
    UNKNOWN_RUN,
    committed,
    conversation,
    held_call,
    recover_by_url,
    resolved_run,
    retried,
    rolled_back,
    written_run,
)
from report_files import only_report, report_files
from run_plans import only_plan
from scraper_responses import BANDCAMP_TRACK, bandcamp_track_payload, ok
from stubs import raising, refusing_suffix
from tagging_api import BANDCAMP_TRACKS, ONE_TRACK, WRITTEN_NAME, FakeApi

from tagger import BUNDLE_IDENTIFIER, handlers
from tagger.core.api_key import SERVICE, USERNAME
from tagger.core.file_failures import FileFailureReason
from tagger.core.run_files import write_atomically
from tagger.reports import common as report_common
from tagger.reports.index import index_path, list_reports
from tagger.reports.tagging import load_tagging_report
from tagger.run import writing
from tagger.run.models import TrackState
from tagger.tags import files, tag_dump
from tagger.tags.files import TagsUnreadableError, TagSystem
from tagger.tags.tag_dump import TagDumpUnreadableError, TagDumpWriteError, dump_dir

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable
    from pathlib import Path
    from unittest.mock import MagicMock

    from memory_keyring import MemoryKeyring
    from ndjson_loop import Conversation


pytestmark = [pytest.mark.asyncio, pytest.mark.usefixtures("_key")]


async def test_writes_a_committed_run_end_to_end(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="commit_run", run_id=run_id)
        written = await talk.expect("track_resolved", track_id=ONE_TRACK, state="written")
        progress = await talk.expect("progress", phase="write")
        finished = await talk.expect("run_finished", phase="write")

    assert written["resolution"] == "auto"
    assert written["restorable"] is True
    assert (progress["processed"], progress["total"]) == (1, 1)
    assert (finished["written"], finished["write_error"]) == (1, 0)
    assert (folder / WRITTEN_NAME).is_file()
    assert list(dump_dir().glob(f"*-{run_id}.json"))


@pytest.mark.parametrize(
    ("arrange", "command", "another_run"),
    [
        (resolved_run, "commit_run", True),
        (resolved_run, "retry_write", True),
        (written_run, "commit_run", False),
        (resolved_run, "retry_write", False),
    ],
    ids=["commit-another-run", "retry-another-run", "second-commit", "retry-before-commit"],
)
async def test_refuses_a_write_the_run_is_not_open_to(
    folder: Path,
    arrange: Callable[[Conversation, Path], Awaitable[str]],
    command: str,
    another_run: bool,
) -> None:
    async with conversation() as talk:
        run_id = await arrange(talk, folder)
        talk.send(command=command, run_id=UNKNOWN_RUN if another_run else run_id)
        error = await talk.expect("error")

    assert (error["code"], error["command"]) == ("write_not_open", command)


@pytest.mark.parametrize(
    "decision",
    [
        CHOOSE_ON_BEATPORT,
        {"command": "switch_arbitration_source", "track_id": ONE_TRACK, "source": "beatport"},
        recover_by_url(),
    ],
    ids=["resolve-arbitration", "switch-arbitration-source", "resolve-by-url"],
)
async def test_refuses_decisions_once_the_run_is_committed(
    folder: Path, decision: dict[str, object]
) -> None:
    async with conversation() as talk:
        await written_run(talk, folder)
        talk.send(**decision)
        error = await talk.expect("error")

    assert (error["code"], error["command"], error["params"]) == (
        "run_committed",
        decision["command"],
        {"track_id": ONE_TRACK},
    )


@pytest.mark.parametrize(
    ("failure", "code"),
    [
        (TagDumpWriteError, "tag_dump_write_failed"),
        (TagDumpUnreadableError, "tag_dump_unreadable"),
    ],
    ids=["unwritable", "unreadable"],
)
async def test_lets_the_run_be_confirmed_again_when_the_dump_cannot_be_saved(
    folder: Path,
    monkeypatch: pytest.MonkeyPatch,
    failure: type[TagDumpWriteError | TagDumpUnreadableError],
    code: str,
) -> None:
    monkeypatch.setattr(writing, "save_entries", raising(failure(folder / "x.json")))

    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="commit_run", run_id=run_id)
        refused = await talk.expect("error")
        emitted_before = talk.events[: talk.events.index(refused)]
        untouched = not (folder / WRITTEN_NAME).exists()
        reopened = not only_plan().committed
        monkeypatch.setattr(writing, "save_entries", tag_dump.save_entries)
        finished = await committed(talk, run_id)

    assert (refused["code"], refused["command"]) == (code, "commit_run")
    assert untouched
    assert reopened
    assert not [
        event
        for event in emitted_before
        if event.get("phase") == "write" or event.get("state") in ("written", "write_error")
    ]
    assert (finished["written"], finished["write_error"]) == (1, 0)
    assert (folder / WRITTEN_NAME).is_file()


async def test_retries_a_failed_write(folder: Path, locked_writes: Callable[[], None]) -> None:
    lift = locked_writes

    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="commit_run", run_id=run_id)
        failed = await talk.expect("track_resolved", state="write_error")
        first = await talk.expect("run_finished", phase="write")
        lift()
        talk.send(command="retry_write", run_id=run_id)
        await talk.expect("track_resolved", state="written")
        second = await talk.expect("run_finished", phase="write")

    assert failed["failure_reason"] == "file_locked"
    assert (first["written"], first["write_error"]) == (0, 1)
    assert (second["written"], second["write_error"]) == (1, 0)
    assert (folder / WRITTEN_NAME).is_file()


async def test_flags_a_failure_restorable_only_once_its_origin_is_dumped(
    folder: Path, monkeypatch: pytest.MonkeyPatch, locked_writes: Callable[[], None]
) -> None:
    lift = locked_writes
    monkeypatch.setattr(
        writing,
        "read_original_tags",
        raising(TagsUnreadableError(folder / ONE_TRACK, FileFailureReason.FILE_LOCKED)),
    )

    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="commit_run", run_id=run_id)
        unreadable = await talk.expect("track_resolved", state="write_error")
        await talk.expect("run_finished", phase="write")
        monkeypatch.setattr(writing, "read_original_tags", files.read_original_tags)
        talk.send(command="retry_write", run_id=run_id)
        dumped = await talk.expect("track_resolved", state="write_error")
        await talk.expect("run_finished", phase="write")
        lift()
        talk.send(command="retry_write", run_id=run_id)
        written = await talk.expect("track_resolved", state="written")

    assert unreadable["restorable"] is False
    assert dumped["restorable"] is True
    assert written["restorable"] is True


@LEAVING
async def test_neither_cancel_nor_the_end_of_the_session_cuts_a_write(
    folder: Path, monkeypatch: pytest.MonkeyPatch, leave: Callable[[Conversation], None]
) -> None:
    held = held_call(monkeypatch, writing, "write_tags")
    closed = asyncio.Event()
    real_close = handlers.CurrentRun.close

    async def closing(self: handlers.CurrentRun) -> None:
        await real_close(self)
        closed.set()

    with patch.object(handlers.CurrentRun, "close", autospec=True, side_effect=closing):
        async with conversation() as talk:
            run_id = await resolved_run(talk, folder)
            talk.send(command="commit_run", run_id=run_id)
            await held.wait_reached()
            talk.send(command="cancel_run")
            talk.send(command="get_version")
            await talk.expect("version")
            leave(talk)
            async with asyncio.timeout(EXPECT_TIMEOUT):
                await closed.wait()
            finished_early = [
                event
                for event in talk.events
                if event["event"] == "run_finished" and event.get("phase") == "write"
            ]
            held.release.set()
            finished = await talk.expect("run_finished", phase="write")

    assert not finished_early
    assert finished["written"] == 1
    assert (folder / WRITTEN_NAME).is_file()


async def test_refuses_a_commit_while_a_gesture_is_in_flight(
    unresolved_folder: Path, api: FakeApi
) -> None:
    api.on(BANDCAMP_TRACKS, BANDCAMP_TRACK, ok(bandcamp_track_payload()))
    fetch = api.gate(BANDCAMP_TRACKS, BANDCAMP_TRACK)

    async with conversation() as talk:
        run_id = await resolved_run(talk, unresolved_folder)
        talk.send(**recover_by_url())
        await fetch.wait_reached()
        talk.send(command="commit_run", run_id=run_id)
        error = await talk.expect("error")
        fetch.release.set()
        await talk.expect("track_resolved", track_id=ONE_TRACK, resolution="url")

    assert (error["code"], error["command"]) == ("write_not_open", "commit_run")


def _report_texts(folder: Path) -> str:
    return "".join(path.read_text(encoding="utf-8") for path in report_files(folder))


async def test_leaves_the_tagging_report_in_the_folder(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await written_run(talk, folder)

    json_path, report = only_report(folder)
    assert report_files(folder) == [json_path, json_path.with_suffix(".md")]
    assert (report.run_id, report.counts.written) == (run_id, 1)
    assert [entry.report_path for entry in list_reports(index_path())] == [json_path]


async def test_keeps_the_api_key_and_the_data_folder_out_of_the_report(
    folder: Path, memory_keyring: MemoryKeyring
) -> None:
    api_key = memory_keyring.secrets[(SERVICE, USERNAME)]

    async with conversation() as talk:
        await written_run(talk, folder)

    reports = _report_texts(folder)
    assert api_key not in reports
    assert BUNDLE_IDENTIFIER not in reports


async def test_rewrites_the_same_report_after_a_retry(
    folder: Path, locked_writes: Callable[[], None]
) -> None:
    lift = locked_writes

    async with conversation() as talk:
        run_id = await written_run(talk, folder)
        json_path, first = only_report(folder)
        lift()
        await retried(talk, run_id)

    assert (first.counts.write_error, first.counts.written) == (1, 0)
    assert load_tagging_report(json_path).counts.written == 1
    assert report_files(folder) == [json_path, json_path.with_suffix(".md")]


async def test_leaves_the_report_untouched_by_a_rollback(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await written_run(talk, folder)
        before = _report_texts(folder)
        await rolled_back(talk, run_id)

    assert _report_texts(folder) == before
    assert load_tagging_report(only_report(folder)[0]).counts.written == 1


async def test_reports_a_restored_track_after_a_partial_rollback(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await written_run(talk, folder)
        await rolled_back(talk, run_id, ONE_TRACK)
        await retried(talk, run_id)

    _, report = only_report(folder)
    (restored,) = report.tracks
    assert (report.counts.rolled_back, report.counts.written) == (1, 0)
    assert (restored.state, restored.source, restored.scores, restored.url) == (
        TrackState.ROLLED_BACK,
        None,
        None,
        None,
    )
    assert restored.tags_before is not None
    assert restored.system is TagSystem.ID3


async def test_finishes_the_write_phase_when_the_report_cannot_be_written(
    folder: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    refusal = OSError(28, "No space left", "C:/private/profile/Music/x.json")
    monkeypatch.setattr(report_common, "write_atomically", raising(refusal))

    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        finished = await committed(talk, run_id)

    assert (finished["written"], finished["report_path"]) == (1, None)
    assert report_files(folder) == []
    assert list_reports(index_path()) == ()
    assert "tagging report not written run=" in caplog.text
    assert "reason=report_write_failed errno=28" in caplog.text
    assert "C:/private" not in caplog.text


async def test_finishes_the_write_phase_when_the_report_fails_unexpectedly(
    folder: Path,
    monkeypatch: pytest.MonkeyPatch,
    captured_exceptions: MagicMock,
) -> None:
    bug = ValueError("bug")
    monkeypatch.setattr(handlers, "write_tagging_report", raising(bug))

    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        finished = await committed(talk, run_id)

    assert (finished["written"], finished["report_path"]) == (1, None)
    assert list_reports(index_path()) == ()
    captured_exceptions.assert_called_once_with(bug)


async def test_keeps_one_pair_of_files_when_the_markdown_was_refused_once(
    folder: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    refusal = OSError(28, "No space left on device")
    monkeypatch.setattr(
        report_common, "write_atomically", refusing_suffix(write_atomically, ".md", refusal)
    )

    async with conversation() as talk:
        run_id = await written_run(talk, folder)
        monkeypatch.setattr(report_common, "write_atomically", write_atomically)
        await retried(talk, run_id)

    assert [path.suffix for path in report_files(folder)] == [".json", ".md"]
    assert len(list_reports(index_path())) == 1
