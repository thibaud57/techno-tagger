# File d'arbitrage côté webview : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Porter côté webview la file des arbitrages en attente, alimentée par les événements du sidecar, et émettre les décisions de l'utilisateur.

**Architecture:** Le miroir `core/models/protocol.ts` gagne l'état complet d'un arbitrage, ses deux événements et ses deux commandes. Un `ArbitrationStore` tient la file en ordre d'arrivée, l'arbitrage courant par un `linkedSignal` qui survit à la réduction de la file, la navigation et l'attente d'une réponse par morceau. `SidecarService` route les événements vers lui, envoie les trois gestes sans jamais doubler un geste en attente, en délègue la lecture et vide la file au run suivant comme à la mort du process.

**Tech Stack:** Angular 22 (signals, `linkedSignal`, `computed`), TypeScript 6 strict (`noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`), Vitest par `@angular/build:unit-test`. Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/arbitrage-utilisateur/03-service-arbitrage-ui-design.md`

## Global Constraints

- **Contrat du sub-project 02** : `resolve_arbitration` = `track_id`, `source` (`"beatport"` ou `"bandcamp"`), `candidate` (`number` ou `null`) ; `switch_arbitration_source` = `track_id`, `source` ; `arbitration_required` et `arbitration_updated` = `track_id`, `source`, `beatport_unavailable`, `candidates`, `empty_reason`, `other_source` ; `CandidatePayload` = `artist`, `title`, `label`, `year`, `scores`.
- **Code d'erreur qui retire un arbitrage** : `arbitration_not_pending`, et lui seul.
- **Aucun composant n'injecte `ArbitrationStore`** : tout passe par `SidecarService` (`.claude/rules/angular/services.md`).
- **Aucune logique métier** : ordre des candidats, scores et source affichée viennent du sidecar.
- **Style** : fonctions en `const nom = (...) =>` (`func-style`), pas de point-virgule, guillemets doubles (Prettier du projet), accès aux `params` d'une erreur par crochets (`noPropertyAccessFromIndexSignature`).
- **Tests** : noms en anglais, AAA séparé par des lignes vides, `TestBed.inject` comme `tagging-run.store.spec.ts`, transport simulé `FakeTransport` de `sidecar.service.spec.ts`.
- **Gate vert à chaque commit** : `just lint-ui`, `just typecheck-ui` (qui type aussi les specs), `just test-ui`. Commits `type(scope): description`, scope `ui`.

## Review Focus

- **File vidée par les résolutions** : plus d'arbitrage courant, position 0 (Task 1, `leaves no current arbitration once the queue is empty`).
- **`arbitration_updated` pour un morceau hors de la file** (retiré sur `arbitration_not_pending`) : jamais rajouté (Task 1, `ignores an update for a track outside the queue`).
- **Refus pour une autre raison** (`arbitration_busy`, `arbitration_candidate_unknown`) : l'arbitrage reste en file (Task 1, `keeps an arbitration rejected for another reason`).
- **Erreur d'arbitrage sans `track_id` exploitable** : aucune attente levée, aucune exception (Task 2, `keeps a gesture waiting when the error names no track`).
- **Erreur d'une autre commande portant un `track_id`** : la file n'est pas touchée (Task 2, `leaves the queue alone on the error of another command`).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `src/app/core/models/protocol.ts` | `ArbitrationSource`, `CandidatePayload` étendu, `ArbitrationState`, les deux événements, les deux commandes, unions. |
| `src/app/core/arbitration.store.ts` | File en ordre d'arrivée, arbitrage courant, navigation, attente par morceau. |
| `src/app/core/arbitration.store.spec.ts` | Règles de la file. |
| `src/app/core/sidecar.service.ts` | Routage, gestes, navigation, lecture déléguée, vidage de la file. |
| `src/app/core/sidecar.service.spec.ts` | Gestes et routage sur le transport simulé. |
| `src/app/core/tagging-run.store.spec.ts` | Fixture `AWAITING` aux nouveaux champs. |

---

## Task 1: Miroir de l'état d'arbitrage et `ArbitrationStore`

**Files:**
- Modify: `src/app/core/models/protocol.ts`
- Create: `src/app/core/arbitration.store.ts`
- Test: `src/app/core/arbitration.store.spec.ts`
- Modify: `src/app/core/tagging-run.store.spec.ts`

**Interfaces:**
- Produces:
  - `type ArbitrationSource = "beatport" | "bandcamp"`
  - `interface ArbitrationState` : `track_id: string`, `source: ArbitrationSource`, `beatport_unavailable: boolean`, `candidates: readonly CandidatePayload[]`, `empty_reason: TrackFailureReason | null`, `other_source: ArbitrationSource | null`
  - `ArbitrationRequiredEvent extends ArbitrationState` (`event: "arbitration_required"`), `ArbitrationUpdatedEvent extends ArbitrationState` (`event: "arbitration_updated"`, pas encore dans `SidecarEvent`)
  - `ArbitrationStore` : lecture `entries: Signal<readonly ArbitrationState[]>`, `current: Signal<ArbitrationState | null>`, `position: Signal<number>` (1-based, 0 sur une file vide), `count: Signal<number>`, `hasPrevious`, `hasNext`, `currentBusy: Signal<boolean>` ; `isBusy(trackId: string): boolean` ; mutations `required(event)`, `updated(event)`, `resolved(trackId)`, `rejected(trackId, code)`, `sent(trackId)`, `previous()`, `next()`, `clear()`

- [ ] **Step 1: Écrire les tests du store**

Créer `src/app/core/arbitration.store.spec.ts` :

```typescript
import { TestBed } from "@angular/core/testing"

