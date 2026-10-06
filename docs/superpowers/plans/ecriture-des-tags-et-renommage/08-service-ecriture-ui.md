# Service de l'écriture côté interface : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Piloter depuis l'interface la confirmation, l'écriture, la relance et le rollback d'un run, et en exposer l'état aux écrans par un store de phase.

**Architecture:** Un `WriteStore` de phase, alimenté par le seul routage de `SidecarService`, porte confirmation, écriture, progression, fin, rollback en cours, bilan et cible. `SidecarService` envoie `commit_run`, `retry_write`, `rollback` et `get_rollback_target`, route `progress(write)`, `run_finished(write)`, `rollback_target` et `rollback_finished`, et applique les règles d'erreur. `CloseGuard` refuse la fermeture pendant l'écriture ou un rollback, `CompletionSignalService` en annonce la fin.

**Tech Stack:** Angular 22 (signals, `effect`), Vitest et le `FakeTransport` des specs, ngx-translate, PrimeNG `MessageService`. Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/ecriture-des-tags-et-renommage/08-service-ecriture-ui-design.md`

## Global Constraints

- **Dépend des sub-projects 05, 06 et 07, implémentés avant** : `CommitRunCommand`, `RetryWriteCommand`, `GetRollbackTargetCommand`, `RollbackCommand` (`track_id: string | null`), `RunFinishedEvent.written` / `write_error`, `RollbackRun`, `RollbackTargetEvent`, `RollbackFinishedEvent`, `TrackState` à cinq valeurs dans `protocol.ts`.
- **Aucun composant n'injecte `WriteStore`** : `SidecarService` ré-expose ses signaux (`.claude/rules/angular/services.md`).
- **Fermeture refusée** pendant l'écriture ou un rollback : `leave()` ne ferme rien.
- **Toast de fin** : `success` sans échec, `warn` avec le nombre d'échecs.
- **Textes** : vouvoiement, espace insécable (U+00A0) avant `:` en français, mêmes clés dans les deux langues (`translations.spec.ts`).
- **Fonctions en `const nom = () =>`**, helpers de test compris (`func-style`).
- **Tests** : noms en anglais, AAA séparé par des lignes vides.
- **Gate vert à chaque commit** : `just format-ui`, `just lint-ui`, `just typecheck-ui`, `just test-ui`. Commits `type(scope): description`, scope `ui`.

## Review Focus

- **Clic sur « Lancer le run » pendant l'écriture** : rien ne part et la liste affichée reste, l'écriture continue (Task 1, `test("ignores a launch while files are being written")`).
- **Double clic sur la confirmation** : une seule commande `commit_run` (Task 1, `sends a single commit for a double click`).
- **Moteur mort pendant un rollback** : `rollingBack` retombe, rien ne reste bloqué (Task 1, `releases the rollback when the engine dies`).
- **Nouveau run après une écriture** : la confirmation et le bilan tombent, la cible de rollback reste (Task 1, `forgets the write but keeps the target when a new run starts`).
- **Écriture finie avec des échecs** : toast d'avertissement avec leur nombre, pas un succès (Task 3, `announces a write end, with its failures when there are some`).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `src/app/core/write.store.ts` | `WriteStore`, `RollbackInFlight`. |
| `src/app/core/sidecar.service.ts` | Commandes, routage, règles d'erreur, délégation. |
| `src/app/core/models/protocol.ts` | `SidecarEvent` complété. |
| `src/fixtures/write.ts` | Événements d'écriture et de rollback des specs. |
| `src/app/core/close-guard.service.ts` | Travaux `write` et `rollback`, `blocked`. |
| `src/app/core/completion-signal.service.ts` | Fins de l'écriture et du rollback. |
| `public/i18n/{fr,en}.json` | Libellés de fermeture et toasts. |
| `docs/ARCHITECTURE.md` | § Gestion d'état. |

---

### Task 1: Store de l'écriture, commandes et routage

**Files:**
- Create: `src/app/core/write.store.ts`
- Create: `src/fixtures/write.ts`
- Modify: `src/app/core/models/protocol.ts` (`SidecarEvent`, commentaires de `RollbackTargetEvent` et `RollbackFinishedEvent`)
- Modify: `src/app/core/sidecar.service.ts`
- Modify: `src/app/core/sidecar.service.spec.ts`

**Interfaces:**
- Consumes: `TaggingRunStore.runId()`, `TaggingRunStore.reset()`, `RunProgress` ; types du contrat (cf. Global Constraints).
- Produces: `WriteStore` et `RollbackInFlight { runId: string; trackId: string | null }` ; sur `SidecarService` : signaux `committed`, `writing`, `writeProgress`, `writeFinished`, `rollingBack`, `rollbackFinished`, `rollbackTarget` (`RollbackRun | null | undefined`), méthodes `commitRun()`, `retryWrite()`, `rollback(runId: string, trackId?: string | null)`, `loadRollbackTarget()` ; fixtures `WRITE_FINISHED`, `ROLLBACK_RUN`, `rollbackFinished(trackId?)`, `commandError(command, code)`.

- [ ] **Step 1: Écrire les fixtures**

Créer `src/fixtures/write.ts` :

```ts
import type {
  RollbackFinishedEvent,
  RollbackRun,
  RunFinishedEvent,
  SidecarCommand,
  SidecarErrorEvent,
} from "../app/core/models/protocol"

