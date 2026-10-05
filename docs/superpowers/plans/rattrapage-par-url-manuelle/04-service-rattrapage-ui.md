# Service Angular du rattrapage par URL : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tenir côté Angular l'état de la phase de rattrapage par URL et relayer les gestes de l'utilisateur vers le sidecar.

**Architecture:** Un `UrlRecoveryStore` de phase (progression, gestes en vol, dernière erreur par morceau), jamais injecté dans un composant. `SidecarService` y délègue la lecture, envoie `resolve_by_url` une fois par morceau en attente, route `progress(url_recovery)`, `track_resolved` et les erreurs de `resolve_by_url`, expose `recoverableTracks` et vide la phase au run suivant comme à la mort du process.

**Tech Stack:** Angular 22 (signals, `computed`, services `providedIn: "root"`), Vitest via `@angular/build:unit-test`, TypeScript strict. Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/rattrapage-par-url-manuelle/04-service-rattrapage-ui-design.md`

## Global Constraints

- **Dépend du sub-project 03, implémenté avant** : `ResolveByUrlCommand` dans `SidecarCommand` (`protocol.ts`), `progress` de phase `url_recovery`, erreurs `resolve_by_url` portant `params.track_id`.
- **Phase ouverte** ⇔ une progression `url_recovery` reçue ; l'interface ne déduit rien d'autre.
- **Morceaux affichés** (`recoverableTracks`) : `state === "unresolved"`, ou `state === "resolved"` avec `resolution === "url"`, dans l'ordre du run.
- **Geste ignoré** si l'URL est vide ou si le morceau attend déjà une réponse.
- **Cycle de vie** : `clear()` à `startTagging` et à `endRun` ; rien à `cancelTagging`.
- **État** en `WritableSignal` privés exposés en lecture seule, collections remplacées jamais mutées (`.claude/rules/angular/signals.md`).
- **Fonctions** en `const nom = (...) => ...` (ESLint `func-style`), y compris dans les fixtures et les specs.
- **Tests** : `describe`/`it` en anglais, AAA séparé par des lignes vides, transport simulé (`FakeTransport` de `sidecar.service.spec.ts`).
- **Gate vert à chaque commit** : `just lint-ui`, `just typecheck-ui`, `just test-ui`. Commits `type(scope): description`, scope `ui`.

## Review Focus

- **`malformed_command` ou `sidecar_unavailable` sur `resolve_by_url`** (sans `track_id`) : aucun morceau touché, l'erreur reste dans `lastError` (Task 2, `keeps a url error without track out of the phase`).
- **`track_resolved` en `url` pour un morceau sans geste en vol** : la ligne du run se met à jour sans lever d'erreur (Task 2, `lists the unresolved tracks and those resolved by url`, morceau `c.mp3`).
- **Deux morceaux en vol à la fois** : chacun garde son attente, la réponse de l'un ne lève pas l'autre (Task 1, `marks a track busy until its %s`, second morceau vérifié).
- **Progression `tagging` et `url_recovery` mêlées** : chacune va à sa phase (Task 2, `routes the url recovery progress to its phase only`).
- **URL faite d'espaces** : envoyée telle quelle, le sidecar la refuse en `unsupported_url` avec `track_id` (couvert par le routage d'erreur, aucun filtre côté interface au-delà de la chaîne vide).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `src/app/core/url-recovery.store.ts` | `UrlRecoveryStore` : progression, attente, erreurs, `clear`. |
| `src/app/core/url-recovery.store.spec.ts` | Mutations et ouverture du store. |
| `src/app/core/sidecar.service.ts` | Injection, `resolveByUrl`, lecture déléguée, `recoverableTracks`, routage, cycle de vie. |
| `src/app/core/sidecar.service.spec.ts` | Geste, routage, liste, cycle de vie. |
| `src/fixtures/url-recovery.ts` | `urlProgress`, `resolvedByUrl`, `urlRecoveryError`. |
| `docs/ARCHITECTURE.md` | § State Management. |

---

## Task 1: `UrlRecoveryStore` et fixtures

**Files:**
- Create: `src/app/core/url-recovery.store.ts`
- Create: `src/fixtures/url-recovery.ts`
- Test: `src/app/core/url-recovery.store.spec.ts` (création)

**Interfaces:**
- Consumes: `SidecarErrorEvent`, `ExtractionProgressEvent`, `TrackResolvedEvent` (`models/protocol.ts`) ; `RunProgress` (`tagging-run.store.ts`).
- Produces:
  - `UrlRecoveryStore` : `progress: Signal<RunProgress | null>`, `open: Signal<boolean>`, `busy: Signal<ReadonlySet<string>>`, `errors: Signal<ReadonlyMap<string, SidecarErrorEvent>>`, `isBusy(trackId: string): boolean`, `advanced(processed: number, total: number): void`, `sent(trackId: string): void`, `resolved(trackId: string): void`, `rejected(trackId: string, error: SidecarErrorEvent): void`, `clear(): void`
  - fixtures `urlProgress(processed: number, total: number): ExtractionProgressEvent`, `resolvedByUrl(trackId: string): TrackResolvedEvent`, `urlRecoveryError(trackId: string, code?: string): SidecarErrorEvent`

- [ ] **Step 1: Créer les fixtures**

Créer `src/fixtures/url-recovery.ts` :

```typescript
import type {
  ExtractionProgressEvent,
  SidecarErrorEvent,
  TrackResolvedEvent,
} from "../app/core/models/protocol"