import { ArbitrationStore } from "./arbitration.store"
import type { ArbitrationRequiredEvent, ArbitrationUpdatedEvent } from "./models/protocol"

const required = (trackId: string): ArbitrationRequiredEvent => ({
  event: "arbitration_required",
  track_id: trackId,
  source: "beatport",
  beatport_unavailable: false,
  candidates: [
    {
      artist: "Adam Beyer",
      title: "Your Mind (Radio Edit)",
      label: "Drumcode",
      year: 2023,
      scores: { artist: 96, title: 84, average: 90 },
    },
  ],
  empty_reason: null,
  other_source: null,
})

const onBandcamp = (trackId: string): ArbitrationUpdatedEvent => ({
  ...required(trackId),
  event: "arbitration_updated",
  source: "bandcamp",
  candidates: [],
  empty_reason: "no_result",
  other_source: "beatport",
})

describe("ArbitrationStore", () => {
  let store: ArbitrationStore

  const queue = (...trackIds: string[]): void => {
    for (const trackId of trackIds) {
      store.required(required(trackId))
    }
  }

  const queued = (): string[] => store.entries().map((entry) => entry.track_id)

  beforeEach(() => {
    store = TestBed.inject(ArbitrationStore)
  })

  it("queues arbitrations in arrival order and counts them", () => {
    queue("c.mp3", "a.mp3", "b.mp3")

    expect(queued()).toEqual(["c.mp3", "a.mp3", "b.mp3"])
    expect(store.current()?.track_id).toBe("c.mp3")
    expect([store.position(), store.count()]).toEqual([1, 3])
  })

  it("keeps the current arbitration when a new one arrives", () => {
    queue("a.mp3", "b.mp3", "c.mp3")
    store.next()

    store.required(required("d.mp3"))

    expect(store.current()?.track_id).toBe("b.mp3")
    expect([store.position(), store.count()]).toEqual([2, 4])
  })

  it("replaces an arbitration in place when it is updated", () => {
    queue("a.mp3", "b.mp3")
    store.next()

    store.updated(onBandcamp("b.mp3"))

    expect(queued()).toEqual(["a.mp3", "b.mp3"])
    expect(store.current()?.source).toBe("bandcamp")
    expect(store.position()).toBe(2)
  })

  it("moves to the next arbitration when the current one is resolved", () => {
    queue("a.mp3", "b.mp3", "c.mp3")
    store.next()

    store.resolved("b.mp3")

    expect(store.current()?.track_id).toBe("c.mp3")
    expect([store.position(), store.count()]).toEqual([2, 2])
  })

  it("moves to the previous one when the last one is resolved", () => {
    queue("a.mp3", "b.mp3")
    store.next()

    store.resolved("b.mp3")

    expect(store.current()?.track_id).toBe("a.mp3")
  })

  it("leaves no current arbitration once the queue is empty", () => {
    queue("a.mp3")

    store.resolved("a.mp3")

    expect(store.current()).toBeNull()
    expect([store.position(), store.count()]).toEqual([0, 0])
  })

  it("navigates between arbitrations within bounds", () => {
    queue("a.mp3", "b.mp3")

    store.previous()
    const first = store.current()?.track_id
    store.next()
    store.next()

    expect(first).toBe("a.mp3")
    expect(store.current()?.track_id).toBe("b.mp3")
    expect([store.hasPrevious(), store.hasNext()]).toEqual([true, false])
  })

  it.each<[string, (store: ArbitrationStore) => void]>([
    [
      "update",
      (target) => {
        target.updated(onBandcamp("a.mp3"))
      },
    ],
    [
      "resolution",
      (target) => {
        target.resolved("a.mp3")
      },
    ],
    [
      "error",
      (target) => {
        target.rejected("a.mp3", "arbitration_busy")
      },
    ],
  ])("marks a track busy until its %s", (_answer, answer) => {
    queue("a.mp3")
    store.sent("a.mp3")
    const waiting = store.currentBusy()

    answer(store)

    expect(waiting).toBe(true)
    expect(store.isBusy("a.mp3")).toBe(false)
  })

  it("drops an arbitration the sidecar no longer holds", () => {
    queue("a.mp3", "b.mp3")

    store.rejected("a.mp3", "arbitration_not_pending")

    expect(queued()).toEqual(["b.mp3"])
  })

  it("keeps an arbitration rejected for another reason", () => {
    queue("a.mp3")

    store.rejected("a.mp3", "arbitration_candidate_unknown")

    expect(queued()).toEqual(["a.mp3"])
  })

  it("ignores an update for a track outside the queue", () => {
    queue("a.mp3")

    store.updated(onBandcamp("ghost.mp3"))

    expect(queued()).toEqual(["a.mp3"])
  })
})
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `pnpm exec ng test --watch=false --include=src/app/core/arbitration.store.spec.ts`
Expected: FAIL, le module `./arbitration.store` est introuvable