// Evenements partages par les specs : chaque test pose ses ecarts par spread.

export const WRITE_FINISHED: RunFinishedEvent = {
  event: "run_finished",
  phase: "write",
  run_id: "a3f9c1",
  resolved: 0,
  unresolved: 0,
  written: 1,
  write_error: 0,
  awaiting_arbitration: 0,
}

export const ROLLBACK_RUN: RollbackRun = {
  run_id: "a3f9c1",
  written_at: "2026-10-05T21:14:03Z",
  folder: "D:/Music/Promo Octobre",
  tracks: 1,
}

export const rollbackFinished = (trackId: string | null = null): RollbackFinishedEvent => ({
  event: "rollback_finished",
  run_id: "a3f9c1",
  track_id: trackId,
  restored: ["a.mp3"],
  failed: [],
})

export const commandError = (
  command: SidecarCommand["command"],
  code: string,
): SidecarErrorEvent => ({ event: "error", code, params: {}, message: code, command })
```

- [ ] **Step 2: Écrire les specs du service**

Dans `src/app/core/sidecar.service.spec.ts`, importer `ROLLBACK_RUN`, `WRITE_FINISHED`, `commandError` et `rollbackFinished` de `../../fixtures/write`, puis avant la dernière accolade du `describe("SidecarService")` :

```ts
  describe("write phase", () => {
    const resolvedRun = async (): Promise<void> => {
      await service.start()
      await service.startTagging("C:/Sets")
      transport.emit(RUN_STARTED)
      transport.emit(TRACK_RESOLVED)
    }
    const countOf = (command: string): number =>
      transport.sent.filter((line) => commandOf(line) === command).length

    it("replays a whole write and asks for the rollback target again", async () => {
      await resolvedRun()

      await service.commitRun()
      const writing = service.writing()
      transport.emit({ event: "progress", phase: "write", processed: 1, total: 1 })
      transport.emit({ ...TRACK_RESOLVED, state: "written" })
      transport.emit(WRITE_FINISHED)

      expect(parseLine(transport.sent.at(-2) ?? "")).toEqual({
        command: "commit_run",
        run_id: "a3f9c1",
      })
      expect(writing).toBe(true)
      expect(service.writing()).toBe(false)
      expect(service.committed()).toBe(true)
      expect(service.writeProgress()).toEqual({ processed: 1, total: 1 })
      expect(service.writeFinished()?.written).toBe(1)
      expect(service.taggingTracks()[0]?.state).toBe("written")
      expect(commandOf(transport.sent.at(-1) ?? "")).toBe("get_rollback_target")
    })

    it("lets the run be confirmed again when the dump cannot be written", async () => {
      await resolvedRun()
      await service.commitRun()

      transport.emit(commandError("commit_run", "tag_dump_write_failed"))

      expect(service.writing()).toBe(false)
      expect(service.committed()).toBe(false)
      expect(service.errorFor("commit_run")()?.code).toBe("tag_dump_write_failed")
    })

    it("retries the failed writes of the confirmed run", async () => {
      await resolvedRun()
      await service.commitRun()
      transport.emit({ ...WRITE_FINISHED, written: 0, write_error: 1 })

      await service.retryWrite()
      const writing = service.writing()
      transport.emit(WRITE_FINISHED)

      expect(parseLine(transport.sent.at(-2) ?? "")).toEqual({
        command: "retry_write",
        run_id: "a3f9c1",
      })
      expect(writing).toBe(true)
      expect(service.writing()).toBe(false)
      expect(service.committed()).toBe(true)
    })

    it("sends a single commit for a double click", async () => {
      await resolvedRun()

      await service.commitRun()
      await service.commitRun()

      expect(countOf("commit_run")).toBe(1)
    })

    it("ignores a launch while files are being written", async () => {
      await resolvedRun()
      // `running` est faux : seule la garde de l'ecriture protege le lancement.
      transport.emit({ ...WRITE_FINISHED, phase: "network", resolved: 1, written: 0 })
      await service.commitRun()

      await service.startTagging("C:/Other")

      expect(countOf("start_tagging")).toBe(1)
      expect(service.taggingTracks()).toHaveLength(2)
      expect(service.writing()).toBe(true)
    })

    it.each(["write_in_progress", "rollback_in_progress"])(
      "keeps the displayed run when a launch is refused with %s",
      async (code) => {
        await resolvedRun()

        transport.emit(commandError("start_tagging", code))

        expect(service.tagging()).toBe(true)
        expect(service.taggingTracks()).toHaveLength(2)
      },
    )

    it("stops writing when the engine dies", async () => {
      await resolvedRun()
      await service.commitRun()

      transport.handlers?.onTerminated()

      expect(service.writing()).toBe(false)
    })

    it("forgets the write but keeps the target when a new run starts", async () => {
      await resolvedRun()
      transport.emit({ ...WRITE_FINISHED, phase: "network", resolved: 1, written: 0 })
      await service.commitRun()
      transport.emit(WRITE_FINISHED)
      transport.emit({ event: "rollback_target", run: ROLLBACK_RUN })

      await service.startTagging("C:/Sets")

      expect(service.committed()).toBe(false)
      expect(service.writeFinished()).toBeNull()
      expect(service.rollbackTarget()).toEqual(ROLLBACK_RUN)
    })

    it("replays a track rollback and asks for the target again", async () => {
      await resolvedRun()
      await service.commitRun()
      transport.emit(WRITE_FINISHED)

      await service.rollback("a3f9c1", "a.mp3")
      const inFlight = service.rollingBack()
      transport.emit({ ...TRACK_RESOLVED, state: "rolled_back" })
      transport.emit(rollbackFinished("a.mp3"))

      expect(parseLine(transport.sent.at(-2) ?? "")).toEqual({
        command: "rollback",
        run_id: "a3f9c1",
        track_id: "a.mp3",
      })
      expect(inFlight).toEqual({ runId: "a3f9c1", trackId: "a.mp3" })
      expect(service.rollingBack()).toBeNull()
      expect(service.rollbackFinished()?.restored).toEqual(["a.mp3"])
      expect(service.taggingTracks()[0]?.state).toBe("rolled_back")
      expect(commandOf(transport.sent.at(-1) ?? "")).toBe("get_rollback_target")
    })

    it("exposes the rollback target once asked", async () => {
      await service.start()
      const unknown = service.rollbackTarget()

      await service.loadRollbackTarget()
      transport.emit({ event: "rollback_target", run: ROLLBACK_RUN })

      expect(unknown).toBeUndefined()
      expect(commandOf(transport.sent.at(-1) ?? "")).toBe("get_rollback_target")
      expect(service.rollbackTarget()).toEqual(ROLLBACK_RUN)
    })

    it("releases the rollback when it is refused", async () => {
      await service.start()
      await service.rollback("000000")

      transport.emit(commandError("rollback", "rollback_unavailable"))

      expect(service.rollingBack()).toBeNull()
      expect(service.errorFor("rollback")()?.code).toBe("rollback_unavailable")
    })

    it("releases the rollback when the engine dies", async () => {
      await service.start()
      await service.rollback("a3f9c1")

      transport.handlers?.onTerminated()

      expect(service.rollingBack()).toBeNull()
    })
  })
