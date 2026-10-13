# Protocole NDJSON de l'arbitrage : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exposer l'arbitrage sur le protocole NDJSON et garder le run arbitrable, client compris, au-delà de sa phase réseau.

**Architecture:** `protocol.py` gagne deux commandes (`resolve_arbitration`, `switch_arbitration_source`), un état d'arbitrage commun à `arbitration_required` et `arbitration_updated`, et le label et l'année des candidats. `handlers.py` gagne un `CurrentRun`, propriétaire du client par un `AsyncExitStack`, ouvert par `open_tagging` et confié à la session par `handle_start_tagging` avant la phase réseau. `__main__.py` garde ce run courant, le ferme au run suivant, au `shutdown` et à l'EOF, et lance les gestes réseau en tâche de fond.

**Tech Stack:** Python 3.14 (`asyncio.TaskGroup`, `contextlib.AsyncExitStack`), pydantic 2 (commandes strictes, `extra="forbid"`), pytest + pytest-asyncio (mode strict), httpx2 `MockTransport`. Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/arbitrage-utilisateur/02-protocole-ndjson-arbitrage-design.md`

## Global Constraints

- **Dépend du sub-project 01, implémenté avant** : `tagger.sources.RunSources`, `tagger.tagging.LiveRun`, `open_run`, `resolve_run`, `SourceList`, `PendingArbitration(source, candidates, beatport_unavailable, empty_reason=None, other=None)`, `tagger.arbitration.Arbitration` (`async choose(track_id, source, index)`, `async refuse(track_id, source)`, `show(track_id, source)`), `ArbitrationUpdated`, `ArbitrationEvent`, `ArbitrationNotPendingError`, codes `arbitration_*` déjà traduits, helper `FakeApi.gate` / `gated_handler`.
- **Commandes** : `resolve_arbitration` = `track_id`, `source` (`beatport` ou `bandcamp`), `candidate` (entier ≥ 0 ou `null`, obligatoire, sans défaut) ; `switch_arbitration_source` = `track_id`, `source`.
- **Événements** : `arbitration_required` et `arbitration_updated` portent les mêmes champs : `track_id`, `source`, `beatport_unavailable`, `candidates`, `empty_reason`, `other_source`. `CandidatePayload` = `artist`, `title`, `label`, `year`, `scores`.
- **Aucun code d'erreur nouveau** : `test_error_translations.py` passe sans toucher `public/i18n/`.
- **Un geste refusé** sort en `error` avec `command` et `params.track_id`, jamais en crash de la boucle. Toute exception qui n'est pas une `TaggerError` fait tomber le process, volontairement.
- **Aucun titre ni chemin** dans un nom de tâche asyncio ni dans un log nouveau : les gestes s'appellent `arbitration`.
- **Tests** : noms en anglais, AAA séparé par des lignes vides, jamais de réseau réel. Les tests d'intégration de ce plan conversent avec la boucle (`ndjson_loop.conversation`), chaque attente bornée à 10 secondes.
- **Gate vert à chaque commit** : `just lint-sidecar`, `just typecheck-sidecar`, `just test-sidecar`. Commits `type(scope): description`, scope `arbitration`.

## Review Focus

- **`shutdown` pendant un refus en vol** : la boucle s'arrête sans attendre Bandcamp, aucun `arbitration_updated` ne sort (Task 2, `test_shuts_down_without_waiting_for_a_refusal_in_flight`).
- **Nouveau run pendant un refus en vol** : le geste est annulé, sans événement pour l'ancien morceau (Task 2, `test_cancels_a_refusal_in_flight_when_a_new_run_starts`).
- **Geste avant tout run** : `arbitration_not_pending` qui nomme la commande (Task 2, `test_rejects_a_gesture_before_any_run`).
- **Nouveau run dont l'ouverture échoue** : plus aucun run arbitrable, un geste suivant est refusé (Task 2, `test_leaves_no_arbitrable_run_when_a_new_one_fails_to_open`).
- **`candidate: true`** : rejeté en `malformed_command`, jamais lu comme l'index 1 (Task 2, cas `boolean`).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `sidecar/src/tagger/protocol.py` | `ResolveArbitration`, `SwitchArbitrationSource`, unions ; `CandidatePayload` étendu, `ArbitrationState`, `ArbitrationRequired`, `ArbitrationUpdated`. |
| `sidecar/src/tagger/handlers.py` | Traduction des événements de l'arbitrage ; `CurrentRun`, `open_tagging`, `handle_start_tagging(command, emit, adopt)`. |
| `sidecar/src/tagger/__main__.py` | Run courant de `_Session`, dispatch des deux commandes, gestes en tâche de fond, `close` au `shutdown` et à l'EOF. |
| `sidecar/tests/helpers/ndjson_loop.py` | `Conversation` et `conversation()` : stdin alimenté par une file, attente d'un événement. |
| `sidecar/tests/unit/test_protocol_arbitration.py` | Modèles des commandes, traduction des deux événements. |
| `sidecar/tests/integration/test_ndjson_arbitration.py` | Gestes et durée de vie du run courant, de bout en bout sur la boucle. |
| `sidecar/tests/integration/test_ndjson_loop.py` | Fixture du run sans fin : troisième paramètre `adopt`. |
| `docs/ARCHITECTURE.md` | § API et § Concurrence. |

---

## Task 1: Événements de l'arbitrage

**Files:**
- Modify: `sidecar/src/tagger/protocol.py`
- Modify: `sidecar/src/tagger/handlers.py`
- Test: `sidecar/tests/unit/test_protocol_arbitration.py`

**Interfaces:**
- Consumes: `PendingArbitration`, `SourceList` (sub-project 01) ; `arbitration.ArbitrationUpdated`, `ArbitrationEvent` (sub-project 01) ; `TrackCandidate.label: Credit | None`, `TrackCandidate.release: ReleaseInfo | None`, `ReleaseInfo.release_date: date | None`.
- Produces:
  - `protocol.CandidatePayload(artist, title, label: str | None, year: int | None, scores)`
  - `protocol.ArbitrationState(Event)` : `track_id: str`, `source: Source`, `beatport_unavailable: bool`, `candidates: tuple[CandidatePayload, ...]`, `empty_reason: FailureReason | None`, `other_source: Source | None`
  - `protocol.ArbitrationRequired(ArbitrationState)` (`event` par défaut `"arbitration_required"`), `protocol.ArbitrationUpdated(ArbitrationState)` (`event` par défaut `"arbitration_updated"`)
  - `handlers.arbitration_event(event: ArbitrationEvent) -> Event`

- [ ] **Step 1: Écrire les tests de traduction**

Créer `sidecar/tests/unit/test_protocol_arbitration.py` :

```python
"""Tests des modeles et de la traduction de l'arbitrage sur le protocole NDJSON."""