- [ ] **Step 3: Étendre le miroir du contrat**

Dans `src/app/core/models/protocol.ts`, remplacer `CandidatePayload` et `ArbitrationRequiredEvent` par :

```typescript
/** Les deux seules sources qu'un arbitrage met en jeu : celles que le pipeline interroge. */
export type ArbitrationSource = "beatport" | "bandcamp"

/** Un candidat en zone grise. Son index dans un geste est sa position dans la liste. */
export interface CandidatePayload {
  readonly artist: string
  readonly title: string
  /** Nuls sur Bandcamp, dont la recherche ne rend ni l'un ni l'autre. */
  readonly label: string | null
  readonly year: number | null
  readonly scores: TrackScores
}

/** Etat complet d'un arbitrage, commun aux deux evenements : l'entree se remplace en bloc. */
export interface ArbitrationState {
  readonly track_id: string
  readonly source: ArbitrationSource
  /** Beatport n'a pas repondu : aucun candidat ne peut valider seul. */
  readonly beatport_unavailable: boolean
  readonly candidates: readonly CandidatePayload[]
  /** Pourquoi la liste Bandcamp affichee est vide, `null` sinon. */
  readonly empty_reason: TrackFailureReason | null
  /** La liste que `switch_arbitration_source` peut reafficher, `null` sinon. */
  readonly other_source: ArbitrationSource | null
}

export interface ArbitrationRequiredEvent extends ArbitrationState {
  readonly event: "arbitration_required"
}

export interface ArbitrationUpdatedEvent extends ArbitrationState {
  readonly event: "arbitration_updated"
}
```

