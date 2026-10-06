# Protocole NDJSON de l'écriture : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exposer la confirmation globale et la relance de l'écriture sur le protocole NDJSON, avec les gardes qui figent le run et protègent une écriture en cours.

**Architecture:** `protocol.py` gagne `CommitRun`, `RetryWrite` et les compteurs `written` / `write_error` de `run_finished`, mirrorés dans `protocol.ts`. `handlers.py` pose un `RunWriter` sur le run courant à la confirmation et traduit ses événements. `__main__.py` lance l'écriture en tâche de fond, refuse ce qui n'est pas ouvert (`write_not_open`), ce qui chevauche une écriture (`write_in_progress`) et toute décision sur un run confirmé (`run_committed`).

**Tech Stack:** Python 3.14 (`asyncio.TaskGroup`, `functools.partial`), pydantic 2 (commandes strictes), pytest-asyncio et `ndjson_loop.conversation`, TypeScript pour le miroir. Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/ecriture-des-tags-et-renommage/05-protocole-ndjson-ecriture-design.md`

## Global Constraints

- **Dépend du sub-project 04, implémenté avant** : `writing.RunWriter(live, dump_folder, on_event)` (`write()`, `retry()`), `writing.WriteProgress`, `writing.WriteEvent`, `TrackState.WRITTEN` / `WRITE_ERROR` ; et, par lui, `tag_dump.dump_dir()` et `TagDumpWriteError`.
- **Commandes** : `commit_run {run_id}` et `retry_write {run_id}`, strictes, sans champ en trop.
- **Ouverture** : `commit_run` exige le run courant désigné, une phase réseau finie ou interrompue et un run jamais confirmé ; `retry_write` le même run déjà confirmé. Sinon `write_not_open`, y compris quand un geste d'arbitrage ou de rattrapage est en vol : un geste qui finirait pendant l'écriture écraserait un morceau écrit. Toute commande d'écriture et `start_tagging` pendant une écriture : `write_in_progress`.
- **Run figé** dès la confirmation : `resolve_arbitration`, `switch_arbitration_source` et `resolve_by_url` refusés en `run_committed`, `params.track_id`. Un dump impossible remet le run en état confirmable : seule la sauvegarde initiale du dump peut lever vers la session, le sub-project 04 logue tout échec de mise à jour du chemin renommé sans rien arrêter.
- **Écriture jamais coupée** : ni `cancel_run`, ni `shutdown`, ni l'EOF ne l'annulent.
- **`run_finished`** porte `resolved`, `unresolved`, `written`, `write_error`, `awaiting_arbitration` dans les deux phases.
- **Code Python sans accents**, docstrings et commentaires en français, le pourquoi seulement.
- **Tests** : noms en anglais, AAA séparé par des lignes vides, attentes bornées par `ndjson_loop` (10 s).
- **Gate vert à chaque commit** : `just lint-sidecar`, `just typecheck-sidecar`, `just test-sidecar`, plus `just lint-ui`, `just typecheck-ui` et `just test-ui` quand `protocol.ts` ou les specs Angular changent. Commits `type(scope): description`, scope `sidecar` ou `ui`.

## Review Focus

- **`start_tagging` pendant l'écriture** : refusé en `write_in_progress`, le run courant n'est ni remplacé ni fermé (Task 2, `test_refuses_writes_and_new_runs_while_writing`, cas `start_tagging`).
- **`shutdown` arrivé en pleine écriture** : le fichier en cours va à son terme et `run_finished(write)` part (Task 2, `test_neither_cancel_nor_shutdown_cuts_a_write`).
- **Décision envoyée après la confirmation** par un clic tardif (arbitrage, bascule de source ou rattrapage) : `run_committed` sur la bonne ligne (Task 2, `test_refuses_decisions_once_the_run_is_committed`, trois cas).
- **Dump impossible à la confirmation** : `tag_dump_write_failed`, aucun fichier touché, puis la même confirmation réussit (Task 2, `test_lets_the_run_be_confirmed_again_when_the_dump_cannot_be_written`).
- **`commit_run` d'un ancien run** après un nouveau lancement : `write_not_open` (Task 2, `test_refuses_writing_another_run`).
- **Interface encore à l'ancien contrat** sur `run_finished` : les fixtures Angular portent les nouveaux compteurs, `tsc` refuse un oubli (Task 1, Step 6).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `sidecar/src/tagger/protocol.py` | `CommitRun`, `RetryWrite`, unions, `CommandName`, compteurs de `RunFinished`. |
| `sidecar/src/tagger/handlers.py` | `RunWriter` du run courant, traduction de l'écriture, `run_finished` par phase. |
| `sidecar/src/tagger/__main__.py` | Écriture en tâche de fond, gardes, run figé, erreurs. |
| `sidecar/tests/integration/test_ndjson_write.py` | Conversation d'écriture et ses refus. |
| `sidecar/tests/helpers/ndjson_loop.py` | `resolved_run` et `held_call`, partagés avec le sub-project 06 : l'un et l'autre pilotent la boucle NDJSON, comme `conversation`. |
| `sidecar/tests/integration/test_ndjson_tagging.py` | `run_finished(network)` complété. |
| `src/app/core/models/protocol.ts` | Miroir du contrat. |
| `src/app/core/tagging-run.store.spec.ts`, `src/app/core/sidecar.service.spec.ts` | Événements `run_finished` complétés. |
| `public/i18n/{fr,en}.json` | Trois codes d'erreur. |
| `docs/ARCHITECTURE.md` | § API. |

---

### Task 1: Commandes et compteurs du contrat, et leur miroir

**Files:**
- Modify: `sidecar/src/tagger/protocol.py:157-205` (après `ResolveByUrl`, unions, `CommandName`) et `:418-426` (`RunFinished`)
- Modify: `sidecar/src/tagger/handlers.py` (`_run_finished`, appel de `handle_start_tagging`)
- Modify: `sidecar/tests/integration/test_ndjson_tagging.py:46-53`
- Modify: `src/app/core/models/protocol.ts:106-123,160-165,245-252`
- Modify: `src/app/core/tagging-run.store.spec.ts:14-21`
- Modify: `src/app/core/sidecar.service.spec.ts:450-458,481-489`

**Interfaces:**
- Consumes: `tagging.TrackState.WRITTEN` / `WRITE_ERROR` (sub-project 04).
- Produces: `protocol.CommitRun(command="commit_run", run_id: str)`, `protocol.RetryWrite(command="retry_write", run_id: str)` ; `RunFinished.written: int`, `RunFinished.write_error: int` ; `handlers._run_finished(run: TaggingRun, phase: RunPhase) -> RunFinished` ; côté TS `CommitRunCommand`, `RetryWriteCommand`, `TrackState` à quatre valeurs, `TrackFailureReason` à onze, `RunFinishedEvent.written` / `write_error`.

- [ ] **Step 1: Attendre les compteurs dans la séquence d'un run**

Dans `sidecar/tests/integration/test_ndjson_tagging.py`, le `run_finished` attendu de `test_emits_the_whole_sequence_of_a_tagging_run` devient :

```python
    assert events[-2] == {
        "event": "run_finished",
        "phase": "network",
        "run_id": events[0]["run_id"],
        "resolved": 1,
        "unresolved": 1,
        "written": 0,
        "write_error": 0,
        "awaiting_arbitration": 1,
    }
