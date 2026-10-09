"""Une seule phase longue a la fois : extraction, recherche, ecriture et rollback s'excluent."""

from typing import TYPE_CHECKING

import pytest
from ndjson_loop import conversation, extraction_command, held_call, resolved_run
from scraper_responses import YOUR_MIND
from tagging_api import ORIGINAL, FakeApi, found, one_track

from tagger import __main__ as main
from tagger import rollback, writing

if TYPE_CHECKING:
    from pathlib import Path

pytestmark = [pytest.mark.asyncio, pytest.mark.usefixtures("_key")]


@pytest.fixture
def folder(tmp_path: Path, app_data: None, api: FakeApi) -> Path:
    """« Your Mind » que Beatport resout d'office : le run finit avec un morceau a ecrire."""
    api.on("/beatport/search", YOUR_MIND, found(ORIGINAL))
    return one_track(tmp_path)


@pytest.fixture
def extraction(vlc_dump: Path, music_library: Path, tmp_path: Path) -> dict[str, object]:
    return extraction_command(music_library, vlc_dump, tmp_path / "work")


async def test_refuses_an_extraction_while_a_run_searches(
    folder: Path, api: FakeApi, extraction: dict[str, object]
) -> None:
    gate = api.gate("/beatport/search", YOUR_MIND)

    async with conversation() as talk:
        talk.send(command="start_tagging", folder=str(folder))
        await gate.reached.wait()
        talk.send(**extraction)
        error = await talk.expect("error")
        gate.release.set()
        await talk.expect("run_finished", phase="network")

    assert (error["code"], error["command"]) == ("tagging_in_progress", "extract_playlist")


async def test_refuses_a_run_while_an_extraction_copies(
    folder: Path, monkeypatch: pytest.MonkeyPatch, extraction: dict[str, object]
) -> None:
    held = held_call(monkeypatch, main, "handle_extract_playlist")

    async with conversation() as talk:
        talk.send(**extraction)
        await held.wait_reached()
        talk.send(command="start_tagging", folder=str(folder))
        error = await talk.expect("error")
        held.release.set()
        await talk.expect("extraction_finished")

    assert (error["code"], error["command"]) == ("extraction_in_progress", "start_tagging")


@pytest.mark.parametrize(
    "command", ["commit_run", "retry_write"], ids=["commit-run", "retry-write"]
)
async def test_refuses_a_write_while_an_extraction_copies(
    folder: Path, monkeypatch: pytest.MonkeyPatch, extraction: dict[str, object], command: str
) -> None:
    held = held_call(monkeypatch, main, "handle_extract_playlist")

    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(**extraction)
        await held.wait_reached()
        talk.send(command=command, run_id=run_id)
        error = await talk.expect("error")
        held.release.set()
        await talk.expect("extraction_finished")

    assert (error["code"], error["command"]) == ("extraction_in_progress", command)


async def test_refuses_an_extraction_while_writing(
    folder: Path, monkeypatch: pytest.MonkeyPatch, extraction: dict[str, object]
) -> None:
    held = held_call(monkeypatch, writing, "write_tags")

    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="commit_run", run_id=run_id)
        await held.wait_reached()
        talk.send(**extraction)
        error = await talk.expect("error")
        held.release.set()
        await talk.expect("run_finished", phase="write")

    assert (error["code"], error["command"]) == ("write_in_progress", "extract_playlist")


async def test_refuses_a_rollback_while_an_extraction_copies(
    folder: Path, monkeypatch: pytest.MonkeyPatch, extraction: dict[str, object]
) -> None:
    held = held_call(monkeypatch, main, "handle_extract_playlist")

    async with conversation() as talk:
        talk.send(**extraction)
        await held.wait_reached()
        talk.send(command="rollback", run_id="000000")
        error = await talk.expect("error")
        held.release.set()
        await talk.expect("extraction_finished")

    assert (error["code"], error["command"]) == ("extraction_in_progress", "rollback")


async def test_refuses_an_extraction_while_rolling_back(
    folder: Path, monkeypatch: pytest.MonkeyPatch, extraction: dict[str, object]
) -> None:
    held = held_call(monkeypatch, rollback, "restore_tags")

    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="commit_run", run_id=run_id)
        await talk.expect("run_finished", phase="write")
        talk.send(command="rollback", run_id=run_id)
        await held.wait_reached()
        talk.send(**extraction)
        error = await talk.expect("error")
        held.release.set()
        await talk.expect("rollback_finished")

    assert (error["code"], error["command"]) == ("rollback_in_progress", "extract_playlist")
