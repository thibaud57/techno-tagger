# Runs passés : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre de rouvrir en lecture seule, depuis les Réglages, le récapitulatif d'un run passé relu dans son rapport.

**Architecture:**
- **`PastRunsStore`** porte la liste des runs écrits (`runs_listed`) et le run rouvert (`run_loaded`), converti en `TaggingTrack` par une fonction pure.
- **`SidecarService`** expose `listRuns` et `loadRun`, gardés par la disponibilité du moteur, relance la liste après chaque écriture et lève le chargement d'un run refusé par `routeLoadRunError`.
- **La rangée « Runs passés » des Réglages** propose un `p-select` en Signal Forms et un bouton qui navigue vers `/tagging/recap/:runId`.
- **`RecapPageComponent`** (sub-project 06) gagne une entrée `runId`. Avec elle, la page charge le run passé, l'affiche sous une ligne de contexte et retire tout geste de restauration ainsi que les messages du run vivant.

**Tech Stack:** Angular 22 (signals, Signal Forms, `withComponentInputBinding`), PrimeNG 22 (`p-select`), ngx-translate 18, Vitest.

**Spec:** `docs/superpowers/specs/plan-de-run-reprise-et-rapport/07-runs-passes-ui-design.md`

## Global Constraints

- **Dépend des sub-projects 04, 05 et 06, implémentés avant** :
  - 04 : `ListRunsCommand`, `LoadRunCommand`, `RunsListedEvent`, `RunLoadedEvent`, `PastRun`, `TrackLoaded` (avec `tags_before: TagsBefore | null`, sans `restorable`) ;
  - 05 : `runDate` dans `shared/utils/run-date.ts` et le cas sans effet de `handleLine` qui ne regroupe plus que `runs_listed` et `run_loaded` ;
  - 06 : `RecapPageComponent` (export default, `mountWith(tracks, overrides)` dans son spec), `injectRunRestore()`, `RunListComponent.emptyState`, `TaggingTrack.sourceUrl`, route `tagging/recap`, `src/fixtures/virtual-scroll.ts`.
- **Lecture seule** : un run passé n'offre ni « Restaurer le run », ni « Restaurer ce morceau », ni « Nouveau run ». `restorable` est forcé à faux. Il n'affiche ni le message d'échec d'écriture ni le bilan de restauration, qui sont ceux du run vivant.
- **Libellé d'un run** : la clé existante `settings.admin.rollback.target` (« Run du {{date}} sur {{folder}} »), pour les options du sélecteur comme pour la ligne de contexte. La date est `written_at`, passée par `runDate`.
- **`list_runs`** part quand le moteur devient disponible (effet des Réglages) et après chaque `run_finished` en phase `write`. `list_runs` et `load_run` ne partent pas sans moteur disponible.
- **Refus de `load_run`** : `routeLoadRunError` vide le chargement, y compris sur un `phase_busy`. Le refus s'affiche par `errorFor("load_run")`.
- **Aucun `changeDetection` déclaré**, tokens seulement, `size="small"` sur tout bouton, fonctions `const f = () =>`.
- **Textes** : FR et EN dans le même commit, espace insécable U+00A0 avant `:`, `;`, `?` et `!` en français.
- **Tests** : noms en anglais, AAA, traductions en clés brutes. Un test qui compte les lignes du récap stubbe le scroll virtuel (`src/fixtures/virtual-scroll.ts`).
- **Gate vert à chaque commit** : `just format-ui` puis `just lint-ui && just typecheck-ui && just test-ui`. Commits `feat(ui): …`.

## Review Focus

- **Deep-link sur un run inconnu** (`/tagging/recap/000000`) : le message de `run_not_found` remplace la table (Task 3, `replaces the table with the refusal`).
- **Retour à `/tagging/recap` sans `runId` après un run passé** : le récap du run affiché revient et le run chargé ne le masque pas (Task 3, `shows the live run without a run id`).
- **Registre vide** : sélecteur et bouton désactivés, placeholder « Aucun run passé » (Task 2, `disables the row without past runs`).
- **Écriture terminée, Réglages déjà montés** : la liste se rafraîchit d'elle-même (Task 1, `lists the runs again once a write phase ends`).
- **Liste rafraîchie pendant le choix** : le run choisi reste sélectionné s'il est toujours listé (Task 2, `keeps the chosen run when the list is refreshed`).
- **Phase longue en cours** : `load_run` refusé en `phase_busy` lève le chargement (Task 1, `ends the loading when a running phase refuses the run`).
- **Ouvertures du même run** : une commande par instance de la page et jamais deux en vol pour le même run (Task 1, `asks for a run once while it loads` ; Task 3, `loads a past run once per page`).
- **Run passé et run vivant en échec** : les messages du run vivant n'apparaissent pas sur un run passé (Task 3, `leaves the write failure message to the live run` et `leaves the rollback failures to the live run`).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `src/app/core/past-runs.store.ts` | Liste, run rouvert, chargement, conversion `TrackLoaded` en `TaggingTrack` |
| `src/app/core/sidecar.service.ts` | `listRuns`, `loadRun`, routage, relance après écriture, `routeLoadRunError` |
| `src/fixtures/past-runs.ts` | `PAST_RUN`, `TRACK_LOADED`, `runsListed`, `runLoaded` |
| `src/app/features/settings/settings-page.component.*` | Rangée « Runs passés » |
| `src/app/features/tagging/recap-page.component.*` | `runId`, chargement, contexte, lecture seule, refus |
| `src/app/app.routes.ts` | `tagging/recap/:runId` |
| `public/i18n/{fr,en}.json` | `settings.admin.pastRuns.*`, `recap.past.*` |
| `docs/DESIGN.md`, `docs/ARCHITECTURE.md`, `.design-sync/NOTES.md` | Mapping, arbitrage, route, écarts |

---

### Task 1: Store et service des runs passés

**Files:**
- Create: `src/app/core/past-runs.store.ts`, `past-runs.store.spec.ts`
- Create: `src/fixtures/past-runs.ts`
- Modify: `src/app/core/sidecar.service.ts`, `sidecar.service.spec.ts`

