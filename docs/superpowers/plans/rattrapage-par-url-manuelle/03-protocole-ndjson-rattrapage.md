# Protocole NDJSON du rattrapage par URL : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exposer le rattrapage par URL sur le protocole NDJSON par la commande `resolve_by_url`, l'ouverture de sa phase et sa progression.

**Architecture:** `protocol.py` gagne `ResolveByUrl` et un `track_id` optionnel dans `error_from_business`. `handlers.py` porte une `UrlRecovery` dans `CurrentRun`, traduit `UrlProgress` en `progress(url_recovery)` et fait suivre `run_finished(network)` de cette progression. `__main__.py` lance le geste en tâche de fond une fois la phase ouverte (run courant dont la phase réseau ne tourne plus), joint `track_id` aux erreurs d'un geste, émet la progression après un `cancel_run` qui a interrompu la phase réseau et après chaque geste d'arbitrage hors phase réseau. `protocol.ts` gagne la commande en miroir.

**Tech Stack:** Python 3.14 (`asyncio.TaskGroup`, `functools.partial`), pydantic 2 (commande stricte, `extra="forbid"`), pytest + pytest-asyncio, `ndjson_loop.conversation`, TypeScript pour le miroir. Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/rattrapage-par-url-manuelle/03-protocole-ndjson-rattrapage-design.md`

## Global Constraints

- **Dépend du sub-project 02, implémenté avant** : `tagger.url_recovery.UrlRecovery(live, sources, on_event)` (`async resolve(track_id, url) -> None`, `progress() -> UrlProgress`), `UrlProgress(processed, total)`, `UrlRecoveryEvent = TrackResolved | UrlProgress`, `UrlRecoveryError(message, track_id)`, codes `url_recovery_*` déjà traduits sauf `url_recovery_not_open`.
- **Commande** : `resolve_by_url` = `track_id` (chaîne), `url` (chaîne non vide), stricte, sans champ en trop.
- **Phase ouverte** ⇔ run courant adopté **et** phase réseau non active (`_active_run() is None`). Sinon `url_recovery_not_open`, `params.track_id`.
- **Progression `url_recovery`** : après `run_finished(network)` ; après un `cancel_run` qui a interrompu une phase réseau d'un run courant ; après chaque rattrapage réussi (émise par `UrlRecovery`) ; après chaque geste d'arbitrage hors phase réseau. Jamais pendant la phase réseau.
- **Erreur d'un geste** (`resolve_arbitration`, `resolve_by_url`) : `command` et `params.track_id`, y compris pour les erreurs du client.
- **`cancel_run` sans run en cours** : toujours aucun événement.
- **Code Python sans accents**, docstrings et commentaires en français, le pourquoi seulement.
- **Tests** : noms en anglais, AAA séparé par des lignes vides, jamais de réseau réel ; chaque attente d'intégration bornée par `ndjson_loop` (10 s).
- **Gate vert à chaque commit** : `just lint-sidecar`, `just typecheck-sidecar`, `just test-sidecar`, plus `just lint-ui` et `just typecheck-ui` quand `protocol.ts` change. Commits `type(scope): description`, scope `sidecar`.

## Review Focus

- **`resolve_by_url` arrivé pendant l'ouverture d'un nouveau run** (`self._current` remis à `None` par `start_tagging`) : refusé en `url_recovery_not_open`, jamais appliqué à l'ancien run (Task 1, `test_cancels_a_url_gesture_in_flight_when_a_new_run_starts`).
- **`cancel_run` après la fin de la phase réseau** : aucune progression en double, la phase était déjà ouverte (Task 2, `test_emits_nothing_when_cancelling_a_finished_run`).
- **Erreur d'arbitrage qui portait déjà `track_id`** : la jointure ne change rien (Task 2, `test_joins_the_track_to_the_error_of_a_gesture`, cas `already-carried`).
- **Séquence d'un run terminé** : `run_finished` reste suivi d'une seule `progress(url_recovery)`, les tests existants qui lisaient `run_finished` en dernier sont réalignés (Task 2, Step 7).
- **Annulation d'un geste d'arbitrage en vol par un nouveau run** : aucune progression ne sort pour l'ancien run (Task 2, couvert par `test_cancels_a_refusal_in_flight_when_a_new_run_starts`, inchangé).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `sidecar/src/tagger/protocol.py` | `ResolveByUrl`, unions, `CommandName`, `error_from_business(..., track_id)`. |
| `sidecar/src/tagger/url_recovery.py` | `UrlRecoveryNotOpenError`. |
| `sidecar/src/tagger/handlers.py` | `CurrentRun.url_recovery`, `open_tagging`, `_relay`, `to_protocol_event`, `url_progress`, `handle_start_tagging`. |
| `sidecar/src/tagger/__main__.py` | `_Session.resolve_by_url`, `_recoverable`, `cancel_run`, progression après arbitrage, `_gesture_track`, dispatch. |
| `src/app/core/models/protocol.ts` | `ResolveByUrlCommand`. |
| `sidecar/tests/unit/test_protocol_url_recovery.py` | Modèle, traduction, jointure du `track_id`. |
| `sidecar/tests/integration/test_ndjson_url_recovery.py` | Conversation de bout en bout. |
| `sidecar/tests/unit/test_handlers.py` | `CurrentRun` construit avec sa `UrlRecovery`. |
| `sidecar/tests/integration/test_ndjson_tagging.py` | Séquence de fin de run réalignée. |
| `public/i18n/fr.json`, `public/i18n/en.json` | `url_recovery_not_open`. |
| `docs/ARCHITECTURE.md` | § API. |

---

## Task 1: Commande `resolve_by_url` sur la boucle

**Files:**
- Modify: `sidecar/src/tagger/protocol.py`
- Modify: `sidecar/src/tagger/url_recovery.py`
- Modify: `sidecar/src/tagger/handlers.py` (`CurrentRun`, `open_tagging`, `_relay`, `to_protocol_event`)
- Modify: `sidecar/src/tagger/__main__.py`
- Modify: `src/app/core/models/protocol.ts`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`
- Modify: `sidecar/tests/unit/test_handlers.py`
- Test: `sidecar/tests/unit/test_protocol_url_recovery.py` (création), `sidecar/tests/integration/test_ndjson_url_recovery.py` (création)

