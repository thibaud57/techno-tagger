import { type Signal, computed, inject, signal, Service } from "@angular/core"

import { ArbitrationStore } from "../stores/arbitration.store"
import { busyPhase, errorRunId, errorTrackId } from "./error-params"
import {
  API_KEY_MISSING,
  ArbitrationSource,
  BusyPhase,
  CacheClearedEvent,
  ExtractionFinishedEvent,
  ExtractionProgressEvent,
  ExtractionRequest,
  FeedbackReadyEvent,
  InterruptedRun,
  PlaylistsListedEvent,
  PHASE_BUSY,
  ResolveArbitrationCommand,
  SidecarCommand,
  SidecarErrorEvent,
  SidecarEvent,
  SwitchArbitrationSourceCommand,
  ThresholdsPayload,
} from "./protocol"
import { PastRunsStore } from "../stores/past-runs.store"
import { ResumeStore } from "../stores/resume.store"
import { TaggingRunStore } from "../stores/tagging-run.store"
import { UrlRecoveryStore } from "../stores/url-recovery.store"
import { WriteStore } from "../stores/write.store"
import { isRecord } from "../record"
import { SIDECAR_TRANSPORT } from "./sidecar-transport"

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
  arbitration_updated: true,
  run_finished: true,
  rollback_target: true,
  rollback_finished: true,
  interrupted_run: true,
  runs_listed: true,
  run_loaded: true,
  cache_size: true,
  cache_cleared: true,
  feedback_ready: true,
  error: true,
}

/** Seul code d'erreur que l'interface emet elle-meme : les autres viennent du sidecar. */
export const SIDECAR_UNAVAILABLE = "sidecar_unavailable"

/** Phase longue en cours, une seule a la fois : celle qui tient les fichiers prime sur les autres. */
export type SidecarPhase = "idle" | "extracting" | "searching" | "writing" | "rollingBack"

/** Geste du bouton unique du run : ce que l'interface propose, le sidecar restant juge. */
export type RunAction = "start" | "cancel" | "commit" | "retry"

type ArbitrationCommand = ResolveArbitrationCommand | SwitchArbitrationSourceCommand

/** Commandes dont l'echec leve l'attente d'un morceau ; indexee comme `KNOWN_EVENTS` pour l'exhaustivite. */
const ARBITRATION_COMMANDS: Record<ArbitrationCommand["command"], true> = {
  resolve_arbitration: true,
  switch_arbitration_source: true,
}

const unavailableError = (command: SidecarCommand["command"] | null): SidecarErrorEvent => ({
  event: "error",
  code: SIDECAR_UNAVAILABLE,
  params: {},
  message: "sidecar unavailable",
  command,
})

/**
 * Frontiere unique entre la webview et le metier (transport, version, erreurs). L'etat de
 * chaque phase vit dans son store : ce service route les evenements et re-expose les signals.
 */
@Service()
export class SidecarService {
  private readonly transport = inject(SIDECAR_TRANSPORT)
  private readonly taggingRun = inject(TaggingRunStore)
  private readonly arbitration = inject(ArbitrationStore)
  private readonly urlRecovery = inject(UrlRecoveryStore)
  private readonly writePhase = inject(WriteStore)
  private readonly resumeStore = inject(ResumeStore)
  private readonly pastRunsStore = inject(PastRunsStore)