**Interfaces:**
- Consumes: `PastRun`, `RunLoadedEvent`, `TrackLoaded` (04) ; `TaggingTrack` avec `sourceUrl` (06).
- Produces :
  - `PastRunsStore` : `runs: Signal<readonly PastRun[] | null>`, `loaded: Signal<LoadedRun | null>`, `loading: Signal<string | null>`, `listed(runs)`, `loadStarted(runId)`, `loadedRun(event)`, `loadFailed()` ;
  - `interface LoadedRun { runId; folder; writtenAt; tracks }` et `loadedTrack(track: TrackLoaded): TaggingTrack` ;
  - sur `SidecarService` : `pastRuns`, `loadedRun`, `loadingRun`, `listRuns(): Promise<void>`, `loadRun(runId: string): Promise<void>`.

- [ ] **Step 1: Écrire les fixtures**

`src/fixtures/past-runs.ts` :

```ts
import type {
  PastRun,
  RunLoadedEvent,
  RunsListedEvent,
  TrackLoaded,
} from "../app/core/models/protocol"

import { TAGS_AFTER, TAGS_BEFORE } from "./tagging"

export const PAST_RUN: PastRun = {
  run_id: "a3f9c1",
  written_at: "2026-08-02T21:30:00Z",
  folder: "D:/Sets/Aout",
  report_path: "D:/Sets/Aout/tagging-report-20260802T213000Z.json",
}

export const TRACK_LOADED: TrackLoaded = {
  track_id: "a.mp3",
  file_name: "a.mp3",
  file_after: "Lior Vance - Dim Orbit (Original Mix).mp3",
  artist: "Lior Vance",
  title: "Dim Orbit",
  state: "written",
  resolution: "auto",
  failure_reason: null,
  source: "beatport",
  after: { artist: "Lior Vance", title: "Dim Orbit (Original Mix)" },
  scores: { artist: 96, title: 92, average: 94 },
  tags_before: TAGS_BEFORE,
  tags_after: TAGS_AFTER,
  source_url: "https://www.beatport.com/track/dim-orbit/99000101",
  artwork_path: null,
}

export const runsListed = (...runs: PastRun[]): RunsListedEvent => ({ event: "runs_listed", runs })

export const runLoaded = (...tracks: TrackLoaded[]): RunLoadedEvent => ({
  event: "run_loaded",
  run_id: PAST_RUN.run_id,
  folder: PAST_RUN.folder,
  generated_at: PAST_RUN.written_at,
  tracks,
})
```

- [ ] **Step 2: Écrire les tests**

`src/app/core/past-runs.store.spec.ts` :

```ts
import { TestBed } from "@angular/core/testing"

import { PAST_RUN, TRACK_LOADED, runLoaded } from "../../fixtures/past-runs"

import { PastRunsStore, loadedTrack } from "./past-runs.store"

describe("PastRunsStore", () => {
  let store: PastRunsStore

  beforeEach(() => {
    store = TestBed.inject(PastRunsStore)
  })

  it("turns a loaded track into a read-only run track", () => {
    const track = loadedTrack(TRACK_LOADED)

    expect(track).toMatchObject({
      trackId: "a.mp3",
      fileName: "a.mp3",
      state: "written",
      resolution: "auto",
      sourceUrl: TRACK_LOADED.source_url,
      tagsBefore: TRACK_LOADED.tags_before,
      tagsAfter: TRACK_LOADED.tags_after,
      arbitration: null,
      restorable: false,
    })
  })

  it("keeps the loaded run and ends the loading", () => {
    store.loadStarted(PAST_RUN.run_id)

    store.loadedRun(runLoaded(TRACK_LOADED))

    expect(store.loading()).toBeNull()
    expect(store.loaded()).toMatchObject({
      runId: PAST_RUN.run_id,
      folder: PAST_RUN.folder,
      writtenAt: PAST_RUN.written_at,
    })
    expect(store.loaded()?.tracks).toHaveLength(1)
  })

  it("forgets the loaded run when another one is requested", () => {
    store.loadedRun(runLoaded(TRACK_LOADED))

    store.loadStarted("b4c5d6")

    expect(store.loaded()).toBeNull()
    expect(store.loading()).toBe("b4c5d6")
  })

  it("keeps the loaded run when the same one is requested again", () => {
    store.loadedRun(runLoaded(TRACK_LOADED))

    store.loadStarted(PAST_RUN.run_id)

    expect(store.loaded()?.runId).toBe(PAST_RUN.run_id)
  })

  it("ends the loading when the run is refused", () => {
    store.loadStarted(PAST_RUN.run_id)

    store.loadFailed()

    expect(store.loading()).toBeNull()
  })
})
```

Dans `src/app/core/sidecar.service.spec.ts`, importer `PAST_RUN`, `TRACK_LOADED`, `runLoaded` et `runsListed` depuis `../../fixtures/past-runs` (`WRITE_FINISHED`, `RUN_STARTED`, `commandError` et `phaseBusy` y sont déjà importés). Dans le `describe` principal, après `describe("interrupted run", ...)` (sub-project 05) :

```ts
  describe("past runs", () => {
    it("feeds the past runs from the listing", async () => {
      await service.start()

      transport.emit(runsListed(PAST_RUN))

      expect(service.pastRuns()).toEqual([PAST_RUN])
    })

    it("loads a past run", async () => {
      await service.start()

      await service.loadRun(PAST_RUN.run_id)
      const loading = service.loadingRun()
      transport.emit(runLoaded(TRACK_LOADED))

      expect(parseLine(transport.sent.at(-1) ?? "")).toEqual({
        command: "load_run",
        run_id: PAST_RUN.run_id,
      })
      expect(loading).toBe(PAST_RUN.run_id)
      expect(service.loadedRun()?.runId).toBe(PAST_RUN.run_id)
      expect(service.loadingRun()).toBeNull()
    })

    it("asks for a run once while it loads", async () => {
      await service.start()

      await service.loadRun(PAST_RUN.run_id)
      await service.loadRun(PAST_RUN.run_id)

      const loads = transport.sent.filter((line) => commandOf(line) === "load_run")
      expect(loads).toHaveLength(1)
    })

    it("ends the loading when the run is refused", async () => {
      await service.start()
      await service.loadRun("000000")

      transport.emit(commandError("load_run", "run_not_found", { run_id: "000000" }))

      expect(service.loadingRun()).toBeNull()
      expect(service.errorFor("load_run")()?.code).toBe("run_not_found")
    })

    it("ends the loading when a running phase refuses the run", async () => {
      await service.start()
      await service.loadRun(PAST_RUN.run_id)

      transport.emit(phaseBusy("load_run", "tagging"))

      expect(service.loadingRun()).toBeNull()
      expect(service.errorFor("load_run")()?.code).toBe("phase_busy")
    })

    it("lists the runs again once a write phase ends", async () => {
      await service.start()

      transport.emit(WRITE_FINISHED)

      expect(transport.sent.map(commandOf)).toContain("list_runs")
    })

    it("sends nothing and keeps the displayed run when asked without an engine", async () => {
      await service.start()
      await service.startTagging("C:/Sets")
      transport.emit(RUN_STARTED)
      transport.handlers?.onTerminated()
      const sent = transport.sent.length

      await service.listRuns()
      await service.loadRun(PAST_RUN.run_id)

      expect(transport.sent).toHaveLength(sent)
      expect(service.loadingRun()).toBeNull()
      expect(service.errorFor("list_runs", "load_run")()).toBeNull()
      expect(service.taggingTracks()).toHaveLength(2)
    })
  })
```

