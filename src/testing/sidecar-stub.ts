import { type Provider, type Signal, type WritableSignal, computed, signal } from "@angular/core"
import { type Mock, vi } from "vitest"

import type { SidecarCommand, SidecarErrorEvent } from "../app/core/sidecar/protocol"
import { type SidecarPhase, SidecarService } from "../app/core/sidecar/sidecar.service"
import { PLAYLISTS } from "./extraction"
import { commandError } from "./write"

// Faux `SidecarService` partage par les specs de composants et de services : chaque test pose
// ses ecarts par surcharge, jamais en recreant le stub. Type contre le vrai service, une
// divergence casse ici a la compilation.

/**
 * Membres que le stub pilote : un signal devient ecrivable, une methode devient un `Mock`.
 * Un tableau est accepte en lecture seule, comme le rendent les fixtures partagees.
 */
type Stubbed<T> =
  T extends Signal<infer V>
    ? WritableSignal<V extends (infer E)[] ? readonly E[] : V>
    : T extends (...args: infer A) => infer R
      ? Mock<(...args: A) => R>
      : T

/** Tout le public du service, sauf ce que le stub derive ou reprend du prototype. */
type StubbedKey = Exclude<keyof SidecarService, keyof DerivedState | "errorFor" | "runAction">

type StubbedState = { [K in StubbedKey]: Stubbed<SidecarService[K]> }

/** Derives du service reel : un test les pilote par les signals dont ils dependent, jamais directement. */
interface DerivedState {
  readonly phase: Signal<SidecarPhase>
  readonly filesBusy: Signal<boolean>
  readonly writeFailureCount: Signal<number>
}

export type SidecarStubOverrides = Partial<StubbedState>

export type SidecarStub = StubbedState &
  DerivedState &
  Pick<SidecarService, "errorFor" | "runAction">

/** Surcharges qui montrent l'erreur `code` de `command`, comme l'ecran qui l'a emise la lit. */
export const commandFailed = (
  command: SidecarCommand["command"],
  code: string,
  params: Record<string, unknown> = {},
): SidecarStubOverrides => ({
  lastError: signal<SidecarErrorEvent | null>(commandError(command, code, params)),
  lastErrorCommand: signal<SidecarCommand["command"] | null>(command),
})

/** Un run est affiche : les stores d'interface lisent son identifiant pour oublier le run precedent. */
export const activeRun = (runId = "run-1"): SidecarStubOverrides => ({
  taggingRunId: signal<string | null>(runId),
})

export const provideSidecarStub = (service: SidecarStub): Provider => ({
  provide: SidecarService,
  useValue: service,
})

