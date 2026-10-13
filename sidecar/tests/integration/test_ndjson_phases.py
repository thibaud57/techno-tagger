"""Une seule phase longue a la fois : extraction, recherche, ecriture et rollback s'excluent."""

from typing import TYPE_CHECKING

import pytest
from ndjson_loop import (
    conversation,
    extraction_command,
    held_call,
    resolved_run,
    start_command,
    written_run,
)
from scraper_responses import YOUR_MIND

from tagger import __main__ as main
from tagger.run import rollback, writing

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

    from tagging_api import FakeApi

pytestmark = [pytest.mark.asyncio, pytest.mark.usefixtures("_key")]


@pytest.fixture
def extraction(vlc_dump: Path, music_library: Path, tmp_path: Path) -> dict[str, object]:
    return extraction_command(music_library, vlc_dump, tmp_path / "work")


@pytest.fixture
def command_of(
    folder: Path, extraction: dict[str, object]
) -> Callable[[str, str], dict[str, object]]:
    """Commande a injecter pour un nom donne ; `run_id` sert a toutes celles qui visent un run."""

    def build(name: str, run_id: str) -> dict[str, object]:
        fixed = {"extract_playlist": extraction, "start_tagging": start_command(folder)}
        return fixed.get(name, {"command": name, "run_id": run_id})

    return build


@pytest.mark.parametrize(
    "command",
    ["extract_playlist", "load_run", "discard_run", "rollback"],
    ids=["extract-playlist", "load-run", "discard-run", "rollback"],
)
async def test_refuses_a_command_while_a_run_searches(
    folder: Path, api: FakeApi, command_of: Callable[[str, str], dict[str, object]], command: str
) -> None:
    gate = api.gate("/beatport/search", YOUR_MIND)

    async with conversation() as talk:
        talk.send(**start_command(folder))
        started = await talk.expect("run_started")
        await gate.reached.wait()
        talk.send(**command_of(command, str(started["run_id"])))
        error = await talk.expect("error")
        gate.release.set()
        await talk.expect("run_finished", phase="network")

    assert (error["code"], error["params"], error["command"]) == (
        "phase_busy",
        {"phase": "tagging"},
        command,
    )


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
