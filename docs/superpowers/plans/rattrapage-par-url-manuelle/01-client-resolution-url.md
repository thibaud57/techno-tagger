# Client techno-scraper : résolution d'une URL de morceau : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner au client techno-scraper la capacité de transformer une URL Beatport, Bandcamp ou SoundCloud collée par l'utilisateur en candidat normalisé.

**Architecture:** `scraper_client.py` gagne un parseur privé et pur (`_parse_track_url`) qui reconnaît la source, normalise l'URL et refuse sans appel tout ce qui n'est pas un morceau, puis un point d'entrée public `fetch_by_url` qui appelle `/beatport/tracks/{id}`, `/bandcamp/tracks?url=` ou `/soundcloud/resolve?url=`. La réponse SoundCloud est validée contre l'union `Track | profil`, un profil étant refusé comme une URL qui ne désigne pas un morceau. Un sémaphore SoundCloud de 5 rejoint ceux de Beatport et Bandcamp.

**Tech Stack:** Python 3.14 (`urllib.parse.urlsplit`, `re`), pydantic 2 (`RootModel` sur une union), httpx2 `MockTransport`, pytest + pytest-asyncio (mode strict). Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/rattrapage-par-url-manuelle/01-client-resolution-url-design.md`

## Global Constraints

- **Contrat de référence** : techno-scraper 4.0.0 (contrat lu le 2026-10-02). `/soundcloud/resolve` rend `UserProfile | Track`, la clé `profile` signale un profil. `title`, `mix_name`, `artists`, `remixers`, `label` arrivent normalisés et ne se redécoupent pas. `source_title` reste ignoré.
- **Formes acceptées, après normalisation** (espaces de bord, query, fragment et `/` final retirés, hôte en minuscules, `http` réécrit en `https`) :
  - Beatport : hôtes `www.beatport.com`, `beatport.com`, chemin `/track/<slug>/<id>` (id numérique) → `/beatport/tracks/{id}`
  - Bandcamp : hôte `<sous-domaine>.bandcamp.com`, chemin `/track/<slug>` → `/bandcamp/tracks?url=https://<sous-domaine>.bandcamp.com/track/<slug>`
  - SoundCloud : hôtes `soundcloud.com`, `www.soundcloud.com`, `m.soundcloud.com`, chemin `/<utilisateur>/<slug>` (deux segments exactement) → `/soundcloud/resolve?url=https://soundcloud.com/<utilisateur>/<slug>`
  - SoundCloud, lien court : hôte `on.soundcloud.com`, chemin `/<code>` (un segment) → `/soundcloud/resolve?url=https://on.soundcloud.com/<code>`
- **Refus** : `UnsupportedTrackUrlError`, code `unsupported_url`, héritée de `TaggerError` (pas de `ScraperError`), **sans aucun `params`** : l'URL peut nommer l'artiste et le morceau.
- **`tracks_cursor` jamais envoyé** à `/soundcloud/resolve`.
- **Borne SoundCloud** : `SOUNDCLOUD_CONCURRENCY = 5`, miroir de `core/limits.py` de techno-scraper.
- **Traductions** : `errors.unsupported_url` dans `public/i18n/fr.json` et `public/i18n/en.json`, au vouvoiement, en disant le geste qui répare (`.claude/rules/ngx-translate/i18n.md`).
- **Code Python sans accents** (convention du module), docstrings et commentaires en français, le pourquoi seulement.
- **Tests** : noms en anglais, AAA séparé par des lignes vides, jamais de réseau réel (`MockTransport`), `ids` de parametrize en anglais.
- **Docs gouvernées** : `docs/ARCHITECTURE.md` et `docs/adrs/017-*` se modifient avec le skill `architecture-doc`, `docs/knowledges/techno-scraper.md` avec `knowledge-doc`, `.claude/rules/techno-scraper/contrat.md` avec `rules-doc`. Charger le skill et lire son template avant d'écrire.
- **Gate vert à chaque commit** : `just lint-sidecar`, `just typecheck-sidecar`, `just test-sidecar`. Commits `type(scope): description`, scope `sidecar`.

## Review Focus

