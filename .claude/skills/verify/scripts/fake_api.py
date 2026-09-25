"""Faux techno-scraper sur une vraie socket locale, pour /verify.

Ne lit jamais `X-API-Key` : la cle enregistree sur la machine part telle quelle et la
journaliser la ferait fuir.
"""

import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

TRACKS = {
    "Your Mind": {
        "id": "17492013",
        "title": "Your Mind",
        "mix_name": "Extended Mix",
        "artists": [{"id": "1", "name": "Adam Beyer", "kind": "artist", "social_links": []}],
        "remixers": [],
        "release": {
            "id": "4200",
            "title": "Your Mind",
            "catalog_number": "DC287",
            "release_date": "2023-06-16",
            "artwork_url": None,
        },
        "label": {"id": "8", "name": "Drumcode", "kind": "label"},
        "genre": "Techno",
        "bpm": 134,
        "key": "4A",
        "isrc": "SE5RN2312001",
        "track_number": 1,
        "url": "https://www.beatport.com/track/your-mind/17492013",
        "source": "beatport",
    },
    # Le titre de la source n'annonce la version qu'a moitie : c'est le cas que
    # `_complete_partial_mention` traite, verifie ici de bout en bout.
    "Basiel": {
        "id": "20001",
        "title": "Basiel (Extended)",
        "mix_name": "Extended Mix",
        "artists": [{"id": "2", "name": "Amelie Lens", "kind": "artist", "social_links": []}],
        "remixers": [],
        "release": {
            "id": "4201",
            "title": "Basiel",
            "catalog_number": "LENS02",
            "release_date": "2024-02-02",
            "artwork_url": None,
        },
        "label": {"id": "9", "name": "Lenske", "kind": "label"},
        "genre": "Techno",
        "bpm": 140,
        "key": "8A",
        "isrc": "BE5RN2400001",
        "track_number": 1,
        "url": "https://www.beatport.com/track/basiel/20001",
        "source": "beatport",
    },
}


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        # Tient les requetes en vol : une annulation doit tomber pendant le run.
        time.sleep(float(os.getenv("FAKE_DELAY", "0")))
        if os.getenv("REJECT_ALL"):
            self._reply(403, {"code": "forbidden"})
            return
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        if parsed.path.endswith("/search"):
            asked = (query.get("q") or [""])[0]
            items = [track for name, track in TRACKS.items() if name.lower() in asked.lower()]
            self._reply(200, {"items": items, "next_cursor": None})
            return
        for track in TRACKS.values():
            if parsed.path.endswith(f"/tracks/{track['id']}"):
                self._reply(200, track)
                return
        self._reply(404, {"code": "not_found"})

    def _reply(self, status: int, body: dict[str, object]) -> None:
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("X-Request-ID", "verify-1")
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_args: object) -> None:
        """Silence : la query porte l'artiste et le titre."""


def serve() -> ThreadingHTTPServer:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server
