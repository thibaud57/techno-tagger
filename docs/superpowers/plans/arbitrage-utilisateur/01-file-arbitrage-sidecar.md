# File d'arbitrage dans le sidecar : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tenir dans le sidecar la file des morceaux en zone grise d'un run et les faire avancer sur décision de l'utilisateur : choix d'un candidat, refus qui déclenche Bandcamp, retour à la liste Beatport.

**Architecture:** On sort de `_Runner` tout ce qui touche aux sources dans `tagger/sources.py` (`RunSources`), partagé par le pipeline et par l'arbitrage avec une seule garde des 403. `tagging.py` gagne un `LiveRun`, que le pipeline met à jour au fil de l'eau, et s'ouvre en deux temps (`open_run`, puis `resolve_run`) ; `run_tagging` enchaîne les deux et garde sa signature. `tagger/arbitration.py` porte les trois gestes (`choose`, `refuse`, `show`) sur un `LiveRun`, émet `ArbitrationUpdated` et `TrackResolved` par son propre rappel, et refuse un second geste sur un morceau dont le premier est en vol.

**Tech Stack:** Python 3.14 (`asyncio`, dataclasses gelées, `NamedTuple`, `contextlib.contextmanager`), pytest + pytest-asyncio (mode strict), httpx2 `MockTransport`. Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/arbitrage-utilisateur/01-file-arbitrage-sidecar-design.md`

## Global Constraints

- **Valeurs d'état** (ARCHITECTURE.md § API) : `TrackState` `resolved`, `unresolved` ; `Resolution` `auto`, `arbitration`, `url`, `none` ; `FailureReason` `empty_query`, `no_result`, `below_threshold`, `user_refused`, `source_unavailable`. Aucune valeur nouvelle.
- **Codes d'erreur** : `arbitration_error` (base), `arbitration_not_pending`, `arbitration_candidate_unknown`, `arbitration_busy`, chacun traduit dans `public/i18n/fr.json` et `en.json` sous `errors`.
- **Bandcamp n'est appelé qu'au refus de Beatport**, jamais avant (ADR-009), et **jamais en validation automatique après un refus** (`classify(..., allow_auto=False)`).
- **Motif d'une liste Bandcamp vide** : `no_result` sans aucun résultat, `below_threshold` si Bandcamp a rendu des candidats tous sous le plancher, `source_unavailable` sur `SourceUnavailableError`, `ApiContractError`, `ApiKeyRejectedError` ou `ApiKeyRejectedRunError`. « Passer » garde ce motif, jamais `user_refused`.
- **Un seul geste en vol par morceau** : le second est refusé en `arbitration_busy`, jamais mis en file.
- **Un geste nomme la liste sur laquelle il porte** : `choose` et `refuse` rejettent en `arbitration_candidate_unknown` une source qui n'est plus affichée (décision du 2026-09-26).
- **Aucun fichier musical touché, aucune persistance** : seul le cache de pochettes écrit sur le disque, comme en auto.
- **Logs** : logfmt, clés `run`, `track` (position), `source`, `score`, `status`, `reason` uniquement ; aucun titre ni chemin, aucun événement Sentry.
- **`except A, B:` sans parenthèses** : c'est la forme que `ruff format` impose en 3.14 (PEP 758) quand la clause n'a pas de `as`. Avec `as`, les parenthèses restent obligatoires.
- **Tests** : noms en anglais, AAA séparé par des lignes vides, API et CDN mockés par `FakeApi` et `FakeCdn`, jamais de réseau réel.
- **Gate vert à chaque commit** : `just lint-sidecar`, `just typecheck-sidecar`, `just test-sidecar`. Commits `type(scope): description`, scopes `tagging` et `arbitration`.
- **Code vérifié** : les Tasks 1 à 4 ont tourné le 2026-09-26 dans un worktree jetable, chacune sur son propre état (541 tests verts en fin de Task 4, ruff et mypy verts). S'en écarter demande une raison. Seul ajout postérieur, jamais exécuté : le paramètre `source` de `refuse` et le test qui le garde.

## Review Focus

- **Deux refus simultanés sur deux morceaux** : le second avance pendant que le premier attend Bandcamp, l'occupation étant par morceau (Task 4, `test_refuses_one_track_while_another_refusal_waits_for_bandcamp`).
- **Choisir dans une liste Bandcamp vide** : refusé en `arbitration_candidate_unknown`, le morceau reste à arbitrer sur Bandcamp (Task 4, `test_rejects_choosing_in_an_empty_bandcamp_list`).
- **Afficher la liste déjà affichée** : refusé, aucun événement émis (Task 4, `test_rejects_showing_the_list_already_shown`).
- **Refus annulé en vol** : rien n'est mémorisé, le refus suivant rappelle Bandcamp (Task 4, `test_calls_bandcamp_again_after_a_cancelled_refusal`).
- **Double clic sur « Aucune correspondance »** : le second refus, arrivé après la bascule, est rejeté au lieu de refuser Bandcamp (Task 4, `test_rejects_a_refusal_of_a_list_that_is_no_longer_shown`).
- **Index négatif** : refusé, jamais lu depuis la fin de la liste comme le ferait Python (Task 3, cas `negative`).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `sidecar/src/tagger/sources.py` | `RunSources` : recherche, refetch, pochette, garde des 403, `ApiKeyRejectedRunError`. |
| `sidecar/src/tagger/tagging.py` | Modèles du run, `SourceList`, `PendingArbitration`, `LiveRun`, `open_run`, `resolve_run`, `run_tagging`, pipeline. |
| `sidecar/src/tagger/arbitration.py` | `Arbitration` (`choose`, `refuse`, `show`), `ArbitrationUpdated`, erreurs `arbitration_*`. |
| `sidecar/tests/helpers/tagging_api.py` | `FakeApi` avec portes (`Gate`), `opened_run` qui rend le `LiveRun` et ses sources. |
| `sidecar/tests/unit/test_tagging_live_run.py` | Ce que le pipeline laisse dans le run vivant, pendant, après et à l'interruption. |
| `sidecar/tests/unit/test_arbitration_gestures.py` | Les trois gestes et leurs refus. |
| `sidecar/tests/unit/test_tagging_run.py` | Imports de la garde et du patch Sentry, déplacés. |
| `public/i18n/fr.json`, `public/i18n/en.json` | Phrases des quatre codes `arbitration_*`. |
| `docs/ARCHITECTURE.md` | Arborescence, chaîne de résolution, diagramme d'état, § Concurrence. |

---

## Task 1: Extraire l'accès aux sources

Refactor sans changement de comportement : la suite existante le prouve.

**Files:**
- Create: `sidecar/src/tagger/sources.py`
- Modify: `sidecar/src/tagger/tagging.py`
- Modify: `sidecar/tests/unit/test_tagging_run.py`

**Interfaces:**
- Consumes: `TechnoScraperClient.search(source, query)`, `fetch_beatport_track(id)`, `fetch_bandcamp_track(url)`, `ArtworkFetcher.fetch(url) -> Path`, `MatchingThresholds`, `ScoredCandidate`, `TrackQuery`.
- Produces:
  - `ApiKeyRejectedRunError` (code `api_key_rejected`), `_RejectionGuard`, `API_KEY_REJECTION_LIMIT` dans `tagger.sources`
  - `RunSources(run_id: str, client: TechnoScraperClient, artworks: ArtworkFetcher, thresholds: MatchingThresholds)`, attributs publics `run_id` et `thresholds`
  - `async RunSources.search(source: SearchSource, query: TrackQuery) -> tuple[TrackCandidate, ...]`
  - `async RunSources.retained(position: int, source: Source, chosen: ScoredCandidate) -> tuple[TrackCandidate, Path | None]`
  - `RunSources.log_source_failure(position: int, source: Source, exc: SourceUnavailableError | ApiContractError) -> None`
  - `tagging.py` réexporte `ApiKeyRejectedRunError` par son import : `handlers.py` n'en dépend pas, mais un appelant qui l'importait de `tagging` continue de fonctionner.

- [ ] **Step 1: Pointer les tests de la garde sur leur nouveau module**

Dans `sidecar/tests/unit/test_tagging_run.py`, remplacer le bloc d'import :

```python
from tagger.files import TaggingFolderUnreadableError
from tagger.tagging import (
    ApiKeyRejectedRunError,
    ArbitrationRequired,
    RunProgress,
    RunStarted,
    TrackResolved,
    TrackState,
    _RejectionGuard,
)
```

par :

```python
from tagger.files import TaggingFolderUnreadableError
from tagger.sources import ApiKeyRejectedRunError, _RejectionGuard
from tagger.tagging import (
    ArbitrationRequired,
    RunProgress,
    RunStarted,
    TrackResolved,
    TrackState,
)
```

et, dans `test_reports_an_api_contract_error_to_sentry`, la cible du patch :

```python
    with patch("tagger.sources.sentry_sdk.capture_exception", autospec=True) as capture:
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_tagging_run.py -q --no-cov`
Expected: FAIL, `ModuleNotFoundError: No module named 'tagger.sources'`

- [ ] **Step 3: Créer `sidecar/src/tagger/sources.py`**

```python
"""Acces aux sources d'un run, partage par le pipeline et l'arbitrage.

Une seule garde des 403 par run : un refus d'arbitrage qui recoit un 403 compte
comme une requete du pipeline (ARCHITECTURE.md § Cle API invalide ou revoquee).
"""

