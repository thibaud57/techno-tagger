# Contrat NDJSON de l'issue de retour : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exposer à l'interface, par le protocole NDJSON, l'URL de l'issue de retour d'un run et le chemin de son export nettoyé, préparés à la demande par le sidecar.

**Architecture:** Commande `prepare_feedback { run_id }`, événement `feedback_ready { run_id, url, export_path }`. Le handler retrouve le rapport par l'index (recherche factorisée avec `load_run`), écrit l'export puis construit l'URL par les fonctions de `reports/feedback.py`. Côté webview, `SidecarService.prepareFeedback` et les signaux `feedbackReady` et `feedbackPending`.

**Tech Stack:** Python 3.14, pydantic 2.14, asyncio, pytest ; Angular 22, signals, Vitest.

**Spec:** `docs/superpowers/specs/monitoring/03-protocole-ndjson-retour-design.md`

## Global Constraints

- Prérequis : `02-issue-de-retour-sidecar` implémenté (`feedback_issue_url`, `write_feedback_export`, `feedback_dir`, `MAX_URL_LENGTH`, `ISSUE_TEMPLATE`, `EXPORT_FIELD`, `FeedbackExportWriteError`)
- Prérequis hors feature : `feature/settings` commitée avant la Feature 9. `sidecar.service.ts`, `sidecar.service.spec.ts`, `sidecar-stub.ts`, les fichiers i18n et `docs/ARCHITECTURE.md` ont des modifications non commitées au 2026-10-16 et les `git add` ci-dessous les embarqueraient
- Noms figés : commande `prepare_feedback`, événement `feedback_ready`, champs `run_id`, `url`, `export_path`
- `Command` : `extra="forbid"`, `strict=True` (ADR-022) ; `Event` : `frozen`
- Aucune garde de phase : la commande est acceptée pendant toute phase longue
- Erreurs possibles : `run_not_found`, `tagging_report_unreadable`, `feedback_export_write_failed`, chacune avec le `run_id` de la commande dans `params`
- Tests en anglais, AAA sans commentaire de section ; commentaires et docstrings en français, sans accents dans le code ; fonctions TS en `const nom = (...) => ...`

## Review Focus

- **Clic pendant la phase réseau d'un autre run** : `feedback_ready` arrive, la phase va au bout. Test en Task 1
- **Rapport du run supprimé du disque** : `list_reports` écarte l'entrée (`is_file()`), `run_not_found` avec le `run_id`, jamais un crash de la boucle. Test en Task 1
- **Rapport au contenu corrompu, index intact** : `tagging_report_unreadable` avec le `run_id`. Test en Task 1
- **Double clic** : un seul `prepare_feedback` part tant que le premier n'a pas répondu. Test en Task 2
- **Moteur perdu pendant la préparation** : `feedbackPending` retombe, le bouton n'attend pas indéfiniment. Test en Task 2
- **Moteur absent à l'appel** : rien ne part et `reportUnavailable` n'arrête pas le run affiché. Test en Task 2
- **Erreur d'une autre commande pendant la préparation** : `feedbackPending` reste posé. Test en Task 2

---

### Task 1 : le sidecar répond à `prepare_feedback`

**Files:**
- Modify: `sidecar/src/tagger/protocol.py` (`PrepareFeedback`, `FeedbackReady`, `AnyCommand`, `ExecutableCommand`, `CommandName`)
- Modify: `sidecar/src/tagger/handlers.py` (`_report_of`, `handle_load_run`, `handle_prepare_feedback`)
- Modify: `sidecar/src/tagger/__main__.py` (`_error_of`, `_dispatch`)
- Create: `sidecar/tests/integration/test_ndjson_feedback.py`

**Interfaces:**
- Consumes : `feedback_issue_url(report, release, export_name) -> str`, `write_feedback_export(folder, report, release) -> Path`, `feedback_dir() -> Path` de `tagger.reports.feedback` ; `RELEASE` de `tagger`
- Produces :
  - `PrepareFeedback(command: Literal["prepare_feedback"], run_id: str)`
  - `FeedbackReady(event: Literal["feedback_ready"], run_id: str, url: str, export_path: Path)`
  - `handle_prepare_feedback(command: PrepareFeedback) -> FeedbackReady`