// Evenements de la phase de rattrapage par URL partages par les specs : chaque test pose
// ses ecarts par spread.

export const urlProgress = (processed: number, total: number): ExtractionProgressEvent => ({
  event: "progress",
  phase: "url_recovery",
  processed,
  total,
})

/** Morceau rattrape par une URL Bandcamp : resolu, sans score ni motif d'echec. */
export const resolvedByUrl = (trackId: string): TrackResolvedEvent => ({
  event: "track_resolved",
  track_id: trackId,
  state: "resolved",
  resolution: "url",
  failure_reason: null,
  source: "bandcamp",
  after: { artist: "Amelie Lens", title: "Basiel" },
  scores: null,
  artwork_path: null,
})

/** Erreur d'un geste de rattrapage, `track_id` joint par le sidecar. */
export const urlRecoveryError = (trackId: string, code = "track_not_found"): SidecarErrorEvent => ({
  event: "error",
  code,
  params: { track_id: trackId, source: "bandcamp" },
  message: "track not found: bandcamp",
  command: "resolve_by_url",
})
```

- [ ] **Step 2: Écrire les tests du store**

Créer `src/app/core/url-recovery.store.spec.ts` :

```typescript
import { TestBed } from "@angular/core/testing"

import { urlRecoveryError } from "../../fixtures/url-recovery"
import { UrlRecoveryStore } from "./url-recovery.store"

describe("UrlRecoveryStore", () => {
  let store: UrlRecoveryStore

  beforeEach(() => {
    store = TestBed.inject(UrlRecoveryStore)
  })

  it("opens on the first progress", () => {
    const closed = store.open()

    store.advanced(0, 2)

    expect(closed).toBe(false)
    expect(store.open()).toBe(true)
    expect(store.progress()).toEqual({ processed: 0, total: 2 })
  })

  it.each<[string, (target: UrlRecoveryStore) => void]>([
    [
      "resolution",
      (target) => {
        target.resolved("a.mp3")
      },
    ],
    [
      "error",
      (target) => {
        target.rejected("a.mp3", urlRecoveryError("a.mp3"))
      },
    ],
  ])("marks a track busy until its %s", (_answer, answer) => {
    store.sent("a.mp3")
    store.sent("b.mp3")
    const waiting = store.isBusy("a.mp3")

    answer(store)

    expect(waiting).toBe(true)
    expect(store.isBusy("a.mp3")).toBe(false)
    expect(store.isBusy("b.mp3")).toBe(true)
  })

  it("keeps the error of a track until its next gesture", () => {
    const error = urlRecoveryError("a.mp3")
    store.rejected("a.mp3", error)
    const kept = store.errors().get("a.mp3")

    store.sent("a.mp3")

    expect(kept).toEqual(error)
    expect(store.errors().has("a.mp3")).toBe(false)
  })

  it("clears the phase", () => {
    store.advanced(1, 2)
    store.sent("a.mp3")
    store.rejected("b.mp3", urlRecoveryError("b.mp3"))

    store.clear()

    expect([store.open(), store.busy().size, store.errors().size]).toEqual([false, 0, 0])
  })
})
```

- [ ] **Step 3: Vérifier qu'ils échouent**

Run: `pnpm exec ng test --watch=false --include=src/app/core/url-recovery.store.spec.ts`
Expected: FAIL, module `./url-recovery.store` introuvable.

- [ ] **Step 4: Créer le store**

Créer `src/app/core/url-recovery.store.ts` :

```typescript
import { Injectable, computed, signal } from "@angular/core"