  /** `null` tant que le lancement n'a pas repondu : l'ecran bloquant ne doit pas clignoter au demarrage. */
  private readonly _available = signal<boolean | null>(null)
  private readonly _version = signal<string | null>(null)
  private readonly _apiKeyConfigured = signal<boolean | null>(null)
  private readonly _defaultThresholds = signal<ThresholdsPayload | null>(null)
  private readonly _logFile = signal<string | null>(null)
  private readonly _sentrySelftest = signal(false)
  private readonly _cacheSize = signal<number | null>(null)
  private readonly _cacheCleared = signal<CacheClearedEvent | null>(null)
  private readonly _feedbackReady = signal<FeedbackReadyEvent | null>(null)
  private readonly _feedbackPending = signal<string | null>(null)
  private readonly _cacheClearing = signal(false)
  private readonly _listing = signal<PlaylistsListedEvent | null>(null)
  private readonly _listedPlaylistPath = signal<string | null>(null)
  private readonly _listingPending = signal(false)
  private readonly _progress = signal<ExtractionProgressEvent | null>(null)
  private readonly _extraction = signal<ExtractionFinishedEvent | null>(null)
  private readonly _extractionRequest = signal<ExtractionRequest | null>(null)
  private readonly _extracting = signal(false)
  /** Dossier tel que l'utilisateur l'a saisi : le sidecar renvoie le sien normalise (`taggingFolder`). */
  private readonly _requestedFolder = signal<string | null>(null)
  private readonly _lastError = signal<SidecarErrorEvent | null>(null)
  /**
   * Lancement d'un run, neuf ou repris : `failed()` ne vide pas le run affiche, seul l'etat
   * « en cours » du lancement retombe.
   */
  private readonly taggingLaunch = {
    phase: "tagging",
    undo: () => {
      this.taggingRun.failed()
    },
  } as const
  /**
   * Commandes qui ouvrent une phase longue : la phase qu'elles lancent et ce que leur envoi a pose
   * d'optimiste et que leur echec defait. Un `phase_busy` sur cette meme phase dit que la vraie
   * tourne : rien a defaire. Sur une autre, l'etat pose par la commande refusee ne repose sur rien.
   */
  private readonly launches = {
    extract_playlist: {
      phase: "extraction",
      undo: () => {
        this.endExtraction()
      },
    },
    start_tagging: this.taggingLaunch,
    resume_run: this.taggingLaunch,
    commit_run: {
      phase: "write",
      undo: () => {
        this.writePhase.commitFailed()
      },
    },
    retry_write: {
      phase: "write",
      undo: () => {
        this.writePhase.retryFailed()
      },
    },
    rollback: {
      phase: "rollback",
      undo: () => {
        this.writePhase.rollbackFailed()
      },
    },
  } satisfies Record<string, { readonly phase: BusyPhase; readonly undo: () => void }>

  readonly available = this._available.asReadonly()
  readonly version = this._version.asReadonly()
  /** `null` tant que la version n'est pas arrivee : l'etat de la cle n'est pas encore connu. */
  readonly apiKeyConfigured = this._apiKeyConfigured.asReadonly()
  /** `null` tant que la version n'est pas arrivee, comme `apiKeyConfigured`. */
  readonly defaultThresholds = this._defaultThresholds.asReadonly()
  readonly logFile = this._logFile.asReadonly()
  /** Le moteur demande l'evenement de test de la webview (PRODUCTION.md § Observabilite). */
  readonly sentrySelftest = this._sentrySelftest.asReadonly()
  /** Octets du cache, `null` avant la premiere mesure. */
  readonly cacheSize = this._cacheSize.asReadonly()
  readonly cacheCleared = this._cacheCleared.asReadonly()
  /** `clear_cache` envoye sans reponse encore : vrai jusqu'a `cache_cleared` ou son refus. */
  readonly cacheClearing = this._cacheClearing.asReadonly()
  readonly feedbackReady = this._feedbackReady.asReadonly()
  /** Run dont l'issue de retour se prepare, `null` hors attente. */
  readonly feedbackPending = this._feedbackPending.asReadonly()
  readonly versionMismatch = computed(() => {
    const sidecar = this._version()

    return sidecar === null || sidecar === APP_VERSION ? null : { ui: APP_VERSION, sidecar }
  })
  readonly playlistFormat = computed(() => this._listing()?.playlist_format ?? null)
  readonly playlists = computed(() => this._listing()?.playlists ?? [])
  /** Le fichier que decrivent `playlistFormat` et `playlists`, l'evenement ne le nommant pas. */
  readonly listedPlaylistPath = this._listedPlaylistPath.asReadonly()
  /**
   * `list_playlists` envoyee sans reponse encore : vrai jusqu'a `playlists_listed`, son refus ou
   * la fin du process. L'absence d'erreur ne le dit pas, `send` efface `lastError` pour toute commande.
   */
  readonly listingPending = this._listingPending.asReadonly()
  readonly progress = this._progress.asReadonly()
  readonly extraction = this._extraction.asReadonly()
  /** Les choix du dernier run lance, gardes avec son rapport : l'onglet qui les a saisis peut etre demonte. */
  readonly extractionRequest = this._extractionRequest.asReadonly()
  /** Vrai de l'envoi d'`extract_playlist` jusqu'a son resultat, son erreur ou la fin du process. */
  readonly extracting = this._extracting.asReadonly()
  readonly lastError = this._lastError.asReadonly()
  /** Commande a l'origine de `lastError` : un ecran n'affiche que celles qu'il emet. */
  readonly lastErrorCommand = computed(() => this._lastError()?.command ?? null)
  /** Exige la version recue : absente, la divergence n'est pas encore controlee (ADR-018). */
  readonly ready = computed(
    () =>
      this._available() === true &&
      this._version() !== null &&
      this.versionMismatch() === null &&
      !this._extracting(),
  )