from dataclasses import replace
from datetime import date
from pathlib import Path
from typing import TYPE_CHECKING, Final

from scraper_responses import track_candidate

from tagger import arbitration, tagging
from tagger.files import IdentityTags
from tagger.handlers import arbitration_event, to_protocol_event
from tagger.matching import ScoredCandidate
from tagger.protocol import ArbitrationRequired, ArbitrationUpdated
from tagger.scraper_client import Credit, ReleaseInfo, Source
from tagger.tagging import FailureReason, PendingArbitration, SourceList, TrackRecord

if TYPE_CHECKING:
    from tagger.scraper_client import TrackCandidate

_RECORD: Final = TrackRecord(
    track_id="a.mp3",
    path=Path("music/a.mp3"),
    identity=IdentityTags(artist="Adam Beyer", title="Your Mind"),
)


def _scored(candidate: TrackCandidate) -> ScoredCandidate:
    return ScoredCandidate(
        candidate, 96.4, 91.6, 94.0, version_mismatch=False, number_mismatch=False
    )


def _awaiting(pending: PendingArbitration) -> TrackRecord:
    return replace(_RECORD, arbitration=pending)


def test_translates_an_update_with_the_other_source_and_the_empty_reason() -> None:
    pending = PendingArbitration(
        Source.BANDCAMP,
        (),
        beatport_unavailable=False,
        empty_reason=FailureReason.NO_RESULT,
        other=SourceList(Source.BEATPORT, (_scored(track_candidate()),)),
    )

    event = arbitration_event(arbitration.ArbitrationUpdated(_awaiting(pending)))

    assert isinstance(event, ArbitrationUpdated)
    assert (event.source, event.candidates, event.empty_reason, event.other_source) == (
        Source.BANDCAMP,
        (),
        FailureReason.NO_RESULT,
        Source.BEATPORT,
    )


def test_carries_the_label_and_the_release_year_of_a_beatport_candidate() -> None:
    candidate = track_candidate().model_copy(
        update={
            "label": Credit(name="Drumcode"),
            "release": ReleaseInfo(release_date=date(2023, 6, 16)),
        }
    )
    pending = PendingArbitration(Source.BEATPORT, (_scored(candidate),), beatport_unavailable=False)

    event = to_protocol_event(tagging.ArbitrationRequired(_awaiting(pending)))

    assert isinstance(event, ArbitrationRequired)
    assert (event.candidates[0].label, event.candidates[0].year) == ("Drumcode", 2023)


def test_leaves_the_label_and_the_year_empty_when_the_search_omits_them() -> None:
    pending = PendingArbitration(
        Source.BANDCAMP, (_scored(track_candidate()),), beatport_unavailable=True
    )

    event = to_protocol_event(tagging.ArbitrationRequired(_awaiting(pending)))

    assert isinstance(event, ArbitrationRequired)
    assert (event.candidates[0].label, event.candidates[0].year) == (None, None)
    assert (event.empty_reason, event.other_source) == (None, None)
```

`track_candidate()` ne porte ni label ni release : c'est la forme d'un objet de recherche Bandcamp.

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_protocol_arbitration.py -q --no-cov`
Expected: FAIL à la collecte, `ImportError: cannot import name 'arbitration_event' from 'tagger.handlers'`

- [ ] **Step 3: Étendre les modèles d'événements**

Dans `sidecar/src/tagger/protocol.py`, remplacer `CandidatePayload` et `ArbitrationRequired` par :

```python
class CandidatePayload(BaseModel):
    """Un candidat en zone grise. Son index dans un geste est sa position dans la liste.

    `label` et `year` restent nuls sur Bandcamp, dont la recherche ne rend ni l'un ni
    l'autre, et parfois sur Beatport, dont les objets de recherche sont abreges.
    """

    model_config = ConfigDict(frozen=True)

    artist: str
    title: str
    label: str | None
    year: int | None
    scores: TrackScores


class ArbitrationState(Event):
    """Etat complet d'un arbitrage : l'interface remplace son entree en bloc.

    `other_source` : la liste que `switch_arbitration_source` peut reafficher.
    `empty_reason` : pourquoi la liste Bandcamp affichee est vide.
    """

    track_id: str
    source: Source
    beatport_unavailable: bool
    candidates: tuple[CandidatePayload, ...]
    empty_reason: FailureReason | None
    other_source: Source | None


class ArbitrationRequired(ArbitrationState):
    """Morceau entre dans la file des arbitrages."""

    event: Literal["arbitration_required"] = "arbitration_required"


class ArbitrationUpdated(ArbitrationState):
    """Liste affichee remplacee : bascule sur Bandcamp ou retour a Beatport."""

    event: Literal["arbitration_updated"] = "arbitration_updated"
```

- [ ] **Step 4: Traduire les événements de l'arbitrage**