`ArbitrationUpdatedEvent` n'entre dans `SidecarEvent` qu'à la Task 2, avec son routage : l'y ajouter ici casserait l'exhaustivité du `switch` de `SidecarService`.

- [ ] **Step 4: Créer `src/app/core/arbitration.store.ts`**

```typescript
import { Injectable, computed, linkedSignal, signal } from "@angular/core"

import type {
  ArbitrationRequiredEvent,
  ArbitrationState,
  ArbitrationUpdatedEvent,
} from "./models/protocol"

/** Seul refus qui retire un arbitrage : le sidecar ne le tient plus, la file etait desynchronisee. */
const NOT_PENDING = "arbitration_not_pending"

/**
 * File des arbitrages en attente, dans l'ordre d'arrivee : un nouvel arbitrage
 * s'ajoute en fin et ne decale jamais celui que l'utilisateur regarde.
 * `SidecarService` l'alimente et en delegue la lecture.
 */
@Injectable({ providedIn: "root" })
export class ArbitrationStore {
  // L'ordre d'insertion de la Map est l'ordre d'arrivee, et `set` sur une cle
  // existante la remplace en place : c'est ce qui garde la position a la bascule.
  private readonly _entries = signal<ReadonlyMap<string, ArbitrationState>>(new Map())
  private readonly _busy = signal<ReadonlySet<string>>(new Set())
  private readonly trackIds = computed<readonly string[]>(() => [...this._entries().keys()])
  private readonly _currentId = linkedSignal<readonly string[], string | null>({
    source: this.trackIds,
    computation: (ids, previous) => {
      const kept = previous?.value ?? null
      if (kept !== null && ids.includes(kept)) {
        return kept
      }
      // Le courant a quitte la file : celui qui prend sa place, ou le precedent s'il
      // etait le dernier. Sans courant, le premier arrive.
      const former = kept === null || previous === undefined ? 0 : previous.source.indexOf(kept)

      return ids[Math.min(former, ids.length - 1)] ?? null
    },
  })

  readonly entries = computed<readonly ArbitrationState[]>(() => [...this._entries().values()])
  readonly count = computed(() => this._entries().size)
  readonly current = computed<ArbitrationState | null>(() => {
    const trackId = this._currentId()

    return trackId === null ? null : (this._entries().get(trackId) ?? null)
  })
  /** Rang du courant, 1-based : le « 1 » de « 1/3 ». 0 sur une file vide. */
  readonly position = computed(() => {
    const trackId = this._currentId()

    return trackId === null ? 0 : this.trackIds().indexOf(trackId) + 1
  })
  readonly hasPrevious = computed(() => this.position() > 1)
  readonly hasNext = computed(() => this.position() < this.count())
  /** Vrai de l'envoi d'un geste sur l'arbitrage affiche jusqu'a sa reponse. */
  readonly currentBusy = computed(() => {
    const trackId = this._currentId()

    return trackId !== null && this._busy().has(trackId)
  })

  isBusy(trackId: string): boolean {
    return this._busy().has(trackId)
  }

  required(event: ArbitrationRequiredEvent): void {
    this._entries.update((entries) => new Map(entries).set(event.track_id, event))
  }

  /** Un morceau hors de la file n'y revient pas : le sidecar a pu le retirer entre-temps. */
  updated(event: ArbitrationUpdatedEvent): void {
    this.release(event.track_id)
    if (this._entries().has(event.track_id)) {
      this._entries.update((entries) => new Map(entries).set(event.track_id, event))
    }
  }

  resolved(trackId: string): void {
    this.release(trackId)
    this.remove(trackId)
  }

  rejected(trackId: string, code: string): void {
    this.release(trackId)
    if (code === NOT_PENDING) {
      this.remove(trackId)
    }
  }

  sent(trackId: string): void {
    this._busy.update((busy) => new Set(busy).add(trackId))
  }

  previous(): void {
    this.step(-1)
  }

  next(): void {
    this.step(1)
  }

  clear(): void {
    this._entries.set(new Map())
    this._busy.set(new Set())
  }

  private step(offset: number): void {
    const target = this.trackIds()[this.position() - 1 + offset]
    if (target !== undefined) {
      this._currentId.set(target)
    }
  }

  private release(trackId: string): void {
    if (!this._busy().has(trackId)) {
      return
    }
    this._busy.update((busy) => {
      const rest = new Set(busy)
      rest.delete(trackId)

      return rest
    })
  }

  private remove(trackId: string): void {
    if (!this._entries().has(trackId)) {
      return
    }
    this._entries.update((entries) => {
      const rest = new Map(entries)
      rest.delete(trackId)

      return rest
    })
  }
}
```