- [ ] **Step 3: Lancer les tests, ils échouent**

Run: `pnpm exec ng test --include src/app/core/past-runs.store.spec.ts --include src/app/core/sidecar.service.spec.ts --watch=false`
Expected: FAIL, `PastRunsStore` introuvable.

- [ ] **Step 4: Écrire le store**

`src/app/core/past-runs.store.ts` :

```ts
import { signal, Service } from "@angular/core"

import type { PastRun, RunLoadedEvent, TrackLoaded } from "./models/protocol"
import type { TaggingTrack } from "./tagging-run.store"

export interface LoadedRun {
  readonly runId: string
  readonly folder: string
  /** `generated_at` du rapport : le meme instant que `written_at` du registre. */
  readonly writtenAt: string
  readonly tracks: readonly TaggingTrack[]
}

/** Recopie champ a champ : le sidecar est seul juge des etats. Lecture seule, `restorable` faux. */
export const loadedTrack = (track: TrackLoaded): TaggingTrack => ({
  trackId: track.track_id,
  fileName: track.file_name,
  artist: track.artist,
  title: track.title,
  state: track.state,
  resolution: track.resolution,
  failureReason: track.failure_reason,
  source: track.source,
  after: track.after,
  scores: track.scores,
  artworkPath: track.artwork_path,
  tagsBefore: track.tags_before,
  tagsAfter: track.tags_after,
  sourceUrl: track.source_url,
  arbitration: null,
  restorable: false,
})

/** Runs ecrits relisibles depuis leurs rapports et celui que le recapitulatif a rouvert. */
@Service()
export class PastRunsStore {
  private readonly _runs = signal<readonly PastRun[] | null>(null)
  private readonly _loaded = signal<LoadedRun | null>(null)
  private readonly _loading = signal<string | null>(null)

  readonly runs = this._runs.asReadonly()
  readonly loaded = this._loaded.asReadonly()
  readonly loading = this._loading.asReadonly()

  listed(runs: readonly PastRun[]): void {
    this._runs.set(runs)
  }

  /** Un autre run charge ne doit pas rester sous le nom de celui qu'on attend. */
  loadStarted(runId: string): void {
    this._loading.set(runId)
    if (this._loaded()?.runId !== runId) {
      this._loaded.set(null)
    }
  }

  loadedRun(event: RunLoadedEvent): void {
    this._loading.set(null)
    this._loaded.set({
      runId: event.run_id,
      folder: event.folder,
      writtenAt: event.generated_at,
      tracks: event.tracks.map(loadedTrack),
    })
  }

  loadFailed(): void {
    this._loading.set(null)
  }
}
```

`loadedTrack` couvre tous les champs de `TaggingTrack` (06 y a ajouté `sourceUrl`) : le typecheck le confirme.

- [ ] **Step 5: Câbler le service**

Dans `src/app/core/sidecar.service.ts` :

1. Importer `PastRunsStore` depuis `./past-runs.store` (après `./models/protocol`).

2. Injecter et exposer :

```ts
  private readonly pastRunsStore = inject(PastRunsStore)
```

et dans le bloc de délégation :

```ts
  /** Runs passes, nuls tant que le moteur n'a pas repondu a `list_runs`. */
  readonly pastRuns = this.pastRunsStore.runs
  readonly loadedRun = this.pastRunsStore.loaded
  /** `runId` en cours de chargement, nul sinon. */
  readonly loadingRun = this.pastRunsStore.loading
```

3. Méthodes, sous `loadRollbackTarget` :

```ts
  async listRuns(): Promise<void> {
    // Lecture seule, comme `loadRollbackTarget` : sans moteur lance, pas de `reportUnavailable`, qui
    // arreterait le run affiche.
    if (this._available() !== true) {
      return
    }
    await this.send({ command: "list_runs" })
  }

  /** Un run deja en chargement n'est pas redemande : chaque `load_run` retelecharge les pochettes. */
  async loadRun(runId: string): Promise<void> {
    if (this._available() !== true || this.pastRunsStore.loading() === runId) {
      return
    }
    this.pastRunsStore.loadStarted(runId)
    await this.send({ command: "load_run", run_id: runId })
  }
```

4. Dans `handleLine`, retirer le groupe sans effet restant (`runs_listed` et `run_loaded`, sub-project 05) et ajouter :

```ts
      case "runs_listed":
        this.pastRunsStore.listed(event.runs)
        break
      case "run_loaded":
        this.pastRunsStore.loadedRun(event)
        break
```

5. Dans le cas `run_finished`, branche `write`, après `void this.loadRollbackTarget()` :

```ts
          // Un rapport vient d'etre ecrit : la liste des runs passes a change.
          void this.listRuns()
```

6. Dans le cas `error`, juste après `this.routeLaunchError(event)` et avant le test de `PHASE_BUSY` :

```ts
        // `load_run` n'ouvre aucune phase, mais une phase occupee le refuse aussi : le chargement tombe.
        this.routeLoadRunError(event)
```

7. Méthode privée, sous `routeUrlRecoveryError` :

```ts
  private routeLoadRunError(event: SidecarErrorEvent): void {
    if (event.command === "load_run") {
      this.pastRunsStore.loadFailed()
    }
  }
```

