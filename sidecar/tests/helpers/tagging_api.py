"""API techno-scraper et CDN de pochettes simules pour les tests du pipeline.

Chaque route repond selon la requete recue. Une recherche sans reponse enregistree
rend une page vide, un refetch sans reponse rend 404 : le pipeline garde alors
l'objet de recherche, ce qui est le comportement documente.
"""

import asyncio
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, NamedTuple

import httpx2
import pytest
from audio_samples import tag, write_blank_mp3
from scraper_responses import YOUR_MIND, make_client, page_payload, track_payload

from tagger.cache import ArtworkFetcher, DiskCache
from tagger.matching import DEFAULT_THRESHOLDS
from tagger.sources import RunSources
from tagger.tagging import open_run, run_tagging

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator, Callable
    from pathlib import Path

    from scraper_responses import Handler

    from tagger.scraper_client import TechnoScraperClient
    from tagger.tagging import LiveRun, RunEvent, TaggingRun

type Reply = Callable[[], httpx2.Response]

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64

ONE_TRACK = "your mind.mp3"
ORIGINAL = track_payload(mix_name="Original Mix")
ORIGINAL_REFETCH = f"/beatport/tracks/{ORIGINAL['id']}"
ON_BANDCAMP = track_payload(
    id="42",
    source="bandcamp",
    mix_name=None,
    url="https://adambeyer.bandcamp.com/track/your-mind",
)


def public_resolver(_host: str) -> list[str]:
    """Resolveur injecte : aucun test n'interroge le DNS."""
    return ["93.184.216.34"]


def ok(body: dict[str, object]) -> Reply:
    return lambda: httpx2.Response(200, json=body)


def found(*items: dict[str, object]) -> Reply:
    return ok(page_payload(*items))


def basiel(**overrides: object) -> dict[str, object]:
    """Reponse « Basiel » d'Amelie Lens, l'autre morceau de `two_tracks`."""
    return track_payload(artists=[{"name": "Amelie Lens"}], title="Basiel", **overrides)


def failing(status: int, api_code: str = "") -> Reply:
    return lambda: httpx2.Response(status, json={"code": api_code} if api_code else {})


class Gate:
    """Retient une requete : `reached` quand elle arrive, relachee par `release`."""

    def __init__(self) -> None:
        self.reached = asyncio.Event()
        self.release = asyncio.Event()


def _route(request: httpx2.Request) -> tuple[str, str]:
    """Chemin et cle : la requete `q`, l'URL d'un refetch Bandcamp, sinon vide."""
    key = request.url.params.get("q") or request.url.params.get("url") or ""
    return request.url.path, key


