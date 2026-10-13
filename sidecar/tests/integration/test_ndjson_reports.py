import asyncio
import shutil
from typing import TYPE_CHECKING

import httpx2
import pytest
from ndjson_loop import EXPECT_TIMEOUT, conversation, start_command, written_run
from report_files import report_json
from stubs import raising
from tagging_api import ONE_TRACK, ORIGINAL, FakeApi, FakeCdn, public_resolver

from tagger import handlers
from tagger.core.paths import app_data_dir
from tagger.reports import tagging as tagging_report
from tagger.reports.index import index_path, list_reports

if TYPE_CHECKING:
    from pathlib import Path

pytestmark = [pytest.mark.asyncio, pytest.mark.usefixtures("_key")]


async def test_names_the_report_when_the_write_phase_ends(folder: Path) -> None:
    async with conversation() as talk:
        talk.send(**start_command(folder))
        network = await talk.expect("run_finished", phase="network")
        talk.send(command="commit_run", run_id=network["run_id"])
        written = await talk.expect("run_finished", phase="write")

    assert network["report_path"] is None
    assert written["report_path"] == str(report_json(folder))


async def test_leaves_the_report_path_empty_when_the_report_cannot_be_written(
    folder: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        tagging_report, "write_atomically", raising(OSError(13, "Permission denied"))
    )

    async with conversation() as talk:
        talk.send(**start_command(folder))
        network = await talk.expect("run_finished", phase="network")
        talk.send(command="commit_run", run_id=network["run_id"])
        written = await talk.expect("run_finished", phase="write")

    assert written["report_path"] is None


def _serve_artworks(
    monkeypatch: pytest.MonkeyPatch, api: FakeApi, cdn: httpx2.MockTransport
) -> None:
    """Cache des pochettes vide et CDN simule remplace : `load_run` doit les retelecharger."""
    shutil.rmtree(app_data_dir() / "cache" / "artworks", ignore_errors=True)
    monkeypatch.setattr(
        handlers,
        "tagging_transports",
        lambda: handlers.TaggingTransports(
            httpx2.MockTransport(api.gated_handler), cdn, public_resolver
        ),
    )


async def test_lists_and_loads_a_past_run(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await written_run(talk, folder)
        talk.send(command="list_runs")
        listed = await talk.expect("runs_listed")
        talk.send(command="load_run", run_id=run_id)
        loaded = await talk.expect("run_loaded", run_id=run_id)

    runs = listed["runs"]
    assert isinstance(runs, list)
    assert [run["run_id"] for run in runs] == [run_id]
    tracks = loaded["tracks"]
    assert isinstance(tracks, list)
    (track,) = tracks
    assert (track["file_name"], track["state"]) == (ONE_TRACK, "written")
    assert track["source_url"] == ORIGINAL["url"]
    assert track["after"] == {"artist": "Adam Beyer", "title": "Your Mind (Original Mix)"}
    assert track["artwork_path"] is not None
    assert track["tags_before"] is not None
    assert "restorable" not in track


async def test_loads_a_run_whose_artwork_is_unavailable(
    folder: Path, api: FakeApi, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with conversation() as talk:
        run_id = await written_run(talk, folder)
    release = ORIGINAL["release"]
    assert isinstance(release, dict)
    cdn = FakeCdn()
    cdn.refused.add(str(release["artwork_url"]))
    _serve_artworks(monkeypatch, api, httpx2.MockTransport(cdn.handler))

    async with conversation() as talk:
        talk.send(command="load_run", run_id=run_id)
        loaded = await talk.expect("run_loaded", run_id=run_id)

    tracks = loaded["tracks"]
    assert isinstance(tracks, list)
    assert tracks[0]["artwork_path"] is None


async def test_reports_an_unreadable_report(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await written_run(talk, folder)
    (entry,) = list_reports(index_path())
    entry.report_path.write_text("{not json", encoding="utf-8")

    async with conversation() as talk:
        talk.send(command="load_run", run_id=run_id)
        error = await talk.expect("error")

    assert (error["code"], error["command"]) == ("tagging_report_unreadable", "load_run")
    params = error["params"]
    assert isinstance(params, dict)
    assert params["run_id"] == run_id


async def test_cancels_a_load_in_flight_when_the_session_ends(
    folder: Path, api: FakeApi, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with conversation() as talk:
        run_id = await written_run(talk, folder)
    reached = asyncio.Event()

    async def stuck(_request: httpx2.Request) -> httpx2.Response:
        reached.set()
        await asyncio.Event().wait()
        return httpx2.Response(500)

    _serve_artworks(monkeypatch, api, httpx2.MockTransport(stuck))

    async with conversation() as talk:
        talk.send(command="load_run", run_id=run_id)
        async with asyncio.timeout(EXPECT_TIMEOUT):
            await reached.wait()
        talk.send(command="shutdown")

    assert not [event for event in talk.events if event["event"] == "run_loaded"]