import type { SidecarErrorEvent } from "./models/protocol"
import type { RunProgress } from "./tagging-run.store"

/**
 * Phase de rattrapage par URL. Ouverte par la premiere progression du sidecar, seul juge
 * de son ouverture comme de l'eligibilite d'un morceau : l'interface n'en deduit rien.
 */
@Injectable({ providedIn: "root" })
export class UrlRecoveryStore {
  private readonly _progress = signal<RunProgress | null>(null)
  private readonly _busy = signal<ReadonlySet<string>>(new Set())
  private readonly _errors = signal<ReadonlyMap<string, SidecarErrorEvent>>(new Map())

  readonly progress = this._progress.asReadonly()
  readonly open = computed(() => this._progress() !== null)
  readonly busy = this._busy.asReadonly()
  /** L'evenement entier : l'ecran traduit son `code` avec ses `params`. */
  readonly errors = this._errors.asReadonly()

  isBusy(trackId: string): boolean {
    return this._busy().has(trackId)
  }

  advanced(processed: number, total: number): void {
    this._progress.set({ processed, total })
  }

  /** L'erreur precedente tombe des le nouveau geste : elle ne vaut plus pour l'URL envoyee. */
  sent(trackId: string): void {
    this._busy.update((busy) => new Set(busy).add(trackId))
    this.forget(trackId)
  }

  resolved(trackId: string): void {
    this.release(trackId)
    this.forget(trackId)
  }

  rejected(trackId: string, error: SidecarErrorEvent): void {
    this.release(trackId)
    this._errors.update((errors) => new Map(errors).set(trackId, error))
  }

  clear(): void {
    this._progress.set(null)
    this._busy.set(new Set())
    this._errors.set(new Map())
  }

  private release(trackId: string): void {
    if (this._busy().has(trackId)) {
      this._busy.update((busy) => new Set([...busy].filter((id) => id !== trackId)))
    }
  }

  private forget(trackId: string): void {
    if (this._errors().has(trackId)) {
      this._errors.update((errors) => new Map([...errors].filter(([id]) => id !== trackId)))
    }
  }
}
```

- [ ] **Step 5: Vérifier que les tests passent**

Run: `pnpm exec ng test --watch=false --include=src/app/core/url-recovery.store.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Lancer le gate**

Run: `just lint-ui && just typecheck-ui && just test-ui`
Expected: tout vert.

- [ ] **Step 7: Commit**

```bash
git add src/app/core/url-recovery.store.ts src/app/core/url-recovery.store.spec.ts src/fixtures/url-recovery.ts
git commit -m "feat(ui): tenir l'état de la phase de rattrapage par URL"
```

---

## Task 2: Geste, routage et cycle de vie dans `SidecarService`

**Files:**
- Modify: `src/app/core/sidecar.service.ts`
- Modify: `docs/ARCHITECTURE.md` (§ State Management)
- Test: `src/app/core/sidecar.service.spec.ts`

**Interfaces:**
- Consumes: `UrlRecoveryStore` (Task 1) ; `ResolveByUrlCommand` (sub-project 03) ; `TaggingRunStore.tracks`, `TaggingTrack` ; fixtures `RUN_STARTED`, `TRACK_RESOLVED`, `arbitrationRequired` (`src/fixtures/tagging.ts`), `urlProgress`, `resolvedByUrl`, `urlRecoveryError` (Task 1).
- Produces sur `SidecarService` :
  - `resolveByUrl(trackId: string, url: string): Promise<void>`
  - `urlRecoveryOpen: Signal<boolean>`, `urlRecoveryProgress: Signal<RunProgress | null>`, `urlRecoveryBusy: Signal<ReadonlySet<string>>`, `urlRecoveryErrors: Signal<ReadonlyMap<string, SidecarErrorEvent>>`
  - `recoverableTracks: Signal<readonly TaggingTrack[]>`

- [ ] **Step 1: Écrire les tests du service**

Dans `src/app/core/sidecar.service.spec.ts`, importer `TRACK_RESOLVED` à côté de `RUN_STARTED` et `arbitrationRequired`, puis `import { resolvedByUrl, urlProgress, urlRecoveryError } from "../../fixtures/url-recovery"`. Ajouter, avant la fermeture du `describe("SidecarService")` :