**Interfaces:**
- Consumes: `UrlRecovery`, `UrlProgress`, `UrlRecoveryEvent`, `UrlRecoveryError` (sub-project 02) ; helpers `conversation` (`ndjson_loop`), `FakeApi`, `ok`, `found`, `ONE_TRACK`, `ORIGINAL`, `one_track` (`tagging_api`), `track_payload`, `YOUR_MIND` (`scraper_responses`), fixtures `api`, `app_data`, `_key` (`conftest.py`).
- Produces:
  - `protocol.ResolveByUrl(Command)` : `command: Literal["resolve_by_url"]`, `track_id: str`, `url: Annotated[str, Field(min_length=1)]`, membre d'`AnyCommand`, `ExecutableCommand`, `CommandName`
  - `url_recovery.UrlRecoveryNotOpenError(UrlRecoveryError)`, `code = "url_recovery_not_open"`, `__init__(self, track_id: str)`
  - `handlers.CurrentRun(stack, live, sources, arbitration, url_recovery)`, attribut `url_recovery: UrlRecovery`
  - `handlers.to_protocol_event(event: tagging.RunEvent | ArbitrationEvent | UrlRecoveryEvent) -> Event`
  - `__main__._Session.resolve_by_url(command: ResolveByUrl) -> None`, `_Session._recoverable(track_id: str) -> CurrentRun`
  - TS `ResolveByUrlCommand`, membre de `SidecarCommand`

- [ ] **Step 1: Écrire les tests du modèle et de la traduction**

Créer `sidecar/tests/unit/test_protocol_url_recovery.py` :

```python
"""Tests du modele et de la traduction du rattrapage par URL sur le protocole NDJSON."""

import pytest
from pydantic import ValidationError

from tagger.handlers import to_protocol_event
from tagger.protocol import Phase, Progress, ResolveByUrl, parse_command
from tagger.url_recovery import UrlProgress

URL = "https://amelielens.bandcamp.com/track/basiel"


def _resolve(fields: str) -> str:
    return '{"command":"resolve_by_url",' + fields + "}"


def test_accepts_a_url_recovery_command() -> None:
    command = parse_command(_resolve(f'"track_id":"a.mp3","url":"{URL}"'))

    assert command == ResolveByUrl(command="resolve_by_url", track_id="a.mp3", url=URL)


@pytest.mark.parametrize(
    "fields",
    [
        '"track_id":"a.mp3"',
        '"track_id":"a.mp3","url":""',
        '"track_id":"a.mp3","url":42',
        f'"track_id":"a.mp3","url":"{URL}","source":"bandcamp"',
    ],
    ids=["missing-url", "empty-url", "numeric-url", "extra-field"],
)
def test_rejects_a_malformed_url_recovery_command(fields: str) -> None:
    with pytest.raises(ValidationError):
        parse_command(_resolve(fields))


def test_translates_the_url_progress_into_a_url_recovery_progress() -> None:
    event = to_protocol_event(UrlProgress(processed=1, total=3))

    assert event == Progress(event="progress", phase=Phase.URL_RECOVERY, processed=1, total=3)
```