- **URL malformée** (`https://[beatport.com/...`, crochet IPv6 non fermé) : `urlsplit` lève `ValueError`, le client doit rendre `unsupported_url` et non planter (Task 1, cas `malformed` de `test_refuses_an_url_that_is_not_a_track_without_sending_any_request`).
- **URL collée avec des espaces ou un retour à la ligne** : acceptée après retrait des espaces de bord (Task 1, cas `surrounding-spaces`).
- **Préfixe de langue Beatport** (`/fr/track/...`) : refusé, jamais pris pour un id (Task 1, cas `beatport-language-prefix`).
- **Code de lien court SoundCloud en casse mixte** : la casse du chemin est conservée, seul l'hôte passe en minuscules (Task 2, `test_sends_a_soundcloud_short_link_to_the_resolve_route`).
- **Refus qui fuirait l'URL** : l'erreur ne porte aucun `params` (Task 1, `test_keeps_the_pasted_url_out_of_the_refusal`).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `sidecar/src/tagger/scraper_client.py` | Formes d'URL acceptées, `_TrackUrl`, `_parse_track_url`, `UnsupportedTrackUrlError`, `fetch_by_url`, `_ProfileEnvelope`, `_Resolved`, `_resolve_soundcloud`, `SOUNDCLOUD_CONCURRENCY`. |
| `sidecar/tests/unit/test_scraper_client_urls.py` | Reconnaissance, normalisation, routes, refus, profil, 404. |
| `sidecar/tests/unit/test_scraper_client_concurrency.py` | Borne SoundCloud ; `_InFlight` prend le corps à rendre. |
| `sidecar/tests/helpers/scraper_responses.py` | `soundcloud_track_payload`, `profile_payload`. |
| `public/i18n/fr.json`, `public/i18n/en.json` | `errors.unsupported_url`. |
| `docs/ARCHITECTURE.md` | § Concurrence : borne SoundCloud. |
| `docs/adrs/017-taille-pool-concurrence.md` | Précision datée : borne SoundCloud. |
| `docs/knowledges/techno-scraper.md` | § Routes consommées et § Bornes de concurrence. |
| `.claude/rules/techno-scraper/contrat.md` | Normaliser une URL collée avant l'appel. |

---

## Task 1: URL Beatport et Bandcamp

**Files:**
- Modify: `sidecar/src/tagger/scraper_client.py`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`
- Test: `sidecar/tests/unit/test_scraper_client_urls.py` (création)

**Interfaces:**
- Consumes: `TechnoScraperClient.fetch_beatport_track(track_id: str) -> TrackCandidate`, `TechnoScraperClient.fetch_bandcamp_track(url: str) -> TrackCandidate`, `TrackNotFoundError` (existants) ; helpers `make_client`, `recording`, `track_payload`, `Handler` de `scraper_responses`, fixture `requests` de `conftest.py`.
- Produces:
  - `scraper_client.UnsupportedTrackUrlError(TaggerError)`, `code = "unsupported_url"`, constructeur sans argument, `params == {}`
  - `scraper_client._TrackUrl(NamedTuple)` : `source`, `reference: str` (id Beatport ou URL normalisée)
  - `scraper_client._parse_track_url(pasted: str) -> _TrackUrl`
  - `TechnoScraperClient.fetch_by_url(url: str) -> TrackCandidate`

- [ ] **Step 1: Écrire les tests**

Créer `sidecar/tests/unit/test_scraper_client_urls.py` :

```python
"""Tests de la resolution d'une URL de morceau collee par l'utilisateur."""

import httpx2
import pytest
from scraper_responses import Handler, make_client, recording, track_payload

from tagger.scraper_client import Source, TrackNotFoundError, UnsupportedTrackUrlError

pytestmark = pytest.mark.asyncio

BANDCAMP_TRACK = "https://amelielens.bandcamp.com/track/basiel"


def _found(requests: list[httpx2.Request], source: Source) -> Handler:
    """Un 200 qui porte un `Track` de la source donnee, chaque requete notee."""
    return recording(requests, httpx2.Response(200, json=track_payload(source=source)))


