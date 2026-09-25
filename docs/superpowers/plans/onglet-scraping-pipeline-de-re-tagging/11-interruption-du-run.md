# Interruption du run : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Arrêter un run de re-tagging à la demande de l'utilisateur, pour qu'un dossier lancé par erreur cesse de consommer le quota de l'API sans fermer l'application.

**Architecture:** Trois briques, dans l'ordre du contrat d'abord. La commande `cancel_run` rejoint le contrat NDJSON et son dispatch, où `_Session.cancel_run()` existe déjà et devient asynchrone pour attendre la fin du run annulé. Puis `SidecarService.cancelTagging()`, qui l'émet et pose l'état localement, l'interface étant la source du geste. Enfin le bouton dans l'en-tête de l'onglet Tagging, visible le temps du run.

**Tech Stack:** Python 3.14 (pydantic 2.13, `asyncio.Task.cancel`, pytest), Angular 22 (signals, `@if`), PrimeNG 22 (`pButton`), ngx-translate 18, Vitest.

**Spec:** `docs/superpowers/specs/onglet-scraping-pipeline-de-re-tagging/11-interruption-du-run-design.md`

## Global Constraints

- **Le contrat avant le TypeScript** (`.claude/CLAUDE.md` § Standards) : la commande se fige côté sidecar, tests compris, avant que la webview ne soit touchée.
- **`cancel_run()` devient asynchrone** : il annulait la tâche sans l'attendre, ce qui suffisait à `shutdown`, suivi de la sortie. Exposé comme commande, il doit attendre que le run ait fini de mourir, sans quoi une relance lue entre-temps part en `tagging_in_progress` et l'écran reste bloqué en chargement.
- **Aucun événement de fin au contrat** : l'interface pose l'état après avoir émis la commande, comme `endRun()` le fait déjà quand le process meurt. Un événement de confirmation laisserait une fenêtre où le bouton est cliqué mais où l'écran tourne encore (décision de la spec).
- **Aucun état de morceau nouveau** : les morceaux non atteints portent « Non traité », `secondary` et `minus-circle`, livré le 2026-09-25. La cause de l'arrêt appartient au run, pas à la ligne.
- **Le bouton s'ajoute, il ne remplace pas** : DESIGN.md interdit de masquer une action désactivée, arbitrage déjà tranché dans le sub-project 10 contre la maquette. « Lancer le run » reste visible et grisé pendant le run.
- **`secondary` outlined, jamais `danger`** : le rouge est réservé aux trois actions qui touchent aux fichiers musicaux, et la phase réseau n'écrit rien. Sans confirmation pour la même raison.
- **`assert_never` du dispatch** : ajouter la commande à `ExecutableCommand` sans son `case` casse la compilation, ce qui est le bon symptôme (cf. `.claude/rules/python/type-hints.md`).
- **i18n** : aucun libellé en dur, FR et EN dans le même commit, action à l'infinitif.
- **Tests** : noms en anglais, AAA séparé par une ligne vide, règle no-lib-test. Ni `Task.cancel` ni `pButton` ne se testent, seule notre logique le fait.
- **Gate qualité vert à chaque commit** : `just test`, `just lint`, `just typecheck`. Commits `type(scope): description`, scopes `sidecar` puis `ui`.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `sidecar/src/tagger/protocol.py` | Modèle `CancelRun`, littéral dans `CommandName` et les deux unions. |
| `sidecar/src/tagger/__main__.py` | Branche `CancelRun` du dispatch, `cancel_run()` asynchrone qui attend le run annulé. |
| `sidecar/tests/unit/test_protocol_models.py` | La commande se parse. |
| `sidecar/tests/integration/test_ndjson_loop.py` | Un run annulé libère la boucle, et la relance qui suit n'est pas refusée. |
| `src/app/core/models/protocol.ts` | Miroir de la commande dans l'union. |
| `src/app/core/sidecar.service.ts` | `cancelTagging()` : émission puis état local. |
| `src/app/core/sidecar.service.spec.ts` | Commande émise, run arrêté, rien sans run. |
| `src/app/shared/components/icon.component.ts` | Icône `stop` ajoutée à la liste fermée. |
| `src/app/features/tagging/tagging-page.component.{ts,html}` | Bouton et sa condition d'affichage. |
| `src/app/features/tagging/tagging-page.component.spec.ts` | Bouton absent hors run, délégation au service. |
| `public/i18n/{fr,en}.json` | `tagging.cancel`. |
| `docs/ARCHITECTURE.md` | La commande dans le tableau du contrat. |
| `docs/DESIGN.md` | Le bouton dans le Mapping § Liste du run. |
| `.design-sync/NOTES.md` | Écart consigné : la maquette n'a pas d'interruption. |

