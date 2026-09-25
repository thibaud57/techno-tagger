import { Injectable, type Signal, computed, inject, signal } from "@angular/core"

import {
  ExtractionFinishedEvent,
  ExtractionProgressEvent,
  ExtractionRequest,
  PlaylistsListedEvent,
  SidecarCommand,
  SidecarErrorEvent,
  SidecarEvent,
  ThresholdsPayload,
} from "./models/protocol"
import { SIDECAR_TRANSPORT } from "./sidecar-transport"
import { TaggingRunStore } from "./tagging-run.store"

// Table indexee par le discriminant : oublier un evenement du contrat devient
// une erreur de compilation ici, jamais une ligne silencieusement ignoree.
const KNOWN_EVENTS: Record<SidecarEvent["event"], true> = {
  version: true,
  playlists_listed: true,
  progress: true,
  extraction_finished: true,
  run_started: true,
  track_resolved: true,
  arbitration_required: true,
  run_finished: true,
  error: true,
}

/** Seul code d'erreur que l'interface emet elle-meme : les autres viennent du sidecar. */
export const SIDECAR_UNAVAILABLE = "sidecar_unavailable"

/** Refus d'une seconde commande : la phase en cours continue, l'arret les epargne. */
const TAGGING_IN_PROGRESS = "tagging_in_progress"
const EXTRACTION_IN_PROGRESS = "extraction_in_progress"

const unavailableError = (command: SidecarCommand["command"] | null): SidecarErrorEvent => ({
  event: "error",
  code: SIDECAR_UNAVAILABLE,
  params: {},
  message: "sidecar unavailable",
  command,
})

/**
 * Frontiere unique entre la webview et le metier (transport, version, erreurs).
 * L'etat d'un run vit dans son store : `TaggingRunStore` pour le re-tagging.
 */
@Injectable({ providedIn: "root" })
export class SidecarService {
  private readonly transport = inject(SIDECAR_TRANSPORT)

  /** `null` tant que le lancement n'a pas repondu : l'ecran bloquant ne doit pas clignoter au demarrage. */
  private readonly _available = signal<boolean | null>(null)
  private readonly _version = signal<string | null>(null)
  private readonly _apiKeyConfigured = signal<boolean | null>(null)
  private readonly _listing = signal<PlaylistsListedEvent | null>(null)
  private readonly _listedPlaylistPath = signal<string | null>(null)
  private readonly _progress = signal<ExtractionProgressEvent | null>(null)
  private readonly _extraction = signal<ExtractionFinishedEvent | null>(null)
  private readonly _extractionRequest = signal<ExtractionRequest | null>(null)
  private readonly _extracting = signal(false)
  private readonly _lastError = signal<SidecarErrorEvent | null>(null)
  private readonly _lastErrorCommand = signal<SidecarCommand["command"] | null>(null)

  readonly available = this._available.asReadonly()
  readonly version = this._version.asReadonly()
  /** `null` tant que la version n'est pas arrivee : l'etat de la cle n'est pas encore connu. */
  readonly apiKeyConfigured = this._apiKeyConfigured.asReadonly()
  readonly versionMismatch = computed(() => {
    const sidecar = this._version()

    return sidecar === null || sidecar === APP_VERSION ? null : { ui: APP_VERSION, sidecar }
  })
  /** Decide si l'interface propose un selecteur de playlist. */
  readonly playlistFormat = computed(() => this._listing()?.playlist_format ?? null)
  readonly playlists = computed(() => this._listing()?.playlists ?? [])
  /** Le fichier que decrivent `playlistFormat` et `playlists`, l'evenement ne le nommant pas. */
  readonly listedPlaylistPath = this._listedPlaylistPath.asReadonly()
  readonly progress = this._progress.asReadonly()
  readonly extraction = this._extraction.asReadonly()
  /** Les choix du dernier run lance, gardes avec son rapport : l'onglet qui les a saisis peut etre demonte. */
  readonly extractionRequest = this._extractionRequest.asReadonly()
  /** Vrai de l'envoi d'`extract_playlist` jusqu'a son resultat, son erreur ou la fin du process. */
  readonly extracting = this._extracting.asReadonly()
  readonly lastError = this._lastError.asReadonly()
  /** Commande a l'origine de `lastError` : un ecran n'affiche que celles qu'il emet. */
  readonly lastErrorCommand = this._lastErrorCommand.asReadonly()
  /** Exige la version recue : absente, la divergence n'est pas encore controlee (ADR-018). */
  readonly ready = computed(
    () =>
      this._available() &&
      this._version() !== null &&
      this.versionMismatch() === null &&
      !this._extracting(),
  )

