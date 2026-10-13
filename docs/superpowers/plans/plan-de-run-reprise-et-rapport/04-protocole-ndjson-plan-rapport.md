# Contrat NDJSON du plan, de la reprise et des rapports : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Figer dans le contrat NDJSON la détection, la reprise et l'abandon d'un run interrompu, les rapports de re-tagging et les runs passés, avant tout TypeScript qui s'en sert.

**Architecture:** `protocol.py` reçoit, tâche par tâche :
- deux champs : `run_finished.report_path` et `track_resolved.source_url` ;
- trois commandes et un événement pour l'annonce, l'abandon et la reprise d'un run interrompu : `get_interrupted_run`, `discard_run`, `resume_run`, `interrupted_run` ;
- deux commandes et deux événements pour les runs passés : `list_runs`, `load_run`, `runs_listed`, `run_loaded`.

`handlers.py` traduit le domaine des sub-projects 01 à 03. `open_tagging` y est factorisé, pour que `resume_run` ouvre les mêmes clients qu'un run neuf avant de passer par `reopen_run`. `__main__.py` les route : `resume_run` sur la mécanique de `start_tagging`, `load_run` en tâche de fond annulée à la fermeture. Chaque tâche livre ensemble le contrat Python et son miroir `protocol.ts` : `SidecarService` reconnaît les nouveaux événements, sans store.

**Tech Stack:** Python 3.14, pydantic 2, pytest + pytest-asyncio ; TypeScript, Angular 22, Vitest. Helpers `ndjson_loop`, `tagging_api`, `scraper_responses`, `run_plans` (sub-projects 01 et 02).

**Spec:** `docs/superpowers/specs/plan-de-run-reprise-et-rapport/04-protocole-ndjson-plan-rapport-design.md`

## Global Constraints

- **Dépend des sub-projects 01, 02 et 03, implémentés avant** :
  - 01 : `PlanRecorder`, `RunPlan.opened`, `plan_dir`, `load_plan`, `RunPlanUnreadableError`, `CurrentRun.plan`, `CurrentRun.abandon`, `handlers._open_plan`, `tests/helpers/run_plans.py` (`RUN_ID`, `music`, `plan_of`, `save_plan`, `plan_files`, `only_plan`) ;
  - 02 : `resume.detect_interrupted(plans, dumps, *, active_run_id=None)`, `InterruptedRun`, `UnreadablePlan`, `find_plan`, `plan.discard_plan`, `reopen_run` (lève `TaggingFolderUnreadableError` sur un dossier sans fichier audio), `PlanThresholds.to_matching`, `resolve_run` sélectif ;
  - 03 : `CurrentRun.report`, `tagging_report.load_tagging_report`, `TaggingReportUnreadableError`, `TaggingReport`, `TaggingReportTrack` (dont `system`), `report_index.list_reports`, `index_path`.
- **Noms du contrat, figés** :
  - commandes : `get_interrupted_run`, `resume_run`, `discard_run`, `list_runs`, `load_run` ;
  - événements : `interrupted_run`, `runs_listed`, `run_loaded` ;
  - discriminant `kind`, qui vaut `"interrupted"` ou `"unreadable"` ;
  - champs `report_path` et `source_url` ;
  - code d'erreur `run_not_found`, param `run_id`.
- **Commandes** : `extra="forbid"`, `strict=True` (classe `Command`). **Événements** : `frozen` (classe `Event`). Jamais de phrase émise, seulement `code` et `params`.
- **`get_interrupted_run` et la réponse de `discard_run`** passent le `run_id` du run ouvert à `detect_interrupted` : un run ouvert n'est jamais annoncé comme interrompu.
- **`discard_run`** répond toujours par un nouvel `interrupted_run`. Sur le run courant, il l'abandonne. Il est refusé en `phase_busy` pendant une phase longue.
- **`resume_run`** suit `start_tagging` : `phase_busy`, `api_key_missing`, phase `tagging`. Il valide le plan avant d'abandonner le run affiché : `find_plan`, `load_plan`, refus par `run_not_found` d'un plan confirmé ou dont le run a un dump, puis abandon, puis `reopen_run`.
- **`load_run`** tourne en tâche de fond, refusée en `phase_busy` pendant une phase longue et annulée à la fermeture de la session. Ses pochettes passent par un `ArtworkFetcher` ouvert pour la tâche (cache puis CDN), sans clé API. `TrackLoaded` n'a pas de `restorable`.
- **Miroir TS** : chaque champ, commande ou événement ajouté côté Python l'est côté TS dans la même tâche et le même commit, fixtures, store et specs compris. Les trois événements sont reconnus sans effet dans `handleLine`.
- **Code Python sans accents**, docstrings et commentaires en français, le pourquoi seulement. Commentaires TypeScript sans accents, comme le code existant.
- **Tests** : noms en anglais, AAA (l'Act est l'appel testé), `@pytest.mark.asyncio` et `_key` sur les tests NDJSON. Aucun test de plomberie Pydantic ou de TypeScript (no-lib-test).
- **Gate vert à chaque commit** :
  - `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar` ;
  - plus `just lint-ui && just typecheck-ui && just test-ui` quand le TS ou un JSON de langue change.

  Commits `type(scope): description`, scope `sidecar` ou `ui`.

## Review Focus

- **Deux sessions de suite sur le même plan** (crash, relance, reprise) : la seconde session reprend sans relancer les morceaux déjà traités (Task 3, `test_resumes_a_run_cut_short_by_a_shutdown`).
- **`resume_run` alors qu'aucune clé API n'est enregistrée** : refusé en `api_key_missing` et le plan reste en place (Task 3, `test_refuses_to_resume_without_an_api_key`).
- **`resume_run` d'un plan confirmé ou dont le run a un dump, pendant qu'un autre run est ouvert** : refusé en `run_not_found`, le plan reste et le run ouvert n'est pas abandonné (Task 3, `test_refuses_a_plan_that_cannot_be_resumed_and_keeps_the_open_run`).
- **Run ouvert dans la session** : jamais annoncé comme interrompu, ni par `get_interrupted_run` ni par la réponse de `discard_run` et `discard_run` du run courant le ferme (Task 2, `test_does_not_announce_the_run_in_progress`, `test_discarding_an_interrupted_plan_does_not_announce_the_open_run`, `test_discarding_the_current_run_abandons_it`).
- **Plan corrompu sans version** : `found` nul, de quoi afficher « illisible » et non « version null » (Task 2, `test_announces_a_corrupt_plan_without_a_version`).
- **`load_run` sur un rapport corrompu, une pochette refusée par le CDN, une session fermée en cours de chargement** : `tagging_report_unreadable`, `artwork_path` nul, aucune attente infinie (Task 4, `test_reports_an_unreadable_report`, `test_loads_a_run_whose_artwork_is_unavailable`, `test_cancels_a_load_in_flight_when_the_session_ends`).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `sidecar/src/tagger/protocol.py` | Commandes, événements, charges et champs ajoutés |
| `sidecar/src/tagger/handlers.py` | `RunNotFoundError`, ouverture factorisée, handlers des cinq commandes, `source_url`, `report_path` |
| `sidecar/src/tagger/__main__.py` | Dispatch, `_Session.announce_interrupted_run`, `discard_run`, `resume_run`, `load_run` |
| `public/i18n/{fr,en}.json` | `errors.run_not_found` |
| `sidecar/tests/integration/test_ndjson_resume.py` | Détection, reprise, abandon |
| `sidecar/tests/integration/test_ndjson_reports.py` | `report_path`, `list_runs`, `load_run` |
| `sidecar/tests/integration/test_ndjson_tagging.py` | `report_path` et `source_url` |
| `src/app/core/models/protocol.ts` | Miroir TS |
| `src/app/core/sidecar.service.ts` | `KNOWN_EVENTS`, cas sans effet |
| `src/app/core/tagging-run.store.ts` | `restored()` : `source_url` |
| `src/fixtures/tagging.ts`, `url-recovery.ts`, `write.ts` | Champs ajoutés |
| `src/app/core/sidecar.service.spec.ts`, `tagging-run.store.spec.ts` | Littéraux `run_finished` |
| `docs/ARCHITECTURE.md` | Contrat |

---

### Task 1: `report_path` et `source_url`, contrat et miroir

**Files:**
- Modify: `sidecar/src/tagger/protocol.py` (`RunFinished`, `TrackResolved`)
- Modify: `sidecar/src/tagger/handlers.py` (`_resolved`, `_run_finished`, `handle_commit_run`, `handle_retry_write`)
- Create: `sidecar/tests/integration/test_ndjson_reports.py`
- Modify: `sidecar/tests/integration/test_ndjson_tagging.py`
- Modify: `src/app/core/models/protocol.ts`
- Modify: `src/app/core/tagging-run.store.ts` (`restored`)
- Modify: `src/fixtures/tagging.ts`, `src/fixtures/url-recovery.ts`, `src/fixtures/write.ts`
- Modify: `src/app/core/sidecar.service.spec.ts`, `src/app/core/tagging-run.store.spec.ts`

