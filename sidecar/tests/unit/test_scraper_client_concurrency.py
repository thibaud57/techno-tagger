"""Tests des bornes de concurrence par source (ADR-017)."""

import asyncio

import httpx2
import pytest
from scraper_responses import make_client, page_payload

from tagger.scraper_client import BANDCAMP_CONCURRENCY, SearchSource, Source

pytestmark = pytest.mark.asyncio


class _InFlight:
    def __init__(self) -> None:
        self.current = 0
        self.peak = 0

    async def handler(self, _request: httpx2.Request) -> httpx2.Response:
        self.current += 1
        self.peak = max(self.peak, self.current)
        await asyncio.sleep(0.01)
        self.current -= 1
        return httpx2.Response(200, json=page_payload())


async def _search_ten_times(source: SearchSource, in_flight: _InFlight) -> None:
    async with make_client(in_flight.handler) as client, asyncio.TaskGroup() as group:
        for index in range(10):
            group.create_task(client.search(source, f"query {index}"), name=f"search:{index}")


async def test_never_keeps_more_than_three_beatport_requests_in_flight() -> None:
    in_flight = _InFlight()

    await _search_ten_times(Source.BEATPORT, in_flight)

    assert in_flight.peak == 3


async def test_never_keeps_more_than_two_bandcamp_requests_in_flight() -> None:
    in_flight = _InFlight()

    await _search_ten_times(Source.BANDCAMP, in_flight)

    assert in_flight.peak == 2


async def test_a_retrying_request_frees_its_slot_while_it_waits() -> None:
    """Sans ca, un morceau en attente bloquerait la source pendant trois secondes.

    Le pic tomberait a 1 si la premiere recherche gardait son jeton en attendant.
    """
    in_flight = _InFlight()
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