  private readonly taggingRun = inject(TaggingRunStore)

  /** Delegation : les composants n'injectent que ce service, la frontiere du sidecar. */
  readonly taggingTracks = this.taggingRun.tracks
  readonly taggingProgress = this.taggingRun.progress
  readonly tagging = this.taggingRun.running
  readonly taggingFinished = this.taggingRun.finished
  /** Nul jusqu'a `run_started` : la page distingue ainsi le parcours du dossier d'un dossier vide. */
  readonly taggingRunId = this.taggingRun.runId
  readonly taggingInterrupted = this.taggingRun.interrupted

  private started = false

  /**
   * Lit les accesseurs publics et non les signals prives : un stub qui les fournit
   * reutilise cette methode par son prototype, sans reecrire la regle.
   */
  errorFor(...commands: readonly SidecarCommand["command"][]): Signal<SidecarErrorEvent | null> {
    return computed(() => {
      const command = this.lastErrorCommand()

      return command !== null && commands.includes(command) ? this.lastError() : null
    })
  }

  /**
   * Idempotent : le sidecar est un process long lance au demarrage, pas une
   * invocation par action.
   */
  async start(): Promise<void> {
    if (this.started) {
      return
    }
    this.started = true

    const available = await this.transport.start({
      onLine: (line) => {
        this.handleLine(line)
      },
      onStderr: (line) => {
        console.error("[sidecar]", line)
      },
      onTerminated: () => {
        this._available.set(false)
        this.endRun()
      },
    })
    this._available.set(available)

    if (available) {
      await this.send({ command: "get_version" })
    }
  }

  /**
   * Relance apres un echec de lancement ou une mort du process : c'est l'action de
   * l'ecran bloquant, une fois le binaire restaure ou exclu de l'antivirus.
   */
  async restart(): Promise<void> {
    this.started = false
    this._available.set(null)
    this._version.set(null)
    this._apiKeyConfigured.set(null)
    await this.start()
  }

  async listPlaylists(playlistPath: string): Promise<void> {
    // La reponse precedente decrivait un autre fichier : l'ecran attend la nouvelle.
    this._listing.set(null)
    this._listedPlaylistPath.set(playlistPath)
    await this.send({ command: "list_playlists", playlist_path: playlistPath })
  }

  /** Sans ce garde, l'effacement ci-dessous viderait l'ecran d'une extraction en cours. */
  async extractPlaylist(request: ExtractionRequest): Promise<void> {
    if (this._extracting()) {
      return
    }
    this._extractionRequest.set(request)
    this._extraction.set(null)
    this._progress.set(null)
    this._extracting.set(true)
    await this.send({ command: "extract_playlist", ...request })
  }

  /** Sans ce garde, `reset()` viderait la liste d'un run en cours (releve le 2026-09-24). */
  async startTagging(folder: string, thresholds?: ThresholdsPayload): Promise<void> {
    if (this.taggingRun.running()) {
      return
    }
    this.taggingRun.reset()
    // `JSON.stringify` omet une cle `undefined` : la commande part sans `thresholds`.
    await this.send({ command: "start_tagging", folder, thresholds })
  }

  /**
   * `Process.kill()` ne ciblerait que le bootloader d'un binaire PyInstaller et
   * laisserait le process Python vivant : l'arret passe par le protocole.
   */
  async shutdown(): Promise<void> {
    await this.send({ command: "shutdown" })
  }

  /**
   * La cle part une fois vers le sidecar et n'est gardee dans aucun signal : seul
   * son etat revient, par l'evenement `version`.
   */
  async setApiKey(apiKey: string): Promise<void> {
    await this.send({ command: "set_api_key", api_key: apiKey })
  }

  private async send(command: SidecarCommand): Promise<void> {
    if (!this._available()) {
      this.reportUnavailable(command.command)

      return
    }
    // Une erreur ne vaut que pour la commande qui l'a provoquee.
    this.setLastError(null)
    try {
      // Une ligne, une commande : c'est ce que lit la boucle du sidecar.
      await this.transport.send(`${JSON.stringify(command)}\n`)
    } catch (error) {
      // Pipe brisee entre le spawn et cette ecriture : `onTerminated` n'a pas
      // encore tourne, sans ce catch la rejection remonterait jusqu'au bootstrap.
      console.error("[sidecar] ecriture impossible", error)
      this._available.set(false)
      this.reportUnavailable(command.command)
    }
  }

