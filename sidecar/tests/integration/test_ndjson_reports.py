import asyncio
import shutil
from typing import TYPE_CHECKING

import httpx2
import pytest
from ndjson_loop import (
    EXPECT_TIMEOUT,
    committed,
    conversation,
    rows,
    start_command,
    sub,
    written_in_a_previous_session,
    written_run,
)
from report_files import report_json
from scraper_responses import ARTWORK_URL
from tagging_api import ONE_TRACK, ORIGINAL

from tagger.reports.index import index_path, list_reports
from tagger.resolution.cache import cache_dir

if TYPE_CHECKING:
    from pathlib import Path

    from cdn_doubles import FakeCdn

pytestmark = [pytest.mark.asyncio, pytest.mark.usefixtures("_key")]


def _forget_artworks() -> None:
    """Cache des pochettes vide : `load_run` doit les retelecharger."""
    shutil.rmtree(cache_dir() / "artworks", ignore_errors=True)


async def test_names_the_report_when_the_write_phase_ends(folder: Path) -> None:
    async with conversation() as talk:
        talk.send(**start_command(folder))
        network = await talk.expect("run_finished", phase="network")
        written = await committed(talk, str(network["run_id"]))

    assert network["report_path"] is None
    assert written["report_path"] == str(report_json(folder))


async def test_lists_and_loads_a_past_run(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await written_run(talk, folder)
        talk.send(command="list_runs")
        listed = await talk.expect("runs_listed")
        talk.send(command="load_run", run_id=run_id)
        loaded = await talk.expect("run_loaded", run_id=run_id)

    assert [run["run_id"] for run in rows(listed, "runs")] == [run_id]
    (track,) = rows(loaded, "tracks")
    assert (track["file_name"], track["state"]) == (ONE_TRACK, "written")
    assert track["source_url"] == ORIGINAL["url"]
    assert track["after"] == {"artist": "Adam Beyer", "title": "Your Mind (Original Mix)"}
    assert track["artwork_path"] is not None
    assert track["tags_before"] is not None
    assert "restorable" not in track


async def test_loads_a_run_whose_artwork_is_unavailable(folder: Path, cdn: FakeCdn) -> None:
    run_id = await written_in_a_previous_session(folder)
    _forget_artworks()
    cdn.refused.add(ARTWORK_URL)

    async with conversation() as talk:
        talk.send(command="load_run", run_id=run_id)
        loaded = await talk.expect("run_loaded", run_id=run_id)

    assert rows(loaded, "tracks")[0]["artwork_path"] is None


async def test_reports_an_unreadable_report(folder: Path) -> None:
    run_id = await written_in_a_previous_session(folder)
    (entry,) = list_reports(index_path())
    entry.report_path.write_text("{not json", encoding="utf-8")

    async with conversation() as talk:
        talk.send(command="load_run", run_id=run_id)
        error = await talk.expect("error")

    assert (error["code"], error["command"]) == ("tagging_report_unreadable", "load_run")
    assert sub(error, "params")["run_id"] == run_id


async def test_cancels_a_load_in_flight_when_the_session_ends(
    folder: Path, cdn: FakeCdn, monkeypatch: pytest.MonkeyPatch
) -> None:
    run_id = await written_in_a_previous_session(folder)
    _forget_artworks()
    reached = asyncio.Event()

    async def stuck(_request: httpx2.Request) -> httpx2.Response:
        reached.set()
        await asyncio.Event().wait()
        return httpx2.Response(500)

    monkeypatch.setattr(cdn, "handler", stuck)

    async with conversation() as talk:
        talk.send(command="load_run", run_id=run_id)
        async with asyncio.timeout(EXPECT_TIMEOUT):
            await reached.wait()
        talk.shut_down()

    assert not [event for event in talk.events if event["event"] == "run_loaded"]
