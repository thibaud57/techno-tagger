"""Cycle de vie du plan de run, de bout en bout sur la boucle NDJSON."""

from typing import TYPE_CHECKING, Final

import pytest
from ndjson_loop import conversation, held_call, resolved_run
from run_plans import only_plan, plan_files
from scraper_responses import BANDCAMP_TRACK, DIM_ORBIT, KELVOR, bandcamp_track_payload
from stubs import raising
from tagging_api import (
    ONE_TRACK,
    ORIGINAL,
    FakeApi,
    found,
    hold_on_beatport,
    ok,
    one_track,
    two_tracks,
)

from tagger import writing
from tagger.scraper_client import Source
from tagger.tag_dump import TagDumpWriteError
from tagger.tagging import Resolution, TrackState

if TYPE_CHECKING:
    from pathlib import Path

pytestmark = [pytest.mark.asyncio, pytest.mark.usefixtures("_key")]

CHOOSE_ON_BEATPORT: Final = {
    "command": "resolve_arbitration",
    "track_id": ONE_TRACK,
    "source": "beatport",
    "candidate": 0,
}


async def test_records_an_automatic_validation(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)

    plan = only_plan()
    track = plan.tracks[ONE_TRACK]
    assert (plan.run_id, plan.committed) == (run_id, False)
    assert (track.state, track.resolution, track.source) == (
        TrackState.RESOLVED,
        Resolution.AUTO,
        Source.BEATPORT,
    )
    assert track.candidate is not None
    assert track.scores is not None


async def test_records_an_arbitration_still_pending(
    tmp_path: Path, app_data: None, api: FakeApi
) -> None:
    hold_on_beatport(api)

    async with conversation() as talk:
        await resolved_run(talk, one_track(tmp_path))

    pending = only_plan().tracks[ONE_TRACK].arbitration
    assert pending is not None
    assert (pending.source, len(pending.candidates)) == (Source.BEATPORT, 2)


async def test_records_an_arbitration_decision(
    tmp_path: Path, app_data: None, api: FakeApi
) -> None:
    hold_on_beatport(api)

    async with conversation() as talk:
        await resolved_run(talk, one_track(tmp_path))
        talk.send(**CHOOSE_ON_BEATPORT)
        await talk.expect("track_resolved", track_id=ONE_TRACK, resolution="arbitration")

    track = only_plan().tracks[ONE_TRACK]
    assert (track.state, track.resolution, track.arbitration) == (
        TrackState.RESOLVED,
        Resolution.ARBITRATION,
        None,
    )


async def test_records_a_recovery_by_url(tmp_path: Path, app_data: None, api: FakeApi) -> None:
    api.on("/bandcamp/tracks", BANDCAMP_TRACK, ok(bandcamp_track_payload()))

    async with conversation() as talk:
        await resolved_run(talk, one_track(tmp_path))
        talk.send(command="resolve_by_url", track_id=ONE_TRACK, url=BANDCAMP_TRACK)
        await talk.expect("track_resolved", track_id=ONE_TRACK, resolution="url")

    track = only_plan().tracks[ONE_TRACK]
    assert (track.resolution, track.source, track.scores) == (
        Resolution.URL,
        Source.BANDCAMP,
        None,
    )


async def test_keeps_the_plan_of_a_run_shut_down_mid_network(
    tmp_path: Path, app_data: None, api: FakeApi
) -> None:
    api.on("/beatport/search", DIM_ORBIT, found(ORIGINAL))
    gate = api.gate("/beatport/search", KELVOR)

    async with conversation() as talk:
        talk.send(command="start_tagging", folder=str(two_tracks(tmp_path)))
        await talk.expect("track_resolved", track_id="a.mp3")
        await gate.reached.wait()
        talk.send(command="shutdown")

    plan = only_plan()
    assert (plan.committed, plan.processed_count(), len(plan.tracks)) == (False, 1, 2)
    assert plan.tracks["b.mp3"].state is None


async def test_keeps_the_plan_of_a_run_stopped_by_cancel_run(
    tmp_path: Path, app_data: None, api: FakeApi
) -> None:
    api.on("/beatport/search", DIM_ORBIT, found(ORIGINAL))
    gate = api.gate("/beatport/search", KELVOR)

    async with conversation() as talk:
        talk.send(command="start_tagging", folder=str(two_tracks(tmp_path)))
        await talk.expect("track_resolved", track_id="a.mp3")
        await gate.reached.wait()
        talk.send(command="cancel_run")
        await talk.expect("progress", phase="url_recovery")

    plan = only_plan()
    assert (plan.committed, plan.processed_count(), len(plan.tracks)) == (False, 1, 2)


async def test_deletes_the_plan_of_a_run_replaced_by_a_new_one(folder: Path) -> None:
    async with conversation() as talk:
        await resolved_run(talk, folder)
        second = await resolved_run(talk, folder)

    assert only_plan().run_id == second


@pytest.mark.usefixtures("api")
async def test_leaves_no_plan_for_a_folder_without_audio(tmp_path: Path, app_data: None) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()

    async with conversation() as talk:
        talk.send(command="start_tagging", folder=str(empty))
        await talk.expect("run_finished", phase="network")

    assert plan_files() == []


async def test_confirms_the_plan_before_the_first_file_is_written(
    folder: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    held = held_call(monkeypatch, writing, "write_tags")

    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="commit_run", run_id=run_id)
        await held.wait_reached()
        confirmed_before_writing = only_plan().committed
        held.release.set()
        await talk.expect("run_finished", phase="write")

    assert confirmed_before_writing
    assert only_plan().tracks[ONE_TRACK].state is TrackState.RESOLVED


async def test_reopens_the_plan_when_the_dump_cannot_be_saved(
    folder: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(writing, "save_entries", raising(TagDumpWriteError(folder / "x.json")))

    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="commit_run", run_id=run_id)
        await talk.expect("error", code="tag_dump_write_failed")

    assert not only_plan().committed