  /** Delegation : les composants n'injectent que ce service, la frontiere du sidecar. */
  readonly taggingTracks = this.taggingRun.tracks
  readonly taggingProgress = this.taggingRun.progress
  readonly tagging = this.taggingRun.running
  readonly taggingFinished = this.taggingRun.finished
  /** Nul jusqu'a `run_started` : la page distingue ainsi le parcours du dossier d'un dossier vide. */
  readonly taggingRunId = this.taggingRun.runId
  /** Chemin normalise par le sidecar, a afficher ; la comparaison au champ se fait sur `requestedFolder`. */
  readonly taggingFolder = this.taggingRun.folder
  /** Dossier du dernier `startTagging`, tel qu'envoye : aucune regle de chemin dupliquee ici. */
  readonly requestedFolder = this._requestedFolder.asReadonly()
  /** Run interrompu a proposer au lancement, ou nul : l'annonce du demarrage, puis ce qu'en ont fait les gestes. */
  readonly interruptedRun = this.resumeStore.prompt
  readonly taggingInterrupted = this.taggingRun.interrupted
  readonly taggingWritableCount = this.taggingRun.writableCount
  readonly writeFailureCount = this.taggingRun.writeFailureCount
  readonly arbitrations = this.arbitration.entries
  readonly currentArbitration = this.arbitration.current
  readonly arbitrationPosition = this.arbitration.position
  readonly arbitrationBusy = this.arbitration.currentBusy
  readonly arbitrationInFlight = this.arbitration.anyBusy
  readonly hasPreviousArbitration = this.arbitration.hasPrevious
  readonly hasNextArbitration = this.arbitration.hasNext
  readonly arbitrationOpenings = this.arbitration.openings
  readonly urlRecoveryProgress = this.urlRecovery.progress
  readonly urlRecoveryBusy = this.urlRecovery.busy
  readonly urlRecoveryErrors = this.urlRecovery.errors
  readonly committed = this.writePhase.committed
  readonly writing = this.writePhase.writing
  readonly writeProgress = this.writePhase.progress
  readonly writeFinished = this.writePhase.finished
  readonly rollingBack = this.writePhase.rollingBack
  readonly rollbackFinished = this.writePhase.rollbackFinished
  readonly rollbackTarget = this.writePhase.rollbackTarget
  /** Runs passes, nuls tant que le moteur n'a pas repondu a `list_runs`. */
  readonly pastRuns = this.pastRunsStore.runs
  readonly loadedRun = this.pastRunsStore.loaded
  /** Refus de `load_run` avec son run : `lastError` est effacee par toute autre commande. */
  readonly loadRefusal = this.pastRunsStore.refusal
  /** Plus aucune decision n'entre dans le run affiche : le sidecar la refuserait ou l'ignorerait. */
  readonly runFrozen = computed(() => this.writePhase.committed() || this.taggingRun.lost())
  /**
   * Run affiche que le moteur tient sans l'avoir ecrit en entier : il refuserait `clear_cache` en
   * `run_not_written`. Un run perdu avec le moteur n'attend plus rien, echecs restes a l'ecran
   * compris : `runFrozen` ne le distingue pas d'un run ecrit.
   */
  readonly runAwaitsWrite = computed(
    () =>
      this.taggingRun.runId() !== null &&
      !this.taggingRun.lost() &&
      (!this.writePhase.committed() || this.taggingRun.writeFailureCount() > 0),
  )
  /** Un run fige n'arbitrera plus : ses attentes ne sont pas un travail en suspens, le compte est nul. */
  readonly arbitrationCount = computed(() => (this.runFrozen() ? 0 : this.arbitration.count()))
  /** Vide sur un run fige, que le sidecar refuserait. */
  readonly recoverableTracks = computed(() =>
    this.runFrozen() ? [] : this.taggingRun.tracks().filter((track) => track.recoverable),
  )
  readonly phase = computed<SidecarPhase>(() => {
    if (this.writePhase.rollingBack() !== null) {
      return "rollingBack"
    }
    if (this.writePhase.writing()) {
      return "writing"
    }
    if (this.taggingRun.running()) {
      return "searching"
    }

    return this._extracting() ? "extracting" : "idle"
  })
  /** Une seule operation sur les fichiers a la fois, comme le sidecar l'impose. */
  readonly filesBusy = computed(() => this.phase() === "writing" || this.phase() === "rollingBack")
  /**
   * Run que le moteur ecrirait : recherche finie, ni confirme ni perdu, au moins un morceau
   * resolu. Le sidecar reste seul juge et refuse le reste en `write_not_open`.
   */
  readonly runConfirmable = computed(
    () =>
      this.taggingRun.runId() !== null &&
      !this.taggingRun.running() &&
      !this.runFrozen() &&
      this.taggingRun.writableCount() > 0,
  )
  /** Run deja ecrit que le moteur tient encore : une nouvelle ecriture en est la relance. */
  readonly runRetryable = computed(
    () => this.writePhase.finished() !== null && !this.taggingRun.lost(),
  )
  private started = false