@pytest.mark.parametrize(
    "pasted",
    [
        "https://www.beatport.com/track/your-mind/22708005?utm_source=share",
        "https://beatport.com/track/your-mind/22708005",
    ],
    ids=["www-with-query", "bare-host"],
)
async def test_resolves_a_beatport_url_through_the_track_id_route(
    requests: list[httpx2.Request], pasted: str
) -> None:
    async with make_client(_found(requests, Source.BEATPORT)) as client:
        candidate = await client.fetch_by_url(pasted)

    assert [request.url.path for request in requests] == ["/beatport/tracks/22708005"]
    assert candidate.source is Source.BEATPORT


async def test_resolves_a_bandcamp_track_url_through_the_bandcamp_track_route(
    requests: list[httpx2.Request],
) -> None:
    async with make_client(_found(requests, Source.BANDCAMP)) as client:
        candidate = await client.fetch_by_url(BANDCAMP_TRACK)

    assert requests[0].url.path == "/bandcamp/tracks"
    assert dict(requests[0].url.params) == {"url": BANDCAMP_TRACK}
    assert candidate.source is Source.BANDCAMP


@pytest.mark.parametrize(
    "pasted",
    [
        f"{BANDCAMP_TRACK}?from=search#lyrics",
        f"{BANDCAMP_TRACK}/",
        f"  {BANDCAMP_TRACK} \n",
    ],
    ids=["query-and-fragment", "trailing-slash", "surrounding-spaces"],
)
async def test_drops_the_query_string_the_fragment_and_the_trailing_slash_before_sending(
    requests: list[httpx2.Request], pasted: str
) -> None:
    """Une query fait rendre 422 a `/bandcamp/tracks`, pris pour un contrat casse ; le slash
    final, tolere par Bandcamp, part quand meme pour envoyer une forme unique."""
    async with make_client(_found(requests, Source.BANDCAMP)) as client:
        await client.fetch_by_url(pasted)

    assert requests[0].url.params["url"] == BANDCAMP_TRACK


async def test_lowercases_the_host(requests: list[httpx2.Request]) -> None:
    async with make_client(_found(requests, Source.BANDCAMP)) as client:
        await client.fetch_by_url("https://AmelieLens.bandcamp.com/track/basiel")

    assert requests[0].url.params["url"] == BANDCAMP_TRACK


async def test_rewrites_an_http_url_to_https(requests: list[httpx2.Request]) -> None:
    async with make_client(_found(requests, Source.BANDCAMP)) as client:
        await client.fetch_by_url("http://amelielens.bandcamp.com/track/basiel")

    assert requests[0].url.params["url"] == BANDCAMP_TRACK


@pytest.mark.parametrize(
    "pasted",
    [
        "https://amelielens.bandcamp.com/album/basiel",
        "https://www.beatport.com/release/your-mind/4200000",
        "https://www.beatport.com/fr/track/your-mind/22708005",
        "https://www.youtube.com/watch?v=abc",
        "www.beatport.com/track/your-mind/22708005",
        "ftp://amelielens.bandcamp.com/track/basiel",
        "https://[beatport.com/track/your-mind/22708005",
        "",
    ],
    ids=[
        "bandcamp-album",
        "beatport-release",
        "beatport-language-prefix",
        "unknown-host",
        "missing-scheme",
        "other-scheme",
        "malformed",
        "empty",
    ],
)
async def test_refuses_an_url_that_is_not_a_track_without_sending_any_request(
    requests: list[httpx2.Request], pasted: str
) -> None:
    async with make_client(_found(requests, Source.BEATPORT)) as client:
        with pytest.raises(UnsupportedTrackUrlError):
            await client.fetch_by_url(pasted)

    assert requests == []


async def test_keeps_the_pasted_url_out_of_the_refusal(requests: list[httpx2.Request]) -> None:
    """L'URL peut nommer l'artiste et le morceau : aucun titre ne part sans geste manuel."""
    async with make_client(_found(requests, Source.BEATPORT)) as client:
        with pytest.raises(UnsupportedTrackUrlError) as refusal:
            await client.fetch_by_url("https://www.youtube.com/watch?v=adam-beyer-your-mind")

    assert refusal.value.code == "unsupported_url"
    assert refusal.value.params == {}