```

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `cd sidecar && uv run pytest tests/integration/test_ndjson_tagging.py --no-cov -q`
Expected: FAIL sur `test_emits_the_whole_sequence_of_a_tagging_run`

- [ ] **Step 3: Déclarer les commandes**

Dans `sidecar/src/tagger/protocol.py`, après `ResolveByUrl` :

```python
class CommitRun(Command):
    """Confirmation globale : le point de non-retour, seul geste qui ecrit des fichiers."""

    command: Literal["commit_run"]
    run_id: str


class RetryWrite(Command):
    """Rejoue l'ecriture des seuls morceaux en echec, sans reseau ni arbitrage."""

    command: Literal["retry_write"]
    run_id: str
```

Ajouter `| CommitRun | RetryWrite` à la fin des unions `AnyCommand` (avant `Field(discriminator="command")`) et `ExecutableCommand`, et `"commit_run", "retry_write"` à la fin de `CommandName`.

- [ ] **Step 4: Compter l'écriture dans `run_finished`**

`RunFinished` :

```python
class RunFinished(Event):
    """Fin d'une phase du run ; les compteurs se relisent sur l'etat de chaque morceau."""

    event: Literal["run_finished"]
    phase: RunPhase
    run_id: str
    resolved: int
    unresolved: int
    written: int
    write_error: int
    awaiting_arbitration: int
