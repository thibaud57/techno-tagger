# État du run de re-tagging côté webview : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Porter côté webview l'état d'un run de re-tagging, alimenté par les événements du sidecar.

**Architecture:** `core/models/protocol.ts` reçoit le miroir des messages du run. Un `TaggingRunStore` de `core/` tient l'état en signals : les lignes dans l'ordre du run, la progression, le run en cours et les compteurs de fin. `SidecarService` reste la frontière du transport, envoie `start_tagging`, route les événements vers le store et l'expose par délégation, pour que les composants n'injectent qu'un service.

**Tech Stack:** Angular 22 (signals, `computed`, `@Injectable({ providedIn: "root" })`), TypeScript 6 strict, Vitest.

**Spec:** `docs/superpowers/specs/onglet-scraping-pipeline-de-re-tagging/08-service-sidecar-tagging-design.md`

## Global Constraints

- **Dépend du sub-project 07** : le contrat exact vient de `sidecar/src/tagger/protocol.py`. Ce fichier TypeScript en est le miroir maintenu à la main, sans génération de code.
- **Unions littérales** pour tout champ d'état : sans littéral, aucun narrowing, et le `switch` exhaustif de `handleLine` ne protège plus.
- **`KNOWN_EVENTS` et la branche `default: const exhaustive: never`** restent la garde : ajouter un événement au contrat sans le traiter doit casser la compilation.
- **Signals en lecture seule** hors du store (`asReadonly()`, `computed()`), mutations par méthodes, et une nouvelle référence à chaque mise à jour : muter une `Map` en place ne notifie personne.
- **Aucune logique métier côté webview** : le store range ce qu'il reçoit. La famille visuelle d'un état est dérivée par `StateTagComponent` au sub-project 09.
- **Aucun RxJS** : le handler écrit directement dans les signals, aucun opérateur ne s'applique au flux.
- **Tests** : noms en anglais, AAA séparé par des lignes vides, `FakeTransport` existant pour le service, instanciation directe pour le store.
- **Gate qualité vert à chaque commit** : `just test`, `just lint`, `just typecheck`. Commits `type(scope): description`, scope `ui`.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `src/app/core/models/protocol.ts` | Miroir de la commande et des quatre événements du run. |
| `src/app/core/tagging-run.store.ts` | Lignes du run, progression, run en cours, compteurs de fin. |
| `src/app/core/tagging-run.store.spec.ts` | Tests du store. |
| `src/app/core/sidecar.service.ts` | `startTagging`, routage des événements, délégation. |
| `src/app/core/sidecar.service.spec.ts` | Séquence complète d'un run. |
| `.claude/rules/angular/services.md` | Frontière au service, état d'une phase dans son store. |

---

## Task 1: Miroir du contrat

**Files:**
- Modify: `src/app/core/models/protocol.ts`

**Interfaces:**
- Produces : `ThresholdsPayload`, `StartTaggingCommand`, `TrackState`, `TrackResolution`, `TrackFailureReason`, `TrackSource`, `RunPhase`, `TrackEntry`, `RunStartedEvent`, `TrackNames`, `TrackScores`, `TrackResolvedEvent`, `CandidatePayload`, `ArbitrationRequiredEvent`, `RunFinishedEvent`, unions `SidecarCommand` et `SidecarEvent` élargies

- [ ] **Step 1: Ajouter la commande**

Dans `src/app/core/models/protocol.ts`, après `ExtractPlaylistCommand` :

```typescript
export interface ThresholdsPayload {
  readonly floor: number
  readonly ceiling: number
}

export interface StartTaggingCommand {
  readonly command: "start_tagging"
  readonly folder: string
  /** Absents, les seuils du sidecar s'appliquent : une valeur, une source. */
  readonly thresholds?: ThresholdsPayload
}
```

et étendre l'union :

```typescript
export type SidecarCommand =
  | GetVersionCommand
  | ShutdownCommand
  | ListPlaylistsCommand
  | ExtractPlaylistCommand
  | SetApiKeyCommand
  | StartTaggingCommand
```