import logging
from typing import TYPE_CHECKING, ClassVar, Final

import sentry_sdk

from tagger.cache import ArtworkUnavailableError
from tagger.errors import TaggerError
from tagger.scraper_client import (
    ApiContractError,
    ApiKeyRejectedError,
    Source,
    SourceUnavailableError,
    TrackNotFoundError,
)

if TYPE_CHECKING:
    from collections.abc import Awaitable
    from pathlib import Path

    from tagger.cache import ArtworkFetcher
    from tagger.matching import MatchingThresholds, ScoredCandidate, TrackQuery
    from tagger.scraper_client import SearchSource, TechnoScraperClient, TrackCandidate

logger = logging.getLogger(__name__)

# Trois 403 consecutifs arretent le run (ARCHITECTURE.md § Cle API invalide ou revoquee).
API_KEY_REJECTION_LIMIT: Final = 3


class ApiKeyRejectedRunError(TaggerError):
    """Run arrete apres trois 403 consecutifs : la cle est a corriger dans les Settings."""

    code: ClassVar[str] = "api_key_rejected"

    def __init__(self) -> None:
        super().__init__("run stopped after repeated api key rejections")


class _RejectionGuard:
    """Compte les 403 consecutifs, remis a zero par toute autre reponse de l'API."""

    def __init__(self) -> None:
        self._consecutive = 0

    def rejected(self) -> None:
        """Un 403 de plus ; au troisieme d'affilee, le run s'arrete."""
        self._consecutive += 1
        if self._consecutive >= API_KEY_REJECTION_LIMIT:
            raise ApiKeyRejectedRunError()

    def answered(self) -> None:
        """Toute reponse de l'API qui n'est pas un 403 prouve que la cle est acceptee."""
        self._consecutive = 0


class RunSources:
    """Client, pochettes, seuils et garde d'un run. Ne possede aucune ressource."""

    def __init__(
        self,
        run_id: str,
        client: TechnoScraperClient,
        artworks: ArtworkFetcher,
        thresholds: MatchingThresholds,
    ) -> None:
        self.run_id = run_id
        self.thresholds = thresholds
        self._client = client
        self._artworks = artworks
        self._guard = _RejectionGuard()

    async def search(self, source: SearchSource, query: TrackQuery) -> tuple[TrackCandidate, ...]:
        """Premiere page de la source, sous la garde des 403."""
        return await self._call(self._client.search(source, query.text))

    async def retained(
        self, position: int, source: Source, chosen: ScoredCandidate
    ) -> tuple[TrackCandidate, Path | None]:
        """Candidat recharge et sa pochette ; ni l'un ni l'autre ne fait echouer le morceau."""
        candidate = await self._refetch(position, source, chosen.candidate)
        return candidate, await self._artwork(position, candidate)

    def log_source_failure(
        self,
        position: int,
        source: Source,
        exc: SourceUnavailableError | ApiContractError,
    ) -> None:
        # ApiContractError est deja loguee et remontee a Sentry par `_call` : sans ce
        # log, c'est une source injoignable qui ne laisserait aucune trace.
        if isinstance(exc, SourceUnavailableError):
            logger.warning(
                "source unavailable run=%s track=%d source=%s status=%s reason=%s request_id=%s",
                self.run_id,
                position,
                source,
                exc.status,
                exc.reason,
                exc.request_id,
            )

    async def _refetch(
        self, position: int, source: Source, candidate: TrackCandidate
    ) -> TrackCandidate:
        """Metadonnees completes ; l'objet de recherche est garde si le refetch echoue."""
        try:
            match source:
                case Source.BEATPORT if candidate.id:
                    return await self._call(self._client.fetch_beatport_track(candidate.id))
                case Source.BANDCAMP if candidate.url:
                    return await self._call(self._client.fetch_bandcamp_track(candidate.url))
                case _:
                    return candidate
        except (
            ApiKeyRejectedError,
            SourceUnavailableError,
            TrackNotFoundError,
            ApiContractError,
        ) as exc:
            logger.warning(
                "refetch failed, search candidate kept run=%s track=%d source=%s reason=%s",
                self.run_id,
                position,
                source,
                exc.code,
            )
            return candidate

    async def _artwork(self, position: int, candidate: TrackCandidate) -> Path | None:
        url = candidate.release.artwork_url if candidate.release else None
        if url is None:
            return None
        try:
            return await self._artworks.fetch(url)
        except ArtworkUnavailableError as exc:
            logger.warning(
                "artwork unavailable run=%s track=%d reason=%s",
                self.run_id,
                position,
                exc.reason,
            )
            return None

    async def _call[T](self, request: Awaitable[T]) -> T:
        """Passe chaque appel par la garde des 403 et remonte un contrat casse a Sentry."""
        try:
            result = await request
        except ApiKeyRejectedError:
            self._guard.rejected()
            raise
        except ApiContractError as exc:
            self._guard.answered()
            logger.exception(
                "api contract broken run=%s request_id=%s", self.run_id, exc.request_id
            )
            sentry_sdk.capture_exception(exc)
            raise
        except SourceUnavailableError as exc:
            # Une erreur reseau n'est pas une reponse : elle ne remet pas la garde a zero.
            if exc.status is not None:
                self._guard.answered()
            raise
        except TrackNotFoundError:
            self._guard.answered()
            raise
        self._guard.answered()
        return result
```

- [ ] **Step 4: Brancher le pipeline sur `RunSources`**

Dans `sidecar/src/tagger/tagging.py` :

1. Remplacer tout le bloc d'imports, du `import asyncio` jusqu'à la constante `API_KEY_REJECTION_LIMIT` incluse, par :

```python
import asyncio
import logging
import secrets
from dataclasses import dataclass, replace
from enum import UNIQUE, StrEnum, auto, verify
from typing import TYPE_CHECKING

from tagger.files import IdentityTags, TagsUnreadableError, list_audio_files, read_identity
from tagger.matching import (
    DEFAULT_THRESHOLDS,
    MatchingThresholds,
    Outcome,
    ScoredCandidate,
    TrackQuery,
    build_query,
    classify,
)
from tagger.scraper_client import (
    ApiContractError,
    ApiKeyRejectedError,
    Source,
    SourceUnavailableError,
)
from tagger.sources import ApiKeyRejectedRunError, RunSources

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

    from tagger.cache import ArtworkFetcher
    from tagger.scraper_client import TechnoScraperClient, TrackCandidate

logger = logging.getLogger(__name__)
```

2. Supprimer la classe `ApiKeyRejectedRunError` et la classe `_RejectionGuard`, désormais dans `sources.py`.

3. Dans `run_tagging`, remplacer la construction du runner :

```python
    runner = _Runner(len(records), RunSources(run_id, client, artworks, thresholds), on_event)
```

4. Remplacer l'en-tête de `_Runner` jusqu'à `self._processed = 0` inclus :

```python
class _Runner:
    """Etat partage par les taches d'un run : compteur et acces aux sources."""

    def __init__(
        self, total: int, sources: RunSources, on_event: Callable[[RunEvent], None]
    ) -> None:
        self._run_id = sources.run_id
        self._total = total
        self._sources = sources
        self._on_event = on_event
        self._processed = 0
```

5. Dans `_resolve`, remplacer les accès directs :
   - `await self._call(self._client.search(Source.BEATPORT, query.text))` par `await self._sources.search(Source.BEATPORT, query)` ;
   - `await self._call(self._client.search(Source.BANDCAMP, query.text))` par `await self._sources.search(Source.BANDCAMP, query)` ;
   - les deux `self._log_source_failure(...)` par `self._sources.log_source_failure(...)`, arguments inchangés ;
   - `classify(query, found, self._thresholds)` par `classify(query, found, self._sources.thresholds)` ;
   - `query, found, self._thresholds, allow_auto=not beatport_unavailable` par `query, found, self._sources.thresholds, allow_auto=not beatport_unavailable`.

6. Dans `_accept`, remplacer les deux premières lignes :

```python
        candidate, artwork = await self._sources.retained(position, source, chosen)
