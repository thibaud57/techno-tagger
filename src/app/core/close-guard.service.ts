import { Injectable, computed, inject, signal } from "@angular/core"

import { APP_WINDOW } from "./app-window"
import { SidecarService } from "./sidecar.service"

/** Un travail que la fermeture interromprait. */
export type PendingWork =
  | { readonly kind: "extraction" }
  | { readonly kind: "tagging" }
  | { readonly kind: "arbitration"; readonly count: number }

/**
 * Garde unique de la fermeture de la fenetre, pour tous les onglets. Rien n'est persiste
 * avant la Feature 6 (ADR-010) : fermer en plein travail le perd.
 */
@Injectable({ providedIn: "root" })
export class CloseGuard {
  private readonly appWindow = inject(APP_WINDOW)
  private readonly sidecar = inject(SidecarService)

  private readonly _request = signal<readonly PendingWork[] | null>(null)
  private installed = false

  /**
   * Les travaux en cours, dans un ordre fixe. Une Feature qui ajoute un travail
   * interruptible (rattrapage par URL, ecriture) y ajoute sa ligne.
   */
  readonly pendingWork = computed<readonly PendingWork[]>(() => {
    const work: PendingWork[] = []
    if (this.sidecar.extracting()) {
      work.push({ kind: "extraction" })
    }
    if (this.sidecar.tagging()) {
      work.push({ kind: "tagging" })
    }
    const count = this.sidecar.arbitrationCount()
    if (count > 0) {
      work.push({ kind: "arbitration", count })
    }

    return work
  })
  /**
   * Instantane pris a la demande de fermeture, `null` hors confirmation : un travail qui
   * s'acheve pendant la lecture ne fait ni disparaitre une ligne ni fermer a la place de
   * l'utilisateur.
   */
  readonly request = this._request.asReadonly()

  async install(): Promise<void> {
    if (this.installed) {
      return
    }
    this.installed = true
    await this.appWindow.onCloseRequested((close) => {
      const pending = this.pendingWork()
      if (pending.length > 0) {
        close.preventDefault()
        this._request.set(pending)
      }
    })
  }

  stay(): void {
    this._request.set(null)
  }

  /** `destroy` ferme sans repasser par l'ecouteur. Refuse, l'application reste utilisable. */
  async leave(): Promise<void> {
    try {
      await this.appWindow.destroy()
    } catch (error) {
      console.error("[close-guard] fermeture refusee", error)
      this._request.set(null)
    }
  }
}