Dans `sidecar/src/tagger/handlers.py` :

1. Remplacer `from tagger import __version__, tagging` par `from tagger import __version__, arbitration, tagging`, ajouter `ArbitrationUpdated` à l'import de `tagger.protocol`, et sous `if TYPE_CHECKING:` ajouter `from tagger.arbitration import ArbitrationEvent`.

2. Dans `to_protocol_event`, remplacer la branche `tagging.ArbitrationRequired` :

```python
        case tagging.ArbitrationRequired():
            return _arbitration_state(ArbitrationRequired, event.record)
```

3. Ajouter `arbitration_event` juste après `to_protocol_event` :

```python
def arbitration_event(event: ArbitrationEvent) -> Event:
    """Traduit un evenement de l'arbitrage. Un cas oublie est une erreur de typage."""
    match event:
        case arbitration.ArbitrationUpdated():
            return _arbitration_state(ArbitrationUpdated, event.record)
        case tagging.TrackResolved():
            return _resolved(event.record)
        case _:
            assert_never(event)
```

4. Remplacer la fonction `_arbitration` par :

```python
def _arbitration_state(
    kind: type[ArbitrationRequired | ArbitrationUpdated], record: TrackRecord
) -> ArbitrationRequired | ArbitrationUpdated:
    """Etat complet d'un arbitrage, commun aux deux evenements."""
    pending = record.arbitration
    if pending is None:
        logger.error("track without arbitration track=%s", record.track_id)
        raise ValueError("track without arbitration")
    return kind(
        track_id=record.track_id,
        source=pending.source,
        beatport_unavailable=pending.beatport_unavailable,
        candidates=tuple(_candidate(scored) for scored in pending.candidates),
        empty_reason=pending.empty_reason,
        other_source=None if pending.other is None else pending.other.source,
    )


def _candidate(scored: ScoredCandidate) -> CandidatePayload:
    candidate = scored.candidate
    released = candidate.release.release_date if candidate.release else None
    return CandidatePayload(
        artist=credited_artists(candidate),
        title=full_title(candidate),
        label=None if candidate.label is None else candidate.label.name,
        year=None if released is None else released.year,
        scores=_scores(scored),
    )
```

- [ ] **Step 5: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_protocol_arbitration.py tests/unit/test_protocol_tagging.py tests/integration/test_ndjson_tagging.py -q --no-cov`
Expected: PASS

- [ ] **Step 6: Gate**

Run: `just lint-sidecar && just typecheck-sidecar && just test-sidecar`
Expected: tout vert

- [ ] **Step 7: Commit**

```bash
git add sidecar/src/tagger/protocol.py sidecar/src/tagger/handlers.py sidecar/tests/unit/test_protocol_arbitration.py
git commit -m "feat(arbitration): etat complet d'un arbitrage sur le protocole"
```

---

## Task 2: Run courant et gestes sur la boucle

**Files:**
- Modify: `sidecar/src/tagger/protocol.py`
- Modify: `sidecar/src/tagger/handlers.py`
- Modify: `sidecar/src/tagger/__main__.py`
- Modify: `sidecar/tests/helpers/ndjson_loop.py`
- Modify: `sidecar/tests/integration/test_ndjson_loop.py`
- Test: `sidecar/tests/unit/test_protocol_arbitration.py`, `sidecar/tests/integration/test_ndjson_arbitration.py`

**Interfaces:**
- Consumes: Task 1 ; `LiveRun`, `RunSources`, `open_run`, `resolve_run`, `Arbitration`, `ArbitrationNotPendingError` (sub-project 01) ; `FakeApi.gate(path, key) -> Gate`, `FakeApi.gated_handler` (sub-project 01).
- Produces:
  - `protocol.ResolveArbitration` (`track_id: str`, `source: Literal["beatport", "bandcamp"]`, `candidate: int | None`, ≥ 0), `protocol.SwitchArbitrationSource` (`track_id`, `source`)
  - `handlers.CurrentRun(stack: AsyncExitStack, live: LiveRun, sources: RunSources, arbitration: Arbitration)`, attributs `live`, `sources`, `arbitration` ; `track(gesture: asyncio.Task[None]) -> None` ; `async close() -> None`
  - `async handlers.open_tagging(command: StartTagging, emit: Callable[[Event], None]) -> CurrentRun`
  - `async handlers.handle_start_tagging(command: StartTagging, emit: Callable[[Event], None], adopt: Callable[[CurrentRun], None]) -> RunFinished` (troisième paramètre nouveau)
  - `_Session.resolve_arbitration(command)`, `_Session.switch_arbitration_source(command)`, `async _Session.close(*, cancel: bool)`
  - helpers de test : `Conversation` (`send(**fields)`, `async expect(event, **fields) -> dict[str, object]`, `events`, `hang_up()`), `conversation()` (context manager async), `EXPECT_TIMEOUT`

- [ ] **Step 1: Ajouter la conversation au helper de boucle**

Remplacer tout le contenu de `sidecar/tests/helpers/ndjson_loop.py` par :

```python
"""Injection de commandes sur la boucle NDJSON, partagee par les tests d'integration.

Aucune interface n'est lancee : le contrat se teste en ligne de commande, ce qui est
sa raison d'etre (ADR-005).
"""

import asyncio
import io
import json
import queue
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, override

from tagger.__main__ import run_loop

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Callable

# Borne de chaque attente : un evenement qui n'arrive pas echoue au lieu de geler la suite.
EXPECT_TIMEOUT = 10


def drive_raw(commands: str) -> str:
    """Injecte des commandes et rend la sortie brute, pour y chercher une fuite."""
    stdout = io.StringIO()
    asyncio.run(run_loop(io.StringIO(commands), stdout))

    return stdout.getvalue()