```typescript
  describe("url recovery", () => {
    const URL = "https://amelielens.bandcamp.com/track/basiel"

    const openPhase = async (): Promise<void> => {
      await service.start()
      transport.emit(RUN_STARTED)
      transport.emit(urlProgress(0, 2))
    }

    it("sends a url recovery command with its track and its url", async () => {
      await openPhase()

      await service.resolveByUrl("a.mp3", URL)

      expect(parseLine(transport.sent.at(-1) ?? "")).toEqual({
        command: "resolve_by_url",
        track_id: "a.mp3",
        url: URL,
      })
      expect(service.urlRecoveryBusy().has("a.mp3")).toBe(true)
    })

    it("ignores a second gesture while the first one waits", async () => {
      await openPhase()
      await service.resolveByUrl("a.mp3", URL)
      const sent = transport.sent.length

      await service.resolveByUrl("a.mp3", "https://www.beatport.com/track/your-mind/22708005")

      expect(transport.sent).toHaveLength(sent)
    })

    it("ignores an empty url", async () => {
      await openPhase()
      const sent = transport.sent.length

      await service.resolveByUrl("a.mp3", "")

      expect(transport.sent).toHaveLength(sent)
      expect(service.urlRecoveryBusy().has("a.mp3")).toBe(false)
    })

    it("routes the url recovery progress to its phase only", async () => {
      await service.start()
      transport.emit(RUN_STARTED)
      transport.emit({ event: "progress", phase: "tagging", processed: 1, total: 2 })
      const closed = service.urlRecoveryOpen()

      transport.emit(urlProgress(0, 2))

      expect(closed).toBe(false)
      expect(service.urlRecoveryOpen()).toBe(true)
      expect(service.urlRecoveryProgress()).toEqual({ processed: 0, total: 2 })
      expect(service.taggingProgress()).toEqual({ processed: 1, total: 2 })
    })

    it("releases a gesture on its resolution", async () => {
      await openPhase()
      await service.resolveByUrl("a.mp3", URL)

      transport.emit(resolvedByUrl("a.mp3"))

      expect(service.urlRecoveryBusy().has("a.mp3")).toBe(false)
      expect(service.taggingTracks()[0]?.resolution).toBe("url")
    })

    it("attaches a url recovery error to its track", async () => {
      await openPhase()
      await service.resolveByUrl("a.mp3", URL)
      const error = urlRecoveryError("a.mp3")

      transport.emit(error)

      expect(service.urlRecoveryBusy().has("a.mp3")).toBe(false)
      expect(service.urlRecoveryErrors().get("a.mp3")).toEqual(error)
      expect(service.urlRecoveryErrors().has("b.mp3")).toBe(false)
      expect(service.errorFor("resolve_by_url")()).toEqual(error)
    })

    it("keeps a url error without track out of the phase", async () => {
      await openPhase()
      await service.resolveByUrl("a.mp3", URL)
      const malformed = { ...urlRecoveryError("a.mp3", "malformed_command"), params: {} }

      transport.emit(malformed)

      expect(service.urlRecoveryErrors().size).toBe(0)
      expect(service.urlRecoveryBusy().has("a.mp3")).toBe(true)
      expect(service.lastError()).toEqual(malformed)
    })

    it("lists the unresolved tracks and those resolved by url", async () => {
      await service.start()
      transport.emit({
        ...RUN_STARTED,
        tracks: [
          ...RUN_STARTED.tracks,
          { track_id: "c.mp3", file_name: "c.mp3", artist: "Sara Landry", title: "The Void" },
          { track_id: "d.mp3", file_name: "d.mp3", artist: "Kasia", title: "Tarantula" },
        ],
      })
      transport.emit(TRACK_RESOLVED)
      transport.emit({
        ...TRACK_RESOLVED,
        track_id: "b.mp3",
        state: "unresolved",
        resolution: "none",
        failure_reason: "no_result",
        source: null,
        after: null,
        scores: null,
        artwork_path: null,
      })
      transport.emit(resolvedByUrl("c.mp3"))
      transport.emit(arbitrationRequired("d.mp3"))

      const listed = service.recoverableTracks()

      expect(listed.map((track) => track.trackId)).toEqual(["b.mp3", "c.mp3"])
    })

    it.each<[string, () => Promise<void>]>([
      [
        "a new run starts",
        async () => {
          await service.startTagging("C:/music")
        },
      ],
      [
        "the process ends",
        () => {
          transport.handlers?.onTerminated()

          return Promise.resolve()
        },
      ],
    ])("closes the phase when %s", async (_moment, close) => {
      await openPhase()
      await service.resolveByUrl("a.mp3", URL)
      transport.emit(urlRecoveryError("b.mp3"))

      await close()

      expect(service.urlRecoveryOpen()).toBe(false)
      expect(service.urlRecoveryBusy().size).toBe(0)
      expect(service.urlRecoveryErrors().size).toBe(0)
    })
  })
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `pnpm exec ng test --watch=false --include=src/app/core/sidecar.service.spec.ts`
Expected: FAIL, `service.resolveByUrl` et les signaux `urlRecovery*` inexistants (erreurs de compilation esbuild ou `TypeError`).

- [ ] **Step 3: Brancher le store**

Dans `src/app/core/sidecar.service.ts` :

1. `import { UrlRecoveryStore } from "./url-recovery.store"` après l'import de `TaggingRunStore`.
2. Injection, après `arbitration` :

```typescript
  private readonly urlRecovery = inject(UrlRecoveryStore)
