"""Une seule phase longue a la fois : extraction, recherche, ecriture et rollback s'excluent."""

from typing import TYPE_CHECKING, Final

import pytest
from ndjson_loop import (
    conversation,
    held_call,
    recover_by_url,
    resolved_run,
    searching,
    start_command,
    written_run,
)
from scraper_responses import YOUR_MIND
from tagging_api import BEATPORT_SEARCH, ONE_TRACK
from tagging_records import RUN_ID

from tagger import __main__ as main
from tagger.run import rollback, writing

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

    from tagging_api import FakeApi

pytestmark = [pytest.mark.asyncio, pytest.mark.usefixtures("_key")]


@pytest.fixture
def command_of(
    folder: Path, extraction: dict[str, object]
) -> Callable[[str, str], dict[str, object]]:
    """Commande a injecter pour un nom donne ; `run_id` sert a toutes celles qui visent un run."""

    def build(name: str, run_id: str) -> dict[str, object]:
        fixed: dict[str, dict[str, object]] = {
            "extract_playlist": extraction,
            "start_tagging": start_command(folder),
            "load_run": {"command": "load_run", "run_id": RUN_ID},
            "clear_cache": {"command": "clear_cache"},
            "resolve_by_url": recover_by_url(),
        }
        return fixed.get(name, {"command": name, "run_id": run_id})

    return build


BUSY_SEARCHING: Final = {"phase": "tagging"}


@pytest.mark.parametrize(
    ("command", "code", "params"),
    [
        ("extract_playlist", "phase_busy", BUSY_SEARCHING),
        ("discard_run", "phase_busy", BUSY_SEARCHING),
        ("rollback", "phase_busy", BUSY_SEARCHING),
        ("clear_cache", "phase_busy", BUSY_SEARCHING),
        # Le refus d'une charge nomme le run vise, en plus de la phase.
        ("load_run", "phase_busy", {**BUSY_SEARCHING, "run_id": RUN_ID}),
        ("commit_run", "write_not_open", {}),
        ("resolve_by_url", "url_recovery_not_open", {"track_id": ONE_TRACK}),
    ],
    ids=[
        "extract-playlist",
        "discard-run",
        "rollback",
        "clear-cache",
        "load-run",
        "commit-run",
        "resolve-by-url",
    ],
)
async def test_refuses_a_command_while_a_run_searches(
    folder: Path,
    api: FakeApi,
    command_of: Callable[[str, str], dict[str, object]],
    command: str,
    code: str,
    params: dict[str, object],
) -> None:
    gate = api.gate(BEATPORT_SEARCH, YOUR_MIND)

    async with conversation() as talk:
        run_id = await searching(talk, folder, gate)
        talk.send(**command_of(command, run_id))
        error = await talk.expect("error")
        gate.release.set()
        await talk.expect("run_finished", phase="network")

    assert (error["code"], error["params"], error["command"]) == (code, params, command)


@pytest.mark.parametrize(
    "command",
    ["start_tagging", "commit_run", "retry_write", "rollback"],
    ids=["start-tagging", "commit-run", "retry-write", "rollback"],
)
async def test_refuses_a_command_while_an_extraction_copies(
    folder: Path,
    monkeypatch: pytest.MonkeyPatch,
    extraction: dict[str, object],
    command_of: Callable[[str, str], dict[str, object]],
    command: str,
) -> None:
    held = held_call(monkeypatch, main, "handle_extract_playlist")

    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(**extraction)
        await held.wait_reached()
        talk.send(**command_of(command, run_id))
        error = await talk.expect("error")
        held.release.set()
        await talk.expect("extraction_finished")

    assert (error["code"], error["params"], error["command"]) == (
        "phase_busy",
        {"phase": "extraction"},
        command,
    )


@pytest.mark.parametrize(
    "command",
    ["extract_playlist", "start_tagging", "commit_run", "retry_write", "rollback"],
    ids=["extract-playlist", "start-tagging", "commit-run", "retry-write", "rollback"],
)
async def test_refuses_a_command_while_writing(
    folder: Path,
    monkeypatch: pytest.MonkeyPatch,
    command_of: Callable[[str, str], dict[str, object]],
    command: str,
) -> None:
    held = held_call(monkeypatch, writing, "write_tags")

    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="commit_run", run_id=run_id)
        await held.wait_reached()
        talk.send(**command_of(command, run_id))
        error = await talk.expect("error")
        held.release.set()
        await talk.expect("run_finished", phase="write")

    assert (error["code"], error["params"], error["command"]) == (
        "phase_busy",
        {"phase": "write"},
        command,
    )


@pytest.mark.parametrize(
    "command",
    ["extract_playlist", "start_tagging", "commit_run", "retry_write", "rollback"],
    ids=["extract-playlist", "start-tagging", "commit-run", "retry-write", "rollback"],
)
async def test_refuses_a_command_while_rolling_back(
    folder: Path,
    monkeypatch: pytest.MonkeyPatch,
    command_of: Callable[[str, str], dict[str, object]],
    command: str,
) -> None:
    held = held_call(monkeypatch, rollback, "restore_tags")

    async with conversation() as talk:
        run_id = await written_run(talk, folder)
        talk.send(command="rollback", run_id=run_id)
        await held.wait_reached()
        talk.send(**command_of(command, run_id))
        error = await talk.expect("error")
        held.release.set()
        await talk.expect("rollback_finished")

    assert (error["code"], error["params"], error["command"]) == (
        "phase_busy",
        {"phase": "rollback"},
        command,
    )