async def test_raises_track_not_found_when_the_api_answers_404_for_a_well_formed_url(
    requests: list[httpx2.Request],
) -> None:
    body = {"code": "not_found", "provider": "bandcamp", "request_id": "r-404"}

    async with make_client(recording(requests, httpx2.Response(404, json=body))) as client:
        with pytest.raises(TrackNotFoundError):
            await client.fetch_by_url(BANDCAMP_TRACK)
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_scraper_client_urls.py -q`
Expected: FAIL à la collecte, `ImportError: cannot import name 'UnsupportedTrackUrlError'`.

- [ ] **Step 3: Implémenter le parseur, l'erreur et `fetch_by_url`**

Dans `sidecar/src/tagger/scraper_client.py` :

1. Imports : ajouter `import re` (après `import logging`) et `from urllib.parse import urlsplit` (après `from typing import ...`).

2. Après `_NETWORK_FAILURES`, ajouter les formes Beatport et Bandcamp :

```python
# Formes d'URL de morceau acceptees au rattrapage. Bandcamp recopie le pattern de
# `/bandcamp/tracks`, qui rend 422 sur une query, `http://` ou `/album/` ; Beatport
# n'a pas de route par URL, l'id se lit dans l'URL publique que l'API elle-meme rend.
_BEATPORT_HOSTS: Final = frozenset({"www.beatport.com", "beatport.com"})
_BEATPORT_TRACK_PATH: Final = re.compile(r"/track/[^/]+/(?P<id>\d+)")
_BANDCAMP_HOST: Final = re.compile(r"[a-z0-9][a-z0-9-]*\.bandcamp\.com")
_BANDCAMP_TRACK_PATH: Final = re.compile(r"/track/[\w-]+")
```

3. Après la classe `_ApiResponse`, ajouter :

```python
class _TrackUrl(NamedTuple):
    """Cible d'une URL de morceau : id Beatport, ou URL normalisee pour les autres."""

    source: SearchSource
    reference: str
```

4. Après la classe `ApiContractError`, ajouter :

```python
class UnsupportedTrackUrlError(TaggerError):
    """URL collee qui ne designe pas un morceau d'une source acceptee, refusee sans appel.

    Sans `params` : l'URL peut nommer l'artiste et le morceau.
    """

    code: ClassVar[str] = "unsupported_url"

    def __init__(self) -> None:
        super().__init__("unsupported track url")
```

5. Dans `TechnoScraperClient`, après `fetch_bandcamp_track`, ajouter :

```python
    async def fetch_by_url(self, url: str) -> TrackCandidate:
        """Morceau designe par une URL collee par l'utilisateur.

        Leve `UnsupportedTrackUrlError` sans aucun appel quand l'URL ne designe pas un
        morceau d'une source acceptee : envoyee telle quelle, elle prendrait un 422 lu
        comme un contrat casse.
        """
        target = _parse_track_url(url)
        if target.source is Source.BEATPORT:
            return await self.fetch_beatport_track(target.reference)
        return await self.fetch_bandcamp_track(target.reference)
```

6. Après la fonction `_failure_reason`, en fin de module, ajouter :

```python
def _parse_track_url(pasted: str) -> _TrackUrl:
    """Source et cible d'une URL collee, normalisee comme l'attend sa route.

    Query, fragment et `/` final tombent, `hostname` rend l'hote en minuscules et
    `http` devient `https`. La casse du chemin est conservee.
    """
    try:
        parts = urlsplit(pasted.strip())
    except ValueError:
        raise UnsupportedTrackUrlError from None
    host = parts.hostname or ""
    path = parts.path.rstrip("/")
    if parts.scheme in {"http", "https"}:
        if host in _BEATPORT_HOSTS and (match := _BEATPORT_TRACK_PATH.fullmatch(path)):
            return _TrackUrl(Source.BEATPORT, match.groupdict()["id"])
        if _BANDCAMP_HOST.fullmatch(host) and _BANDCAMP_TRACK_PATH.fullmatch(path):
            return _TrackUrl(Source.BANDCAMP, f"https://{host}{path}")
    raise UnsupportedTrackUrlError
