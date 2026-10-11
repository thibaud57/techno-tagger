import { signal, Service } from "@angular/core"

import type { RollbackFinishedEvent, RollbackRun, RunFinishedEvent } from "./models/protocol"
import type { RunProgress } from "./tagging-run.store"

/** Restauration en cours : un run entier (`trackId` nul) ou un seul morceau. */
export interface RollbackInFlight {
  readonly runId: string
  readonly trackId: string | null
}

/** Phase d'ecriture et restaurations, alimentee par le seul routage de `SidecarService`. */
@Service()
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
    this.retryFailed()
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
    this.retryFailed()
    this.rollbackFailed()
  }
}
