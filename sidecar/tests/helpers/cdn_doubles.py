"""CDN de pochettes simule : JPEG minimal, resolveur DNS neutre, fakes de transport.

Aucun import runtime d'un autre helper : `Reply` n'est lu que par le typage.
"""

import asyncio
from typing import TYPE_CHECKING, Final

import httpx2

if TYPE_CHECKING:
    from pathlib import Path

    from scraper_responses import Reply

JPEG: Final = b"\xff\xd8\xff\xe0" + b"\x00" * 64


def image(content_type: str = "image/jpeg") -> httpx2.Response:
    """Reponse du CDN : un JPEG, sauf `content_type` contraire."""
    return httpx2.Response(200, content=JPEG, headers={"Content-Type": content_type})


def public_resolver(_host: str) -> list[str]:
    """Resolveur injecte : aucun test n'interroge le DNS."""
    return ["93.184.216.34"]


class FakeCdn:
    """Rend une image JPEG pour toute URL, sauf celles declarees refusees."""

    def __init__(self) -> None:
        self.refused: set[str] = set()

    def handler(self, request: httpx2.Request) -> httpx2.Response:
        if str(request.url) in self.refused:
            return httpx2.Response(404)
        return image()


class InFlight:
    """Repond `reply()` apres une attente et retient le pic de requetes simultanees."""

    def __init__(self, reply: Reply) -> None:
        self.current = 0
        self.peak = 0
        self._reply = reply

    async def handler(self, _request: httpx2.Request) -> httpx2.Response:
        self.current += 1
        self.peak = max(self.peak, self.current)
        await asyncio.sleep(0.01)
        self.current -= 1
        return self._reply()


def write_cover(folder: Path) -> Path:
    """Pochette telle que le cache la donne : un fichier JPEG."""
    cover = folder / "cover.jpg"
    cover.write_bytes(JPEG)
    return cover