```

7. Mettre à jour la docstring de la classe : `"""Recherche, refetch et resolution d'URL de morceaux sur techno-scraper.`

- [ ] **Step 4: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_scraper_client_urls.py -q`
Expected: PASS, tous les tests du fichier.

- [ ] **Step 5: Vérifier que la traduction manque**

Run: `cd sidecar && uv run pytest tests/unit/test_error_translations.py -q`
Expected: FAIL, `unsupported_url` absent des deux fichiers de langue.

- [ ] **Step 6: Ajouter les traductions**

Dans `public/i18n/fr.json`, section `errors`, juste après `"track_not_found"` :

```json
    "unsupported_url": "Ce lien ne désigne pas un morceau Beatport, Bandcamp ou SoundCloud. Copiez l'adresse de la page du morceau.",
```

Dans `public/i18n/en.json`, section `errors`, juste après `"track_not_found"` :

```json
    "unsupported_url": "This link is not a Beatport, Bandcamp or SoundCloud track. Copy the address of the track page.",
```

- [ ] **Step 7: Lancer le gate**

Run: `just lint-sidecar && just typecheck-sidecar && just test-sidecar`
Expected: tout vert, couverture ≥ 80 %.

- [ ] **Step 8: Commit**

```bash
git add sidecar/src/tagger/scraper_client.py sidecar/tests/unit/test_scraper_client_urls.py public/i18n/fr.json public/i18n/en.json
git commit -m "feat(sidecar): résoudre une URL de morceau Beatport ou Bandcamp collée"
```

---

## Task 2: URL SoundCloud

**Files:**
- Modify: `sidecar/src/tagger/scraper_client.py`
- Modify: `sidecar/tests/helpers/scraper_responses.py`
- Test: `sidecar/tests/unit/test_scraper_client_urls.py`, `sidecar/tests/unit/test_scraper_client_concurrency.py`

**Interfaces:**
- Consumes: `_TrackUrl`, `_parse_track_url`, `UnsupportedTrackUrlError`, `fetch_by_url` (Task 1) ; `_get[M: BaseModel](source, path, params, model) -> M` (existant).
- Produces:
  - `scraper_client.SOUNDCLOUD_CONCURRENCY: Final = 5`
  - `_TrackUrl.source` élargi à `Source`
  - `scraper_client._ProfileEnvelope(_ApiModel)` : `profile: dict[str, object]`
  - `scraper_client._Resolved(RootModel[TrackCandidate | _ProfileEnvelope])`
  - `TechnoScraperClient._resolve_soundcloud(url: str) -> TrackCandidate`
  - `_request`, `_get`, `_translate` typés `source: Source`
  - helpers `scraper_responses.soundcloud_track_payload(**overrides) -> dict[str, object]` et `scraper_responses.profile_payload() -> dict[str, object]`

- [ ] **Step 1: Ajouter les corps SoundCloud aux helpers**

Dans `sidecar/tests/helpers/scraper_responses.py`, après `page_payload`, ajouter (`SOUNDCLOUD_TRACK` en constante de module, à côté de `BASIEL`) :

```python
SOUNDCLOUD_TRACK: Final = "https://soundcloud.com/drumcode/kasia-faithless-tarantula-2"
```

```python
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
```

- [ ] **Step 2: Écrire les tests de résolution SoundCloud**

Dans `sidecar/tests/unit/test_scraper_client_urls.py`, compléter l'import des helpers (`SOUNDCLOUD_TRACK`, `profile_payload`, `soundcloud_track_payload`) et ajouter à la fin :

```python
def _soundcloud(requests: list[httpx2.Request], body: dict[str, object]) -> Handler:
    return recording(requests, httpx2.Response(200, json=body))


async def test_resolves_a_soundcloud_track_url_through_the_resolve_route_without_a_tracks_cursor(
    requests: list[httpx2.Request],
) -> None:
    async with make_client(_soundcloud(requests, soundcloud_track_payload())) as client:
        candidate = await client.fetch_by_url(SOUNDCLOUD_TRACK)

    assert requests[0].url.path == "/soundcloud/resolve"
    assert dict(requests[0].url.params) == {"url": SOUNDCLOUD_TRACK}
    assert candidate.source is Source.SOUNDCLOUD
    assert candidate.title == "Tarantula"


async def test_sends_a_soundcloud_short_link_to_the_resolve_route(
    requests: list[httpx2.Request],
) -> None:
    """Le code du lien court garde sa casse : seul l'hote passe en minuscules."""
    async with make_client(_soundcloud(requests, soundcloud_track_payload())) as client:
        await client.fetch_by_url("https://On.SoundCloud.com/AbC123xYz?si=share")

    assert requests[0].url.params["url"] == "https://on.soundcloud.com/AbC123xYz"