```

- [ ] **Step 3: Vérifier qu'elles échouent**

Run: `just typecheck-ui`
Expected: FAIL, `Property 'commitRun' does not exist on type 'SidecarService'` et `Type '"rollback_target"' is not assignable` (événement hors `SidecarEvent`)

- [ ] **Step 4: Faire entrer les deux événements dans le contrat**

Dans `src/app/core/models/protocol.ts`, `SidecarEvent` se termine par `| RunFinishedEvent | RollbackTargetEvent | RollbackFinishedEvent | SidecarErrorEvent`. Les commentaires de `RollbackTargetEvent` et `RollbackFinishedEvent` perdent la mention « Hors `SidecarEvent` jusqu'a son routage » : le premier devient `/** \`run\` nul : rien a annuler, le bouton des Reglages se grise. */`, le second est retiré.

- [ ] **Step 5: Écrire le store**

Créer `src/app/core/write.store.ts` :

```ts
import { Injectable, signal } from "@angular/core"

import type { RollbackFinishedEvent, RollbackRun, RunFinishedEvent } from "./models/protocol"
import type { RunProgress } from "./tagging-run.store"

/** Restauration en cours : un run entier (`trackId` nul) ou un seul morceau. */
export interface RollbackInFlight {
  readonly runId: string
  readonly trackId: string | null
}