---

## Task 1: La commande au contrat

**Files:**

- Modify: `sidecar/src/tagger/protocol.py`
- Modify: `sidecar/src/tagger/__main__.py`
- Test: `sidecar/tests/unit/test_protocol_models.py`
- Test: `sidecar/tests/integration/test_ndjson_loop.py`

**Interfaces:**

- Produces: `CancelRun`, `"cancel_run"` dans `CommandName`, `AnyCommand` et `ExecutableCommand`
- Consumes: `_Session.cancel_run()` du sub-project 07

- [ ] **Step 1: Écrire le test de parsing**

Dans `sidecar/tests/unit/test_protocol_models.py`, ajouter `CancelRun` aux imports de `tagger.protocol` puis :

```python
def test_parses_a_run_cancellation() -> None:
    command = parse_command('{"command":"cancel_run"}')

    assert isinstance(command, CancelRun)
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `uv run pytest tests/unit/test_protocol_models.py -q`
Expected: FAIL à l'import, `CancelRun` n'existant pas

- [ ] **Step 3: Déclarer le modèle**

Dans `sidecar/src/tagger/protocol.py`, au-dessus de `ListPlaylists`, sur la forme de `Shutdown` qui n'a pas de charge utile :

```python
class CancelRun(Command):
    """Un dossier lance par erreur cesse de consommer le quota de l'API."""

    command: Literal["cancel_run"]
```

Puis l'ajouter à `AnyCommand`, à `ExecutableCommand` — contrairement à `Shutdown`, qui en est exclu parce que la boucle le traite elle-même — et `"cancel_run"` à `CommandName`, après `"shutdown"`.

Le test de cohérence déjà en place dans ce fichier apparie les littéraux de `CommandName` aux modèles de l'union : il couvre l'ajout sans modification.

- [ ] **Step 4: Poser le dispatch**

Dans `sidecar/src/tagger/__main__.py`, rendre `_Session.cancel_run()` asynchrone et lui faire attendre la tâche annulée, puis `await` ses deux appelants, la branche `Shutdown` de la boucle et le nouveau `case` :

```python
    async def cancel_run(self) -> None:
        running = self._active_run()
        if running is not None:
            running.cancel()
            await asyncio.wait({running})
```

```python
        case CancelRun():
            await session.cancel_run()
```

`asyncio.wait` et non `await running` : il ne relève pas l'annulation de la tâche attendue, qu'il laisse à celle-ci, et propage celle de la boucle si elle arrive pendant l'attente.

Sans ce `case`, `assert_never` fait échouer mypy : c'est le filet qui garantit qu'aucune commande n'entre au contrat sans handler.

- [ ] **Step 5: Vérifier que le test passe**

Run: `uv run pytest tests/unit/test_protocol_models.py -q && uv run mypy src`
Expected: PASS

- [ ] **Step 6: Écrire les tests d'intégration**

Dans `sidecar/tests/integration/test_ndjson_loop.py`, ajouter `import asyncio`, `StartTagging` aux imports de type et `STOP_DELAY = 0.2` sous `WAIT_TIMEOUT`, puis la fixture et les deux tests, avant `test_waits_for_an_extraction_before_leaving_on_shutdown` :

```python
@pytest.fixture
def tagging_slow_to_stop(monkeypatch: pytest.MonkeyPatch) -> None:
    """Un run sans fin qui met du temps a mourir, comme le vrai dont la sortie du cache
    attend les telechargements en vol. Borne : une annulation perdue echoue, sans geler.
    """

    async def endless(command: StartTagging, emit: Callable[[Event], None]) -> Event:
        try:
            await asyncio.wait_for(asyncio.Event().wait(), timeout=WAIT_TIMEOUT)
        finally:
            await asyncio.sleep(STOP_DELAY)
        raise AssertionError("un run annule ne rend jamais son evenement de fin")

    monkeypatch.setattr(main, "handle_start_tagging", endless)


def _start(folder: Path) -> str:
    return json.dumps({"command": "start_tagging", "folder": str(folder)}) + "\n"


@pytest.mark.usefixtures("tagging_slow_to_stop")
def test_a_cancelled_run_leaves_the_loop_alive(tmp_path: Path) -> None:
    """`CancelledError` termine la tache sans remonter au TaskGroup, qui l'ignore."""
    events = drive(_start(tmp_path) + '{"command":"cancel_run"}\n{"command":"get_version"}\n')

    assert [event["event"] for event in events] == ["version"]