- [ ] **Step 5: Mettre la fixture du run au nouveau contrat**

Dans `src/app/core/tagging-run.store.spec.ts`, remplacer la constante `AWAITING` par :

```typescript
const AWAITING: ArbitrationRequiredEvent = {
  event: "arbitration_required",
  track_id: "b.mp3",
  source: "bandcamp",
  beatport_unavailable: true,
  candidates: [
    {
      artist: "Amelie Lens",
      title: "Basiel",
      label: null,
      year: null,
      scores: { artist: 94, title: 95, average: 95 },
    },
  ],
  empty_reason: null,
  other_source: null,
}
```

- [ ] **Step 6: Vérifier que les tests passent**

Run: `pnpm exec ng test --watch=false --include=src/app/core/arbitration.store.spec.ts --include=src/app/core/tagging-run.store.spec.ts`
Expected: PASS

- [ ] **Step 7: Gate**

Run: `just lint-ui && just typecheck-ui && just test-ui`
Expected: tout vert

- [ ] **Step 8: Commit**

```bash
git add src/app/core/models/protocol.ts src/app/core/arbitration.store.ts src/app/core/arbitration.store.spec.ts src/app/core/tagging-run.store.spec.ts
git commit -m "feat(ui): file des arbitrages en ordre d'arrivee"
```

---

## Task 2: Routage et gestes dans `SidecarService`

**Files:**
- Modify: `src/app/core/models/protocol.ts`
- Modify: `src/app/core/sidecar.service.ts`
- Test: `src/app/core/sidecar.service.spec.ts`

**Interfaces:**
- Consumes: `ArbitrationStore`, `ArbitrationSource`, `ArbitrationRequiredEvent`, `ArbitrationUpdatedEvent` (Task 1).
- Produces (lus par les sub-projects 04 et 05) :
  - `ResolveArbitrationCommand`, `SwitchArbitrationSourceCommand` dans `SidecarCommand` ; `ArbitrationUpdatedEvent` dans `SidecarEvent`
  - `SidecarService.arbitrations`, `currentArbitration`, `arbitrationPosition`, `arbitrationCount`, `arbitrationBusy`, `hasPreviousArbitration`, `hasNextArbitration` (signals en lecture)
  - `async chooseCandidate(trackId: string, source: ArbitrationSource, index: number): Promise<void>`, `async refuseCandidates(trackId: string, source: ArbitrationSource): Promise<void>`, `async showArbitrationSource(trackId: string, source: ArbitrationSource): Promise<void>`, `previousArbitration(): void`, `nextArbitration(): void`

- [ ] **Step 1: Écrire les tests du service**

Dans `src/app/core/sidecar.service.spec.ts`, remplacer l'import du protocole par :

```typescript
import {
  ArbitrationRequiredEvent,
  RunStartedEvent,
  SidecarEvent,
  TrackResolvedEvent,
} from "./models/protocol"
```

ajouter après `TRACK_RESOLVED` :

