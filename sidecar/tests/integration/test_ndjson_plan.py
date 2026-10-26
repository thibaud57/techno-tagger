from typing import TYPE_CHECKING

import pytest
from ndjson_loop import (
    CHOOSE_ON_BEATPORT,
    cancelled_run,
    conversation,
    held_call,
    recover_by_url,
    resolved_run,
    start_command,
)
from run_plans import only_plan, plan_files
from tagging_api import (
    ONE_TRACK,
    FakeApi,
    hold_on_beatport,
    knows_the_bandcamp_track,
    knows_your_mind,
)
from tagging_records import FIRST_TRACK, SECOND_TRACK

from tagger.resolution.scraper_client import Source
from tagger.run import writing
from tagger.run.models import Resolution, TrackState

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable
    from pathlib import Path

    from ndjson_loop import Conversation
    from tagging_api import Gate

pytestmark = [pytest.mark.asyncio, pytest.mark.usefixtures("_key")]


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


async def test_records_an_arbitration_still_pending(unresolved_folder: Path, api: FakeApi) -> None:
    hold_on_beatport(api)

    async with conversation() as talk:
        await resolved_run(talk, unresolved_folder)

    pending = only_plan().tracks[ONE_TRACK].arbitration
    assert pending is not None
    assert (pending.source, len(pending.candidates)) == (Source.BEATPORT, 2)


async def test_records_an_arbitration_decision(unresolved_folder: Path, api: FakeApi) -> None:
    hold_on_beatport(api)

    async with conversation() as talk:
        await resolved_run(talk, unresolved_folder)
        talk.send(**CHOOSE_ON_BEATPORT)
        await talk.expect("track_resolved", track_id=ONE_TRACK, resolution="arbitration")

    track = only_plan().tracks[ONE_TRACK]
    assert (track.state, track.resolution, track.arbitration) == (
        TrackState.RESOLVED,
        Resolution.ARBITRATION,
        None,
    )


async def test_records_a_recovery_by_url(unresolved_folder: Path, api: FakeApi) -> None:
    knows_the_bandcamp_track(api)

    async with conversation() as talk:
        await resolved_run(talk, unresolved_folder)
        talk.send(**recover_by_url())
        await talk.expect("track_resolved", track_id=ONE_TRACK, resolution="url")

    track = only_plan().tracks[ONE_TRACK]
    assert (track.resolution, track.source, track.scores) == (
        Resolution.URL,
        Source.BANDCAMP,
        None,
    )


async def _shut_down(talk: Conversation) -> None:
    talk.shut_down()


@pytest.mark.parametrize("stop", [_shut_down, cancelled_run], ids=["shutdown", "cancel-run"])
async def test_keeps_the_plan_of_a_run_stopped_mid_network(
    two_tracks_folder: Path,
    api: FakeApi,
    basiel_gate: Gate,
    stop: Callable[[Conversation], Awaitable[object]],
) -> None:
    knows_your_mind(api)

    async with conversation() as talk:
        talk.send(**start_command(two_tracks_folder))
        await talk.expect("track_resolved", track_id=FIRST_TRACK)
        await basiel_gate.wait_reached()
        await stop(talk)

    plan = only_plan()
    assert (plan.committed, plan.processed_count(), len(plan.tracks)) == (False, 1, 2)
    assert plan.tracks[SECOND_TRACK].state is None


async def test_deletes_the_plan_of_a_run_replaced_by_a_new_one(folder: Path) -> None:
    async with conversation() as talk:
        await resolved_run(talk, folder)
        second = await resolved_run(talk, folder)

    assert only_plan().run_id == second


async def test_leaves_no_plan_for_a_folder_without_audio(empty_folder: Path) -> None:
    async with conversation() as talk:
        talk.send(**start_command(empty_folder))
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
