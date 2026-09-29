import { Injectable, computed, linkedSignal, signal } from "@angular/core"

import type {
  ArbitrationRequiredEvent,
  ArbitrationState,
  ArbitrationUpdatedEvent,
} from "./models/protocol"

/** Seul refus qui retire un arbitrage : le sidecar ne le tient plus, la file etait desynchronisee. */
const NOT_PENDING = "arbitration_not_pending"

/** File des arbitrages dans l'ordre d'arrivee : un nouvel arbitrage n'y decale jamais celui affiche. */
@Injectable({ providedIn: "root" })
export class ArbitrationStore {
  // Map garde l'ordre d'insertion ; `set` sur une cle existante la remplace en place.
  private readonly _entries = signal<ReadonlyMap<string, ArbitrationState>>(new Map())
  private readonly _busy = signal<ReadonlySet<string>>(new Set())
  private readonly _openings = signal(0)
  private readonly trackIds = computed<readonly string[]>(() => [...this._entries().keys()])
  private readonly _currentId = linkedSignal<readonly string[], string | null>({
    source: this.trackIds,
    computation: (ids, previous) => {
      const kept = previous?.value ?? null
      if (kept !== null && ids.includes(kept)) {
        return kept
      }
      if (kept === null || previous === undefined) {
        return ids[0] ?? null
      }
      // Suivant encore present sinon precedent ; recalcul paresseux, l'ancien index peut
      // viser un morceau deja saute ou un nouvel arrive.
      const at = previous.source.indexOf(kept)
      const following = previous.source.slice(at + 1).find((id) => ids.includes(id))
      const preceding = previous.source
        .slice(0, at)
        .reverse()
        .find((id) => ids.includes(id))

      return following ?? preceding ?? ids[0] ?? null
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
  /** Un compteur : rouvrir deux fois le meme morceau doit se voir. */
  readonly openings = this._openings.asReadonly()
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

  /** Un morceau hors de la file ne deplace rien : sa ligne a pu etre resolue entre-temps. */
  open(trackId: string): void {
    if (this._entries().has(trackId)) {
      this._currentId.set(trackId)
      this._openings.update((count) => count + 1)
    }
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
    if (this._busy().has(trackId)) {
      this._busy.update((busy) => new Set([...busy].filter((id) => id !== trackId)))
    }
  }

  private remove(trackId: string): void {
    if (this._entries().has(trackId)) {
      this._entries.update((entries) => new Map([...entries].filter(([id]) => id !== trackId)))
    }
  }
}
