import asyncio
from typing import TYPE_CHECKING

import httpx2
import pytest
from scraper_responses import ARTWORK_URL, recording
from stubs import raising
from tagging_api import JPEG, InFlight, image, public_resolver

from tagger.resolution.cache import (
    ARTWORK_CONCURRENCY,
    ArtworkFetcher,
    ArtworkUnavailableError,
    DiskCache,
)

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

    from scraper_responses import Handler

pytestmark = pytest.mark.asyncio


def _entries(root: Path) -> list[Path]:
    return list(root.iterdir())


def _fetcher(
    root: Path, handler: Handler, resolve: Callable[[str], list[str]] = public_resolver
) -> ArtworkFetcher:
    return ArtworkFetcher(DiskCache(root), transport=httpx2.MockTransport(handler), resolve=resolve)


def _unreachable(request: httpx2.Request) -> httpx2.Response:
    raise httpx2.ConnectError("unreachable", request=request)


def _redirecting_to(location: str, status: int = 302) -> Handler:
    """CDN de la pochette qui renvoie ailleurs ; la cible, elle, sert l'image."""

    def handler(request: httpx2.Request) -> httpx2.Response:
        if request.url.host == "geo-media.beatport.com":
            return httpx2.Response(status, headers={"Location": location})
        return image()

    return handler


def _looping(request: httpx2.Request) -> httpx2.Response:
    return httpx2.Response(302, headers={"Location": str(request.url)})


async def test_downloads_an_artwork_once_and_serves_it_from_the_cache(
    tmp_path: Path, requests: list[httpx2.Request]
) -> None:
    async with _fetcher(tmp_path, recording(requests, image())) as fetcher:
        first = await fetcher.fetch(ARTWORK_URL)
        second = await fetcher.fetch(ARTWORK_URL)

    assert second == first
    assert first.read_bytes() == JPEG
    assert len(requests) == 1


@pytest.mark.parametrize(
    ("content_type", "suffix"),
    [("image/jpeg", ".jpg"), ("image/png", ".png"), ("image/webp", ".webp")],
    ids=["jpeg", "png", "webp"],
)
async def test_names_the_file_after_the_content_type(
    tmp_path: Path, content_type: str, suffix: str
) -> None:
    async with _fetcher(tmp_path, lambda _request: image(content_type)) as fetcher:
        artwork = await fetcher.fetch(ARTWORK_URL)

    assert artwork.suffix == suffix


@pytest.mark.parametrize(
    ("handler", "reason"),
    [
        (lambda _request: httpx2.Response(404), "status_404"),
        (
            lambda _request: httpx2.Response(
                200, content=b"<html>", headers={"Content-Type": "text/html"}
            ),
            "not_an_image",
        ),
        (_unreachable, "network"),
        (_redirecting_to("https://127.0.0.1:8000/cover.jpg"), "blocked_url"),
        (_looping, "too_many_redirects"),
    ],
    ids=[
        "error-status",
        "not-an-image",
        "network-error",
        "redirect-to-the-local-machine",
        "redirect-loop",
    ],
)
async def test_raises_artwork_unavailable_and_publishes_nothing(
    tmp_path: Path, handler: Handler, reason: str
) -> None:
    async with _fetcher(tmp_path, handler) as fetcher:
        with pytest.raises(ArtworkUnavailableError) as error:
            await fetcher.fetch(ARTWORK_URL)

    assert error.value.reason == reason
    assert await asyncio.to_thread(_entries, tmp_path) == []


async def test_never_keeps_more_downloads_in_flight_than_the_pool_allows(tmp_path: Path) -> None:
    in_flight = InFlight(image)

    async with (
        _fetcher(tmp_path, in_flight.handler) as fetcher,
        asyncio.TaskGroup() as group,
    ):
        for index in range(ARTWORK_CONCURRENCY * 2):
            group.create_task(fetcher.fetch(f"{ARTWORK_URL}?v={index}"), name=f"artwork:{index}")

    assert in_flight.peak == ARTWORK_CONCURRENCY


async def test_sends_no_api_key_to_the_cdn(tmp_path: Path, requests: list[httpx2.Request]) -> None:
    async with _fetcher(tmp_path, recording(requests, image())) as fetcher:
        await fetcher.fetch(ARTWORK_URL)

    assert "X-API-Key" not in requests[0].headers


