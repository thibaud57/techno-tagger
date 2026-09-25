# Client techno-scraper : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Isoler tout le contrat techno-scraper derrière un client asynchrone qui cherche un morceau sur Beatport et Bandcamp et traduit chaque réponse en résultat typé.

**Architecture:** Un module `tagger/scraper_client.py`, couche anti-corruption : URL, routes, codes HTTP et noms de champs n'en sortent pas. `TechnoScraperClient` enveloppe un `httpx2.AsyncClient`, et toutes ses requêtes passent par une méthode privée unique. Cette méthode borne la concurrence par source, retente les seules erreurs réseau sans réponse et traduit chaque réponse en modèle pydantic figé ou en erreur typée. Le sub-project 04 y branchera le cache.

**Tech Stack:** Python 3.14 (`asyncio`), httpx2 2.12 (`AsyncClient`, `MockTransport`), pydantic 2.13, pytest + pytest-asyncio (mode strict), Mypy strict, Ruff. Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/onglet-scraping-pipeline-de-re-tagging/02-client-techno-scraper-design.md`

## Global Constraints

- **Contrat de référence** : techno-scraper 3.1.3, `src/technoscraper/shared/schemas.py` (clone local `../techno-scraper`). `Track` : `id`, `title`, `mix_name`, `artists`, `remixers`, `release` (`id`, `title`, `catalog_number`, `release_date`, `artwork_url`), `label`, `genre`, `bpm`, `key`, `isrc`, `track_number`, `url`, `source`. Pas de `duration`.
- **URL de base unique** : `API_BASE_URL = "https://techno-scraper.empiricmind.fr"`, nulle part ailleurs dans le sidecar.
- **Routes** : `GET /beatport/search?q=&type=tracks`, `GET /bandcamp/search?q=&type=tracks`, `GET /beatport/tracks/{id}`, `GET /bandcamp/tracks?url=`. Pas de pagination, `next_cursor` jamais lu.
- **`q` tronqué à 200 caractères** (`max_length` côté API, `422` au-delà).
- **Timeout** : `httpx2.Timeout(connect=10.0, read=100.0, write=10.0, pool=10.0)`.
- **Concurrence** : un `asyncio.Semaphore` par source, 3 pour Beatport, 2 pour Bandcamp (ADR-017), relâché pendant l'attente entre deux tentatives.
- **Nouvelle tentative** : uniquement sur erreur réseau sans réponse (`NetworkError`, `ConnectTimeout`, `RemoteProtocolError`), deux fois, après 1 s puis 2 s. Jamais sur 403, 5xx, 404, 4xx ni timeout de lecture, d'écriture ou de pool.
- **Codes d'erreur** : `api_key_rejected`, `source_unavailable`, `track_not_found`, `api_contract_error`, famille `ScraperError(TaggerError)`.
- **Logs** : le client ne logue que ses nouvelles tentatives (WARNING, clés `source` et `reason`). Jeu de clés logfmt : `run`, `track`, `source`, `score`, `status`, `reason`, `request_id`. La clé API n'apparaît jamais dans un log ni dans des `params`.
- **Réutiliser** `tagger.errors.TaggerError(message: str, **params: object)`, `code: ClassVar[str]`.
- **Tests** : `MockTransport` injecté par le paramètre `transport`, jamais `respx` ni `pytest-httpx`. `pytestmark = pytest.mark.asyncio` (mode strict). Noms en anglais, AAA séparé par des lignes vides. Aucun appel réseau réel.
- **Gate qualité vert à chaque commit** : `just test` (couverture 80 %), `just lint`, `just typecheck`. Commits `type(scope): description`, scope `sidecar`.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `sidecar/src/tagger/scraper_client.py` | Constantes, `Source`, modèles figés, erreurs, `TechnoScraperClient`. |
| `sidecar/tests/helpers/scraper_responses.py` | Corps JSON conformes au contrat, fabrique de client sur `MockTransport`. |
| `sidecar/tests/unit/test_scraper_client_requests.py` | Routes, paramètres, en-tête, mapping. |
| `sidecar/tests/unit/test_scraper_client_errors.py` | Traduction des codes, nouvelles tentatives, `request_id`. |
| `sidecar/tests/unit/test_scraper_client_concurrency.py` | Bornes 3 et 2. |
| `sidecar/tests/conftest.py` | Le TODO du transport mocké disparaît. |
| `public/i18n/fr.json`, `public/i18n/en.json` | Une phrase par nouveau code d'erreur, exigée par `test_error_translations.py`. |
| `docs/knowledges/techno-scraper.md` | § Contrat Track normalisé et table des erreurs alignés sur 3.1.3. |
| `docs/PRODUCTION.md`, `.claude/rules/python/gestion-erreurs.md` | Clé `request_id` ajoutée au jeu logfmt. |

---

## Task 1: Modèles, recherche et refetch

**Files:**
- Modify: `sidecar/src/tagger/scraper_client.py` (remplace le placeholder)
- Create: `sidecar/tests/helpers/scraper_responses.py`
- Modify: `sidecar/tests/conftest.py`
- Modify: `docs/knowledges/techno-scraper.md`
- Test: `sidecar/tests/unit/test_scraper_client_requests.py`

**Interfaces:**
- Consumes: `tagger.errors.TaggerError`
- Produces:
  - `API_BASE_URL: Final[str]`, `QUERY_MAX_LENGTH: Final = 200`
  - `Source(StrEnum)` : `BEATPORT`, `BANDCAMP`, `SOUNDCLOUD` ; `type SearchSource = Literal[Source.BEATPORT, Source.BANDCAMP]`
  - `Credit(name: str)`, `ReleaseInfo(id, title, catalog_number, release_date, artwork_url)`, `TrackCandidate(id, title, mix_name, artists, remixers, release, label, genre, bpm, key, isrc, track_number, url, source)` : `BaseModel` figés, `extra="ignore"`, `artists` et `remixers` en `tuple[Credit, ...]`
  - `TechnoScraperClient(api_key: str, *, transport: httpx2.AsyncBaseTransport | None = None, sleep: Callable[[float], Awaitable[None]] = asyncio.sleep)`, context manager asynchrone
  - `async search(source: SearchSource, query: str) -> tuple[TrackCandidate, ...]`
  - `async fetch_beatport_track(track_id: str) -> TrackCandidate`
  - `async fetch_bandcamp_track(url: str) -> TrackCandidate`
  - helpers de test : `track_payload(**overrides: object) -> dict[str, object]`, `page_payload(*items: dict[str, object]) -> dict[str, object]`, `make_client(handler, *, sleep=...) -> TechnoScraperClient`, `TEST_API_KEY`

- [ ] **Step 1: Écrire le helper de réponses**

Créer `sidecar/tests/helpers/scraper_responses.py` :

```python
"""Corps de reponse conformes au contrat techno-scraper 3.1.3 et client mocke.

Le contrat vit dans `src/technoscraper/shared/schemas.py` du depot techno-scraper.
Les champs de profil que le sidecar ne lit pas (bio, followers, social_links...)
sont presents a dessein : ils prouvent que le mapping les ignore.
"""

