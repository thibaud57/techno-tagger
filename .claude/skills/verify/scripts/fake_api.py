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
        "source_title": "Your Mind",
        "mix_name": "Extended Mix",
        "artists": [{"id": "1", "name": "Adam Beyer", "kind": "artist", "social_links": []}],
        "remixers": [],
        "release": {
            "id": "4200",
            "title": "Your Mind",
            "source_title": "Your Mind",
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
    # La gateway rend `title` sans version, rangee dans `mix_name` : la composition
    # « Titre (Mix Name) » se verifie ici de bout en bout.
    "Basiel": {
        "id": "20001",
        "title": "Basiel",
        "source_title": "Basiel",
        "mix_name": "Extended Mix",
        "artists": [{"id": "2", "name": "Amelie Lens", "kind": "artist", "social_links": []}],
        "remixers": [],
        "release": {
            "id": "4201",
            "title": "Basiel",
            "source_title": "Basiel",
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


# Rattrapage par URL : ce que les routes par URL rendent, cle par URL normalisee. Une URL
# Bandcamp ou SoundCloud absente d'ici prend le 404 de la gateway (`track_not_found`).
BY_URL = {
    "/bandcamp/tracks": {
        "https://amelielens.bandcamp.com/track/basiel": {
            **TRACKS["Basiel"],
            "id": "7",
            "mix_name": None,
            "label": None,
            "url": "https://amelielens.bandcamp.com/track/basiel",
            "source": "bandcamp",
        },
    },
    "/soundcloud/resolve": {
        "https://soundcloud.com/drumcode/kasia-faithless-tarantula-2": {
            **TRACKS["Your Mind"],
            "id": "2407606665",
            "title": "Tarantula",
            "source_title": "KASIA & Faithless - Tarantula - Drumcode - DCX017",
            "mix_name": None,
            "artists": [
                {"id": "318628", "name": "KASIA & Faithless", "kind": "artist", "social_links": []}
            ],
            "url": "https://soundcloud.com/drumcode/kasia-faithless-tarantula-2",
            "source": "soundcloud",
        },
        # Lien court qu'une vraie gateway resout en profil : le sidecar doit le refuser.
        "https://on.soundcloud.com/verifyprofile": {
            "profile": {
                "id": "318628",
                "name": "Drumcode",
                "url": "https://soundcloud.com/drumcode",
                "social_links": [],
            },
            "tracks": {"items": [], "next_cursor": None},
        },
    },
}

# Ids Beatport qui rendent une erreur de la gateway au lieu d'un morceau : un geste de
# rattrapage vise ainsi une panne precise sans couper le run entier comme `REJECT_ALL`.
FAILING_IDS = {
    "403403": (403, {"detail": "Invalid API key"}),
    "503503": (
        503,
        {"code": "upstream_unavailable", "provider": "beatport", "request_id": "verify-1"},
    ),
}


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        # Tient les requetes en vol : une annulation doit tomber pendant le run.
        time.sleep(float(os.getenv("FAKE_DELAY", "0")))
        if os.getenv("REJECT_ALL"):
            # Corps FastAPI par defaut : un 403 de la gateway ne porte ni code ni request_id.
            self._reply(403, {"detail": "Invalid API key"})
            return
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        if parsed.path.endswith("/search"):
            asked = (query.get("q") or [""])[0]
            items = [track for name, track in TRACKS.items() if name.lower() in asked.lower()]
            self._reply(200, {"items": items, "next_cursor": None})
            return
        if parsed.path in BY_URL:
            found = BY_URL[parsed.path].get((query.get("url") or [""])[0])
            if found is not None:
                self._reply(200, found)
                return
        for failing_id, (status, body) in FAILING_IDS.items():
            if parsed.path.endswith(f"/tracks/{failing_id}"):
                self._reply(status, body)
                return
        for track in TRACKS.values():
            if parsed.path.endswith(f"/tracks/{track['id']}"):
                self._reply(200, track)
                return
        provider = parsed.path.strip("/").split("/")[0]
        self._reply(404, {"code": "not_found", "provider": provider, "request_id": "verify-1"})

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