```

Dans `sidecar/src/tagger/handlers.py`, `_run_finished` prend la phase :

```python
def _run_finished(run: TaggingRun, phase: RunPhase) -> RunFinished:
    # Chaque compteur se lit sur le champ de son issue, jamais sur l'absence d'un autre : un
    # `state` laisse vide gonflerait en silence le compte des arbitrages.
    states = Counter(record.state for record in run.tracks)
    return RunFinished(
        event="run_finished",
        phase=phase,
        run_id=run.run_id,
        resolved=states[tagging.TrackState.RESOLVED],
        unresolved=states[tagging.TrackState.UNRESOLVED],
        written=states[tagging.TrackState.WRITTEN],
        write_error=states[tagging.TrackState.WRITE_ERROR],
        awaiting_arbitration=sum(1 for record in run.tracks if record.arbitration is not None),
    )
```

et `handle_start_tagging` émet `_run_finished(current.live.snapshot(), RunPhase.NETWORK)`.

- [ ] **Step 5: Mirrorer le contrat**

Dans `src/app/core/models/protocol.ts`, après `ResolveByUrlCommand` :

```ts
/** Confirmation globale : le point de non-retour, seul geste qui ecrit des fichiers. */
export interface CommitRunCommand {
  readonly command: "commit_run"
  readonly run_id: string
}

/** Rejoue l'ecriture des seuls morceaux en echec. */
export interface RetryWriteCommand {
  readonly command: "retry_write"
  readonly run_id: string
}
```

`SidecarCommand` se termine par `| ResolveByUrlCommand | CommitRunCommand | RetryWriteCommand`. Puis :

```ts
/** Etat d'un morceau, en trois champs jamais interchangeables (ARCHITECTURE.md § API). */
export type TrackState = "resolved" | "unresolved" | "written" | "write_error"
```

```ts
export type TrackFailureReason =
  | "empty_query"
  | "no_result"
  | "below_threshold"
  | "user_refused"
  | "source_unavailable"
  | "permission_denied"
  | "disk_full"
  | "path_too_long"
  | "file_locked"
  | "file_missing"
  | "write_failed"
```

et `RunFinishedEvent` gagne, après `unresolved` :

```ts
  readonly written: number
  readonly write_error: number
```

- [ ] **Step 6: Compléter les événements des specs Angular**

Dans `src/app/core/tagging-run.store.spec.ts` (`FINISHED`) et dans les deux `run_finished` émis par `src/app/core/sidecar.service.spec.ts`, ajouter après `unresolved` :

```ts
  written: 0,
  write_error: 0,
```

- [ ] **Step 7: Vérifier que tout passe**

Run: `cd sidecar && uv run pytest tests/integration/test_ndjson_tagging.py tests/unit/test_protocol_models.py --no-cov -q`
Expected: PASS (`test_command_name_lists_every_command` compris)

Run: `just typecheck-ui && just test-ui`
Expected: PASS

- [ ] **Step 8: Lancer le gate**

Run: `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar && just lint-ui`
Expected: tout passe.

- [ ] **Step 9: Commit**

```bash
git add sidecar/src/tagger/protocol.py sidecar/src/tagger/handlers.py sidecar/tests/integration/test_ndjson_tagging.py src/app/core/models/protocol.ts src/app/core/tagging-run.store.spec.ts src/app/core/sidecar.service.spec.ts
git commit -m "feat(sidecar): commandes commit_run et retry_write, compteurs d'écriture de run_finished"
```

---

### Task 2: Écrire en tâche de fond, gardes et run figé

**Files:**
- Modify: `sidecar/src/tagger/handlers.py` (imports, `CurrentRun`, `handle_commit_run`, `handle_retry_write`, `PipelineEvent`, `_relay`, `to_protocol_event`)
- Modify: `sidecar/src/tagger/__main__.py` (imports, erreurs, `_Session`, `_dispatch`)
- Modify: `sidecar/tests/helpers/ndjson_loop.py` (`resolved_run`, `HeldCall`, `held_call`)
- Create: `sidecar/tests/integration/test_ndjson_write.py`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`

