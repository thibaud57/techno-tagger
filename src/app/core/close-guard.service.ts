import { computed, inject, signal, Service } from "@angular/core"

import { APP_WINDOW } from "./app-window"
import { SidecarService } from "./sidecar.service"

export type PendingWork =
  | { readonly kind: "extraction" }
  | { readonly kind: "tagging" }
  | { readonly kind: "arbitration"; readonly count: number }
  | { readonly kind: "write" }
  | { readonly kind: "rollback" }
  | { readonly kind: "unwritten" }

/** Quitter couperait un fichier en plein travail : Tauri arrete le sidecar a la sortie. */
const BLOCKING: ReadonlySet<PendingWork["kind"]> = new Set(["write", "rollback"])

@Service()
export class CloseGuard {
  private readonly appWindow = inject(APP_WINDOW)
  private readonly sidecar = inject(SidecarService)

  private readonly _request = signal<readonly PendingWork[] | null>(null)
  private installed = false

  readonly pendingWork = computed<readonly PendingWork[]>(() => {
    const work: PendingWork[] = []
    if (this.sidecar.extracting()) {
      work.push({ kind: "extraction" })
    }
    if (this.sidecar.tagging()) {
      work.push({ kind: "tagging" })
    }
    // Un run confirme n'arbitrera plus : ses attentes ne sont pas un travail perdu.
    const count = this.sidecar.committed() ? 0 : this.sidecar.arbitrationCount()
    if (count > 0) {
      work.push({ kind: "arbitration", count })
    }
    if (this.sidecar.writing()) {
      work.push({ kind: "write" })
    }
    if (this.sidecar.rollingBack() !== null) {
      work.push({ kind: "rollback" })
    }
    // Un run cherche mais jamais confirme : rien n'est ecrit, ses resultats seraient perdus.
    if (
      this.sidecar.taggingRunId() !== null &&
      !this.sidecar.committed() &&
      !this.sidecar.tagging()
    ) {
      work.push({ kind: "unwritten" })
    }

    return work
  })
  /** Instantane : un travail qui s'acheve pendant la lecture ne change pas la confirmation. */
  readonly request = this._request.asReadonly()
  /** Lu en direct : l'ecriture peut finir modale ouverte, elle redevient alors quittable. */
  readonly blocked = computed(() => this.pendingWork().some((work) => BLOCKING.has(work.kind)))

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
    if (this.blocked()) {
      return
    }
    try {
      await this.appWindow.destroy()
    } catch (error) {
      console.error("[close-guard] fermeture refusee", error)
      this._request.set(null)
    }
  }
}