- [ ] **Step 2: Écrire les tests d'intégration du geste**

Créer `sidecar/tests/integration/test_ndjson_url_recovery.py` :

```python
"""Protocole NDJSON du rattrapage par URL, de bout en bout sur la boucle."""

from typing import TYPE_CHECKING

import pytest
from ndjson_loop import conversation
from scraper_responses import YOUR_MIND, track_payload
from tagging_api import ONE_TRACK, ORIGINAL, FakeApi, found, ok, one_track

if TYPE_CHECKING:
    from pathlib import Path

pytestmark = [pytest.mark.asyncio, pytest.mark.usefixtures("_key")]

BANDCAMP_URL = "https://amelielens.bandcamp.com/track/basiel"
ON_BANDCAMP = track_payload(id="7", source="bandcamp", mix_name=None, url=BANDCAMP_URL)


@pytest.fixture
def folder(tmp_path: Path, app_data: None) -> Path:
    """Un morceau que ni Beatport ni Bandcamp ne trouvent : il finit `unresolved`."""
    return one_track(tmp_path)


@pytest.fixture
def empty(tmp_path: Path) -> Path:
    """Dossier sans morceau : le run qui le vise se termine aussitot."""
    folder = tmp_path / "empty"
    folder.mkdir()
    return folder


@pytest.fixture
def api(api: FakeApi) -> FakeApi:
    """L'URL Bandcamp collee designe un morceau connu de l'API."""
    api.on("/bandcamp/tracks", BANDCAMP_URL, ok(ON_BANDCAMP))
    return api


def _start(folder: Path) -> dict[str, object]:
    return {"command": "start_tagging", "folder": str(folder)}


def _recover(url: str = BANDCAMP_URL, track_id: str = ONE_TRACK) -> dict[str, object]:
    return {"command": "resolve_by_url", "track_id": track_id, "url": url}


async def test_resolves_a_track_by_url_end_to_end(folder: Path, api: FakeApi) -> None:
    async with conversation() as talk:
        talk.send(**_start(folder))
        await talk.expect("run_finished")
        talk.send(**_recover())
        resolved = await talk.expect("track_resolved", track_id=ONE_TRACK, resolution="url")
        progress = await talk.expect("progress", phase="url_recovery")

    assert (resolved["state"], resolved["source"], resolved["scores"]) == (
        "resolved",
        "bandcamp",
        None,
    )
    assert (progress["processed"], progress["total"]) == (1, 1)


async def test_reports_a_track_that_is_not_eligible_with_its_command_and_its_track(
    folder: Path, api: FakeApi
) -> None:
    api.on("/beatport/search", YOUR_MIND, found(ORIGINAL))

    async with conversation() as talk:
        talk.send(**_start(folder))
        await talk.expect("run_finished")
        talk.send(**_recover())
        error = await talk.expect("error")

    assert (error["code"], error["command"], error["params"]) == (
        "url_recovery_not_eligible",
        "resolve_by_url",
        {"track_id": ONE_TRACK},
    )


async def test_refuses_a_url_before_any_run() -> None:
    async with conversation() as talk:
        talk.send(**_recover())
        error = await talk.expect("error")

    assert (error["code"], error["command"], error["params"]) == (
        "url_recovery_not_open",
        "resolve_by_url",
        {"track_id": ONE_TRACK},
    )


async def test_refuses_a_url_while_the_network_phase_is_running(
    folder: Path, api: FakeApi
) -> None:
    slow = api.gate("/beatport/search", YOUR_MIND)

    async with conversation() as talk:
        talk.send(**_start(folder))
        await slow.reached.wait()
        talk.send(**_recover())
        error = await talk.expect("error")
        slow.release.set()
        await talk.expect("run_finished")

    assert error["code"] == "url_recovery_not_open"


async def test_cancels_a_url_gesture_in_flight_when_a_new_run_starts(
    folder: Path, empty: Path, api: FakeApi
) -> None:
    fetch = api.gate("/bandcamp/tracks", BANDCAMP_URL)

    async with conversation() as talk:
        talk.send(**_start(folder))
        await talk.expect("run_finished")
        talk.send(**_recover())
        await fetch.reached.wait()
        talk.send(**_start(empty))
        talk.send(**_recover())
        refused = await talk.expect("error")
        await talk.expect("run_finished")

    assert refused["code"] == "url_recovery_not_open"
    assert all(event.get("resolution") != "url" for event in talk.events)
```

