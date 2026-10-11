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
    "Dim Orbit": {
        "id": "99000101",
        "title": "Dim Orbit",
        "source_title": "Dim Orbit",
        "mix_name": "Extended Mix",
        "artists": [{"id": "1", "name": "Lior Vance", "kind": "artist", "social_links": []}],
        "remixers": [],
        "release": {
            "id": "4200",
            "title": "Dim Orbit",
            "source_title": "Dim Orbit",
            "catalog_number": "KS287",
            "release_date": "2023-06-16",
            "artwork_url": None,
        },
        "label": {"id": "8", "name": "Kestrel", "kind": "label"},
        "genre": "Techno",
        "bpm": 134,
        "key": "4A",
        "isrc": "ZZ0AA2300001",
        "track_number": 1,
        "url": "https://www.beatport.com/track/dim-orbit/99000101",
        "source": "beatport",
    },
    # La gateway rend `title` sans version, rangee dans `mix_name` : la composition
    # « Titre (Mix Name) » se verifie ici de bout en bout.
    "Kelvor": {
        "id": "20001",
        "title": "Kelvor",
        "source_title": "Kelvor",
        "mix_name": "Extended Mix",
        "artists": [{"id": "2", "name": "Orla Quenby", "kind": "artist", "social_links": []}],
        "remixers": [],
        "release": {
            "id": "4201",
            "title": "Kelvor",
            "source_title": "Kelvor",
            "catalog_number": "LENS02",
            "release_date": "2024-02-02",
            "artwork_url": None,
        },
        "label": {"id": "9", "name": "Harlow", "kind": "label"},
        "genre": "Techno",
        "bpm": 140,
        "key": "8A",
        "isrc": "BE5RN2400001",
        "track_number": 1,
        "url": "https://www.beatport.com/track/kelvor/20001",
        "source": "beatport",
    },
}


# Rattrapage par URL : ce que les routes par URL rendent, cle par URL normalisee. Une URL
# Bandcamp ou SoundCloud absente d'ici prend le 404 de la gateway (`track_not_found`).
BY_URL = {
    "/bandcamp/tracks": {
        "https://orlaquenby.bandcamp.com/track/kelvor": {
            **TRACKS["Kelvor"],
            "id": "7",
            "mix_name": None,
            "label": None,
            "url": "https://orlaquenby.bandcamp.com/track/kelvor",
            "source": "bandcamp",
        },
    },
    "/soundcloud/resolve": {
        "https://soundcloud.com/kestrel/zelka-larkspur-mothlight-2": {
            **TRACKS["Dim Orbit"],
            "id": "9900050505",
            "title": "Mothlight",
            "source_title": "ZELKA & Larkspur - Mothlight - Kestrel - KSX017",
            "mix_name": None,
            "artists": [
                {"id": "770001", "name": "ZELKA & Larkspur", "kind": "artist", "social_links": []}
            ],
            "url": "https://soundcloud.com/kestrel/zelka-larkspur-mothlight-2",
            "source": "soundcloud",
        },
        # Lien court qu'une vraie gateway resout en profil : le sidecar doit le refuser.
        "https://on.soundcloud.com/verifyprofile": {
            "profile": {
                "id": "770001",
                "name": "Kestrel",
                "url": "https://soundcloud.com/kestrel",
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
