"""API techno-scraper et CDN de pochettes simules pour les tests du pipeline.

Chaque route repond selon la requete recue. Une recherche sans reponse enregistree
rend une page vide, un refetch sans reponse rend 404 : le pipeline garde alors
l'objet de recherche, ce qui est le comportement documente.
"""

import asyncio
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Final, NamedTuple

import httpx2
import pytest
from audio_samples import tagged_mp3
from cdn_doubles import FakeCdn, public_resolver
from scraper_responses import (
    YOUR_MIND,
    YOUR_MIND_BANDCAMP_URL,
    failing,
    found,
    make_client,
    page_payload,
    track_payload,
)
from stubs import ignore

from tagger.resolution.cache import ArtworkFetcher, DiskCache
from tagger.resolution.matching import DEFAULT_THRESHOLDS
from tagger.resolution.sources import RunSources
from tagger.run.tagging import open_run, resolve_run

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator
    from pathlib import Path

    from scraper_responses import Handler, Reply

    from tagger.resolution.scraper_client import TechnoScraperClient
    from tagger.run.models import LiveRun, RunEvent, TaggingRun, TrackRecord

BEATPORT_SEARCH: Final = "/beatport/search"
BANDCAMP_SEARCH: Final = "/bandcamp/search"
BANDCAMP_TRACKS: Final = "/bandcamp/tracks"
# Borne d'une porte : une requete qui n'arrive jamais echoue au lieu de geler la suite.
GATE_TIMEOUT: Final = 10

ONE_TRACK: Final = "your mind.mp3"
FIRST_TRACK: Final = "a.mp3"
SECOND_TRACK: Final = "b.mp3"
WRITTEN_NAME: Final = "Adam Beyer - Your Mind (Original Mix).mp3"
ORIGINAL: Final = track_payload(mix_name="Original Mix")
ORIGINAL_REFETCH: Final = f"/beatport/tracks/{ORIGINAL['id']}"
ON_BANDCAMP: Final = track_payload(
    id="42", source="bandcamp", mix_name=None, url=YOUR_MIND_BANDCAMP_URL
)


def basiel(**overrides: object) -> dict[str, object]:
    """Reponse « Basiel » d'Amelie Lens, l'autre morceau de `two_tracks`."""
    return track_payload(artists=[{"name": "Amelie Lens"}], title="Basiel", **overrides)


class Gate:
    """Retient une requete : `reached` quand elle arrive, relachee par `release`."""

    def __init__(self) -> None:
        self.reached = asyncio.Event()
        self.release = asyncio.Event()

    async def wait_reached(self) -> None:
        async with asyncio.timeout(GATE_TIMEOUT):
            await self.reached.wait()


def _route(request: httpx2.Request) -> tuple[str, str]:
    """Chemin et cle : la requete `q`, l'URL d'un refetch Bandcamp, sinon vide."""
    key = request.url.params.get("q") or request.url.params.get("url") or ""
    return request.url.path, key


class FakeApi:
    """Reponses par route et par requete, avec le journal des requetes recues."""

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

    def searched(self) -> set[str | None]:
        """Requetes `q` des recherches recues, Beatport et Bandcamp confondus."""
        return {
            request.url.params.get("q")
            for request in self.requests
            if request.url.path.endswith("/search")
        }

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


def one_track(tmp_path: Path) -> Path:
    """Dossier du run : « Your Mind » seul, en `ONE_TRACK`."""
    folder = tmp_path / "music"
    tagged_mp3(folder, ONE_TRACK, "Adam Beyer", "Your Mind")
    return folder


def two_tracks(tmp_path: Path) -> Path:
    """Dossier du run : « Your Mind » en `FIRST_TRACK`, « Basiel » en `SECOND_TRACK`."""
    folder = tmp_path / "music"
    tagged_mp3(folder, FIRST_TRACK, "Adam Beyer", "Your Mind")
    tagged_mp3(folder, SECOND_TRACK, "Amelie Lens", "Basiel")
    return folder


def three_tracks(tmp_path: Path) -> Path:
    """`two_tracks`, plus « The Void » en `c.mp3`."""
    folder = two_tracks(tmp_path)
    tagged_mp3(folder, "c.mp3", "Sara Landry", "The Void")
    return folder


def knows_your_mind(api: FakeApi, *, refetch: bool = False) -> None:
    """Beatport valide « Your Mind » d'office ; `refetch` repond aussi la relecture de sa fiche."""
    api.on(BEATPORT_SEARCH, YOUR_MIND, found(ORIGINAL))
    if refetch:
        api.on(ORIGINAL_REFETCH, "*", found(ORIGINAL))


def beatport_down(api: FakeApi, status: int = 503, api_code: str = "source_unavailable") -> None:
    """Beatport en panne, Bandcamp connait « Your Mind » : il part en zone grise, jamais seul."""
    api.on(BEATPORT_SEARCH, "*", failing(status, api_code))
    api.on(BANDCAMP_SEARCH, YOUR_MIND, found(ON_BANDCAMP))


def hold_on_beatport(api: FakeApi) -> None:
    """Extended et Radio Edit de « Your Mind » : deux versions qui ne valent pas l'original."""
    api.on(
        BEATPORT_SEARCH,
        YOUR_MIND,
        found(
            track_payload(id="1", mix_name="Extended Mix"),
            track_payload(id="2", mix_name="Radio Edit"),
        ),
    )


def hold_with_bandcamp_fallback(api: FakeApi) -> None:
    """`hold_on_beatport`, puis la version attendue sur Bandcamp une fois Beatport refuse."""
    hold_on_beatport(api)
    api.on(BANDCAMP_SEARCH, YOUR_MIND, found(ON_BANDCAMP))


def must_record(live: LiveRun, track_id: str) -> TrackRecord:
    """Record d'un morceau que le test sait present."""
    record = live.record(track_id)
    assert record is not None
    return record


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
        live = await open_run(folder, on_event=sink.append)
        sources = RunSources(live.run_id, client, artworks, DEFAULT_THRESHOLDS)
        await resolve_run(live, sources, on_event=sink.append)
        return live.snapshot()


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


@asynccontextmanager
async def networked_run(
    folder: Path, api: FakeApi, *, cdn: FakeCdn | None = None
) -> AsyncGenerator[OpenedRun]:
    """`opened_run` une fois sa phase reseau finie, ses evenements n'etant observes par personne."""
    async with opened_run(folder, api, cdn=cdn) as opened:
        await resolve_run(opened.live, opened.sources, on_event=ignore)
        yield opened


@asynccontextmanager
async def run_sources(
    folder: Path, api: FakeApi, run_id: str, *, cdn: FakeCdn | None = None
) -> AsyncGenerator[RunSources]:
    """Sources d'un run deja ouvert ailleurs (reprise) : rien n'est relu, rien n'est emis."""
    async with _wired(folder, api.gated_handler, cdn) as (client, artworks):
        yield RunSources(run_id, client, artworks, DEFAULT_THRESHOLDS)
