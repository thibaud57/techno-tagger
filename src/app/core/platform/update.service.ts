import { Service, computed, inject, linkedSignal, signal } from "@angular/core"
import * as Sentry from "@sentry/angular"

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

/**
 * Mise a jour proposee au demarrage seulement : l'installation ferme l'application, elle ne
 * se propose jamais en cours de session (ADR-001, rule tauri/config-bundle).
 */
@Service()
export class UpdateService {
  private readonly updater = inject(APP_UPDATER)
  private readonly sidecar = inject(SidecarService)

  private readonly _state = signal<UpdateState>({ kind: "none" })
  readonly state = this._state.asReadonly()

  readonly update = computed(() => {
    const state = this._state()

    return state.kind === "none" ? null : state.update
  })

  /** L'installation ferme l'application : jamais pendant un travail du moteur. */
  readonly installable = computed(() => this.sidecar.phase() === "idle")

  /**
   * La modale ne s'ouvre d'elle-meme que sur un ecran libre : une invite de reprise affichee
   * ou un travail en cours renvoient la mise a jour au badge et l'y laissent, seul le badge
   * la rouvrant. Le shell lit ce signal a chaque detection, ce qui donne a `previous` chaque
   * etat traverse.
   */
  private readonly dismissed = linkedSignal<boolean, boolean>({
    source: () => this.sidecar.interruptedRun() !== null || !this.installable(),
    computation: (occupied, previous) => occupied || (previous?.value ?? false),
  })

  /** Le telechargement n'est pas fermable : rien ne masque sa progression. */
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
      // Hors ligne, manifeste en 404 pendant un build, ou hors Tauri : rien a proposer,
      // et rien a signaler, ces cas sont frequents.
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

  /** Une mise a jour en echec n'est pas reutilisee : la verification repart de zero. */
  async retry(): Promise<void> {
    const state = this._state()
    if (state.kind !== "failed" || !this.installable()) {
      return
    }

    // Passe en telechargement des le clic : un second clic ne relance rien.
    this._state.set({ kind: "downloading", update: state.update, progress: NOTHING_RECEIVED })
    let update: AvailableUpdate | null
    try {
      update = await this.updater.check()
    } catch {
      this._state.set(state)
      return
    }

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
      // Seul signal d'une chaine de signature cassee chez un utilisateur (PRODUCTION.md
      // § Incident Response) ; le SDK durci retire les chemins (ADR-014).
      Sentry.captureException(error)
      this._state.set({ kind: "failed", update })
    }
  }
}