- [ ] **Step 6: Lancer les tests, ils passent**

Run: `pnpm exec ng test --include src/app/core/past-runs.store.spec.ts --include src/app/core/sidecar.service.spec.ts --watch=false`
Expected: PASS

- [ ] **Step 7: Gate et commit**

Run: `just format-ui && just lint-ui && just typecheck-ui && just test-ui`
Expected: tout vert

```bash
git add src/app/core/past-runs.store.ts src/app/core/past-runs.store.spec.ts src/app/core/sidecar.service.ts src/app/core/sidecar.service.spec.ts src/fixtures/past-runs.ts
git commit -m "feat(ui): liste et rechargement des runs passes"
```

---

### Task 2: Rangée « Runs passés » des Réglages

**Files:**
- Modify: `src/app/features/settings/settings-page.component.ts`, `.html`, `.spec.ts`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`

**Interfaces:**
- Consumes: `SidecarService.pastRuns`, `listRuns` (Task 1) ; `runDate` (05).
- Produces : navigation vers `/tagging/recap/:runId` ; `data-action="open-past-run"`.

- [ ] **Step 1: Lire la maquette**

Lire la rangée « Restauration » de `SettingsScreen.jsx` (`LAST_RUN`) et les fiches `components/forms/SettingsRow.prompt.md` et `components/forms/Select.prompt.md`. La nouvelle rangée suit le même patron.

- [ ] **Step 2: Écrire les tests**

Dans `src/app/features/settings/settings-page.component.spec.ts` :

1. Importer `PastRun` depuis `../../core/models/protocol`, `Router` et `provideRouter` depuis `@angular/router` et `PAST_RUN` depuis `../../../fixtures/past-runs`.
2. Étendre le sous-ensemble mocké : ajouter `| "pastRuns" | "listRuns"` à `SidecarServiceStub` (les signaux du service sont en lecture seule : un test les pose par `mountWith({ pastRuns })`, jamais par `.set` sur le stub).
3. Dans `base` du `mountWith`, après `loadRollbackTarget` :

```ts
    pastRuns: signal<readonly PastRun[] | null>(null),
    listRuns: vi.fn(() => Promise.resolve()),
```

4. Ajouter `provideRouter([])` aux `providers` du `mountWith`.
5. Après le test `undoes the last run after a confirmation that names it` (`translateWith` y est défini plus haut dans le `describe`), ajouter :

```ts
  describe("past runs", () => {
    const rowOf = (fixture: { nativeElement: unknown }): HTMLElement =>
      fixture.nativeElement as HTMLElement

    it("asks for the past runs once the engine is available", () => {
      const available = signal<boolean | null>(null)
      const { fixture, service } = mountWith({ available })
      const before = vi.mocked(service.listRuns).mock.calls.length

      available.set(true)
      fixture.detectChanges()

      expect(before).toBe(0)
      expect(service.listRuns).toHaveBeenCalledTimes(1)
    })

    it("lists the past runs as the engine ordered them, the latest first", () => {
      const pastRuns = signal<readonly PastRun[] | null>([
        { ...PAST_RUN, run_id: "b4c5d6", folder: "D:/Sets/Septembre" },
        PAST_RUN,
      ])
      const { component } = mountWith({ pastRuns })
      translateWith({ rollback: { target: "{{folder}}" } })

      const labels = component["pastRunOptions"]().map((option) => option.label)

      expect(labels).toEqual(["D:/Sets/Septembre", "D:/Sets/Aout"])
    })

    it("chooses the latest run first", () => {
      const pastRuns = signal<readonly PastRun[] | null>([
        { ...PAST_RUN, run_id: "b4c5d6" },
        PAST_RUN,
      ])
      const { component } = mountWith({ pastRuns })

      const chosen = component["pastChoice"]().runId

      expect(chosen).toBe("b4c5d6")
    })

    it("keeps the chosen run when the list is refreshed", () => {
      const pastRuns = signal<readonly PastRun[] | null>([
        PAST_RUN,
        { ...PAST_RUN, run_id: "b4c5d6" },
      ])
      const { component } = mountWith({ pastRuns })
      component["pastChoice"].set({ runId: "b4c5d6" })

      pastRuns.set([{ ...PAST_RUN, run_id: "c7d8e9" }, PAST_RUN, { ...PAST_RUN, run_id: "b4c5d6" }])

      expect(component["pastChoice"]().runId).toBe("b4c5d6")
    })

    it("falls back on the latest run when the chosen one is gone", () => {
      const pastRuns = signal<readonly PastRun[] | null>([
        PAST_RUN,
        { ...PAST_RUN, run_id: "b4c5d6" },
      ])
      const { component } = mountWith({ pastRuns })
      component["pastChoice"].set({ runId: "b4c5d6" })

      pastRuns.set([{ ...PAST_RUN, run_id: "c7d8e9" }, PAST_RUN])

      expect(component["pastChoice"]().runId).toBe("c7d8e9")
    })

    it("opens the summary of the chosen run", () => {
      const { fixture } = mountWith({ pastRuns: signal<readonly PastRun[] | null>([PAST_RUN]) })
      const navigate = vi.spyOn(TestBed.inject(Router), "navigateByUrl").mockResolvedValue(true)
      fixture.detectChanges()

      rowOf(fixture).querySelector<HTMLButtonElement>('[data-action="open-past-run"]')?.click()

      expect(navigate).toHaveBeenCalledWith("/tagging/recap/a3f9c1")
    })

    it("enables the row once a run is listed", () => {
      const { fixture, component } = mountWith({
        pastRuns: signal<readonly PastRun[] | null>([PAST_RUN]),
      })

      const open = rowOf(fixture).querySelector<HTMLButtonElement>('[data-action="open-past-run"]')

      expect(open?.disabled).toBe(false)
      expect(component["pastFields"].runId().disabled()).toBe(false)
    })

    it("disables the row without past runs", () => {
      const { fixture, component } = mountWith({
        pastRuns: signal<readonly PastRun[] | null>([]),
      })

      const open = rowOf(fixture).querySelector<HTMLButtonElement>('[data-action="open-past-run"]')

      expect(open?.disabled).toBe(true)
      expect(component["pastFields"].runId().disabled()).toBe(true)
    })
  })
