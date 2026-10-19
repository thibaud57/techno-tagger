"""Issue de retour d'un run : URL de l'Issue Form et export nettoye, prepares a la demande."""

import asyncio
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import parse_qs, urlsplit

import pytest
from ndjson_loop import (
    UNKNOWN_RUN,
    conversation,
    drive,
    line,
    start_command,
    sub,
    written_in_a_previous_session,
    written_run,
)
from report_files import report_json
from tagging_api import two_tracks

from tagger.reports.feedback import EXPORT_FIELD, ISSUE_TEMPLATE, MAX_URL_LENGTH, feedback_dir

if TYPE_CHECKING:
    from collections.abc import Callable

    from tagging_api import Gate


@pytest.mark.asyncio
@pytest.mark.usefixtures("_key")
async def test_a_written_run_gives_its_issue_url_and_its_export(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await written_run(talk, folder)
        talk.send(command="prepare_feedback", run_id=run_id)
        ready = await talk.expect("feedback_ready")

    url = str(ready["url"])
    query = parse_qs(urlsplit(url).query)
    export = Path(str(ready["export_path"]))
    assert ready["run_id"] == run_id
    assert len(url) <= MAX_URL_LENGTH
    assert query["template"] == [ISSUE_TEMPLATE]
    assert export.parent == feedback_dir()
    assert export.name.endswith(f"-{run_id}.json")
    assert await asyncio.to_thread(export.is_file)
    assert query[EXPORT_FIELD] == [f"Drop {export.name} here"]


@pytest.mark.asyncio
@pytest.mark.usefixtures("_key")
async def test_a_run_written_in_an_earlier_session_gives_its_issue_url(folder: Path) -> None:
    run_id = await written_in_a_previous_session(folder)

    async with conversation() as talk:
        talk.send(command="prepare_feedback", run_id=run_id)
        ready = await talk.expect("feedback_ready")

    assert ready["run_id"] == run_id


@pytest.mark.usefixtures("app_data")
def test_an_unknown_run_is_refused_with_its_run_id() -> None:
    events = drive(line("prepare_feedback", run_id=UNKNOWN_RUN))

    assert (events[0]["code"], events[0]["command"], events[0]["params"]) == (
        "run_not_found",
        "prepare_feedback",
        {"run_id": UNKNOWN_RUN},
    )


def _delete(report: Path) -> None:
    report.unlink()


def _corrupt(report: Path) -> None:
    report.write_text("{not json", encoding="utf-8")


@pytest.mark.asyncio
@pytest.mark.usefixtures("_key")
@pytest.mark.parametrize(
    ("damage", "code"),
    [(_delete, "run_not_found"), (_corrupt, "tagging_report_unreadable")],
    ids=["deleted-report-is-unknown", "corrupted-report-is-unreadable"],
)
async def test_a_damaged_report_is_refused_with_its_run_id(
    folder: Path, damage: Callable[[Path], None], code: str
) -> None:
    async with conversation() as talk:
        run_id = await written_run(talk, folder)
        damage(report_json(folder))
        talk.send(command="prepare_feedback", run_id=run_id)
        error = await talk.expect("error")

    assert (error["code"], error["command"], sub(error, "params")["run_id"]) == (
        code,
        "prepare_feedback",
        run_id,
    )


@pytest.mark.asyncio
@pytest.mark.usefixtures("_key")
async def test_an_export_that_cannot_be_written_is_refused_with_its_file(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await written_run(talk, folder)
        feedback_dir().parent.mkdir(parents=True, exist_ok=True)
        feedback_dir().write_text("", encoding="utf-8")
        talk.send(command="prepare_feedback", run_id=run_id)
        error = await talk.expect("error")

    params = sub(error, "params")
    assert (error["code"], error["command"]) == ("feedback_export_write_failed", "prepare_feedback")
    assert str(params["file"]).endswith(f"-{run_id}.json")
    assert params["run_id"] == run_id


@pytest.mark.asyncio
@pytest.mark.usefixtures("_key")
async def test_a_running_network_phase_does_not_hold_the_feedback_back(
    folder: Path, tmp_path: Path, basiel_gate: Gate
) -> None:
    async with conversation() as talk:
        past = await written_run(talk, folder)

    # « Your Mind » est deja en cache apres le run passe : seule la requete de « Basiel » part
    # sur le reseau, donc seule elle peut etre retenue.
    other = two_tracks(tmp_path / "other")
    async with conversation() as talk:
        talk.send(**start_command(other))
        await basiel_gate.wait_reached()
        talk.send(command="prepare_feedback", run_id=past)
        ready = await talk.expect("feedback_ready")
        basiel_gate.release.set()
        finished = await talk.expect("run_finished", phase="network")

    assert ready["run_id"] == past
    assert finished["phase"] == "network"
