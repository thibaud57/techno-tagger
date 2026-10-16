import json
from datetime import timedelta
from typing import TYPE_CHECKING, Final

import pytest
from ndjson_loop import (
    UNKNOWN_RUN,
    committed,
    conversation,
    resolved_run,
    start_command,
    sub,
)
from run_plans import music, only_plan, plan_files, plan_of, save_plan
from scraper_responses import BASIEL
from tagging_api import FIRST_TRACK, knows_your_mind
from tagging_records import CREATED, RUN_ID

from tagger.core.run_files import run_id_of, stamped_name
from tagger.run.models import FailureReason
from tagger.run.plan import plan_dir
from tagger.tags.tag_dump import dump_dir

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

    from memory_keyring import MemoryKeyring
    from tagging_api import FakeApi, Gate

    from tagger.run.models import TrackRecord

pytestmark = [pytest.mark.asyncio, pytest.mark.usefixtures("_key")]

OTHER_RUN: Final = "9e8f7a"


async def test_announces_no_interrupted_run_without_plans() -> None:
    async with conversation() as talk:
        talk.send(command="get_interrupted_run")
        announced = await talk.expect("interrupted_run")

    assert announced["run"] is None


async def test_announces_an_interrupted_run(tmp_path: Path) -> None:
    folder = tmp_path / "music"
    records = music(folder, 2)
    plan = plan_of(folder, [records[0].unresolved(FailureReason.NO_RESULT), records[1]])
    save_plan(plan_dir(), plan)

    async with conversation() as talk:
        talk.send(command="get_interrupted_run")
        announced = await talk.expect("interrupted_run")

    run = sub(announced, "run")
    assert (run["kind"], run["run_id"], run["processed"], run["total"]) == (
        "interrupted",
        RUN_ID,
        1,
        2,
    )
    assert run["folder_missing"] is False


@pytest.mark.parametrize(
    ("contents", "found"),
    [(json.dumps({"schema_version": 2}), 2), ("{not json", None)],
    ids=["other-version", "corrupt"],
)
async def test_announces_an_unreadable_plan(contents: str, found: int | None) -> None:
    plans = plan_dir()
    plans.mkdir(parents=True)
    (plans / stamped_name(CREATED, RUN_ID, ".json")).write_text(contents, encoding="utf-8")

    async with conversation() as talk:
        talk.send(command="get_interrupted_run")
        announced = await talk.expect("interrupted_run")

    run = sub(announced, "run")
    assert (run["kind"], run["run_id"], run["found"], run["expected"]) == (
        "unreadable",
        RUN_ID,
        found,
        1,
    )


async def test_does_not_announce_the_run_in_progress(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="get_interrupted_run")
        announced = await talk.expect("interrupted_run")

    assert announced["run"] is None
    assert only_plan().run_id == run_id


async def test_refuses_to_resume_the_run_in_progress(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="resume_run", run_id=run_id)
        refused = await talk.expect("error")

    assert (refused["code"], refused["params"]) == ("run_not_found", {"run_id": run_id})
    assert only_plan().run_id == run_id


async def test_discards_a_plan_and_announces_what_remains(tmp_path: Path) -> None:
    folder = tmp_path / "music"
    save_plan(plan_dir(), plan_of(folder, music(folder, 1)))

    async with conversation() as talk:
        talk.send(command="discard_run", run_id=RUN_ID)
        announced = await talk.expect("interrupted_run")

    assert announced["run"] is None
    assert plan_files() == []


async def test_discarding_a_plan_announces_the_next_interrupted_run(tmp_path: Path) -> None:
    folder = tmp_path / "music"
    records = music(folder, 1)
    older = CREATED - timedelta(days=2)
    save_plan(plan_dir(), plan_of(folder, records))
    save_plan(plan_dir(), plan_of(folder, records, run_id=OTHER_RUN, started_at=older))

    async with conversation() as talk:
        talk.send(command="discard_run", run_id=RUN_ID)
        announced = await talk.expect("interrupted_run")

    run = sub(announced, "run")
    assert run["run_id"] == OTHER_RUN
    assert [run_id_of(path) for path in plan_files()] == [OTHER_RUN]


async def test_discarding_an_interrupted_plan_does_not_announce_the_open_run(
    folder: Path, tmp_path: Path
) -> None:
    other = tmp_path / "other"
    save_plan(plan_dir(), plan_of(other, music(other, 1), run_id=OTHER_RUN))

    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="discard_run", run_id=OTHER_RUN)
        announced = await talk.expect("interrupted_run")

    assert announced["run"] is None
    assert only_plan().run_id == run_id


@pytest.mark.parametrize(
    "command", ["discard_run", "resume_run", "load_run"], ids=["discard", "resume", "load"]
)
async def test_reports_an_unknown_run(command: str) -> None:
    async with conversation() as talk:
        talk.send(command=command, run_id=UNKNOWN_RUN)
        error = await talk.expect("error")

    assert (error["code"], error["command"], error["params"]) == (
        "run_not_found",
        command,
        {"run_id": UNKNOWN_RUN},
    )


async def test_discarding_the_current_run_abandons_it(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="discard_run", run_id=run_id)
        announced = await talk.expect("interrupted_run")
        talk.send(command="commit_run", run_id=run_id)
        refused = await talk.expect("error")

    assert announced["run"] is None
    assert plan_files() == []
    assert (refused["code"], refused["command"]) == ("write_not_open", "commit_run")