**Interfaces:**
- Consumes: Task 1 ; `writing.RunWriter`, `writing.WriteProgress`, `writing.WriteEvent` ; `tag_dump.dump_dir`, `TagDumpWriteError`.
- Produces: `handlers.CurrentRun.writer: RunWriter | None`, `CurrentRun.committed: bool`, `CurrentRun.busy: bool` ; `handlers.handle_commit_run(current, emit) -> Event`, `handlers.handle_retry_write(current, emit) -> Event` ; codes `write_not_open`, `write_in_progress`, `run_committed` ; aides de test `ndjson_loop.resolved_run(talk, folder) -> str` et `ndjson_loop.held_call(monkeypatch, module, name) -> HeldCall`. Le sub-project 06 réutilise le run courant, ses gardes et ces aides pour `rollback`.

- [ ] **Step 1: Écrire les aides partagées et les tests d'intégration**

Dans `sidecar/tests/helpers/ndjson_loop.py`, ajouter `import threading` après `import queue`, `import pytest` sous `TYPE_CHECKING` (après `from pathlib import Path`, séparé par une ligne vide), puis en fin de fichier :

```python
async def resolved_run(talk: Conversation, folder: Path) -> str:
    """Lance un run sur `folder` et rend son `run_id`, phase reseau finie."""
    talk.send(command="start_tagging", folder=str(folder))
    started = await talk.expect("run_started")
    await talk.expect("run_finished", phase="network")
    run_id = started["run_id"]
    assert isinstance(run_id, str)
    return run_id


class HeldCall:
    """Appel retenu dans son thread : `reached` a son arrivee, `release` le lache."""

    def __init__(self) -> None:
        self.reached = threading.Event()
        self.release = threading.Event()

    async def wait_reached(self) -> None:
        await asyncio.to_thread(self.reached.wait, EXPECT_TIMEOUT)


def held_call(monkeypatch: pytest.MonkeyPatch, module: object, name: str) -> HeldCall:
    """Remplace `module.name` par un appel retenu jusqu'a `release`."""
    held = HeldCall()
    real = getattr(module, name)

    def wrapper(*args: object) -> object:
        held.reached.set()
        held.release.wait(timeout=EXPECT_TIMEOUT)
        return real(*args)

    monkeypatch.setattr(module, name, wrapper)
    return held
```

`sidecar/tests/integration/test_ndjson_write.py` :