```

7. Supprimer `_refetch`, `_artwork`, `_call` et `_log_source_failure` de `_Runner` : `_unresolved` devient sa dernière méthode.

- [ ] **Step 5: Vérifier que toute la suite passe**

Run: `cd sidecar && uv run pytest tests/unit/test_tagging_run.py tests/unit/test_tagging_outcomes.py tests/unit/test_protocol_tagging.py tests/integration/test_ndjson_tagging.py -q --no-cov`
Expected: PASS (40 tests)

- [ ] **Step 6: Gate**

Run: `just lint-sidecar && just typecheck-sidecar && just test-sidecar`
Expected: tout vert

- [ ] **Step 7: Commit**

```bash
git add sidecar/src/tagger/sources.py sidecar/src/tagger/tagging.py sidecar/tests/unit/test_tagging_run.py
git commit -m "refactor(tagging): extraire l'acces aux sources du pipeline"
```

---

## Task 2: Run vivant et ouverture en deux temps

**Files:**
- Modify: `sidecar/src/tagger/tagging.py`
- Modify: `sidecar/tests/helpers/tagging_api.py`
- Test: `sidecar/tests/unit/test_tagging_live_run.py`

**Interfaces:**
- Consumes: `RunSources` (Task 1).
- Produces:
  - `LiveRun(run_id: str, folder: Path, records: Sequence[TrackRecord])`, attributs `run_id`, `folder` ; `record(track_id) -> TrackRecord | None` ; `position(track_id) -> int` (rang 1-based, `KeyError` si inconnu) ; `update(record) -> None` ; `snapshot() -> TaggingRun`
  - `async open_run(folder: Path, *, on_event: Callable[[RunEvent], None]) -> LiveRun` : listing, identités, `RunStarted`
  - `async resolve_run(live: LiveRun, sources: RunSources, *, on_event: Callable[[RunEvent], None]) -> None` : phase réseau, chaque morceau écrit dans `live` dès qu'il est traité
  - `run_tagging(...)` : signature inchangée
  - helpers de test : `Gate` (`reached`, `release`, deux `asyncio.Event`), `FakeApi.gate(path, key) -> Gate`, `FakeApi.gated_handler`, `OpenedRun(live, sources)`, `opened_run(folder, api, *, cdn=None, events=None)` (context manager async)

- [ ] **Step 1: Ajouter les portes et l'ouverture de run au helper**

Remplacer tout le contenu de `sidecar/tests/helpers/tagging_api.py` par :

```python
"""API techno-scraper et CDN de pochettes simules pour les tests du pipeline.

Chaque route repond selon la requete recue. Une recherche sans reponse enregistree
rend une page vide, un refetch sans reponse rend 404 : le pipeline garde alors
l'objet de recherche, ce qui est le comportement documente.
"""

import asyncio
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, NamedTuple

import httpx2
from audio_samples import tag, write_blank_mp3
from scraper_responses import make_client, page_payload

from tagger.cache import ArtworkFetcher, DiskCache
from tagger.matching import DEFAULT_THRESHOLDS
from tagger.sources import RunSources
from tagger.tagging import open_run, run_tagging

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Callable
    from pathlib import Path

    from tagger.tagging import LiveRun, RunEvent, TaggingRun

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


class Gate:
    """Retient une requete : `reached` quand elle arrive, relachee par `release`."""

    def __init__(self) -> None:
        self.reached = asyncio.Event()
        self.release = asyncio.Event()


def _route(request: httpx2.Request) -> tuple[str, str]:
    """Chemin et cle : la requete `q`, l'URL d'un refetch Bandcamp, sinon vide."""
    key = request.url.params.get("q") or request.url.params.get("url") or ""
    return request.url.path, key


class FakeApi:
    """Reponses par route et par requete, et journal des requetes recues."""

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
) -> AsyncIterator[OpenedRun]:
    """Ouvre un run sur l'API et le CDN simules ; les portes de `api` s'appliquent."""
    cdn = cdn or FakeCdn()
    sink: list[RunEvent] = events if events is not None else []
    artworks_cache = DiskCache(folder.parent / "artworks")
    async with (
        make_client(api.gated_handler) as client,
        ArtworkFetcher(
            artworks_cache, transport=httpx2.MockTransport(cdn.handler), resolve=public_resolver
        ) as artworks,
    ):
        live = await open_run(folder, on_event=sink.append)
        yield OpenedRun(live, RunSources(live.run_id, client, artworks, DEFAULT_THRESHOLDS))
```

Une requête retenue par une porte n'entre dans `requests` qu'une fois relâchée : une requête annulée à la porte n'est jamais comptée.

- [ ] **Step 2: Écrire les tests du run vivant**

Créer `sidecar/tests/unit/test_tagging_live_run.py` :

```python
"""Tests du run vivant : ce que le pipeline y laisse, pendant et apres sa phase reseau."""

import asyncio
from typing import TYPE_CHECKING

import pytest
from scraper_responses import track_payload
from tagging_api import FakeApi, found, opened_run, tagged_mp3

from tagger.tagging import ArbitrationRequired, resolve_run

if TYPE_CHECKING:
    from pathlib import Path

    from tagging_api import OpenedRun

    from tagger.tagging import RunEvent

pytestmark = pytest.mark.asyncio

GREY = "Adam Beyer Your Mind"
SLOW = "Amelie Lens Basiel"


def _two_tracks(tmp_path: Path) -> Path:
    folder = tmp_path / "music"
    tagged_mp3(folder, "a.mp3", "Adam Beyer", "Your Mind")
    tagged_mp3(folder, "b.mp3", "Amelie Lens", "Basiel")
    return folder


def _grey_zone(api: FakeApi) -> None:
    api.on(
        "/beatport/search",
        GREY,
        found(
            track_payload(id="1", mix_name="Extended Mix"),
            track_payload(id="2", mix_name="Radio Edit"),
        ),
    )


async def _until_held(opened: OpenedRun) -> asyncio.Task[None]:
    """Lance la phase reseau et rend la main des que le premier morceau attend."""
    held = asyncio.Event()

    def watch(event: RunEvent) -> None:
        if isinstance(event, ArbitrationRequired):
            held.set()

    phase = asyncio.create_task(
        resolve_run(opened.live, opened.sources, on_event=watch), name="phase"
    )
    await held.wait()
    return phase


async def _cancel(phase: asyncio.Task[None]) -> None:
    phase.cancel()
    with pytest.raises(asyncio.CancelledError):
        await phase


async def test_holds_a_grey_zone_track_after_the_network_phase(tmp_path: Path) -> None:
    api = FakeApi()
    _grey_zone(api)

    async with opened_run(_two_tracks(tmp_path), api) as opened:
        await resolve_run(opened.live, opened.sources, on_event=lambda _event: None)

        record = opened.live.record("a.mp3")
        assert record is not None
        assert record.arbitration is not None
        assert opened.live.snapshot().tracks[0] == record


