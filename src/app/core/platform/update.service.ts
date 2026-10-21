import { Service, computed, inject, linkedSignal, signal } from "@angular/core"
import { CAPTURE_EXCEPTION } from "../observability/capture-exception"
import { SidecarService } from "../sidecar/sidecar.service"

import { PreferencesService } from "./preferences.service"
import {
  APP_UPDATER,
  type AvailableUpdate,
  type DownloadProgress,
  NOTHING_RECEIVED,
} from "./updater"

export type UpdateState =
  | { readonly kind: "none" }
  | { readonly kind: "available"; readonly update: AvailableUpdate }
  | {
      readonly kind: "downloading"
      readonly update: AvailableUpdate
      readonly progress: DownloadProgress
    }
  | { readonly kind: "failed"; readonly update: AvailableUpdate }

/** Issue d'une recherche lancee depuis les Reglages, pour le retour de leur rangee. */
export type ManualCheck = "found" | "upToDate" | "failed"

/** Jamais installee pendant un travail : l'installation ferme l'application (ADR-001). */
@Service()
export class UpdateService {
  private readonly updater = inject(APP_UPDATER)
  private readonly sidecar = inject(SidecarService)
  private readonly captureException = inject(CAPTURE_EXCEPTION)
  private readonly preferences = inject(PreferencesService)

  private readonly _state = signal<UpdateState>({ kind: "none" })
  readonly state = this._state.asReadonly()

  readonly update = computed(() => {
    const state = this._state()

    return state.kind === "none" ? null : state.update
  })

  private readonly _installFailed = signal<string | null>(null)
  /** Version visee par l'installation qui n'a pas abouti. */
  readonly installFailed = this._installFailed.asReadonly()

  readonly installable = computed(() => this.sidecar.phase() === "idle")

  /**
   * Verrou : un ecran occupe (invite de reprise, travail) renvoie la mise a jour au badge pour
   * de bon, seul `reopen` la ramene. `previous` ne voit que les etats lus.
   */
  private readonly dismissed = linkedSignal<boolean, boolean>({
    source: () => this.sidecar.interruptedRun() !== null || !this.installable(),
    computation: (occupied, previous) => occupied || (previous?.value ?? false),
  })

  readonly downloading = computed(() => this._state().kind === "downloading")

  readonly dialogVisible = computed(
    () => this.update() !== null && (this.downloading() || !this.dismissed()),
  )
  readonly badgeVisible = computed(
    () => this.update() !== null && !this.downloading() && this.dismissed(),
  )

  async check(): Promise<void> {
    await this.detectFailedInstall()
    const update = await this.lookup()
    if (update !== null && update !== "failed") {
      this.adopt(update)
    }
  }

  /** Une mise a jour deja connue rouvre la modale sans nouvelle verification. */
  async checkNow(): Promise<ManualCheck> {
    if (this.update() === null) {
      const update = await this.lookup()
      if (update === "failed") {
        return "failed"
      }
      if (update === null) {
        return "upToDate"
      }
      this.adopt(update)
    }
    this.reopen()

    return "found"
  }

  /** L'installeur ferme l'application : seul le lancement suivant voit son echec (plugins-workspace#3514). */
  private async detectFailedInstall(): Promise<void> {
    const attempt = await this.preferences.readUpdateAttempt()
    if (attempt === null) {
      return
    }
    if (attempt.from === APP_VERSION) {
      this._installFailed.set(attempt.to)
      this.captureException(new Error("update install did not complete"), {
        tags: { area: "updater" },
      })
    }
    await this.preferences.writeUpdateAttempt(null)
  }

  /** Hors ligne, manifeste en 404 ou hors Tauri : frequent, rien a signaler a Sentry. */
  private async lookup(): Promise<AvailableUpdate | null | "failed"> {
    try {
      return await this.updater.check()
    } catch {
      return "failed"
    }
  }

  /** Deux verifications peuvent se croiser : la seconde ne remplace pas un etat deja pris. */
  private adopt(update: AvailableUpdate): void {
    if (this.update() !== null) {
      this.release(update)
      return
    }
    this._state.set({ kind: "available", update })
  }

  private release(update: AvailableUpdate): void {
    update.close().catch((error: unknown) => {
      console.error("[update] ressource de la mise a jour non liberee", error)
    })
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
    const update = await this.lookup()
    if (update === "failed") {
      this._state.set(state)
      return
    }

    this.release(state.update)
    if (update === null) {
      this._state.set({ kind: "none" })
      return
    }
    await this.download(update)
  }

  private async download(update: AvailableUpdate): Promise<void> {
    this._installFailed.set(null)
    this._state.set({ kind: "downloading", update, progress: NOTHING_RECEIVED })
    // Attendue : l'installation ferme l'application.
    await this.preferences.writeUpdateAttempt({ from: APP_VERSION, to: update.version })
    try {
      await update.downloadAndInstall((progress) => {
        this._state.set({ kind: "downloading", update, progress })
      })
    } catch (error) {
      // Seul signal d'une signature cassee chez un utilisateur (PRODUCTION.md § Incident
      // Response). Le plugin rejette une chaine sans pile : le tag isole ces issues.
      this.captureException(error, { tags: { area: "updater" } })
      this._state.set({ kind: "failed", update })
      await this.preferences.writeUpdateAttempt(null)
    }
  }
}
