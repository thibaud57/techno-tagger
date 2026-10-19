"""Enveloppe Sentry reellement envoyee par le transport HTTP du SDK, hors protocole.

`init_sentry` vise un DSN `http://` vers un serveur local qui retient chaque POST : vrai
`sentry_sdk.init`, vrai transport, vraie compression, rien ne quitte la machine. Trois
remontees : une derive du contrat de l'API (client `MockTransport` des helpers), un `OSError`
sur un nom a apostrophe et un `KeyError` sur un `track_id`. Le verdict releve les fragments
sensibles trouves dans le corps decompresse et les champs de chaque evenement.
"""

import asyncio
import getpass
import gzip
import json
import threading
import zlib
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Final

import httpx2
import sentry_sdk
from _probe import emit, fail
from scraper_responses import YOUR_MIND, make_client, page_payload, recording, track_payload

from tagger import APP_NAME, RELEASE
from tagger.core.observability import capture_unexpected, init_sentry
from tagger.resolution.scraper_client import ApiContractError, Source

# Loin de toute frame qui leve : le SDK joint cinq lignes de source par frame.
LOCKED_PATH: Final = "D:\\Music\\Nova Pulse - Don't Stop.mp3"
TRACK_ID: Final = "Albums/Nova Pulse - Your Mind.mp3"
FRAGMENTS: Final = ("Beyer", "Your Mind", "Nova Pulse", "Don't Stop", "Drumcode")

bodies: list[bytes] = []


class _Capture(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        match self.headers.get("Content-Encoding"):
            case "gzip":
                raw = gzip.decompress(raw)
            case "deflate":
                raw = zlib.decompress(raw)
            case "br":
                import brotli  # noqa: PLC0415

                raw = brotli.decompress(raw)
            case _:
                pass
        bodies.append(raw)
        self.send_response(200)
        self.end_headers()

    def log_message(self, *_args: object) -> None:
        return


async def _contract_break() -> ApiContractError:
    response = httpx2.Response(200, json=page_payload(track_payload(bpm=YOUR_MIND)))
    async with make_client(recording([], response)) as client:
        try:
            await client.search(Source.BEATPORT, YOUR_MIND)
        except ApiContractError as error:
            return error
    fail("la reponse hors contrat n'a pas leve ApiContractError")


def _locked() -> OSError:
    try:
        Path(LOCKED_PATH).open(encoding="utf-8")  # noqa: SIM115
    except OSError as error:
        return error
    fail("le chemin de sonde existe")


def _unknown() -> KeyError:
    try:
        {}[TRACK_ID]
    except KeyError as error:
        return error
    fail("KeyError non leve")


def _events() -> list[dict[str, object]]:
    events = []
    for body in bodies:
        lines = body.split(b"\n")
        for header, payload in zip(lines[1::2], lines[2::2], strict=False):
            if json.loads(header).get("type") == "event":
                events.append(json.loads(payload))
    return events


def main() -> None:
    server = HTTPServer(("127.0.0.1", 0), _Capture)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    init_sentry(f"http://key@127.0.0.1:{server.server_port}/1", RELEASE)

    capture_unexpected(asyncio.run(_contract_break()))
    capture_unexpected(_locked())
    capture_unexpected(_unknown())
    sentry_sdk.flush(timeout=10)
    server.shutdown()

    rendered = b"".join(bodies).decode("utf-8", errors="replace")
    events = _events()
    emit(
        {
            "success": True,
            "posts": len(bodies),
            "events": len(events),
            "fragments_found": [f for f in (*FRAGMENTS, getpass.getuser()) if f in rendered],
            "server_names": sorted({str(e.get("server_name")) for e in events}),
            "app_name": APP_NAME,
            "frame_vars": sum(
                "vars" in frame
                for e in events
                for entry in e["exception"]["values"]
                for frame in entry.get("stacktrace", {}).get("frames", [])
            ),
            "exceptions": [
                [
                    (entry.get("module"), entry["type"], entry.get("value"))
                    for entry in e["exception"]["values"]
                ]
                for e in events
            ],
        },
        indent=2,
    )


if __name__ == "__main__":
    main()