  /**
   * Plus aucun evenement n'arrivera : un run en cours s'arrete quelle que soit la
   * commande refusee, a la difference d'une erreur recue sur le flux.
   */
  private reportUnavailable(command: SidecarCommand["command"] | null): void {
    this.setLastError(unavailableError(command))
    this.endRun()
  }

  private setLastError(error: SidecarErrorEvent | null): void {
    this._lastError.set(error)
    this._lastErrorCommand.set(error?.command ?? null)
  }

  /** Le process est perdu : les deux phases longues s'arretent, quelle qu'en soit la cause. */
  private endRun(): void {
    this.endExtraction()
    this.taggingRun.failed()
  }

  private endExtraction(): void {
    this._extracting.set(false)
    this._progress.set(null)
  }

  /**
   * Traite une ligne de `stdout`, deja decoupee par Tauri.
   *
   * Une ligne illisible ou d'un type inconnu n'interrompt pas la session, mais
   * elle est tracee : c'est le symptome d'un contrat desynchronise entre les deux
   * cotes, et l'absorber en silence le rendrait indiagnosticable.
   */
  private handleLine(line: string): void {
    let event: SidecarEvent

    try {
      const parsed: unknown = JSON.parse(line)
      if (!this.isKnownEvent(parsed)) {
        console.error("[sidecar] evenement inconnu, contrat desynchronise", line)

        return
      }
      event = parsed
    } catch {
      console.error("[sidecar] ligne illisible", line)

      return
    }

    switch (event.event) {
      case "version":
        this._version.set(event.version)
        this._apiKeyConfigured.set(event.api_key_configured)
        break
      case "playlists_listed":
        this._listing.set(event)
        break
      case "progress":
        this.routeProgress(event)
        break
      case "extraction_finished":
        this._extraction.set(event)
        // La progression reste sur son dernier palier : sans elle, une copie d'une seconde ne
        // laisse aucune trace. Elle ne s'efface qu'au lancement suivant.
        this._extracting.set(false)
        break
      case "run_started":
        this.taggingRun.started(event)
        break
      case "track_resolved":
        this.taggingRun.resolved(event)
        break
      case "arbitration_required":
        this.taggingRun.awaiting(event)
        break
      case "run_finished":
        // Le service route par phase, comme pour `progress` : la Feature 5 branchera
        // l'ecriture sur son propre store sans toucher a celui du run.
        if (event.phase === "network") {
          this.taggingRun.completed(event)
        }
        break
      case "error":
        this.setLastError(event)
        // Chaque phase longue ne tombe que sur l'echec de la commande qui l'a ouverte :
        // elles tournent en parallele, l'une ne dit rien de l'autre.
        if (event.command === "extract_playlist" && event.code !== EXTRACTION_IN_PROGRESS) {
          this.endExtraction()
        }
        if (event.command === "start_tagging" && event.code !== TAGGING_IN_PROGRESS) {
          this.taggingRun.failed()
        }
        break
      default: {
        // Ajouter un evenement cote sidecar sans le traiter ici devient une
        // erreur de compilation, pas une ligne silencieusement perdue.
        const exhaustive: never = event
        console.error("[sidecar] evenement non traite", exhaustive)
      }
    }
  }

  /**
   * Une seule forme d'evenement pour toutes les phases longues. Le `never` final
   * fait de l'ajout d'une phase au contrat une erreur de compilation ici.
   */
  private routeProgress(event: ExtractionProgressEvent): void {
    switch (event.phase) {
      case "extraction":
        this._progress.set(event)
        break
      case "tagging":
        this.taggingRun.advanced(event.processed, event.total)
        break
      case "url_recovery":
      case "write":
        // Features 4 et 5 : leur store lira cette phase, rien a suivre ici pour l'instant.
        break
      default: {
        const exhaustive: never = event.phase
        console.error("[sidecar] phase non traitee", exhaustive)
      }
    }
  }

  private isKnownEvent(parsed: unknown): parsed is SidecarEvent {
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      "event" in parsed &&
      typeof parsed.event === "string" &&
      Object.hasOwn(KNOWN_EVENTS, parsed.event)
    )
  }
}