- [ ] **Step 2: Ajouter les événements du run**

Après `ExtractionFinishedEvent` :

```typescript
/** Etat d'un morceau, en trois champs jamais interchangeables (ARCHITECTURE.md § API). */
export type TrackState = "resolved" | "unresolved"

export type TrackResolution = "auto" | "arbitration" | "url" | "none"

export type TrackFailureReason =
  | "empty_query"
  | "no_result"
  | "below_threshold"
  | "user_refused"
  | "source_unavailable"

export type TrackSource = "beatport" | "bandcamp" | "soundcloud"

/** `run_finished` porte la phase close : la boucle reseau, puis l'ecriture. */
export type RunPhase = "network" | "write"

export interface TrackEntry {
  readonly track_id: string
  readonly file_name: string
  readonly artist: string
  readonly title: string
}

export interface RunStartedEvent {
  readonly event: "run_started"
  readonly run_id: string
  readonly tracks: readonly TrackEntry[]
}

/** Artiste et titre que la source ecrira, calcules par le sidecar (ADR-011). */
export interface TrackNames {
  readonly artist: string
  readonly title: string
}

/** Scores deja arrondis : l'ecran affiche « A 96 · T 92 ». */
export interface TrackScores {
  readonly artist: number | null
  readonly title: number
  readonly average: number
}

export interface TrackResolvedEvent {
  readonly event: "track_resolved"
  readonly track_id: string
  readonly state: TrackState
  readonly resolution: TrackResolution
  readonly failure_reason: TrackFailureReason | null
  readonly source: TrackSource | null
  readonly after: TrackNames | null
  readonly scores: TrackScores | null
  /** Chemin dans le cache, lu par `convertFileSrc` : jamais l'image elle-meme. */
  readonly artwork_path: string | null
}

export interface CandidatePayload {
  readonly artist: string
  readonly title: string
  readonly scores: TrackScores
}

export interface ArbitrationRequiredEvent {
  readonly event: "arbitration_required"
  readonly track_id: string
  readonly source: TrackSource
  /** Beatport n'a pas repondu : aucun candidat ne peut valider seul. */
  readonly beatport_unavailable: boolean
  readonly candidates: readonly CandidatePayload[]
}

export interface RunFinishedEvent {
  readonly event: "run_finished"
  readonly phase: RunPhase
  readonly run_id: string
  readonly resolved: number
  readonly unresolved: number
  readonly awaiting_arbitration: number
}
```

et étendre l'union des événements :

```typescript
export type SidecarEvent =
  | VersionEvent
  | PlaylistsListedEvent
  | ExtractionProgressEvent
  | ExtractionFinishedEvent
  | RunStartedEvent
  | TrackResolvedEvent
  | ArbitrationRequiredEvent
  | RunFinishedEvent
  | SidecarErrorEvent
```

- [ ] **Step 3: Vérifier que la compilation échoue là où il faut**

Run: `just typecheck`
Expected: FAIL sur `src/app/core/sidecar.service.ts`, la table `KNOWN_EVENTS` ne couvrant pas les quatre nouveaux événements. C'est la garde du contrat qui joue : la Task 3 la complète.

- [ ] **Step 4: Commit**

```bash
git add src/app/core/models/protocol.ts
git commit -m "feat(ui): miroir TypeScript des messages du run de re-tagging"
```

---

## Task 2: Store du run

**Files:**
- Create: `src/app/core/tagging-run.store.ts`
- Test: `src/app/core/tagging-run.store.spec.ts`

**Interfaces:**
- Consumes : les types de la Task 1
- Produces :
  - `TaggingTrack` : `trackId`, `fileName`, `artist`, `title`, `state`, `resolution`, `failureReason`, `source`, `after`, `scores`, `artworkPath`, `arbitration`
  - `TaggingRunStore` : signaux `runId`, `tracks`, `progress`, `running`, `finished` ; méthodes `reset()`, `started(event)`, `resolved(event)`, `awaiting(event)`, `advanced(processed, total)`, `completed(event)`, `failed()`