- [ ] **Step 3: Vérifier qu'ils échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_protocol_url_recovery.py tests/integration/test_ndjson_url_recovery.py -q`
Expected: FAIL à la collecte, `ImportError: cannot import name 'ResolveByUrl'`.

- [ ] **Step 4: Déclarer la commande**

Dans `sidecar/src/tagger/protocol.py`, après `SwitchArbitrationSource` :

```python
class ResolveByUrl(Command):
    """URL collee sur un morceau en fin de run ; sa forme est jugee par le client."""

    command: Literal["resolve_by_url"]
    track_id: str
    url: Annotated[str, Field(min_length=1)]
```

Ajouter `| ResolveByUrl` en fin d'union dans `AnyCommand` (avant `Field(discriminator=...)`) et dans `ExecutableCommand`, et `"resolve_by_url",` en fin de `CommandName`.

- [ ] **Step 5: Erreur de phase non ouverte et sa traduction**

Dans `sidecar/src/tagger/url_recovery.py`, après `UrlRecoveryBusyError` :

```python
class UrlRecoveryNotOpenError(UrlRecoveryError):
    """Aucun run courant, ou sa phase reseau tourne encore : le rattrapage vient apres."""

    code: ClassVar[str] = "url_recovery_not_open"

    def __init__(self, track_id: str) -> None:
        super().__init__("url recovery is not open", track_id)
```

Dans `public/i18n/fr.json`, section `errors`, après `"url_recovery_busy"` (virgule ajoutée à la ligne précédente) :

```json
    "url_recovery_not_open": "Le rattrapage par lien s'ouvre à la fin de la recherche."
```

Dans `public/i18n/en.json`, même emplacement :

```json
    "url_recovery_not_open": "Links can be pasted once the search has finished."
```

- [ ] **Step 6: Rattrapage dans le run courant et traduction de sa progression**

Dans `sidecar/src/tagger/handlers.py` :

1. `from tagger import __version__, arbitration, tagging, url_recovery`, `from tagger.url_recovery import UrlRecovery`, et sous `TYPE_CHECKING` `from tagger.url_recovery import UrlRecoveryEvent`.
2. `CurrentRun` :

```python
class CurrentRun:
    """Run arbitrable et rattrapable jusqu'au suivant : `cancel_run` arrete la phase reseau,
    pas les gestes."""

    def __init__(
        self,
        stack: AsyncExitStack,
        live: LiveRun,
        sources: RunSources,
        arbitration: Arbitration,
        url_recovery: UrlRecovery,
    ) -> None:
        self.live = live
        self.sources = sources
        self.arbitration = arbitration
        self.url_recovery = url_recovery
        self._stack = stack
        self._gestures: set[asyncio.Task[None]] = set()
```

3. Fin d'`open_tagging` :

```python
        desk = Arbitration(live, sources, relay)
        recovery = UrlRecovery(live, sources, relay)
        return CurrentRun(stack.pop_all(), live, sources, desk, recovery)
```

4. Élargir `_relay` et `to_protocol_event` à `tagging.RunEvent | ArbitrationEvent | UrlRecoveryEvent` :

```python
def _relay(
    emit: Callable[[Event], None],
) -> Callable[[tagging.RunEvent | ArbitrationEvent | UrlRecoveryEvent], None]:
    return lambda event: emit(to_protocol_event(event))


def to_protocol_event(event: tagging.RunEvent | ArbitrationEvent | UrlRecoveryEvent) -> Event:
    """Traduit un evenement pipeline, arbitrage ou rattrapage ; un cas oublie est une erreur
    de typage."""
```

5. Dans le `match` de `to_protocol_event`, avant `case _:` :

```python
        case url_recovery.UrlProgress():
            return Progress(
                event="progress",
                phase=Phase.URL_RECOVERY,
                processed=event.processed,
                total=event.total,
            )
```

- [ ] **Step 7: Geste sur la boucle**

Dans `sidecar/src/tagger/__main__.py` :

1. Imports : `ResolveByUrl` depuis `tagger.protocol`, `from tagger.url_recovery import UrlRecoveryNotOpenError`.
2. Après `switch_arbitration_source` :