**Interfaces:**
- Consumes: `CurrentRun.report` (sub-project 03).
- Produces :
  - `RunFinished.report_path: Path | None = None` et `TrackResolved.source_url: str | None = None` ;
  - `handlers._run_finished(run: TaggingRun, phase: RunPhase, report: ReportPaths | None = None) -> RunFinished` ;
  - côté TS, `TrackResolvedEvent.source_url: string | null` et `RunFinishedEvent.report_path: string | null`.

- [ ] **Step 1: Écrire les tests**

Dans `sidecar/tests/integration/test_ndjson_tagging.py`, ajouter `"report_path": None,` à la fin du littéral attendu de `run_finished` dans `test_emits_the_whole_sequence_of_a_tagging_run`, après `"awaiting_arbitration": 1,`. Puis ajouter, à la suite du test `test_describes_a_resolved_track_with_its_source_its_scores_and_its_artwork` :

```python
@pytest.mark.usefixtures("_key")
def test_gives_the_source_page_of_a_resolved_track_only(
    run_folder: Path, api_knowing_your_mind: FakeApi
) -> None:
    events = drive(start_tagging(run_folder))

    resolved = {event["track_id"]: event for event in events if event["event"] == "track_resolved"}
    assert resolved["a.mp3"]["source_url"] == ORIGINAL["url"]
    assert resolved["b.mp3"]["source_url"] is None
```

`sidecar/tests/integration/test_ndjson_reports.py` :

```python
"""Rapports de re-tagging et runs passes, de bout en bout sur la boucle."""

from typing import TYPE_CHECKING

import pytest
from ndjson_loop import conversation
from stubs import raising

from tagger import tagging_report

if TYPE_CHECKING:
    from pathlib import Path

pytestmark = [pytest.mark.asyncio, pytest.mark.usefixtures("_key")]


def _report_json(folder: Path) -> Path:
    (json_path,) = folder.glob("tagging-report-*.json")
    return json_path


async def test_names_the_report_when_the_write_phase_ends(folder: Path) -> None:
    async with conversation() as talk:
        talk.send(command="start_tagging", folder=str(folder))
        network = await talk.expect("run_finished", phase="network")
        talk.send(command="commit_run", run_id=network["run_id"])
        written = await talk.expect("run_finished", phase="write")

    assert network["report_path"] is None
    assert written["report_path"] == str(_report_json(folder))


async def test_leaves_the_report_path_empty_when_the_report_cannot_be_written(
    folder: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        tagging_report, "write_atomically", raising(OSError(13, "Permission denied"))
    )

    async with conversation() as talk:
        talk.send(command="start_tagging", folder=str(folder))
        network = await talk.expect("run_finished", phase="network")
        talk.send(command="commit_run", run_id=network["run_id"])
        written = await talk.expect("run_finished", phase="write")

    assert written["report_path"] is None
```

- [ ] **Step 2: Lancer les tests, ils échouent**

Run: `cd sidecar && uv run pytest tests/integration/test_ndjson_reports.py tests/integration/test_ndjson_tagging.py --no-cov -q`
Expected: FAIL, `KeyError: 'report_path'` et `KeyError: 'source_url'`.

- [ ] **Step 3: Ajouter les champs au contrat Python**

Dans `sidecar/src/tagger/protocol.py` :

1. Dans `TrackResolved`, après `restorable` :

```python
    # Lien vers la fiche source, donnee de navigation : jamais lu dans les lignes du detail.
    source_url: str | None = None
```

2. Dans `RunFinished`, en dernier champ :

```python
    # Le JSON du rapport en phase `write`, comme `extraction_finished.report_path` ; nul sinon.
    report_path: Path | None = None
```

Dans `sidecar/src/tagger/handlers.py` :

1. Dans `_resolved`, ajouter à l'appel de `TrackResolved`, après `restorable=record.restorable,` :

```python
        source_url=None if candidate is None else candidate.url,
```

2. Remplacer la signature et le corps de `_run_finished` par :

```python
def _run_finished(
    run: TaggingRun, phase: RunPhase, report: ReportPaths | None = None
) -> RunFinished:
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
        report_path=None if report is None else report.json_path,
    )
```

3. Dans `handle_commit_run` et `handle_retry_write` (versions du sub-project 03), remplacer le dernier `return` de chacune par :

```python
    return _run_finished(current.live.snapshot(), RunPhase.WRITE, current.report)
```

- [ ] **Step 4: Lancer les tests, ils passent**

Run: `cd sidecar && uv run pytest tests/integration/ --no-cov -q`
Expected: PASS

- [ ] **Step 5: Écrire le miroir TypeScript**

Dans `src/app/core/models/protocol.ts` :

1. Dans `TrackResolvedEvent`, après `restorable` :

```ts
  /** Lien vers la fiche du candidat retenu, nul sans candidat. */
  readonly source_url: string | null
```

2. Dans `RunFinishedEvent`, après `awaiting_arbitration` :

```ts
  /** JSON du rapport de re-tagging en phase `write`, nul en phase `network` ou si le rapport n'a pas pu etre ecrit. */
  readonly report_path: string | null
```

Dans `src/app/core/tagging-run.store.ts`, dans l'objet que construit `restored()`, après `tags_after: null,` :

```ts
        source_url: null,
```

Dans `src/fixtures/tagging.ts`, dans `TRACK_RESOLVED`, après `restorable: false,` :

```ts
  source_url: null,
```

Dans `src/fixtures/url-recovery.ts`, dans `resolvedByUrl`, après `restorable: false,` :

```ts
  source_url: null,
```

Dans `src/fixtures/write.ts` : `WRITE_FINISHED` porte le chemin d'un rapport, `NETWORK_FINISHED` l'étale et le remet à `null` (sans rapport avant la confirmation).

```ts
export const WRITE_FINISHED: RunFinishedEvent = {
  event: "run_finished",
  phase: "write",
  run_id: "a3f9c1",
  resolved: 0,
  unresolved: 0,
  written: 1,
  write_error: 0,
  awaiting_arbitration: 0,
  report_path: "D:/Music/Promo Octobre/tagging-report-20261005T211403Z.json",
}

/** Fin de la phase reseau d'un run resolu : ce qui precede la confirmation. */
export const NETWORK_FINISHED: RunFinishedEvent = {
  ...WRITE_FINISHED,
  phase: "network",
  resolved: 1,
  written: 0,
  report_path: null,
}
```

Dans `src/app/core/sidecar.service.spec.ts`, les deux littéraux `run_finished` (phase `network` puis phase `write`) gagnent `report_path: null,` après `awaiting_arbitration: 0,`. Dans `src/app/core/tagging-run.store.spec.ts`, la constante `FINISHED` gagne `report_path: null,` après `awaiting_arbitration: 1,`.

- [ ] **Step 6: Gate et commit**

Run: `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar && just lint-ui && just typecheck-ui && just test-ui`
Expected: tout vert

```bash
git add sidecar/src/tagger/protocol.py sidecar/src/tagger/handlers.py sidecar/tests/integration/test_ndjson_reports.py sidecar/tests/integration/test_ndjson_tagging.py src/app/core src/fixtures
git commit -m "feat(sidecar): chemin du rapport et lien de la fiche source dans le contrat"
```

---

### Task 2: Annonce et abandon d'un run interrompu

**Files:**
- Modify: `sidecar/src/tagger/protocol.py` (`GetInterruptedRun`, `DiscardRun`, charges, `InterruptedRunEvent`, unions)
- Modify: `sidecar/src/tagger/handlers.py` (`RunNotFoundError`, `handle_get_interrupted_run`, `_detected`)
- Modify: `sidecar/src/tagger/__main__.py` (`_Session.announce_interrupted_run`, `discard_run`, dispatch)
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`
- Create: `sidecar/tests/integration/test_ndjson_resume.py`
- Modify: `src/app/core/models/protocol.ts`, `src/app/core/sidecar.service.ts`

**Interfaces:**
- Consumes : `detect_interrupted`, `InterruptedRun`, `UnreadablePlan`, `find_plan` (02) ; `plan.discard_plan`, `plan_dir`, `plan.SCHEMA_VERSION` (01) ; `dump_dir` ; `run_plans.plan_of`, `save_plan`, `music`, `plan_files`, `only_plan`, `RUN_ID` (helpers 01).
- Produces :
  - commandes `GetInterruptedRun`, `DiscardRun(run_id: str)` ;
  - `InterruptedRunPayload`, `UnreadablePlanPayload` (`found: int | str | None`), `InterruptedRunEvent(run: InterruptedRunPayload | UnreadablePlanPayload | None)` ;
  - `handlers.RunNotFoundError(run_id: str)` ;
  - `handlers.handle_get_interrupted_run(active_run_id: str | None) -> InterruptedRunEvent` ;
  - `_Session.announce_interrupted_run() -> None` et `_Session.discard_run(command: DiscardRun) -> None` (async) ;
  - côté TS :

```ts
export interface GetInterruptedRunCommand {
  readonly command: "get_interrupted_run"
}