/** Phase d'ecriture et restaurations, alimentee par le seul routage de `SidecarService`. */
@Injectable({ providedIn: "root" })
export class WriteStore {
  private readonly _committed = signal(false)
  private readonly _writing = signal(false)
  private readonly _progress = signal<RunProgress | null>(null)
  private readonly _finished = signal<RunFinishedEvent | null>(null)
  private readonly _rollingBack = signal<RollbackInFlight | null>(null)
  private readonly _rollbackFinished = signal<RollbackFinishedEvent | null>(null)
  private readonly _rollbackTarget = signal<RollbackRun | null | undefined>(undefined)

  /** Vrai des l'envoi de `commit_run` : le run est fige. */
  readonly committed = this._committed.asReadonly()
  /** De l'envoi de `commit_run` ou `retry_write` a leur fin, leur erreur ou la mort du moteur. */
  readonly writing = this._writing.asReadonly()
  readonly progress = this._progress.asReadonly()
  readonly finished = this._finished.asReadonly()
  readonly rollingBack = this._rollingBack.asReadonly()
  readonly rollbackFinished = this._rollbackFinished.asReadonly()
  /** `undefined` tant que non demandee, `null` sans run annulable. */
  readonly rollbackTarget = this._rollbackTarget.asReadonly()

  committing(): void {
    this._committed.set(true)
    this.retrying()
  }

  retrying(): void {
    this._writing.set(true)
    this._progress.set(null)
  }

  advanced(processed: number, total: number): void {
    this._progress.set({ processed, total })
  }

  completed(event: RunFinishedEvent): void {
    this._finished.set(event)
    this._writing.set(false)
  }

  /** Un dump impossible n'a touche aucun fichier : le run redevient confirmable. */
  commitFailed(): void {
    this._writing.set(false)
    this._committed.set(false)
  }

  retryFailed(): void {
    this._writing.set(false)
  }

  rollbackSent(inFlight: RollbackInFlight): void {
    this._rollingBack.set(inFlight)
    this._rollbackFinished.set(null)
  }

  rolledBack(event: RollbackFinishedEvent): void {
    this._rollbackFinished.set(event)
    this._rollingBack.set(null)
  }

  rollbackFailed(): void {
    this._rollingBack.set(null)
  }

  targetFound(run: RollbackRun | null): void {
    this._rollbackTarget.set(run)
  }

  /** Nouveau run : la cible reste, elle ne depend pas du run affiche. */
  reset(): void {
    this._committed.set(false)
    this._writing.set(false)
    this._progress.set(null)
    this._finished.set(null)
    this._rollbackFinished.set(null)
  }

  failed(): void {
    this._writing.set(false)
    this._rollingBack.set(null)
  }
}
```

- [ ] **Step 6: Brancher le service**

Dans `src/app/core/sidecar.service.ts` :

Importer `WriteStore` de `./write.store`. `KNOWN_EVENTS` gagne `rollback_target: true` et `rollback_finished: true`. Après `const EXTRACTION_IN_PROGRESS = "extraction_in_progress"` :

```ts
const WRITE_IN_PROGRESS = "write_in_progress"
const ROLLBACK_IN_PROGRESS = "rollback_in_progress"
/** Refus d'un lancement qui dit que les fichiers sont pris : le run affiche continue. */
const LAUNCH_REFUSED_WHILE_BUSY: ReadonlySet<string> = new Set([
  TAGGING_IN_PROGRESS,
  WRITE_IN_PROGRESS,
  ROLLBACK_IN_PROGRESS,
])
```

Après `private readonly urlRecovery = inject(UrlRecoveryStore)` :

```ts
  private readonly writePhase = inject(WriteStore)