def drive(commands: str) -> list[dict[str, object]]:
    """Injecte des commandes et rend les evenements emis, un par ligne."""
    return [json.loads(line) for line in drive_raw(commands).splitlines() if line]


class _Inbox(io.StringIO):
    """stdin qui attend la prochaine ligne : `run_loop` le lit dans un thread."""

    def __init__(self, lines: queue.SimpleQueue[str]) -> None:
        super().__init__()
        self._lines = lines

    @override
    def readline(self, size: int | None = -1, /) -> str:
        return self._lines.get()


class _Outbox(io.StringIO):
    """stdout qui decode chaque ligne complete et la remet a la conversation."""

    def __init__(self, on_event: Callable[[dict[str, object]], None]) -> None:
        super().__init__()
        self._on_event = on_event
        self._pending = ""

    @override
    def write(self, text: str, /) -> int:
        self._pending += text
        *lines, self._pending = self._pending.split("\n")
        for line in lines:
            if line:
                self._on_event(json.loads(line))
        return len(text)


class Conversation:
    """Dialogue avec la boucle : une commande ne part qu'apres l'evenement qui la rend valide.

    Les evenements sont recus dans le thread de la boucle d'evenements : c'est vrai du
    run et de l'arbitrage, pas de l'extraction, qui emet depuis `to_thread`.
    """

    def __init__(self) -> None:
        self.events: list[dict[str, object]] = []
        self._lines: queue.SimpleQueue[str] = queue.SimpleQueue()
        self._arrived = asyncio.Event()
        self._read = 0
        self.stdin = _Inbox(self._lines)
        self.stdout = _Outbox(self._received)

    def send(self, **fields: object) -> None:
        self._lines.put(json.dumps(fields) + "\n")

    def hang_up(self) -> None:
        """EOF sur stdin."""
        self._lines.put("")

    async def expect(self, event: str, **fields: object) -> dict[str, object]:
        """Prochain evenement `event` portant `fields`, dans l'ordre d'arrivee.

        Les evenements qui le precedent sont depasses : une attente suivante ne les
        voit plus.
        """
        async with asyncio.timeout(EXPECT_TIMEOUT):
            while True:
                for index in range(self._read, len(self.events)):
                    received = self.events[index]
                    if received["event"] == event and all(
                        received.get(key) == value for key, value in fields.items()
                    ):
                        self._read = index + 1
                        return received
                self._arrived.clear()
                await self._arrived.wait()

    def _received(self, event: dict[str, object]) -> None:
        self.events.append(event)
        self._arrived.set()


@asynccontextmanager
async def conversation() -> AsyncIterator[Conversation]:
    """Boucle lancee sur une conversation, raccrochee et attendue a la sortie."""
    talk = Conversation()
    loop = asyncio.create_task(run_loop(talk.stdin, talk.stdout), name="loop")
    try:
        yield talk
    finally:
        talk.hang_up()
        async with asyncio.timeout(EXPECT_TIMEOUT):
            await loop
```

- [ ] **Step 2: Écrire les tests des commandes**

Dans `sidecar/tests/unit/test_protocol_arbitration.py`, compléter les imports :

```python
import json
from dataclasses import replace
from datetime import date
from pathlib import Path
from typing import TYPE_CHECKING, Final

import pytest
from pydantic import ValidationError
from scraper_responses import track_candidate

from tagger import arbitration, tagging
from tagger.files import IdentityTags
from tagger.handlers import arbitration_event, to_protocol_event
from tagger.matching import ScoredCandidate
from tagger.protocol import (
    ArbitrationRequired,
    ArbitrationUpdated,
    ResolveArbitration,
    parse_command,
)
from tagger.scraper_client import Credit, ReleaseInfo, Source
from tagger.tagging import FailureReason, PendingArbitration, SourceList, TrackRecord
```

puis ajouter en fin de fichier :

```python
def _resolve(payload: str) -> str:
    return '{"command":"resolve_arbitration","track_id":"a.mp3",' + payload + "}"


@pytest.mark.parametrize("candidate", ["0", "null"], ids=["choice", "refusal"])
def test_accepts_a_choice_and_an_explicit_refusal(candidate: str) -> None:
    line = _resolve('"source":"beatport","candidate":' + candidate)

    command = parse_command(line)

    assert isinstance(command, ResolveArbitration)
    assert command.candidate == json.loads(candidate)


@pytest.mark.parametrize(
    "payload",
    [
        '"source":"beatport","candidate":-1',
        '"source":"soundcloud","candidate":0',
        '"source":"beatport"',
        '"source":"beatport","candidate":true',
    ],
    ids=["negative-index", "soundcloud", "missing-candidate", "boolean"],
)
def test_rejects_a_negative_index_a_soundcloud_source_and_a_missing_candidate(
    payload: str,
) -> None:
    with pytest.raises(ValidationError):
        parse_command(_resolve(payload))
```

- [ ] **Step 3: Écrire les tests d'intégration**

Créer `sidecar/tests/integration/test_ndjson_arbitration.py` :

```python
"""Protocole NDJSON de l'arbitrage, de bout en bout sur la boucle."""

from typing import TYPE_CHECKING

import httpx2
import pytest
from ndjson_loop import conversation
from scraper_responses import track_payload
from tagging_api import FakeApi, FakeCdn, found, public_resolver, tagged_mp3

from tagger import handlers
from tagger.api_key import SERVICE, USERNAME

if TYPE_CHECKING:
    from pathlib import Path

    from memory_keyring import MemoryKeyring

pytestmark = pytest.mark.asyncio

QUERY = "Adam Beyer Your Mind"
BANDCAMP_URL = "https://adambeyer.bandcamp.com/track/your-mind"
REFUSE_BEATPORT = {
    "command": "resolve_arbitration",
    "track_id": "a.mp3",
    "source": "beatport",
    "candidate": None,
}