@pytest.mark.usefixtures("tagging_slow_to_stop")
def test_a_run_started_right_after_a_cancellation_is_not_refused(tmp_path: Path) -> None:
    """Regression : le run annule mourait encore quand la relance arrivait, qui repartait
    en `tagging_in_progress`, code que l'interface lit comme un run qui continue.
    """
    commands = _start(tmp_path) + '{"command":"cancel_run"}\n' + _start(tmp_path)

    events = drive(commands + '{"command":"shutdown"}\n')

    assert [event for event in events if event["event"] == "error"] == []
```

Ce que le test prouve : sans l'annulation, le `TaskGroup` attendrait le run sans fin à la sortie du `async with` et `drive()` ne rendrait jamais. Le `["version"]` seul dit en outre qu'aucun événement de fin n'est émis.

La fixture doit mettre du temps à mourir, `asyncio.sleep(STOP_DELAY)` dans un `finally`, comme le vrai run dont la sortie du cache attend les téléchargements en vol : une fixture qui meurt instantanément masque la course. Et l'attente se borne par `wait_for(..., timeout=WAIT_TIMEOUT)`, pour qu'une annulation perdue échoue au lieu de geler la CI. Le second test, `test_a_run_started_right_after_a_cancellation_is_not_refused`, enchaîne `start_tagging`, `cancel_run`, `start_tagging` puis `shutdown` et n'attend aucun `error` : sans l'attente de `cancel_run`, la relance part en `tagging_in_progress`.

- [ ] **Step 7: Vérifier le sidecar de bout en bout**

Run: `uv run pytest -q && uv run ruff check src tests && uv run mypy src tests`
Expected: PASS

Puis à la main, pour voir le contrat répondre : envoyer `{"command":"cancel_run"}` suivi de `{"command":"get_version"}` à `uv run python -m tagger` et vérifier que la version sort seule, sans erreur pour l'annulation sans objet.

- [ ] **Step 8: Commit**

```bash
git add sidecar/src/tagger/protocol.py sidecar/src/tagger/__main__.py sidecar/tests/unit/test_protocol_models.py sidecar/tests/integration/test_ndjson_loop.py
git commit -m "feat(sidecar): exposer l'annulation du run au contrat"
```

---

## Task 2: L'émission par le service

**Files:**

- Modify: `src/app/core/models/protocol.ts`
- Modify: `src/app/core/sidecar.service.ts`
- Test: `src/app/core/sidecar.service.spec.ts`

**Interfaces:**

- Produces: `CancelRunCommand`, `SidecarService.cancelTagging()`
- Consumes: `TaggingRunStore.failed()` du sub-project 08

- [ ] **Step 1: Écrire les tests du service**

Dans `src/app/core/sidecar.service.spec.ts`, avant `sends the thresholds when the settings impose them` :

```typescript
  it("cancels a running run and stops it locally", async () => {
    await service.start()
    await service.startTagging("C:/Sets")

    await service.cancelTagging()

    expect(parseLine(transport.sent.at(-1) ?? "")).toEqual({ command: "cancel_run" })
    expect(service.tagging()).toBe(false)
  })

  it("sends nothing when there is no run to cancel", async () => {
    await service.start()
    const before = transport.sent.length

    await service.cancelTagging()

    expect(transport.sent.length).toBe(before)
  })
```

Le second garde la commande de partir à vide : l'interface n'expose pas le bouton hors run, mais le service ne doit pas compter sur l'écran pour cela.

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `pnpm test --run src/app/core/sidecar.service.spec.ts`
Expected: FAIL, `cancelTagging` n'existant pas

- [ ] **Step 3: Poser le miroir de la commande**

Dans `src/app/core/models/protocol.ts`, au-dessus de `ListPlaylistsCommand`, puis dans l'union `SidecarCommand` après `ShutdownCommand` :

```typescript
export interface CancelRunCommand {
  readonly command: "cancel_run"
}
```

- [ ] **Step 4: Écrire la méthode**

Dans `src/app/core/sidecar.service.ts`, au-dessus de `shutdown()` :

```typescript
  /**
   * Arrete le run en cours : le dossier lance par erreur cesse de consommer le quota
   * de l'API. L'etat se pose ici sans attendre d'evenement, l'interface etant la source
   * du geste : c'est ce que `endRun` fait deja quand le process meurt.
   */
  async cancelTagging(): Promise<void> {
    if (!this.taggingRun.running()) {
      return
    }
    await this.send({ command: "cancel_run" })
    this.taggingRun.failed()
  }
```

- [ ] **Step 5: Vérifier que les tests passent**

Run: `pnpm test --run src/app/core/sidecar.service.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/core/models/protocol.ts src/app/core/sidecar.service.ts src/app/core/sidecar.service.spec.ts
git commit -m "feat(ui): emettre l'annulation du run depuis le service"
```

---

## Task 3: Le bouton de l'en-tête

**Files:**

- Modify: `src/app/shared/components/icon.component.ts`
- Modify: `src/app/features/tagging/tagging-page.component.ts`
- Modify: `src/app/features/tagging/tagging-page.component.html`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`
- Test: `src/app/features/tagging/tagging-page.component.spec.ts`