- [ ] **Step 1 : écrire les tests d'intégration qui échouent**

`sidecar/tests/integration/test_ndjson_feedback.py` :

```python
"""Issue de retour d'un run : URL de l'Issue Form et export nettoye, prepares a la demande."""

import asyncio
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import parse_qs, urlsplit

import pytest
from ndjson_loop import EXPECT_TIMEOUT, conversation, drive, start_command, written_run
from report_files import report_json
from scraper_responses import YOUR_MIND
from tagging_api import one_track

from tagger.reports.feedback import EXPORT_FIELD, ISSUE_TEMPLATE, MAX_URL_LENGTH, feedback_dir

if TYPE_CHECKING:
    from tagging_api import FakeApi


@pytest.mark.asyncio
@pytest.mark.usefixtures("_key")
async def test_a_written_run_gives_its_issue_url_and_its_export(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await written_run(talk, folder)
        talk.send(command="prepare_feedback", run_id=run_id)
        ready = await talk.expect("feedback_ready")

    url = str(ready["url"])
    query = parse_qs(urlsplit(url).query)
    export = Path(str(ready["export_path"]))
    assert ready["run_id"] == run_id
    assert len(url) <= MAX_URL_LENGTH
    assert query["template"] == [ISSUE_TEMPLATE]
    assert export.parent == feedback_dir()
    assert export.is_file()
    assert query[EXPORT_FIELD] == [f"Drop {export.name} here"]


@pytest.mark.asyncio
@pytest.mark.usefixtures("_key")
async def test_a_run_written_in_an_earlier_session_gives_its_issue_url(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await written_run(talk, folder)

    async with conversation() as talk:
        talk.send(command="prepare_feedback", run_id=run_id)
        ready = await talk.expect("feedback_ready")

    assert ready["run_id"] == run_id


@pytest.mark.usefixtures("app_data")
def test_an_unknown_run_is_refused_with_its_run_id() -> None:
    events = drive('{"command":"prepare_feedback","run_id":"000000"}\n')

    assert (events[0]["code"], events[0]["command"], events[0]["params"]) == (
        "run_not_found",
        "prepare_feedback",
        {"run_id": "000000"},
    )


@pytest.mark.asyncio
@pytest.mark.usefixtures("_key")
async def test_a_deleted_report_is_refused_as_unknown_with_its_run_id(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await written_run(talk, folder)
        report_json(folder).unlink()
        talk.send(command="prepare_feedback", run_id=run_id)
        error = await talk.expect("error")

    params = error["params"]
    assert isinstance(params, dict)
    assert (error["code"], error["command"], params["run_id"]) == (
        "run_not_found",
        "prepare_feedback",
        run_id,
    )


@pytest.mark.asyncio
@pytest.mark.usefixtures("_key")
async def test_a_corrupted_report_is_refused_as_unreadable_with_its_run_id(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await written_run(talk, folder)
        report_json(folder).write_text("{not json", encoding="utf-8")
        talk.send(command="prepare_feedback", run_id=run_id)
        error = await talk.expect("error")

    params = error["params"]
    assert isinstance(params, dict)
    assert (error["code"], error["command"], params["run_id"]) == (
        "tagging_report_unreadable",
        "prepare_feedback",
        run_id,
    )


@pytest.mark.asyncio
@pytest.mark.usefixtures("_key")
async def test_an_export_that_cannot_be_written_is_refused_with_its_file(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await written_run(talk, folder)
        feedback_dir().parent.mkdir(parents=True, exist_ok=True)
        feedback_dir().write_text("", encoding="utf-8")
        talk.send(command="prepare_feedback", run_id=run_id)
        error = await talk.expect("error")

    params = error["params"]
    assert isinstance(params, dict)
    assert (error["code"], error["command"]) == ("feedback_export_write_failed", "prepare_feedback")
    assert str(params["file"]).endswith(f"-{run_id}.json")
    assert params["run_id"] == run_id


@pytest.mark.asyncio
@pytest.mark.usefixtures("_key")
async def test_a_running_network_phase_does_not_hold_the_feedback_back(
    folder: Path, tmp_path: Path, api: FakeApi
) -> None:
    async with conversation() as talk:
        past = await written_run(talk, folder)

    other = one_track(tmp_path / "other")
    gate = api.gate("/beatport/search", YOUR_MIND)
    async with conversation() as talk:
        talk.send(**start_command(other))
        async with asyncio.timeout(EXPECT_TIMEOUT):
            await gate.reached.wait()
        talk.send(command="prepare_feedback", run_id=past)
        ready = await talk.expect("feedback_ready")
        gate.release.set()
        finished = await talk.expect("run_finished", phase="network")

    assert ready["run_id"] == past
    assert finished["phase"] == "network"
```