async def test_resumes_a_run_cut_short_by_a_shutdown(
    two_tracks_folder: Path, api: FakeApi, basiel_gate: Gate
) -> None:
    knows_your_mind(api)

    async with conversation() as talk:
        talk.send(**start_command(two_tracks_folder))
        started = await talk.expect("run_started")
        await talk.expect("track_resolved", track_id=FIRST_TRACK)
        await basiel_gate.wait_reached()
        talk.shut_down()
    basiel_gate.release.set()
    api.requests.clear()
    run_id = started["run_id"]
    plan_before = plan_files()

    async with conversation() as talk:
        talk.send(command="get_interrupted_run")
        announced = await talk.expect("interrupted_run")
        talk.send(command="resume_run", run_id=run_id)
        await talk.expect("run_started", run_id=run_id)
        replayed = await talk.expect("track_resolved", track_id=FIRST_TRACK)
        finished = await talk.expect("run_finished", phase="network")

    run = sub(announced, "run")
    assert (run["processed"], run["total"]) == (1, 2)
    assert replayed["resolution"] == "auto"
    assert plan_files() == plan_before
    assert api.searched() == {BASIEL}
    assert finished["run_id"] == run_id


def _save_committed_plan(other: Path) -> None:
    save_plan(plan_dir(), plan_of(other, music(other, 1), run_id=OTHER_RUN, committed=True))


def _save_dumped_plan(other: Path) -> None:
    save_plan(plan_dir(), plan_of(other, music(other, 1), run_id=OTHER_RUN))
    dump_dir().mkdir(parents=True, exist_ok=True)
    (dump_dir() / stamped_name(CREATED, OTHER_RUN, ".json")).write_text("{}", encoding="utf-8")


@pytest.mark.parametrize(
    "save_plan_of", [_save_committed_plan, _save_dumped_plan], ids=["committed", "dumped"]
)
async def test_refuses_a_plan_that_cannot_be_resumed_and_keeps_the_open_run(
    folder: Path, tmp_path: Path, save_plan_of: Callable[[Path], None]
) -> None:
    save_plan_of(tmp_path / "other")

    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="resume_run", run_id=OTHER_RUN)
        refused = await talk.expect("error")
        finished = await committed(talk, run_id)

    assert (refused["code"], refused["command"], refused["params"]) == (
        "run_not_found",
        "resume_run",
        {"run_id": OTHER_RUN},
    )
    assert finished["written"] == 1
    assert OTHER_RUN in {run_id_of(path) for path in plan_files()}


def _lose_the_key(keyring: MemoryKeyring, _other: Path) -> None:
    keyring.secrets.clear()


def _empty_the_folder(_keyring: MemoryKeyring, other: Path) -> None:
    for path in other.glob("*.mp3"):
        path.unlink()


@pytest.mark.parametrize(
    ("spoil", "code"),
    [(_lose_the_key, "api_key_missing"), (_empty_the_folder, "tagging_folder_unreadable")],
    ids=["no-key", "unreadable-folder"],
)
async def test_a_resume_refused_at_opening_keeps_the_open_run_and_its_plan(
    folder: Path,
    tmp_path: Path,
    memory_keyring: MemoryKeyring,
    spoil: Callable[[MemoryKeyring, Path], None],
    code: str,
) -> None:
    other = tmp_path / "other"
    save_plan(plan_dir(), plan_of(other, music(other, 1), run_id=OTHER_RUN))

    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        spoil(memory_keyring, other)
        talk.send(command="resume_run", run_id=OTHER_RUN)
        refused = await talk.expect("error")
        finished = await committed(talk, run_id)

    assert (refused["code"], refused["command"]) == (code, "resume_run")
    assert finished["written"] == 1
    assert {run_id_of(path) for path in plan_files()} == {run_id, OTHER_RUN}


def _empty_the_folder_of(_folder: Path, records: list[TrackRecord]) -> None:
    for record in records:
        record.path.unlink()


def _remove_the_folder_of(folder: Path, records: list[TrackRecord]) -> None:
    _empty_the_folder_of(folder, records)
    folder.rmdir()


@pytest.mark.parametrize(
    "unplug", [_remove_the_folder_of, _empty_the_folder_of], ids=["removed", "emptied"]
)
async def test_reports_a_run_whose_folder_cannot_be_reopened(
    tmp_path: Path, unplug: Callable[[Path, list[TrackRecord]], None]
) -> None:
    folder = tmp_path / "unplugged"
    records = music(folder, 1)
    save_plan(plan_dir(), plan_of(folder, records))
    unplug(folder, records)

    async with conversation() as talk:
        talk.send(command="resume_run", run_id=RUN_ID)
        error = await talk.expect("error")

    assert (error["code"], error["command"]) == ("tagging_folder_unreadable", "resume_run")
    assert len(plan_files()) == 1


async def test_refuses_to_resume_without_an_api_key(
    tmp_path: Path, memory_keyring: MemoryKeyring
) -> None:
    memory_keyring.secrets.clear()
    folder = tmp_path / "music"
    save_plan(plan_dir(), plan_of(folder, music(folder, 1)))

    async with conversation() as talk:
        talk.send(command="resume_run", run_id=RUN_ID)
        error = await talk.expect("error")

    assert (error["code"], error["command"]) == ("api_key_missing", "resume_run")
    assert len(plan_files()) == 1
