"""Corps de reponse conformes au contrat techno-scraper 4.0.0 et client mocke.

Le contrat vit dans `src/technoscraper/shared/schemas.py` du depot techno-scraper.
Les champs de profil que le sidecar ne lit pas (bio, followers, social_links...)
sont presents a dessein : ils prouvent que le mapping les ignore.
"""

from typing import TYPE_CHECKING, Final

import httpx2

from tagger.scraper_client import Credit, Source, TechnoScraperClient, TrackCandidate

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable, Coroutine

    from tagger.cache import ResponseCache

TEST_API_KEY: Final = "test-key"

# Requetes des deux morceaux des tests ; `track_payload` rend « Your Mind » par defaut.
YOUR_MIND: Final = "Adam Beyer Your Mind"
BASIEL: Final = "Amelie Lens Basiel"
SOUNDCLOUD_TRACK: Final = "https://soundcloud.com/drumcode/kasia-faithless-tarantula-2"

# Union de deux signatures (et non un retour union sur une seule) : c'est la forme
# qu'attend `httpx2.MockTransport`, covariance du retour oblige.
type Handler = (
    Callable[[httpx2.Request], httpx2.Response]
    | Callable[[httpx2.Request], Coroutine[None, None, httpx2.Response]]
)


async def no_sleep(_delay: float) -> None:
    """Attente neutralisee : les tests ne dorment jamais."""


def track_payload(**overrides: object) -> dict[str, object]:
    """Un `Track` Beatport complet, surchargeable champ par champ."""
    payload: dict[str, object] = {
        "id": "17492013",
        "title": "Your Mind",
        "source_title": "Your Mind",
        "mix_name": "Extended Mix",
        "artists": [
            {"id": "1", "name": "Adam Beyer", "kind": "artist", "social_links": []},
        ],
        "remixers": [],
        "release": {
            "id": "4200",
            "title": "Your Mind",
            "source_title": "Your Mind",
            "catalog_number": "DC287",
            "release_date": "2023-06-16",
            "artwork_url": "https://geo-media.beatport.com/image_size/500x500/cover.jpg",
        },
        "label": {"id": "8", "name": "Drumcode", "kind": "label", "followers": 1000},
        "genre": "Techno (Peak Time / Driving)",
        "bpm": 134,
        "key": "4A",
        "isrc": "SE5RN2312001",
        "track_number": 1,
        "url": "https://www.beatport.com/track/your-mind/17492013",
        "source": "beatport",
    }
    return payload | overrides


def track_candidate(
    title: str = "Your Mind",
    mix_name: str | None = "Original Mix",
    artists: tuple[str, ...] = ("Adam Beyer",),
    *,
    remixers: tuple[str, ...] = (),
    track_id: str = "1",
) -> TrackCandidate:
    """Candidat deja valide, pour les tests qui partent du modele et non du JSON."""
    return TrackCandidate(
        id=track_id,
        title=title,
        mix_name=mix_name,
        artists=tuple(Credit(name=name) for name in artists),
        remixers=tuple(Credit(name=name) for name in remixers),
        source=Source.BEATPORT,
    )


def page_payload(*items: dict[str, object]) -> dict[str, object]:
    """Enveloppe `Page[Track]`, sans curseur : le sidecar ne pagine pas."""
    return {"items": list(items), "next_cursor": None}


def soundcloud_track_payload(**overrides: object) -> dict[str, object]:
    """Un `Track` tel que `/soundcloud/resolve` le rend pour l'URL d'un morceau.

    Titre et credit deja normalises par la gateway (ADR-012 de techno-scraper) : le
    texte source survit dans `source_title`, jamais decoupe sur `&`.
    """
    payload = track_payload(
        id="2407606665",
        title="Tarantula",
        source_title="KASIA & Faithless - Tarantula - Drumcode - DCX017",
        mix_name=None,
        artists=[{"id": "318628", "name": "KASIA & Faithless", "social_links": []}],
        genre=None,
        bpm=None,
        key=None,
        isrc=None,
        track_number=None,
        url=SOUNDCLOUD_TRACK,
        source="soundcloud",
        # Catalogue et pochette d'une release SoundCloud, pas ceux du gabarit Beatport.
        release={
            "id": "2407606665",
            "title": "Tarantula",
            "catalog_number": "DCX017",
            "release_date": "2026-09-19",
            "artwork_url": "https://i1.sndcdn.com/artworks-DCX017-t500x500.jpg",
        },
    )
    return payload | overrides


def profile_payload() -> dict[str, object]:
    """`UserProfile` de `/soundcloud/resolve` : un profil et la premiere page de ses morceaux."""
    return {
        "profile": {
            "id": "318628",
            "name": "Drumcode",
            "url": "https://soundcloud.com/drumcode",
            "followers": 1000,
            "social_links": [],
        },
        "tracks": page_payload(),
    }


def recording(requests: list[httpx2.Request], response: httpx2.Response) -> Handler:
    """Handler qui note chaque requete dans `requests` puis rend toujours `response`."""

    def handler(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        return response

    return handler


def make_client(
    handler: Handler,
    *,
    sleep: Callable[[float], Awaitable[None]] = no_sleep,
    cache: ResponseCache | None = None,
) -> TechnoScraperClient:
    """Client branche sur un `MockTransport`, sans aucun appel reseau reel."""
    return TechnoScraperClient(
        TEST_API_KEY, transport=httpx2.MockTransport(handler), sleep=sleep, cache=cache
    )