@pytest.fixture
def folder(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Un morceau en zone grise, et un dossier de donnees d'application isole."""
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "appdata"))
    folder = tmp_path / "music"
    tagged_mp3(folder, "a.mp3", "Adam Beyer", "Your Mind")
    return folder


@pytest.fixture
def empty(tmp_path: Path) -> Path:
    """Dossier sans morceau : le run qui le vise se termine aussitot."""
    folder = tmp_path / "empty"
    folder.mkdir()
    return folder


@pytest.fixture
def api(monkeypatch: pytest.MonkeyPatch) -> FakeApi:
    """Extended et Radio Edit sur Beatport, la version attendue sur Bandcamp.

    `gated_handler` : les portes posees par un test retiennent leurs requetes.
    """
    fake = FakeApi()
    fake.on(
        "/beatport/search",
        QUERY,
        found(
            track_payload(id="1", mix_name="Extended Mix"),
            track_payload(id="2", mix_name="Radio Edit"),
        ),
    )
    fake.on(
        "/bandcamp/search",
        QUERY,
        found(track_payload(id="42", source="bandcamp", mix_name=None, url=BANDCAMP_URL)),
    )
    cdn = FakeCdn()
    monkeypatch.setattr(
        handlers,
        "tagging_transports",
        lambda: handlers.TaggingTransports(
            httpx2.MockTransport(fake.gated_handler),
            httpx2.MockTransport(cdn.handler),
            public_resolver,
        ),
    )
    return fake


@pytest.fixture(autouse=True)
def _key(memory_keyring: MemoryKeyring) -> None:
    memory_keyring.secrets[(SERVICE, USERNAME)] = "k3y-t0k3n"


def _start(folder: Path) -> dict[str, object]:
    return {"command": "start_tagging", "folder": str(folder)}


async def test_refuses_beatport_then_resolves_the_track_on_a_bandcamp_candidate(
    folder: Path, api: FakeApi
) -> None:
    async with conversation() as talk:
        talk.send(**_start(folder))
        await talk.expect("run_finished")
        talk.send(**REFUSE_BEATPORT)
        switched = await talk.expect("arbitration_updated")
        talk.send(
            command="resolve_arbitration", track_id="a.mp3", source="bandcamp", candidate=0
        )
        resolved = await talk.expect("track_resolved", track_id="a.mp3")

    assert (switched["source"], switched["other_source"]) == ("bandcamp", "beatport")
    assert (resolved["state"], resolved["resolution"], resolved["source"]) == (
        "resolved",
        "arbitration",
        "bandcamp",
    )


async def test_shows_the_beatport_list_again_without_calling_the_api(
    folder: Path, api: FakeApi
) -> None:
    async with conversation() as talk:
        talk.send(**_start(folder))
        await talk.expect("run_finished")
        talk.send(**REFUSE_BEATPORT)
        await talk.expect("arbitration_updated")
        calls = len(api.requests)
        talk.send(command="switch_arbitration_source", track_id="a.mp3", source="beatport")
        back = await talk.expect("arbitration_updated")

    assert (back["source"], back["other_source"]) == ("beatport", "bandcamp")
    assert isinstance(back["candidates"], list)
    assert len(back["candidates"]) == 2
    assert len(api.requests) == calls


async def test_answers_an_awaiting_track_after_the_run_is_cancelled(
    folder: Path, api: FakeApi
) -> None:
    tagged_mp3(folder, "b.mp3", "Amelie Lens", "Basiel")
    slow = api.gate("/beatport/search", "Amelie Lens Basiel")

    async with conversation() as talk:
        talk.send(**_start(folder))
        await talk.expect("arbitration_required", track_id="a.mp3")
        await slow.reached.wait()
        talk.send(command="cancel_run")
        talk.send(
            command="resolve_arbitration", track_id="a.mp3", source="beatport", candidate=0
        )
        resolved = await talk.expect("track_resolved", track_id="a.mp3")

    assert resolved["resolution"] == "arbitration"


async def test_drops_the_arbitrations_of_a_run_replaced_by_a_new_one(
    folder: Path, empty: Path, api: FakeApi
) -> None:
    async with conversation() as talk:
        talk.send(**_start(folder))
        await talk.expect("run_finished")
        talk.send(**_start(empty))
        await talk.expect("run_finished")
        talk.send(
            command="resolve_arbitration", track_id="a.mp3", source="beatport", candidate=0
        )
        error = await talk.expect("error")

    assert (error["code"], error["command"], error["params"]) == (
        "arbitration_not_pending",
        "resolve_arbitration",
        {"track_id": "a.mp3"},
    )


async def test_reports_a_rejected_gesture_with_its_command_and_its_track(
    folder: Path, api: FakeApi
) -> None:
    async with conversation() as talk:
        talk.send(**_start(folder))
        await talk.expect("run_finished")
        talk.send(command="switch_arbitration_source", track_id="a.mp3", source="beatport")
        error = await talk.expect("error")

    assert (error["code"], error["command"], error["params"]) == (
        "arbitration_candidate_unknown",
        "switch_arbitration_source",
        {"track_id": "a.mp3"},
    )


async def test_answers_another_command_while_a_refusal_waits_for_bandcamp(
    folder: Path, api: FakeApi
) -> None:
    slow = api.gate("/bandcamp/search", QUERY)

    async with conversation() as talk:
        talk.send(**_start(folder))
        await talk.expect("run_finished")
        talk.send(**REFUSE_BEATPORT)
        await slow.reached.wait()
        talk.send(command="get_version")
        await talk.expect("version")
        slow.release.set()
        await talk.expect("arbitration_updated")

    names = [event["event"] for event in talk.events]
    assert names.index("version") < names.index("arbitration_updated")


