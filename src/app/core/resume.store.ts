import { signal, Service } from "@angular/core"

import type { InterruptedRun, UnreadablePlan } from "./models/protocol"

export type DetectedRun = InterruptedRun | UnreadablePlan

/** Run interrompu a proposer, annonce au lancement ; nul sans run ou une fois le geste fait. */
@Service()
export class ResumeStore {
  private readonly _prompt = signal<DetectedRun | null>(null)

  readonly prompt = this._prompt.asReadonly()

  announced(run: DetectedRun | null): void {
    this._prompt.set(run)
  }

  /**
   * Geste parti ou remis a plus tard : l'invite se ferme sans attendre, l'annonce suivante la
   * rouvrira s'il le faut.
   */
  cleared(): void {
    this._prompt.set(null)
  }
}