```

- [ ] **Step 3: Lancer les tests, ils échouent**

Run: `pnpm exec ng test --include src/app/features/settings/settings-page.component.spec.ts --watch=false`
Expected: FAIL, `pastRunOptions` n'existe pas.

- [ ] **Step 4: Écrire la rangée**

Dans `settings-page.component.ts` :

1. Imports : ajouter `disabled` à l'import de `@angular/forms/signals` (`FormField, disabled, form`), `Router` depuis `@angular/router`, `Select` depuis `primeng/select` et `Select` aux `imports` du composant. `linkedSignal` et `runDate` sont déjà importés (05).

2. Types, sous `ApiKeyEntry` :

```ts
interface PastRunOption {
  readonly value: string
  readonly label: string
}

interface PastRunChoice {
  runId: string | null
}
```

3. Champs, sous `private readonly confirmDanger = injectDangerConfirm()` :

```ts
  private readonly router = inject(Router)
```

et après `rollbackError` :

```ts
  /** Tableau modifiable : `p-select` n'accepte pas un tableau en lecture seule. */
  protected readonly pastRunOptions = computed<PastRunOption[]>(() => {
    // `currentLang()` est lu ici : la liste se retraduit au changement de langue.
    const language = this.translate.currentLang()

    return (this.sidecar.pastRuns() ?? []).map((run) => ({
      value: run.run_id,
      label: this.translate.instant("settings.admin.rollback.target", {
        date: runDate(run.written_at, language),
        folder: run.folder,
      }) as string,
    }))
  })
  /**
   * Le plus recent par defaut, dans l'ordre du registre. Le choix survit a une nouvelle liste ou a
   * un changement de langue tant que son run y figure.
   */
  protected readonly pastChoice = linkedSignal<PastRunOption[], PastRunChoice>({
    source: this.pastRunOptions,
    computation: (options, previous) => ({
      runId:
        options.find((option) => option.value === previous?.value.runId)?.value ??
        options[0]?.value ??
        null,
    }),
  })
  protected readonly pastFields = form(this.pastChoice, (path) => {
    disabled(path.runId, () => this.pastRunOptions().length === 0)
  })
```

4. Dans l'effet du constructeur :

```ts
    effect(() => {
      if (this.sidecar.available() === true) {
        untracked(() => {
          void this.sidecar.loadRollbackTarget()
          void this.sidecar.listRuns()
        })
      }
    })
```

5. Méthode, sous `restoreLast` :

```ts
  protected openPastRun(): void {
    const runId = this.pastChoice().runId
    if (runId !== null) {
      void this.router.navigateByUrl(`/tagging/recap/${runId}`)
    }
  }
```

Dans `settings-page.component.html`, après la rangée « Restauration » (le `</app-settings-row>` qui précède `</section>` de la section « Administration ») :

```html
  <app-settings-row>
    <span rowLabel class="text-sm">{{ "settings.admin.pastRuns.label" | translate }}</span>

    <div rowControl class="flex min-w-0 items-center gap-4">
      <!-- Aucune largeur figee : le select prend le reste de la ligne et coupe le dossier.
           `contain` : sans lui, un dossier long elargirait la colonne des controles. -->
      <p-select
        class="min-w-0 flex-1 contain-inline-size"
        size="small"
        data-field="past-run"
        [formField]="pastFields.runId"
        [options]="pastRunOptions()"
        optionLabel="label"
        optionValue="value"
        [placeholder]="'settings.admin.pastRuns.none' | translate"
      >
        <!-- Ferme, le select coupe le texte : le tooltip le rend lisible. -->
        <ng-template #selectedItem let-run>
          <app-truncated-text [text]="run.label" />
        </ng-template>
      </p-select>
      <button
        pButton
        type="button"
        size="small"
        [outlined]="true"
        severity="secondary"
        class="shrink-0"
        data-action="open-past-run"
        [disabled]="pastChoice().runId === null"
        (click)="openPastRun()"
      >
        {{ "settings.admin.pastRuns.open" | translate }}
      </button>
    </div>

    <span class="text-xs text-pretty whitespace-pre-line text-muted-color">{{
      "settings.admin.pastRuns.hint" | translate
    }}</span>
  </app-settings-row>
```

- [ ] **Step 5: Ajouter les textes**

`public/i18n/fr.json`, sous `settings.admin`, à côté de `rollback` :

```json
      "pastRuns": {
        "label": "Runs passés",
        "hint": "Rouvre le récapitulatif d'un run écrit, relu dans son rapport.",
        "none": "Aucun run passé",
        "open": "Ouvrir le récapitulatif"
      },
```

`public/i18n/en.json` :

```json
      "pastRuns": {
        "label": "Past runs",
        "hint": "Reopens the summary of a written run, read from its report.",
        "none": "No past run",
        "open": "Open the summary"
      },
```

- [ ] **Step 6: Lancer les tests, ils passent**

Run: `pnpm exec ng test --include src/app/features/settings/settings-page.component.spec.ts --include src/app/core/translations.spec.ts --watch=false`
Expected: PASS

- [ ] **Step 7: Gate et commit**

Run: `just format-ui && just lint-ui && just typecheck-ui && just test-ui`
Expected: tout vert

```bash
git add src/app/features/settings public/i18n
git commit -m "feat(ui): rangee des runs passes dans les reglages"
```

---

### Task 3: Récapitulatif d'un run passé

**Files:**
- Modify: `src/app/features/tagging/recap-page.component.ts`, `.html`, `.spec.ts`
- Modify: `src/app/app.routes.ts`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`
- Modify: `docs/DESIGN.md`, `docs/ARCHITECTURE.md`, `.design-sync/NOTES.md`

**Interfaces:**
- Consumes : `SidecarService.loadRun`, `loadedRun`, `errorFor("load_run")` (Task 1) ; `LoadedRun` ; `RecapPageComponent` et son template (06) ; `runDate` (05).
- Produces : route `tagging/recap/:runId` et entrée `RecapPageComponent.runId: InputSignal<string | undefined>`.

- [ ] **Step 1: Écrire les tests**

Dans `src/app/features/tagging/recap-page.component.spec.ts` (06) :