```python
"""Protocole NDJSON de l'ecriture d'un run, de bout en bout sur la boucle."""

from typing import TYPE_CHECKING

import pytest
from ndjson_loop import conversation, held_call, resolved_run
from scraper_responses import YOUR_MIND
from tagging_api import ONE_TRACK, ORIGINAL, FakeApi, found, one_track

from tagger import files, tag_dump, writing
from tagger.file_failures import FileFailureReason
from tagger.files import TagsWriteError
from tagger.tag_dump import TagDumpWriteError

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

pytestmark = [pytest.mark.asyncio, pytest.mark.usefixtures("_key")]

WRITTEN = "Adam Beyer - Your Mind (Original Mix).mp3"


@pytest.fixture
def folder(tmp_path: Path, app_data: None, api: FakeApi) -> Path:
    """« Your Mind » que Beatport resout d'office : le run finit avec un morceau a ecrire."""
    api.on("/beatport/search", YOUR_MIND, found(ORIGINAL))
    return one_track(tmp_path)


def _locked_until_lifted(monkeypatch: pytest.MonkeyPatch) -> Callable[[], None]:
    """Ecriture refusee comme un fichier verrouille ; rend de quoi lever le verrou."""
    real_write = files.write_tags

    def locked(path: Path, *_args: object) -> object:
        raise TagsWriteError(path, FileFailureReason.FILE_LOCKED)

    monkeypatch.setattr(writing, "write_tags", locked)
    return lambda: monkeypatch.setattr(writing, "write_tags", real_write)


async def test_writes_a_committed_run_end_to_end(folder: Path, tmp_path: Path) -> None:
    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="commit_run", run_id=run_id)
        written = await talk.expect("track_resolved", track_id=ONE_TRACK, state="written")
        progress = await talk.expect("progress", phase="write")
        finished = await talk.expect("run_finished", phase="write")

    assert written["resolution"] == "auto"
    assert (progress["processed"], progress["total"]) == (1, 1)
    assert (finished["written"], finished["write_error"]) == (1, 0)
    assert (folder / WRITTEN).is_file()
    assert list((tmp_path / "appdata").rglob(f"*-{run_id}.json"))


@pytest.mark.parametrize("command", ["commit_run", "retry_write"])
async def test_refuses_writing_another_run(folder: Path, command: str) -> None:
    async with conversation() as talk:
        await resolved_run(talk, folder)
        talk.send(command=command, run_id="000000")
        error = await talk.expect("error")

    assert (error["code"], error["command"]) == ("write_not_open", command)


async def test_refuses_a_commit_while_the_network_phase_runs(folder: Path, api: FakeApi) -> None:
    gate = api.gate("/beatport/search", YOUR_MIND)

    async with conversation() as talk:
        talk.send(command="start_tagging", folder=str(folder))
        started = await talk.expect("run_started")
        await gate.reached.wait()
        talk.send(command="commit_run", run_id=started["run_id"])
        error = await talk.expect("error")
        gate.release.set()
        await talk.expect("run_finished", phase="network")

    assert (error["code"], error["command"]) == ("write_not_open", "commit_run")


async def test_refuses_a_second_commit(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="commit_run", run_id=run_id)
        await talk.expect("run_finished", phase="write")
        talk.send(command="commit_run", run_id=run_id)
        error = await talk.expect("error")

    assert error["code"] == "write_not_open"


async def test_refuses_a_retry_before_any_commit(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="retry_write", run_id=run_id)
        error = await talk.expect("error")

    assert (error["code"], error["command"]) == ("write_not_open", "retry_write")


@pytest.mark.parametrize(
    "decision",
    [
        {"command": "resolve_arbitration", "source": "beatport", "candidate": 0},
        {"command": "switch_arbitration_source", "source": "beatport"},
        {"command": "resolve_by_url", "url": "https://x.bandcamp.com/track/y"},
    ],
    ids=["resolve-arbitration", "switch-arbitration-source", "resolve-by-url"],
)
async def test_refuses_decisions_once_the_run_is_committed(
    folder: Path, decision: dict[str, object]
) -> None:
    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="commit_run", run_id=run_id)
        await talk.expect("run_finished", phase="write")
        talk.send(track_id=ONE_TRACK, **decision)
        error = await talk.expect("error")

    assert (error["code"], error["command"], error["params"]) == (
        "run_committed",
        decision["command"],
        {"track_id": ONE_TRACK},
    )


async def test_lets_the_run_be_confirmed_again_when_the_dump_cannot_be_written(
    folder: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    real_save = tag_dump.save_entries

    def full_disk(*_args: object) -> object:
        raise TagDumpWriteError(folder / "x.json")

    monkeypatch.setattr(writing, "save_entries", full_disk)

    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="commit_run", run_id=run_id)
        refused = await talk.expect("error")
        monkeypatch.setattr(writing, "save_entries", real_save)
        talk.send(command="commit_run", run_id=run_id)
        finished = await talk.expect("run_finished", phase="write")

    assert (refused["code"], refused["command"]) == ("tag_dump_write_failed", "commit_run")
    assert (finished["written"], finished["write_error"]) == (1, 0)
    assert (folder / WRITTEN).is_file()


async def test_retries_a_failed_write(folder: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    lift = _locked_until_lifted(monkeypatch)

    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="commit_run", run_id=run_id)
        failed = await talk.expect("track_resolved", state="write_error")
        first = await talk.expect("run_finished", phase="write")
        lift()
        talk.send(command="retry_write", run_id=run_id)
        await talk.expect("track_resolved", state="written")
        second = await talk.expect("run_finished", phase="write")

    assert failed["failure_reason"] == "file_locked"
    assert (first["written"], first["write_error"]) == (0, 1)
    assert (second["written"], second["write_error"]) == (1, 0)
    assert (folder / WRITTEN).is_file()


@pytest.mark.parametrize("command", ["commit_run", "retry_write", "start_tagging"])
async def test_refuses_writes_and_new_runs_while_writing(
    folder: Path, monkeypatch: pytest.MonkeyPatch, command: str
) -> None:
    held = held_call(monkeypatch, writing, "write_tags")

    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="commit_run", run_id=run_id)
        await held.wait_reached()
        if command == "start_tagging":
            talk.send(command=command, folder=str(folder))
        else:
            talk.send(command=command, run_id=run_id)
        error = await talk.expect("error")
        held.release.set()
        await talk.expect("run_finished", phase="write")

    assert (error["code"], error["command"]) == ("write_in_progress", command)


async def test_neither_cancel_nor_shutdown_cuts_a_write(
    folder: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    held = held_call(monkeypatch, writing, "write_tags")

    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="commit_run", run_id=run_id)
        await held.wait_reached()
        talk.send(command="cancel_run")
        talk.send(command="shutdown")
        held.release.set()
        finished = await talk.expect("run_finished", phase="write")

    assert finished["written"] == 1
    assert (folder / WRITTEN).is_file()
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `cd sidecar && uv run pytest tests/integration/test_ndjson_write.py --no-cov -q`
Expected: FAIL, `commit_run` sans handler (`assert_never` ou `error` inattendu)

- [ ] **Step 3: Poser l'écrivain sur le run courant et traduire l'écriture**

Dans `sidecar/src/tagger/handlers.py` : `from tagger import __version__, arbitration, tagging, url_recovery, writing` ; `from tagger.tag_dump import TagDumpWriteError, dump_dir` après l'import de `sources` ; `from tagger.writing import RunWriter` après celui d'`url_recovery` ; sous `TYPE_CHECKING`, `from tagger.writing import WriteEvent`.

Dans `CurrentRun.__init__`, après `self.url_recovery = url_recovery` :

```python
        # Pose a la confirmation : sa presence fige le run, plus aucune decision n'y entre.
        self.writer: RunWriter | None = None