```typescript
const RUN_OF_TWO: RunStartedEvent = {
  event: "run_started",
  run_id: "a3f9c1",
  tracks: [
    { track_id: "a.mp3", file_name: "a.mp3", artist: "Adam Beyer", title: "Your Mind" },
    { track_id: "b.mp3", file_name: "b.mp3", artist: "Amelie Lens", title: "Basiel" },
  ],
}

const awaiting = (trackId: string): ArbitrationRequiredEvent => ({
  event: "arbitration_required",
  track_id: trackId,
  source: "beatport",
  beatport_unavailable: false,
  candidates: [
    {
      artist: "Adam Beyer",
      title: "Your Mind (Radio Edit)",
      label: "Drumcode",
      year: 2023,
      scores: { artist: 96, title: 84, average: 90 },
    },
  ],
  empty_reason: null,
  other_source: null,
})
```

et à la fin du `describe("SidecarService")` :

```typescript
  it.each<[string, (target: SidecarService) => Promise<void>, unknown]>([
    [
      "choice",
      (target) => target.chooseCandidate("a.mp3", "bandcamp", 1),
      { command: "resolve_arbitration", track_id: "a.mp3", source: "bandcamp", candidate: 1 },
    ],
    [
      "refusal",
      (target) => target.refuseCandidates("a.mp3", "beatport"),
      { command: "resolve_arbitration", track_id: "a.mp3", source: "beatport", candidate: null },
    ],
    [
      "switch",
      (target) => target.showArbitrationSource("a.mp3", "beatport"),
      { command: "switch_arbitration_source", track_id: "a.mp3", source: "beatport" },
    ],
  ])("sends a %s with its command", async (_gesture, gesture, expected) => {
    await service.start()
    transport.emit(RUN_OF_TWO)
    transport.emit(awaiting("a.mp3"))

    await gesture(service)

    expect(parseLine(transport.sent.at(-1) ?? "")).toEqual(expected)
  })

  it("ignores a second gesture on a track awaiting an answer", async () => {
    await service.start()
    transport.emit(RUN_OF_TWO)
    transport.emit(awaiting("a.mp3"))
    await service.refuseCandidates("a.mp3", "beatport")
    const before = transport.sent.length

    await service.refuseCandidates("a.mp3", "beatport")

    expect(transport.sent.length).toBe(before)
    expect(service.arbitrationBusy()).toBe(true)
  })

  it("routes the arbitration events to the queue", async () => {
    await service.start()
    transport.emit(RUN_OF_TWO)
    transport.emit(awaiting("a.mp3"))
    transport.emit(awaiting("b.mp3"))

    transport.emit({
      ...awaiting("b.mp3"),
      event: "arbitration_updated",
      source: "bandcamp",
      other_source: "beatport",
    })
    transport.emit(TRACK_RESOLVED)

    expect(service.arbitrations().map((entry) => entry.track_id)).toEqual(["b.mp3"])
    expect(service.currentArbitration()?.source).toBe("bandcamp")
    expect(service.taggingTracks()[0]?.state).toBe("resolved")
  })

  it("releases a gesture the sidecar refuses", async () => {
    await service.start()
    transport.emit(RUN_OF_TWO)
    transport.emit(awaiting("a.mp3"))
    await service.chooseCandidate("a.mp3", "beatport", 0)
    const refusal = {
      event: "error",
      code: "arbitration_busy",
      params: { track_id: "a.mp3" },
      message: "a gesture is already in flight for this track",
      command: "resolve_arbitration",
    } as const

    transport.emit(refusal)

    expect(service.arbitrationBusy()).toBe(false)
    expect(service.errorFor("resolve_arbitration")()).toEqual(refusal)
  })

  it("keeps a gesture waiting when the error names no track", async () => {
    await service.start()
    transport.emit(RUN_OF_TWO)
    transport.emit(awaiting("a.mp3"))
    await service.chooseCandidate("a.mp3", "beatport", 0)

    transport.emit({
      event: "error",
      code: "arbitration_busy",
      params: {},
      message: "a gesture is already in flight for this track",
      command: "resolve_arbitration",
    })

    expect(service.arbitrationBusy()).toBe(true)
  })

  it("leaves the queue alone on the error of another command", async () => {
    await service.start()
    transport.emit(RUN_OF_TWO)
    transport.emit(awaiting("a.mp3"))

    transport.emit({
      event: "error",
      code: "arbitration_not_pending",
      params: { track_id: "a.mp3" },
      message: "track not awaiting arbitration",
      command: "start_tagging",
    })

    expect(service.arbitrationCount()).toBe(1)
  })

  it.each<[string, (target: SidecarService, fake: FakeTransport) => Promise<void>]>([
    ["a new run starts", (target) => target.startTagging("C:/Sets")],
    [
      "the process dies",
      (_target, fake) => {
        fake.handlers?.onTerminated()

        return Promise.resolve()
      },
    ],
  ])("clears the queue when %s", async (_when, end) => {
    await service.start()
    transport.emit(RUN_OF_TWO)
    transport.emit(awaiting("a.mp3"))

    await end(service, transport)

    expect(service.arbitrationCount()).toBe(0)
  })

  it("keeps the queue after a cancellation", async () => {
    await service.start()
    await service.startTagging("C:/Sets")
    transport.emit(RUN_OF_TWO)
    transport.emit(awaiting("a.mp3"))

    await service.cancelTagging()

    expect(service.arbitrationCount()).toBe(1)
  })
```