export interface DiscardRunCommand {
  readonly command: "discard_run"
  readonly run_id: string
}

export interface InterruptedRun {
  readonly kind: "interrupted"
  readonly run_id: string
  readonly started_at: string
  readonly folder: string
  readonly processed: number
  readonly total: number
  readonly folder_missing: boolean
}

export interface UnreadablePlan {
  readonly kind: "unreadable"
  readonly run_id: string
  readonly started_at: string
  readonly found: number | string | null
  readonly expected: number
}

export interface InterruptedRunEvent {
  readonly event: "interrupted_run"
  readonly run: InterruptedRun | UnreadablePlan | null
}
```

- [ ] **Step 1: Écrire les tests**

`sidecar/tests/integration/test_ndjson_resume.py` :

```python
"""Detection, reprise et abandon d'un run interrompu, de bout en bout sur la boucle."""

import json
from typing import TYPE_CHECKING

import pytest
from ndjson_loop import conversation, resolved_run
from run_plans import RUN_ID, music, only_plan, plan_files, plan_of, save_plan
from scraper_responses import YOUR_MIND
from tagging_api import CREATED

from tagger.plan import plan_dir
from tagger.run_files import stamped_name
from tagger.tagging import FailureReason

if TYPE_CHECKING:
    from pathlib import Path

    from tagging_api import FakeApi

pytestmark = [pytest.mark.asyncio, pytest.mark.usefixtures("_key", "app_data")]

OTHER_RUN = "9e8f7a"


async def test_announces_no_interrupted_run_without_plans() -> None:
    async with conversation() as talk:
        talk.send(command="get_interrupted_run")
        announced = await talk.expect("interrupted_run")

    assert announced["run"] is None


async def test_announces_an_interrupted_run(tmp_path: Path) -> None:
    folder = tmp_path / "music"
    records = music(folder, 2)
    plan = plan_of(folder, [records[0].unresolved(FailureReason.NO_RESULT), records[1]])
    save_plan(plan_dir(), plan)

    async with conversation() as talk:
        talk.send(command="get_interrupted_run")
        announced = await talk.expect("interrupted_run")

    run = announced["run"]
    assert isinstance(run, dict)
    assert (run["kind"], run["run_id"], run["processed"], run["total"]) == (
        "interrupted",
        RUN_ID,
        1,
        2,
    )
    assert run["folder_missing"] is False


async def test_announces_a_plan_of_another_version() -> None:
    plans = plan_dir()
    plans.mkdir(parents=True)
    (plans / stamped_name(CREATED, RUN_ID, ".json")).write_text(
        json.dumps({"schema_version": 2}), encoding="utf-8"
    )

    async with conversation() as talk:
        talk.send(command="get_interrupted_run")
        announced = await talk.expect("interrupted_run")

    run = announced["run"]
    assert isinstance(run, dict)
    assert (run["kind"], run["found"], run["expected"]) == ("unreadable", 2, 1)


async def test_announces_a_corrupt_plan_without_a_version() -> None:
    plans = plan_dir()
    plans.mkdir(parents=True)
    (plans / stamped_name(CREATED, RUN_ID, ".json")).write_text("{not json", encoding="utf-8")

    async with conversation() as talk:
        talk.send(command="get_interrupted_run")
        announced = await talk.expect("interrupted_run")

    run = announced["run"]
    assert isinstance(run, dict)
    assert (run["kind"], run["run_id"], run["found"], run["expected"]) == (
        "unreadable",
        RUN_ID,
        None,
        1,
    )


async def test_does_not_announce_the_run_in_progress(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="get_interrupted_run")
        announced = await talk.expect("interrupted_run")

    assert announced["run"] is None
    assert only_plan().run_id == run_id


async def test_discards_a_plan_and_announces_what_remains(tmp_path: Path) -> None:
    folder = tmp_path / "music"
    save_plan(plan_dir(), plan_of(folder, music(folder, 1)))

    async with conversation() as talk:
        talk.send(command="discard_run", run_id=RUN_ID)
        announced = await talk.expect("interrupted_run")

    assert announced["run"] is None
    assert plan_files() == []


async def test_discarding_an_interrupted_plan_does_not_announce_the_open_run(
    folder: Path, tmp_path: Path
) -> None:
    other = tmp_path / "other"
    save_plan(plan_dir(), plan_of(other, music(other, 1), run_id=OTHER_RUN))

    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="discard_run", run_id=OTHER_RUN)
        announced = await talk.expect("interrupted_run")

    assert announced["run"] is None
    assert only_plan().run_id == run_id


@pytest.mark.parametrize("command", ["discard_run"], ids=["discard"])
async def test_reports_an_unknown_run(command: str) -> None:
    async with conversation() as talk:
        talk.send(command=command, run_id="000000")
        error = await talk.expect("error")

    assert (error["code"], error["command"], error["params"]) == (
        "run_not_found",
        command,
        {"run_id": "000000"},
    )


async def test_discarding_the_current_run_abandons_it(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="discard_run", run_id=run_id)
        announced = await talk.expect("interrupted_run")

    assert announced["run"] is None
    assert plan_files() == []


async def test_refuses_to_discard_while_a_phase_runs(folder: Path, api: FakeApi) -> None:
    gate = api.gate("/beatport/search", YOUR_MIND)

    async with conversation() as talk:
        talk.send(command="start_tagging", folder=str(folder))
        started = await talk.expect("run_started")
        await gate.reached.wait()
        talk.send(command="discard_run", run_id=started["run_id"])
        error = await talk.expect("error")
        gate.release.set()
        await talk.expect("run_finished", phase="network")

    assert (error["code"], error["command"], error["params"]) == (
        "phase_busy",
        "discard_run",
        {"phase": "tagging"},
    )
```

- [ ] **Step 2: Lancer les tests, ils échouent**

Run: `cd sidecar && uv run pytest tests/integration/test_ndjson_resume.py --no-cov -q`
Expected: FAIL, `malformed_command` : les commandes `get_interrupted_run` et `discard_run` n'existent pas.

- [ ] **Step 3: Écrire les modèles du contrat**

Dans `sidecar/src/tagger/protocol.py` :

1. Commandes, après `Rollback` :

```python
class GetInterruptedRun(Command):
    """Au lancement : un run interrompu attend-il ? Meme patron que `get_rollback_target`."""

    command: Literal["get_interrupted_run"]


class DiscardRun(Command):
    """Repartir de zero : le plan part, l'annonce suivante dit s'il en reste un autre."""

    command: Literal["discard_run"]
    run_id: str
```

2. Ajouter `| GetInterruptedRun | DiscardRun` après `| Rollback` dans les unions `AnyCommand` et `ExecutableCommand` (la virgule `Field(discriminator="command"),` de `AnyCommand` suit le dernier membre) et `"get_interrupted_run"`, `"discard_run"` à la fin de `CommandName`, après `"rollback"`.

3. Événements et charges, après `RollbackFinished` :

```python
class InterruptedRunPayload(BaseModel):
    """Run a proposer a la reprise ; `folder_missing` ne laisse que l'option de repartir de zero."""

    model_config = ConfigDict(frozen=True)

    kind: Literal["interrupted"] = "interrupted"
    run_id: str
    started_at: datetime
    folder: Path
    processed: int
    total: int
    folder_missing: bool


class UnreadablePlanPayload(BaseModel):
    """Plan d'une autre version ou illisible : les deux versions font le message (ADR-018).

    `found` est nul quand le plan n'a pas de version lisible (JSON corrompu) : l'interface dit
    alors « illisible » et non « version null ».
    """

    model_config = ConfigDict(frozen=True)

    kind: Literal["unreadable"] = "unreadable"
    run_id: str
    started_at: datetime
    found: int | str | None
    expected: int


class InterruptedRunEvent(Event):
    """`run` nul : rien a reprendre."""

    event: Literal["interrupted_run"]
    run: (
        Annotated[InterruptedRunPayload | UnreadablePlanPayload, Field(discriminator="kind")] | None
    )
```

- [ ] **Step 4: Écrire les handlers**

Dans `sidecar/src/tagger/handlers.py` :

1. Imports à fusionner avec ceux du module :

```python
from typing import TYPE_CHECKING, ClassVar, NamedTuple, assert_never, override

from tagger.errors import TaggerError
from tagger.plan import SCHEMA_VERSION as PLAN_SCHEMA_VERSION
from tagger.protocol import InterruptedRunEvent, InterruptedRunPayload, UnreadablePlanPayload
from tagger.resume import InterruptedRun, UnreadablePlan, detect_interrupted
```

(les trois noms de `tagger.protocol` rejoignent l'import existant, `plan_dir` est déjà importé depuis `tagger.plan` par le sub-project 01) et dans le bloc `TYPE_CHECKING` :

```python
    from tagger.resume import DetectedPlan
```

2. Ajouter, après `handle_get_version` :

```python
class RunNotFoundError(TaggerError):
    """Ni plan ni rapport pour ce run : supprime entre l'annonce et le geste, ou inconnu."""

    code: ClassVar[str] = "run_not_found"

    def __init__(self, run_id: str) -> None:
        super().__init__(f"run not found: {run_id}", run_id=run_id)