@pytest.mark.parametrize(
    "pasted",
    [
        "https://www.soundcloud.com/drumcode/kasia-faithless-tarantula-2",
        "https://m.soundcloud.com/drumcode/kasia-faithless-tarantula-2/?si=abc#t=1:23",
    ],
    ids=["www", "mobile-with-query-and-slash"],
)
async def test_rewrites_the_www_and_mobile_soundcloud_hosts(
    requests: list[httpx2.Request], pasted: str
) -> None:
    """SoundCloud rend 404 sur `www.`, `m.` et un `/` final."""
    async with make_client(_soundcloud(requests, soundcloud_track_payload())) as client:
        await client.fetch_by_url(pasted)

    assert requests[0].url.params["url"] == SOUNDCLOUD_TRACK


@pytest.mark.parametrize(
    "pasted",
    [
        "https://soundcloud.com/drumcode/sets/drumcode-radio",
        "https://soundcloud.com/drumcode",
        "https://on.soundcloud.com/",
    ],
    ids=["playlist", "profile", "short-link-without-code"],
)
async def test_refuses_a_soundcloud_url_that_is_not_a_track_without_sending_any_request(
    requests: list[httpx2.Request], pasted: str
) -> None:
    async with make_client(_soundcloud(requests, soundcloud_track_payload())) as client:
        with pytest.raises(UnsupportedTrackUrlError):
            await client.fetch_by_url(pasted)

    assert requests == []


async def test_refuses_a_soundcloud_url_that_resolves_to_a_profile(
    requests: list[httpx2.Request],
) -> None:
    """Un lien court peut viser un compte : c'est un refus de saisie, pas un contrat casse."""
    async with make_client(_soundcloud(requests, profile_payload())) as client:
        with pytest.raises(UnsupportedTrackUrlError):
            await client.fetch_by_url("https://on.soundcloud.com/AbC123xYz")
```

- [ ] **Step 3: Écrire le test de borne SoundCloud**

Dans `sidecar/tests/unit/test_scraper_client_concurrency.py`, faire porter à `_InFlight` le corps qu'il rend :

```python
class _InFlight:
    def __init__(self, body: dict[str, object] | None = None) -> None:
        self.current = 0
        self.peak = 0
        self.body = page_payload() if body is None else body

    async def handler(self, _request: httpx2.Request) -> httpx2.Response:
        self.current += 1
        self.peak = max(self.peak, self.current)
        await asyncio.sleep(0.01)
        self.current -= 1
        return httpx2.Response(200, json=self.body)
```

Compléter l'import des helpers (`soundcloud_track_payload`) et ajouter :

```python
async def test_never_keeps_more_than_five_soundcloud_requests_in_flight() -> None:
    in_flight = _InFlight(soundcloud_track_payload())

    async with make_client(in_flight.handler) as client, asyncio.TaskGroup() as group:
        for index in range(10):
            group.create_task(
                client.fetch_by_url(f"https://soundcloud.com/drumcode/track-{index}"),
                name=f"resolve:{index}",
            )

    assert in_flight.peak == 5
```

- [ ] **Step 4: Vérifier qu'ils échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_scraper_client_urls.py tests/unit/test_scraper_client_concurrency.py -q`
Expected: FAIL, les URL SoundCloud levant `UnsupportedTrackUrlError` là où une requête est attendue. `test_refuses_a_soundcloud_url_that_is_not_a_track_without_sending_any_request` et `test_refuses_a_soundcloud_url_that_resolves_to_a_profile` passent déjà : toute URL SoundCloud est encore refusée localement.

