"""Bornes de concurrence par source (ADR-017)."""

import asyncio

import httpx2
import pytest
from cdn_doubles import InFlight
from scraper_responses import found, make_client, ok, soundcloud_track_payload

from tagger.resolution.scraper_client import (
    BANDCAMP_CONCURRENCY,
    BEATPORT_CONCURRENCY,
    SOUNDCLOUD_CONCURRENCY,
    SearchSource,
    Source,
)

pytestmark = pytest.mark.asyncio


async def _search_ten_times(source: SearchSource, in_flight: InFlight) -> None:
    async with make_client(in_flight.handler) as client, asyncio.TaskGroup() as group:
        for index in range(10):
            group.create_task(client.search(source, f"query {index}"), name=f"search:{index}")


@pytest.mark.parametrize(
    ("source", "peak"),
    [(Source.BEATPORT, BEATPORT_CONCURRENCY), (Source.BANDCAMP, BANDCAMP_CONCURRENCY)],
    ids=["beatport", "bandcamp"],
)
async def test_never_keeps_more_requests_in_flight_than_the_source_allows(
    source: SearchSource, peak: int
) -> None:
    in_flight = InFlight(found())

    await _search_ten_times(source, in_flight)

    assert in_flight.peak == peak


async def test_a_retrying_request_frees_its_slot_while_it_waits() -> None:
    """Sans ca, un morceau en attente bloquerait la source pendant trois secondes.

    Le pic tomberait a 1 si la premiere recherche gardait son jeton en attendant.
    """
    in_flight = InFlight(found())
    peak_during_wait: list[int] = []
    already_failed = False

    async def failing_once(request: httpx2.Request) -> httpx2.Response:
        nonlocal already_failed
        if not already_failed:
            already_failed = True
            raise httpx2.ConnectError("connection refused", request=request)
        return await in_flight.handler(request)

    async def watching_sleep(_delay: float) -> None:
        await asyncio.sleep(0.03)
        peak_during_wait.append(in_flight.peak)

    async with (
        make_client(failing_once, sleep=watching_sleep) as client,
        asyncio.TaskGroup() as group,
    ):
        for index in range(BANDCAMP_CONCURRENCY + 1):
            group.create_task(
                client.search(Source.BANDCAMP, f"query {index}"), name=f"search:{index}"
            )

    assert peak_during_wait == [BANDCAMP_CONCURRENCY]


async def test_never_keeps_more_soundcloud_requests_in_flight_than_the_source_allows() -> None:
    in_flight = InFlight(ok(soundcloud_track_payload()))

    async with make_client(in_flight.handler) as client, asyncio.TaskGroup() as group:
        for index in range(10):
            group.create_task(
                client.fetch_by_url(f"https://soundcloud.com/drumcode/track-{index}"),
                name=f"resolve:{index}",
            )

    assert in_flight.peak == SOUNDCLOUD_CONCURRENCY
