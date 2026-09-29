"""Tests du run vivant : ce que le pipeline y laisse, pendant et apres sa phase reseau."""

import asyncio
from typing import TYPE_CHECKING

import pytest
from scraper_responses import BASIEL
from tagging_api import FakeApi, cancelled, hold_on_beatport, opened_run, two_tracks

from tagger.arbitration import Arbitration
from tagger.scraper_client import Source
from tagger.tagging import ArbitrationRequired, TrackState, resolve_run

if TYPE_CHECKING:
    from pathlib import Path

    from tagging_api import OpenedRun

    from tagger.tagging import RunEvent

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
        await resolve_run(opened.live, opened.sources, on_event=lambda _event: None)

        record = opened.live.record("a.mp3")
        assert record is not None
        assert record.arbitration is not None
        assert opened.live.snapshot().tracks[0] == record


async def test_keeps_the_tracks_already_processed_when_the_run_is_cancelled(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    hold_on_beatport(api)
    slow = api.gate("/beatport/search", BASIEL)

    async with opened_run(two_tracks(tmp_path), api) as opened:
        phase = await _until_held(opened)
        await slow.reached.wait()

        await cancelled(phase)

        waiting = opened.live.record("a.mp3")
        untouched = opened.live.record("b.mp3")
        assert waiting is not None
        assert waiting.arbitration is not None
        assert untouched is not None
        assert (untouched.state, untouched.arbitration) == (None, None)


async def test_resolves_an_awaiting_track_while_another_one_is_still_in_flight(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    hold_on_beatport(api)
    slow = api.gate("/beatport/search", BASIEL)

    async with opened_run(two_tracks(tmp_path), api) as opened:
        phase = await _until_held(opened)
        arbitration = Arbitration(opened.live, opened.sources, lambda _event: None)

        await arbitration.choose("a.mp3", Source.BEATPORT, 0)

        record = opened.live.record("a.mp3")
        assert record is not None
        assert record.state is TrackState.RESOLVED
        assert not phase.done()
        slow.release.set()
        await phase


async def test_answers_an_awaiting_track_after_the_run_is_cancelled(tmp_path: Path) -> None:
    api = FakeApi()
    hold_on_beatport(api)
    slow = api.gate("/beatport/search", BASIEL)

    async with opened_run(two_tracks(tmp_path), api) as opened:
        phase = await _until_held(opened)
        await slow.reached.wait()
        await cancelled(phase)
        arbitration = Arbitration(opened.live, opened.sources, lambda _event: None)

        await arbitration.choose("a.mp3", Source.BEATPORT, 1)

        record = opened.live.record("a.mp3")
        assert record is not None
        assert record.state is TrackState.RESOLVED
