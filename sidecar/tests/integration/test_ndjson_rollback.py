"""Rollback d'un run sur la boucle NDJSON, dans la session qui l'a ecrit ou une suivante."""

from typing import TYPE_CHECKING

import pytest
from ndjson_loop import conversation, held_call, resolved_run, written_run
from scraper_responses import YOUR_MIND
from tagging_api import (
    ONE_TRACK,
    ORIGINAL,
    WRITTEN_NAME,
    FakeApi,
    found,
    tagged_mp3,
)

from tagger.run import rollback
from tagger.tags.files import read_original_tags

if TYPE_CHECKING:
    from pathlib import Path

pytestmark = [pytest.mark.asyncio, pytest.mark.usefixtures("_key")]


async def test_rolls_back_a_run_written_in_a_previous_session(folder: Path) -> None:
    origin = read_original_tags(folder / ONE_TRACK)
    async with conversation() as talk:
        run_id = await written_run(talk, folder)

    async with conversation() as talk:
        talk.send(command="get_rollback_target")
        target = await talk.expect("rollback_target")
        talk.send(command="rollback", run_id=run_id)
        finished = await talk.expect("rollback_finished")
        talk.send(command="get_rollback_target")
        emptied = await talk.expect("rollback_target")

    run = target["run"]
    assert isinstance(run, dict)
    assert (run["run_id"], run["folder"], run["tracks"]) == (run_id, str(folder), 1)
    assert (finished["restored"], finished["failed"]) == ([ONE_TRACK], [])
    assert emptied["run"] is None
    assert not (folder / WRITTEN_NAME).exists()
    assert read_original_tags(folder / ONE_TRACK) == origin


async def test_marks_a_restored_track_that_retry_leaves_alone(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await written_run(talk, folder)
        talk.send(command="rollback", run_id=run_id, track_id=ONE_TRACK)
        rolled_back = await talk.expect("track_resolved", state="rolled_back")
        finished = await talk.expect("rollback_finished")
        talk.send(command="retry_write", run_id=run_id)
        retried = await talk.expect("run_finished", phase="write")

    assert rolled_back["track_id"] == ONE_TRACK
    assert rolled_back["restorable"] is False
    assert (rolled_back["after"], rolled_back["source"]) == (None, None)
    assert (finished["track_id"], finished["restored"]) == (ONE_TRACK, [ONE_TRACK])
    assert (retried["written"], retried["write_error"]) == (0, 0)
    assert (folder / ONE_TRACK).is_file()


async def test_reports_a_name_taken_track_as_failed_and_restores_it_once_freed(
    folder: Path,
) -> None:
    async with conversation() as talk:
        run_id = await written_run(talk, folder)
        intruder = folder / ONE_TRACK
        intruder.write_bytes(b"newcomer")

        talk.send(command="rollback", run_id=run_id)
        blocked = await talk.expect("rollback_finished")
        rolled_back_while_blocked = [
            event for event in talk.events if event.get("state") == "rolled_back"
        ]
        intruder.unlink()
        talk.send(command="rollback", run_id=run_id)
        freed = await talk.expect("rollback_finished")

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

        talk.send(command="rollback", run_id=run_id)
        await talk.expect("rollback_finished")

    assert not [event for event in talk.events[before:] if event["event"] == "track_resolved"]


async def test_leaves_the_displayed_run_alone_when_rolling_back_an_older_one(
    tmp_path: Path, app_data: None, api: FakeApi
) -> None:
    api.on("/beatport/search", YOUR_MIND, found(ORIGINAL))
    conform = tagged_mp3(tmp_path / "conform", WRITTEN_NAME, "Adam Beyer", "Your Mind").parent
    async with conversation() as talk:
        first = await written_run(talk, conform)
        await resolved_run(talk, conform)
        talk.send(command="rollback", run_id=first)
        finished = await talk.expect("rollback_finished")

    assert finished["restored"] == [WRITTEN_NAME]
    assert not [event for event in talk.events if event.get("state") == "rolled_back"]


async def test_refuses_a_rollback_without_dump(app_data: None) -> None:
    async with conversation() as talk:
        talk.send(command="rollback", run_id="000000")
        error = await talk.expect("error")

    assert (error["code"], error["command"], error["params"]) == (
        "rollback_unavailable",
        "rollback",
        {"run_id": "000000", "track_id": None},
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
        talk.send(command="shutdown")
        held.release.set()
        finished = await talk.expect("rollback_finished")

    assert finished["restored"] == [ONE_TRACK]
    assert (folder / ONE_TRACK).is_file()
