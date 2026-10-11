"""Protocole NDJSON de l'ecriture d'un run, de bout en bout sur la boucle."""

import asyncio
from typing import TYPE_CHECKING

import pytest
from ndjson_loop import EXPECT_TIMEOUT, conversation, held_call, resolved_run
from scraper_responses import BANDCAMP_TRACK, DIM_ORBIT, bandcamp_track_payload
from stubs import raising
from tagging_api import ONE_TRACK, WRITTEN_NAME, FakeApi, ok, one_track

from tagger import files, handlers, tag_dump, writing
from tagger.file_failures import FileFailureReason
from tagger.files import TagsUnreadableError, TagsWriteError
from tagger.tag_dump import TagDumpUnreadableError, TagDumpWriteError

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

pytestmark = [pytest.mark.asyncio, pytest.mark.usefixtures("_key")]


def _locked_until_lifted(monkeypatch: pytest.MonkeyPatch) -> Callable[[], None]:
    """Ecriture refusee comme un fichier verrouille ; rend de quoi lever le verrou."""

    def locked(path: Path, *_args: object) -> object:
        raise TagsWriteError(path, FileFailureReason.FILE_LOCKED)

    monkeypatch.setattr(writing, "write_tags", locked)
    return lambda: monkeypatch.setattr(writing, "write_tags", files.write_tags)


async def test_writes_a_committed_run_end_to_end(folder: Path, tmp_path: Path) -> None:
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
    assert list((tmp_path / "appdata").rglob(f"*-{run_id}.json"))


@pytest.mark.parametrize(
    "command", ["commit_run", "retry_write"], ids=["commit-run", "retry-write"]
)
async def test_refuses_writing_another_run(folder: Path, command: str) -> None:
    async with conversation() as talk:
        await resolved_run(talk, folder)
        talk.send(command=command, run_id="000000")
        error = await talk.expect("error")

    assert (error["code"], error["command"]) == ("write_not_open", command)


async def test_refuses_a_commit_while_the_network_phase_runs(folder: Path, api: FakeApi) -> None:
    gate = api.gate("/beatport/search", DIM_ORBIT)

    async with conversation() as talk:
        talk.send(command="start_tagging", folder=str(folder))
        started = await talk.expect("run_started")
        await gate.reached.wait()
        talk.send(command="commit_run", run_id=started["run_id"])
        error = await talk.expect("error")
        gate.release.set()
        await talk.expect("run_finished", phase="network")

    assert (error["code"], error["command"]) == ("write_not_open", "commit_run")


async def test_refuses_a_second_commit(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="commit_run", run_id=run_id)
        await talk.expect("run_finished", phase="write")
        talk.send(command="commit_run", run_id=run_id)
        error = await talk.expect("error")

    assert error["code"] == "write_not_open"


async def test_refuses_a_retry_before_any_commit(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="retry_write", run_id=run_id)
        error = await talk.expect("error")

    assert (error["code"], error["command"]) == ("write_not_open", "retry_write")


@pytest.mark.parametrize(
    "decision",
    [
        {"command": "resolve_arbitration", "source": "beatport", "candidate": 0},
        {"command": "switch_arbitration_source", "source": "beatport"},
        {"command": "resolve_by_url", "url": "https://x.bandcamp.com/track/y"},
    ],
    ids=["resolve-arbitration", "switch-arbitration-source", "resolve-by-url"],
)
async def test_refuses_decisions_once_the_run_is_committed(
    folder: Path, decision: dict[str, object]
) -> None:
    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="commit_run", run_id=run_id)
        await talk.expect("run_finished", phase="write")
        talk.send(track_id=ONE_TRACK, **decision)
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
        monkeypatch.setattr(writing, "save_entries", tag_dump.save_entries)
        talk.send(command="commit_run", run_id=run_id)
        finished = await talk.expect("run_finished", phase="write")

    assert (refused["code"], refused["command"]) == (code, "commit_run")
    assert untouched
    assert not [
        event
        for event in emitted_before
        if event.get("phase") == "write" or event.get("state") in ("written", "write_error")
    ]
    assert (finished["written"], finished["write_error"]) == (1, 0)
    assert (folder / WRITTEN_NAME).is_file()


async def test_retries_a_failed_write(folder: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    lift = _locked_until_lifted(monkeypatch)

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
    folder: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    lift = _locked_until_lifted(monkeypatch)
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


@pytest.mark.parametrize(
    "command",
    ["commit_run", "retry_write", "start_tagging"],
    ids=["commit-run", "retry-write", "start-tagging"],
)
async def test_refuses_writes_and_new_runs_while_writing(
    folder: Path, monkeypatch: pytest.MonkeyPatch, command: str
) -> None:
    held = held_call(monkeypatch, writing, "write_tags")

    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="commit_run", run_id=run_id)
        await held.wait_reached()
        if command == "start_tagging":
            talk.send(command=command, folder=str(folder))
        else:
            talk.send(command=command, run_id=run_id)
        error = await talk.expect("error")
        held.release.set()
        await talk.expect("run_finished", phase="write")

    assert (error["code"], error["params"], error["command"]) == (
        "phase_busy",
        {"phase": "write"},
        command,
    )


@pytest.mark.parametrize("ending", ["shutdown", "eof"], ids=["shutdown", "eof"])
async def test_neither_cancel_nor_the_end_of_the_session_cuts_a_write(
    folder: Path, monkeypatch: pytest.MonkeyPatch, ending: str
) -> None:
    held = held_call(monkeypatch, writing, "write_tags")
    closed = asyncio.Event()
    real_close = handlers.CurrentRun.close

    async def closing(self: handlers.CurrentRun) -> None:
        await real_close(self)
        closed.set()

    monkeypatch.setattr(handlers.CurrentRun, "close", closing)

    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="commit_run", run_id=run_id)
        await held.wait_reached()
        talk.send(command="cancel_run")
        talk.send(command="get_version")
        await talk.expect("version")
        if ending == "shutdown":
            talk.send(command="shutdown")
        else:
            talk.hang_up()
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
    tmp_path: Path, app_data: None, api: FakeApi
) -> None:
    api.on("/bandcamp/tracks", BANDCAMP_TRACK, ok(bandcamp_track_payload()))
    fetch = api.gate("/bandcamp/tracks", BANDCAMP_TRACK)
    unresolved = one_track(tmp_path)

    async with conversation() as talk:
        run_id = await resolved_run(talk, unresolved)
        talk.send(command="resolve_by_url", track_id=ONE_TRACK, url=BANDCAMP_TRACK)
        await fetch.reached.wait()
        talk.send(command="commit_run", run_id=run_id)
        error = await talk.expect("error")
        fetch.release.set()
        await talk.expect("track_resolved", track_id=ONE_TRACK, resolution="url")

    assert (error["code"], error["command"]) == ("write_not_open", "commit_run")
