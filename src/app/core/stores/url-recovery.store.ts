import { signal, Service } from "@angular/core"

import type { SidecarErrorEvent } from "../sidecar/protocol"
import type { RunProgress } from "./tagging-run.store"

/**
 * Phase de rattrapage par URL. Ouverte par la premiere progression du sidecar, seul juge
 * de son ouverture comme de l'eligibilite d'un morceau : l'interface n'en deduit rien.
 */
@Service()
export class UrlRecoveryStore {
  private readonly _progress = signal<RunProgress | null>(null)
  private readonly _busy = signal<ReadonlySet<string>>(new Set())
  private readonly _errors = signal<ReadonlyMap<string, SidecarErrorEvent>>(new Map())
  private readonly _recovered = signal<{ readonly trackId: string } | null>(null)

  readonly progress = this._progress.asReadonly()
  readonly busy = this._busy.asReadonly()
  /** L'evenement entier : l'ecran traduit son `code` avec ses `params`. */
  readonly errors = this._errors.asReadonly()
  /** Dernier rattrapage abouti, un objet neuf par succes. */
  readonly recovered = this._recovered.asReadonly()

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

  /** Resolu pendant son geste, le morceau vient d'etre rattrape : la recherche reseau refuse le geste. */
  resolved(trackId: string): void {
    if (this._busy().has(trackId)) {
      this._recovered.set({ trackId })
    }
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
    this._recovered.set(null)
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
