import asyncio
from typing import TYPE_CHECKING

import pytest
from scraper_responses import BASIEL, BEATPORT_SEARCH
from stubs import ignore
from tagging_api import FakeApi, cancelled, hold_on_beatport, must_record, opened_run, two_tracks
from tagging_records import FIRST_TRACK, SECOND_TRACK

from tagger.resolution.scraper_client import Source
from tagger.run.arbitration import Arbitration
from tagger.run.models import ArbitrationRequired, AwaitingArbitration, TrackState, Waiting
from tagger.run.tagging import resolve_run

if TYPE_CHECKING:
    from pathlib import Path

    from tagging_api import OpenedRun

    from tagger.run.models import RunEvent

pytestmark = pytest.mark.asyncio


async def _until_held(opened: OpenedRun) -> asyncio.Task[None]:
    """Lance la phase reseau et rend la main des que le premier morceau attend."""
    held = asyncio.Event()

    def watch(event: RunEvent) -> None:
        if isinstance(event, ArbitrationRequired):
            held.set()

    phase = asyncio.create_task(
        resolve_run(opened.live, opened.sources, on_event=watch), name="phase"
    )
    await held.wait()
    return phase


async def test_holds_a_grey_zone_track_after_the_network_phase(tmp_path: Path) -> None:
    api = FakeApi()
    hold_on_beatport(api)

    async with opened_run(two_tracks(tmp_path), api) as opened:
        await resolve_run(opened.live, opened.sources, on_event=ignore)

        record = must_record(opened.live, FIRST_TRACK)
        assert isinstance(record.outcome, AwaitingArbitration)
        assert opened.live.snapshot().tracks[0] == record


async def test_keeps_the_tracks_already_processed_when_the_run_is_cancelled(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    hold_on_beatport(api)
    slow = api.gate(BEATPORT_SEARCH, BASIEL)

    async with opened_run(two_tracks(tmp_path), api) as opened:
        phase = await _until_held(opened)
        await slow.wait_reached()

        await cancelled(phase)

        waiting = must_record(opened.live, FIRST_TRACK)
        untouched = must_record(opened.live, SECOND_TRACK)
        assert isinstance(waiting.outcome, AwaitingArbitration)
        assert untouched.outcome == Waiting()


async def test_resolves_an_awaiting_track_while_another_one_is_still_in_flight(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    hold_on_beatport(api)
    slow = api.gate(BEATPORT_SEARCH, BASIEL)

    async with opened_run(two_tracks(tmp_path), api) as opened:
        phase = await _until_held(opened)
        arbitration = Arbitration(opened.live, opened.sources, ignore)

        await arbitration.choose(FIRST_TRACK, Source.BEATPORT, 0)

        record = must_record(opened.live, FIRST_TRACK)
        assert record.state is TrackState.RESOLVED
        assert not phase.done()
        slow.release.set()
        await phase


async def test_answers_an_awaiting_track_after_the_run_is_cancelled(tmp_path: Path) -> None:
    api = FakeApi()
    hold_on_beatport(api)
    slow = api.gate(BEATPORT_SEARCH, BASIEL)

    async with opened_run(two_tracks(tmp_path), api) as opened:
        phase = await _until_held(opened)
        await slow.wait_reached()
        await cancelled(phase)
        arbitration = Arbitration(opened.live, opened.sources, ignore)

        await arbitration.choose(FIRST_TRACK, Source.BEATPORT, 1)

        record = must_record(opened.live, FIRST_TRACK)
        assert record.state is TrackState.RESOLVED