Le dernier cas de `clears the queue when %s` relit un signal après `onTerminated`, qui vide la file par `endRun` sans aucun envoi.

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `pnpm exec ng test --watch=false --include=src/app/core/sidecar.service.spec.ts`
Expected: FAIL, `service.chooseCandidate is not a function` et `service.arbitrations is not a function`

- [ ] **Step 3: Déclarer les commandes et l'événement dans les unions**

Dans `src/app/core/models/protocol.ts`, avant `SidecarCommand` :

```typescript
export interface ResolveArbitrationCommand {
  readonly command: "resolve_arbitration"
  readonly track_id: string
  /** La liste visee : un geste sur une liste qui n'est plus affichee est refuse. */
  readonly source: ArbitrationSource
  /** Index dans cette liste, `null` pour un refus explicite. */
  readonly candidate: number | null
}

export interface SwitchArbitrationSourceCommand {
  readonly command: "switch_arbitration_source"
  readonly track_id: string
  readonly source: ArbitrationSource
}
```

puis ajouter `| ResolveArbitrationCommand | SwitchArbitrationSourceCommand` à `SidecarCommand` et `| ArbitrationUpdatedEvent` à `SidecarEvent`, juste après `ArbitrationRequiredEvent`.

`ArbitrationSource` est déclaré plus bas dans le fichier : une interface le référence sans contrainte d'ordre.

- [ ] **Step 4: Router et envoyer**

Dans `src/app/core/sidecar.service.ts` :

1. Importer `ArbitrationStore` (`import { ArbitrationStore } from "./arbitration.store"`) et ajouter `ArbitrationSource`, `ResolveArbitrationCommand` et `SwitchArbitrationSourceCommand` à l'import de `./models/protocol`.

2. Dans `KNOWN_EVENTS`, ajouter `arbitration_updated: true,` après `arbitration_required: true,`.

3. Sous les constantes `TAGGING_IN_PROGRESS` et `EXTRACTION_IN_PROGRESS`, ajouter :

```typescript
/** Les deux commandes dont l'echec leve l'attente du morceau que `params.track_id` designe. */
const ARBITRATION_COMMANDS: readonly SidecarCommand["command"][] = [
  "resolve_arbitration",
  "switch_arbitration_source",
]
```

4. Sous `private readonly taggingRun = inject(TaggingRunStore)`, ajouter `private readonly arbitration = inject(ArbitrationStore)`, et après la délégation `taggingInterrupted` :