async def test_rejects_a_gesture_before_any_run() -> None:
    async with conversation() as talk:
        talk.send(
            command="resolve_arbitration", track_id="a.mp3", source="beatport", candidate=0
        )
        error = await talk.expect("error")

    assert (error["code"], error["command"]) == ("arbitration_not_pending", "resolve_arbitration")


async def test_shuts_down_without_waiting_for_a_refusal_in_flight(
    folder: Path, api: FakeApi
) -> None:
    slow = api.gate("/bandcamp/search", QUERY)

    async with conversation() as talk:
        talk.send(**_start(folder))
        await talk.expect("run_finished")
        talk.send(**REFUSE_BEATPORT)
        await slow.reached.wait()
        talk.send(command="shutdown")

    assert all(event["event"] != "arbitration_updated" for event in talk.events)


async def test_cancels_a_refusal_in_flight_when_a_new_run_starts(
    folder: Path, empty: Path, api: FakeApi
) -> None:
    slow = api.gate("/bandcamp/search", QUERY)

    async with conversation() as talk:
        talk.send(**_start(folder))
        await talk.expect("run_finished")
        talk.send(**REFUSE_BEATPORT)
        await slow.reached.wait()
        talk.send(**_start(empty))
        await talk.expect("run_finished")

    assert all(event["event"] != "arbitration_updated" for event in talk.events)


async def test_leaves_no_arbitrable_run_when_a_new_one_fails_to_open(
    folder: Path, api: FakeApi, memory_keyring: MemoryKeyring
) -> None:
    async with conversation() as talk:
        talk.send(**_start(folder))
        await talk.expect("run_finished")
        memory_keyring.secrets.clear()
        talk.send(**_start(folder))
        await talk.expect("error", code="api_key_missing")
        talk.send(
            command="resolve_arbitration", track_id="a.mp3", source="beatport", candidate=0
        )
        refused = await talk.expect("error", code="arbitration_not_pending")

    assert refused["command"] == "resolve_arbitration"
```

Dans `test_shuts_down_without_waiting_for_a_refusal_in_flight`, la porte n'est jamais relâchée : si `shutdown` attendait le geste, la sortie de `conversation()` échouerait sur son délai de 10 secondes.

- [ ] **Step 4: Adapter la fixture du run sans fin**

`handle_start_tagging` gagne un troisième paramètre. Dans `sidecar/tests/integration/test_ndjson_loop.py`, sous `if TYPE_CHECKING:`, ajouter `from tagger.handlers import CurrentRun`, puis remplacer la signature d'`endless` dans la fixture `tagging_slow_to_stop` :

```python
    async def endless(
        command: StartTagging,
        emit: Callable[[Event], None],
        adopt: Callable[[CurrentRun], None],
    ) -> Event:
```

- [ ] **Step 5: Vérifier que les tests échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_protocol_arbitration.py tests/integration/test_ndjson_arbitration.py -q --no-cov`
Expected: FAIL, `ImportError: cannot import name 'ResolveArbitration' from 'tagger.protocol'` à la collecte du test unitaire ; les tests d'intégration échouent sur `malformed_command` au lieu des événements attendus

- [ ] **Step 6: Déclarer les deux commandes**

Dans `sidecar/src/tagger/protocol.py`, après `StartTagging` :

```python
type _ArbitrationSource = Literal["beatport", "bandcamp"]


class ResolveArbitration(Command):
    """Choix d'un candidat de la liste `source`, ou son refus explicite.

    `candidate` est requis mais nullable : `null` refuse la liste, l'interface le dit
    toujours. `source` nomme la liste visee : un geste sur une liste qui n'est plus
    affichee est rejete (double clic arrive apres la bascule sur Bandcamp).
    """

    command: Literal["resolve_arbitration"]
    track_id: str
    source: _ArbitrationSource
    candidate: Annotated[int, Field(ge=0)] | None


class SwitchArbitrationSource(Command):
    """Reaffiche la liste deja obtenue de `source`, sans appel reseau."""

    command: Literal["switch_arbitration_source"]
    track_id: str
    source: _ArbitrationSource
```

Puis remplacer `AnyCommand`, `ExecutableCommand` et `CommandName` :

```python
type AnyCommand = Annotated[
    GetVersion
    | Shutdown
    | CancelRun
    | ListPlaylists
    | ExtractPlaylist
    | SetApiKey
    | StartTagging
    | ResolveArbitration
    | SwitchArbitrationSource,
    Field(discriminator="command"),
]

# `shutdown` sort de la boucle sans rien executer : l'exclure ici permet au `match`
# du dispatch de se fermer par `assert_never` sans laisser de cas non couvert.
type ExecutableCommand = (
    GetVersion
    | CancelRun
    | ListPlaylists
    | ExtractPlaylist
    | SetApiKey
    | StartTagging
    | ResolveArbitration
    | SwitchArbitrationSource
)

# Recopie des `command` declares ci-dessus : un `Literal` ne se compose pas depuis une
# union a la compilation. `test_command_name_lists_every_command` garde la copie.
type CommandName = Literal[
    "get_version",
    "shutdown",
    "cancel_run",
    "list_playlists",
    "extract_playlist",
    "set_api_key",
    "start_tagging",
    "resolve_arbitration",
    "switch_arbitration_source",
]
```

`strict=True` hérité de `Command` refuse `true` pour un entier : c'est ce qui rend le cas `boolean` rouge sans règle de plus.

- [ ] **Step 7: Ouvrir le run courant dans les handlers**

Dans `sidecar/src/tagger/handlers.py` :

1. Imports : ajouter `from contextlib import AsyncExitStack` ; ajouter `from tagger.arbitration import Arbitration` et `from tagger.sources import RunSources` ; remplacer `from tagger.tagging import run_tagging` par `from tagger.tagging import open_run, resolve_run` ; sous `if TYPE_CHECKING:`, remplacer `from tagger.tagging import TaggingRun, TrackRecord` par `from tagger.tagging import LiveRun, TaggingRun, TrackRecord`.