- [ ] **Step 1: Écrire les tests du store**

Créer `src/app/core/tagging-run.store.spec.ts` :

```typescript
import { TestBed } from "@angular/core/testing"

import {
  ArbitrationRequiredEvent,
  RunFinishedEvent,
  RunStartedEvent,
  TrackResolvedEvent,
} from "./models/protocol"
import { TaggingRunStore } from "./tagging-run.store"

const STARTED: RunStartedEvent = {
  event: "run_started",
  run_id: "a3f9c1",
  tracks: [
    { track_id: "a.mp3", file_name: "a.mp3", artist: "Adam Beyer", title: "Your Mind" },
    { track_id: "b.mp3", file_name: "b.mp3", artist: "Amelie Lens", title: "Basiel" },
  ],
}

const RESOLVED: TrackResolvedEvent = {
  event: "track_resolved",
  track_id: "a.mp3",
  state: "resolved",
  resolution: "auto",
  failure_reason: null,
  source: "beatport",
  after: { artist: "Adam Beyer", title: "Your Mind (Original Mix)" },
  scores: { artist: 96, title: 92, average: 94 },
  artwork_path: "C:/AppData/cache/artworks/abc.jpg",
}

const AWAITING: ArbitrationRequiredEvent = {
  event: "arbitration_required",
  track_id: "b.mp3",
  source: "bandcamp",
  beatport_unavailable: true,
  candidates: [
    { artist: "Amelie Lens", title: "Basiel", scores: { artist: 94, title: 95, average: 95 } },
  ],
}

const FINISHED: RunFinishedEvent = {
  event: "run_finished",
  phase: "network",
  run_id: "a3f9c1",
  resolved: 1,
  unresolved: 0,
  awaiting_arbitration: 1,
}

describe("TaggingRunStore", () => {
  let store: TaggingRunStore

  beforeEach(() => {
    store = TestBed.inject(TaggingRunStore)
  })

  it("lists every track of a started run in order", () => {
    store.reset()

    store.started(STARTED)

    expect(store.tracks().map((track) => track.trackId)).toEqual(["a.mp3", "b.mp3"])
    expect(store.tracks()[0]?.state).toBeNull()
    expect(store.runId()).toBe("a3f9c1")
  })

  it("updates a track with its state, source, names, scores and artwork", () => {
    store.reset()
    store.started(STARTED)

    store.resolved(RESOLVED)

    const track = store.tracks()[0]
    expect(track?.state).toBe("resolved")
    expect(track?.source).toBe("beatport")
    expect(track?.after?.title).toBe("Your Mind (Original Mix)")
    expect(track?.scores?.average).toBe(94)
    expect(track?.artworkPath).toBe("C:/AppData/cache/artworks/abc.jpg")
  })

  it("marks a track as awaiting arbitration", () => {
    store.reset()
    store.started(STARTED)

    store.awaiting(AWAITING)

    const track = store.tracks()[1]
    expect(track?.state).toBeNull()
    expect(track?.arbitration?.beatport_unavailable).toBe(true)
  })

  it("exposes the counters of a finished network phase", () => {
    store.reset()
    store.started(STARTED)

    store.completed(FINISHED)

    expect(store.finished()?.awaiting_arbitration).toBe(1)
    expect(store.running()).toBe(false)
  })

  it("clears the previous run when a new one starts", () => {
    store.reset()
    store.started(STARTED)
    store.completed(FINISHED)

    store.reset()

    expect(store.tracks()).toEqual([])
    expect(store.finished()).toBeNull()
    expect(store.running()).toBe(true)
  })

  it("keeps the progress of the run", () => {
    store.reset()
    store.started(STARTED)

    store.advanced(1, 2)

    expect(store.progress()).toEqual({ processed: 1, total: 2 })
  })

  it("stops the run on failure", () => {
    store.reset()
    store.started(STARTED)

    store.failed()

    expect(store.running()).toBe(false)
  })

  it("ignores a track the run does not know", () => {
    store.reset()
    store.started(STARTED)
    vi.spyOn(console, "error").mockImplementation(() => undefined)

    store.resolved({ ...RESOLVED, track_id: "ghost.mp3" })

    expect(store.tracks().every((track) => track.state === null)).toBe(true)
  })
})
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `pnpm test --run src/app/core/tagging-run.store.spec.ts`
Expected: FAIL, `Failed to resolve import "./tagging-run.store"`

- [ ] **Step 3: Implémenter le store**

Créer `src/app/core/tagging-run.store.ts` :

```typescript
import { Injectable, computed, signal } from "@angular/core"