`report_json(folder)` vient de `tests/helpers/report_files.py`. Un rapport supprimé n'atteint jamais `load_tagging_report` : `list_reports` (`reports/index.py`) écarte l'entrée dont le fichier n'existe plus, d'où `run_not_found`. Seul un contenu corrompu rend `TaggingReportUnreadableError` (`read_versioned`, `core/run_files.py`), comme dans `test_ndjson_reports.py`. `error_from_business` (`protocol.py`) ajoute le `run_id` aux `params` de l'erreur. `params` est un `object` pour mypy : l'`isinstance` précède l'indexation. Le test de la phase réseau lance son run sur un dossier vierge (`one_track`), dont la requête est celle que `gate` retient et borne l'attente par `asyncio.timeout` : un `Event` sans délai gèlerait la suite.

- [ ] **Step 2 : lancer, ils échouent**

Run : `cd sidecar && uv run pytest tests/integration/test_ndjson_feedback.py -x -q`
Expected : FAIL, `malformed_command` sur `prepare_feedback` (commande inconnue)

- [ ] **Step 3 : modèles du protocole**

`protocol.py`, après `LoadRun` :

```python
class PrepareFeedback(Command):
    """Prepare l'issue de retour d'un run, courant ou passe : export ecrit, URL construite."""

    command: Literal["prepare_feedback"]
    run_id: str
```

Ajouter `| PrepareFeedback` à `AnyCommand` et à `ExecutableCommand` (après `ClearCache`) et `"prepare_feedback"` à la fin de `CommandName`.

Après `RunLoaded` :

```python
class FeedbackReady(Event):
    """`url` ouvre l'Issue Form pre-rempli, `export_path` designe l'export a y glisser : il ne
    va qu'a la webview, qui le revele dans l'Explorateur."""

    event: Literal["feedback_ready"]
    run_id: str
    url: str
    export_path: Path
```

- [ ] **Step 4 : handlers**

`handlers.py` : importer `RELEASE` avec `__version__` depuis `tagger`, `PrepareFeedback` et `FeedbackReady` depuis `tagger.protocol`, `feedback_dir`, `feedback_issue_url`, `write_feedback_export` depuis `tagger.reports.feedback`. Puis remplacer le début de `handle_load_run` et ajouter les deux fonctions :

```python
def _report_of(run_id: str) -> TaggingReport:
    """Rapport d'un run de l'index, migre s'il est d'un schema anterieur.

    Leve `RunNotFoundError` pour un run absent de l'index, `TaggingReportUnreadableError` pour un
    rapport illisible ou disparu.
    """
    entry = next((known for known in list_reports(index_path()) if known.run_id == run_id), None)
    if entry is None:
        raise RunNotFoundError(run_id)
    return load_tagging_report(entry.report_path)


async def handle_load_run(command: LoadRun) -> RunLoaded:
    """Recapitulatif d'un run passe, relu dans son rapport (migration ADR-018 B), sans rien
    rejouer ; les pochettes passent par le cache puis le CDN, jamais par l'API."""
    report = await asyncio.to_thread(_report_of, command.run_id)
    artworks = await _artworks(report)
    return RunLoaded(
        event="run_loaded",
        run_id=report.run_id,
        folder=report.folder,
        generated_at=report.generated_at,
        tracks=tuple(_loaded(track, artworks) for track in report.tracks),
    )


def handle_prepare_feedback(command: PrepareFeedback) -> FeedbackReady:
    """L'export s'ecrit avant l'URL : celle-ci nomme le fichier a glisser dans l'issue."""
    report = _report_of(command.run_id)
    export = write_feedback_export(feedback_dir(), report, RELEASE)
    return FeedbackReady(
        event="feedback_ready",
        run_id=report.run_id,
        url=feedback_issue_url(report, RELEASE, export.name),
        export_path=export,
    )
```