```python
    def resolve_by_url(self, command: ResolveByUrl) -> None:
        """Geste en tache de fond, comme l'arbitrage : l'appel a l'API ne gele pas stdin."""
        current = self._recoverable(command.track_id)
        start_gesture = functools.partial(
            current.url_recovery.resolve, command.track_id, command.url
        )
        current.track(
            self._group.create_task(self._phase(start_gesture, command), name="url_recovery")
        )
```

3. Après `_arbitrable` :

```python
    def _recoverable(self, track_id: str) -> CurrentRun:
        """Phase ouverte : un run courant dont la phase reseau ne tourne plus, finie ou
        interrompue (un run interrompu garde son ecriture, donc son rattrapage)."""
        if self._current is None or self._active_run() is not None:
            raise UrlRecoveryNotOpenError(track_id)
        return self._current
```

4. `_phase` : élargir `command` à `StartTagging | ExtractPlaylist | ResolveArbitration | ResolveByUrl`.
5. Dans `_dispatch`, avant `case _:` :

```python
        case ResolveByUrl():
            session.resolve_by_url(command)
```

- [ ] **Step 8: Miroir TypeScript**

Dans `src/app/core/models/protocol.ts`, après `SwitchArbitrationSourceCommand` :

```typescript
export interface ResolveByUrlCommand {
  readonly command: "resolve_by_url"
  readonly track_id: string
  /** URL collee telle quelle : sa forme est jugee par le sidecar. */
  readonly url: string
}
```

et `| ResolveByUrlCommand` en fin de `SidecarCommand`.

- [ ] **Step 9: Construire le run courant des tests avec son rattrapage**

Dans `sidecar/tests/unit/test_handlers.py`, `test_closes_the_client_even_when_closing_is_cancelled` : importer `UrlRecovery` depuis `tagger.url_recovery` et construire

```python
    recovery = UrlRecovery(live, sources, lambda _event: None)
    current = CurrentRun(stack, live, sources, arbitration, recovery)
```

- [ ] **Step 10: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_protocol_url_recovery.py tests/unit/test_protocol_models.py tests/unit/test_handlers.py tests/integration -q`
Expected: PASS, `test_command_name_lists_every_command`, les tests d'arbitrage et de la boucle compris.

- [ ] **Step 11: Lancer le gate**

Run: `just lint-sidecar && just typecheck-sidecar && just test-sidecar && just lint-ui && just typecheck-ui`
Expected: tout vert. Si `typecheck-ui` signale un `switch` ou une table exhaustive sur `SidecarCommand["command"]`, y ajouter `resolve_by_url` sans comportement (le service vient au sub-project 04).

- [ ] **Step 12: Commit**

```bash
git add sidecar/src/tagger/protocol.py sidecar/src/tagger/url_recovery.py sidecar/src/tagger/handlers.py sidecar/src/tagger/__main__.py src/app/core/models/protocol.ts public/i18n/fr.json public/i18n/en.json sidecar/tests/unit/test_protocol_url_recovery.py sidecar/tests/integration/test_ndjson_url_recovery.py sidecar/tests/unit/test_handlers.py
git commit -m "feat(sidecar): rattraper un morceau par resolve_by_url une fois la phase réseau finie"
```

---

## Task 2: Erreurs rattachées, ouverture de la phase et progression

**Files:**
- Modify: `sidecar/src/tagger/protocol.py` (`error_from_business`)
- Modify: `sidecar/src/tagger/handlers.py` (`url_progress`, `handle_start_tagging`)
- Modify: `sidecar/src/tagger/__main__.py` (`_gesture_track`, `_phase`, `_replace`, `cancel_run`, `_settle_run`, `resolve_arbitration`)
- Modify: `sidecar/tests/integration/test_ndjson_tagging.py`
- Test: `sidecar/tests/unit/test_protocol_url_recovery.py`, `sidecar/tests/integration/test_ndjson_url_recovery.py`

**Interfaces:**
- Consumes: `ResolveByUrl`, `CurrentRun.url_recovery`, `to_protocol_event`, `_Session._recoverable` (Task 1) ; `UnsupportedTrackUrlError` (sub-project 01) ; `ArbitrationNotPendingError` (`tagger.arbitration`) ; helpers `hold_on_beatport`, `two_tracks` (`tagging_api`), `BASIEL` (`scraper_responses`).
- Produces:
  - `protocol.error_from_business(exc: TaggerError, command: CommandName, track_id: str | None = None) -> Error`
  - `handlers.url_progress(current: CurrentRun) -> Event`
  - `handlers.handle_start_tagging(command, emit, adopt) -> None` : émet `run_finished` puis la progression
  - `_Session._settle_run(*, cancel: bool) -> bool` : vrai si une phase réseau tournait
  - `_Session._then_url_progress(current: CurrentRun, gesture: Callable[[], Awaitable[None]]) -> Event | None`

- [ ] **Step 1: Écrire les tests de l'erreur d'un geste**

Dans `sidecar/tests/unit/test_protocol_url_recovery.py`, ajouter `from tagger.arbitration import ArbitrationNotPendingError`, `from tagger.scraper_client import UnsupportedTrackUrlError`, `error_from_business` à l'import de `tagger.protocol`, puis :

```python
@pytest.mark.parametrize(
    "error",
    [UnsupportedTrackUrlError(), ArbitrationNotPendingError("a.mp3")],
    ids=["client-error", "already-carried"],
)
def test_joins_the_track_to_the_error_of_a_gesture(
    error: UnsupportedTrackUrlError | ArbitrationNotPendingError,
) -> None:
    event = error_from_business(error, "resolve_by_url", "a.mp3")

    assert (event.command, event.params) == ("resolve_by_url", {"track_id": "a.mp3"})