```typescript
  /** File des arbitrages, en ordre d'arrivee : les composants ne lisent jamais le store. */
  readonly arbitrations = this.arbitration.entries
  readonly currentArbitration = this.arbitration.current
  readonly arbitrationPosition = this.arbitration.position
  readonly arbitrationCount = this.arbitration.count
  /** Vrai de l'envoi d'un geste sur l'arbitrage affiche jusqu'a sa reponse. */
  readonly arbitrationBusy = this.arbitration.currentBusy
  readonly hasPreviousArbitration = this.arbitration.hasPrevious
  readonly hasNextArbitration = this.arbitration.hasNext
```

5. Dans `startTagging`, après `this.taggingRun.reset()`, ajouter `this.arbitration.clear()` avec ce commentaire : `// Le sidecar jette les arbitrages de l'ancien run a la reception de la commande.`

6. Après `cancelTagging`, ajouter :

```typescript
  async chooseCandidate(trackId: string, source: ArbitrationSource, index: number): Promise<void> {
    await this.gesture(trackId, {
      command: "resolve_arbitration",
      track_id: trackId,
      source,
      candidate: index,
    })
  }

  async refuseCandidates(trackId: string, source: ArbitrationSource): Promise<void> {
    await this.gesture(trackId, {
      command: "resolve_arbitration",
      track_id: trackId,
      source,
      candidate: null,
    })
  }

  async showArbitrationSource(trackId: string, source: ArbitrationSource): Promise<void> {
    await this.gesture(trackId, { command: "switch_arbitration_source", track_id: trackId, source })
  }

  previousArbitration(): void {
    this.arbitration.previous()
  }

  nextArbitration(): void {
    this.arbitration.next()
  }
```

7. Après `send`, ajouter :

```typescript
  /** Un geste par morceau a la fois : un double clic ne repart pas avant la reponse. */
  private async gesture(
    trackId: string,
    command: ResolveArbitrationCommand | SwitchArbitrationSourceCommand,
  ): Promise<void> {
    if (this.arbitration.isBusy(trackId)) {
      return
    }
    this.arbitration.sent(trackId)
    await this.send(command)
  }

  /** Un geste refuse leve l'attente de son morceau, et le retire sur `arbitration_not_pending`. */
  private routeArbitrationError(event: SidecarErrorEvent): void {
    const trackId = event.params["track_id"]
    if (
      event.command !== null &&
      ARBITRATION_COMMANDS.includes(event.command) &&
      typeof trackId === "string"
    ) {
      this.arbitration.rejected(trackId, event.code)
    }
  }
```

8. Dans `endRun`, ajouter `this.arbitration.clear()` après `this.taggingRun.failed()` : plus aucun sidecar ne peut répondre.

9. Dans `handleLine`, remplacer les cas `track_resolved` et `arbitration_required` et ajouter `arbitration_updated` :

```typescript
      case "track_resolved":
        this.taggingRun.resolved(event)
        this.arbitration.resolved(event.track_id)
        break
      case "arbitration_required":
        this.taggingRun.awaiting(event)
        this.arbitration.required(event)
        break
      case "arbitration_updated":
        this.arbitration.updated(event)
        break
```

puis, dans le cas `error`, ajouter `this.routeArbitrationError(event)` avant le `break`.

`cancelTagging` ne touche pas la file : les arbitrages restent tranchables après une interruption (décision du 2026-09-26, sub-project 01).

- [ ] **Step 5: Vérifier que les tests passent**

Run: `pnpm exec ng test --watch=false --include=src/app/core/sidecar.service.spec.ts --include=src/app/core/arbitration.store.spec.ts`
Expected: PASS

- [ ] **Step 6: Gate**

Run: `just lint-ui && just typecheck-ui && just test-ui`
Expected: tout vert

- [ ] **Step 7: Commit**

```bash
git add src/app/core/models/protocol.ts src/app/core/sidecar.service.ts src/app/core/sidecar.service.spec.ts
git commit -m "feat(ui): envoyer les decisions d'arbitrage et router leurs evenements"
```