def handle_get_interrupted_run(active_run_id: str | None) -> InterruptedRunEvent:
    """Relu sur le disque a chaque appel : un abandon change le plan a proposer.

    Le plan du run ouvert est vivant, pas interrompu : `active_run_id` l'ecarte.
    """
    detected = detect_interrupted(plan_dir(), dump_dir(), active_run_id=active_run_id)
    return InterruptedRunEvent(event="interrupted_run", run=_detected(detected))


def _detected(
    detected: DetectedPlan | None,
) -> InterruptedRunPayload | UnreadablePlanPayload | None:
    match detected:
        case None:
            return None
        case InterruptedRun():
            return InterruptedRunPayload(
                run_id=detected.run_id,
                started_at=detected.started_at,
                folder=detected.folder,
                processed=detected.processed,
                total=detected.total,
                folder_missing=detected.folder_missing,
            )
        case UnreadablePlan():
            found = detected.error.params.get("found")
            return UnreadablePlanPayload(
                run_id=detected.run_id,
                started_at=detected.started_at,
                # Entier ou chaine seuls : un JSON corrompu ou sans version rend `None`.
                found=found if isinstance(found, int | str) else None,
                expected=PLAN_SCHEMA_VERSION,
            )
        case _:
            assert_never(detected)
```

- [ ] **Step 5: Câbler la session**

Dans `sidecar/src/tagger/__main__.py` :

1. Imports à fusionner : `DiscardRun` et `GetInterruptedRun` dans l'import de `tagger.protocol`, `RunNotFoundError` et `handle_get_interrupted_run` dans celui de `tagger.handlers`, puis :

```python
from tagger.plan import discard_plan
from tagger.resume import find_plan
```

(`discard_plan` vit dans `tagger.plan` avec `plan_dir`, déjà importé par le sub-project 01 : fusionner les deux noms dans la même ligne.)

2. Ajouter à `_Session`, après `rollback` :

```python
    async def announce_interrupted_run(self) -> None:
        """Annonce le plan a reprendre, sans le run ouvert : son plan est vivant, pas interrompu."""
        current = self._current
        active_run_id = None if current is None else current.live.run_id
        self.send(await asyncio.to_thread(handle_get_interrupted_run, active_run_id))

    async def discard_run(self, command: DiscardRun) -> None:
        """Repartir de zero : le plan part ; sur le run courant, le run est abandonne avec lui.

        Refuse pendant une phase longue, qui peut tenir ce plan (une reprise en cours). L'annonce
        suivante part toujours : elle dit s'il reste un autre run a reprendre.
        """
        self._ensure_idle()
        current = self._current
        if current is not None and current.live.run_id == command.run_id:
            self._current = None
            await current.abandon()
        else:
            path = await asyncio.to_thread(find_plan, plan_dir(), command.run_id)
            if path is None:
                raise RunNotFoundError(command.run_id)
            await asyncio.to_thread(discard_plan, path)
        await self.announce_interrupted_run()
```

3. Dans `_dispatch`, avant `case _:` :

```python
        case GetInterruptedRun():
            await session.announce_interrupted_run()
        case DiscardRun():
            await session.discard_run(command)
```

- [ ] **Step 6: Traduire `run_not_found`**

`public/i18n/fr.json`, section `errors`, après `"run_plan_unreadable"`. L'espace avant `:` est une espace insécable (U+00A0), comme sur les lignes voisines.

```json
    "run_not_found": "Ce run n'existe plus : son enregistrement ou son rapport a été supprimé.\nRelancez un run sur le dossier.",
```

`public/i18n/en.json` :

```json
    "run_not_found": "This run no longer exists: its record or its report was deleted.\nStart a new run on the folder.",
```

- [ ] **Step 7: Lancer les tests, ils passent**

Run: `cd sidecar && uv run pytest tests/integration/test_ndjson_resume.py tests/unit/test_error_translations.py tests/unit/test_protocol_models.py --no-cov -q`
Expected: PASS

- [ ] **Step 8: Écrire le miroir TypeScript**

Dans `src/app/core/models/protocol.ts` :

1. Après `RollbackCommand`, ajouter les interfaces `GetInterruptedRunCommand` et `DiscardRunCommand` du bloc « Produces » ci-dessus, précédées de ces commentaires :

```ts
/** Au lancement : un run interrompu attend-il ? */
```

```ts
/** Repartir de zero : le sidecar repond par l'annonce suivante. */
```

et les ajouter à l'union `SidecarCommand`, après `| RollbackCommand` :

```ts
  | GetInterruptedRunCommand
  | DiscardRunCommand
```

2. Après `RollbackFinishedEvent`, ajouter `InterruptedRun`, `UnreadablePlan` et `InterruptedRunEvent` du bloc « Produces », précédés de :

```ts
/** Run a proposer a la reprise ; `folder_missing` ne laisse que l'option de repartir de zero. */
```

```ts
/** Plan d'une autre version ou illisible : `found` est nul quand le plan n'a pas de version lisible. */
```

et `| InterruptedRunEvent` à l'union `SidecarEvent`, après `| RollbackFinishedEvent`.

Dans `src/app/core/sidecar.service.ts` :

1. Dans `KNOWN_EVENTS`, après `rollback_finished: true,` :

```ts
  interrupted_run: true,
```

2. Dans le `switch` de `handleLine`, avant `case "error":` :

```ts
      case "interrupted_run":
        // Contrat fige avant son store (ordre de developpement, ARCHITECTURE.md) : rien a router.
        break
```

- [ ] **Step 9: Gate et commit**

Run: `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar && just lint-ui && just typecheck-ui && just test-ui`
Expected: tout vert

```bash
git add sidecar/src/tagger/protocol.py sidecar/src/tagger/handlers.py sidecar/src/tagger/__main__.py sidecar/tests/integration/test_ndjson_resume.py public/i18n/fr.json public/i18n/en.json src/app/core
git commit -m "feat(sidecar): annonce et abandon d'un run interrompu sur le protocole"
```

---

### Task 3: Reprise d'un run interrompu

**Files:**
- Modify: `sidecar/src/tagger/protocol.py` (`ResumeRun`, unions)
- Modify: `sidecar/src/tagger/handlers.py` (`open_tagging` factorisé, `open_resumed_tagging`, `read_resumable_plan`, `handle_resume_run`)
- Modify: `sidecar/src/tagger/__main__.py` (`_Session.resume_run`, unions de `_spawn_phase` et `_phase`)
- Modify: `sidecar/tests/integration/test_ndjson_resume.py`
- Modify: `src/app/core/models/protocol.ts`

**Interfaces:**
- Consumes : `reopen_run`, `find_plan`, `PlanThresholds.to_matching` (02) ; `load_plan`, `RunPlan`, `PlanRecorder` et `handlers._open_plan(live, thresholds, *, started_at: datetime | None = None)` (01) ; `tag_dump.find_dump` ; `RunNotFoundError` (Task 2).
- Produces :
  - commande `ResumeRun(run_id: str)` ;
  - `handlers.read_resumable_plan(run_id: str) -> RunPlan` (async) ;
  - `handlers.open_resumed_tagging(plan: RunPlan, emit: Callable[[Event], None]) -> CurrentRun` (async) ;
  - `handlers.handle_resume_run(plan: RunPlan, emit: Callable[[Event], None], adopt: Callable[[CurrentRun], None]) -> None` (async) ;
  - `_Session.resume_run(command: ResumeRun) -> None` ;
  - côté TS :

```ts
export interface ResumeRunCommand {
  readonly command: "resume_run"
  readonly run_id: string
}
```

- [ ] **Step 1: Écrire les tests**

Dans `sidecar/tests/integration/test_ndjson_resume.py`, fusionner ces imports avec ceux du module :

```python
from scraper_responses import YOUR_MIND, BASIEL
from tagging_api import CREATED, ORIGINAL, found, two_tracks

from tagger.run_files import run_id_of, stamped_name
from tagger.tag_dump import dump_dir
```

et sous `if TYPE_CHECKING:`, `from memory_keyring import MemoryKeyring`. Remplacer le décorateur de `test_reports_an_unknown_run` par `@pytest.mark.parametrize("command", ["discard_run", "resume_run"], ids=["discard", "resume"])`. Puis ajouter :

```python
async def test_resumes_a_run_cut_short_by_a_shutdown(tmp_path: Path, api: FakeApi) -> None:
    api.on("/beatport/search", YOUR_MIND, found(ORIGINAL))
    gate = api.gate("/beatport/search", BASIEL)
    folder = two_tracks(tmp_path)
    async with conversation() as talk:
        talk.send(command="start_tagging", folder=str(folder))
        started = await talk.expect("run_started")
        await talk.expect("track_resolved", track_id="a.mp3")
        await gate.reached.wait()
        talk.send(command="shutdown")
    gate.release.set()
    api.requests.clear()
    run_id = started["run_id"]

    async with conversation() as talk:
        talk.send(command="get_interrupted_run")
        announced = await talk.expect("interrupted_run")
        talk.send(command="resume_run", run_id=run_id)
        await talk.expect("run_started", run_id=run_id)
        replayed = await talk.expect("track_resolved", track_id="a.mp3")
        finished = await talk.expect("run_finished", phase="network")

    run = announced["run"]
    assert isinstance(run, dict)
    assert (run["processed"], run["total"]) == (1, 2)
    assert replayed["resolution"] == "auto"
    searched = {
        request.url.params.get("q")
        for request in api.requests
        if request.url.path.endswith("/search")
    }
    assert searched == {BASIEL}
    assert finished["run_id"] == run_id


