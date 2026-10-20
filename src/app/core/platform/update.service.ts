import { Service, computed, inject, linkedSignal, signal } from "@angular/core"
import { CAPTURE_EXCEPTION } from "../observability/capture-exception"
import { SidecarService } from "../sidecar/sidecar.service"

import { APP_UPDATER, type AvailableUpdate, type DownloadProgress } from "./updater"

export type UpdateState =
  | { readonly kind: "none" }
  | { readonly kind: "available"; readonly update: AvailableUpdate }
  | {
      readonly kind: "downloading"
      readonly update: AvailableUpdate
      readonly progress: DownloadProgress
    }
  | { readonly kind: "failed"; readonly update: AvailableUpdate }

const NOTHING_RECEIVED: DownloadProgress = { received: 0, total: null }

/** Verifiee au demarrage seulement : l'installation ferme l'application (ADR-001). */
@Service()
export class UpdateService {
  private readonly updater = inject(APP_UPDATER)
  private readonly sidecar = inject(SidecarService)
  private readonly captureException = inject(CAPTURE_EXCEPTION)

  private readonly _state = signal<UpdateState>({ kind: "none" })
  readonly state = this._state.asReadonly()

  readonly update = computed(() => {
    const state = this._state()

    return state.kind === "none" ? null : state.update
  })

  readonly installable = computed(() => this.sidecar.phase() === "idle")

  /**
   * Verrou : un ecran occupe (invite de reprise, travail) renvoie la mise a jour au badge pour
   * de bon, seul `reopen` la ramene. `previous` ne voit que les etats lus : le shell le lit a
   * chaque detection.
   */
  private readonly dismissed = linkedSignal<boolean, boolean>({
    source: () => this.sidecar.interruptedRun() !== null || !this.installable(),
    computation: (occupied, previous) => occupied || (previous?.value ?? false),
  })

  private readonly downloading = computed(() => this._state().kind === "downloading")

  readonly dialogVisible = computed(
    () => this.update() !== null && (this.downloading() || !this.dismissed()),
  )
  readonly badgeVisible = computed(
    () => this.update() !== null && !this.downloading() && this.dismissed(),
  )

  async check(): Promise<void> {
    try {
      const update = await this.updater.check()
      if (update !== null) {
        this._state.set({ kind: "available", update })
      }
    } catch {
      // Hors ligne, manifeste en 404 ou hors Tauri : frequent, rien a signaler.
    }
  }

  dismiss(): void {
    this.dismissed.set(true)
  }

  reopen(): void {
    this.dismissed.set(false)
  }

  async install(): Promise<void> {
    const state = this._state()
    if (state.kind === "available" && this.installable()) {
      await this.download(state.update)
    }
  }

  /** Repart d'une nouvelle verification : la Release a pu changer depuis l'echec. */
  async retry(): Promise<void> {
    const state = this._state()
    if (state.kind !== "failed" || !this.installable()) {
      return
    }

    // Des le clic, pour qu'un second clic ne relance rien.
    this._state.set({ kind: "downloading", update: state.update, progress: NOTHING_RECEIVED })
    let update: AvailableUpdate | null
    try {
      update = await this.updater.check()
    } catch {
      this._state.set(state)
      return
    }

    state.update.close().catch((error: unknown) => {
      console.error("[update] ressource de la mise a jour non liberee", error)
    })
    if (update === null) {
      this._state.set({ kind: "none" })
      return
    }
    await this.download(update)
  }

  private async download(update: AvailableUpdate): Promise<void> {
    this._state.set({ kind: "downloading", update, progress: NOTHING_RECEIVED })
    try {
      await update.downloadAndInstall((progress) => {
        this._state.set({ kind: "downloading", update, progress })
      })
    } catch (error) {
      // Seul signal d'une signature cassee chez un utilisateur (PRODUCTION.md § Incident
      // Response). Le plugin rejette une chaine sans pile : le tag isole ces issues.
      this.captureException(error, { tags: { area: "updater" } })
      this._state.set({ kind: "failed", update })
    }
  }
}