```

Après `readonly urlRecoveryErrors = this.urlRecovery.errors` :

```ts
  readonly committed = this.writePhase.committed
  readonly writing = this.writePhase.writing
  readonly writeProgress = this.writePhase.progress
  readonly writeFinished = this.writePhase.finished
  readonly rollingBack = this.writePhase.rollingBack
  readonly rollbackFinished = this.writePhase.rollbackFinished
  readonly rollbackTarget = this.writePhase.rollbackTarget
```

`startTagging` devient :

```ts
  /** Sans ce garde, `reset()` viderait la liste d'un run en cours ou en ecriture. */
  async startTagging(folder: string, thresholds?: ThresholdsPayload): Promise<void> {
    if (this.taggingRun.running() || this.filesBusy()) {
      return
    }
    this.taggingRun.reset()
    this.writePhase.reset()
    // Le sidecar jette les arbitrages de l'ancien run a la reception de la commande.
    this.arbitration.clear()
    this.urlRecovery.clear()
    // `JSON.stringify` omet une cle `undefined` : la commande part sans `thresholds`.
    await this.send({ command: "start_tagging", folder, thresholds })
  }
```

Après `resolveByUrl` :

```ts
  /** Point de non-retour : un second clic ne repart pas. */
  async commitRun(): Promise<void> {
    const runId = this.taggingRun.runId()
    if (runId === null || this.filesBusy()) {
      return
    }
    this.writePhase.committing()
    await this.send({ command: "commit_run", run_id: runId })
  }

  async retryWrite(): Promise<void> {
    const runId = this.taggingRun.runId()
    if (runId === null || this.filesBusy()) {
      return
    }
    this.writePhase.retrying()
    await this.send({ command: "retry_write", run_id: runId })
  }

  /** `trackId` nul : le run entier, y compris un run d'une session precedente. */
  async rollback(runId: string, trackId: string | null = null): Promise<void> {
    if (this.filesBusy()) {
      return
    }
    this.writePhase.rollbackSent({ runId, trackId })
    await this.send({ command: "rollback", run_id: runId, track_id: trackId })
  }

  async loadRollbackTarget(): Promise<void> {
    // Lecture seule : sans moteur lance, pas de `reportUnavailable`, qui arreterait le run.
    if (this._available() !== true) {
      return
    }
    await this.send({ command: "get_rollback_target" })
  }
```

Après `gesture` :

```ts
  /** Une seule operation sur les fichiers a la fois, comme le sidecar l'impose. */
  private filesBusy(): boolean {
    return this.writePhase.writing() || this.writePhase.rollingBack() !== null
  }

  private routeWriteError(event: SidecarErrorEvent): void {
    switch (event.command) {
      case "commit_run":
        if (event.code !== WRITE_IN_PROGRESS) {
          this.writePhase.commitFailed()
        }
        break
      case "retry_write":
        if (event.code !== WRITE_IN_PROGRESS) {
          this.writePhase.retryFailed()
        }
        break
      case "rollback":
        if (event.code !== ROLLBACK_IN_PROGRESS) {
          this.writePhase.rollbackFailed()
        }
        break
      default:
        break
    }
  }
```

`endRun` gagne `this.writePhase.failed()`. Dans `handleLine`, le cas `run_finished` devient :

```ts
      case "run_finished":
        if (event.phase === "network") {
          this.taggingRun.completed(event)
        } else {
          this.writePhase.completed(event)
          // Un dump vient d'etre cree : le dernier run annulable a change.
          void this.loadRollbackTarget()
        }
        break
      case "rollback_target":
        this.writePhase.targetFound(event.run)
        break
      case "rollback_finished":
        this.writePhase.rolledBack(event)
        // Un dump vient d'etre consomme : la cible passe au run precedent.
        void this.loadRollbackTarget()
        break
