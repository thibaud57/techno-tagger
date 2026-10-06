# Rattrapage par URL dans le run vivant : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Résoudre dans le sidecar, à partir d'une URL collée, un morceau resté sans correspondance à la fin d'un run, et le faire passer en résolu par URL.

**Architecture:** Un module `url_recovery.py`, jumeau d'`arbitration.py` : `UrlRecovery(live, sources, on_event)` vérifie l'éligibilité du morceau, garde un seul geste en vol par morceau, résout l'URL par `RunSources.from_url` (garde des 403 du run, pochette comprise), puis passe le morceau en `resolved · url` sans score et émet `TrackResolved` suivi d'`UrlProgress`. `progress()` calcule « rattrapés sur à rattraper » sur l'état du run. `TrackRecord.resolved` accepte `scored=None` et efface le motif d'échec.

**Tech Stack:** Python 3.14 (`contextlib.contextmanager`, dataclasses figées), pytest + pytest-asyncio (mode strict), httpx2 `MockTransport` via `tagging_api.FakeApi`. Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/rattrapage-par-url-manuelle/02-rattrapage-url-sidecar-design.md`

## Global Constraints

- **Dépend du sub-project 01, implémenté avant** : `TechnoScraperClient.fetch_by_url(url: str) -> TrackCandidate`, `UnsupportedTrackUrlError` (code `unsupported_url`, sans `params`), `TrackNotFoundError`, `SourceUnavailableError`, `ApiKeyRejectedError`, `ApiContractError`, `ScraperError.request_id`.
- **Éligibles** : `state is UNRESOLVED`, ou `state is RESOLVED` avec `resolution is URL`. Tout le reste (inconnu, `auto`, `arbitration`, en attente d'arbitrage, non traité) lève `UrlRecoveryNotEligibleError`, avant tout appel réseau.
- **Codes d'erreur** : `url_recovery_error` (base), `url_recovery_not_eligible`, `url_recovery_busy`, `params == {"track_id": <id>}`, traduits dans `public/i18n/fr.json` et `en.json` sous `errors`. Les erreurs du client remontent sans changement.
- **Un seul geste en vol par morceau** : le second lève `UrlRecoveryBusyError`, jamais mis en file.
- **Un échec ne modifie rien** : morceau, motif et résolution précédente intacts, aucun événement émis.
- **Progression** : `UrlProgress(processed, total)`, `total` = `unresolved` + `resolved · url`, `processed` = `resolved · url`, calculée sur `LiveRun.snapshot()`. Un succès émet `TrackResolved(record)` puis `progress()`.
- **Logs** logfmt, clés `run`, `track` (position), `source`, `status`, `reason`, `request_id`. Jamais l'URL ni le titre dans un log du module.
- **Rien n'est persisté**, aucune commande NDJSON, aucun câblage dans `CurrentRun` : sub-project 03.
- **Code Python sans accents**, docstrings et commentaires en français, le pourquoi seulement.
- **Tests** : noms en anglais, AAA séparé par des lignes vides, jamais de réseau réel.
- **Gate vert à chaque commit** : `just lint-sidecar`, `just typecheck-sidecar`, `just test-sidecar`. Commits `type(scope): description`, scope `sidecar`.

## Review Focus

- **Même URL collée deux fois de suite sur le même morceau** : la seconde est une correction vers le même candidat, le morceau reste `resolved · url` et la progression ne compte pas deux fois (Task 1, `test_replaces_a_track_already_resolved_by_url`, cas `same-url`).
- **Morceau qui garderait son motif d'échec une fois rattrapé** : `failure_reason` repasse à `None` (Task 1, `test_resolves_an_unresolved_track_by_url_with_the_fetched_candidate_and_its_artwork`).
- **Erreur inattendue pendant le geste** (contrat cassé) : la garde libère le morceau, un nouveau geste reste possible (Task 3, `test_releases_the_track_after_a_failed_gesture`).
- **Geste sur un morceau inconnu du run** : `url_recovery_not_eligible`, jamais `KeyError` sur la position (Task 2, `test_refuses_a_track_unknown_to_the_run`).
- **URL dans les logs du module** : absente sur un succès comme sur un échec (Task 3, `test_never_logs_the_pasted_url`).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `sidecar/src/tagger/url_recovery.py` | `UrlProgress`, `UrlRecoveryEvent`, erreurs `UrlRecovery*`, `UrlRecovery` (`resolve`, `progress`). |
| `sidecar/src/tagger/sources.py` | `RunSources.from_url(position, url)`. |
| `sidecar/src/tagger/tagging.py` | `TrackRecord.resolved` : `scored` optionnel, motif d'échec effacé. |
| `sidecar/tests/unit/test_url_recovery.py` | Gestes, éligibilité, échecs, progression, logs. |
| `public/i18n/fr.json`, `public/i18n/en.json` | Trois codes `url_recovery_*`. |
| `docs/ARCHITECTURE.md` | Use-case 4 et § Concurrence. |

---

## Task 1: Rattrapage et progression

**Files:**
- Create: `sidecar/src/tagger/url_recovery.py`
- Modify: `sidecar/src/tagger/sources.py` (après `retained`)
- Modify: `sidecar/src/tagger/tagging.py` (`TrackRecord.resolved`)
- Test: `sidecar/tests/unit/test_url_recovery.py` (création)

**Interfaces:**
- Consumes: `LiveRun.record/position/update/snapshot`, `TrackRecord.resolved`, `TrackResolved`, `Resolution`, `TrackState` (`tagger.tagging`) ; `RunSources._call`, `RunSources._artwork` ; `TechnoScraperClient.fetch_by_url` (sub-project 01) ; helpers `FakeApi`, `FakeCdn`, `ok`, `found`, `opened_run`, `one_track`, `three_tracks`, `ONE_TRACK`, `ORIGINAL` (`tagging_api`), `track_payload`, `YOUR_MIND` (`scraper_responses`).
- Produces:
  - `TrackRecord.resolved(resolution: Resolution, source: Source, candidate: TrackCandidate, scored: ScoredCandidate | None, artwork: Path | None) -> TrackRecord`, `failure_reason=None` dans le résultat
  - `RunSources.from_url(position: int, url: str) -> tuple[TrackCandidate, Path | None]`
  - `url_recovery.UrlProgress(processed: int, total: int)` (dataclass figée)
  - `url_recovery.UrlRecoveryEvent = TrackResolved | UrlProgress`
  - `url_recovery.UrlRecovery(live: LiveRun, sources: RunSources, on_event: Callable[[UrlRecoveryEvent], None])`, `async resolve(track_id: str, url: str) -> None`, `progress() -> UrlProgress`

- [ ] **Step 1: Écrire les tests du chemin nominal et de la progression**

Créer `sidecar/tests/unit/test_url_recovery.py` :

```python
"""Tests du rattrapage par URL sur un run vivant, apres sa phase reseau."""