  /**
   * Geste du bouton unique du run pour le dossier du champ. Un autre dossier abandonne le run non
   * ecrit et ses echecs ; le meme se relance quand le run n'est pas confirmable, sinon un run
   * vide ou perdu bloquerait son propre dossier. Lit les accesseurs publics, comme `errorFor`.
   */
  runAction(folder: Signal<string>): Signal<RunAction> {
    return computed(() => {
      const phase = this.phase()
      if (phase === "searching") {
        return "cancel"
      }
      // Une ecriture qui suit un bilan d'ecriture est une relance, la premiere est la confirmation.
      // `runRetryable` exclut un run perdu avec le moteur : son dossier repart d'un nouveau run.
      const rewrite = this.runRetryable()
      if (phase === "writing") {
        return rewrite ? "retry" : "commit"
      }
      if (folder() !== this.requestedFolder()) {
        return "start"
      }
      if (this.runConfirmable()) {
        return "commit"
      }

      return rewrite && this.writeFailureCount() > 0 ? "retry" : "start"
    })
  }

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
    this._logFile.set(null)
    // L'annonce du moteur precedent est caduque : sans cela, elle clignoterait avant la nouvelle reponse.
    this.resumeStore.announced(null)
    await this.start()
  }

  async listPlaylists(playlistPath: string): Promise<void> {
    // La reponse precedente decrivait un autre fichier : l'ecran attend la nouvelle.
    this._listing.set(null)
    this._listedPlaylistPath.set(playlistPath)
    this._listingPending.set(true)
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

  /** Sans ce garde, `reset()` viderait la liste d'un run en cours ou en ecriture. */
  async startTagging(folder: string, thresholds?: ThresholdsPayload): Promise<void> {
    if (this.taggingRun.running() || this.filesBusy()) {
      return
    }
    this.prepareRun(folder)
    // `JSON.stringify` omet une cle `undefined` : la commande part sans `thresholds`.
    await this.send({ command: "start_tagging", folder, thresholds })
  }

  /** Pose l'etat sans attendre d'evenement, comme `endRun` a la mort du process : rien ne le confirmera. */
  async cancelTagging(): Promise<void> {
    if (!this.taggingRun.running()) {
      return
    }
    await this.send({ command: "cancel_run" })
    this.taggingRun.failed()
  }

  /**
   * Les evenements rejoues par le moteur remplissent le run comme un lancement. L'invite est deja
   * fermee et le run marque en cours a l'envoi : un second clic ne repart pas. Rend `false` quand
   * rien n'est parti, pour que l'invite ne quitte pas l'onglet courant.
   */
  async resume(run: InterruptedRun): Promise<boolean> {
    if (
      this.interruptedRun()?.run_id !== run.run_id ||
      this.taggingRun.running() ||
      this.filesBusy()
    ) {
      return false
    }
    this.resumeStore.cleared()
    this.prepareRun(run.folder)
    await this.send({ command: "resume_run", run_id: run.run_id })

    return true
  }

  /** L'annonce qui revient dit s'il reste un autre run a reprendre. */
  async discard(runId: string): Promise<void> {
    if (this.interruptedRun()?.run_id !== runId) {
      return
    }
    this.resumeStore.cleared()
    await this.send({ command: "discard_run", run_id: runId })
  }

  dismissInterruptedRun(): void {
    this.resumeStore.cleared()
  }

  async chooseCandidate(trackId: string, source: ArbitrationSource, index: number): Promise<void> {
    await this.gesture(trackId, {
      command: "resolve_arbitration",
      track_id: trackId,
      source,
      candidate: index,
    })
  }

  async refuseCandidates(trackId: string, source: ArbitrationSource): Promise<void> {
    await this.gesture(trackId, {
      command: "resolve_arbitration",
      track_id: trackId,
      source,
      candidate: null,
    })
  }

  async showArbitrationSource(trackId: string, source: ArbitrationSource): Promise<void> {
    await this.gesture(trackId, { command: "switch_arbitration_source", track_id: trackId, source })
  }

  previousArbitration(): void {
    this.arbitration.previous()
  }

  nextArbitration(): void {
    this.arbitration.next()
  }

  openArbitration(trackId: string): void {
    this.arbitration.open(trackId)
  }

  /** Une URL vide partirait en `malformed_command` sans `track_id` : l'attente ne se leverait plus. */
  async resolveByUrl(trackId: string, url: string): Promise<void> {
    if (url.length === 0 || this.urlRecovery.isBusy(trackId)) {
      return
    }
    this.urlRecovery.sent(trackId)
    await this.send({ command: "resolve_by_url", track_id: trackId, url })
  }

  /** Point de non-retour : un second clic ne repart pas. */
  async commitRun(): Promise<void> {
    const runId = this.taggingRun.runId()
    // La confirmation peut etre acceptee apres la mort du moteur : rien ne partirait.
    if (runId === null || !this.runConfirmable() || this.filesBusy()) {
      return
    }
    this.writePhase.committing()
    await this.send({ command: "commit_run", run_id: runId })
    // Commande non partie : aucun evenement ne relachera la confirmation (`endRun` ne baisse que `writing`).
    if (!this._available()) {
      this.writePhase.commitFailed()
    }
  }

  async retryWrite(): Promise<void> {
    const runId = this.taggingRun.runId()
    if (runId === null || this.filesBusy()) {
      return
    }
    this.writePhase.retrying()
    await this.send({ command: "retry_write", run_id: runId })
  }

  /** `trackId` nul : le run entier, y compris un run d'une session precedente. */
  async rollback(runId: string, trackId: string | null = null): Promise<void> {
    if (this.filesBusy()) {
      return
    }
    this.writePhase.rollbackSent({ runId, trackId })
    await this.send({ command: "rollback", run_id: runId, track_id: trackId })
  }

  async loadRollbackTarget(): Promise<void> {
    await this.query({ command: "get_rollback_target" })
  }

  async loadCacheSize(): Promise<void> {
    await this.query({ command: "get_cache_size" })
  }

  async clearCache(): Promise<void> {
    if (this._cacheClearing()) {
      return
    }
    this._cacheClearing.set(true)
    await this.send({ command: "clear_cache" })
  }

  async listRuns(): Promise<void> {
    await this.query({ command: "list_runs" })
  }

  /** Un run deja en chargement n'est pas redemande : chaque `load_run` retelecharge les pochettes. */
  async loadRun(runId: string): Promise<void> {
    if (this._available() !== true || this.pastRunsStore.loading() === runId) {
      return
    }
    this.pastRunsStore.loadStarted(runId)
    await this.send({ command: "load_run", run_id: runId })
  }

  /** Comme `loadRun`, sans moteur rien ne part. Le second clic reecrirait le meme export : ignore. */
  async prepareFeedback(runId: string): Promise<void> {
    if (this._available() !== true || this._feedbackPending() === runId) {
      return
    }
    this._feedbackPending.set(runId)
    await this.send({ command: "prepare_feedback", run_id: runId })
  }

  /**
   * La cle part une fois vers le sidecar et n'est gardee dans aucun signal : seul
   * son etat revient, par l'evenement `version`.
   */
  async setApiKey(apiKey: string): Promise<void> {
    await this.send({ command: "set_api_key", api_key: apiKey })
  }

  /** Lecture seule : sans moteur lance, pas de `reportUnavailable`, qui arreterait le run affiche. */
  private async query(command: SidecarCommand): Promise<void> {
    if (this._available() !== true) {
      return
    }
    await this.send(command)
  }

  private async send(command: SidecarCommand): Promise<void> {
    if (!this._available()) {
      this.reportUnavailable(command.command)

      return
    }
    // Une erreur ne vaut que pour la commande qui l'a provoquee.
    this._lastError.set(null)
    try {
      // Une ligne, une commande : c'est ce que lit la boucle du sidecar.
      await this.transport.send(`${JSON.stringify(command)}\n`)
    } catch (error) {
      // Pipe brisee avant que `onTerminated` ne tourne : sans ce catch la rejection
      // remonterait jusqu'au bootstrap.
      console.error("[sidecar] ecriture impossible", error)
      this._available.set(false)
      this.reportUnavailable(command.command)
    }
  }

  /** Seulement face au moteur attendu : un moteur en conflit ne reprend rien. */
  private async askInterruptedRun(): Promise<void> {
    if (this.versionMismatch() !== null) {
      return
    }
    await this.send({ command: "get_interrupted_run" })
  }

  /** Efface le run precedent des l'envoi de la commande : l'ecran ne melange rien. */
  private prepareRun(folder: string): void {
    this._requestedFolder.set(folder)
    this.writePhase.reset()
    // Le sidecar jette les arbitrages de l'ancien run a la reception de la commande.
    this.arbitration.clear()
    this.urlRecovery.clear()
    this.taggingRun.reset()
  }

  /** Un geste par morceau a la fois : un double clic ne repart pas avant la reponse. */
  private async gesture(trackId: string, command: ArbitrationCommand): Promise<void> {
    if (this.arbitration.isBusy(trackId)) {
      return
    }
    this.arbitration.sent(trackId)
    await this.send(command)
  }

  private routeLaunchError(event: SidecarErrorEvent): void {
    const launch = Object.entries(this.launches).find(([command]) => command === event.command)?.[1]
    if (launch === undefined) {
      return
    }
    if (busyPhase(event) === launch.phase) {
      return
    }
    launch.undo()
  }

  private routeArbitrationError(event: SidecarErrorEvent): void {
    const trackId = errorTrackId(event)
    if (
      event.command !== null &&
      Object.hasOwn(ARBITRATION_COMMANDS, event.command) &&
      trackId !== null
    ) {
      if (this.arbitration.rejected(trackId, event.code)) {
        this.taggingRun.droppedAwaiting(trackId)
      }
    }
  }

  private routeUrlRecoveryError(event: SidecarErrorEvent): void {
    const trackId = errorTrackId(event)
    if (event.command === "resolve_by_url" && trackId !== null) {
      this.urlRecovery.rejected(trackId, event)
    }
  }

  /**
   * Le plan reste sur disque apres un refus : on redemande l'annonce. Sauf `phase_busy` et cle
   * absente, ou l'invite non fermable enfermerait l'utilisateur qui doit d'abord agir ailleurs.
   */
  private routeResumeError(event: SidecarErrorEvent): void {
    if (event.command !== "resume_run" && event.command !== "discard_run") {
      return
    }
    if (event.code === PHASE_BUSY || event.code === API_KEY_MISSING) {
      return
    }
    void this.askInterruptedRun()
  }

  /**
   * Seule la reponse du run attendu leve l'attente : une autre ne dit rien du run demande
   * ensuite. Un refus sans `run_id` (ligne malformee) ne designe aucun run : il la leve, faute de mieux.
   */
  private settleFeedback(runId: string | null): void {
    if (runId === null || runId === this._feedbackPending()) {
      this._feedbackPending.set(null)
    }
  }

  private routeLoadRunError(event: SidecarErrorEvent): void {
    if (event.command === "load_run") {
      this.pastRunsStore.loadFailed(event)
    }
  }

  /**
   * Plus aucun evenement n'arrivera : un run en cours s'arrete quelle que soit la
   * commande refusee, a la difference d'une erreur recue sur le flux.
   */
  private reportUnavailable(command: SidecarCommand["command"] | null): void {
    this._lastError.set(unavailableError(command))
    this.endRun()
  }

  /** Le process est perdu : toute phase longue s'arrete, quelle qu'en soit la cause. */
  private endRun(): void {
    this.endExtraction()
    this.taggingRun.engineLost()
    this.writePhase.failed()
    this.arbitration.clear()
    this.urlRecovery.clear()
    this._cacheClearing.set(false)
    this._listingPending.set(false)
    this._feedbackPending.set(null)
    // Le run charge reste affiche : seul l'attente tombe, sinon `loadRun` du meme id ne repart plus.
    this.pastRunsStore.loadAbandoned()
  }

  private endExtraction(): void {
    this._extracting.set(false)
    this._progress.set(null)
  }

  /**
   * Une ligne illisible ou inconnue est tracee sans interrompre la session : symptome d'un
   * contrat desynchronise.
   */
  private handleLine(line: string): void {
    const event = this.parseLine(line)
    if (event === undefined) {
      return
    }

    switch (event.event) {
      case "version": {
        // Seulement la premiere `version` d'un moteur (`restart()` la remet a nul) ou une cle tout
        // juste enregistree : `set_api_key` renvoie une `version`.
        const firstAnswer = this._version() === null
        const keySaved = this._apiKeyConfigured() === false && event.api_key_configured
        this._version.set(event.version)
        this._apiKeyConfigured.set(event.api_key_configured)
        this._defaultThresholds.set(event.default_thresholds)
        this._logFile.set(event.log_file)
        this._sentrySelftest.set(event.sentry_selftest)
        if (firstAnswer || keySaved) {
          void this.askInterruptedRun()
        }
        break
      }
      case "playlists_listed":
        this._listing.set(event)
        this._listingPending.set(false)
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
        this.arbitration.resolved(event.track_id)
        this.urlRecovery.resolved(event.track_id)
        break
      case "arbitration_required":
        this.taggingRun.awaiting(event)
        this.arbitration.required(event)
        break
      case "arbitration_updated":
        this.arbitration.updated(event)
        break
      case "interrupted_run":
        this.resumeStore.announced(event.run)
        break
      case "run_finished":
        // Le service route par phase, comme pour `progress` : l'ecriture a son propre store.
        if (event.phase === "network") {
          this.taggingRun.completed(event)
        } else {
          this.writePhase.completed(event)
          // Un dump vient d'etre cree : le dernier run annulable a change.
          void this.loadRollbackTarget()
          // Un rapport vient d'etre ecrit : la liste des runs passes a change.
          void this.listRuns()
        }
        break
      case "rollback_target":
        this.writePhase.targetFound(event.run)
        break
      case "cache_size":
        this._cacheSize.set(event.size_bytes)
        break
      case "cache_cleared":
        this._cacheSize.set(event.size_bytes)
        this._cacheCleared.set(event)
        this._cacheClearing.set(false)
        break
      case "rollback_finished":
        this.writePhase.rolledBack(event)
        this.taggingRun.restored(event)
        // Un dump vient d'etre consomme : la cible passe au run precedent.
        void this.loadRollbackTarget()
        break
      case "runs_listed":
        this.pastRunsStore.listed(event.runs)
        break
      case "run_loaded":
        this.pastRunsStore.loadedRun(event)
        break
      case "feedback_ready":
        this.settleFeedback(event.run_id)
        this._feedbackReady.set(event)
        break
      case "error":
        // Avant l'ecriture de l'erreur : la relance de l'annonce passe par `send`, qui efface l'erreur courante.
        this.routeResumeError(event)
        this._lastError.set(event)
        if (event.command === "clear_cache") {
          this._cacheClearing.set(false)
        }
        if (event.command === "list_playlists") {
          this._listingPending.set(false)
        }
        // Chaque phase longue ne tombe que sur l'echec de la commande qui l'a ouverte :
        // elles tournent en parallele, l'une ne dit rien de l'autre.
        this.routeLaunchError(event)
        // `load_run` n'ouvre aucune phase, mais une phase occupee le refuse aussi : le chargement tombe.
        this.routeLoadRunError(event)
        if (event.command === "prepare_feedback") {
          this.settleFeedback(errorRunId(event))
        }
        // Un refus pour phase occupee ne concerne que les lancements : aucun geste n'en recoit.
        if (event.code === PHASE_BUSY) {
          break
        }
        this.routeArbitrationError(event)
        this.routeUrlRecoveryError(event)
        break
      default: {
        // Evenement ajoute cote sidecar sans etre traite ici : erreur de compilation.
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
        this.urlRecovery.advanced(event.processed, event.total)
        break
      case "write":
        this.writePhase.advanced(event.processed, event.total)
        break
      default: {
        const exhaustive: never = event.phase
        console.error("[sidecar] phase non traitee", exhaustive)
      }
    }
  }

  private parseLine(line: string): SidecarEvent | undefined {
    try {
      const parsed: unknown = JSON.parse(line)
      if (this.isKnownEvent(parsed)) {
        return parsed
      }
      console.error("[sidecar] evenement inconnu, contrat desynchronise", line)
    } catch {
      console.error("[sidecar] ligne illisible", line)
    }

    return undefined
  }

  private isKnownEvent(parsed: unknown): parsed is SidecarEvent {
    return (
      isRecord(parsed) &&
      typeof parsed["event"] === "string" &&
      Object.hasOwn(KNOWN_EVENTS, parsed["event"])
    )
  }
}