```

et avant `track` :

```python
    @property
    def committed(self) -> bool:
        return self.writer is not None

    @property
    def busy(self) -> bool:
        """Un geste d'arbitrage ou de rattrapage est en vol."""
        return any(not gesture.done() for gesture in self._gestures)
```

Avant `_thresholds` :

```python
async def handle_commit_run(current: CurrentRun, emit: Callable[[Event], None]) -> Event:
    """Ecrit le run confirme ; le `RunWriter` reste au run courant, pour la relance.

    Un dump qui ne s'enregistre pas ne change rien : le run redevient confirmable.
    """
    current.writer = RunWriter(current.live, dump_dir(), _relay(emit))
    try:
        await current.writer.write()
    except TagDumpWriteError:
        current.writer = None
        raise
    return _run_finished(current.live.snapshot(), RunPhase.WRITE)


async def handle_retry_write(current: CurrentRun, emit: Callable[[Event], None]) -> Event:
    """Rejoue les echecs d'ecriture ; la session n'appelle qu'un run deja confirme."""
    if current.writer is None:
        raise ValueError("retry of a run never committed")
    await current.writer.retry()
    return _run_finished(current.live.snapshot(), RunPhase.WRITE)
```

`_relay` et la signature de `to_protocol_event` :

```python
type PipelineEvent = tagging.RunEvent | ArbitrationEvent | UrlRecoveryEvent | WriteEvent


def _relay(emit: Callable[[Event], None]) -> Callable[[PipelineEvent], None]:
    return lambda event: emit(to_protocol_event(event))