def test_leaves_the_error_of_a_command_without_track_untouched() -> None:
    event = error_from_business(UnsupportedTrackUrlError(), "start_tagging")

    assert (event.code, event.params) == ("unsupported_url", {})
```

- [ ] **Step 2: Écrire les tests d'intégration de la phase**

Dans `sidecar/tests/integration/test_ndjson_url_recovery.py`, ajouter `BASIEL` à l'import de `scraper_responses`, `hold_on_beatport` et `two_tracks` à celui de `tagging_api`, puis :

```python
async def test_opens_the_url_recovery_phase_once_the_network_phase_is_finished(
    folder: Path, api: FakeApi
) -> None:
    async with conversation() as talk:
        talk.send(**_start(folder))
        opened = await talk.expect("progress", phase="url_recovery")

    names = [event["event"] for event in talk.events]
    assert names[-2:] == ["run_finished", "progress"]
    assert (opened["processed"], opened["total"]) == (0, 1)


async def test_reports_a_client_error_with_its_command_and_its_track(
    folder: Path, api: FakeApi
) -> None:
    async with conversation() as talk:
        talk.send(**_start(folder))
        await talk.expect("run_finished")
        talk.send(**_recover("https://www.youtube.com/watch?v=abc"))
        error = await talk.expect("error")

    assert (error["code"], error["command"], error["params"]) == (
        "unsupported_url",
        "resolve_by_url",
        {"track_id": ONE_TRACK},
    )


async def test_opens_the_url_recovery_phase_when_the_run_is_cancelled(
    tmp_path: Path, app_data: None, api: FakeApi
) -> None:
    """Un run interrompu garde son ecriture (spec F2 11), donc son rattrapage."""
    folder = two_tracks(tmp_path)
    slow = api.gate("/beatport/search", BASIEL)

    async with conversation() as talk:
        talk.send(**_start(folder))
        await talk.expect("track_resolved", track_id="a.mp3", state="unresolved")
        await slow.reached.wait()
        talk.send(command="cancel_run")
        opened = await talk.expect("progress", phase="url_recovery")
        talk.send(**_recover(track_id="a.mp3"))
        resolved = await talk.expect("track_resolved", track_id="a.mp3", resolution="url")

    assert (opened["processed"], opened["total"]) == (0, 1)
    assert resolved["state"] == "resolved"
    assert all(event["event"] != "run_finished" for event in talk.events)


async def test_emits_nothing_when_cancelling_a_finished_run(folder: Path, api: FakeApi) -> None:
    async with conversation() as talk:
        talk.send(**_start(folder))
        await talk.expect("progress", phase="url_recovery")
        received = len(talk.events)
        talk.send(command="cancel_run")
        talk.send(command="get_version")
        await talk.expect("version")

    assert [event["event"] for event in talk.events[received:]] == ["version"]