import type {
  ArbitrationRequiredEvent,
  RunFinishedEvent,
  RunStartedEvent,
  TrackEntry,
  TrackFailureReason,
  TrackNames,
  TrackResolution,
  TrackResolvedEvent,
  TrackScores,
  TrackSource,
  TrackState,
} from "./models/protocol"

/**
 * Une ligne de la liste du run. Tout vient du sidecar : la famille visuelle d'un
 * etat se derive a l'affichage, pas ici.
 */
export interface TaggingTrack {
  readonly trackId: string
  readonly fileName: string
  readonly artist: string
  readonly title: string
  /** `null` : le morceau attend son tour, ou attend un arbitrage. */
  readonly state: TrackState | null
  readonly resolution: TrackResolution | null
  readonly failureReason: TrackFailureReason | null
  readonly source: TrackSource | null
  readonly after: TrackNames | null
  readonly scores: TrackScores | null
  readonly artworkPath: string | null
  readonly arbitration: ArbitrationRequiredEvent | null
}

interface RunProgress {
  readonly processed: number
  readonly total: number
}

const pending = (entry: TrackEntry): TaggingTrack => ({
  trackId: entry.track_id,
  fileName: entry.file_name,
  artist: entry.artist,
  title: entry.title,
  state: null,
  resolution: null,
  failureReason: null,
  source: null,
  after: null,
  scores: null,
  artworkPath: null,
  arbitration: null,
})

/**
 * Etat d'un run de re-tagging. `SidecarService` garde la frontiere du transport et
 * lui transmet les evenements : les Features 3 a 6 ajouteront leur propre store.
 */
@Injectable({ providedIn: "root" })
export class TaggingRunStore {
  private readonly _runId = signal<string | null>(null)
  private readonly _order = signal<readonly string[]>([])
  private readonly _rows = signal<ReadonlyMap<string, TaggingTrack>>(new Map())
  private readonly _progress = signal<RunProgress | null>(null)
  private readonly _running = signal(false)
  private readonly _finished = signal<RunFinishedEvent | null>(null)

  readonly runId = this._runId.asReadonly()
  /** Les lignes dans l'ordre du run, prêtes pour la table. */
  readonly tracks = computed<readonly TaggingTrack[]>(() => {
    const rows = this._rows()

    return this._order().flatMap((trackId) => {
      const row = rows.get(trackId)

      return row === undefined ? [] : [row]
    })
  })
  readonly progress = this._progress.asReadonly()
  /** Vrai de l'envoi de `start_tagging` jusqu'a `run_finished` ou une erreur. */
  readonly running = this._running.asReadonly()
  readonly finished = this._finished.asReadonly()

  /** Efface le run precedent des l'envoi de la commande : l'ecran ne melange rien. */
  reset(): void {
    this._runId.set(null)
    this._order.set([])
    this._rows.set(new Map())
    this._progress.set(null)
    this._finished.set(null)
    this._running.set(true)
  }

  started(event: RunStartedEvent): void {
    this._runId.set(event.run_id)
    this._order.set(event.tracks.map((track) => track.track_id))
    this._rows.set(new Map(event.tracks.map((track) => [track.track_id, pending(track)])))
  }

  resolved(event: TrackResolvedEvent): void {
    this.patch(event.track_id, (row) => ({
      ...row,
      state: event.state,
      resolution: event.resolution,
      failureReason: event.failure_reason,
      source: event.source,
      after: event.after,
      scores: event.scores,
      artworkPath: event.artwork_path,
      arbitration: null,
    }))
  }