async def test_downloads_once_when_two_tracks_share_an_artwork(
    tmp_path: Path, requests: list[httpx2.Request]
) -> None:
    async def slow_cdn(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        await asyncio.sleep(0.01)
        return image()

    async with _fetcher(tmp_path, slow_cdn) as fetcher:
        first, second = await asyncio.gather(fetcher.fetch(ARTWORK_URL), fetcher.fetch(ARTWORK_URL))

    assert first == second
    assert len(requests) == 1


@pytest.mark.parametrize(
    "content_type",
    ["image/JPEG", "IMAGE/jpeg", "Image/Jpeg; charset=binary"],
    ids=["upper-subtype", "upper-type", "mixed-with-parameter"],
)
async def test_accepts_a_content_type_whatever_its_case(tmp_path: Path, content_type: str) -> None:
    """Un type de media est insensible a la casse (RFC 9110)."""
    async with _fetcher(tmp_path, lambda _request: image(content_type)) as fetcher:
        artwork = await fetcher.fetch(ARTWORK_URL)

    assert artwork.suffix == ".jpg"


@pytest.mark.parametrize(
    "url",
    [
        "http://geo-media.beatport.com/cover.jpg",
        "https://127.0.0.1:8000/cover.jpg",
        "https://192.168.1.1/cover.jpg",
        "file:///C:/Windows/win.ini",
    ],
    ids=["plain-http", "loopback", "private-network", "not-http"],
)
async def test_refuses_an_url_that_does_not_name_a_public_cdn(
    tmp_path: Path, requests: list[httpx2.Request], url: str
) -> None:
    """`artwork_url` vient d'une reponse de l'API : elle ne doit pas sonder la machine."""
    async with _fetcher(tmp_path, recording(requests, image())) as fetcher:
        with pytest.raises(ArtworkUnavailableError) as error:
            await fetcher.fetch(url)

    assert error.value.reason == "blocked_url"
    assert requests == []


class _ConnectedTo:
    """Le peu de `network_stream` que le garde lit : l'adresse reellement connectee."""

    def __init__(self, address: str) -> None:
        self._address = address

    def get_extra_info(self, name: str) -> tuple[str, int] | None:
        return (self._address, 443) if name == "server_addr" else None


def _connected_to(address: str) -> Handler:
    def handler(_request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(
            200,
            content=JPEG,
            headers={"Content-Type": "image/jpeg"},
            extensions={"network_stream": _ConnectedTo(address)},
        )

    return handler


@pytest.mark.parametrize(
    "connected",
    ["127.0.0.1", "192.168.1.10", "10.0.0.5"],
    ids=["loopback", "private-network", "private-range"],
)
async def test_refuses_a_response_from_an_address_the_guard_would_have_blocked(
    tmp_path: Path, connected: str
) -> None:
    """Rebinding : le resolveur annonce une adresse publique, la connexion en joint une
    autre. Relire l'adresse connectee refuse la reponse avant de la lire ou de la cacher.
    """
    async with _fetcher(tmp_path, _connected_to(connected)) as fetcher:
        with pytest.raises(ArtworkUnavailableError) as error:
            await fetcher.fetch(ARTWORK_URL)

    assert error.value.reason == "blocked_url"
    assert _entries(tmp_path) == []


async def test_accepts_a_response_from_the_public_address_it_resolved(tmp_path: Path) -> None:
    async with _fetcher(tmp_path, _connected_to("93.184.216.34")) as fetcher:
        stored = await fetcher.fetch(ARTWORK_URL)

    assert stored.read_bytes() == JPEG


async def test_follows_a_redirection_towards_another_public_host(tmp_path: Path) -> None:
    redirecting = _redirecting_to("https://cdn.example.com/cover.jpg", status=301)

    async with _fetcher(tmp_path, redirecting) as fetcher:
        artwork = await fetcher.fetch(ARTWORK_URL)

    assert artwork.read_bytes() == JPEG


@pytest.mark.parametrize(
    "refused",
    [
        ["tagger.resolution.cache.DiskCache.begin"],
        ["tagger.resolution.cache.DiskCache.commit", "pathlib.Path.unlink"],
    ],
    ids=["begin", "commit-and-cleanup"],
)
async def test_raises_artwork_unavailable_when_the_cache_cannot_be_written(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, refused: list[str]
) -> None:
    """Le nettoyage qui echoue lui aussi ne doit pas masquer le motif `cache_write`."""
    locked = raising(PermissionError(13, "locked by another process"))
    for target in refused:
        monkeypatch.setattr(target, locked)

    async with _fetcher(tmp_path, lambda _request: image()) as fetcher:
        with pytest.raises(ArtworkUnavailableError) as error:
            await fetcher.fetch(ARTWORK_URL)

    assert error.value.reason == "cache_write"


@pytest.mark.parametrize(
    "resolved",
    [["127.0.0.1"], ["192.168.1.10"], ["93.184.216.34", "10.0.0.5"], []],
    ids=["loopback", "private-network", "one-private-among-public", "resolves-to-nothing"],
)
async def test_refuses_a_hostname_that_resolves_to_a_private_address(
    tmp_path: Path, requests: list[httpx2.Request], resolved: list[str]
) -> None:
    """Un nom de domaine se juge sur ce qu'il resout, jamais sur sa seule forme."""
    async with _fetcher(tmp_path, recording(requests, image()), lambda _host: resolved) as fetcher:
        with pytest.raises(ArtworkUnavailableError) as error:
            await fetcher.fetch("https://cdn.attaquant.example/cover.jpg")

    assert error.value.reason == "blocked_url"
    assert requests == []