async def test_reports_the_url_progress_after_a_late_arbitration_refusal(
    tmp_path: Path, app_data: None, api: FakeApi
) -> None:
    """« Your Mind » attend un arbitrage, Bandcamp ne trouve rien : deux refus le rendent
    `unresolved` et le total du rattrapage passe de 1 a 2."""
    hold_on_beatport(api)
    folder = two_tracks(tmp_path)

    async with conversation() as talk:
        talk.send(**_start(folder))
        opened = await talk.expect("progress", phase="url_recovery")
        talk.send(command="resolve_arbitration", track_id="a.mp3", source="beatport", candidate=None)
        await talk.expect("arbitration_updated", track_id="a.mp3")
        talk.send(command="resolve_arbitration", track_id="a.mp3", source="bandcamp", candidate=None)
        await talk.expect("track_resolved", track_id="a.mp3", state="unresolved")
        grown = await talk.expect("progress", phase="url_recovery", total=2)

    assert (opened["total"], grown["processed"]) == (1, 0)
```

- [ ] **Step 3: Vérifier qu'ils échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_protocol_url_recovery.py tests/integration/test_ndjson_url_recovery.py -q`
Expected: FAIL : `TypeError` sur le troisième argument d'`error_from_business`, `params` vides sur `unsupported_url`, timeouts sur les attentes de `progress(url_recovery)` ; `test_emits_nothing_when_cancelling_a_finished_run` échoue aussi en timeout, faute de progression à l'ouverture.

- [ ] **Step 4: Joindre le morceau à l'erreur d'un geste**

Dans `sidecar/src/tagger/protocol.py`, remplacer `error_from_business` :

```python
def error_from_business(
    exc: TaggerError, command: CommandName, track_id: str | None = None
) -> Error:
    """Convertit une erreur metier en evenement, en gardant son code et ses params.

    `track_id` : le morceau d'un geste, que les erreurs du client ne portent pas et sans
    lequel l'interface ne saurait sur quelle ligne afficher l'erreur.
    """
    params = dict(exc.params)
    if track_id is not None:
        params["track_id"] = track_id
    return Error(code=exc.code, params=params, message=str(exc), command=command)
```

Dans `sidecar/src/tagger/__main__.py`, le `except` de `_phase` devient :

```python
            self.send(error_from_business(error, command.command, _gesture_track(command)))
```

et, avant `main`, ajouter :

```python
def _gesture_track(
    command: StartTagging | ExtractPlaylist | ResolveArbitration | ResolveByUrl,
) -> str | None:
    """Le morceau d'un geste, joint a son erreur : celles du client ne le portent pas."""
    match command:
        case ResolveArbitration() | ResolveByUrl():
            return command.track_id
        case _:
            return None
```

- [ ] **Step 5: Ouvrir la phase en fin de run**

Dans `sidecar/src/tagger/handlers.py`, après `open_tagging` :

```python
def url_progress(current: CurrentRun) -> Event:
    """Progression du rattrapage, calculee sur l'etat du run a l'instant de l'appel."""
    return to_protocol_event(current.url_recovery.progress())
```

et remplacer `handle_start_tagging` :

```python
async def handle_start_tagging(
    command: StartTagging,
    emit: Callable[[Event], None],
    adopt: Callable[[CurrentRun], None],
) -> None:
    """Confie le run a la session avant la phase reseau : un morceau se tranche des qu'il attend.

    La fin de la phase reseau ouvre le rattrapage : sa progression suit `run_finished`.
    """
    current = await open_tagging(command, emit)
    adopt(current)
    await resolve_run(current.live, current.sources, on_event=_relay(emit))
    emit(_run_finished(current.live.snapshot()))
    emit(url_progress(current))
```

Dans `sidecar/src/tagger/__main__.py`, `_replace` ne rend plus rien :

```python
    async def _replace(self, replaced: CurrentRun | None, command: StartTagging) -> None:
        if replaced is not None:
            await replaced.close()
        await handle_start_tagging(command, self.send, self._adopt)
```

- [ ] **Step 6: Ouvrir la phase sur interruption et suivre les gestes d'arbitrage**

Dans `sidecar/src/tagger/__main__.py`, importer `url_progress` depuis `tagger.handlers`, puis :

```python
    async def cancel_run(self) -> None:
        """`shutdown` n'attend pas la fin d'un run, il l'annule.

        L'extraction est au contraire attendue : le run ne tient que du reseau et de
        la memoire, quand une copie coupee en vol laisserait un fichier a moitie ecrit
        dans la destination de l'utilisateur.

        Une phase reseau interrompue ouvre le rattrapage : sa progression part, sans
        evenement de fin, l'interface sachant qu'elle a demande l'arret.
        """
        interrupted = await self._settle_run(cancel=True)
        if interrupted and self._current is not None:
            self.send(url_progress(self._current))
```