1. Imports à ajouter : `SidecarCommand` et `SidecarErrorEvent` aux types de `../../core/models/protocol` ; `LoadedRun` et `loadedTrack` depuis `../../core/past-runs.store` ; `TRACK_LOADED` depuis `../../../fixtures/past-runs` ; `commandError` et `rollbackFinished` depuis `../../../fixtures/write`.

2. Étendre `mountWith` : un troisième paramètre `runId?: string`, six signaux de plus dans `base` et la pose de l'entrée avant le premier rendu :

```ts
const mountWith = async (
  tracks: readonly TaggingTrack[],
  overrides: Partial<Record<string, unknown>> = {},
  runId?: string,
) => {
  const base = {
    taggingTracks: signal(tracks),
    taggingRunId: signal<string | null>(tracks.length > 0 ? "a3f9c1" : null),
    writing: signal(false),
    rollingBack: signal<RollbackInFlight | null>(null),
    rollbackFinished: signal<RollbackFinishedEvent | null>(null),
    rollback: vi.fn(() => Promise.resolve()),
    clearRun: vi.fn(),
    available: signal<boolean | null>(true),
    loadedRun: signal<LoadedRun | null>(null),
    loadRun: vi.fn(() => Promise.resolve()),
    lastError: signal<SidecarErrorEvent | null>(null),
    lastErrorCommand: signal<SidecarCommand["command"] | null>(null),
    errorFor: SidecarService.prototype.errorFor,
    ...overrides,
  }
```

Puis, après `const fixture = TestBed.createComponent(RecapPageComponent)` :

```ts
  if (runId !== undefined) {
    fixture.componentRef.setInput("runId", runId)
  }
  fixture.detectChanges()
```

(le reste de `mountWith` est inchangé).

3. À la fin du `describe` principal, avant sa fermeture :

```ts
  describe("past run", () => {
    const LOADED: LoadedRun = {
      runId: "a3f9c1",
      folder: "D:/Sets/Aout",
      writtenAt: "2026-08-02T21:30:00Z",
      tracks: [loadedTrack(TRACK_LOADED)],
    }

    it("loads a past run once per page", async () => {
      const { service } = await mountWith([], {}, "a3f9c1")

      expect(service.loadRun).toHaveBeenCalledExactlyOnceWith("a3f9c1")
    })

    it("waits for the engine before loading", async () => {
      const available = signal<boolean | null>(null)
      const { service } = await mountWith([], { available }, "a3f9c1")
      const before = service.loadRun.mock.calls.length

      available.set(true)
      TestBed.tick()

      expect(before).toBe(0)
      expect(service.loadRun).toHaveBeenCalledExactlyOnceWith("a3f9c1")
    })

    it("shows skeleton rows until the run is loaded, then its tracks under the context line", async () => {
      const loadedRun = signal<LoadedRun | null>(null)
      const { fixture } = await mountWith([], { loadedRun }, "a3f9c1")
      const waiting = hostOf(fixture).querySelector("app-skeleton-rows")
      const waitingText = hostOf(fixture).textContent

      loadedRun.set(LOADED)
      await settleScroller(fixture)

      expect(waiting).not.toBeNull()
      expect(waitingText).not.toContain("recap.empty.heading")
      expect(hostOf(fixture).querySelector("app-skeleton-rows")).toBeNull()
      expect(rowsIn(fixture)).toBe(1)
      expect(hostOf(fixture).textContent).toContain("settings.admin.rollback.target")
    })

    it("offers no restore and no new run on a past run", async () => {
      const { fixture } = await mountWith(
        [{ ...written("live", "Kelvor"), restorable: true }],
        { loadedRun: signal(LOADED) },
        "a3f9c1",
      )
      hostOf(fixture).querySelector<HTMLElement>("[data-row-toggle]")?.click()
      await settleScroller(fixture)

      const offered = ["restore-run", "restore-track", "new-run"].map((name) =>
        hostOf(fixture).querySelector(`[data-action="${name}"]`),
      )

      expect(offered).toEqual([null, null, null])
    })

    it("leaves the write failure message to the live run", async () => {
      const failed = { ...loadedTrack(TRACK_LOADED), state: "write_error" as const }
      const { fixture } = await mountWith(
        [],
        { loadedRun: signal({ ...LOADED, tracks: [failed] }) },
        "a3f9c1",
      )

      expect(rowsIn(fixture)).toBe(1)
      expect(hostOf(fixture).querySelector("[data-write-failures]")).toBeNull()
    })

    it("leaves the rollback failures to the live run", async () => {
      const failedRollback = {
        ...rollbackFinished(),
        failed: [{ track_id: "b.mp3", file_name: "X - Y.mp3", reason: "file_locked" as const }],
      }
      const { fixture } = await mountWith(
        [written("live", "Kelvor")],
        { rollbackFinished: signal(failedRollback), loadedRun: signal(LOADED) },
        "a3f9c1",
      )

      expect(hostOf(fixture).querySelector("[data-rollback-failures]")).toBeNull()
    })

    it("replaces the table with the refusal", async () => {
      const refusal = commandError("load_run", "run_not_found", { run_id: "000000" })
      const { fixture } = await mountWith(
        [],
        { lastError: signal(refusal), lastErrorCommand: signal("load_run") },
        "000000",
      )

      const text = hostOf(fixture).textContent

      expect(text).toContain("errors.run_not_found")
      expect(text).toContain("recap.past.unavailable")
      expect(hostOf(fixture).querySelector("app-run-list")).toBeNull()
    })

    it("shows the live run without a run id", async () => {
      const { fixture, component } = await mountWith([written("live", "Kelvor")], {
        loadedRun: signal(LOADED),
      })

      expect(component["tracks"]().map((track) => track.trackId)).toEqual(["live"])
      expect(rowsIn(fixture)).toBe(1)
      expect(hostOf(fixture).textContent).not.toContain("settings.admin.rollback.target")
    })
  })
```

- [ ] **Step 2: Lancer les tests, ils échouent**

Run: `pnpm exec ng test --include src/app/features/tagging/recap-page.component.spec.ts --watch=false`
Expected: FAIL, `runId` n'est pas une entrée du composant.

- [ ] **Step 3: Étendre l'écran**

Remplacer `src/app/features/tagging/recap-page.component.ts` par la version complète (celle du sub-project 06, plus `runId`, le chargement, le contexte et la lecture seule) :