`TaggingReport` est importé sous `TYPE_CHECKING` dans `handlers.py` : l'annotation de retour de `_report_of` suffit, aucun import d'exécution.

- [ ] **Step 5 : boucle**

`__main__.py` : importer `PrepareFeedback` et `handle_prepare_feedback`. Dans `_error_of` :

```python
def _error_of(error: TaggerError, command: ExecutableCommand, track_id: str | None = None) -> Error:
    """Seul chemin d'emission d'une erreur de commande : tout refus de `load_run` ou de
    `prepare_feedback` nomme son run."""
    run_id = command.run_id if isinstance(command, LoadRun | PrepareFeedback) else None
    return error_from_business(error, command.command, track_id, run_id=run_id)
```

Dans `_dispatch`, avant `case _:` :

```python
        case PrepareFeedback():
            # Attendu par la boucle comme `list_runs` : un rapport relu, un fichier ecrit. Aucune
            # garde de phase, ni la musique ni le cache ne sont touches.
            session.send(await asyncio.to_thread(handle_prepare_feedback, command))
```

- [ ] **Step 6 : lancer les tests du sidecar, tout passe**

Run : `cd sidecar && uv run pytest tests/integration/test_ndjson_feedback.py tests/integration/test_ndjson_reports.py tests/unit/test_protocol_models.py -x -q && uv run mypy src tests`
Expected : PASS (`test_ndjson_reports.py` garde `load_run` intact après la factorisation, `test_protocol_models.py` vérifie `CommandName`)

- [ ] **Step 7 : commit**

```bash
git add sidecar/src/tagger/protocol.py sidecar/src/tagger/handlers.py sidecar/src/tagger/__main__.py sidecar/tests/integration/test_ndjson_feedback.py
git commit -m "feat(sidecar): preparer a la demande l'issue de retour d'un run par prepare_feedback"
```

---

### Task 2 : miroir TypeScript et `SidecarService`

**Files:**
- Modify: `src/app/core/sidecar/protocol.ts`
- Modify: `src/app/core/sidecar/sidecar.service.ts`
- Modify: `src/app/core/sidecar/sidecar.service.spec.ts`
- Modify: `src/fixtures/sidecar-stub.ts`

**Interfaces:**
- Produces :
  - `PrepareFeedbackCommand { command: "prepare_feedback"; run_id: string }`
  - `FeedbackReadyEvent { event: "feedback_ready"; run_id: string; url: string; export_path: string }`
  - `SidecarService.prepareFeedback(runId: string): Promise<void>`
  - `SidecarService.feedbackReady: Signal<FeedbackReadyEvent | null>`
  - `SidecarService.feedbackPending: Signal<string | null>`

- [ ] **Step 1 : écrire les tests qui échouent**

Dans `sidecar.service.spec.ts`, ajouter au premier `it.each` d'envoi (celui qui finit par `"a cache clearing"`) :

```typescript
    [
      "a feedback preparation",
      (target) => target.prepareFeedback("a3f9c1"),
      { command: "prepare_feedback", run_id: "a3f9c1" },
    ],
```

Puis un `describe` à la suite de celui des runs passés :