```

Dans le cas `error`, la condition sur `start_tagging` devient `if (event.command === "start_tagging" && !LAUNCH_REFUSED_WHILE_BUSY.has(event.code))`, et `this.routeWriteError(event)` s'ajoute après `this.routeUrlRecoveryError(event)`. Dans `routeProgress`, le cas `write` devient :

```ts
      case "write":
        this.writePhase.advanced(event.processed, event.total)
        break
```

- [ ] **Step 7: Vérifier que tout passe**

Run: `just typecheck-ui && just test-ui`
Expected: PASS (le test existant « leaves the tagging run alone when a write phase finishes » compris)

- [ ] **Step 8: Lancer le gate**

Run: `just format-ui && just lint-ui`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/app/core/write.store.ts src/fixtures/write.ts src/app/core/models/protocol.ts src/app/core/sidecar.service.ts src/app/core/sidecar.service.spec.ts
git commit -m "feat(ui): store de l'écriture, confirmation, relance et rollback"
```

---

### Task 2: Fermeture refusée pendant l'écriture et le rollback

**Files:**
- Modify: `src/app/core/close-guard.service.ts`
- Modify: `src/app/core/close-guard.service.spec.ts`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json` (`app.close`)

**Interfaces:**
- Consumes: Task 1 (`SidecarService.writing`, `SidecarService.rollingBack`, `RollbackInFlight`).
- Produces: `PendingWork` gagne `{ kind: "write" }` et `{ kind: "rollback" }` ; `CloseGuard.blocked: Signal<boolean>`, vrai quand le travail en cours contient l'un des deux ; `leave()` sans effet quand `blocked()`. Le sub-project 10 en tire la modale à « Rester » seul.

- [ ] **Step 1: Écrire les specs**

Dans `src/app/core/close-guard.service.spec.ts`, importer `type RollbackInFlight` de `./write.store`, et compléter le `sidecar` de `setup` :

```ts
  const sidecar = {
    extracting: signal(false),
    tagging: signal(false),
    arbitrationCount: signal(0),
    writing: signal(false),
    rollingBack: signal<RollbackInFlight | null>(null),
  }
```

puis, dans le `describe` :

```ts
  it("refuses to close while files are being written", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.writing.set(true)

    const held = appWindow.close()
    await guard.leave()

    expect(held).toBe(true)
    expect(guard.request()).toEqual([{ kind: "write" }])
    expect(guard.blocked()).toBe(true)
    expect(appWindow.destroyed).toBe(0)
  })

  it("refuses to close while a rollback runs", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.rollingBack.set({ runId: "a3f9c1", trackId: null })

    const held = appWindow.close()
    await guard.leave()

    expect(held).toBe(true)
    expect(guard.request()).toEqual([{ kind: "rollback" }])
    expect(appWindow.destroyed).toBe(0)
  })

  it("lets the user leave a run that only waits", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.tagging.set(true)
    appWindow.close()

    await guard.leave()

    expect(guard.blocked()).toBe(false)
    expect(appWindow.destroyed).toBe(1)
  })

  it("lets the user leave once the write ends while the dialog is open", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.writing.set(true)
    appWindow.close()

    sidecar.writing.set(false)
    await guard.leave()

    expect(guard.blocked()).toBe(false)
    expect(appWindow.destroyed).toBe(1)
  })
```

- [ ] **Step 2: Vérifier qu'elles échouent**

Run: `just test-ui`
Expected: FAIL, `guard.blocked is not a function` et une demande vide pendant l'écriture

- [ ] **Step 3: Compter l'écriture et le rollback**

Dans `src/app/core/close-guard.service.ts`, `PendingWork` devient :

```ts
export type PendingWork =
  | { readonly kind: "extraction" }
  | { readonly kind: "tagging" }
  | { readonly kind: "arbitration"; readonly count: number }
  | { readonly kind: "write" }
  | { readonly kind: "rollback" }

/** Quitter couperait un fichier en plein travail : Tauri arrete le sidecar a la sortie. */
const BLOCKING: ReadonlySet<PendingWork["kind"]> = new Set(["write", "rollback"])
```

Dans `pendingWork`, avant `return work` :

```ts
    if (this.sidecar.writing()) {
      work.push({ kind: "write" })
    }
    if (this.sidecar.rollingBack() !== null) {
      work.push({ kind: "rollback" })
    }