**Interfaces:**

- Produces: le bouton « Interrompre », `IconName` élargi de `"stop"`
- Consumes: `SidecarService.cancelTagging()` de la tâche 2

- [ ] **Step 1: Écrire les tests de la page**

Dans `src/app/features/tagging/tagging-page.component.spec.ts`, ajouter `cancelTagging: vi.fn(() => Promise.resolve())` au double du service, puis en tête du `describe` :

```typescript
  const cancelButton = (fixture: { nativeElement: unknown }): HTMLElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector('[data-p-icon="stop"]')

  it("offers no way to interrupt before a run starts", async () => {
    const { fixture } = await mountWith()
    fixture.detectChanges()

    expect(cancelButton(fixture)).toBeNull()
  })

  it("interrupts the run in progress", async () => {
    const { fixture, service } = await mountWith({ tagging: signal(true) })
    fixture.detectChanges()

    cancelButton(fixture)?.closest("button")?.click()

    expect(service.cancelTagging).toHaveBeenCalled()
  })
```

La requête passe par l'icône plutôt que par le libellé : les tests montent `provideTranslateService()` sans catalogue, et les clés s'y rendent brutes.

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `pnpm test --run src/app/features/tagging/tagging-page.component.spec.ts`
Expected: FAIL sur `interrupts the run in progress`, aucun bouton ne portant l'icône

- [ ] **Step 3: Ajouter l'icône `stop`**

Dans `src/app/shared/components/icon.component.ts` : importer `Stop` depuis `@primeicons/angular/stop`, l'ajouter aux `imports` du composant et à `ICON_NAMES` après `"play"`, puis son `@case` :

```html
      @case ("stop") {
        <svg data-p-icon="stop" [size]="size()" />
      }
```

`stop` plutôt que `times` ou `ban` : c'est le pendant du `play` du lancement, et `times` porte déjà l'échec dans les tags d'état. Le test existant parcourt `ICON_NAMES` et couvre l'ajout sans modification.

- [ ] **Step 4: Ajouter les libellés**

Dans `public/i18n/fr.json` et `en.json`, sous `tagging`, juste après `start` pour que les deux actions de l'en-tête voisinent : `"cancel": "Interrompre"` et `"cancel": "Stop"`.

- [ ] **Step 5: Poser le bouton**

Dans `src/app/features/tagging/tagging-page.component.ts`, au-dessus de `start()` :

```typescript
  protected async cancel(): Promise<void> {
    await this.sidecar.cancelTagging()
  }
```

Dans `.html`, avant le `@let` du tooltip de blocage, donc à gauche du bouton de lancement qui reste visible et grisé :

```html
    @if (running()) {
      <button pButton type="button" severity="secondary" outlined (click)="cancel()">
        <app-icon name="stop" [size]="16" />{{ "tagging.cancel" | translate }}
      </button>
    }
```

- [ ] **Step 6: Vérifier que les tests passent**

Run: `pnpm test --run src/app/features/tagging/tagging-page.component.spec.ts src/app/shared/components/icon.component.spec.ts`
Expected: PASS

- [ ] **Step 7: Vérifier l'écran**

Run: `just dev`, puis lancer un run sur un dossier et cliquer « Interrompre »
Expected: la progression s'arrête, les morceaux déjà résolus gardent source, scores et pochette, les suivants passent à « Non traité », et « Lancer le run » redevient actif

- [ ] **Step 8: Documenter**

- `docs/ARCHITECTURE.md` § API : la ligne `cancel_run` du tableau des commandes, après `shutdown` dont elle partage la mécanique d'annulation.
- `docs/DESIGN.md` § Mapping Composants > Liste du run : la ligne du bouton, sa sévérité et pourquoi elle n'est pas `danger`.
- `.design-sync/NOTES.md` § Reste ouvert : l'écart, la maquette n'ayant pas d'interruption.

- [ ] **Step 9: Gate complet et commit**

Run: `just lint && just typecheck && just test`
Expected: PASS sur les trois zones

```bash
git add src/app/shared/components/icon.component.ts src/app/features/tagging/tagging-page.component.ts src/app/features/tagging/tagging-page.component.html src/app/features/tagging/tagging-page.component.spec.ts public/i18n/fr.json public/i18n/en.json docs/ARCHITECTURE.md docs/DESIGN.md .design-sync/NOTES.md
git commit -m "feat(ui): bouton d'interruption du run"
```