const defaults = (): StubbedState => ({
  ready: signal(true),
  available: signal(true),
  apiKeyConfigured: signal(true),
  version: signal("1.0.0"),
  defaultThresholds: signal(null),
  logFile: signal(null),
  sentrySelftest: signal(false),
  cacheSize: signal(null),
  cacheCleared: signal(null),
  cacheClearing: signal(false),
  feedbackReady: signal(null),
  feedbackPending: signal(null),
  versionMismatch: signal(null),
  playlistFormat: signal("vlc_dump"),
  playlists: signal(PLAYLISTS),
  listedPlaylistPath: signal(null),
  listingPending: signal(false),
  progress: signal(null),
  extraction: signal(null),
  extractionRequest: signal(null),
  extracting: signal(false),
  lastError: signal(null),
  lastErrorCommand: signal(null),
  tagging: signal(false),
  taggingTracks: signal([]),
  taggingProgress: signal(null),
  taggingFinished: signal(null),
  taggingRunId: signal(null),
  taggingFolder: signal(null),
  taggingInterrupted: signal(false),
  taggingWritableCount: signal(0),
  requestedFolder: signal(null),
  interruptedRun: signal(null),
  runFrozen: signal(false),
  runAwaitsWrite: signal(false),
  runConfirmable: signal(false),
  runRetryable: signal(false),
  arbitrations: signal([]),
  arbitrationCount: signal(0),
  arbitrationOpenings: signal(0),
  arbitrationPosition: signal(1),
  arbitrationBusy: signal(false),
  arbitrationInFlight: signal(false),
  currentArbitration: signal(null),
  hasPreviousArbitration: signal(false),
  hasNextArbitration: signal(false),
  recoverableTracks: signal([]),
  urlRecoveryProgress: signal(null),
  urlRecoveryBusy: signal(new Set()),
  urlRecoveryErrors: signal(new Map()),
  urlRecovered: signal(null),
  committed: signal(false),
  writing: signal(false),
  writeProgress: signal(null),
  writeFinished: signal(null),
  rollingBack: signal(null),
  rollbackFinished: signal(null),
  rollbackTarget: signal(undefined),
  pastRuns: signal(null),
  loadedRun: signal(null),
  loadRefusal: signal(null),
  start: vi.fn<SidecarService["start"]>(() => Promise.resolve()),
  restart: vi.fn<SidecarService["restart"]>(() => Promise.resolve()),
  listPlaylists: vi.fn<SidecarService["listPlaylists"]>(() => Promise.resolve()),
  extractPlaylist: vi.fn<SidecarService["extractPlaylist"]>(() => Promise.resolve()),
  setApiKey: vi.fn<SidecarService["setApiKey"]>(() => Promise.resolve()),
  startTagging: vi.fn<SidecarService["startTagging"]>(() => Promise.resolve()),
  cancelTagging: vi.fn<SidecarService["cancelTagging"]>(() => Promise.resolve()),
  resume: vi.fn<SidecarService["resume"]>(() => Promise.resolve(true)),
  discard: vi.fn<SidecarService["discard"]>(() => Promise.resolve()),
  dismissInterruptedRun: vi.fn<SidecarService["dismissInterruptedRun"]>(),
  openArbitration: vi.fn<SidecarService["openArbitration"]>(),
  chooseCandidate: vi.fn<SidecarService["chooseCandidate"]>(() => Promise.resolve()),
  refuseCandidates: vi.fn<SidecarService["refuseCandidates"]>(() => Promise.resolve()),
  showArbitrationSource: vi.fn<SidecarService["showArbitrationSource"]>(() => Promise.resolve()),
  previousArbitration: vi.fn<SidecarService["previousArbitration"]>(),
  nextArbitration: vi.fn<SidecarService["nextArbitration"]>(),
  resolveByUrl: vi.fn<SidecarService["resolveByUrl"]>(() => Promise.resolve()),
  commitRun: vi.fn<SidecarService["commitRun"]>(() => Promise.resolve()),
  retryWrite: vi.fn<SidecarService["retryWrite"]>(() => Promise.resolve()),
  rollback: vi.fn<SidecarService["rollback"]>(() => Promise.resolve()),
  loadRollbackTarget: vi.fn<SidecarService["loadRollbackTarget"]>(() => Promise.resolve()),
  loadCacheSize: vi.fn<SidecarService["loadCacheSize"]>(() => Promise.resolve()),
  clearCache: vi.fn<SidecarService["clearCache"]>(() => Promise.resolve()),
  listRuns: vi.fn<SidecarService["listRuns"]>(() => Promise.resolve()),
  loadRun: vi.fn<SidecarService["loadRun"]>(() => Promise.resolve()),
  prepareFeedback: vi.fn<SidecarService["prepareFeedback"]>(() => Promise.resolve()),
})

/**
 * `phase`, `filesBusy` et `writeFailureCount` suivent les signals de base, surcharges comprises,
 * avec les formules du service reel (`SidecarService.phase`, `TaggingRunStore.writeFailureCount`).
 * `errorFor` et `runAction` sont ceux du prototype reel : ils ne lisent que les accesseurs publics.
 */
export const sidecarStub = (overrides: SidecarStubOverrides = {}): SidecarStub => {
  const state = { ...defaults(), ...overrides }
  const phase = computed<SidecarPhase>(() => {
    if (state.rollingBack() !== null) {
      return "rollingBack"
    }
    if (state.writing()) {
      return "writing"
    }
    if (state.tagging()) {
      return "searching"
    }

    return state.extracting() ? "extracting" : "idle"
  })

  const stub: SidecarStub = {
    ...state,
    phase,
    filesBusy: computed(() => phase() === "writing" || phase() === "rollingBack"),
    writeFailureCount: computed(
      () => state.taggingTracks().filter((track) => track.state === "write_error").length,
    ),
    errorFor: (...commands) => SidecarService.prototype.errorFor.call(stub, ...commands),
    runAction: (folder) => SidecarService.prototype.runAction.call(stub, folder),
  }

  return stub
}