```

Après `readonly request = this._request.asReadonly()` :

```ts
  /** Lu en direct : l'ecriture peut finir modale ouverte, elle redevient alors quittable. */
  readonly blocked = computed(() => this.pendingWork().some((work) => BLOCKING.has(work.kind)))
```

`leave()` commence par :

```ts
    if (this.blocked()) {
      return
    }
```

- [ ] **Step 4: Traduire les deux travaux**

Dans `app.close`, après `arbitration` :

`public/i18n/fr.json` :

```json
      "write": "L'écriture des fichiers est en cours : attendez qu'elle se termine pour quitter.",
      "rollback": "Une restauration est en cours : attendez qu'elle se termine pour quitter.",
```

`public/i18n/en.json` :

```json
      "write": "Files are being written: wait for it to finish before quitting.",
      "rollback": "A restore is in progress: wait for it to finish before quitting.",
```

- [ ] **Step 5: Vérifier que tout passe**

Run: `just typecheck-ui && just test-ui`
Expected: PASS (`translations.spec.ts` compris)

- [ ] **Step 6: Lancer le gate**

Run: `just format-ui && just lint-ui`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/app/core/close-guard.service.ts src/app/core/close-guard.service.spec.ts public/i18n/fr.json public/i18n/en.json
git commit -m "feat(ui): refuser la fermeture pendant l'écriture et le rollback"
```

---

### Task 3: Signal de fin de l'écriture et du rollback

**Files:**
- Modify: `src/app/core/completion-signal.service.ts`
- Modify: `src/app/core/completion-signal.service.spec.ts`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json` (`tagging`)

**Interfaces:**
- Consumes: Task 1 (`SidecarService.writeFinished`, `SidecarService.rollbackFinished`) ; fixtures `WRITE_FINISHED`, `rollbackFinished`.
- Produces: `CompletionSignalService.announce(messageKey: string, params?: Record<string, unknown>, severity?: "success" | "warn")`.

- [ ] **Step 1: Écrire les specs**

Dans `src/app/core/completion-signal.service.spec.ts`, importer `type RollbackFinishedEvent, type RunFinishedEvent` de `./models/protocol` et `WRITE_FINISHED, rollbackFinished` de `../../fixtures/write`. Déclarer à côté de `taggingFinished` :

```ts
  let writeFinished: WritableSignal<RunFinishedEvent | null>
  let rolledBack: WritableSignal<RollbackFinishedEvent | null>
```

Dans `beforeEach`, initialiser `writeFinished = signal(null)` et `rolledBack = signal(null)`, et le stub devient `{ extraction, taggingFinished, writeFinished, rollbackFinished: rolledBack }`. Puis :

```ts
  it("announces a write end, with its failures when there are some", () => {
    const announce = watchPhaseEnds()

    writeFinished.set({ ...WRITE_FINISHED })
    TestBed.tick()
    writeFinished.set({ ...WRITE_FINISHED, written: 0, write_error: 2 })
    TestBed.tick()

    expect(announce.mock.calls).toEqual([
      ["tagging.writeFinished"],
      ["tagging.writeFinishedWithFailures", { count: 2 }, "warn"],
    ])
  })

  it("announces a rollback end, with its failures when there are some", () => {
    const announce = watchPhaseEnds()

    rolledBack.set(rollbackFinished())
    TestBed.tick()
    rolledBack.set({
      ...rollbackFinished(),
      failed: [{ track_id: "b.mp3", file_name: "X - Y.mp3", reason: "file_locked" }],
    })
    TestBed.tick()

    expect(announce.mock.calls).toEqual([
      ["tagging.rollbackFinished"],
      ["tagging.rollbackFinishedWithFailures", { count: 1 }, "warn"],
    ])
  })

  it("shows a warning toast when told so", async () => {
    vi.mocked(load).mockResolvedValue({ get: vi.fn().mockResolvedValue(false) } as unknown as Store)
    const add = vi.spyOn(messages, "add")

    await service.announce("tagging.writeFinishedWithFailures", { count: 2 }, "warn")

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: "warn" }))
  })