async def test_keeps_the_tracks_already_processed_when_the_run_is_cancelled(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    _grey_zone(api)
    slow = api.gate("/beatport/search", SLOW)

    async with opened_run(_two_tracks(tmp_path), api) as opened:
        phase = await _until_held(opened)
        await slow.reached.wait()

        await _cancel(phase)

        waiting = opened.live.record("a.mp3")
        untouched = opened.live.record("b.mp3")
        assert waiting is not None
        assert waiting.arbitration is not None
        assert untouched is not None
        assert (untouched.state, untouched.arbitration) == (None, None)
```

- [ ] **Step 3: Vérifier que les tests échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_tagging_live_run.py -q --no-cov`
Expected: FAIL à la collecte, `ImportError: cannot import name 'open_run' from 'tagger.tagging'`

- [ ] **Step 4: Ajouter `LiveRun` et l'ouverture en deux temps**

Dans `sidecar/src/tagger/tagging.py` :

1. Sous `if TYPE_CHECKING:`, importer `Sequence` : `from collections.abc import Callable, Sequence`.

2. Remplacer la classe `TaggingRun` par `TaggingRun` suivie de `LiveRun` :

```python
@dataclass(frozen=True, slots=True)
class TaggingRun:
    """Etat gele d'un run, que la Feature 6 persistera."""

    run_id: str
    folder: Path
    tracks: tuple[TrackRecord, ...]


class LiveRun:
    """Etat vivant d'un run : le pipeline y ecrit chaque morceau des qu'il est traite.

    Il survit a la phase reseau comme a son interruption : l'arbitrage continue d'y
    trancher les morceaux en attente jusqu'a ce qu'un autre run le remplace.
    """

    def __init__(self, run_id: str, folder: Path, records: Sequence[TrackRecord]) -> None:
        self.run_id = run_id
        self.folder = folder
        self._records = {record.track_id: record for record in records}
        self._positions = {
            record.track_id: position for position, record in enumerate(records, start=1)
        }

    def record(self, track_id: str) -> TrackRecord | None:
        return self._records.get(track_id)

    def position(self, track_id: str) -> int:
        """Rang du morceau dans le dossier, la cle `track` des logs."""
        return self._positions[track_id]

    def update(self, record: TrackRecord) -> None:
        self._records[record.track_id] = record

    def snapshot(self) -> TaggingRun:
        return TaggingRun(self.run_id, self.folder, tuple(self._records.values()))
```

3. Remplacer le corps de `run_tagging` (docstring comprise) et ajouter `open_run` et `resolve_run` juste après :

```python
    """Ouvre le run, resout tous ses morceaux et rend son etat gele."""
    live = await open_run(folder, on_event=on_event)
    sources = RunSources(live.run_id, client, artworks, thresholds)
    await resolve_run(live, sources, on_event=on_event)
    return live.snapshot()


async def open_run(folder: Path, *, on_event: Callable[[RunEvent], None]) -> LiveRun:
    """Liste les fichiers et lit leur identite, avant tout appel reseau."""
    paths = await asyncio.to_thread(list_audio_files, folder)
    run_id = secrets.token_hex(3)
    records = await _read_identities(run_id, folder, paths)
    on_event(RunStarted(run_id, tuple(records)))
    return LiveRun(run_id, folder, records)


async def resolve_run(
    live: LiveRun, sources: RunSources, *, on_event: Callable[[RunEvent], None]
) -> None:
    """Phase reseau : chaque morceau est ecrit dans `live` des qu'il est traite.

    Le pipeline ne s'arrete jamais sur un morceau : une zone grise est mise en
    attente, un incident devient un motif d'echec. Seuls trois 403 consecutifs
    arretent le run, par `ApiKeyRejectedRunError`.
    """
    tracks = live.snapshot().tracks
    runner = _Runner(len(tracks), sources, live, on_event)
    try:
        async with asyncio.TaskGroup() as group:
            for position, record in enumerate(tracks, start=1):
                group.create_task(runner.process(position, record), name=f"track:{position}")
    except* ApiKeyRejectedRunError:
        raise ApiKeyRejectedRunError from None
```

4. Remplacer l'en-tête de `_Runner` et sa méthode `process` :

```python
    def __init__(
        self,
        total: int,
        sources: RunSources,
        live: LiveRun,
        on_event: Callable[[RunEvent], None],
    ) -> None:
        self._run_id = sources.run_id
        self._total = total
        self._sources = sources
        self._live = live
        self._on_event = on_event
        self._processed = 0

    async def process(self, position: int, record: TrackRecord) -> None:
        done = await self._resolve(position, record)
        self._live.update(done)
        event = ArbitrationRequired(done) if done.arbitration else TrackResolved(done)
        self._on_event(event)
        self._processed += 1
        self._on_event(RunProgress(self._processed, self._total))
```

Le `TaskGroup` garde lui-même une référence forte sur chaque tâche : sans résultat à relire, la liste `tasks` disparaît.

- [ ] **Step 5: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_tagging_live_run.py tests/unit/test_tagging_outcomes.py tests/unit/test_tagging_run.py -q --no-cov`
Expected: PASS (21 tests)

- [ ] **Step 6: Gate**

Run: `just lint-sidecar && just typecheck-sidecar && just test-sidecar`
Expected: tout vert

- [ ] **Step 7: Commit**

```bash
git add sidecar/src/tagger/tagging.py sidecar/tests/helpers/tagging_api.py sidecar/tests/unit/test_tagging_live_run.py
git commit -m "feat(tagging): garder le run vivant au-dela de sa phase reseau"
```

---

## Task 3: Choisir un candidat

**Files:**
- Create: `sidecar/src/tagger/arbitration.py`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`
- Test: `sidecar/tests/unit/test_arbitration_gestures.py`, `sidecar/tests/unit/test_tagging_live_run.py`

**Interfaces:**
- Consumes: `LiveRun`, `RunSources.retained`, `TrackResolved`, `Resolution`, `TrackState` (Tasks 1 et 2).
- Produces:
  - `ArbitrationUpdated(record: TrackRecord)`, alias `ArbitrationEvent = ArbitrationUpdated | TrackResolved`
  - `ArbitrationError(message, track_id)` (code `arbitration_error`, `params == {"track_id": ...}`) et ses feuilles `ArbitrationNotPendingError(track_id)`, `ArbitrationCandidateUnknownError(track_id)`, `ArbitrationBusyError(track_id)`
  - `Arbitration(live: LiveRun, sources: RunSources, on_event: Callable[[ArbitrationEvent], None])`, `async choose(track_id: str, source: Source, index: int) -> None`
  - `_Pending(record, arbitration, query, position)`, `_pending(track_id)`, `_in_flight(track_id)`, `_settle(record)` : réutilisés par la Task 4

- [ ] **Step 1: Écrire les tests du choix**

Créer `sidecar/tests/unit/test_arbitration_gestures.py` :

```python
"""Tests des gestes d'arbitrage sur un run vivant."""

import asyncio
from typing import TYPE_CHECKING

import pytest
from scraper_responses import track_payload
from tagging_api import FakeApi, found, ok, opened_run, tagged_mp3

from tagger.arbitration import (
    Arbitration,
    ArbitrationBusyError,
    ArbitrationCandidateUnknownError,
    ArbitrationNotPendingError,
)
from tagger.scraper_client import Source
from tagger.tagging import Resolution, TrackResolved, TrackState, resolve_run

if TYPE_CHECKING:
    from pathlib import Path

    from tagging_api import OpenedRun

    from tagger.arbitration import ArbitrationEvent

pytestmark = pytest.mark.asyncio

QUERY = "Adam Beyer Your Mind"
TRACK = "your mind.mp3"
EXTENDED = track_payload(id="1", mix_name="Extended Mix")
RADIO = track_payload(id="2", mix_name="Radio Edit")


def _music(tmp_path: Path) -> Path:
    folder = tmp_path / "music"
    tagged_mp3(folder, TRACK, "Adam Beyer", "Your Mind")
    return folder


def _on_hold(api: FakeApi) -> None:
    """Extended et Radio Edit : deux versions qui ne valent pas l'original demande."""
    api.on("/beatport/search", QUERY, found(EXTENDED, RADIO))


async def _network_phase(opened: OpenedRun) -> None:
    await resolve_run(opened.live, opened.sources, on_event=lambda _event: None)


async def test_resolves_a_track_by_arbitration_with_the_refetched_candidate_and_its_artwork(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    _on_hold(api)
    api.on(
        "/beatport/tracks/2",
        "*",
        ok(track_payload(id="2", mix_name="Radio Edit", isrc="REFETCHED")),
    )
    events: list[ArbitrationEvent] = []

    async with opened_run(_music(tmp_path), api) as opened:
        await _network_phase(opened)
        arbitration = Arbitration(opened.live, opened.sources, events.append)

        await arbitration.choose(TRACK, Source.BEATPORT, 1)

        record = opened.live.record(TRACK)
    assert record is not None
    assert (record.state, record.resolution, record.source, record.arbitration) == (
        TrackState.RESOLVED,
        Resolution.ARBITRATION,
        Source.BEATPORT,
        None,
    )
    assert record.candidate is not None
    assert record.candidate.isrc == "REFETCHED"
    assert record.artwork is not None
    assert events == [TrackResolved(record)]


@pytest.mark.parametrize("track_id", ["ghost.mp3", TRACK], ids=["unknown", "resolved"])
async def test_rejects_a_gesture_on_a_track_that_is_unknown_or_already_resolved(
    tmp_path: Path, track_id: str
) -> None:
    api = FakeApi()
    api.on("/beatport/search", QUERY, found(track_payload(mix_name="Original Mix")))

    async with opened_run(_music(tmp_path), api) as opened:
        await _network_phase(opened)
        arbitration = Arbitration(opened.live, opened.sources, lambda _event: None)

        with pytest.raises(ArbitrationNotPendingError, match="not awaiting"):
            await arbitration.choose(track_id, Source.BEATPORT, 0)


@pytest.mark.parametrize(
    ("source", "index"),
    [(Source.BANDCAMP, 0), (Source.BEATPORT, 2), (Source.BEATPORT, -1)],
    ids=["hidden-source", "past-the-end", "negative"],
)
async def test_rejects_a_candidate_outside_the_shown_list_or_from_a_hidden_source(
    tmp_path: Path, source: Source, index: int
) -> None:
    api = FakeApi()
    _on_hold(api)

    async with opened_run(_music(tmp_path), api) as opened:
        await _network_phase(opened)
        arbitration = Arbitration(opened.live, opened.sources, lambda _event: None)
        before = opened.live.record(TRACK)

        with pytest.raises(ArbitrationCandidateUnknownError, match="not in the shown list"):
            await arbitration.choose(TRACK, source, index)

        assert opened.live.record(TRACK) == before


async def test_rejects_a_second_gesture_while_the_first_one_is_in_flight(tmp_path: Path) -> None:
    api = FakeApi()
    _on_hold(api)
    refetch = api.gate("/beatport/tracks/2", "")

    async with opened_run(_music(tmp_path), api) as opened:
        await _network_phase(opened)
        arbitration = Arbitration(opened.live, opened.sources, lambda _event: None)
        first = asyncio.create_task(arbitration.choose(TRACK, Source.BEATPORT, 1), name="first")
        await refetch.reached.wait()

        with pytest.raises(ArbitrationBusyError, match="in flight"):
            await arbitration.choose(TRACK, Source.BEATPORT, 0)

        refetch.release.set()
        await first
    assert api.paths().count("/beatport/tracks/2") == 1
    assert "/beatport/tracks/1" not in api.paths()


async def test_leaves_a_track_awaiting_and_unchanged_when_its_gesture_is_cancelled(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    _on_hold(api)
    refetch = api.gate("/beatport/tracks/2", "")

    async with opened_run(_music(tmp_path), api) as opened:
        await _network_phase(opened)
        arbitration = Arbitration(opened.live, opened.sources, lambda _event: None)
        before = opened.live.record(TRACK)
        gesture = asyncio.create_task(arbitration.choose(TRACK, Source.BEATPORT, 1), name="gesture")
        await refetch.reached.wait()

        gesture.cancel()
        with pytest.raises(asyncio.CancelledError):
            await gesture

        assert opened.live.record(TRACK) == before
        await arbitration.choose(TRACK, Source.BEATPORT, 0)
        after = opened.live.record(TRACK)
        assert after is not None
        assert after.state is TrackState.RESOLVED
```

Le dernier `choose` prouve que l'annulation a libéré le morceau : resté occupé, il lèverait `ArbitrationBusyError`.

- [ ] **Step 2: Écrire les tests du geste pendant et après la phase réseau**

Dans `sidecar/tests/unit/test_tagging_live_run.py`, compléter les imports :

```python
from tagger.arbitration import Arbitration
from tagger.scraper_client import Source
from tagger.tagging import ArbitrationRequired, TrackState, resolve_run
```

puis ajouter en fin de fichier :

```python
async def test_resolves_an_awaiting_track_while_another_one_is_still_in_flight(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    _grey_zone(api)
    slow = api.gate("/beatport/search", SLOW)

    async with opened_run(_two_tracks(tmp_path), api) as opened:
        phase = await _until_held(opened)
        arbitration = Arbitration(opened.live, opened.sources, lambda _event: None)

        await arbitration.choose("a.mp3", Source.BEATPORT, 0)

        record = opened.live.record("a.mp3")
        assert record is not None
        assert record.state is TrackState.RESOLVED
        assert not phase.done()
        slow.release.set()
        await phase


async def test_answers_an_awaiting_track_after_the_run_is_cancelled(tmp_path: Path) -> None:
    api = FakeApi()
    _grey_zone(api)
    slow = api.gate("/beatport/search", SLOW)

    async with opened_run(_two_tracks(tmp_path), api) as opened:
        phase = await _until_held(opened)
        await slow.reached.wait()
        await _cancel(phase)
        arbitration = Arbitration(opened.live, opened.sources, lambda _event: None)

        await arbitration.choose("a.mp3", Source.BEATPORT, 1)

        record = opened.live.record("a.mp3")
        assert record is not None
        assert record.state is TrackState.RESOLVED
```

- [ ] **Step 3: Vérifier que les tests échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_arbitration_gestures.py tests/unit/test_tagging_live_run.py -q --no-cov`
Expected: FAIL à la collecte, `ModuleNotFoundError: No module named 'tagger.arbitration'`

- [ ] **Step 4: Créer `sidecar/src/tagger/arbitration.py`**

```python
"""Arbitrage d'un morceau en zone grise (use-case 3, ADR-009).

Gestes sur un run vivant, pendant sa phase reseau comme apres. Ignore le protocole
NDJSON : les evenements sortent par un rappel, que le handler traduit.
"""

import logging
from contextlib import contextmanager
from dataclasses import dataclass, replace
from typing import TYPE_CHECKING, ClassVar, NamedTuple

from tagger.errors import TaggerError
from tagger.tagging import Resolution, TrackResolved, TrackState

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator

    from tagger.matching import TrackQuery
    from tagger.scraper_client import Source
    from tagger.sources import RunSources
    from tagger.tagging import LiveRun, PendingArbitration, TrackRecord

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class ArbitrationUpdated:
    """La liste affichee d'un morceau en attente a change."""

    record: TrackRecord


type ArbitrationEvent = ArbitrationUpdated | TrackResolved


class ArbitrationError(TaggerError):
    """Geste d'arbitrage impossible sur ce morceau."""

    code: ClassVar[str] = "arbitration_error"

    def __init__(self, message: str, track_id: str) -> None:
        super().__init__(message, track_id=track_id)


class ArbitrationNotPendingError(ArbitrationError):
    """Morceau inconnu du run, deja tranche ou jamais traite."""

    code: ClassVar[str] = "arbitration_not_pending"

    def __init__(self, track_id: str) -> None:
        super().__init__("track not awaiting arbitration", track_id)


class ArbitrationCandidateUnknownError(ArbitrationError):
    """Source qui n'est pas affichee, index hors de la liste, ou liste jamais obtenue."""

    code: ClassVar[str] = "arbitration_candidate_unknown"

    def __init__(self, track_id: str) -> None:
        super().__init__("candidate not in the shown list", track_id)


class ArbitrationBusyError(ArbitrationError):
    """Un geste est deja en vol sur ce morceau."""

    code: ClassVar[str] = "arbitration_busy"

    def __init__(self, track_id: str) -> None:
        super().__init__("a gesture is already in flight for this track", track_id)


class _Pending(NamedTuple):
    record: TrackRecord
    arbitration: PendingArbitration
    query: TrackQuery
    position: int


class Arbitration:
    """Gestes d'arbitrage sur un run vivant.

    Un second geste sur un morceau dont le premier est en vol est refuse, jamais mis
    en file : les clics rapides de la modale lanceraient sinon deux appels reseau.
    """

    def __init__(
        self,
        live: LiveRun,
        sources: RunSources,
        on_event: Callable[[ArbitrationEvent], None],
    ) -> None:
        self._live = live
        self._sources = sources
        self._on_event = on_event
        self._busy: set[str] = set()

    async def choose(self, track_id: str, source: Source, index: int) -> None:
        """Retient un candidat de la liste affichee : `resolved` / `arbitration`."""
        current = self._pending(track_id)
        shown = current.arbitration
        if source is not shown.source or not 0 <= index < len(shown.candidates):
            raise ArbitrationCandidateUnknownError(track_id)
        chosen = shown.candidates[index]
        with self._in_flight(track_id):
            candidate, artwork = await self._sources.retained(current.position, source, chosen)
        logger.info(
            "arbitration decided run=%s track=%d source=%s score=%.0f status=resolved",
            self._live.run_id,
            current.position,
            source,
            chosen.score,
        )
        self._settle(
            replace(
                current.record,
                state=TrackState.RESOLVED,
                resolution=Resolution.ARBITRATION,
                source=source,
                candidate=candidate,
                scored=chosen,
                artwork=artwork,
                arbitration=None,
            )
        )

    def _pending(self, track_id: str) -> _Pending:
        if track_id in self._busy:
            raise ArbitrationBusyError(track_id)
        record = self._live.record(track_id)
        if record is None or record.arbitration is None or record.query is None:
            raise ArbitrationNotPendingError(track_id)
        return _Pending(record, record.arbitration, record.query, self._live.position(track_id))

    @contextmanager
    def _in_flight(self, track_id: str) -> Iterator[None]:
        """Marque le morceau occupe le temps d'un appel, annulation comprise."""
        self._busy.add(track_id)
        try:
            yield
        finally:
            self._busy.discard(track_id)

    def _settle(self, record: TrackRecord) -> None:
        self._live.update(record)
        self._on_event(TrackResolved(record))
```

- [ ] **Step 5: Traduire les quatre codes**

`test_error_translations.py` parcourt toutes les sous-classes de `TaggerError` : sans ces lignes, il échoue.

Dans `public/i18n/fr.json`, bloc `errors`, après `"extraction_in_progress"` (ajouter la virgule à la ligne précédente) :

```json
    "arbitration_error": "Cette décision n'a pas pu être prise en compte.",
    "arbitration_not_pending": "Ce morceau n'attend plus de décision.",
    "arbitration_candidate_unknown": "Ce candidat n'est plus proposé pour ce morceau.",
    "arbitration_busy": "Une décision est déjà en cours sur ce morceau."
```

Dans `public/i18n/en.json`, même endroit :

```json
    "arbitration_error": "This decision could not be taken into account.",
    "arbitration_not_pending": "This track is no longer awaiting a decision.",
    "arbitration_candidate_unknown": "This candidate is no longer offered for this track.",
    "arbitration_busy": "A decision is already in progress for this track."
```

- [ ] **Step 6: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_arbitration_gestures.py tests/unit/test_tagging_live_run.py tests/unit/test_error_translations.py -q --no-cov`
Expected: PASS

- [ ] **Step 7: Gate**

Run: `just lint-sidecar && just typecheck-sidecar && just test-sidecar`
Expected: tout vert (526 tests)

- [ ] **Step 8: Commit**

```bash
git add sidecar/src/tagger/arbitration.py sidecar/tests/unit/test_arbitration_gestures.py sidecar/tests/unit/test_tagging_live_run.py public/i18n/fr.json public/i18n/en.json
git commit -m "feat(arbitration): trancher un morceau en zone grise par le choix d'un candidat"
```

---

## Task 4: Refuser, basculer sur Bandcamp et revenir

**Files:**
- Modify: `sidecar/src/tagger/tagging.py`
- Modify: `sidecar/src/tagger/arbitration.py`
- Test: `sidecar/tests/unit/test_arbitration_gestures.py`

**Interfaces:**
- Consumes: `Arbitration`, `_Pending`, `_pending`, `_in_flight`, `_settle` (Task 3) ; `RunSources.search`, `RunSources.thresholds`, `RunSources.log_source_failure` (Task 1) ; `classify(query, candidates, thresholds, *, allow_auto)`.
- Produces:
  - `SourceList(source: Source, candidates: tuple[ScoredCandidate, ...], empty_reason: FailureReason | None = None)`
  - `PendingArbitration(source, candidates, beatport_unavailable, empty_reason: FailureReason | None = None, other: SourceList | None = None)` : les trois premiers champs inchangés
  - `async Arbitration.refuse(track_id: str, source: Source) -> None` : `source` est la liste refusée, rejetée si elle n'est plus affichée
  - `Arbitration.show(track_id: str, source: Source) -> None` (synchrone, sans appel réseau)

- [ ] **Step 1: Écrire les tests du refus et de la bascule**

Dans `sidecar/tests/unit/test_arbitration_gestures.py`, remplacer les imports et les constantes, de `import pytest` jusqu'à `RADIO = ...` inclus, par :

```python
import pytest
from scraper_responses import track_payload
from tagging_api import FakeApi, failing, found, ok, opened_run, tagged_mp3

from tagger.arbitration import (
    Arbitration,
    ArbitrationBusyError,
    ArbitrationCandidateUnknownError,
    ArbitrationNotPendingError,
    ArbitrationUpdated,
)
from tagger.matching import DEFAULT_THRESHOLDS
from tagger.scraper_client import Source
from tagger.tagging import FailureReason, Resolution, TrackResolved, TrackState, resolve_run

if TYPE_CHECKING:
    from pathlib import Path

    from tagging_api import OpenedRun, Reply

    from tagger.arbitration import ArbitrationEvent
    from tagger.tagging import PendingArbitration

pytestmark = pytest.mark.asyncio

QUERY = "Adam Beyer Your Mind"
TRACK = "your mind.mp3"
EXTENDED = track_payload(id="1", mix_name="Extended Mix")
RADIO = track_payload(id="2", mix_name="Radio Edit")
BANDCAMP_URL = "https://adambeyer.bandcamp.com/track/your-mind"
ON_BANDCAMP = track_payload(id="42", source="bandcamp", mix_name=None, url=BANDCAMP_URL)
STRANGER = track_payload(
    id="43", artists=[{"name": "Amelie Lens"}], title="Basiel", source="bandcamp", mix_name=None
)
```

puis ajouter en fin de fichier :

```python
def _shown(opened: OpenedRun) -> PendingArbitration:
    record = opened.live.record(TRACK)
    assert record is not None
    assert record.arbitration is not None
    return record.arbitration


def _bandcamp_searches(api: FakeApi) -> int:
    return api.paths().count("/bandcamp/search")


async def test_calls_bandcamp_once_and_shows_its_list_when_beatport_is_refused(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    _on_hold(api)
    api.on("/bandcamp/search", QUERY, found(ON_BANDCAMP))
    events: list[ArbitrationEvent] = []

    async with opened_run(_music(tmp_path), api) as opened:
        await _network_phase(opened)
        arbitration = Arbitration(opened.live, opened.sources, events.append)

        await arbitration.refuse(TRACK, Source.BEATPORT)

        record = opened.live.record(TRACK)
    assert record is not None
    assert record.arbitration is not None
    assert record.arbitration.source is Source.BANDCAMP
    assert [entry.candidate.id for entry in record.arbitration.candidates] == ["42"]
    assert events == [ArbitrationUpdated(record)]
    assert _bandcamp_searches(api) == 1


async def test_keeps_a_bandcamp_candidate_above_the_ceiling_in_the_list_after_a_refusal(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    _on_hold(api)
    api.on("/bandcamp/search", QUERY, found(ON_BANDCAMP))

    async with opened_run(_music(tmp_path), api) as opened:
        await _network_phase(opened)
        arbitration = Arbitration(opened.live, opened.sources, lambda _event: None)

        await arbitration.refuse(TRACK, Source.BEATPORT)

        record = opened.live.record(TRACK)
        assert record is not None
        assert record.state is None
        assert record.arbitration is not None
        assert record.arbitration.candidates[0].score >= DEFAULT_THRESHOLDS.ceiling


async def test_shows_the_beatport_list_again_without_calling_any_source(tmp_path: Path) -> None:
    api = FakeApi()
    _on_hold(api)
    api.on("/bandcamp/search", QUERY, found(ON_BANDCAMP))
    events: list[ArbitrationEvent] = []

    async with opened_run(_music(tmp_path), api) as opened:
        await _network_phase(opened)
        arbitration = Arbitration(opened.live, opened.sources, events.append)
        await arbitration.refuse(TRACK, Source.BEATPORT)
        calls = len(api.requests)

        arbitration.show(TRACK, Source.BEATPORT)

        shown = _shown(opened)
        assert shown.source is Source.BEATPORT
        assert [entry.candidate.id for entry in shown.candidates] == ["1", "2"]
        assert isinstance(events[-1], ArbitrationUpdated)
    assert len(api.requests) == calls


async def test_shows_the_known_bandcamp_list_again_on_a_second_refusal_without_calling_it(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    _on_hold(api)
    api.on("/bandcamp/search", QUERY, found(ON_BANDCAMP))

    async with opened_run(_music(tmp_path), api) as opened:
        await _network_phase(opened)
        arbitration = Arbitration(opened.live, opened.sources, lambda _event: None)
        await arbitration.refuse(TRACK, Source.BEATPORT)
        arbitration.show(TRACK, Source.BEATPORT)

        await arbitration.refuse(TRACK, Source.BEATPORT)

        assert _shown(opened).source is Source.BANDCAMP
    assert _bandcamp_searches(api) == 1


async def test_leaves_a_track_unresolved_as_user_refused_when_bandcamp_is_refused(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    _on_hold(api)
    api.on("/bandcamp/search", QUERY, found(ON_BANDCAMP))
    events: list[ArbitrationEvent] = []

    async with opened_run(_music(tmp_path), api) as opened:
        await _network_phase(opened)
        arbitration = Arbitration(opened.live, opened.sources, events.append)
        await arbitration.refuse(TRACK, Source.BEATPORT)

        await arbitration.refuse(TRACK, Source.BANDCAMP)

        record = opened.live.record(TRACK)
    assert record is not None
    assert (record.state, record.resolution, record.failure_reason, record.arbitration) == (
        TrackState.UNRESOLVED,
        Resolution.NONE,
        FailureReason.USER_REFUSED,
        None,
    )
    assert events[-1] == TrackResolved(record)


@pytest.mark.parametrize(
    ("reply", "reason"),
    [
        (None, FailureReason.NO_RESULT),
        (found(STRANGER), FailureReason.BELOW_THRESHOLD),
        (failing(503, "source_unavailable"), FailureReason.SOURCE_UNAVAILABLE),
    ],
    ids=["no-result", "below-threshold", "unavailable"],
)
async def test_keeps_the_bandcamp_reason_when_an_empty_list_is_passed(
    tmp_path: Path, reply: Reply | None, reason: FailureReason
) -> None:
    api = FakeApi()
    _on_hold(api)
    if reply is not None:
        api.on("/bandcamp/search", QUERY, reply)

    async with opened_run(_music(tmp_path), api) as opened:
        await _network_phase(opened)
        arbitration = Arbitration(opened.live, opened.sources, lambda _event: None)
        await arbitration.refuse(TRACK, Source.BEATPORT)
        shown = _shown(opened)
        assert (shown.candidates, shown.empty_reason) == ((), reason)

        await arbitration.refuse(TRACK, Source.BANDCAMP)

        record = opened.live.record(TRACK)
    assert record is not None
    assert (record.state, record.failure_reason) == (TrackState.UNRESOLVED, reason)


async def test_refuses_a_track_without_calling_anything_when_beatport_was_unavailable(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    api.on("/beatport/search", "*", failing(503, "source_unavailable"))
    api.on("/bandcamp/search", QUERY, found(ON_BANDCAMP))

    async with opened_run(_music(tmp_path), api) as opened:
        await _network_phase(opened)
        arbitration = Arbitration(opened.live, opened.sources, lambda _event: None)
        calls = len(api.requests)

        await arbitration.refuse(TRACK, Source.BANDCAMP)

        record = opened.live.record(TRACK)
    assert record is not None
    assert record.failure_reason is FailureReason.USER_REFUSED
    assert len(api.requests) == calls


async def test_rejects_going_back_to_beatport_when_it_was_unavailable(tmp_path: Path) -> None:
    api = FakeApi()
    api.on("/beatport/search", "*", failing(503, "source_unavailable"))
    api.on("/bandcamp/search", QUERY, found(ON_BANDCAMP))

    async with opened_run(_music(tmp_path), api) as opened:
        await _network_phase(opened)
        arbitration = Arbitration(opened.live, opened.sources, lambda _event: None)

        with pytest.raises(ArbitrationCandidateUnknownError, match="not in the shown list"):
            arbitration.show(TRACK, Source.BEATPORT)


async def test_leaves_the_bandcamp_list_empty_as_source_unavailable_when_the_key_is_rejected(
    tmp_path: Path,
) -> None:
    """Trois refus en 403 : le troisieme declenche la garde du run, absorbee ici."""
    folder = tmp_path / "music"
    tracks = ["a.mp3", "b.mp3", "c.mp3"]
    for name in tracks:
        tagged_mp3(folder, name, "Adam Beyer", "Your Mind")
    api = FakeApi()
    _on_hold(api)
    api.on("/bandcamp/search", "*", failing(403))

    async with opened_run(folder, api) as opened:
        await _network_phase(opened)
        arbitration = Arbitration(opened.live, opened.sources, lambda _event: None)

        for name in tracks:
            await arbitration.refuse(name, Source.BEATPORT)

        records = [opened.live.record(name) for name in tracks]
    assert all(
        record is not None
        and record.arbitration is not None
        and record.arbitration.empty_reason is FailureReason.SOURCE_UNAVAILABLE
        for record in records
    )


async def test_refuses_one_track_while_another_refusal_waits_for_bandcamp(
    tmp_path: Path,
) -> None:
    folder = tmp_path / "music"
    tagged_mp3(folder, "a.mp3", "Adam Beyer", "Your Mind")
    tagged_mp3(folder, "b.mp3", "Amelie Lens", "Basiel")
    api = FakeApi()
    _on_hold(api)
    basiel = {"artists": [{"name": "Amelie Lens"}], "title": "Basiel"}
    api.on(
        "/beatport/search",
        "Amelie Lens Basiel",
        found(
            track_payload(id="3", mix_name="Extended Mix", **basiel),
            track_payload(id="4", mix_name="Radio Edit", **basiel),
        ),
    )
    slow = api.gate("/bandcamp/search", QUERY)

    async with opened_run(folder, api) as opened:
        await _network_phase(opened)
        arbitration = Arbitration(opened.live, opened.sources, lambda _event: None)
        first = asyncio.create_task(arbitration.refuse("a.mp3", Source.BEATPORT), name="first")
        await slow.reached.wait()

        await arbitration.refuse("b.mp3", Source.BEATPORT)

        other = opened.live.record("b.mp3")
        assert other is not None
        assert other.arbitration is not None
        assert other.arbitration.source is Source.BANDCAMP
        assert not first.done()
        slow.release.set()
        await first


async def test_rejects_choosing_in_an_empty_bandcamp_list(tmp_path: Path) -> None:
    api = FakeApi()
    _on_hold(api)

    async with opened_run(_music(tmp_path), api) as opened:
        await _network_phase(opened)
        arbitration = Arbitration(opened.live, opened.sources, lambda _event: None)
        await arbitration.refuse(TRACK, Source.BEATPORT)

        with pytest.raises(ArbitrationCandidateUnknownError, match="not in the shown list"):
            await arbitration.choose(TRACK, Source.BANDCAMP, 0)

        assert _shown(opened).source is Source.BANDCAMP


async def test_rejects_a_refusal_of_a_list_that_is_no_longer_shown(tmp_path: Path) -> None:
    api = FakeApi()
    _on_hold(api)
    api.on("/bandcamp/search", QUERY, found(ON_BANDCAMP))

    async with opened_run(_music(tmp_path), api) as opened:
        await _network_phase(opened)
        arbitration = Arbitration(opened.live, opened.sources, lambda _event: None)
        await arbitration.refuse(TRACK, Source.BEATPORT)

        with pytest.raises(ArbitrationCandidateUnknownError, match="not in the shown list"):
            await arbitration.refuse(TRACK, Source.BEATPORT)

        record = opened.live.record(TRACK)
        assert record is not None
        assert record.state is None
        assert _shown(opened).source is Source.BANDCAMP


async def test_rejects_showing_the_list_already_shown(tmp_path: Path) -> None:
    api = FakeApi()
    _on_hold(api)
    events: list[ArbitrationEvent] = []

    async with opened_run(_music(tmp_path), api) as opened:
        await _network_phase(opened)
        arbitration = Arbitration(opened.live, opened.sources, events.append)

        with pytest.raises(ArbitrationCandidateUnknownError, match="not in the shown list"):
            arbitration.show(TRACK, Source.BEATPORT)

    assert events == []


async def test_calls_bandcamp_again_after_a_cancelled_refusal(tmp_path: Path) -> None:
    """La requete annulee n'atteint jamais l'API simulee : seule la seconde est comptee."""
    api = FakeApi()
    _on_hold(api)
    api.on("/bandcamp/search", QUERY, found(ON_BANDCAMP))
    slow = api.gate("/bandcamp/search", QUERY)

    async with opened_run(_music(tmp_path), api) as opened:
        await _network_phase(opened)
        arbitration = Arbitration(opened.live, opened.sources, lambda _event: None)
        refusal = asyncio.create_task(arbitration.refuse(TRACK, Source.BEATPORT), name="refusal")
        await slow.reached.wait()
        refusal.cancel()
        with pytest.raises(asyncio.CancelledError):
            await refusal
        assert _shown(opened).source is Source.BEATPORT
        slow.release.set()

        await arbitration.refuse(TRACK, Source.BEATPORT)

        assert _shown(opened).source is Source.BANDCAMP
    assert _bandcamp_searches(api) == 1
```

`ON_BANDCAMP` est un candidat parfait, au-dessus du plafond : c'est ce qui rend le deuxième test significatif. `STRANGER` est un autre artiste, sous le plancher.

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_arbitration_gestures.py -q --no-cov`
Expected: FAIL, `AttributeError: 'Arbitration' object has no attribute 'refuse'` sur les nouveaux tests ; les cinq tests de la Task 3 passent

- [ ] **Step 3: Garder la liste de l'autre source dans l'attente d'arbitrage**

Dans `sidecar/src/tagger/tagging.py`, remplacer la classe `PendingArbitration` par :

```python
@dataclass(frozen=True, slots=True)
class SourceList:
    """Liste d'une source mise de cote pendant qu'une autre est affichee."""

    source: Source
    candidates: tuple[ScoredCandidate, ...]
    empty_reason: FailureReason | None = None


@dataclass(frozen=True, slots=True)
class PendingArbitration:
    """Candidats en zone grise de la source affichee, en attente d'une decision humaine.

    `other` garde la liste de l'autre source une fois obtenue : revenir en arriere
    ne rappelle rien. `empty_reason` dit pourquoi une liste Bandcamp affichee est vide.
    """

    source: Source
    candidates: tuple[ScoredCandidate, ...]
    beatport_unavailable: bool
    empty_reason: FailureReason | None = None
    other: SourceList | None = None
```

Le pipeline construit toujours `PendingArbitration(source, candidates, beatport_unavailable=...)` : il n'a rien à changer.

- [ ] **Step 4: Ajouter le refus et la bascule**

Dans `sidecar/src/tagger/arbitration.py` :

1. Remplacer les imports, de `import logging` jusqu'à la fin du bloc `if TYPE_CHECKING:`, par :

```python
import logging
from contextlib import contextmanager
from dataclasses import dataclass, replace
from typing import TYPE_CHECKING, ClassVar, NamedTuple

from tagger.errors import TaggerError
from tagger.matching import classify
from tagger.scraper_client import (
    ApiContractError,
    ApiKeyRejectedError,
    Source,
    SourceUnavailableError,
)
from tagger.sources import ApiKeyRejectedRunError
from tagger.tagging import (
    FailureReason,
    PendingArbitration,
    Resolution,
    SourceList,
    TrackResolved,
    TrackState,
)

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator

    from tagger.matching import TrackQuery
    from tagger.sources import RunSources
    from tagger.tagging import LiveRun, TrackRecord
```

2. Ajouter dans `Arbitration`, entre `choose` et `_pending` :

```python
    async def refuse(self, track_id: str, source: Source) -> None:
        """Refuse la liste `source` : Bandcamp apres Beatport, non resolu apres Bandcamp.

        `source` doit etre la liste affichee : un double clic arrive apres la bascule
        refuserait sinon Bandcamp sans que l'utilisateur l'ait vue.
        """
        current = self._pending(track_id)
        shown = current.arbitration
        if source is not shown.source:
            raise ArbitrationCandidateUnknownError(track_id)
        if shown.source is Source.BANDCAMP:
            self._give_up(current)
            return
        if shown.other is not None:
            self._show(current, shown.other)
            return
        with self._in_flight(track_id):
            answer = await self._ask_bandcamp(current.position, current.query)
        self._show(current, answer)

    def show(self, track_id: str, source: Source) -> None:
        """Reaffiche la liste deja obtenue de `source`, sans appel reseau."""
        current = self._pending(track_id)
        kept = current.arbitration.other
        if kept is None or kept.source is not source:
            raise ArbitrationCandidateUnknownError(track_id)
        self._show(current, kept)

    async def _ask_bandcamp(self, position: int, query: TrackQuery) -> SourceList:
        """Liste Bandcamp apres un refus, jamais validee seule : l'utilisateur decide."""
        try:
            found = await self._sources.search(Source.BANDCAMP, query)
        except ApiKeyRejectedError, ApiKeyRejectedRunError:
            # Le 403 ne concerne que ce morceau : arreter le run revient au pipeline.
            return SourceList(Source.BANDCAMP, (), FailureReason.SOURCE_UNAVAILABLE)
        except (SourceUnavailableError, ApiContractError) as exc:
            self._sources.log_source_failure(position, Source.BANDCAMP, exc)
            return SourceList(Source.BANDCAMP, (), FailureReason.SOURCE_UNAVAILABLE)
        retained = classify(query, found, self._sources.thresholds, allow_auto=False).retained
        if retained:
            return SourceList(Source.BANDCAMP, retained)
        reason = FailureReason.BELOW_THRESHOLD if found else FailureReason.NO_RESULT
        return SourceList(Source.BANDCAMP, (), reason)

    def _show(self, current: _Pending, kept: SourceList) -> None:
        """`kept` passe a l'affichage, la liste affichee est mise de cote."""
        shown = current.arbitration
        record = replace(
            current.record,
            arbitration=PendingArbitration(
                kept.source,
                kept.candidates,
                shown.beatport_unavailable,
                empty_reason=kept.empty_reason,
                other=SourceList(shown.source, shown.candidates, shown.empty_reason),
            ),
        )
        logger.info(
            "arbitration switched run=%s track=%d source=%s status=grey_zone",
            self._live.run_id,
            current.position,
            kept.source,
        )
        self._live.update(record)
        self._on_event(ArbitrationUpdated(record))

    def _give_up(self, current: _Pending) -> None:
        """Bandcamp refuse, ou passe sur une liste vide dont le motif est garde."""
        reason = current.arbitration.empty_reason or FailureReason.USER_REFUSED
        logger.info(
            "arbitration refused run=%s track=%d source=%s status=unresolved reason=%s",
            self._live.run_id,
            current.position,
            Source.BANDCAMP,
            reason,
        )
        self._settle(
            replace(
                current.record,
                state=TrackState.UNRESOLVED,
                resolution=Resolution.NONE,
                failure_reason=reason,
                arbitration=None,
            )
        )
```

Pourquoi `ApiKeyRejectedRunError` est absorbée : la garde est partagée avec le pipeline (Task 1), et son troisième 403 lève cette erreur au lieu de relever `ApiKeyRejectedError`. Laissée passer, elle ferait échouer un geste pour une décision qui appartient au run.

- [ ] **Step 5: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_arbitration_gestures.py tests/unit/test_tagging_live_run.py tests/unit/test_protocol_tagging.py -q --no-cov`
Expected: PASS

- [ ] **Step 6: Gate**

Run: `just lint-sidecar && just typecheck-sidecar && just test-sidecar`
Expected: tout vert (542 tests)

- [ ] **Step 7: Commit**

```bash
git add sidecar/src/tagger/tagging.py sidecar/src/tagger/arbitration.py sidecar/tests/unit/test_arbitration_gestures.py
git commit -m "feat(arbitration): basculer sur Bandcamp au refus et revenir a Beatport"
```

---

## Task 5: Documentation

**Files:**
- Modify: `docs/ARCHITECTURE.md`

Charger `Skill[architecture-doc]` avant toute édition d'ARCHITECTURE.md : le gabarit porte la structure et le style attendus (`~/.claude/CLAUDE.md` § Agents, Commandes & Skills).

- [ ] **Step 1: Arborescence**

Dans le bloc d'arborescence de `sidecar/src/tagger/`, sous la ligne `tagging.py`, ajouter en gardant l'alignement des commentaires :

```text
│   │   ├── sources.py                    # accès aux sources d'un run, garde des 403
│   │   ├── arbitration.py                # gestes d'arbitrage sur un run vivant
```

et remplacer le commentaire de `tagging.py` par `# pipeline de résolution, run vivant en mémoire`.

- [ ] **Step 2: Chaîne de résolution**

Dans le diagramme « Chaîne de résolution d'un morceau », remplacer :

```text
    m2 -->|"vide"| kon["unresolved<br/>failure_reason = no_result<br/>ou below_threshold"]
```

par :

```text
    m2 -->|"vide, au geste « passer »"| kon["unresolved<br/>failure_reason = no_result<br/>ou below_threshold"]
    m2 -->|"en panne, au geste « passer »"| kos
```

Puis, après le paragraphe **Beatport injoignable** qui suit le diagramme, ajouter :

```markdown
**Liste Bandcamp vide après un refus** : le morceau reste à arbitrer, la modale affichant la liste vide, jusqu'au geste « passer ». Il part alors en `unresolved` avec le motif de Bandcamp (`no_result`, `below_threshold` ou `source_unavailable`), jamais `user_refused` : la correction à apporter est celle de Bandcamp. Après un refus, Bandcamp ne valide jamais seul, l'utilisateur étant en train de décider.
```

- [ ] **Step 3: Diagramme d'état**

Dans le `stateDiagram-v2` de § API, sous `a_arbitrer --> unresolved : refus Bandcamp, failure_reason = user_refused`, ajouter :

```text
    a_arbitrer --> unresolved : « passer » sur une liste Bandcamp vide, motif de Bandcamp
```

- [ ] **Step 4: Concurrence**

Dans § Concurrence, remplacer le paragraphe :

```markdown
La file d'arbitrage est une simple structure en mémoire, exposée à l'interface par les événements NDJSON. Aucun courtier de messages, tout vit dans un seul process.
```

par :

```markdown
La file d'arbitrage vit dans le run vivant (`LiveRun`), une simple structure en mémoire exposée à l'interface par les événements NDJSON. Aucun courtier de messages, tout vit dans un seul process. Les gestes d'arbitrage avancent en parallèle d'un morceau à l'autre et partagent les sémaphores du client avec le pipeline. Un seul geste est en vol par morceau : le second est refusé en `arbitration_busy`, jamais mis en file, sans quoi les clics rapides de la modale lanceraient deux appels Bandcamp.
```

- [ ] **Step 5: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs: file d'arbitrage dans le run vivant et liste Bandcamp vide"
```