2. Remplacer toute la fonction `handle_start_tagging` par :

```python
class CurrentRun:
    """Run arbitrable jusqu'au suivant, proprietaire du client et du fetcher de pochettes.

    Distinct de la phase reseau : `cancel_run` arrete celle-ci et laisse le run
    arbitrable (decision du 2026-09-26).
    """

    def __init__(
        self,
        stack: AsyncExitStack,
        live: LiveRun,
        sources: RunSources,
        arbitration: Arbitration,
    ) -> None:
        self.live = live
        self.sources = sources
        self.arbitration = arbitration
        self._stack = stack
        self._gestures: set[asyncio.Task[None]] = set()

    def track(self, gesture: asyncio.Task[None]) -> None:
        """Reference forte sur un geste en vol, relachee a sa fin."""
        self._gestures.add(gesture)
        gesture.add_done_callback(self._gestures.discard)

    async def close(self) -> None:
        """Annule les gestes en vol, les attend, puis ferme le client et le fetcher."""
        for gesture in self._gestures:
            gesture.cancel()
        await asyncio.gather(*self._gestures, return_exceptions=True)
        await self._stack.aclose()


async def open_tagging(command: StartTagging, emit: Callable[[Event], None]) -> CurrentRun:
    """Ouvre caches et client, lit les identites (`run_started`) et branche l'arbitrage.

    Le client et le fetcher entrent dans une pile rendue au `CurrentRun` : ils
    survivent a la phase reseau, le temps des arbitrages. Une ouverture qui echoue
    referme ce qu'elle a deja ouvert.
    """
    api_key = await asyncio.to_thread(read_api_key)
    if api_key is None:
        raise ApiKeyMissingError

    cache_root = app_data_dir() / "cache"
    # Deux scans independants, superposes plutot qu'enchaines. `TaskGroup` et non
    # `gather` : si l'un leve, il annule l'autre au lieu de le laisser courir seul.
    async with asyncio.TaskGroup() as opening:
        responses_disk = opening.create_task(
            asyncio.to_thread(DiskCache, cache_root / "responses"), name="cache:responses"
        )
        artworks_disk = opening.create_task(
            asyncio.to_thread(DiskCache, cache_root / "artworks"), name="cache:artworks"
        )
    transports = tagging_transports()

    async with AsyncExitStack() as stack:
        client = await stack.enter_async_context(
            TechnoScraperClient(
                api_key, transport=transports.api, cache=ResponseCache(responses_disk.result())
            )
        )
        artworks = await stack.enter_async_context(
            ArtworkFetcher(
                artworks_disk.result(), transport=transports.cdn, resolve=transports.resolve
            )
        )
        live = await open_run(command.folder, on_event=lambda event: emit(to_protocol_event(event)))
        sources = RunSources(live.run_id, client, artworks, _thresholds(command))
        desk = Arbitration(live, sources, lambda event: emit(arbitration_event(event)))
        return CurrentRun(stack.pop_all(), live, sources, desk)


async def handle_start_tagging(
    command: StartTagging,
    emit: Callable[[Event], None],
    adopt: Callable[[CurrentRun], None],
) -> RunFinished:
    """Ouvre le run, le confie a la session, puis deroule sa phase reseau.

    Confie avant la phase reseau : un morceau se tranche des qu'il attend.
    """
    current = await open_tagging(command, emit)
    adopt(current)
    await resolve_run(
        current.live, current.sources, on_event=lambda event: emit(to_protocol_event(event))
    )
    return _run_finished(current.live.snapshot())
```

`stack.pop_all()` transfère le client et le fetcher au `CurrentRun` : la sortie du `async with` ne ferme plus rien, et elle ne ferme tout que si `open_run` a levé avant.

- [ ] **Step 8: Garder le run courant dans la session**

Dans `sidecar/src/tagger/__main__.py` :

1. Imports : ajouter `from tagger.arbitration import ArbitrationNotPendingError` et `from tagger.scraper_client import Source` ; ajouter `ResolveArbitration` et `SwitchArbitrationSource` à l'import de `tagger.protocol` ; sous `if TYPE_CHECKING:`, ajouter `from tagger.handlers import CurrentRun`.

2. Dans `_Session.__init__`, ajouter `self._current: CurrentRun | None = None`.

3. Remplacer `start_tagging` par :

```python
    def start_tagging(self, command: StartTagging) -> None:
        """Lance le run en tache de fond : la boucle repart lire la commande suivante.

        Le run courant cesse de l'etre des maintenant : un geste lu ensuite vise un
        morceau que l'interface a quitte.
        """
        if self._active_run() is not None:
            raise TaggingInProgressError
        replaced, self._current = self._current, None
        start_work = functools.partial(self._replace, replaced, command)
        self._run = self._group.create_task(self._phase(start_work, command), name="tagging")
```

4. Ajouter à `_Session`, après `cancel_run` :