`_settle_run` rend un booléen :

```python
    async def _settle_run(self, *, cancel: bool) -> bool:
        """Attend la fin de la phase reseau en cours, apres l'avoir annulee si `cancel` ;
        vrai si une phase reseau tournait."""
        running = self._active_run()
        if running is None:
            return False
        if cancel:
            running.cancel()
        # Attendu ici (`wait` ne releve pas l'annulation) : une relance trop tot serait
        # refusee en `tagging_in_progress`.
        await asyncio.wait({running})
        return True
```

Dans `resolve_arbitration`, remplacer la création de la tâche par :

```python
        settle = functools.partial(self._then_url_progress, current, start_gesture)
        current.track(self._group.create_task(self._phase(settle, command), name="arbitration"))
```

et ajouter dans `_Session` :

```python
    async def _then_url_progress(
        self, current: CurrentRun, gesture: Callable[[], Awaitable[None]]
    ) -> Event | None:
        """Hors phase reseau, un refus d'arbitrage grossit le total du rattrapage : sa
        progression suit le geste, calculee plutot que comparee a l'emission precedente."""
        await gesture()
        if self._active_run() is not None:
            return None
        return url_progress(current)
```

- [ ] **Step 7: Réaligner les tests qui lisaient `run_finished` en dernier**

Dans `sidecar/tests/integration/test_ndjson_tagging.py` :

- `test_emits_the_whole_sequence_of_a_tagging_run` : `events[1:-1]` devient `events[1:-2]`, l'assertion `events[-1] == {...run_finished...}` devient `events[-2] == {...}` à l'identique, et ajouter :

```python
    assert events[-1] == {"event": "progress", "phase": "url_recovery", "processed": 0, "total": 1}
```

- `test_refuses_a_second_tagging_run_while_one_is_in_progress` : remplacer la dernière assertion par :

```python
    assert [event["event"] for event in events[-2:]] == ["run_finished", "progress"]
```

- [ ] **Step 8: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit tests/integration -q`
Expected: PASS, `test_ndjson_arbitration.py` et `test_ndjson_loop.py` compris (`test_a_cancelled_run_leaves_the_loop_alive` n'adopte aucun run et n'émet toujours rien).

- [ ] **Step 9: Lancer le gate**

Run: `just lint-sidecar && just typecheck-sidecar && just test-sidecar`
Expected: tout vert, couverture ≥ 80 %.

- [ ] **Step 10: Commit**

```bash
git add sidecar/src/tagger/protocol.py sidecar/src/tagger/handlers.py sidecar/src/tagger/__main__.py sidecar/tests/unit/test_protocol_url_recovery.py sidecar/tests/integration/test_ndjson_url_recovery.py sidecar/tests/integration/test_ndjson_tagging.py
git commit -m "feat(sidecar): ouvrir la phase de rattrapage et rattacher les erreurs à leur morceau"
```

---

## Task 3: ARCHITECTURE.md

**Files:**
- Modify: `docs/ARCHITECTURE.md` (§ API)

**Interfaces:**
- Consumes: règles livrées par les Tasks 1 et 2.
- Produces: aucune interface de code.

- [ ] **Step 1: Mettre à jour le contrat**

Charger `Skill[architecture-doc]` et lire ses règles, puis dans `docs/ARCHITECTURE.md` § API :

- **Ligne `resolve_by_url`** du tableau des commandes : identifiant du morceau et URL collée telle quelle ; acceptée une fois la phase de rattrapage ouverte (run courant dont la phase réseau ne tourne plus, terminée ou interrompue), sinon `url_recovery_not_open` ; un morceau non éligible lève `url_recovery_not_eligible`, un second geste en vol `url_recovery_busy`.
- **Ligne `cancel_run`** : quand il interrompt la phase réseau d'un run courant, ouvre le rattrapage et émet sa progression, toujours sans événement de fin.
- **Ligne `progress`** : en phase `url_recovery`, émise à l'ouverture (après `run_finished(network)` ou un `cancel_run` qui a interrompu la phase réseau), après chaque rattrapage réussi et après chaque geste d'arbitrage hors phase réseau ; mesure les morceaux rattrapés sur les morceaux à rattraper.
- **Ligne `error`** : toute erreur d'un geste sur un morceau (`resolve_arbitration`, `resolve_by_url`) porte `params.track_id`, y compris une erreur du client, pour que l'interface la place sur la bonne ligne.

- [ ] **Step 2: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs(sidecar): contrat NDJSON du rattrapage par URL"
```