```ts
import { Component, computed, effect, inject, input, signal, untracked } from "@angular/core"
import { FormField, form } from "@angular/forms/signals"
import { Router } from "@angular/router"
import { TranslatePipe, TranslateService } from "@ngx-translate/core"
import { ButtonDirective } from "primeng/button"
import { IconField } from "primeng/iconfield"
import { InputIcon } from "primeng/inputicon"
import { InputText } from "primeng/inputtext"
import { SelectButton } from "primeng/selectbutton"
import { Tooltip } from "primeng/tooltip"

import { SidecarService } from "../../core/sidecar.service"
import { DangerConfirmComponent } from "../../shared/components/danger-confirm.component"
import { EmptyStateComponent } from "../../shared/components/empty-state.component"
import { ErrorMessageComponent } from "../../shared/components/error-message.component"
import { IconComponent } from "../../shared/components/icon.component"
import { MessageComponent } from "../../shared/components/message.component"
import { RollbackFailuresComponent } from "../../shared/components/rollback-failures.component"
import { TruncatedTextComponent } from "../../shared/components/truncated-text.component"
import { FADE_IN, PAGE_HOST } from "../../shared/utils/motion"
import { runDate } from "../../shared/utils/run-date"
import { TOOLTIP } from "../../shared/utils/tooltip"

import {
  inFilter,
  matchesSearch,
  RECAP_FILTERS,
  recapCounts,
  type RecapFilter,
} from "./recap-filter"
import { RunListComponent } from "./run-list.component"
import { injectRunRestore } from "./run-restore"

interface RecapCriteria {
  filter: RecapFilter
  query: string
}

/**
 * Recapitulatif du run affiche (maquette `Recap`) ou, avec `runId`, d'un run passe relu dans son
 * rapport, en lecture seule. La relance reste au bouton d'action de la liste.
 */
@Component({
  selector: "app-recap-page",
  imports: [
    TranslatePipe,
    FormField,
    ButtonDirective,
    IconField,
    InputIcon,
    InputText,
    SelectButton,
    Tooltip,
    DangerConfirmComponent,
    EmptyStateComponent,
    ErrorMessageComponent,
    IconComponent,
    MessageComponent,
    RollbackFailuresComponent,
    RunListComponent,
    TruncatedTextComponent,
  ],
  templateUrl: "./recap-page.component.html",
  host: { class: PAGE_HOST, "animate.enter": FADE_IN },
})
export default class RecapPageComponent {
  private readonly sidecar = inject(SidecarService)
  private readonly router = inject(Router)
  private readonly translate = inject(TranslateService)

  protected readonly runRestore = injectRunRestore()
  protected readonly tooltip = TOOLTIP

  /** Lie par le Router (`withComponentInputBinding`) : un run passe, sinon le run affiche. */
  readonly runId = input<string>()

  protected readonly past = computed(() => this.runId() !== undefined)
  /** Le run charge ne vaut que pour le `runId` de la route : un autre ne s'affiche pas sous son nom. */
  protected readonly loaded = computed(() => {
    const run = this.sidecar.loadedRun()

    return run !== null && run.runId === this.runId() ? run : null
  })
  private readonly loadError = this.sidecar.errorFor("load_run")
  protected readonly refusal = computed(() => (this.past() ? this.loadError() : null))
  /** Tant que le run n'est ni charge ni refuse : le squelette occupe la table, jamais l'etat vide. */
  protected readonly loading = computed(
    () => this.past() && this.loaded() === null && this.refusal() === null,
  )
  protected readonly tracks = computed(() =>
    this.past() ? (this.loaded()?.tracks ?? []) : this.sidecar.taggingTracks(),
  )
  protected readonly context = computed(() => {
    const run = this.loaded()

    return run === null
      ? null
      : { date: runDate(run.writtenAt, this.translate.currentLang()), folder: run.folder }
  })
  /** Lecture seule : les fichiers d'un run passe ont pu etre retagues depuis. */
  protected readonly restorableIds = computed<ReadonlySet<string>>(() =>
    this.past() ? new Set<string>() : this.runRestore.restorableIds(),
  )

  /** Filtre et recherche en un seul signal : `form()` en derive les champs que `[formField]` lie. */
  protected readonly criteria = signal<RecapCriteria>({ filter: "all", query: "" })
  protected readonly fields = form(this.criteria)

  protected readonly filesBusy = this.sidecar.filesBusy
  protected readonly writing = this.sidecar.writing
  /** Compte sur les morceaux affiches : un morceau restaure sort du message. */
  protected readonly writeFailures = computed(
    () => this.tracks().filter((track) => track.state === "write_error").length,
  )
  protected readonly counts = computed(() => recapCounts(this.tracks()))
  /** `label` : PrimeNG le pose en `aria-label` de chaque bouton, faute de quoi il y met l'objet. */
  protected readonly options = computed(() => {
    // `currentLang()` est lu pour que les libelles suivent la langue : `instant` ne notifie rien.
    void this.translate.currentLang()
    const counts = this.counts()

    return RECAP_FILTERS.map((value) => {
      const name = this.translate.instant(`recap.filter.${value}`) as string

      return { value, name, count: counts[value], label: `${name} ${counts[value]}` }
    })
  })
  protected readonly visible = computed(() => {
    const { filter, query } = this.criteria()

    return this.tracks().filter((track) => inFilter(track, filter) && matchesSearch(track, query))
  })

  constructor() {
    // Une commande par instance de la page : l'effet ne se rejoue que si `runId` ou la disponibilite
    // du moteur change. `loadRun` ne renvoie pas un run deja en vol.
    effect(() => {
      const runId = this.runId()
      if (runId !== undefined && this.sidecar.available() === true) {
        untracked(() => void this.sidecar.loadRun(runId))
      }
    })
  }

  protected newRun(): void {
    this.sidecar.clearRun()
    void this.router.navigateByUrl("/tagging")
  }
}
```

Remplacer `src/app/features/tagging/recap-page.component.html` par :

