"""Tests du telechargement des pochettes depuis le CDN de la source."""

import asyncio
from typing import TYPE_CHECKING

import httpx2
import pytest

from tagger.cache import (
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

URL = "https://geo-media.beatport.com/image_size/500x500/cover.jpg"
IMAGE = b"\xff\xd8\xff\xe0" + b"\x00" * 64


def _image(content_type: str = "image/jpeg") -> httpx2.Response:
    return httpx2.Response(200, content=IMAGE, headers={"Content-Type": content_type})


def _entries(root: Path) -> list[Path]:
    return list(root.iterdir())


def _public(_host: str) -> list[str]:
    """Resolveur injecte : aucun test n'interroge le DNS."""
    return ["93.184.216.34"]


def _fetcher(root: Path, handler: Handler) -> ArtworkFetcher:
    return ArtworkFetcher(DiskCache(root), transport=httpx2.MockTransport(handler), resolve=_public)


def _recording(requests: list[httpx2.Request]) -> Callable[[httpx2.Request], httpx2.Response]:
    def handler(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        return _image()

    return handler


async def test_downloads_an_artwork_once_and_serves_it_from_the_cache(tmp_path: Path) -> None:
    requests: list[httpx2.Request] = []

    def cdn(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        return _image()

    async with _fetcher(tmp_path, cdn) as fetcher:
        first = await fetcher.fetch(URL)
        second = await fetcher.fetch(URL)

    assert second == first
    assert first.read_bytes() == IMAGE
    assert len(requests) == 1


@pytest.mark.parametrize(
    ("content_type", "suffix"),
    [("image/jpeg", ".jpg"), ("image/png", ".png"), ("image/webp", ".webp")],
    ids=["jpeg", "png", "webp"],
)
async def test_names_the_file_after_the_content_type(
    tmp_path: Path, content_type: str, suffix: str
) -> None:
    async with _fetcher(tmp_path, lambda _request: _image(content_type)) as fetcher:
        artwork = await fetcher.fetch(URL)

    assert artwork.suffix == suffix


@pytest.mark.parametrize(
    ("response", "reason"),
    [
        (httpx2.Response(404), "status_404"),
        (
            httpx2.Response(200, content=b"<html>", headers={"Content-Type": "text/html"}),
            "not_an_image",
        ),
    ],
    ids=["error-status", "not-an-image"],
)
async def test_raises_artwork_unavailable_and_publishes_nothing(
    tmp_path: Path, response: httpx2.Response, reason: str
) -> None:
    async with _fetcher(tmp_path, lambda _request: response) as fetcher:
        with pytest.raises(ArtworkUnavailableError) as error:
            await fetcher.fetch(URL)

    assert error.value.reason == reason
    assert await asyncio.to_thread(_entries, tmp_path) == []


async def test_raises_artwork_unavailable_on_a_network_error(tmp_path: Path) -> None:
    def unreachable(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("unreachable", request=request)

    async with _fetcher(tmp_path, unreachable) as fetcher:
        with pytest.raises(ArtworkUnavailableError) as error:
            await fetcher.fetch(URL)

    assert error.value.reason == "network"


async def test_never_keeps_more_downloads_in_flight_than_the_pool_allows(tmp_path: Path) -> None:
    in_flight = {"current": 0, "peak": 0}

    async def slow_cdn(_request: httpx2.Request) -> httpx2.Response:
        in_flight["current"] += 1
        in_flight["peak"] = max(in_flight["peak"], in_flight["current"])
        await asyncio.sleep(0.01)
        in_flight["current"] -= 1
        return _image()

    async with (
        _fetcher(tmp_path, slow_cdn) as fetcher,
        asyncio.TaskGroup() as group,
    ):
        for index in range(ARTWORK_CONCURRENCY * 2):
            group.create_task(fetcher.fetch(f"{URL}?v={index}"), name=f"artwork:{index}")

    assert in_flight["peak"] == ARTWORK_CONCURRENCY


async def test_sends_no_api_key_to_the_cdn(tmp_path: Path) -> None:
    requests: list[httpx2.Request] = []

    def cdn(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        return _image()

    async with _fetcher(tmp_path, cdn) as fetcher:
        await fetcher.fetch(URL)

    assert "X-API-Key" not in requests[0].headers


async def test_downloads_once_when_two_tracks_share_an_artwork(tmp_path: Path) -> None:
    requests: list[httpx2.Request] = []

    async def slow_cdn(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        await asyncio.sleep(0.01)
        return _image()

    async with _fetcher(tmp_path, slow_cdn) as fetcher:
        first, second = await asyncio.gather(fetcher.fetch(URL), fetcher.fetch(URL))

    assert first == second
    assert len(requests) == 1


@pytest.mark.parametrize(
    "content_type",
    ["image/JPEG", "IMAGE/jpeg", "Image/Jpeg; charset=binary"],
    ids=["upper-subtype", "upper-type", "mixed-with-parameter"],
)
async def test_accepts_a_content_type_whatever_its_case(tmp_path: Path, content_type: str) -> None:
    """Un type de media est insensible a la casse (RFC 9110)."""
    async with _fetcher(tmp_path, lambda _request: _image(content_type)) as fetcher:
        artwork = await fetcher.fetch(URL)

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
async def test_refuses_an_url_that_does_not_name_a_public_cdn(tmp_path: Path, url: str) -> None:
    """`artwork_url` vient d'une reponse de l'API : elle ne doit pas sonder la machine."""
    requests: list[httpx2.Request] = []

    async with _fetcher(tmp_path, _recording(requests)) as fetcher:
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

    def rebinding(_request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(
            200,
            content=IMAGE,
            headers={"Content-Type": "image/jpeg"},
            extensions={"network_stream": _ConnectedTo(connected)},
        )

    async with _fetcher(tmp_path, rebinding) as fetcher:
        with pytest.raises(ArtworkUnavailableError) as error:
            await fetcher.fetch(URL)

    assert error.value.reason == "blocked_url"
    assert _entries(tmp_path) == []


async def test_accepts_a_response_from_the_public_address_it_resolved(tmp_path: Path) -> None:
    def cdn(_request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(
            200,
            content=IMAGE,
            headers={"Content-Type": "image/jpeg"},
            extensions={"network_stream": _ConnectedTo("93.184.216.34")},
        )

    async with _fetcher(tmp_path, cdn) as fetcher:
        stored = await fetcher.fetch(URL)

    assert stored.read_bytes() == IMAGE


async def test_refuses_a_redirection_towards_the_local_machine(tmp_path: Path) -> None:
    def redirecting(request: httpx2.Request) -> httpx2.Response:
        if request.url.host == "geo-media.beatport.com":
            return httpx2.Response(302, headers={"Location": "https://127.0.0.1:8000/cover.jpg"})
        return _image()

    async with _fetcher(tmp_path, redirecting) as fetcher:
        with pytest.raises(ArtworkUnavailableError) as error:
            await fetcher.fetch(URL)

    assert error.value.reason == "blocked_url"


async def test_follows_a_redirection_towards_another_public_host(tmp_path: Path) -> None:
    def redirecting(request: httpx2.Request) -> httpx2.Response:
        if request.url.host == "geo-media.beatport.com":
            return httpx2.Response(301, headers={"Location": "https://cdn.example.com/cover.jpg"})
        return _image()

    async with _fetcher(tmp_path, redirecting) as fetcher:
        artwork = await fetcher.fetch(URL)

    assert artwork.read_bytes() == IMAGE


async def test_gives_up_on_a_redirection_loop(tmp_path: Path) -> None:
    def looping(request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(302, headers={"Location": str(request.url)})

    async with _fetcher(tmp_path, looping) as fetcher:
        with pytest.raises(ArtworkUnavailableError) as error:
            await fetcher.fetch(URL)

    assert error.value.reason == "too_many_redirects"


async def test_raises_artwork_unavailable_when_the_cache_cannot_be_written(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def refuse(*_args: object, **_kwargs: object) -> None:
        raise PermissionError(13, "locked by another process")

    monkeypatch.setattr("tagger.cache.DiskCache.begin", refuse)
    async with _fetcher(tmp_path, lambda _request: _image()) as fetcher:
        with pytest.raises(ArtworkUnavailableError) as error:
            await fetcher.fetch(URL)

    assert error.value.reason == "cache_write"


@pytest.mark.parametrize(
    "resolved",
    [["127.0.0.1"], ["192.168.1.10"], ["93.184.216.34", "10.0.0.5"], []],
    ids=["loopback", "private-network", "one-private-among-public", "resolves-to-nothing"],
)
async def test_refuses_a_hostname_that_resolves_to_a_private_address(
    tmp_path: Path, resolved: list[str]
) -> None:
    """Un nom de domaine se juge sur ce qu'il resout, jamais sur sa seule forme."""
    requests: list[httpx2.Request] = []
    fetcher = ArtworkFetcher(
        DiskCache(tmp_path),
        transport=httpx2.MockTransport(_recording(requests)),
        resolve=lambda _host: resolved,
    )

    async with fetcher:
        with pytest.raises(ArtworkUnavailableError) as error:
            await fetcher.fetch("https://cdn.attaquant.example/cover.jpg")

    assert error.value.reason == "blocked_url"
    assert requests == []


async def test_reports_artwork_unavailable_even_when_the_cleanup_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def locked(*_args: object, **_kwargs: object) -> None:
        raise PermissionError(13, "locked by another process")

    monkeypatch.setattr("tagger.cache.DiskCache.commit", locked)
    monkeypatch.setattr("pathlib.Path.unlink", locked)
    async with _fetcher(tmp_path, lambda _request: _image()) as fetcher:
        with pytest.raises(ArtworkUnavailableError) as error:
            await fetcher.fetch(URL)

    assert error.value.reason == "cache_write"
