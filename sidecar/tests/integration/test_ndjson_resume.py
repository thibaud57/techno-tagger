"""Detection, reprise et abandon d'un run interrompu, de bout en bout sur la boucle."""

import json
from typing import TYPE_CHECKING, Final

import pytest
from ndjson_loop import conversation, resolved_run
from run_plans import RUN_ID, music, only_plan, plan_files, plan_of, save_plan
from scraper_responses import DIM_ORBIT, KELVOR
from tagging_api import CREATED, ORIGINAL, found, two_tracks

from tagger.plan import plan_dir
from tagger.run_files import run_id_of, stamped_name
from tagger.tag_dump import dump_dir
from tagger.tagging import FailureReason

if TYPE_CHECKING:
    from pathlib import Path

    from memory_keyring import MemoryKeyring
    from tagging_api import FakeApi

pytestmark = [pytest.mark.asyncio, pytest.mark.usefixtures("_key", "app_data")]

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

    run = announced["run"]
    assert isinstance(run, dict)
    assert (run["kind"], run["run_id"], run["processed"], run["total"]) == (
        "interrupted",
        RUN_ID,
        1,
        2,
    )
    assert run["folder_missing"] is False


async def test_announces_a_plan_of_another_version() -> None:
    plans = plan_dir()
    plans.mkdir(parents=True)
    (plans / stamped_name(CREATED, RUN_ID, ".json")).write_text(
        json.dumps({"schema_version": 2}), encoding="utf-8"
    )

    async with conversation() as talk:
        talk.send(command="get_interrupted_run")
        announced = await talk.expect("interrupted_run")

    run = announced["run"]
    assert isinstance(run, dict)
    assert (run["kind"], run["found"], run["expected"]) == ("unreadable", 2, 1)


async def test_announces_a_corrupt_plan_without_a_version() -> None:
    plans = plan_dir()
    plans.mkdir(parents=True)
    (plans / stamped_name(CREATED, RUN_ID, ".json")).write_text("{not json", encoding="utf-8")

    async with conversation() as talk:
        talk.send(command="get_interrupted_run")
        announced = await talk.expect("interrupted_run")

    run = announced["run"]
    assert isinstance(run, dict)
    assert (run["kind"], run["run_id"], run["found"], run["expected"]) == (
        "unreadable",
        RUN_ID,
        None,
        1,
    )


async def test_does_not_announce_the_run_in_progress(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="get_interrupted_run")
        announced = await talk.expect("interrupted_run")

    assert announced["run"] is None
    assert only_plan().run_id == run_id


async def test_discards_a_plan_and_announces_what_remains(tmp_path: Path) -> None:
    folder = tmp_path / "music"
    save_plan(plan_dir(), plan_of(folder, music(folder, 1)))

    async with conversation() as talk:
        talk.send(command="discard_run", run_id=RUN_ID)
        announced = await talk.expect("interrupted_run")

    assert announced["run"] is None
    assert plan_files() == []


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
        talk.send(command=command, run_id="000000")
        error = await talk.expect("error")

    assert (error["code"], error["command"], error["params"]) == (
        "run_not_found",
        command,
        {"run_id": "000000"},
    )


async def test_discarding_the_current_run_abandons_it(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="discard_run", run_id=run_id)
        announced = await talk.expect("interrupted_run")

    assert announced["run"] is None
    assert plan_files() == []


async def test_refuses_to_discard_while_a_phase_runs(folder: Path, api: FakeApi) -> None:
    gate = api.gate("/beatport/search", DIM_ORBIT)

    async with conversation() as talk:
        talk.send(command="start_tagging", folder=str(folder))
        started = await talk.expect("run_started")
        await gate.reached.wait()
        talk.send(command="discard_run", run_id=started["run_id"])
        error = await talk.expect("error")
        gate.release.set()
        await talk.expect("run_finished", phase="network")

    assert (error["code"], error["command"], error["params"]) == (
        "phase_busy",
        "discard_run",
        {"phase": "tagging"},
    )


async def test_resumes_a_run_cut_short_by_a_shutdown(tmp_path: Path, api: FakeApi) -> None:
    api.on("/beatport/search", DIM_ORBIT, found(ORIGINAL))
    gate = api.gate("/beatport/search", KELVOR)
    folder = two_tracks(tmp_path)
    async with conversation() as talk:
        talk.send(command="start_tagging", folder=str(folder))
        started = await talk.expect("run_started")
        await talk.expect("track_resolved", track_id="a.mp3")
        await gate.reached.wait()
        talk.send(command="shutdown")
    gate.release.set()
    api.requests.clear()
    run_id = started["run_id"]
    plan_before = plan_files()

    async with conversation() as talk:
        talk.send(command="get_interrupted_run")
        announced = await talk.expect("interrupted_run")
        talk.send(command="resume_run", run_id=run_id)
        await talk.expect("run_started", run_id=run_id)
        replayed = await talk.expect("track_resolved", track_id="a.mp3")
        finished = await talk.expect("run_finished", phase="network")

    run = announced["run"]
    assert isinstance(run, dict)
    assert (run["processed"], run["total"]) == (1, 2)
    assert replayed["resolution"] == "auto"
    assert plan_files() == plan_before
    assert api.searched() == {KELVOR}
    assert finished["run_id"] == run_id


@pytest.mark.parametrize("kind", ["committed", "dumped"], ids=["committed", "dumped"])
async def test_refuses_a_plan_that_cannot_be_resumed_and_keeps_the_open_run(
    folder: Path, tmp_path: Path, kind: str
) -> None:
    other = tmp_path / "other"
    save_plan(
        plan_dir(),
        plan_of(other, music(other, 1), run_id=OTHER_RUN, committed=kind == "committed"),
    )
    if kind == "dumped":
        dump_dir().mkdir(parents=True, exist_ok=True)
        (dump_dir() / stamped_name(CREATED, OTHER_RUN, ".json")).write_text("{}", encoding="utf-8")

    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="resume_run", run_id=OTHER_RUN)
        refused = await talk.expect("error")
        talk.send(command="commit_run", run_id=run_id)
        finished = await talk.expect("run_finished", phase="write")

    assert (refused["code"], refused["command"], refused["params"]) == (
        "run_not_found",
        "resume_run",
        {"run_id": OTHER_RUN},
    )
    assert finished["written"] == 1
    assert OTHER_RUN in {run_id_of(path) for path in plan_files()}


@pytest.mark.parametrize("kind", ["removed", "emptied"], ids=["removed", "emptied"])
@pytest.mark.usefixtures("api")
async def test_reports_a_run_whose_folder_cannot_be_reopened(tmp_path: Path, kind: str) -> None:
    folder = tmp_path / "unplugged"
    records = music(folder, 1)
    save_plan(plan_dir(), plan_of(folder, records))
    for record in records:
        record.path.unlink()
    if kind == "removed":
        folder.rmdir()

    async with conversation() as talk:
        talk.send(command="resume_run", run_id=RUN_ID)
        error = await talk.expect("error")

    assert (error["code"], error["command"]) == ("tagging_folder_unreadable", "resume_run")


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