```html
@if (refusal(); as shown) {
  <app-error-message [error]="shown" />
  <app-empty-state
    framed
    icon="search"
    [heading]="'recap.past.unavailable' | translate"
    [description]="'recap.past.unavailableHint' | translate"
  />
} @else if (!past() && tracks().length === 0) {
  <app-empty-state
    framed
    icon="search"
    [heading]="'recap.none.heading' | translate"
    [description]="'recap.none.description' | translate"
  />
} @else {
  <div class="flex items-center gap-4">
    <div class="flex min-w-0 flex-col">
      <h1 class="text-2xl font-semibold">{{ "recap.title" | translate }}</h1>
      @if (context(); as line) {
        <app-truncated-text
          class="text-sm text-muted-color"
          [text]="'settings.admin.rollback.target' | translate: line"
        />
      }
    </div>

    <div class="ml-auto flex items-center gap-4">
      <span id="recap-filter-label" class="sr-only">{{ "recap.filter.label" | translate }}</span>
      <p-selectbutton
        size="small"
        [formField]="fields.filter"
        [options]="options()"
        optionValue="value"
        [allowEmpty]="false"
        ariaLabelledBy="recap-filter-label"
      >
        <ng-template #item let-option>
          <span class="flex items-center gap-2" [attr.data-filter]="option.value">
            {{ option.name }}
            <span class="text-muted-color tabular-nums">{{ option.count }}</span>
          </span>
        </ng-template>
      </p-selectbutton>
      <p-iconfield>
        <p-inputicon><app-icon name="search" [size]="16" /></p-inputicon>
        <input
          pInputText
          pSize="small"
          data-field="search"
          [formField]="fields.query"
          [placeholder]="'recap.search' | translate"
          [attr.aria-label]="'recap.search' | translate"
        />
      </p-iconfield>
    </div>
  </div>

  @if (!past()) {
    @if (!writing() && writeFailures() > 0) {
      <!-- Le texte seul : la relance est le bouton d'action du run, dans l'onglet Tagging. -->
      <app-message severity="error" data-write-failures>
        {{ "tagging.write.failed" | translate: { count: writeFailures() } }}
      </app-message>
    }

    <app-rollback-failures [failures]="runRestore.runRollbackFailures()" />
  }

  <div class="min-h-0 flex-1">
    <app-run-list
      [tracks]="visible()"
      [loading]="loading()"
      [frozen]="true"
      emptyState="search"
      [restorableIds]="restorableIds()"
      [restoringTrackId]="runRestore.restoringTrackId()"
      [restoreBlocked]="filesBusy()"
      (restore)="runRestore.restoreTrack($event)"
    />
  </div>

  @if (!past()) {
    <div class="flex items-center gap-2">
      @if (runRestore.canRestoreRun()) {
        @let restoreBusy = filesBusy() ? ("tagging.rollback.blocked" | translate) : undefined;
        <button
          pButton
          type="button"
          size="small"
          [outlined]="true"
          data-action="restore-run"
          [disabled]="filesBusy()"
          [pTooltip]="restoreBusy"
          [tooltipOptions]="tooltip"
          (click)="runRestore.restoreRun()"
        >
          <app-icon [name]="runRestore.restoringRun() ? 'spinner' : 'refresh'" [size]="16" />
          {{ "tagging.rollback.run" | translate }}
        </button>
      }
      <button
        pButton
        type="button"
        size="small"
        [text]="true"
        severity="secondary"
        class="ml-auto"
        data-action="new-run"
        (click)="newRun()"
      >
        <app-icon name="plus" [size]="16" />
        {{ "recap.newRun" | translate }}
      </button>
    </div>
  }
}

<app-danger-confirm />
```

- [ ] **Step 4: Déclarer la route et les textes**

Dans `src/app/app.routes.ts`, après `tagging/recap` :

```ts
  {
    path: "tagging/recap/:runId",
    loadComponent: () => import("./features/tagging/recap-page.component"),
  },
```

`withComponentInputBinding()` est déjà passé à `provideRouter` dans `src/app/app.config.ts` : l'entrée `runId` reçoit le paramètre de la route.

`public/i18n/fr.json`, sous `recap` :

```json
    "past": {
      "unavailable": "Ce run ne peut pas être rouvert",
      "unavailableHint": "Rouvrez-le depuis les Réglages."
    },
```

`public/i18n/en.json` :

```json
    "past": {
      "unavailable": "This run cannot be reopened",
      "unavailableHint": "Reopen it from the settings."
    },
```

- [ ] **Step 5: Documenter**

Relire les lignes citées avant d'éditer : leurs numéros sont ceux du 2026-10-12.

Dans `docs/DESIGN.md` :
- **§ Formulaires**, après la ligne « Rangée des Réglages » : ajouter « Runs passés | `p-select` `size="small"` en Signal Forms + bouton « Ouvrir le récapitulatif » `secondary` outlined, dans une `SettingsRowComponent` | PrimeNG | Sous « Restauration ». Options « Run du {date} sur {dossier} », le plus récent d'abord, sans largeur figée : le dossier est coupé et son tooltip le montre. Sélecteur et bouton désactivés sans run. Ouvre `/tagging/recap/:runId`, récapitulatif en lecture seule sous une ligne de contexte ».
- **§ Arbitrages**, daté du jour de l'implémentation : « Runs passés : rangée des Réglages, sélecteur et bouton plutôt qu'une table (la page ne défile pas), récapitulatif rouvert en lecture seule. Absents de la maquette ».

Dans `docs/ARCHITECTURE.md`, § Navigation (L376, déjà modifiée par le plan 06) : compléter « l'onglet Tagging portant aussi `/tagging/recap`, le récapitulatif du run affiché » par «  et `/tagging/recap/:runId`, celui d'un run passé ».

Dans `.design-sync/NOTES.md` § Reste ouvert, à la suite des lignes déjà ajoutées : « `SettingsScreen` : rangée « Runs passés ». `Recap` : ligne de contexte et lecture seule d'un run passé ».

- [ ] **Step 6: Lancer les tests, ils passent**

Run: `pnpm exec ng test --include src/app/features/tagging/recap-page.component.spec.ts --include src/app/core/translations.spec.ts --watch=false`
Expected: PASS, tests du sub-project 06 compris.

- [ ] **Step 7: Gate et commit**

Run: `just format-ui && just lint-ui && just typecheck-ui && just test-ui`
Expected: tout vert

```bash
git add src/app/features/tagging src/app/app.routes.ts public/i18n docs/DESIGN.md docs/ARCHITECTURE.md .design-sync/NOTES.md
git commit -m "feat(ui): rouvrir en lecture seule le recapitulatif d'un run passe"
```