# PLR0911 : une sortie par evenement traduit, le `match` ferme par `assert_never` etant
# ce qui rend un oubli visible au typage.
def to_protocol_event(event: PipelineEvent) -> Event:  # noqa: PLR0911
    """Traduit un evenement pipeline, arbitrage, rattrapage ou ecriture."""
```

et, avant `case _: assert_never(event)` :

```python
        case writing.WriteProgress():
            return Progress(
                event="progress",
                phase=Phase.WRITE,
                processed=event.processed,
                total=event.total,
            )
```

- [ ] **Step 4: Écrire en tâche de fond et garder la session**

Dans `sidecar/src/tagger/__main__.py`, importer `handle_commit_run` et `handle_retry_write` de `tagger.handlers`, `CommitRun` et `RetryWrite` de `tagger.protocol`. Avant `class _Session` :

```python
class WriteNotOpenError(TaggerError):
    """Run inconnu ou remplace, phase reseau en cours, deja confirme pour `commit_run` ou
    jamais confirme pour `retry_write`."""

    code: ClassVar[str] = "write_not_open"

    def __init__(self) -> None:
        super().__init__("the run is not open to writing")


class WriteInProgressError(TaggerError):
    """Ecriture en cours : une seconde ecriture ou un nouveau run toucherait ses fichiers."""

    code: ClassVar[str] = "write_in_progress"

    def __init__(self) -> None:
        super().__init__("a write is already in progress")


class RunCommittedError(TaggerError):
    """Run confirme : plus aucune decision n'entre sur ses morceaux, point de non-retour."""

    code: ClassVar[str] = "run_committed"

    def __init__(self, track_id: str) -> None:
        super().__init__("the run is committed", track_id=track_id)
```

Dans `_Session.__init__`, après `self._extraction` : `self._write: asyncio.Task[None] | None = None`.

`start_tagging` commence par :

```python
        if self._active(self._write) is not None:
            raise WriteInProgressError
```

Avant `close` :

```python
    def commit_run(self, command: CommitRun) -> None:
        """Ecriture en tache de fond, comme l'extraction : stdin reste lu pendant sa progression."""
        current = self._writable(command.run_id)
        if current.committed:
            raise WriteNotOpenError
        start_work = functools.partial(handle_commit_run, current, self.send)
        self._write = self._group.create_task(self._phase(start_work, command), name="write")

    def retry_write(self, command: RetryWrite) -> None:
        current = self._writable(command.run_id)
        if not current.committed:
            raise WriteNotOpenError
        start_work = functools.partial(handle_retry_write, current, self.send)
        self._write = self._group.create_task(self._phase(start_work, command), name="write")
```

La docstring de `close` devient :

```python
        """`shutdown` annule la phase reseau, l'EOF l'attend ; le run courant se ferme ensuite.

        L'ecriture n'est jamais annulee, le `TaskGroup` de la boucle l'attend : un fichier coupe
        resterait a moitie ecrit.
        """
```

`_arbitrable` et `_recoverable` refusent un run confirmé, juste avant leur `return self._current` :

```python
        if self._current.committed:
            raise RunCommittedError(track_id)
```

Après `_recoverable` :

```python
    def _writable(self, run_id: str) -> CurrentRun:
        """Run courant designe, phase reseau finie ou interrompue, sans ecriture ni geste en vol.

        Un geste qui finirait pendant l'ecriture ecraserait un morceau ecrit.
        """
        if self._active(self._write) is not None:
            raise WriteInProgressError
        current = self._current
        if (
            current is None
            or current.live.run_id != run_id
            or current.busy
            or self._active_run() is not None
        ):
            raise WriteNotOpenError
        return current
```

Le paramètre `command` de `_phase` devient `StartTagging | ExtractPlaylist | ResolveArbitration | ResolveByUrl | CommitRun | RetryWrite` (entre parenthèses, sur plusieurs lignes). Dans `_dispatch`, avant `case _:` :

```python
        case CommitRun():
            session.commit_run(command)
        case RetryWrite():
            session.retry_write(command)