from typing import TYPE_CHECKING, Final

import httpx2

from tagger.scraper_client import TechnoScraperClient

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

TEST_API_KEY: Final = "test-key"

type Handler = Callable[[httpx2.Request], httpx2.Response | Awaitable[httpx2.Response]]


async def no_sleep(_delay: float) -> None:
    """Attente neutralisee : les tests ne dorment jamais."""


def track_payload(**overrides: object) -> dict[str, object]:
    """Un `Track` Beatport complet, surchargeable champ par champ."""
    payload: dict[str, object] = {
        "id": "17492013",
        "title": "Your Mind",
        "mix_name": "Extended Mix",
        "artists": [
            {"id": "1", "name": "Adam Beyer", "kind": "artist", "social_links": []},
        ],
        "remixers": [],
        "release": {
            "id": "4200",
            "title": "Your Mind",
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


def page_payload(*items: dict[str, object]) -> dict[str, object]:
    """Enveloppe `Page[Track]`, sans curseur : le sidecar ne pagine pas."""
    return {"items": list(items), "next_cursor": None}


def make_client(
    handler: Handler, *, sleep: Callable[[float], Awaitable[None]] = no_sleep
) -> TechnoScraperClient:
    """Client branche sur un `MockTransport`, sans aucun appel reseau reel."""
    return TechnoScraperClient(
        TEST_API_KEY, transport=httpx2.MockTransport(handler), sleep=sleep
    )
```

Dans `sidecar/tests/conftest.py`, retirer du TODO la mention du transport httpx2 mocké (le sub-project 01 y a peut-être déjà retiré la fixture audio : les deux sub-projects sont indépendants, ne compter aucune ligne) : le client se construit par `make_client`, aucune fixture n'est nécessaire.

- [ ] **Step 2: Écrire les tests de requêtes et de mapping**

Créer `sidecar/tests/unit/test_scraper_client_requests.py` :

```python
"""Tests des requetes emises et du mapping des reponses techno-scraper."""

import httpx2
import pytest
from scraper_responses import TEST_API_KEY, Handler, make_client, page_payload, track_payload

from tagger.scraper_client import Credit, Source

pytestmark = pytest.mark.asyncio


def _recording(requests: list[httpx2.Request], body: dict[str, object]) -> Handler:
    def handler(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        return httpx2.Response(200, json=body)

    return handler


async def test_sends_a_beatport_search_to_the_search_route_with_the_query_and_type() -> None:
    requests: list[httpx2.Request] = []

    async with make_client(_recording(requests, page_payload())) as client:
        await client.search(Source.BEATPORT, "Adam Beyer Your Mind")

    assert requests[0].url.host == "techno-scraper.empiricmind.fr"
    assert requests[0].url.path == "/beatport/search"
    assert dict(requests[0].url.params) == {"q": "Adam Beyer Your Mind", "type": "tracks"}


async def test_sends_the_api_key_header_on_every_request() -> None:
    requests: list[httpx2.Request] = []

    async with make_client(_recording(requests, page_payload())) as client:
        await client.search(Source.BANDCAMP, "Amelie Lens Basiel")

    assert requests[0].headers["X-API-Key"] == TEST_API_KEY


async def test_maps_each_item_to_a_track_candidate_with_its_release_label_and_credits() -> None:
    requests: list[httpx2.Request] = []

    async with make_client(_recording(requests, page_payload(track_payload()))) as client:
        candidates = await client.search(Source.BEATPORT, "Adam Beyer Your Mind")

    candidate = candidates[0]
    assert candidate.title == "Your Mind"
    assert candidate.mix_name == "Extended Mix"
    assert candidate.artists == (Credit(name="Adam Beyer"),)
    assert candidate.label == Credit(name="Drumcode")
    assert candidate.release is not None
    assert candidate.release.catalog_number == "DC287"
    assert candidate.source is Source.BEATPORT


async def test_ignores_fields_the_candidate_model_does_not_declare() -> None:
    requests: list[httpx2.Request] = []
    item = track_payload(waveform_url="https://example.invalid/wave.png")

    async with make_client(_recording(requests, page_payload(item))) as client:
        candidates = await client.search(Source.BEATPORT, "Adam Beyer Your Mind")

    assert "waveform_url" not in candidates[0].model_dump()


async def test_returns_an_empty_tuple_when_the_source_finds_nothing() -> None:
    requests: list[httpx2.Request] = []

    async with make_client(_recording(requests, page_payload())) as client:
        candidates = await client.search(Source.BANDCAMP, "unknown track")

    assert candidates == ()


async def test_truncates_a_query_longer_than_two_hundred_characters() -> None:
    requests: list[httpx2.Request] = []

    async with make_client(_recording(requests, page_payload())) as client:
        await client.search(Source.BEATPORT, "x" * 250)

    assert len(requests[0].url.params["q"]) == 200


async def test_fetches_a_beatport_track_by_id() -> None:
    requests: list[httpx2.Request] = []

    async with make_client(_recording(requests, track_payload())) as client:
        candidate = await client.fetch_beatport_track("17492013")

    assert requests[0].url.path == "/beatport/tracks/17492013"
    assert candidate.id == "17492013"


async def test_fetches_a_bandcamp_track_by_url() -> None:
    requests: list[httpx2.Request] = []
    url = "https://amelielens.bandcamp.com/track/basiel"
    body = track_payload(source="bandcamp", url=url, mix_name=None)

    async with make_client(_recording(requests, body)) as client:
        candidate = await client.fetch_bandcamp_track(url)

    assert requests[0].url.path == "/bandcamp/tracks"
    assert dict(requests[0].url.params) == {"url": url}
    assert candidate.source is Source.BANDCAMP
```

- [ ] **Step 3: Vérifier que les tests échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_scraper_client_requests.py -x -q`
Expected: FAIL, `ImportError: cannot import name 'TechnoScraperClient' from 'tagger.scraper_client'`

- [ ] **Step 4: Implémenter modèles et client**

Remplacer tout le contenu de `sidecar/src/tagger/scraper_client.py` :

```python
"""Client de l'API techno-scraper, seule source de donnees du sidecar.

Couche anti-corruption : URL, routes, codes HTTP et noms de champs ne sortent pas
de ce module (ARCHITECTURE.md § Patterns Utilises). Contrat de reference :
techno-scraper 3.1.3, `src/technoscraper/shared/schemas.py`.
"""

import asyncio
from datetime import date
from enum import UNIQUE, StrEnum, auto, verify
from typing import TYPE_CHECKING, Final, Literal, NamedTuple, Self

import httpx2
from pydantic import BaseModel, ConfigDict

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable, Mapping

API_BASE_URL: Final = "https://techno-scraper.empiricmind.fr"

# `q` est borne a 200 caracteres par l'API, qui rend 422 au-dela.
QUERY_MAX_LENGTH: Final = 200

# `read` au-dessus du budget de 90 s de l'API : on recoit son 504 structure plutot
# qu'un timeout local aveugle (ADR-017).
_TIMEOUT: Final = httpx2.Timeout(connect=10.0, read=100.0, write=10.0, pool=10.0)


@verify(UNIQUE)
class Source(StrEnum):
    """Origine d'un morceau, meme vocabulaire que le champ `source` de l'API."""

    BEATPORT = auto()
    BANDCAMP = auto()
    SOUNDCLOUD = auto()


type SearchSource = Literal[Source.BEATPORT, Source.BANDCAMP]


class _ApiModel(BaseModel):
    """Un champ ajoute par l'API reste ignore tant qu'un modele ne le declare pas."""

    model_config = ConfigDict(extra="ignore", frozen=True)


class Credit(_ApiModel):
    """Artiste, remixeur ou label : le sidecar n'en lit que le nom."""

    name: str


class ReleaseInfo(_ApiModel):
    """Sortie du morceau, qui porte date, catalogue et pochette."""

    id: str | None = None
    title: str | None = None
    catalog_number: str | None = None
    release_date: date | None = None
    artwork_url: str | None = None


class TrackCandidate(_ApiModel):
    """Morceau rendu par une source. Un champ nul : la source ne l'expose pas."""

    id: str | None = None
    title: str
    mix_name: str | None = None
    artists: tuple[Credit, ...] = ()
    remixers: tuple[Credit, ...] = ()
    release: ReleaseInfo | None = None
    label: Credit | None = None
    genre: str | None = None
    bpm: int | None = None
    key: str | None = None
    isrc: str | None = None
    track_number: int | None = None
    url: str | None = None
    source: Source


class _TrackPage(_ApiModel):
    items: tuple[TrackCandidate, ...] = ()


class _ApiResponse(NamedTuple):
    payload: object
    request_id: str


class TechnoScraperClient:
    """Recherche et refetch de morceaux sur techno-scraper.

    Le transport et l'attente entre deux tentatives sont injectables : c'est ce
    qui rend le client testable sous `MockTransport` sans dormir.
    """

    def __init__(
        self,
        api_key: str,
        *,
        transport: httpx2.AsyncBaseTransport | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._http = httpx2.AsyncClient(
            base_url=API_BASE_URL,
            headers={"X-API-Key": api_key},
            timeout=_TIMEOUT,
            transport=transport,
        )
        self._sleep = sleep

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *_exc_info: object) -> None:
        await self._http.aclose()

    async def search(self, source: SearchSource, query: str) -> tuple[TrackCandidate, ...]:
        """Premiere page de candidats, vide quand la source ne connait pas le morceau."""
        params = {"q": query[:QUERY_MAX_LENGTH], "type": "tracks"}
        response = await self._get(source, f"/{source}/search", params)
        return _TrackPage.model_validate(response.payload).items

    async def fetch_beatport_track(self, track_id: str) -> TrackCandidate:
        """Metadonnees completes : les objets de recherche sont abreges."""
        response = await self._get(Source.BEATPORT, f"/beatport/tracks/{track_id}", {})
        return TrackCandidate.model_validate(response.payload)

    async def fetch_bandcamp_track(self, url: str) -> TrackCandidate:
        """Metadonnees completes : la recherche Bandcamp ne rend ni date ni label."""
        response = await self._get(Source.BANDCAMP, "/bandcamp/tracks", {"url": url})
        return TrackCandidate.model_validate(response.payload)

    async def _get(
        self, source: SearchSource, path: str, params: Mapping[str, str]
    ) -> _ApiResponse:
        """Point de passage unique de toute requete, ou le cache se branchera."""
        response = await self._http.get(path, params=params)
        return _ApiResponse(response.json(), response.headers.get("X-Request-ID", ""))
```

`source` n'est pas encore lu dans `_get` : les Tasks 2 et 3 s'en servent pour les erreurs et les sémaphores.

- [ ] **Step 5: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_scraper_client_requests.py -x -q`
Expected: PASS, 8 tests

- [ ] **Step 6: Réaligner la fiche de connaissance**

Dans `docs/knowledges/techno-scraper.md` § Contrat Track normalisé, remplacer le bloc d'exemple par :

```python
{
    "id": str | None,              # id Beatport, clé du refetch /beatport/tracks/{id}
    "title": str,
    "mix_name": str | None,        # séparé du titre, pas collé entre parenthèses
    "artists": list[Profile],      # remixers exclus, par convention
    "remixers": list[Profile],
    "release": Release | None,     # id, title, catalog_number, release_date, artwork_url
    "label": Profile | None,
    "genre": str | None,
    "bpm": int | None,
    "key": str | None,             # notation Camelot (« 4A »)
    "isrc": str | None,
    "track_number": int | None,
    "url": str | None,
    "source": "beatport" | "bandcamp" | "soundcloud",
}
```

Sous le bloc, ajouter en tête des Points Importants :

```markdown
- **Forme vérifiée sur techno-scraper 3.1.3** (`src/technoscraper/shared/schemas.py`, lu le 2026-09-19) : la date, le numéro de catalogue et la pochette vivent sous `release`, jamais à la racine, et `duration` n'existe pas. `Profile` porte bien d'autres champs (`bio`, `followers`, `social_links`) que le sidecar ignore
```

Remplacer la puce « Sur `search`, les objets sont parfois abrégés » par :

```markdown
- **Sur `search`, les objets sont abrégés** : un refetch est nécessaire pour des métadonnées complètes, par id sur Beatport (`GET /beatport/tracks/{id}`), par URL sur Bandcamp (`GET /bandcamp/tracks?url=`), dont la recherche ne rend ni date, ni label, ni ISRC, ni numéro de piste
```

Remplacer la puce `artwork_url` par la même phrase en écrivant `release.artwork_url`.

Dans la table de sémantique des erreurs, ajouter les lignes que le README de techno-scraper 3.1.3 documente et que la fiche omet : `422` (paramètre de requête invalide, corps FastAPI standard), `500 internal_error` et `503 quota_exceeded` (SoundCloud uniquement). Le client les traite comme un contrat cassé pour `422` et `500`, comme une source indisponible pour `503`.

- [ ] **Step 7: Gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 8: Commit**

```bash
git add sidecar/src/tagger/scraper_client.py sidecar/tests/helpers/scraper_responses.py sidecar/tests/conftest.py sidecar/tests/unit/test_scraper_client_requests.py docs/knowledges/techno-scraper.md
git commit -m "feat(sidecar): chercher et recharger un morceau sur techno-scraper"
```

---

## Task 2: Traduction des réponses et nouvelle tentative réseau

**Files:**
- Modify: `sidecar/src/tagger/scraper_client.py`
- Modify: `docs/PRODUCTION.md` (§ Logging, règle du jeu de clés)
- Modify: `.claude/rules/python/gestion-erreurs.md` (même règle)
- Modify: `public/i18n/fr.json`, `public/i18n/en.json` (cinq codes d'erreur)
- Test: `sidecar/tests/unit/test_scraper_client_errors.py`

**Interfaces:**
- Consumes: `TechnoScraperClient`, `_ApiResponse`, `Source`, `SearchSource` (Task 1), `make_client`, `no_sleep`, `page_payload`, `track_payload` (helpers)
- Produces:
  - `ScraperError(TaggerError)`, code `scraper_error`
  - `ApiKeyRejectedError(*, request_id: str)`, code `api_key_rejected`
  - `SourceUnavailableError(source: Source, *, status: int | None, reason: str, request_id: str)`, code `source_unavailable`, attributs `source`, `status`, `reason`, `request_id`
  - `TrackNotFoundError(source: Source, *, request_id: str)`, code `track_not_found`
  - `ApiContractError(detail: str, *, request_id: str)`, code `api_contract_error`
  - `RETRY_DELAYS: Final = (1.0, 2.0)`

- [ ] **Step 1: Écrire les tests d'erreurs**

Créer `sidecar/tests/unit/test_scraper_client_errors.py` :

```python
"""Tests de la traduction des reponses et de la nouvelle tentative reseau."""

import httpx2
import pytest
from scraper_responses import Handler, make_client, page_payload, track_payload

from tagger.scraper_client import (
    ApiContractError,
    ApiKeyRejectedError,
    Source,
    SourceUnavailableError,
    TrackNotFoundError,
)

pytestmark = pytest.mark.asyncio


def _answering(requests: list[httpx2.Request], response: httpx2.Response) -> Handler:
    def handler(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        return response

    return handler


def _raising(requests: list[httpx2.Request], error: type[httpx2.TransportError]) -> Handler:
    def handler(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        raise error("transport failure", request=request)

    return handler


async def test_raises_api_key_rejected_on_a_403_without_retrying() -> None:
    requests: list[httpx2.Request] = []
    response = httpx2.Response(403, json={"detail": "Invalid API key"})

    async with make_client(_answering(requests, response)) as client:
        with pytest.raises(ApiKeyRejectedError):
            await client.search(Source.BEATPORT, "Adam Beyer Your Mind")

    assert len(requests) == 1


@pytest.mark.parametrize(
    ("status", "api_code"),
    [(502, "parse_error"), (503, "source_unavailable"), (504, "request_timeout")],
    ids=["parse-error", "source-down", "api-timeout"],
)
async def test_raises_source_unavailable_on_server_errors_without_retrying(
    status: int, api_code: str
) -> None:
    requests: list[httpx2.Request] = []
    response = httpx2.Response(status, json={"code": api_code, "request_id": "req-1"})

    async with make_client(_answering(requests, response)) as client:
        with pytest.raises(SourceUnavailableError) as error:
            await client.search(Source.BEATPORT, "Adam Beyer Your Mind")

    assert error.value.reason == api_code
    assert len(requests) == 1


async def test_carries_the_status_the_api_code_and_the_request_id() -> None:
    requests: list[httpx2.Request] = []
    response = httpx2.Response(
        504, json={"code": "request_timeout"}, headers={"X-Request-ID": "req-42"}
    )

    async with make_client(_answering(requests, response)) as client:
        with pytest.raises(SourceUnavailableError) as error:
            await client.search(Source.BANDCAMP, "Amelie Lens Basiel")

    assert error.value.source is Source.BANDCAMP
    assert error.value.status == 504
    assert error.value.reason == "request_timeout"
    assert error.value.request_id == "req-42"


async def test_raises_source_unavailable_on_a_local_timeout_without_retrying() -> None:
    requests: list[httpx2.Request] = []

    async with make_client(_raising(requests, httpx2.ReadTimeout)) as client:
        with pytest.raises(SourceUnavailableError) as error:
            await client.search(Source.BEATPORT, "Adam Beyer Your Mind")

    assert error.value.reason == "timeout"
    assert error.value.status is None
    assert len(requests) == 1


async def test_retries_a_network_error_twice_then_raises_source_unavailable() -> None:
    requests: list[httpx2.Request] = []

    async with make_client(_raising(requests, httpx2.ConnectError)) as client:
        with pytest.raises(SourceUnavailableError) as error:
            await client.search(Source.BEATPORT, "Adam Beyer Your Mind")

    assert error.value.reason == "network"
    assert len(requests) == 3


async def test_returns_the_result_when_a_network_error_is_followed_by_a_success() -> None:
    requests: list[httpx2.Request] = []

    def flaky(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        if len(requests) < 3:
            raise httpx2.ConnectError("connection refused", request=request)
        return httpx2.Response(200, json=page_payload(track_payload()))

    async with make_client(flaky) as client:
        candidates = await client.search(Source.BEATPORT, "Adam Beyer Your Mind")

    assert len(candidates) == 1


async def test_waits_one_then_two_seconds_between_attempts() -> None:
    requests: list[httpx2.Request] = []
    waited: list[float] = []

    async def recording_sleep(delay: float) -> None:
        waited.append(delay)

    client = make_client(_raising(requests, httpx2.ConnectError), sleep=recording_sleep)
    async with client:
        with pytest.raises(SourceUnavailableError):
            await client.search(Source.BEATPORT, "Adam Beyer Your Mind")

    assert waited == [1.0, 2.0]


async def test_raises_track_not_found_on_a_404_refetch() -> None:
    requests: list[httpx2.Request] = []
    response = httpx2.Response(404, json={"code": "not_found", "provider": "beatport"})

    async with make_client(_answering(requests, response)) as client:
        with pytest.raises(TrackNotFoundError):
            await client.fetch_beatport_track("999999999")


async def test_raises_api_contract_error_on_a_422() -> None:
    requests: list[httpx2.Request] = []
    response = httpx2.Response(422, json={"detail": []})

    async with make_client(_answering(requests, response)) as client:
        with pytest.raises(ApiContractError):
            await client.search(Source.BEATPORT, "Adam Beyer Your Mind")


async def test_raises_api_contract_error_on_a_response_that_does_not_validate() -> None:
    requests: list[httpx2.Request] = []
    item = track_payload()
    del item["title"]
    response = httpx2.Response(200, json=page_payload(item))

    async with make_client(_answering(requests, response)) as client:
        with pytest.raises(ApiContractError):
            await client.search(Source.BEATPORT, "Adam Beyer Your Mind")
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_scraper_client_errors.py -x -q`
Expected: FAIL, `ImportError: cannot import name 'ApiContractError' from 'tagger.scraper_client'`

- [ ] **Step 3: Implémenter erreurs, traduction et nouvelle tentative**

Dans `sidecar/src/tagger/scraper_client.py`, compléter les imports :

```python
import asyncio
import logging
from datetime import date
from enum import UNIQUE, StrEnum, auto, verify
from typing import TYPE_CHECKING, ClassVar, Final, Literal, NamedTuple, Self

import httpx2
from pydantic import BaseModel, ConfigDict, ValidationError

from tagger.errors import TaggerError

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable, Mapping

logger = logging.getLogger(__name__)
```

Ajouter après `_TIMEOUT` :

```python
# Deux nouvelles tentatives sur erreur reseau sans reponse, rien d'autre : un 503 a
# deja ete retente trois fois cote API, un 504 signale une file saturee, un 403 une
# cle a corriger (decision du 2026-09-19).
RETRY_DELAYS: Final = (1.0, 2.0)

# Aucune reponse recue : DNS, connexion refusee ou coupee, delai de connexion depasse.
# Un timeout de lecture, lui, survient apres 100 s et ne se retente pas.
_NETWORK_FAILURES: Final = (httpx2.NetworkError, httpx2.ConnectTimeout, httpx2.RemoteProtocolError)
```

Ajouter après `_ApiResponse` :

```python
class ScraperError(TaggerError):
    """Echec d'un appel a techno-scraper, traduit depuis sa reponse."""

    code: ClassVar[str] = "scraper_error"


class ApiKeyRejectedError(ScraperError):
    """403 : cle absente ou invalide, a corriger dans les Settings."""

    code: ClassVar[str] = "api_key_rejected"

    def __init__(self, *, request_id: str) -> None:
        super().__init__("api key rejected", request_id=request_id)
        self.request_id = request_id


class SourceUnavailableError(ScraperError):
    """La source n'a pas repondu : 5xx, erreur reseau ou timeout local.

    `reason` distingue dans le log un `parse_error` d'une source injoignable, les
    deux donnant le meme `failure_reason`.
    """

    code: ClassVar[str] = "source_unavailable"

    def __init__(
        self, source: Source, *, status: int | None, reason: str, request_id: str
    ) -> None:
        super().__init__(
            f"source unavailable: {source}",
            source=source,
            status=status,
            reason=reason,
            request_id=request_id,
        )
        self.source = source
        self.status = status
        self.reason = reason
        self.request_id = request_id


class TrackNotFoundError(ScraperError):
    """404 sur un refetch : l'id ou l'URL ne designe aucun morceau."""

    code: ClassVar[str] = "track_not_found"

    def __init__(self, source: Source, *, request_id: str) -> None:
        super().__init__(f"track not found: {source}", source=source, request_id=request_id)
        self.request_id = request_id


class ApiContractError(ScraperError):
    """Requete refusee ou reponse hors contrat : bug du sidecar ou derive de l'API."""

    code: ClassVar[str] = "api_contract_error"

    def __init__(self, detail: str, *, request_id: str) -> None:
        super().__init__(f"api contract broken: {detail}", request_id=request_id)
        self.request_id = request_id
```

Remplacer les trois méthodes publiques et `_get` de `TechnoScraperClient` :

```python
    async def search(self, source: SearchSource, query: str) -> tuple[TrackCandidate, ...]:
        """Premiere page de candidats, vide quand la source ne connait pas le morceau."""
        params = {"q": query[:QUERY_MAX_LENGTH], "type": "tracks"}
        response = await self._get(source, f"/{source}/search", params)
        return _validate(_TrackPage, response).items

    async def fetch_beatport_track(self, track_id: str) -> TrackCandidate:
        """Metadonnees completes : les objets de recherche sont abreges."""
        response = await self._get(Source.BEATPORT, f"/beatport/tracks/{track_id}", {})
        return _validate(TrackCandidate, response)

    async def fetch_bandcamp_track(self, url: str) -> TrackCandidate:
        """Metadonnees completes : la recherche Bandcamp ne rend ni date ni label."""
        response = await self._get(Source.BANDCAMP, "/bandcamp/tracks", {"url": url})
        return _validate(TrackCandidate, response)

    async def _get(
        self, source: SearchSource, path: str, params: Mapping[str, str]
    ) -> _ApiResponse:
        """Point de passage unique de toute requete, ou le cache se branchera."""
        delays = iter(RETRY_DELAYS)
        while True:
            try:
                response = await self._http.get(path, params=params)
            except httpx2.RequestError as exc:
                delay = next(delays, None) if isinstance(exc, _NETWORK_FAILURES) else None
                if delay is None:
                    raise _unavailable_without_response(source, exc) from exc
                logger.warning("network error, retrying source=%s reason=network", source)
                await self._sleep(delay)
            else:
                return _translate(source, response)
```

Ajouter les fonctions de module à la fin du fichier :

```python
def _translate(source: SearchSource, response: httpx2.Response) -> _ApiResponse:
    """Seul endroit ou un code HTTP de l'API est lu."""
    request_id = response.headers.get("X-Request-ID", "")
    try:
        response.raise_for_status()
    except httpx2.HTTPStatusError as exc:
        status = response.status_code
        if status == 403:
            raise ApiKeyRejectedError(request_id=request_id) from exc
        if status == 404:
            raise TrackNotFoundError(source, request_id=request_id) from exc
        if status >= 500:
            raise SourceUnavailableError(
                source, status=status, reason=_api_code(response), request_id=request_id
            ) from exc
        raise ApiContractError(f"status {status}", request_id=request_id) from exc
    try:
        return _ApiResponse(response.json(), request_id)
    except ValueError as exc:
        raise ApiContractError("invalid json", request_id=request_id) from exc


def _validate[M: BaseModel](model: type[M], response: _ApiResponse) -> M:
    try:
        return model.model_validate(response.payload)
    except ValidationError as exc:
        raise ApiContractError(model.__name__, request_id=response.request_id) from exc


def _api_code(response: httpx2.Response) -> str:
    """Code du corps d'erreur de l'API, vide sur un 403 FastAPI ou un proxy HTML."""
    try:
        body = response.json()
    except ValueError:
        return ""
    code = body.get("code") if isinstance(body, dict) else None
    return code if isinstance(code, str) else ""


def _unavailable_without_response(
    source: SearchSource, error: httpx2.RequestError
) -> SourceUnavailableError:
    reason = "network" if isinstance(error, _NETWORK_FAILURES) else "timeout"
    return SourceUnavailableError(source, status=None, reason=reason, request_id="")
```

`_translate` et `_validate` sont désormais les seuls points qui lisent un statut ou valident un corps : `search` et les deux refetch passent tous par eux.

- [ ] **Step 4: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_scraper_client_errors.py tests/unit/test_scraper_client_requests.py -x -q`
Expected: PASS, 20 tests (12 d'erreurs, paramétrage compris, plus les 8 de la Task 1)

- [ ] **Step 5: Ajouter `request_id` au jeu de clés logfmt**

Dans `docs/PRODUCTION.md` § Logging, remplacer la règle du jeu de clés par :

```markdown
- ✅ **Jeu de clés logfmt fixe** : `run`, `track`, `source`, `score`, `status`, `reason`, `request_id`. C'est le seul coût du format : une clé inventée au fil des commits (`track_id` à côté de `track`) rend un `grep` faux sans que rien ne casse ni ne se voie. `request_id` reprend l'en-tête `X-Request-ID` de techno-scraper, seul lien entre une ligne du sidecar et la ligne correspondante côté API (ajoutée le 2026-09-19).
```

Dans `.claude/rules/python/gestion-erreurs.md`, remplacer `jeu de clés fixe (\`run\`, \`track\`, \`source\`, \`score\`, \`status\`, \`reason\`)` par `jeu de clés fixe (\`run\`, \`track\`, \`source\`, \`score\`, \`status\`, \`reason\`, \`request_id\`)`.

- [ ] **Step 6: Gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 7: Traduire les nouveaux codes d'erreur**

`sidecar/tests/unit/test_error_translations.py` parcourt toutes les sous-classes de `TaggerError`, bases abstraites comprises, et exige une entrée `errors.<code>` dans les deux langues. Dans le bloc `errors` de `public/i18n/fr.json`, ajouter :

```json
    "scraper_error": "L'API techno-scraper a répondu par une erreur.",
    "api_key_rejected": "La clé API a été refusée. Vérifiez-la dans les Réglages.",
    "source_unavailable": "La source {{source}} n'a pas répondu.",
    "track_not_found": "Le morceau n'existe plus sur {{source}}.",
    "api_contract_error": "Réponse inattendue de l'API techno-scraper. Si elle revient, le détail se trouve dans le dossier des logs.",
```

et dans `public/i18n/en.json`, au même endroit :

```json
    "scraper_error": "The techno-scraper API answered with an error.",
    "api_key_rejected": "The API key was rejected. Check it in the settings.",
    "source_unavailable": "The source {{source}} did not respond.",
    "track_not_found": "The track no longer exists on {{source}}.",
    "api_contract_error": "Unexpected answer from the techno-scraper API. If it happens again, the details are in the logs folder.",
```

- [ ] **Step 8: Commit**

```bash
git add public/i18n/fr.json public/i18n/en.json sidecar/src/tagger/scraper_client.py sidecar/tests/unit/test_scraper_client_errors.py docs/PRODUCTION.md .claude/rules/python/gestion-erreurs.md
git commit -m "feat(sidecar): traduire les reponses techno-scraper en erreurs typees"
```

---

## Task 3: Bornes de concurrence par source

**Files:**
- Modify: `sidecar/src/tagger/scraper_client.py`
- Test: `sidecar/tests/unit/test_scraper_client_concurrency.py`

**Interfaces:**
- Consumes: `TechnoScraperClient._get` (Task 2), `make_client`, `page_payload` (helpers)
- Produces: `BEATPORT_CONCURRENCY: Final = 3`, `BANDCAMP_CONCURRENCY: Final = 2`

- [ ] **Step 1: Écrire les tests de bornes**

Créer `sidecar/tests/unit/test_scraper_client_concurrency.py` :

```python
"""Tests des bornes de concurrence par source (ADR-017)."""

import asyncio

import httpx2
import pytest
from scraper_responses import make_client, page_payload

from tagger.scraper_client import SearchSource, Source

pytestmark = pytest.mark.asyncio


class _InFlight:
    """Compte les requetes en vol et retient le maximum atteint."""

    def __init__(self) -> None:
        self.current = 0
        self.peak = 0

    async def handler(self, _request: httpx2.Request) -> httpx2.Response:
        self.current += 1
        self.peak = max(self.peak, self.current)
        await asyncio.sleep(0.01)
        self.current -= 1
        return httpx2.Response(200, json=page_payload())


async def _search_ten_times(source: SearchSource, in_flight: _InFlight) -> None:
    async with make_client(in_flight.handler) as client, asyncio.TaskGroup() as group:
        for index in range(10):
            group.create_task(client.search(source, f"query {index}"), name=f"search:{index}")


async def test_never_keeps_more_than_three_beatport_requests_in_flight() -> None:
    in_flight = _InFlight()

    await _search_ten_times(Source.BEATPORT, in_flight)

    assert in_flight.peak == 3


async def test_never_keeps_more_than_two_bandcamp_requests_in_flight() -> None:
    in_flight = _InFlight()

    await _search_ten_times(Source.BANDCAMP, in_flight)

    assert in_flight.peak == 2
```

L'égalité (et non `<=`) prouve aussi que la borne est atteinte : un client qui sérialiserait tout passerait un test en `<=`.

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_scraper_client_concurrency.py -x -q`
Expected: FAIL, `assert 10 == 3`

- [ ] **Step 3: Poser les sémaphores**

Dans `sidecar/src/tagger/scraper_client.py`, ajouter après `QUERY_MAX_LENGTH` :

```python
# Miroir des semaphores de sortie de l'API, pas un reglage de performance local :
# emettre davantage ne fait qu'empiler des requetes qui sortent en 504 (ADR-017).
BEATPORT_CONCURRENCY: Final = 3
BANDCAMP_CONCURRENCY: Final = 2
```

Dans `TechnoScraperClient.__init__`, après `self._sleep = sleep` :

```python
        self._semaphores: dict[Source, asyncio.Semaphore] = {
            Source.BEATPORT: asyncio.Semaphore(BEATPORT_CONCURRENCY),
            Source.BANDCAMP: asyncio.Semaphore(BANDCAMP_CONCURRENCY),
        }
```

Dans `_get`, envelopper la seule requête : le sémaphore est relâché avant l'attente d'une nouvelle tentative.

```python
            try:
                async with self._semaphores[source]:
                    response = await self._http.get(path, params=params)
            except httpx2.RequestError as exc:
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_scraper_client_concurrency.py tests/unit/test_scraper_client_errors.py tests/unit/test_scraper_client_requests.py -x -q`
Expected: PASS, 22 tests

- [ ] **Step 5: Gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 6: Commit**

```bash
git add sidecar/src/tagger/scraper_client.py sidecar/tests/unit/test_scraper_client_concurrency.py
git commit -m "feat(sidecar): borner les appels techno-scraper a 3 Beatport et 2 Bandcamp"
```