from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

import pytest
from scraper_responses import YOUR_MIND, track_payload
from tagging_api import (
    ONE_TRACK,
    ORIGINAL,
    FakeApi,
    FakeCdn,
    found,
    ok,
    one_track,
    opened_run,
    three_tracks,
)

from tagger.scraper_client import Source
from tagger.tagging import FailureReason, Resolution, TrackResolved, TrackState, resolve_run
from tagger.url_recovery import UrlProgress, UrlRecovery

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator
    from pathlib import Path

    from tagging_api import OpenedRun

    from tagger.url_recovery import UrlRecoveryEvent

pytestmark = pytest.mark.asyncio

BANDCAMP_URL = "https://amelielens.bandcamp.com/track/basiel"
BEATPORT_URL = "https://www.beatport.com/track/your-mind/22708005"
ON_BANDCAMP = track_payload(id="7", source="bandcamp", mix_name=None, url=BANDCAMP_URL)
ON_BEATPORT = track_payload(id="22708005")


@asynccontextmanager
async def _recovering(
    folder: Path,
    api: FakeApi,
    events: list[UrlRecoveryEvent] | None = None,
    cdn: FakeCdn | None = None,
) -> AsyncGenerator[tuple[OpenedRun, UrlRecovery]]:
    """Run ouvert apres sa phase reseau et le rattrapage qui porte sur lui.

    Sans reponse enregistree, `FakeApi` rend des recherches vides : chaque morceau
    finit `unresolved`, motif `no_result`.
    """
    sink: list[UrlRecoveryEvent] = events if events is not None else []
    async with opened_run(folder, api, cdn=cdn) as opened:
        await resolve_run(opened.live, opened.sources, on_event=lambda _event: None)
        yield opened, UrlRecovery(opened.live, opened.sources, sink.append)


def _bandcamp_found(api: FakeApi) -> None:
    api.on("/bandcamp/tracks", BANDCAMP_URL, ok(ON_BANDCAMP))