```python
    def resolve_arbitration(self, command: ResolveArbitration) -> None:
        """Choix ou refus en tache de fond : un appel Bandcamp ne gele pas stdin."""
        current = self._arbitrable(command.track_id)
        source = Source(command.source)
        if command.candidate is None:
            gesture = current.arbitration.refuse(command.track_id, source)
        else:
            gesture = current.arbitration.choose(command.track_id, source, command.candidate)
        current.track(
            self._group.create_task(self._gesture(gesture, command), name="arbitration")
        )

    def switch_arbitration_source(self, command: SwitchArbitrationSource) -> None:
        """Sans I/O : s'execute dans la boucle."""
        current = self._arbitrable(command.track_id)
        current.arbitration.show(command.track_id, Source(command.source))

    async def close(self, *, cancel: bool) -> None:
        """Fin de session : `shutdown` annule la phase reseau, l'EOF l'attend. Le run
        courant est ferme ensuite, ses gestes en vol annules.
        """
        if cancel:
            await self.cancel_run()
        elif (running := self._active_run()) is not None:
            await asyncio.wait({running})
        current, self._current = self._current, None
        if current is not None:
            await current.close()

    def _arbitrable(self, track_id: str) -> CurrentRun:
        if self._current is None:
            raise ArbitrationNotPendingError(track_id)
        return self._current

    async def _replace(self, replaced: CurrentRun | None, command: StartTagging) -> Event:
        if replaced is not None:
            await replaced.close()
        return await handle_start_tagging(command, self.send, self._adopt)

    def _adopt(self, current: CurrentRun) -> None:
        self._current = current

    async def _gesture(self, gesture: Awaitable[None], command: ResolveArbitration) -> None:
        """Un geste refuse devient une `error` et ne remonte pas au `TaskGroup`."""
        try:
            await gesture
        except TaggerError as error:
            logger.exception("arbitration failed reason=%s", error.code)
            self.send(error_from_business(error, command.command))
```

5. Dans `run_loop`, remplacer la sortie sur EOF :

```python
            if not line:
                # EOF : la phase reseau en cours est attendue, puis le run courant ferme.
                await session.close(cancel=False)
                return
```

et celle sur `shutdown` :

```python
            if isinstance(command, Shutdown):
                await session.close(cancel=True)
                return
```

6. Dans `_dispatch`, ajouter avant `case _:` :

```python
        case ResolveArbitration():
            session.resolve_arbitration(command)
        case SwitchArbitrationSource():
            session.switch_arbitration_source(command)
```

`handle_start_tagging` reste appelé par son nom global depuis `_replace` : c'est ce que la fixture `tagging_slow_to_stop` remplace.

- [ ] **Step 9: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_protocol_arbitration.py tests/unit/test_protocol_models.py tests/integration -q --no-cov`
Expected: PASS

- [ ] **Step 10: Gate**

Run: `just lint-sidecar && just typecheck-sidecar && just test-sidecar`
Expected: tout vert

- [ ] **Step 11: Commit**

```bash
git add sidecar/src/tagger/protocol.py sidecar/src/tagger/handlers.py sidecar/src/tagger/__main__.py sidecar/tests/helpers/ndjson_loop.py sidecar/tests/unit/test_protocol_arbitration.py sidecar/tests/integration/test_ndjson_arbitration.py sidecar/tests/integration/test_ndjson_loop.py
git commit -m "feat(arbitration): trancher un arbitrage depuis le protocole NDJSON"
```

---

## Task 3: Documentation

**Files:**
- Modify: `docs/ARCHITECTURE.md`

Charger `Skill[architecture-doc]` avant toute édition d'ARCHITECTURE.md : le gabarit porte la structure et le style attendus (`~/.claude/CLAUDE.md` § Agents, Commandes & Skills).

- [ ] **Step 1: Commandes**

Dans le tableau des commandes de § API :

- ligne `shutdown` : ajouter en fin de cellule « Ferme ensuite le run courant : son client et ses gestes en vol. » ;
- remplacer la cellule de `resolve_arbitration` par :

```markdown
identifiant du morceau, `source` (`beatport` ou `bandcamp`, la liste visée) et `candidate` : index dans cette liste, ou `null` pour un refus explicite, jamais implicite. Un geste sur une liste qui n'est plus affichée est refusé en `arbitration_candidate_unknown` : un double clic arrivé après la bascule refuserait sinon Bandcamp. Tranché en tâche de fond, la boucle continuant de lire stdin pendant l'appel Bandcamp
```

- remplacer la cellule de `switch_arbitration_source` par :

```markdown
identifiant du morceau, `source` à réafficher. Sert le lien de retour vers la liste Beatport après une bascule sur Bandcamp (cf. [ADR-009](adrs/009-enchainement-sources-et-arbitrage.md)), sans appel réseau, et produit un `arbitration_updated`
```

- [ ] **Step 2: Événements**

Dans le tableau des événements :

- remplacer la cellule d'`arbitration_required` par :

```markdown
état complet de l'arbitrage d'un morceau entré dans la file : source affichée, candidats en zone grise avec leur score, leur label et leur année (nuls sur Bandcamp, dont la recherche ne rend ni l'un ni l'autre), `beatport_unavailable` quand Bandcamp n'a été interrogé que parce que Beatport était en panne (§ Chaîne de résolution), `empty_reason` d'une liste Bandcamp vide et `other_source`, la liste que `switch_arbitration_source` peut réafficher. L'index d'un candidat est sa position dans la liste
```

- remplacer la cellule d'`arbitration_updated` par :

```markdown
mêmes champs qu'`arbitration_required`, pour un morceau déjà dans la file : l'interface remplace son entrée en bloc. Émis à la bascule sur Bandcamp et au retour à Beatport
```

- [ ] **Step 3: Concurrence**

Dans § Concurrence, après le paragraphe sur la file d'arbitrage (réécrit par le sub-project 01), ajouter :

```markdown
**Le run courant survit à sa phase réseau.** `start_tagging` ouvre un run dont le client et le fetcher de pochettes restent ouverts après `run_finished` comme après `cancel_run`, le temps des arbitrages. Ils ne se ferment qu'au run suivant, au `shutdown` ou à l'EOF, qui annulent aussi les gestes en vol. Un choix ou un refus attend le réseau, un refetch ou un appel Bandcamp : il part en tâche de fond comme les deux phases longues, pour la même raison. `switch_arbitration_source` n'attend rien et s'exécute dans la boucle.
```

- [ ] **Step 4: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs: commandes et evenements de l'arbitrage, run courant"
```