```

- [ ] **Step 2: Vérifier qu'elles échouent**

Run: `just test-ui`
Expected: FAIL, aucun appel d'`announce` pour l'écriture ni pour le rollback

- [ ] **Step 3: Annoncer les deux fins**

Dans `src/app/core/completion-signal.service.ts`, à la fin du constructeur :

```ts
    effect(() => {
      const written = this.sidecar.writeFinished()
      if (written !== null) {
        void this.announceEnd("tagging.writeFinished", written.write_error)
      }
    })
    effect(() => {
      const restored = this.sidecar.rollbackFinished()
      if (restored !== null) {
        void this.announceEnd("tagging.rollbackFinished", restored.failed.length)
      }
    })
```

`announce` devient :

```ts
  async announce(
    messageKey: string,
    params: Record<string, unknown> = {},
    severity: "success" | "warn" = "success",
  ): Promise<void> {
    if (await readSoundSignal()) {
      this.beep()
    }
    this.messages.add({
      severity,
      summary: this.translate.instant(messageKey, params) as string,
      life: 4000,
    })
  }

  private announceEnd(messageKey: string, failures: number): Promise<void> {
    return failures === 0
      ? this.announce(messageKey)
      : this.announce(`${messageKey}WithFailures`, { count: failures }, "warn")
  }
```

`announceEnd` se place avant `beep`, avec les autres méthodes privées.

- [ ] **Step 4: Traduire les quatre fins**

Dans `tagging`, après `finished` :

`public/i18n/fr.json` :

```json
    "writeFinished": "Écriture terminée",
    "writeFinishedWithFailures": "Écriture terminée. Fichiers en échec : {{count}}",
    "rollbackFinished": "Restauration terminée",
    "rollbackFinishedWithFailures": "Restauration terminée. Fichiers non restaurés : {{count}}",
```

`public/i18n/en.json` :

```json
    "writeFinished": "Writing complete",
    "writeFinishedWithFailures": "Writing complete. Failed files: {{count}}",
    "rollbackFinished": "Restore complete",
    "rollbackFinishedWithFailures": "Restore complete. Files not restored: {{count}}",
```

- [ ] **Step 5: Vérifier que tout passe**

Run: `just typecheck-ui && just test-ui`
Expected: PASS (le test existant « announces each phase end once » garde ses appels à un argument)

- [ ] **Step 6: Lancer le gate**

Run: `just format-ui && just lint-ui`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/app/core/completion-signal.service.ts src/app/core/completion-signal.service.spec.ts public/i18n/fr.json public/i18n/en.json
git commit -m "feat(ui): annoncer la fin de l'écriture et du rollback"
```

---

### Task 4: Le store de l'écriture dans l'architecture

**Files:**
- Modify: `docs/ARCHITECTURE.md` (§ Frontend, paragraphe « Services injectés + signals natifs Angular » ; § Capacités Natives, paragraphe du signal sonore)
- Modify: `docs/DESIGN.md` (§ Feedback, ligne « Notifications non bloquantes »)

- [ ] **Step 1: Documenter**

Charger `Skill[architecture-doc]` avant d'éditer. Dans le paragraphe qui nomme `UrlRecoveryStore`, ajouter : « l'écriture et les restaurations par un second store de phase (`WriteStore`) : confirmation, progression, fin, rollback en cours, bilan et dernier run annulable, ce dernier redemandé après chaque écriture et chaque restauration. Pendant une écriture ou une restauration, `CloseGuard` refuse la fermeture, Tauri arrêtant le sidecar à la sortie ».

Au § Capacités Natives, paragraphe « Le signal sonore marque la fin d'une phase longue » (`docs/ARCHITECTURE.md:384`) : ajouter que le signal sonne aussi à la fin d'une écriture et à celle d'un rollback.

Charger `Skill[design-doc]` et lire son template avant d'éditer. Dans `docs/DESIGN.md` § Feedback, ligne « Notifications non bloquantes » : ajouter que la fin d'une écriture et celle d'un rollback s'annoncent aussi et que, avec des échecs, le toast passe en `warn` et en donne le nombre, écart assumé à la fiche `Toast` du design system.

- [ ] **Step 2: Vérifier le rendu**

Run: `just format-ui && just lint-ui`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add docs/ARCHITECTURE.md docs/DESIGN.md
git commit -m "docs(ui): store de l'écriture, fermeture bloquée et toast d'échec"
```