@pytest.mark.parametrize("kind", ["committed", "dumped"], ids=["committed", "dumped"])
async def test_refuses_a_plan_that_cannot_be_resumed_and_keeps_the_open_run(
    folder: Path, tmp_path: Path, kind: str
) -> None:
    other = tmp_path / "other"
    save_plan(
        plan_dir(),
        plan_of(other, music(other, 1), run_id=OTHER_RUN, committed=kind == "committed"),
    )
    if kind == "dumped":
        dump_dir().mkdir(parents=True, exist_ok=True)
        (dump_dir() / stamped_name(CREATED, OTHER_RUN, ".json")).write_text("{}", encoding="utf-8")

    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="resume_run", run_id=OTHER_RUN)
        refused = await talk.expect("error")
        talk.send(command="commit_run", run_id=run_id)
        finished = await talk.expect("run_finished", phase="write")

    assert (refused["code"], refused["command"], refused["params"]) == (
        "run_not_found",
        "resume_run",
        {"run_id": OTHER_RUN},
    )
    assert finished["written"] == 1
    assert OTHER_RUN in {run_id_of(path) for path in plan_files()}


@pytest.mark.parametrize("kind", ["removed", "emptied"], ids=["removed", "emptied"])
@pytest.mark.usefixtures("api")
async def test_reports_a_run_whose_folder_cannot_be_reopened(tmp_path: Path, kind: str) -> None:
    folder = tmp_path / "unplugged"
    records = music(folder, 1)
    save_plan(plan_dir(), plan_of(folder, records))
    for record in records:
        record.path.unlink()
    if kind == "removed":
        folder.rmdir()

    async with conversation() as talk:
        talk.send(command="resume_run", run_id=RUN_ID)
        error = await talk.expect("error")

    assert (error["code"], error["command"]) == ("tagging_folder_unreadable", "resume_run")


async def test_refuses_to_resume_without_an_api_key(
    tmp_path: Path, memory_keyring: MemoryKeyring
) -> None:
    memory_keyring.secrets.clear()
    folder = tmp_path / "music"
    save_plan(plan_dir(), plan_of(folder, music(folder, 1)))

    async with conversation() as talk:
        talk.send(command="resume_run", run_id=RUN_ID)
        error = await talk.expect("error")

    assert (error["code"], error["command"]) == ("api_key_missing", "resume_run")
    assert len(plan_files()) == 1
```

- [ ] **Step 2: Lancer les tests, ils échouent**

Run: `cd sidecar && uv run pytest tests/integration/test_ndjson_resume.py --no-cov -q`
Expected: FAIL, `malformed_command` : la commande `resume_run` n'existe pas.

- [ ] **Step 3: Ajouter la commande**

Dans `sidecar/src/tagger/protocol.py`, après `DiscardRun` :

```python
class ResumeRun(Command):
    """Reprend le run interrompu annonce : decisions rendues, seuls les restants partent."""

    command: Literal["resume_run"]
    run_id: str
```

Ajouter `| ResumeRun` après `| DiscardRun` dans `AnyCommand` et `ExecutableCommand` et `"resume_run"` après `"discard_run"` dans `CommandName`.

- [ ] **Step 4: Factoriser l'ouverture des clients**

Dans `sidecar/src/tagger/handlers.py`, imports à fusionner avec ceux du module :

```python
from tagger.plan import PlanRecorder, RunPlan, load_plan, plan_dir
from tagger.resume import InterruptedRun, UnreadablePlan, detect_interrupted, find_plan, reopen_run
from tagger.tag_dump import TagDumpError, dump_dir, find_dump
```

(`ResumeRun` n'est pas importé ici : le handler reçoit un `RunPlan`, la commande reste dans `__main__.py`.)

Remplacer `open_tagging` (version du sub-project 01) par les fonctions ci-dessous. `url_progress` n'est pas touchée.

```python
async def _open_clients(stack: AsyncExitStack) -> tuple[TechnoScraperClient, ArtworkFetcher]:
    """Cle, caches, client et pochettes d'un run, poses dans `stack` : un run neuf et un run
    repris partagent tout ce qui precede l'ouverture du run lui-meme."""
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
    client = await stack.enter_async_context(
        TechnoScraperClient(
            api_key, transport=transports.api, cache=ResponseCache(responses_disk.result())
        )
    )
    artworks = await stack.enter_async_context(
        ArtworkFetcher(artworks_disk.result(), transport=transports.cdn, resolve=transports.resolve)
    )
    return client, artworks


def _build_current_run(
    stack: AsyncExitStack,
    live: LiveRun,
    sources: RunSources,
    relay: Callable[[PipelineEvent], None],
    plan: PlanRecorder | None,
) -> CurrentRun:
    desk = Arbitration(live, sources, relay)
    recovery = UrlRecovery(live, sources, relay)
    return CurrentRun(stack.pop_all(), live, sources, desk, recovery, plan)


async def open_tagging(command: StartTagging, emit: Callable[[Event], None]) -> CurrentRun:
    """Ouvre clients et run neuf, branche l'arbitrage ; client et fetcher survivent dans la pile
    rendue au `CurrentRun` et une ouverture ratee referme ce qu'elle a deja ouvert."""
    async with AsyncExitStack() as stack:
        client, artworks = await _open_clients(stack)
        relay = _relay(emit)
        live = await open_run(command.folder, on_event=relay)
        thresholds = _thresholds(command)
        sources = RunSources(live.run_id, client, artworks, thresholds)
        plan = await _open_plan(live, thresholds)
        return _build_current_run(stack, live, sources, relay, plan)


async def open_resumed_tagging(plan: RunPlan, emit: Callable[[Event], None]) -> CurrentRun:
    """Rouvre le run d'un plan avec ses seuils ; son plan continue dans le meme fichier."""
    async with AsyncExitStack() as stack:
        client, artworks = await _open_clients(stack)
        relay = _relay(emit)
        thresholds = plan.thresholds.to_matching()
        sources = RunSources(plan.run_id, client, artworks, thresholds)
        live = await reopen_run(plan, sources, on_event=relay)
        recorder = await _open_plan(live, thresholds, started_at=plan.started_at)
        return _build_current_run(stack, live, sources, relay, recorder)

```

`_open_plan(live, thresholds, *, started_at=None)` est celui du sub-project 01 : son paramètre `started_at` fait réécrire le fichier du plan repris sous le même nom, il n'y a rien à y changer.

- [ ] **Step 5: Écrire la reprise dans `handlers.py`**

Remplacer `handle_start_tagging` par la version ci-dessous et ajouter les trois fonctions qui la suivent :

```python
async def handle_start_tagging(
    command: StartTagging,
    emit: Callable[[Event], None],
    adopt: Callable[[CurrentRun], None],
) -> None:
    """Confie le run a la session avant la phase reseau : un morceau se tranche des qu'il attend."""
    current = await open_tagging(command, emit)
    adopt(current)
    await _network_phase(current, emit)


async def read_resumable_plan(run_id: str) -> RunPlan:
    """Plan a rouvrir, valide avant qu'on abandonne le run affiche.

    Un plan confirme, ou dont le run a un dump, a vu des fichiers bouger : la reprise affirmerait
    qu'aucun n'a ete touche. C'est la regle de `resume.detect_interrupted`, qui ne l'annonce pas.
    """
    path = await asyncio.to_thread(find_plan, plan_dir(), run_id)
    if path is None:
        raise RunNotFoundError(run_id)
    plan = await asyncio.to_thread(load_plan, path)
    dumped = await asyncio.to_thread(find_dump, dump_dir(), run_id) is not None
    if plan.committed or dumped:
        raise RunNotFoundError(run_id)
    return plan


async def handle_resume_run(
    plan: RunPlan,
    emit: Callable[[Event], None],
    adopt: Callable[[CurrentRun], None],
) -> None:
    """Rejoue le run interrompu, puis ne lance la phase reseau que sur ses morceaux restants."""
    current = await open_resumed_tagging(plan, emit)
    adopt(current)
    await _network_phase(current, emit)


async def _network_phase(current: CurrentRun, emit: Callable[[Event], None]) -> None:
    """Phase reseau d'un run neuf ou repris ; sa fin ouvre le rattrapage, dont la progression
    suit `run_finished`."""
    await resolve_run(current.live, current.sources, on_event=_relay(emit))
    emit(_run_finished(current.live.snapshot(), RunPhase.NETWORK))
    emit(url_progress(current))
