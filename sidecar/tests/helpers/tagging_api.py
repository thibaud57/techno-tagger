"""API techno-scraper et CDN de pochettes simules pour les tests du pipeline.

Chaque route repond selon la requete recue. Une recherche sans reponse enregistree
rend une page vide, un refetch sans reponse rend 404 : le pipeline garde alors
l'objet de recherche, ce qui est le comportement documente.
"""

from typing import TYPE_CHECKING

import httpx2
from audio_samples import tag, write_blank_mp3
from scraper_responses import make_client, page_payload

from tagger.cache import ArtworkFetcher, DiskCache
from tagger.tagging import run_tagging

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

    from tagger.tagging import RunEvent, TaggingRun

type Reply = Callable[[], httpx2.Response]

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64


def public_resolver(_host: str) -> list[str]:
    """Resolveur injecte : aucun test n'interroge le DNS."""
    return ["93.184.216.34"]


def ok(body: dict[str, object]) -> Reply:
    return lambda: httpx2.Response(200, json=body)


def found(*items: dict[str, object]) -> Reply:
    return ok(page_payload(*items))


def failing(status: int, api_code: str = "") -> Reply:
    return lambda: httpx2.Response(status, json={"code": api_code} if api_code else {})


class FakeApi:
    """Reponses par route et par requete, et journal des requetes recues."""

    def __init__(self) -> None:
        self.requests: list[httpx2.Request] = []
        self._replies: dict[tuple[str, str], Reply] = {}

    def on(self, path: str, key: str, reply: Reply) -> None:
        """`key` : la requete `q`, l'URL d'un refetch Bandcamp, ou `*` pour toute requete."""
        self._replies[(path, key)] = reply

    def paths(self) -> list[str]:
        return [request.url.path for request in self.requests]

    def handler(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        path = request.url.path
        key = request.url.params.get("q") or request.url.params.get("url") or ""
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


async def run(
    folder: Path,
    api: FakeApi,
    *,
    cdn: FakeCdn | None = None,
    events: list[RunEvent] | None = None,
) -> TaggingRun:
    """Lance un run complet sur l'API et le CDN simules."""
    cdn = cdn or FakeCdn()
    sink: list[RunEvent] = events if events is not None else []
    artworks_cache = DiskCache(folder.parent / "artworks")
    async with (
        make_client(api.handler) as client,
        ArtworkFetcher(
            artworks_cache, transport=httpx2.MockTransport(cdn.handler), resolve=public_resolver
        ) as artworks,
    ):
        return await run_tagging(folder, client=client, artworks=artworks, on_event=sink.append)