async def test_resolves_an_unresolved_track_by_url_with_the_fetched_candidate_and_its_artwork(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    _bandcamp_found(api)

    async with _recovering(one_track(tmp_path), api) as (opened, recovery):
        await recovery.resolve(ONE_TRACK, BANDCAMP_URL)

        record = opened.live.record(ONE_TRACK)
    assert record is not None
    assert (record.state, record.resolution, record.source) == (
        TrackState.RESOLVED,
        Resolution.URL,
        Source.BANDCAMP,
    )
    assert (record.failure_reason, record.scored) == (None, None)
    assert record.candidate is not None
    assert record.candidate.id == "7"
    assert record.artwork is not None


async def test_emits_the_resolved_track_then_the_url_progress(tmp_path: Path) -> None:
    api = FakeApi()
    _bandcamp_found(api)
    events: list[UrlRecoveryEvent] = []

    async with _recovering(one_track(tmp_path), api, events) as (opened, recovery):
        await recovery.resolve(ONE_TRACK, BANDCAMP_URL)

        record = opened.live.record(ONE_TRACK)
    assert record is not None
    assert events == [TrackResolved(record), UrlProgress(processed=1, total=1)]


@pytest.mark.parametrize(
    ("second_url", "source", "candidate_id"),
    [(BEATPORT_URL, Source.BEATPORT, "22708005"), (BANDCAMP_URL, Source.BANDCAMP, "7")],
    ids=["other-source", "same-url"],
)
async def test_replaces_a_track_already_resolved_by_url(
    tmp_path: Path, second_url: str, source: Source, candidate_id: str
) -> None:
    api = FakeApi()
    _bandcamp_found(api)
    api.on("/beatport/tracks/22708005", "*", ok(ON_BEATPORT))

    async with _recovering(one_track(tmp_path), api) as (opened, recovery):
        await recovery.resolve(ONE_TRACK, BANDCAMP_URL)

        await recovery.resolve(ONE_TRACK, second_url)

        record = opened.live.record(ONE_TRACK)
        progress = recovery.progress()
    assert record is not None
    assert (record.resolution, record.source) == (Resolution.URL, source)
    assert record.candidate is not None
    assert record.candidate.id == candidate_id
    assert progress == UrlProgress(processed=1, total=1)


async def test_counts_recovered_tracks_over_tracks_to_recover(tmp_path: Path) -> None:
    api = FakeApi()
    _bandcamp_found(api)

    async with _recovering(three_tracks(tmp_path), api) as (_opened, recovery):
        before = recovery.progress()
        await recovery.resolve("a.mp3", BANDCAMP_URL)
        after = recovery.progress()

    assert (before, after) == (UrlProgress(0, 3), UrlProgress(1, 3))


async def test_grows_the_total_when_a_late_refusal_leaves_a_track_unresolved(
    tmp_path: Path,
) -> None:
    """Un refus d'arbitrage apres la phase reseau entre dans le total au prochain calcul."""
    api = FakeApi()
    _bandcamp_found(api)

    async with _recovering(three_tracks(tmp_path), api) as (opened, recovery):
        late = opened.live.record("c.mp3")
        assert late is not None
        opened.live.update(_awaiting(late))
        await recovery.resolve("a.mp3", BANDCAMP_URL)
        before = recovery.progress()

        opened.live.update(_awaiting(late).unresolved(FailureReason.USER_REFUSED))

        after = recovery.progress()
    assert (before, after) == (UrlProgress(1, 2), UrlProgress(1, 3))


async def test_counts_zero_over_zero_when_nothing_is_left_to_recover(tmp_path: Path) -> None:
    api = FakeApi()
    api.on("/beatport/search", YOUR_MIND, found(ORIGINAL))

    async with _recovering(one_track(tmp_path), api) as (_opened, recovery):
        progress = recovery.progress()

    assert progress == UrlProgress(0, 0)
```

Ajouter aussi, juste après `_bandcamp_found`, la fabrique d'un morceau en attente d'arbitrage, reprise en Task 2 :

```python
def _awaiting(record: TrackRecord) -> TrackRecord:
    """Morceau mis en zone grise : ni etat, ni motif, une liste a trancher."""
    return replace(
        record,
        state=None,
        resolution=None,
        failure_reason=None,
        arbitration=PendingArbitration(Source.BEATPORT, (scored_candidate(),), False),
    )
```

avec les imports `from dataclasses import replace`, `from tagging_records import scored_candidate`, `PendingArbitration` ajouté à l'import de `tagger.tagging`, et `TrackRecord` sous `TYPE_CHECKING` (`from tagger.tagging import TrackRecord`).

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_url_recovery.py -q`
Expected: FAIL à la collecte, `ModuleNotFoundError: No module named 'tagger.url_recovery'`.

- [ ] **Step 3: Rendre le score optionnel et effacer le motif d'échec**

Dans `sidecar/src/tagger/tagging.py`, remplacer `TrackRecord.resolved` :

```python
    def resolved(
        self,
        resolution: Resolution,
        source: Source,
        candidate: TrackCandidate,
        scored: ScoredCandidate | None,
        artwork: Path | None,
    ) -> TrackRecord:
        """Morceau resolu, sorti de l'attente d'arbitrage s'il y etait.

        `scored` nul : une URL collee n'a traverse aucun scoring. Le motif d'echec tombe,
        un non resolu rattrape ne doit pas garder son `no_result`.
        """
        return replace(
            self,
            state=TrackState.RESOLVED,
            resolution=resolution,
            failure_reason=None,
            source=source,
            candidate=candidate,
            scored=scored,
            artwork=artwork,
            arbitration=None,
        )
```

- [ ] **Step 4: Ajouter `RunSources.from_url`**

Dans `sidecar/src/tagger/sources.py`, après `retained` :

```python
    async def from_url(self, position: int, url: str) -> tuple[TrackCandidate, Path | None]:
        """Morceau designe par une URL collee et sa pochette ; seule la pochette peut manquer.

        L'appel passe par `_call` : la garde des 403 du run compte aussi ces gestes.
        """
        candidate = await self._call(self._client.fetch_by_url(url))
        return candidate, await self._artwork(position, candidate)
```

- [ ] **Step 5: Créer `url_recovery.py`**

Créer `sidecar/src/tagger/url_recovery.py` :

```python
"""Rattrapage par URL en fin de run (use-case 4), hors protocole NDJSON : rendu par rappel."""

import logging
from contextlib import contextmanager
from dataclasses import dataclass
from typing import TYPE_CHECKING, override

from tagger.tagging import Resolution, TrackResolved, TrackState

if TYPE_CHECKING:
    from collections.abc import Callable, Generator

    from tagger.sources import RunSources
    from tagger.tagging import LiveRun, TrackRecord

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class UrlProgress:
    """Morceaux rattrapes par URL sur morceaux a rattraper."""

    processed: int
    total: int


type UrlRecoveryEvent = TrackResolved | UrlProgress


class UrlRecovery:
    """Second geste refuse (pas mis en file) si le premier est deja en vol sur ce morceau :
    des clics rapides lanceraient sinon deux appels reseau."""

    def __init__(
        self,
        live: LiveRun,
        sources: RunSources,
        on_event: Callable[[UrlRecoveryEvent], None],
    ) -> None:
        self._live = live
        self._sources = sources
        self._on_event = on_event
        self._busy: set[str] = set()

    @override
    def __repr__(self) -> str:
        return f"UrlRecovery(run_id={self._live.run_id!r}, busy={len(self._busy)})"

    async def resolve(self, track_id: str, url: str) -> None:
        """Resout le morceau depuis `url` ; un echec laisse le morceau tel qu'il etait."""
        record = self._live.record(track_id)
        if record is None:
            raise LookupError(track_id)
        position = self._live.position(track_id)
        with self._in_flight(track_id):
            candidate, artwork = await self._sources.from_url(position, url)
        logger.info(
            "url recovered run=%s track=%d source=%s status=resolved",
            self._live.run_id,
            position,
            candidate.source,
        )
        resolved = record.resolved(Resolution.URL, candidate.source, candidate, None, artwork)
        self._live.update(resolved)
        self._on_event(TrackResolved(resolved))
        self._on_event(self.progress())

    def progress(self) -> UrlProgress:
        """Calcule et non compte : une correction ne compte pas deux fois, un refus
        d'arbitrage tardif entre dans le total sans compteur a tenir en phase."""
        tracks = self._live.snapshot().tracks
        recovered = sum(1 for record in tracks if _recovered(record))
        waiting = sum(1 for record in tracks if record.state is TrackState.UNRESOLVED)
        return UrlProgress(processed=recovered, total=recovered + waiting)

    @contextmanager
    def _in_flight(self, track_id: str) -> Generator[None]:
        """Marque le morceau occupe le temps d'un appel, annulation comprise."""
        self._busy.add(track_id)
        try:
            yield
        finally:
            self._busy.discard(track_id)


def _recovered(record: TrackRecord) -> bool:
    return record.state is TrackState.RESOLVED and record.resolution is Resolution.URL
```

Le `LookupError` est provisoire : Task 2 le remplace par la garde d'éligibilité.

- [ ] **Step 6: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_url_recovery.py tests/unit/test_arbitration_gestures.py tests/unit/test_tagging_live_run.py -q`
Expected: PASS, les gestes d'arbitrage compris (`resolved` garde sa sémantique pour eux).

- [ ] **Step 7: Lancer le gate**

Run: `just lint-sidecar && just typecheck-sidecar && just test-sidecar`
Expected: tout vert.

- [ ] **Step 8: Commit**

```bash
git add sidecar/src/tagger/url_recovery.py sidecar/src/tagger/sources.py sidecar/src/tagger/tagging.py sidecar/tests/unit/test_url_recovery.py
git commit -m "feat(sidecar): rattraper par URL un morceau non résolu du run vivant"
```

---

## Task 2: Éligibilité et geste en vol

**Files:**
- Modify: `sidecar/src/tagger/url_recovery.py`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`
- Test: `sidecar/tests/unit/test_url_recovery.py`

**Interfaces:**
- Consumes: `UrlRecovery`, `_awaiting` (Task 1) ; `TaggerError` (`tagger.errors`) ; `track_candidate` (`scraper_responses`), `scored_candidate` (`tagging_records`) ; `FakeApi.gate`, `cancelled` (`tagging_api`).
- Produces:
  - `url_recovery.UrlRecoveryError(TaggerError)`, `code = "url_recovery_error"`, `__init__(self, message: str, track_id: str)`
  - `url_recovery.UrlRecoveryNotEligibleError(UrlRecoveryError)`, `code = "url_recovery_not_eligible"`, `__init__(self, track_id: str)`
  - `url_recovery.UrlRecoveryBusyError(UrlRecoveryError)`, `code = "url_recovery_busy"`, `__init__(self, track_id: str)`

- [ ] **Step 1: Écrire les tests d'éligibilité et de geste en vol**

Dans `sidecar/tests/unit/test_url_recovery.py`, ajouter `import asyncio` aux imports, `track_candidate` à l'import de `scraper_responses`, `cancelled` à celui de `tagging_api`, `UrlRecoveryBusyError` et `UrlRecoveryNotEligibleError` à celui de `tagger.url_recovery`, puis à la fin :

```python
def _auto(record: TrackRecord) -> TrackRecord:
    return record.resolved(
        Resolution.AUTO, Source.BEATPORT, track_candidate(), scored_candidate(), None
    )


def _arbitrated(record: TrackRecord) -> TrackRecord:
    return record.resolved(
        Resolution.ARBITRATION, Source.BEATPORT, track_candidate(), scored_candidate(), None
    )


def _not_processed(record: TrackRecord) -> TrackRecord:
    """Morceau jamais atteint par un run interrompu : ni etat, ni attente."""
    return replace(record, state=None, resolution=None, failure_reason=None)


@pytest.mark.parametrize(
    "into",
    [_auto, _arbitrated, _awaiting, _not_processed],
    ids=["auto", "arbitration", "awaiting-arbitration", "not-processed"],
)
async def test_refuses_a_track_that_is_not_eligible_without_any_request(
    tmp_path: Path, into: Callable[[TrackRecord], TrackRecord]
) -> None:
    api = FakeApi()
    _bandcamp_found(api)

    async with _recovering(one_track(tmp_path), api) as (opened, recovery):
        record = opened.live.record(ONE_TRACK)
        assert record is not None
        opened.live.update(into(record))
        calls = len(api.requests)

        with pytest.raises(UrlRecoveryNotEligibleError) as refusal:
            await recovery.resolve(ONE_TRACK, BANDCAMP_URL)

        assert len(api.requests) == calls
    assert refusal.value.params == {"track_id": ONE_TRACK}


async def test_refuses_a_track_unknown_to_the_run(tmp_path: Path) -> None:
    async with _recovering(one_track(tmp_path), FakeApi()) as (_opened, recovery):
        with pytest.raises(UrlRecoveryNotEligibleError):
            await recovery.resolve("unknown.mp3", BANDCAMP_URL)


async def test_refuses_a_second_gesture_in_flight_on_the_same_track(tmp_path: Path) -> None:
    api = FakeApi()
    _bandcamp_found(api)
    fetch = api.gate("/bandcamp/tracks", BANDCAMP_URL)

    async with _recovering(one_track(tmp_path), api) as (opened, recovery):
        first = asyncio.create_task(recovery.resolve(ONE_TRACK, BANDCAMP_URL), name="first")
        await fetch.reached.wait()
        calls = len(api.requests)

        with pytest.raises(UrlRecoveryBusyError) as refusal:
            await recovery.resolve(ONE_TRACK, BEATPORT_URL)

        assert len(api.requests) == calls
        fetch.release.set()
        await first
        record = opened.live.record(ONE_TRACK)
    assert refusal.value.params == {"track_id": ONE_TRACK}
    assert record is not None
    assert record.source is Source.BANDCAMP


async def test_releases_the_track_when_the_gesture_is_cancelled(tmp_path: Path) -> None:
    api = FakeApi()
    _bandcamp_found(api)
    fetch = api.gate("/bandcamp/tracks", BANDCAMP_URL)

    async with _recovering(one_track(tmp_path), api) as (opened, recovery):
        before = opened.live.record(ONE_TRACK)
        gesture = asyncio.create_task(recovery.resolve(ONE_TRACK, BANDCAMP_URL), name="gesture")
        await fetch.reached.wait()

        await cancelled(gesture)

        assert opened.live.record(ONE_TRACK) == before
        fetch.release.set()
        await recovery.resolve(ONE_TRACK, BANDCAMP_URL)
        after = opened.live.record(ONE_TRACK)
    assert after is not None
    assert after.resolution is Resolution.URL
```

avec `Callable` ajouté sous `TYPE_CHECKING` (`from collections.abc import AsyncGenerator, Callable`).

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_url_recovery.py -q`
Expected: FAIL à la collecte, `ImportError: cannot import name 'UrlRecoveryBusyError'`.

- [ ] **Step 3: Ajouter les erreurs**

Dans `sidecar/src/tagger/url_recovery.py`, ajouter `ClassVar` à l'import de `typing`, `from tagger.errors import TaggerError`, puis après `UrlRecoveryEvent` :

```python
class UrlRecoveryError(TaggerError):
    code: ClassVar[str] = "url_recovery_error"

    def __init__(self, message: str, track_id: str) -> None:
        super().__init__(message, track_id=track_id)


class UrlRecoveryNotEligibleError(UrlRecoveryError):
    """Morceau inconnu du run, resolu autrement que par URL, en arbitrage ou jamais traite."""

    code: ClassVar[str] = "url_recovery_not_eligible"

    def __init__(self, track_id: str) -> None:
        super().__init__("track not eligible for url recovery", track_id)


class UrlRecoveryBusyError(UrlRecoveryError):
    code: ClassVar[str] = "url_recovery_busy"

    def __init__(self, track_id: str) -> None:
        super().__init__("a url is already being resolved for this track", track_id)
```

- [ ] **Step 4: Garder l'éligibilité et le geste en vol**

Dans `UrlRecovery.resolve`, remplacer les trois premières lignes (`record = ...`, `if record is None:` et `raise LookupError(...)`) par :

```python
        record = self._eligible(track_id)
```

et ajouter dans la classe, avant `_in_flight` :

```python
    def _eligible(self, track_id: str) -> TrackRecord:
        """Non resolu, ou deja resolu par URL : recoller corrige un mauvais lien."""
        if track_id in self._busy:
            raise UrlRecoveryBusyError(track_id)
        record = self._live.record(track_id)
        if record is None or not (record.state is TrackState.UNRESOLVED or _recovered(record)):
            raise UrlRecoveryNotEligibleError(track_id)
        return record
```

- [ ] **Step 5: Vérifier que la traduction manque**

Run: `cd sidecar && uv run pytest tests/unit/test_url_recovery.py tests/unit/test_error_translations.py -q`
Expected: `test_url_recovery.py` passe, `test_error_translations.py` échoue sur les trois codes `url_recovery_*`.

- [ ] **Step 6: Ajouter les traductions**

Dans `public/i18n/fr.json`, section `errors`, ajouter une virgule après la ligne `"arbitration_busy"` puis :

```json
    "url_recovery_error": "Le lien n'a pas pu être résolu. Réessayez.",
    "url_recovery_not_eligible": "Ce morceau a déjà une correspondance et n'attend plus de lien.",
    "url_recovery_busy": "Un lien est déjà en cours de résolution pour ce morceau. Patientez un instant."
```

Dans `public/i18n/en.json`, même emplacement :

```json
    "url_recovery_error": "The link could not be resolved. Try again.",
    "url_recovery_not_eligible": "This track already has a match and no longer takes a link.",
    "url_recovery_busy": "A link is already being resolved for this track. Please wait a moment."
```

- [ ] **Step 7: Lancer le gate**

Run: `just lint-sidecar && just typecheck-sidecar && just test-sidecar`
Expected: tout vert.

- [ ] **Step 8: Commit**

```bash
git add sidecar/src/tagger/url_recovery.py sidecar/tests/unit/test_url_recovery.py public/i18n/fr.json public/i18n/en.json
git commit -m "feat(sidecar): refuser un rattrapage par URL non éligible ou déjà en vol"
```

---

## Task 3: Échecs, garde des 403 et logs

**Files:**
- Modify: `sidecar/src/tagger/url_recovery.py`
- Test: `sidecar/tests/unit/test_url_recovery.py`

**Interfaces:**
- Consumes: `UrlRecovery`, `_recovering`, `_bandcamp_found` (Tasks 1 et 2) ; `ScraperError`, `UnsupportedTrackUrlError`, `TrackNotFoundError`, `SourceUnavailableError`, `ApiKeyRejectedError` (`tagger.scraper_client`) ; `ApiKeyRejectedRunError` (`tagger.sources`) ; `failing`, `two_tracks` (`tagging_api`).
- Produces: aucune interface nouvelle ; `resolve` logue chaque échec puis le relève.

- [ ] **Step 1: Écrire les tests d'échec**

Dans `sidecar/tests/unit/test_url_recovery.py`, ajouter `import logging`, `failing` et `two_tracks` à l'import de `tagging_api`, `from tagger.scraper_client import ApiContractError, ApiKeyRejectedError, Source, SourceUnavailableError, TrackNotFoundError, UnsupportedTrackUrlError`, `from tagger.sources import ApiKeyRejectedRunError`, puis à la fin :

```python
ARTWORK = "https://geo-media.beatport.com/image_size/500x500/cover.jpg"


@pytest.mark.parametrize(
    ("status", "url", "error"),
    [
        (None, "https://www.youtube.com/watch?v=abc", UnsupportedTrackUrlError),
        (None, BANDCAMP_URL, TrackNotFoundError),
        (503, BANDCAMP_URL, SourceUnavailableError),
    ],
    ids=["unsupported-url", "track-not-found", "source-unavailable"],
)
async def test_keeps_the_track_untouched_and_emits_nothing_when_the_url_fails(
    tmp_path: Path, status: int | None, url: str, error: type[Exception]
) -> None:
    """Sans reponse enregistree, `FakeApi` rend 404 sur `/bandcamp/tracks`."""
    api = FakeApi()
    if status is not None:
        api.on("/bandcamp/tracks", BANDCAMP_URL, failing(status, "source_unavailable"))
    events: list[UrlRecoveryEvent] = []

    async with _recovering(one_track(tmp_path), api, events) as (opened, recovery):
        before = opened.live.record(ONE_TRACK)

        with pytest.raises(error):
            await recovery.resolve(ONE_TRACK, url)

        assert opened.live.record(ONE_TRACK) == before
    assert before is not None
    assert before.failure_reason is FailureReason.NO_RESULT
    assert events == []


async def test_keeps_the_previous_url_when_a_correction_fails(tmp_path: Path) -> None:
    api = FakeApi()
    _bandcamp_found(api)

    async with _recovering(one_track(tmp_path), api) as (opened, recovery):
        await recovery.resolve(ONE_TRACK, BANDCAMP_URL)
        before = opened.live.record(ONE_TRACK)

        with pytest.raises(TrackNotFoundError):
            await recovery.resolve(ONE_TRACK, BEATPORT_URL)

        assert opened.live.record(ONE_TRACK) == before


async def test_resolves_the_track_without_artwork_when_the_artwork_download_fails(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    _bandcamp_found(api)
    cdn = FakeCdn()
    cdn.refused.add(ARTWORK)

    async with _recovering(one_track(tmp_path), api, cdn=cdn) as (opened, recovery):
        await recovery.resolve(ONE_TRACK, BANDCAMP_URL)

        record = opened.live.record(ONE_TRACK)
    assert record is not None
    assert (record.state, record.artwork) == (TrackState.RESOLVED, None)


async def test_stops_on_the_third_consecutive_api_key_rejection_across_gestures(
    tmp_path: Path,
) -> None:
    """La garde des 403 est celle du run : les gestes URL la partagent."""
    api = FakeApi()
    api.on("/bandcamp/tracks", "*", failing(403))

    async with _recovering(three_tracks(tmp_path), api) as (_opened, recovery):
        for track_id in ("a.mp3", "b.mp3"):
            with pytest.raises(ApiKeyRejectedError):
                await recovery.resolve(track_id, BANDCAMP_URL)

        with pytest.raises(ApiKeyRejectedRunError):
            await recovery.resolve("c.mp3", BANDCAMP_URL)


async def test_releases_the_track_after_a_failed_gesture(tmp_path: Path) -> None:
    api = FakeApi()
    broken = ON_BANDCAMP | {"title": None}
    api.on("/bandcamp/tracks", BANDCAMP_URL, ok(broken))

    async with _recovering(one_track(tmp_path), api) as (opened, recovery):
        with pytest.raises(ApiContractError):
            await recovery.resolve(ONE_TRACK, BANDCAMP_URL)
        _bandcamp_found(api)

        await recovery.resolve(ONE_TRACK, BANDCAMP_URL)

        record = opened.live.record(ONE_TRACK)
    assert record is not None
    assert record.resolution is Resolution.URL


async def test_never_logs_the_pasted_url(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    """Le slug nomme l'artiste et le morceau : rien de l'URL dans les logs du module."""
    api = FakeApi()
    _bandcamp_found(api)
    caplog.set_level(logging.INFO, logger="tagger.url_recovery")

    async with _recovering(two_tracks(tmp_path), api) as (_opened, recovery):
        await recovery.resolve("a.mp3", BANDCAMP_URL)
        with pytest.raises(TrackNotFoundError):
            await recovery.resolve("b.mp3", "https://amelielens.bandcamp.com/track/unknown")

    ours = [record.getMessage() for record in caplog.records if record.name == "tagger.url_recovery"]
    assert len(ours) == 2
    assert not any("bandcamp.com" in message for message in ours)
```

`test_releases_the_track_after_a_failed_gesture` repose sur `FakeApi.on` qui remplace la réponse enregistrée pour la même route : le second appel reçoit le `Track` valide. Un `title` nul ne valide pas `TrackCandidate`, d'où l'`ApiContractError`.

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_url_recovery.py -q`
Expected: `test_never_logs_the_pasted_url` échoue (un seul message, celui du succès) ; les autres passent déjà, la garde et l'absence de modification découlant de Task 1 et 2.

- [ ] **Step 3: Loguer l'échec**

Dans `sidecar/src/tagger/url_recovery.py`, importer `from tagger.scraper_client import ScraperError` et entourer l'appel réseau de `resolve` :

```python
        with self._in_flight(track_id):
            try:
                candidate, artwork = await self._sources.from_url(position, url)
            except TaggerError as exc:
                logger.warning(
                    "url recovery failed run=%s track=%d status=unresolved reason=%s request_id=%s",
                    self._live.run_id,
                    position,
                    exc.code,
                    exc.request_id if isinstance(exc, ScraperError) else "",
                )
                raise
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_url_recovery.py -q`
Expected: PASS.

- [ ] **Step 5: Lancer le gate**

Run: `just lint-sidecar && just typecheck-sidecar && just test-sidecar`
Expected: tout vert, couverture ≥ 80 %.

- [ ] **Step 6: Commit**

```bash
git add sidecar/src/tagger/url_recovery.py sidecar/tests/unit/test_url_recovery.py
git commit -m "feat(sidecar): laisser intact un morceau dont l'URL échoue et le loguer sans l'URL"
```

---

## Task 4: ARCHITECTURE.md

**Files:**
- Modify: `docs/ARCHITECTURE.md` (use-case 4, § Concurrence)

**Interfaces:**
- Consumes: règles livrées par les Tasks 1 à 3.
- Produces: aucune interface de code.

- [ ] **Step 1: Mettre à jour la doc**

Charger `Skill[architecture-doc]` et lire ses règles, puis dans `docs/ARCHITECTURE.md` :

- **Use-case 4 : Rattrapage par URL**, après le paragraphe sur les voies par source : un morceau `unresolved` accepte une URL, un morceau déjà résolu par URL aussi (recoller remplace l'URL précédente, pour corriger un mauvais lien avant l'écriture) ; les morceaux résolus automatiquement, par arbitrage ou jamais traités n'en acceptent pas. La barre de la phase compte les morceaux rattrapés sur les morceaux à rattraper (non résolus + rattrapés), calculés sur l'état du run : une correction ne compte pas deux fois, un refus d'arbitrage tardif grossit le total. Un morceau rattrapé n'a pas de score. Décisions du propriétaire du 2026-10-02.
- **§ Concurrence**, après le paragraphe sur la file d'arbitrage : les gestes de rattrapage vivent eux aussi dans le run vivant, partagent les sémaphores du client et la garde des 403 du run ; un seul geste est en vol par morceau, le second est refusé en `url_recovery_busy`.

- [ ] **Step 2: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs(sidecar): morceaux éligibles et progression du rattrapage par URL"
```