```

3. Lecture déléguée, après `arbitrationOpenings` :

```typescript
  readonly urlRecoveryOpen = this.urlRecovery.open
  readonly urlRecoveryProgress = this.urlRecovery.progress
  readonly urlRecoveryBusy = this.urlRecovery.busy
  readonly urlRecoveryErrors = this.urlRecovery.errors
  /**
   * Lignes a afficher dans la phase : non resolues, ou deja rattrapees pour corriger un
   * mauvais lien. Filtre d'affichage sur des etats recus ; le sidecar reste seul juge de
   * l'eligibilite et refuse tout autre morceau.
   */
  readonly recoverableTracks = computed(() =>
    this.taggingRun
      .tracks()
      .filter(
        (track) =>
          track.state === "unresolved" ||
          (track.state === "resolved" && track.resolution === "url"),
      ),
  )
```

- [ ] **Step 4: Geste**

Après `openArbitration` :

```typescript
  /** Une URL vide partirait en `malformed_command` sans `track_id` : l'attente ne se leverait plus. */
  async resolveByUrl(trackId: string, url: string): Promise<void> {
    if (url.length === 0 || this.urlRecovery.isBusy(trackId)) {
      return
    }
    this.urlRecovery.sent(trackId)
    await this.send({ command: "resolve_by_url", track_id: trackId, url })
  }
```

- [ ] **Step 5: Routage et cycle de vie**

1. `startTagging`, après `this.arbitration.clear()` :

```typescript
    this.urlRecovery.clear()
```

2. `endRun`, après `this.arbitration.clear()` :

```typescript
    this.urlRecovery.clear()
```

3. `handleLine`, cas `track_resolved`, après `this.arbitration.resolved(event.track_id)` :

```typescript
        this.urlRecovery.resolved(event.track_id)
```

4. `handleLine`, cas `error`, après `this.routeArbitrationError(event)` :

```typescript
        this.routeUrlRecoveryError(event)
```

5. Après `routeArbitrationError`, ajouter :

```typescript
  private routeUrlRecoveryError(event: SidecarErrorEvent): void {
    const trackId = event.params["track_id"]
    if (event.command === "resolve_by_url" && typeof trackId === "string") {
      this.urlRecovery.rejected(trackId, event)
    }
  }
```

6. `routeProgress` : remplacer le cas groupé par

```typescript
      case "url_recovery":
        this.urlRecovery.advanced(event.processed, event.total)
        break
      case "write":
        // Feature 5 : son store lira cette phase, rien a suivre ici pour l'instant.
        break
```

- [ ] **Step 6: Vérifier que les tests passent**

Run: `pnpm exec ng test --watch=false --include=src/app/core/sidecar.service.spec.ts`
Expected: PASS, les tests existants du service compris.

- [ ] **Step 7: ARCHITECTURE.md**

Charger `Skill[architecture-doc]` et lire ses règles, puis dans `docs/ARCHITECTURE.md` § Frontend, State Management, compléter la phrase « `SidecarService` détient l'état du run et la file d'arbitrage » : il détient aussi la phase de rattrapage par URL, par un store de phase (`UrlRecoveryStore`), ouverte à la première progression `url_recovery` reçue, jamais déduite par l'interface.

- [ ] **Step 8: Lancer le gate**

Run: `just lint-ui && just typecheck-ui && just test-ui`
Expected: tout vert.

- [ ] **Step 9: Commit**

```bash
git add src/app/core/sidecar.service.ts src/app/core/sidecar.service.spec.ts docs/ARCHITECTURE.md
git commit -m "feat(ui): relayer le rattrapage par URL et suivre sa phase"
```