- [ ] **Step 5: Implémenter la voie SoundCloud**

Dans `sidecar/src/tagger/scraper_client.py` :

1. Imports : `from typing import ..., assert_never` et `from pydantic import BaseModel, ConfigDict, RootModel, ValidationError`.

2. Sous `BANDCAMP_CONCURRENCY`, ajouter :

```python
SOUNDCLOUD_CONCURRENCY: Final = 5
```

3. Sous les formes Bandcamp, ajouter :

```python
# SoundCloud rend 404 sur `www.`, `m.` et un `/` final (constat techno-scraper du
# 2026-09-30) ; un lien court se resout de son cote, parfois vers une playlist.
_SOUNDCLOUD_HOSTS: Final = frozenset({"soundcloud.com", "www.soundcloud.com", "m.soundcloud.com"})
_SOUNDCLOUD_TRACK_PATH: Final = re.compile(r"/[^/]+/[^/]+")
_SOUNDCLOUD_SHORT_HOST: Final = "on.soundcloud.com"
_SOUNDCLOUD_SHORT_PATH: Final = re.compile(r"/[^/]+")
```

4. Après `_TrackPage`, ajouter :

```python
class _ProfileEnvelope(_ApiModel):
    """`UserProfile` de `/soundcloud/resolve` : seule sa cle `profile` le distingue d'un `Track`."""

    profile: dict[str, object]


class _Resolved(RootModel[TrackCandidate | _ProfileEnvelope]):
    """Reponse de `/soundcloud/resolve`, morceau ou profil selon l'URL."""
```

5. `_TrackUrl.source` passe de `SearchSource` à `Source`.

6. Dans `__init__`, le dictionnaire des sémaphores gagne `Source.SOUNDCLOUD: asyncio.Semaphore(SOUNDCLOUD_CONCURRENCY),`.

7. Remplacer `fetch_by_url` et ajouter `_resolve_soundcloud` :

```python
    async def fetch_by_url(self, url: str) -> TrackCandidate:
        """Morceau designe par une URL collee par l'utilisateur.

        Leve `UnsupportedTrackUrlError` sans aucun appel quand l'URL ne designe pas un
        morceau d'une source acceptee : envoyee telle quelle, elle prendrait un 422 lu
        comme un contrat casse.
        """
        target = _parse_track_url(url)
        match target.source:
            case Source.BEATPORT:
                return await self.fetch_beatport_track(target.reference)
            case Source.BANDCAMP:
                return await self.fetch_bandcamp_track(target.reference)
            case Source.SOUNDCLOUD:
                return await self._resolve_soundcloud(target.reference)
            case unreachable:
                assert_never(unreachable)

    async def _resolve_soundcloud(self, url: str) -> TrackCandidate:
        """`tracks_cursor` n'est jamais envoye : sur un morceau, l'API le refuse en 400."""
        resolved = await self._get(
            Source.SOUNDCLOUD, "/soundcloud/resolve", {"url": url}, _Resolved
        )
        if isinstance(resolved.root, _ProfileEnvelope):
            raise UnsupportedTrackUrlError
        return resolved.root
```

8. `_request(self, source: SearchSource, ...)`, `_get[M: BaseModel](self, source: SearchSource, ...)` et `_translate(source: SearchSource, ...)` passent à `source: Source`.

9. Dans `_parse_track_url`, à l'intérieur du `if parts.scheme in {"http", "https"}:`, après la branche Bandcamp :

```python
        if host in _SOUNDCLOUD_HOSTS and _SOUNDCLOUD_TRACK_PATH.fullmatch(path):
            return _TrackUrl(Source.SOUNDCLOUD, f"https://soundcloud.com{path}")
        if host == _SOUNDCLOUD_SHORT_HOST and _SOUNDCLOUD_SHORT_PATH.fullmatch(path):
            return _TrackUrl(Source.SOUNDCLOUD, f"https://{host}{path}")
```