```typescript
  describe("feedback", () => {
    const READY: FeedbackReadyEvent = {
      event: "feedback_ready",
      run_id: "a3f9c1",
      url: "https://github.example/issues/new?template=matching-report.yml",
      export_path: String.raw`C:\data\feedback\20261006T211403Z-a3f9c1.json`,
    }

    it("marks the run as pending until its feedback is ready", async () => {
      await service.start()

      await service.prepareFeedback("a3f9c1")
      const pending = service.feedbackPending()
      transport.emit(READY)

      expect(pending).toBe("a3f9c1")
      expect(service.feedbackPending()).toBeNull()
      expect(service.feedbackReady()).toEqual(READY)
    })

    it("sends nothing and leaves the displayed run alone when the engine is not up", async () => {
      await service.prepareFeedback("a3f9c1")

      expect(transport.sent).toEqual([])
      expect(service.lastError()).toBeNull()
      expect(service.feedbackPending()).toBeNull()
    })

    it("asks once while the feedback of a run is being prepared", async () => {
      await service.start()

      await service.prepareFeedback("a3f9c1")
      await service.prepareFeedback("a3f9c1")

      const sent = transport.sent.filter((line) => commandOf(line) === "prepare_feedback")
      expect(sent).toHaveLength(1)
    })

    it("ends the wait when the preparation is refused", async () => {
      await service.start()
      await service.prepareFeedback("a3f9c1")

      transport.emit(commandError("prepare_feedback", "run_not_found", { run_id: "a3f9c1" }))

      expect(service.feedbackPending()).toBeNull()
      expect(service.errorFor("prepare_feedback")()?.code).toBe("run_not_found")
    })

    it("keeps waiting when another command fails", async () => {
      await service.start()
      await service.prepareFeedback("a3f9c1")

      transport.emit(commandError("clear_cache", "run_not_written"))

      expect(service.feedbackPending()).toBe("a3f9c1")
    })

    it("ends the wait when the engine stops during it", async () => {
      await service.start()
      await service.prepareFeedback("a3f9c1")

      transport.handlers?.onTerminated()

      expect(service.feedbackPending()).toBeNull()
    })
  })
```

Importer `FeedbackReadyEvent` dans la liste existante `import { BusyPhase, SidecarEvent, VersionEvent } from "./protocol"` du spec. `commandError` (importé de `fixtures/write`) et `commandOf` (défini en tête du fichier) existent déjà : les réutiliser. Le test « sans moteur » n'appelle pas `service.start()` : `available` vaut `null`.

Run : `pnpm exec ng test --watch=false --include src/app/core/sidecar/sidecar.service.spec.ts`
Expected : FAIL, `prepareFeedback` absent

- [ ] **Step 2 : miroir du contrat**

`protocol.ts`, après `LoadRunCommand` :

```typescript
/** Prepare l'issue de retour d'un run, courant ou passe : export ecrit, URL construite. */
export interface PrepareFeedbackCommand {
  readonly command: "prepare_feedback"
  readonly run_id: string
}
```

Ajouter `| PrepareFeedbackCommand` à la fin de `SidecarCommand`. Après `RunLoadedEvent` :

```typescript
/** `url` ouvre l'Issue Form pre-rempli, `export_path` designe l'export a reveler dans l'Explorateur. */
export interface FeedbackReadyEvent {
  readonly event: "feedback_ready"
  readonly run_id: string
  readonly url: string
  readonly export_path: string
}
```

Ajouter `| FeedbackReadyEvent` à `SidecarEvent`, avant `SidecarErrorEvent`.

- [ ] **Step 3 : service**

`sidecar.service.ts` :
- imports : ajouter `FeedbackReadyEvent` à la liste `import { ... } from "./protocol"` (après `ExtractionRequest`, ordre alphabétique)
- `KNOWN_EVENTS` : `feedback_ready: true,` après `cache_cleared`
- signaux privés, après `_cacheCleared` :

```typescript
  private readonly _feedbackReady = signal<FeedbackReadyEvent | null>(null)
  private readonly _feedbackPending = signal<string | null>(null)
```

- accesseurs, après `cacheCleared` :