class FakeApi:
    """Reponses par route et par requete, et journal des requetes recues."""

    def __init__(self) -> None:
        self.requests: list[httpx2.Request] = []
        self._replies: dict[tuple[str, str], Reply] = {}
        self._gates: dict[tuple[str, str], Gate] = {}

    def on(self, path: str, key: str, reply: Reply) -> None:
        """`key` : la requete `q`, l'URL d'un refetch Bandcamp, ou `*` pour toute requete."""
        self._replies[(path, key)] = reply

    def gate(self, path: str, key: str) -> Gate:
        """Retient les requetes de cette route jusqu'a `release`, sous `gated_handler`."""
        gate = Gate()
        self._gates[(path, key)] = gate
        return gate

    def paths(self) -> list[str]:
        return [request.url.path for request in self.requests]

    async def gated_handler(self, request: httpx2.Request) -> httpx2.Response:
        gate = self._gates.get(_route(request))
        if gate is not None:
            gate.reached.set()
            await gate.release.wait()
        return self.handler(request)

    def handler(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        path, key = _route(request)
        reply = self._replies.get((path, key)) or self._replies.get((path, "*"))
        if reply is not None:
            return reply()
        if path.endswith("/search"):
            return httpx2.Response(200, json=page_payload())
        return httpx2.Response(404, json={"code": "not_found"})


class FakeCdn:
    """Rend une image JPEG pour toute URL, sauf celles declarees refusees."""

    def __init__(self) -> None:
        self.refused: set[str] = set()

    def handler(self, request: httpx2.Request) -> httpx2.Response:
        if str(request.url) in self.refused:
            return httpx2.Response(404)
        return httpx2.Response(200, content=JPEG, headers={"Content-Type": "image/jpeg"})


def tagged_mp3(folder: Path, name: str, artist: str, title: str) -> Path:
    """Fichier MP3 vierge tague, dans le dossier du run."""
    folder.mkdir(parents=True, exist_ok=True)
    path = write_blank_mp3(folder / name)
    tag(path, artist=[artist], title=[title])
    return path


def one_track(tmp_path: Path) -> Path:
    """Dossier du run : « Your Mind » seul, en `ONE_TRACK`."""
    folder = tmp_path / "music"
    tagged_mp3(folder, ONE_TRACK, "Adam Beyer", "Your Mind")
    return folder


def two_tracks(tmp_path: Path) -> Path:
    """Dossier du run : « Your Mind » en `a.mp3`, « Basiel » en `b.mp3`."""
    folder = tmp_path / "music"
    tagged_mp3(folder, "a.mp3", "Adam Beyer", "Your Mind")
    tagged_mp3(folder, "b.mp3", "Amelie Lens", "Basiel")
    return folder


def three_tracks(tmp_path: Path) -> Path:
    """`two_tracks`, plus « The Void » en `c.mp3`."""
    folder = two_tracks(tmp_path)
    tagged_mp3(folder, "c.mp3", "Sara Landry", "The Void")
    return folder


def beatport_down(api: FakeApi, status: int = 503, api_code: str = "source_unavailable") -> None:
    """Beatport en panne, Bandcamp connait « Your Mind » : il part en zone grise, jamais seul."""
    api.on("/beatport/search", "*", failing(status, api_code))
    api.on("/bandcamp/search", YOUR_MIND, found(ON_BANDCAMP))


def hold_on_beatport(api: FakeApi) -> None:
    """Extended et Radio Edit de « Your Mind » : deux versions qui ne valent pas l'original."""
    api.on(
        "/beatport/search",
        YOUR_MIND,
        found(
            track_payload(id="1", mix_name="Extended Mix"),
            track_payload(id="2", mix_name="Radio Edit"),
        ),
    )


async def cancelled(task: asyncio.Task[None]) -> None:
    """Annule la tache et attend qu'elle ait releve l'annulation."""
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


@asynccontextmanager
async def _wired(
    folder: Path, handler: Handler, cdn: FakeCdn | None
) -> AsyncGenerator[tuple[TechnoScraperClient, ArtworkFetcher]]:
    """Client sur l'API simulee et pochettes sur le CDN simule, cache a cote du dossier."""
    cdn = cdn or FakeCdn()
    artworks_cache = DiskCache(folder.parent / "artworks")
    async with (
        make_client(handler) as client,
        ArtworkFetcher(
            artworks_cache, transport=httpx2.MockTransport(cdn.handler), resolve=public_resolver
        ) as artworks,
    ):
        yield client, artworks


async def run(
    folder: Path,
    api: FakeApi,
    *,
    cdn: FakeCdn | None = None,
    events: list[RunEvent] | None = None,
) -> TaggingRun:
    """Lance un run complet sur l'API et le CDN simules."""
    sink: list[RunEvent] = events if events is not None else []
    async with _wired(folder, api.handler, cdn) as (client, artworks):
        return await run_tagging(folder, client=client, artworks=artworks, on_event=sink.append)


class OpenedRun(NamedTuple):
    """Run ouvert et ses sources, avant la phase reseau."""

    live: LiveRun
    sources: RunSources


@asynccontextmanager
async def opened_run(
    folder: Path,
    api: FakeApi,
    *,
    cdn: FakeCdn | None = None,
    events: list[RunEvent] | None = None,
) -> AsyncGenerator[OpenedRun]:
    """Ouvre un run sur l'API et le CDN simules ; les portes de `api` s'appliquent."""
    sink: list[RunEvent] = events if events is not None else []
    async with _wired(folder, api.gated_handler, cdn) as (client, artworks):
        live = await open_run(folder, on_event=sink.append)
        yield OpenedRun(live, RunSources(live.run_id, client, artworks, DEFAULT_THRESHOLDS))