```

- [ ] **Step 6: Câbler la session**

Dans `sidecar/src/tagger/__main__.py` :

1. Imports à fusionner : `ResumeRun` dans l'import de `tagger.protocol`, `handle_resume_run` et `read_resumable_plan` dans celui de `tagger.handlers`.

2. Ajouter à `_Session`, après `start_tagging` :

```python
    def resume_run(self, command: ResumeRun) -> None:
        """Meme traitement que `start_tagging` : la reprise part en tache de fond et devient le run
        courant des que ses decisions sont rendues. Le run affiche n'est remplace qu'une fois le
        plan valide, pour qu'un refus ne lui coute rien."""
        self._ensure_idle()
        start_work = functools.partial(self._resume, command)
        self._spawn_phase(Phase.TAGGING, start_work, command)

    async def _resume(self, command: ResumeRun) -> None:
        plan = await read_resumable_plan(command.run_id)
        replaced, self._current = self._current, None
        if replaced is not None:
            await replaced.abandon()
        await handle_resume_run(plan, self.send, self._adopt)
```

3. Ajouter `ResumeRun` aux unions de type `command` de `_spawn_phase` et de `_phase` :

```python
        command: (
            StartTagging | ExtractPlaylist | CommitRun | RetryWrite | Rollback | ResumeRun
        ),
```

pour `_spawn_phase` et `| ResumeRun` après `| Rollback` dans l'union de `_phase`.

4. Dans `_dispatch`, avant `case _:` :

```python
        case ResumeRun():
            session.resume_run(command)
```

- [ ] **Step 7: Lancer les tests, ils passent**

Run: `cd sidecar && uv run pytest tests/integration/ tests/unit/test_handlers.py --no-cov -q`
Expected: PASS. Tous les tests de `start_tagging` restent verts, ce qui valide la factorisation.

- [ ] **Step 8: Écrire le miroir TypeScript**

Dans `src/app/core/models/protocol.ts`, après `DiscardRunCommand`, ajouter `ResumeRunCommand` du bloc « Produces » ci-dessus, précédée de :

```ts
/** Reprend le run annonce : decisions rendues, seuls les morceaux restants partent. */
```

et `| ResumeRunCommand` à l'union `SidecarCommand`, après `| DiscardRunCommand`.

- [ ] **Step 9: Gate et commit**

Run: `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar && just lint-ui && just typecheck-ui && just test-ui`
Expected: tout vert

```bash
git add sidecar/src/tagger/protocol.py sidecar/src/tagger/handlers.py sidecar/src/tagger/__main__.py sidecar/tests/integration/test_ndjson_resume.py src/app/core/models/protocol.ts
git commit -m "feat(sidecar): reprise d'un run interrompu sur le protocole"
```

---

### Task 4: Runs passés sur le protocole

**Files:**
- Modify: `sidecar/src/tagger/protocol.py` (`ListRuns`, `LoadRun`, `PastRunPayload`, `RunsListed`, `TrackLoaded`, `RunLoaded`, unions)
- Modify: `sidecar/src/tagger/handlers.py` (`handle_list_runs`, `handle_load_run`, `_loaded`, `_artworks`, `_artwork_or_none`, `_payload_rows`, `_scores`)
- Modify: `sidecar/src/tagger/__main__.py` (`_Session.load_run`, `close`, dispatch)
- Modify: `sidecar/tests/integration/test_ndjson_reports.py`, `sidecar/tests/integration/test_ndjson_resume.py`
- Modify: `src/app/core/models/protocol.ts`, `src/app/core/sidecar.service.ts`

**Interfaces:**
- Consumes :
  - `CurrentRun.report`, `load_tagging_report`, `TaggingReport`, `TaggingReportTrack` (dont `system`), `list_reports`, `index_path` (03) ;
  - `cache.DiskCache`, `ArtworkFetcher`, `ArtworkUnavailableError`.
- Produces :
  - commandes `ListRuns`, `LoadRun(run_id: str)` ;
  - `handlers.handle_list_runs() -> RunsListed` ;
  - `handlers.handle_load_run(command: LoadRun) -> RunLoaded` (async) ;
  - `_Session.load_run(command: LoadRun) -> None` ;
  - côté TS :

```ts
export interface ListRunsCommand {
  readonly command: "list_runs"
}

export interface LoadRunCommand {
  readonly command: "load_run"
  readonly run_id: string
}

export interface PastRun {
  readonly run_id: string
  readonly written_at: string
  readonly folder: string
  readonly report_path: string
}

export interface RunsListedEvent {
  readonly event: "runs_listed"
  readonly runs: readonly PastRun[]
}

export interface TrackLoaded {
  readonly track_id: string
  readonly file_name: string
  readonly file_after: string | null
  readonly artist: string
  readonly title: string
  readonly state: TrackState | null
  readonly resolution: TrackResolution | null
  readonly failure_reason: TrackFailureReason | null
  readonly source: TrackSource | null
  readonly after: TrackNames | null
  readonly scores: TrackScores | null
  readonly tags_before: TagsBefore | null
  readonly tags_after: readonly TagValue[] | null
  readonly source_url: string | null
  readonly artwork_path: string | null
}

export interface RunLoadedEvent {
  readonly event: "run_loaded"
  readonly run_id: string
  readonly folder: string
  readonly generated_at: string
  readonly tracks: readonly TrackLoaded[]
}
```

- [ ] **Step 1: Écrire les tests**

Dans `sidecar/tests/integration/test_ndjson_reports.py`, remplacer les imports par :

```python
"""Rapports de re-tagging et runs passes, de bout en bout sur la boucle."""

import asyncio
import shutil
from typing import TYPE_CHECKING

import httpx2
import pytest
from ndjson_loop import EXPECT_TIMEOUT, conversation, resolved_run
from scraper_responses import YOUR_MIND
from stubs import raising
from tagging_api import ONE_TRACK, ORIGINAL, WRITTEN_NAME, FakeApi, FakeCdn, public_resolver

from tagger import handlers, tagging_report
from tagger.paths import app_data_dir
from tagger.report_index import index_path, list_reports

if TYPE_CHECKING:
    from pathlib import Path

    from ndjson_loop import Conversation

pytestmark = [pytest.mark.asyncio, pytest.mark.usefixtures("_key")]
```

et ajouter, après les tests de la Task 1 :

```python
async def _written_run(talk: Conversation, folder: Path) -> str:
    run_id = await resolved_run(talk, folder)
    talk.send(command="commit_run", run_id=run_id)
    await talk.expect("run_finished", phase="write")
    return run_id


def _serve_artworks(
    monkeypatch: pytest.MonkeyPatch, api: FakeApi, cdn: httpx2.MockTransport
) -> None:
    """Cache des pochettes vide et CDN simule remplace : `load_run` doit les retelecharger."""
    shutil.rmtree(app_data_dir() / "cache" / "artworks", ignore_errors=True)
    monkeypatch.setattr(
        handlers,
        "tagging_transports",
        lambda: handlers.TaggingTransports(
            httpx2.MockTransport(api.gated_handler), cdn, public_resolver
        ),
    )