  awaiting(event: ArbitrationRequiredEvent): void {
    this.patch(event.track_id, (row) => ({ ...row, arbitration: event }))
  }

  advanced(processed: number, total: number): void {
    this._progress.set({ processed, total })
  }

  completed(event: RunFinishedEvent): void {
    this._finished.set(event)
    this._running.set(false)
  }

  /** Erreur du sidecar ou process mort : le run s'arrete, les lignes restent. */
  failed(): void {
    this._running.set(false)
  }

  private patch(trackId: string, update: (row: TaggingTrack) => TaggingTrack): void {
    const rows = this._rows()
    const row = rows.get(trackId)
    if (row === undefined) {
      console.error("[sidecar] morceau inconnu, contrat desynchronise", trackId)

      return
    }
    // Nouvelle Map : muter celle en place ne notifierait aucun consommateur.
    const next = new Map(rows)
    next.set(trackId, update(row))
    this._rows.set(next)
  }
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `pnpm test --run src/app/core/tagging-run.store.spec.ts`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add src/app/core/tagging-run.store.ts src/app/core/tagging-run.store.spec.ts
git commit -m "feat(ui): store de l'etat d'un run de re-tagging"
```

---

## Task 3: Routage et délégation dans le service

**Files:**
- Modify: `src/app/core/sidecar.service.ts`
- Modify: `.claude/rules/angular/services.md`
- Test: `src/app/core/sidecar.service.spec.ts`

**Interfaces:**
- Consumes: `TaggingRunStore` (Task 2), types du contrat (Task 1)
- Produces: `SidecarService.startTagging(folder: string, thresholds?: ThresholdsPayload): Promise<void>`, signaux délégués `taggingTracks`, `taggingProgress`, `tagging`, `taggingFinished`

- [ ] **Step 1: Écrire les tests du service**

Dans `src/app/core/sidecar.service.spec.ts`, ajouter :

```typescript
  it("sends the start tagging command without thresholds", async () => {
    await service.start()

    await service.startTagging("C:/Sets")

    expect(parseLine(transport.sent.at(-1) ?? "")).toEqual({
      command: "start_tagging",
      folder: "C:/Sets",
    })
  })

  it("sends the thresholds when the settings impose them", async () => {
    await service.start()

    await service.startTagging("C:/Sets", { floor: 75, ceiling: 95 })

    expect(parseLine(transport.sent.at(-1) ?? "")).toEqual({
      command: "start_tagging",
      folder: "C:/Sets",
      thresholds: { floor: 75, ceiling: 95 },
    })
  })

  it("replays a whole tagging run and reports every track", async () => {
    await service.start()
    await service.startTagging("C:/Sets")

    transport.emit({
      event: "run_started",
      run_id: "a3f9c1",
      tracks: [{ track_id: "a.mp3", file_name: "a.mp3", artist: "Adam Beyer", title: "Your Mind" }],
    })
    transport.emit({ event: "progress", phase: "tagging", processed: 1, total: 1 })
    transport.emit({
      event: "track_resolved",
      track_id: "a.mp3",
      state: "resolved",
      resolution: "auto",
      failure_reason: null,
      source: "beatport",
      after: { artist: "Adam Beyer", title: "Your Mind (Original Mix)" },
      scores: { artist: 96, title: 92, average: 94 },
      artwork_path: null,
    })
    transport.emit({
      event: "run_finished",
      phase: "network",
      run_id: "a3f9c1",
      resolved: 1,
      unresolved: 0,
      awaiting_arbitration: 0,
    })

    expect(service.taggingTracks()[0]?.state).toBe("resolved")
    expect(service.taggingProgress()).toEqual({ processed: 1, total: 1 })
    expect(service.taggingFinished()?.resolved).toBe(1)
    expect(service.tagging()).toBe(false)
  })