- [ ] **Step 6: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_scraper_client_urls.py tests/unit/test_scraper_client_concurrency.py tests/unit/test_scraper_client_requests.py tests/unit/test_scraper_client_errors.py -q`
Expected: PASS, les tests existants du client compris.

- [ ] **Step 7: Lancer le gate**

Run: `just lint-sidecar && just typecheck-sidecar && just test-sidecar`
Expected: tout vert. Si Mypy signale le `case unreachable`, vérifier que `_TrackUrl.source` est bien typé `Source` et non `SearchSource`.

- [ ] **Step 8: Commit**

```bash
git add sidecar/src/tagger/scraper_client.py sidecar/tests/helpers/scraper_responses.py sidecar/tests/unit/test_scraper_client_urls.py sidecar/tests/unit/test_scraper_client_concurrency.py
git commit -m "feat(sidecar): résoudre une URL de morceau SoundCloud par /soundcloud/resolve"
```

---

## Task 3: Docs du contrat et des bornes

**Files:**
- Modify: `docs/ARCHITECTURE.md` (§ Concurrence)
- Modify: `docs/adrs/017-taille-pool-concurrence.md`
- Modify: `docs/knowledges/techno-scraper.md` (§ Routes consommées, § Bornes de concurrence)
- Modify: `.claude/rules/techno-scraper/contrat.md`

**Interfaces:**
- Consumes: `SOUNDCLOUD_CONCURRENCY`, `UnsupportedTrackUrlError`, `fetch_by_url` (Tasks 1 et 2).
- Produces: aucune interface de code.

- [ ] **Step 1: ARCHITECTURE.md et ADR-017**

Charger `Skill[architecture-doc]` et lire son template ADR et ses règles, puis :

- `docs/ARCHITECTURE.md` § Concurrence, phrase « **3 requêtes Beatport en vol, 2 pour Bandcamp** » : ajouter la borne SoundCloud, « **3 requêtes Beatport en vol, 2 pour Bandcamp, 5 pour SoundCloud**, appelé au seul rattrapage par URL ».
- `docs/adrs/017-taille-pool-concurrence.md` : ajouter, au format des précisions datées du projet et à la date du jour de l'implémentation, que le rattrapage par URL de la Feature 4 appelle SoundCloud, borné à 5 en miroir de `core/limits.py` de techno-scraper (`SOUNDCLOUD_CONCURRENCY`). La décision « miroir des sémaphores de l'API » ne change pas.

- [ ] **Step 2: Fiche techno-scraper**

Charger `Skill[knowledge-doc]` et lire son template, puis dans `docs/knowledges/techno-scraper.md` :

- § Routes consommées, points importants : une URL collée se normalise avant l'appel (query, fragment et `/` final retirés, `https`, hôte en minuscules, `www.` et `m.` SoundCloud réécrits), parce que `/bandcamp/tracks` rend `422` sur une query, `http://` ou `/album/` et que SoundCloud rend `404` sur `www.`, `m.` et un `/` final (techno-scraper `docs/knowledges/soundcloud.md`, constat du 2026-09-30). Un lien court `on.soundcloud.com` peut viser une playlist (`404`) ou un profil (clé `profile`).
- § Bornes de concurrence : exemple de code augmenté de `SOUNDCLOUD_CONCURRENCY = 5`, et un point « SoundCloud est borné à 5 côté API, appelé par le sidecar au seul rattrapage par URL ».

- [ ] **Step 3: Rule du contrat**

Charger `Skill[rules-doc]` et lire son template, puis dans `.claude/rules/techno-scraper/contrat.md` :

- À faire : « Normaliser une URL collée avant de l'envoyer (query, fragment et `/` final retirés, `https`, hôte en minuscules, `www.` et `m.` SoundCloud réécrits) et refuser sans appel ce qui n'est pas un morceau, en `unsupported_url` »
- Gotchas, ligne `/bandcamp/tracks?url=` : compléter par « SoundCloud rend `404` sur `www.`, `m.` et un `/` final ».

- [ ] **Step 4: Commit**

```bash
git add docs/ARCHITECTURE.md docs/adrs/017-taille-pool-concurrence.md docs/knowledges/techno-scraper.md .claude/rules/techno-scraper/contrat.md
git commit -m "docs(sidecar): borne SoundCloud et normalisation des URL collées"
```
