from typing import TYPE_CHECKING

import pytest
from audio_samples import tagged_mp3
from ndjson_loop import (
    conversation,
    held_call,
    resolved_run,
    retried,
    rolled_back,
    sub,
    written_in_a_previous_session,
    written_run,
)
from tagging_api import ONE_TRACK, WRITTEN_NAME, FakeApi, knows_your_mind
from tagging_records import UNKNOWN_RUN

from tagger.run import rollback
from tagger.tags.files import read_original_tags

if TYPE_CHECKING:
    from pathlib import Path

pytestmark = [pytest.mark.asyncio, pytest.mark.usefixtures("_key")]


async def test_rolls_back_a_run_written_in_a_previous_session(folder: Path) -> None:
    origin = read_original_tags(folder / ONE_TRACK)
    run_id = await written_in_a_previous_session(folder)

    async with conversation() as talk:
        talk.send(command="get_rollback_target")
        target = await talk.expect("rollback_target")
        finished = await rolled_back(talk, run_id)
        talk.send(command="get_rollback_target")
        emptied = await talk.expect("rollback_target")

    run = sub(target, "run")
    assert (run["run_id"], run["folder"], run["tracks"]) == (run_id, str(folder), 1)
    assert (finished["restored"], finished["failed"]) == ([ONE_TRACK], [])
    assert emptied["run"] is None
    assert not (folder / WRITTEN_NAME).exists()
    assert read_original_tags(folder / ONE_TRACK) == origin


async def test_marks_a_restored_track_that_retry_leaves_alone(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await written_run(talk, folder)
        talk.send(command="rollback", run_id=run_id, track_id=ONE_TRACK)
        restored = await talk.expect("track_resolved", state="rolled_back")
        finished = await talk.expect("rollback_finished")
        second_write = await retried(talk, run_id)

    assert restored["track_id"] == ONE_TRACK
    assert restored["restorable"] is False
    assert (restored["after"], restored["source"]) == (None, None)
    assert restored["resolution"] == "auto"
    assert (finished["track_id"], finished["restored"]) == (ONE_TRACK, [ONE_TRACK])
    assert (second_write["written"], second_write["write_error"]) == (0, 0)
    assert (folder / ONE_TRACK).is_file()


async def test_reports_a_name_taken_track_as_failed_and_restores_it_once_freed(
    folder: Path,
) -> None:
    async with conversation() as talk:
        run_id = await written_run(talk, folder)
        intruder = folder / ONE_TRACK
        intruder.write_bytes(b"newcomer")

        blocked = await rolled_back(talk, run_id)
        rolled_back_while_blocked = [
            event for event in talk.events if event.get("state") == "rolled_back"
        ]
        intruder.unlink()
        freed = await rolled_back(talk, run_id)

    assert blocked["restored"] == []
    assert blocked["failed"] == [
        {"track_id": ONE_TRACK, "file_name": WRITTEN_NAME, "reason": "name_taken"}
    ]
    assert rolled_back_while_blocked == []
    assert (freed["restored"], freed["failed"]) == ([ONE_TRACK], [])
    assert (folder / ONE_TRACK).is_file()
    assert not (folder / WRITTEN_NAME).exists()


async def test_stops_offering_a_restore_for_a_track_forgotten_without_one(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await written_run(talk, folder)
        (folder / WRITTEN_NAME).unlink()

        talk.send(command="rollback", run_id=run_id)
        forgotten = await talk.expect("track_resolved", track_id=ONE_TRACK, restorable=False)
        finished = await talk.expect("rollback_finished")
        talk.send(command="rollback", run_id=run_id)
        refused = await talk.expect("error")

    assert forgotten["state"] == "written"
    assert finished["restored"] == []
    assert finished["failed"] == [
        {"track_id": ONE_TRACK, "file_name": WRITTEN_NAME, "reason": "file_missing"}
    ]
    assert refused["code"] == "rollback_unavailable"


async def test_keeps_offering_a_restore_for_a_failure_that_keeps_its_dump_entry(
    folder: Path,
) -> None:
    async with conversation() as talk:
        run_id = await written_run(talk, folder)
        (folder / ONE_TRACK).write_bytes(b"newcomer")
        before = len(talk.events)

        await rolled_back(talk, run_id)

    assert not [event for event in talk.events[before:] if event["event"] == "track_resolved"]


async def test_leaves_the_displayed_run_alone_when_rolling_back_an_older_one(
    tmp_path: Path, api: FakeApi
) -> None:
    knows_your_mind(api)
    conform = tagged_mp3(tmp_path / "conform", WRITTEN_NAME, "Adam Beyer", "Your Mind").parent

    async with conversation() as talk:
        first = await written_run(talk, conform)
        await resolved_run(talk, conform)
        finished = await rolled_back(talk, first)

    assert finished["restored"] == [WRITTEN_NAME]
    assert not [event for event in talk.events if event.get("state") == "rolled_back"]


async def test_refuses_a_rollback_without_dump() -> None:
    async with conversation() as talk:
        talk.send(command="rollback", run_id=UNKNOWN_RUN)
        error = await talk.expect("error")

    assert (error["code"], error["command"], error["params"]) == (
        "rollback_unavailable",
        "rollback",
        {"run_id": UNKNOWN_RUN, "track_id": None},
    )


async def test_shutdown_lets_a_rollback_finish(
    folder: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    held = held_call(monkeypatch, rollback, "restore_tags")

    async with conversation() as talk:
        run_id = await written_run(talk, folder)
        talk.send(command="rollback", run_id=run_id)
        await held.wait_reached()
        talk.send(command="cancel_run")
        talk.shut_down()
        held.release.set()
        finished = await talk.expect("rollback_finished")

    assert finished["restored"] == [ONE_TRACK]
    assert (folder / ONE_TRACK).is_file()