```typescript
  /** Derniere issue de retour preparee : de quoi l'ouvrir et reveler son export. */
  readonly feedbackReady = this._feedbackReady.asReadonly()
  /** Run dont l'issue de retour se prepare, `null` hors attente. */
  readonly feedbackPending = this._feedbackPending.asReadonly()
```

- méthode, après `loadRun` :

```typescript
  /**
   * Comme `loadRun` : sans moteur, pas de `reportUnavailable`, qui arreterait le run affiche. Un run
   * deja en preparation n'est pas redemande : le second clic reecrirait le meme export.
   */
  async prepareFeedback(runId: string): Promise<void> {
    if (this._available() !== true || this._feedbackPending() === runId) {
      return
    }
    this._feedbackPending.set(runId)
    await this.send({ command: "prepare_feedback", run_id: runId })
  }
```

Le moteur perdu en cours d'attente passe par `onTerminated`, donc par `endRun` : `feedbackPending` y retombe (ci-dessous). Une pipe brisee a l'ecriture passe par `reportUnavailable`, qui appelle aussi `endRun`.

- `handleLine`, après `case "run_loaded"` :

```typescript
      case "feedback_ready":
        this._feedbackPending.set(null)
        this._feedbackReady.set(event)
        break
```

- dans `case "error"`, après `this.routeLoadRunError(event)` :

```typescript
        if (event.command === "prepare_feedback") {
          this._feedbackPending.set(null)
        }
```

- dans `endRun()`, à la fin : `this._feedbackPending.set(null)`

- [ ] **Step 4 : stub**

`src/fixtures/sidecar-stub.ts`, dans `defaults()` : `feedbackReady: signal(null),` et `feedbackPending: signal(null),` à côté de `cacheCleared` et `prepareFeedback: vi.fn<SidecarService["prepareFeedback"]>(() => Promise.resolve()),` à côté de `loadRun`.

- [ ] **Step 5 : lancer, tout passe, puis lint et typage**

Run : `pnpm exec ng test --watch=false && just lint && just typecheck`
Expected : PASS

- [ ] **Step 6 : commit**

```bash
git add src/app/core/sidecar/protocol.ts src/app/core/sidecar/sidecar.service.ts src/app/core/sidecar/sidecar.service.spec.ts src/fixtures/sidecar-stub.ts
git commit -m "feat(ui): miroir de prepare_feedback et feedback_ready dans SidecarService"
```

---

### Task 3 : contrat dans `ARCHITECTURE.md`

**Files:**
- Modify: `docs/ARCHITECTURE.md` (§ Backend > API)

- [ ] **Step 1 : tables des commandes et des événements**

Dans la table des commandes, après la ligne de `clear_cache`, une ligne au format des voisines :

```markdown
| `prepare_feedback` | `run_id` | Prépare l'issue de retour d'un run, courant ou passé : écrit son export nettoyé dans `appLocalDataDir()/feedback/`, construit l'URL de l'Issue Form `matching-report.yml` (au plus 2048 caractères). Attendue par la boucle, sans garde de phase. Refus : `run_not_found`, `tagging_report_unreadable`, `feedback_export_write_failed`, `run_id` compris |
```

Dans la table des événements, après `cache_cleared` :

```markdown
| `feedback_ready` | `run_id`, `url`, `export_path` | Réponse à `prepare_feedback` : l'interface ouvre `url` dans le navigateur et révèle `export_path` dans l'Explorateur |
```

Adapter le nombre et l'ordre des colonnes à ceux de chaque table telle qu'elle est dans le fichier ; si le paragraphe d'en-tête du § API compte les commandes (« 20 commandes »), le passer à jour.

- [ ] **Step 2 : commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs(sidecar): prepare_feedback et feedback_ready dans le contrat NDJSON"
```

---

### Task 4 : gate qualité

- [ ] **Step 1 : lint, typage, tests des trois zones**

Run : `just lint && just typecheck && just test`
Expected : tout vert, couverture du sidecar au-dessus de 80 %

- [ ] **Step 2 : passer la spec en `implemented`**

Réservé à `/implement-subproject`, après la chaîne de revue.