  it("keeps the extraction progress out of the tagging run", async () => {
    await service.start()
    await service.startTagging("C:/Sets")

    transport.emit({ event: "progress", phase: "extraction", processed: 3, total: 10 })

    expect(service.progress()?.processed).toBe(3)
    expect(service.taggingProgress()).toBeNull()
  })

  it("stops the tagging run on an error", async () => {
    await service.start()
    await service.startTagging("C:/Sets")

    transport.emit({ event: "error", code: "api_key_rejected", params: {}, message: "rejected" })

    expect(service.tagging()).toBe(false)
    expect(service.lastError()?.code).toBe("api_key_rejected")
  })
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `pnpm test --run src/app/core/sidecar.service.spec.ts`
Expected: FAIL, `service.startTagging is not a function`

- [ ] **Step 3: Router les événements**

Dans `src/app/core/sidecar.service.ts` :

- compléter les imports : `inject` est déjà importé, ajouter `ThresholdsPayload` aux types du contrat et `TaggingRunStore` depuis `./tagging-run.store` ;
- compléter la table des événements connus :

```typescript
const KNOWN_EVENTS: Record<SidecarEvent["event"], true> = {
  version: true,
  playlists_listed: true,
  progress: true,
  extraction_finished: true,
  run_started: true,
  track_resolved: true,
  arbitration_required: true,
  run_finished: true,
  error: true,
}
```

- injecter le store et déléguer, après les signaux existants :

```typescript
  private readonly taggingRun = inject(TaggingRunStore)

  /** Delegation : les composants n'injectent que ce service, la frontiere du sidecar. */
  readonly taggingTracks = this.taggingRun.tracks
  readonly taggingProgress = this.taggingRun.progress
  readonly tagging = this.taggingRun.running
  readonly taggingFinished = this.taggingRun.finished
```

- ajouter la commande, après `extractPlaylist` :

```typescript
  /** Le run precedent disparait des l'envoi : l'ecran ne melange pas deux runs. */
  async startTagging(folder: string, thresholds?: ThresholdsPayload): Promise<void> {
    this.taggingRun.reset()
    await this.send(
      thresholds === undefined
        ? { command: "start_tagging", folder }
        : { command: "start_tagging", folder, thresholds },
    )
  }
```

- router dans `handleLine`, en remplaçant la branche `progress` et en ajoutant les quatre branches :

```typescript
      case "progress":
        // Une seule forme d'evenement, deux phases : l'extraction et le run.
        if (event.phase === "tagging") {
          this.taggingRun.advanced(event.processed, event.total)
        } else {
          this._progress.set(event)
        }
        break
      case "run_started":
        this.taggingRun.started(event)
        break
      case "track_resolved":
        this.taggingRun.resolved(event)
        break
      case "arbitration_required":
        this.taggingRun.awaiting(event)
        break
      case "run_finished":
        this.taggingRun.completed(event)
        break
```

- arrêter le run dans `endRun()`, appelé par la branche `error` et par la mort du process :

```typescript
  private endRun(): void {
    this._extracting.set(false)
    this._progress.set(null)
    this.taggingRun.failed()
  }
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `pnpm test --run src/app/core/sidecar.service.spec.ts src/app/core/tagging-run.store.spec.ts`
Expected: PASS

- [ ] **Step 5: Préciser la rule**

Dans `.claude/rules/angular/services.md`, remplacer la puce « Un service d'état par feature, alimenté par le flux d'événements du sidecar ; `SidecarService` détient l'état du run et la file d'arbitrage » par :

```markdown
- Un service d'état par phase, alimenté par le flux d'événements du sidecar : `SidecarService` reste la frontière (transport, version, erreurs) et transmet les événements au store concerné, `TaggingRunStore` pour le run de re-tagging. Les composants n'injectent que `SidecarService`, qui délègue en lecture (précisé le 2026-09-20)
```

- [ ] **Step 6: Gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 7: Commit**

```bash
git add src/app/core/sidecar.service.ts src/app/core/sidecar.service.spec.ts .claude/rules/angular/services.md
git commit -m "feat(ui): router les evenements du run vers son store"
```