```

- [ ] **Step 5: Traduire les trois codes**

Dans `errors`, juste après `tagging_in_progress` :

`public/i18n/fr.json` (espace insécable avant le deux-points) :

```json
    "write_not_open": "Ce run ne peut pas être écrit maintenant.",
    "write_in_progress": "L'écriture est en cours. Attendez qu'elle se termine.",
    "run_committed": "L'écriture de ce run est confirmée : il n'accepte plus de décision.",
```

`public/i18n/en.json` :

```json
    "write_not_open": "This run cannot be written now.",
    "write_in_progress": "Writing is in progress. Wait for it to finish.",
    "run_committed": "Writing this run is confirmed: it accepts no more decisions.",
```

- [ ] **Step 6: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/integration/test_ndjson_write.py tests/unit/test_error_translations.py --no-cov -q`
Expected: PASS (15 cas d'intégration)

- [ ] **Step 7: Lancer le gate**

Run: `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar && just lint-ui`
Expected: tout passe.

- [ ] **Step 8: Commit**

```bash
git add sidecar/src/tagger/handlers.py sidecar/src/tagger/__main__.py sidecar/tests/integration/test_ndjson_write.py public/i18n/fr.json public/i18n/en.json
git commit -m "feat(sidecar): confirmer et relancer l'écriture d'un run sur le protocole NDJSON"
```

---

### Task 3: Contrat de l'écriture dans l'architecture

**Files:**
- Modify: `docs/ARCHITECTURE.md` (§ API, tableau des commandes l. 430-431 et 438-439, des événements l. 455-457, paragraphes sous les tableaux dont l. 465 ; § Concurrence l. 553-555 ; § Robustesse l. 791)

- [ ] **Step 1: Documenter le contrat livré**

Charger `Skill[architecture-doc]` avant d'éditer. Dans `docs/ARCHITECTURE.md` § API :
- `shutdown` (l. 430) : « … et **attend l'extraction et l'écriture** si elles sont en cours ; l'EOF attend les trois » ; `cancel_run` (l. 431) : « L'extraction et l'écriture restent attendues jusqu'à leur terme, comme sous `shutdown` : `cancel_run` n'arrête que la phase réseau » ;
- `commit_run` : « identifiant du run. Acceptée sur le run courant dont la phase réseau ne tourne plus, sans geste d'arbitrage ni de rattrapage en vol, et jamais confirmé, sinon `write_not_open` ; pendant une écriture, `write_in_progress`. Fige le run : arbitrage, bascule de source et rattrapage sont ensuite refusés en `run_committed` (`params.track_id`). Ni `cancel_run`, ni `shutdown`, ni l'EOF n'annulent l'écriture » ;
- `retry_write` : ajouter « acceptée sur le run courant déjà confirmé, sinon `write_not_open` » ;
- `start_tagging` : « refusé en `write_in_progress` pendant une écriture » ;
- `run_finished` : compteurs `resolved`, `unresolved`, `written`, `write_error` et attentes d'arbitrage, dans les deux phases ;
- `progress` : la phase `write` mesure les morceaux traités sur les morceaux visés par l'écriture ou la relance ;
- paragraphe sous les tableaux (l. 465), « Le code `tagging_in_progress` est l'exception qui confirme la règle » : l'exception s'étend à `write_in_progress`, porté par `start_tagging` pendant une écriture : il refuse un lancement sans clore le run affiché ;
- § Concurrence (l. 553-555) : « Les deux phases longues tournent en tâche de fond » devient trois, l'écriture refusant d'être relancée par `write_in_progress` ; « L'annulation les sépare » : `shutdown` attend l'extraction **et l'écriture**, un fichier musical coupé en vol restant à moitié écrit, et seule la phase réseau est annulée ;
- § Robustesse, sidecar qui meurt pendant un run (l. 791) : « aucun fichier musical n'a été touché » n'est vrai que hors écriture ; pendant l'écriture, des fichiers peuvent être à moitié écrits et le dump des tags d'origine les restaure au lancement suivant.

- [ ] **Step 2: Vérifier le rendu**

Run: `just lint-ui`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs(sidecar): contrat NDJSON de l'écriture"
```
