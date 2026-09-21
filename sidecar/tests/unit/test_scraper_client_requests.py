"""Tests des requetes emises et du mapping des reponses techno-scraper."""

from typing import TYPE_CHECKING

import httpx2
import pytest
from scraper_responses import (
    TEST_API_KEY,
    Handler,
    make_client,
    page_payload,
    recording,
    track_payload,
)

from tagger.cache import DiskCache, ResponseCache
from tagger.scraper_client import (
    ApiContractError,
    Credit,
    SearchSource,
    Source,
    SourceUnavailableError,
)

if TYPE_CHECKING:
    from pathlib import Path

pytestmark = pytest.mark.asyncio


def _recording(requests: list[httpx2.Request], body: dict[str, object]) -> Handler:
    """Raccourci du cas courant : un 200 qui porte ce corps JSON."""
    return recording(requests, httpx2.Response(200, json=body))


@pytest.mark.parametrize(
    ("source", "query", "route"),
    [
        (Source.BEATPORT, "Adam Beyer Your Mind", "/beatport/search"),
        (Source.BANDCAMP, "Amelie Lens Basiel", "/bandcamp/search"),
    ],
    ids=["beatport", "bandcamp"],
)
async def test_sends_a_search_to_its_source_route_with_the_query_and_type(
    requests: list[httpx2.Request], source: SearchSource, query: str, route: str
) -> None:
    """La route porte la source, et l'en-tete de cle part sur chacune des deux."""
    async with make_client(_recording(requests, page_payload())) as client:
        await client.search(source, query)

    assert requests[0].url.host == "techno-scraper.empiricmind.fr"
    assert requests[0].url.path == route
    assert dict(requests[0].url.params) == {"q": query, "type": "tracks"}
    assert requests[0].headers["X-API-Key"] == TEST_API_KEY


async def test_truncates_a_query_longer_than_two_hundred_characters(
    requests: list[httpx2.Request],
) -> None:
    async with make_client(_recording(requests, page_payload())) as client:
        await client.search(Source.BEATPORT, "x" * 250)

    assert len(requests[0].url.params["q"]) == 200


async def test_maps_each_item_to_a_track_candidate_with_its_release_label_and_credits(
    requests: list[httpx2.Request],
) -> None:
    async with make_client(_recording(requests, page_payload(track_payload()))) as client:
        candidates = await client.search(Source.BEATPORT, "Adam Beyer Your Mind")

    candidate = candidates[0]
    assert candidate.title == "Your Mind"
    assert candidate.mix_name == "Extended Mix"
    assert candidate.artists == (Credit(name="Adam Beyer"),)
    assert candidate.label == Credit(name="Drumcode")
    assert candidate.release is not None
    assert candidate.release.catalog_number == "DC287"
    assert candidate.source is Source.BEATPORT


async def test_ignores_fields_the_candidate_model_does_not_declare(
    requests: list[httpx2.Request],
) -> None:
    item = track_payload(waveform_url="https://example.invalid/wave.png")

    async with make_client(_recording(requests, page_payload(item))) as client:
        candidates = await client.search(Source.BEATPORT, "Adam Beyer Your Mind")

    assert "waveform_url" not in candidates[0].model_dump()


async def test_returns_an_empty_tuple_when_the_source_finds_nothing(
    requests: list[httpx2.Request],
) -> None:
    async with make_client(_recording(requests, page_payload())) as client:
        candidates = await client.search(Source.BANDCAMP, "unknown track")

    assert candidates == ()


async def test_fetches_a_beatport_track_by_id(requests: list[httpx2.Request]) -> None:
    async with make_client(_recording(requests, track_payload())) as client:
        candidate = await client.fetch_beatport_track("17492013")

    assert requests[0].url.path == "/beatport/tracks/17492013"
    assert candidate.id == "17492013"


async def test_fetches_a_bandcamp_track_by_url(requests: list[httpx2.Request]) -> None:
    url = "https://amelielens.bandcamp.com/track/basiel"
    body = track_payload(source="bandcamp", url=url, mix_name=None)

    async with make_client(_recording(requests, body)) as client:
        candidate = await client.fetch_bandcamp_track(url)

    assert requests[0].url.path == "/bandcamp/tracks"
    assert dict(requests[0].url.params) == {"url": url}
    assert candidate.source is Source.BANDCAMP


def _cache(root: Path) -> ResponseCache:
    return ResponseCache(DiskCache(root))


async def test_serves_a_repeated_search_from_the_cache_without_a_request(
    requests: list[httpx2.Request], tmp_path: Path
) -> None:
    handler = _recording(requests, page_payload(track_payload()))

    async with make_client(handler, cache=_cache(tmp_path)) as client:
        first = await client.search(Source.BEATPORT, "Adam Beyer Your Mind")
        second = await client.search(Source.BEATPORT, "Adam Beyer Your Mind")

    assert second == first
    assert len(requests) == 1


async def test_caches_an_empty_result(requests: list[httpx2.Request], tmp_path: Path) -> None:
    async with make_client(_recording(requests, page_payload()), cache=_cache(tmp_path)) as client:
        await client.search(Source.BANDCAMP, "unknown track")
        second = await client.search(Source.BANDCAMP, "unknown track")

    assert second == ()
    assert len(requests) == 1


async def test_never_caches_an_error_response(
    requests: list[httpx2.Request], tmp_path: Path
) -> None:
    def unavailable_then_found(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        if len(requests) == 1:
            return httpx2.Response(503, json={"code": "source_unavailable"})
        return httpx2.Response(200, json=page_payload(track_payload()))

    async with make_client(unavailable_then_found, cache=_cache(tmp_path)) as client:
        with pytest.raises(SourceUnavailableError):
            await client.search(Source.BEATPORT, "Adam Beyer Your Mind")
        candidates = await client.search(Source.BEATPORT, "Adam Beyer Your Mind")

    assert len(candidates) == 1
    assert len(requests) == 2


async def test_never_caches_a_response_the_model_rejects(
    requests: list[httpx2.Request], tmp_path: Path
) -> None:
    def broken_then_fixed(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        item = track_payload()
        if len(requests) == 1:
            del item["title"]
        return httpx2.Response(200, json=page_payload(item))

    async with make_client(broken_then_fixed, cache=_cache(tmp_path)) as client:
        with pytest.raises(ApiContractError):
            await client.search(Source.BEATPORT, "Adam Beyer Your Mind")
        candidates = await client.search(Source.BEATPORT, "Adam Beyer Your Mind")

    assert len(candidates) == 1
    assert len(requests) == 2


async def test_discards_a_cached_response_the_model_rejects_and_retries(
    requests: list[httpx2.Request], tmp_path: Path
) -> None:
    cache = _cache(tmp_path)
    poisoned = track_payload()
    del poisoned["title"]
    params = {"q": "Adam Beyer Your Mind", "type": "tracks"}
    cache.put("/beatport/search", params, page_payload(poisoned))
    handler = _recording(requests, page_payload(track_payload()))

    async with make_client(handler, cache=cache) as client:
        candidates = await client.search(Source.BEATPORT, "Adam Beyer Your Mind")

    assert len(candidates) == 1
    assert len(requests) == 1