async def test_lists_and_loads_a_past_run(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await _written_run(talk, folder)
        talk.send(command="list_runs")
        listed = await talk.expect("runs_listed")
        talk.send(command="load_run", run_id=run_id)
        loaded = await talk.expect("run_loaded", run_id=run_id)

    runs = listed["runs"]
    assert isinstance(runs, list)
    assert [run["run_id"] for run in runs] == [run_id]
    tracks = loaded["tracks"]
    assert isinstance(tracks, list)
    (track,) = tracks
    assert (track["file_name"], track["file_after"], track["state"]) == (
        ONE_TRACK,
        WRITTEN_NAME,
        "written",
    )
    assert track["source_url"] == ORIGINAL["url"]
    assert track["artwork_path"] is not None
    assert track["tags_before"] is not None
    assert "restorable" not in track


async def test_loads_a_run_whose_artwork_is_unavailable(
    folder: Path, api: FakeApi, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with conversation() as talk:
        run_id = await _written_run(talk, folder)
    release = ORIGINAL["release"]
    assert isinstance(release, dict)
    cdn = FakeCdn()
    cdn.refused.add(str(release["artwork_url"]))
    _serve_artworks(monkeypatch, api, httpx2.MockTransport(cdn.handler))

    async with conversation() as talk:
        talk.send(command="load_run", run_id=run_id)
        loaded = await talk.expect("run_loaded", run_id=run_id)

    tracks = loaded["tracks"]
    assert isinstance(tracks, list)
    assert tracks[0]["artwork_path"] is None


async def test_reports_an_unreadable_report(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await _written_run(talk, folder)
    (entry,) = list_reports(index_path())
    entry.report_path.write_text("{not json", encoding="utf-8")

    async with conversation() as talk:
        talk.send(command="load_run", run_id=run_id)
        error = await talk.expect("error")

    assert (error["code"], error["command"]) == ("tagging_report_unreadable", "load_run")


async def test_refuses_to_load_a_run_while_a_phase_runs(folder: Path, api: FakeApi) -> None:
    gate = api.gate("/beatport/search", YOUR_MIND)

    async with conversation() as talk:
        talk.send(command="start_tagging", folder=str(folder))
        await talk.expect("run_started")
        await gate.reached.wait()
        talk.send(command="load_run", run_id="000000")
        error = await talk.expect("error")
        gate.release.set()
        await talk.expect("run_finished", phase="network")

    assert (error["code"], error["command"], error["params"]) == (
        "phase_busy",
        "load_run",
        {"phase": "tagging"},
    )


async def test_cancels_a_load_in_flight_when_the_session_ends(
    folder: Path, api: FakeApi, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with conversation() as talk:
        run_id = await _written_run(talk, folder)
    reached = asyncio.Event()

    async def stuck(_request: httpx2.Request) -> httpx2.Response:
        reached.set()
        await asyncio.Event().wait()
        return httpx2.Response(500)

    _serve_artworks(monkeypatch, api, httpx2.MockTransport(stuck))

    async with conversation() as talk:
        talk.send(command="load_run", run_id=run_id)
        async with asyncio.timeout(EXPECT_TIMEOUT):
            await reached.wait()
        talk.send(command="shutdown")

    assert not [event for event in talk.events if event["event"] == "run_loaded"]
```

Dans `sidecar/tests/integration/test_ndjson_resume.py`, remplacer le décorateur de `test_reports_an_unknown_run` par `@pytest.mark.parametrize("command", ["discard_run", "resume_run", "load_run"], ids=["discard", "resume", "load"])`.

- [ ] **Step 2: Lancer les tests, ils échouent**

Run: `cd sidecar && uv run pytest tests/integration/test_ndjson_reports.py tests/integration/test_ndjson_resume.py --no-cov -q`
Expected: FAIL, `malformed_command` : `list_runs` et `load_run` n'existent pas.

- [ ] **Step 3: Ajouter les commandes, les événements et les charges**

Dans `sidecar/src/tagger/protocol.py` :

1. Commandes, après `ResumeRun` :

```python
class ListRuns(Command):
    """Runs passes relisibles depuis leurs rapports."""

    command: Literal["list_runs"]


class LoadRun(Command):
    """Rouvre le recapitulatif d'un run passe depuis son rapport, sans rien rejouer."""

    command: Literal["load_run"]
    run_id: str
```

2. Ajouter `| ListRuns | LoadRun` après `| ResumeRun` dans `AnyCommand` et `ExecutableCommand` et `"list_runs"`, `"load_run"` après `"resume_run"` dans `CommandName`.

3. Événements et charges, après `InterruptedRunEvent` :

```python
class PastRunPayload(BaseModel):
    model_config = ConfigDict(frozen=True)

    run_id: str
    written_at: datetime
    folder: Path
    report_path: Path


class RunsListed(Event):
    event: Literal["runs_listed"]
    runs: tuple[PastRunPayload, ...]


class TrackLoaded(BaseModel):
    """Morceau d'un run passe, relu dans son rapport : ce que le recapitulatif affiche.

    Sans `restorable` : un run passe se lit sans geste, la restauration reste aux Reglages.
    """

    model_config = ConfigDict(frozen=True)

    track_id: str
    file_name: str
    file_after: str | None
    artist: str
    title: str
    state: TrackState | None
    resolution: Resolution | None
    failure_reason: TrackFailureReason | None
    source: Source | None
    after: TrackNames | None
    scores: TrackScores | None
    # Meme forme que dans `run_started` : l'interface hydrate un run passe comme un run vivant.
    tags_before: TagsBeforePayload | None
    tags_after: tuple[TagValuePayload, ...] | None
    source_url: str | None
    artwork_path: Path | None


class RunLoaded(Event):
    event: Literal["run_loaded"]
    run_id: str
    folder: Path
    generated_at: datetime
    tracks: tuple[TrackLoaded, ...]
```

`TrackState`, `Resolution`, `TrackFailureReason` et `Source` sont déjà importés par `protocol.py` pour `TrackResolved`.

- [ ] **Step 4: Écrire `list_runs` et `load_run`**

Dans `sidecar/src/tagger/handlers.py`, imports à fusionner avec ceux du module :

```python
from pathlib import PurePosixPath

from tagger.cache import (
    ArtworkFetcher,
    ArtworkUnavailableError,
    DiskCache,
    ResponseCache,
    resolve_host,
)
from tagger.files import TagField
from tagger.protocol import LoadRun, PastRunPayload, RunLoaded, RunsListed, TrackLoaded
from tagger.report_index import IndexEntry, index_path, list_reports, record_report
from tagger.tagging_report import (
    after_rows,
    load_tagging_report,
    report_paths,
    tag_rows,
    write_tagging_report,
)
```

`Path` reste sous `TYPE_CHECKING` : il n'est plus construit à l'exécution, le système des tags se lit dans le rapport. `TagField` est lu à l'exécution par `_loaded`, c'est donc un import d'exécution, que la Task 1 du sub-project 03 a retiré de `TYPE_CHECKING`. Dans le bloc `TYPE_CHECKING`, ajouter :

```python
    from tagger.tagging_report import TaggingReport, TaggingReportTrack
```

Ajouter :

```python
def handle_list_runs() -> RunsListed:
    """Runs passes du registre, du plus recent au plus ancien, rapports disparus ecartes."""
    return RunsListed(
        event="runs_listed",
        runs=tuple(
            PastRunPayload.model_validate(entry, from_attributes=True)
            for entry in list_reports(index_path())
        ),
    )


async def handle_load_run(command: LoadRun) -> RunLoaded:
    """Recapitulatif d'un run passe, relu dans son rapport (migration ADR-018 B), sans rien
    rejouer ; les pochettes passent par le cache puis le CDN, jamais par l'API."""
    entries = await asyncio.to_thread(list_reports, index_path())
    entry = next((known for known in entries if known.run_id == command.run_id), None)
    if entry is None:
        raise RunNotFoundError(command.run_id)
    report = await asyncio.to_thread(load_tagging_report, entry.report_path)
    artworks = await _artworks(report)
    return RunLoaded(
        event="run_loaded",
        run_id=report.run_id,
        folder=report.folder,
        generated_at=report.generated_at,
        tracks=tuple(_loaded(track, artworks.get(track.track_id)) for track in report.tracks),
    )


async def _artworks(report: TaggingReport) -> dict[str, Path]:
    """Pochettes retelechargees par un fetcher ouvert pour la tache, dont le pool est borne.

    Le cache du run vivant n'est pas emprunte : ses entrees expirent apres 30 jours, les rapports
    jamais.
    """
    wanted = {
        track.track_id: track.artwork_url
        for track in report.tracks
        if track.artwork_url is not None
    }
    if not wanted:
        return {}
    disk = await asyncio.to_thread(DiskCache, app_data_dir() / "cache" / "artworks")
    transports = tagging_transports()
    async with (
        ArtworkFetcher(disk, transport=transports.cdn, resolve=transports.resolve) as fetcher,
        asyncio.TaskGroup() as group,
    ):
        fetches = {
            track_id: group.create_task(_artwork_or_none(fetcher, url), name=f"artwork:{track_id}")
            for track_id, url in wanted.items()
        }
    return {
        track_id: path
        for track_id, fetch in fetches.items()
        if (path := fetch.result()) is not None
    }


async def _artwork_or_none(fetcher: ArtworkFetcher, url: str) -> Path | None:
    """Une pochette indisponible laisse le morceau sans image, jamais le run sans recapitulatif."""
    try:
        return await fetcher.fetch(url)
    except ArtworkUnavailableError:
        return None


def _loaded(track: TaggingReportTrack, artwork: Path | None) -> TrackLoaded:
    before = {row.field: row.value for row in track.tags_before or ()}
    scores = track.scores
    return TrackLoaded(
        track_id=track.track_id,
        file_name=PurePosixPath(track.file_before).name,
        file_after=None if track.file_after is None else PurePosixPath(track.file_after).name,
        artist=before.get(TagField.ARTIST) or "",
        title=before.get(TagField.TITLE) or "",
        state=track.state,
        resolution=track.resolution,
        failure_reason=track.failure_reason,
        source=track.source,
        after=None
        if track.artist is None or track.title is None
        else TrackNames(artist=track.artist, title=track.title),
        scores=None if scores is None else _rounded(scores.artist, scores.title, scores.average),
        # Systeme et lignes sont nuls ensemble : le rapport a lu les deux sur les memes tags.
        tags_before=None
        if track.system is None or track.tags_before is None
        else TagsBeforePayload(
            system=track.system,
            comment=track.comment_before,
            fields=_payload_rows(track.tags_before),
        ),
        tags_after=None if track.tags_after is None else _payload_rows(track.tags_after),
        source_url=track.url,
        artwork_path=artwork,
    )
```

Remplacer `_scores` (juste après `_names`) par :

```python
def _scores(scored: ScoredCandidate) -> TrackScores:
    """Arrondis : l'ecran affiche « A 96 · T 92 »."""
    return _rounded(scored.artist_score, scored.title_score, scored.score)


def _rounded(artist: float | None, title: float, average: float) -> TrackScores:
    return TrackScores(
        artist=None if artist is None else round(artist),
        title=round(title),
        average=round(average),
    )
```

- [ ] **Step 5: Câbler la session**

Dans `sidecar/src/tagger/__main__.py` :

1. Imports à fusionner : `ListRuns` et `LoadRun` dans l'import de `tagger.protocol`, `handle_list_runs` et `handle_load_run` dans celui de `tagger.handlers`.

2. Dans `_Session.__init__`, après `self._current: CurrentRun | None = None` :

```python
        # Chargements de runs passes en vol : lecture seule, annules a la fermeture de la session.
        self._loads: set[asyncio.Task[None]] = set()
```

3. Ajouter à `_Session`, après `rollback` :

```python
    def load_run(self, command: LoadRun) -> None:
        """Lecture seule en tache de fond : aucun fichier de musique n'est touche et les pochettes
        ne gelent pas la lecture de stdin. Refuse pendant une phase longue, dont elle partage le
        dossier des pochettes ; la fermeture de la session l'annule."""
        self._ensure_idle()
        start_work = functools.partial(handle_load_run, command)
        load = self._group.create_task(self._phase(start_work, command), name="load_run")
        self._loads.add(load)
        load.add_done_callback(self._loads.discard)

    async def _cancel_loads(self) -> None:
        """Rien a proteger dans un chargement : l'attendre retarderait seulement la sortie."""
        loads = tuple(self._loads)
        for load in loads:
            load.cancel()
        await asyncio.gather(*loads, return_exceptions=True)
```

4. Dans `close`, juste après `await self._settle_run(cancel=cancel)` :

```python
        await self._cancel_loads()
```

5. Ajouter `| LoadRun` après `| ResumeRun` dans l'union de type `command` de `_phase`.

6. Dans `_dispatch`, avant `case _:` :

```python
        case ListRuns():
            session.send(await asyncio.to_thread(handle_list_runs))
        case LoadRun():
            session.load_run(command)
```

- [ ] **Step 6: Lancer les tests, ils passent**

Run: `cd sidecar && uv run pytest tests/integration/ tests/unit/test_handlers.py tests/unit/test_protocol_tagging.py --no-cov -q`
Expected: PASS

- [ ] **Step 7: Écrire le miroir TypeScript**

Dans `src/app/core/models/protocol.ts` :

1. Après `ResumeRunCommand`, ajouter `ListRunsCommand` et `LoadRunCommand` du bloc « Produces », avec pour `LoadRunCommand` :

```ts
/** Rouvre le recapitulatif d'un run passe, sans rien rejouer. */
```

et `| ListRunsCommand | LoadRunCommand` à l'union `SidecarCommand`, après `| ResumeRunCommand`.

2. Après `InterruptedRunEvent`, ajouter `PastRun`, `RunsListedEvent`, `TrackLoaded` et `RunLoadedEvent` du bloc « Produces », avec pour `TrackLoaded` :

```ts
/** Morceau d'un run passe, relu dans son rapport : sans `restorable`, un run passe se lit sans geste. */
```

et `| RunsListedEvent | RunLoadedEvent` à l'union `SidecarEvent`, après `| InterruptedRunEvent`.

Dans `src/app/core/sidecar.service.ts` :

1. Dans `KNOWN_EVENTS`, après `interrupted_run: true,` :

```ts
  runs_listed: true,
  run_loaded: true,
```

2. Dans le `switch` de `handleLine`, étendre le cas de la Task 2 :

```ts
      case "interrupted_run":
      case "runs_listed":
      case "run_loaded":
        // Contrat fige avant ses stores (ordre de developpement, ARCHITECTURE.md) : rien a router.
        break
```

- [ ] **Step 8: Gate et commit**

Run: `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar && just lint-ui && just typecheck-ui && just test-ui`
Expected: tout vert

```bash
git add sidecar/src/tagger/protocol.py sidecar/src/tagger/handlers.py sidecar/src/tagger/__main__.py sidecar/tests/integration src/app/core
git commit -m "feat(sidecar): rapports et runs passes sur le protocole"
```

---

### Task 5: Contrat documenté

**Files:**
- Modify: `docs/ARCHITECTURE.md`

**Interfaces:**
- Consumes: le contrat des Tasks 1 à 4.
- Produces: la documentation du contrat dans § API, aucune ligne de code.

- [ ] **Step 1: Mettre à jour le contrat dans `docs/ARCHITECTURE.md`**

Relire les passages avant de les éditer : leurs numéros de ligne ne sont pas garantis. Dans § API, table des commandes, remplacer la ligne `` | `resume_run` / `discard_run` | identifiant du plan détecté au lancement | `` par :

```markdown
| `get_interrupted_run` | aucune. Rend `interrupted_run` : le run interrompu à proposer au lancement, sans le run ouvert dans la session dont le plan est vivant. Relu sur le disque à chaque appel |
| `resume_run` | identifiant du plan annoncé. Rejoue ses décisions et ses arbitrages en attente, ne lance que ses morceaux restants et finit par `run_finished` en phase `network`. Même mécanique que `start_tagging` : `phase_busy` pendant une phase longue, `api_key_missing` sans clé. Le run affiché n'est abandonné qu'une fois le plan validé : un plan inconnu, confirmé ou dont le run a un dump rend `run_not_found`, un dossier disparu ou vidé de ses fichiers audio `tagging_folder_unreadable` |
| `discard_run` | identifiant du run. Supprime son plan (sur le run courant, l'abandonne) et rend un nouvel `interrupted_run` : le plan suivant, ou nul. `run_not_found` sans plan, `phase_busy` pendant une phase longue |
```

Remplacer les lignes `list_runs` et `load_run` par :

```markdown
| `list_runs` | aucune. Rend `runs_listed` : les runs passés relisibles, lus dans le registre `reports.json`, ce qui alimente l'état vide « aucun run passé » |
| `load_run` | identifiant du run. Relit son rapport JSON, point d'entrée de la politique de migration de l'[ADR-018](adrs/018-versionnement-plan-de-run.md) et rend `run_loaded` sans rejouer quoi que ce soit. Tâche de fond en lecture seule : refusée en `phase_busy` pendant une phase longue, annulée à la fermeture de la session. Les pochettes sont retéléchargées par le cache puis le CDN, jamais par l'API. `run_not_found` sans rapport, `tagging_report_unreadable` sur un rapport illisible |
```

Table des événements :
- dans la ligne `track_resolved`, remplacer « nul pour un non résolu ; `restorable` » par « nul pour un non résolu ; `source_url` : lien vers la fiche du candidat retenu, nul sans candidat ; `restorable` » ;
- dans la ligne `run_finished`, remplacer « ; chemin des rapports une fois la Feature 6 livrée » par « ; `report_path` : JSON du rapport de re-tagging en phase `write`, nul en phase `network` ou si le rapport n'a pas pu être écrit » ;
- ajouter, juste avant la ligne `runs_listed` :

```markdown
| `interrupted_run` | `run` : `kind` `interrupted` (`run_id`, `started_at`, `folder`, `processed`, `total`, `folder_missing` : dossier absent ou vidé de ses fichiers audio), `kind` `unreadable` (`run_id`, `started_at`, `found` : la version trouvée, nulle si le plan n'en porte pas de lisible et `expected`), ou nul. Réponse à `get_interrupted_run` et à `discard_run` |
```

- remplacer la ligne `runs_listed` par :

```markdown
| `runs_listed` | `runs`, du plus récent au plus ancien : `run_id`, `written_at`, `folder` et `report_path` (JSON du rapport). Les compteurs se lisent dans le récapitulatif chargé |
```

- remplacer la ligne `run_loaded` par :

```markdown
| `run_loaded` | `run_id`, `folder`, `generated_at` et `tracks` : par morceau, fichier avant et après, artiste et titre d'origine, `state` / `resolution` / `failure_reason`, source, noms écrits, scores arrondis, `tags_before` (même forme que dans `run_started`), `tags_after`, `source_url` et `artwork_path` (pochette retéléchargée, nulle si indisponible). Sans `restorable` : un run passé se lit sans geste |
```

Paragraphe « La restaurabilité d'un morceau se lit sur `restorable` » : remplacer « `run_started.tracks[]` n'en porte pas, aucun morceau n'ayant d'entrée au dump à l'ouverture. » par « `run_started.tracks[]` n'en porte pas, aucun morceau n'ayant d'entrée au dump à l'ouverture, ni `run_loaded.tracks[]`, le récapitulatif d'un run passé étant en lecture seule. ».

Aucune liste des codes d'erreur n'existe dans ce document : `run_not_found` est documenté dans les lignes de commandes ci-dessus et traduit dans les fichiers de langue.

- [ ] **Step 2: Commit**

Aucun code n'a changé : pas de gate. Relire les lignes modifiées dans un rendu Markdown, une cellule de tableau ne contient pas de `|` brut.

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs: contrat NDJSON de la reprise, des rapports et des runs passes"
```
