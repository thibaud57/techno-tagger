import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { vi } from "vitest"

import { silenceConsoleError } from "../../../fixtures/console"
import {
  EMPTY_EXTRACTION,
  EXTRACTION_REQUEST,
  PLAYLISTS,
  playlistsListed,
} from "../../../fixtures/extraction"
import { FEEDBACK_READY } from "../../../fixtures/feedback"
import { PAST_RUN, TRACK_LOADED, runLoaded, runsListed } from "../../../fixtures/past-runs"
import { FOLDER_MISSING, INTERRUPTED, interruptedRun } from "../../../fixtures/resume"
import { DEFAULT_THRESHOLDS, LOG_FILE } from "../../../fixtures/settings"
import {
  RUN_ID,
  RUN_STARTED,
  TRACK_RESOLVED,
  arbitrationRequired,
  arbitrationUpdated,
  trackResolved,
} from "../../../fixtures/tagging"
import { TRACK_URL, resolvedByUrl, urlRecoveryError } from "../../../fixtures/url-recovery"
import {
  NETWORK_FINISHED,
  ROLLBACK_RUN,
  WRITE_FINISHED,
  commandError,
  phaseBusy,
  progressEvent,
  rollbackFinished,
  writeFinishedWithFailures,
} from "../../../fixtures/write"
import { PastRunsStore } from "../stores/past-runs.store"
import { BusyPhase, SidecarEvent, VersionEvent } from "./protocol"
import { SIDECAR_TRANSPORT, SidecarHandlers, SidecarTransport } from "./sidecar-transport"
import { type RunAction, type SidecarPhase, SidecarService } from "./sidecar.service"

/** Mock a la frontiere du transport : un vrai sidecar testerait Tauri et PyInstaller. */
class FakeTransport implements SidecarTransport {
  handlers: SidecarHandlers | null = null
  readonly sent: string[] = []
  startable = true
  writable = true
  starts = 0

  start(handlers: SidecarHandlers): Promise<boolean> {
    this.starts += 1
    if (!this.startable) {
      return Promise.resolve(false)
    }
    this.handlers = handlers

    return Promise.resolve(true)
  }

  send(line: string): Promise<void> {
    if (!this.writable) {
      return Promise.reject(new Error("broken pipe"))
    }
    this.sent.push(line)

    return Promise.resolve()
  }

  emit(payload: SidecarEvent): void {
    this.handlers?.onLine(JSON.stringify(payload))
  }

  emitRaw(line: string): void {
    this.handlers?.onLine(line)
  }
}

const BUSY_PHASES: readonly BusyPhase[] = ["extraction", "tagging", "write", "rollback"]

type LaunchCommand =
  "extract_playlist" | "start_tagging" | "resume_run" | "commit_run" | "retry_write" | "rollback"

const parseLine = (line: string): unknown => JSON.parse(line)
const commandOf = (line: string): string => (parseLine(line) as { command: string }).command

/** `version` complet : chaque test ne pose que le champ qu'il observe. */
const versionEvent = (overrides: Partial<VersionEvent> = {}): VersionEvent => ({
  event: "version",
  version: APP_VERSION,
  api_key_configured: false,
  default_thresholds: DEFAULT_THRESHOLDS,
  log_file: LOG_FILE,
  sentry_selftest: false,
  ...overrides,
})

describe("SidecarService", () => {
  let transport: FakeTransport
  let service: SidecarService

  beforeEach(() => {
    transport = new FakeTransport()
    TestBed.configureTestingModule({
      providers: [{ provide: SIDECAR_TRANSPORT, useValue: transport }],
    })
    service = TestBed.inject(SidecarService)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const sentOf = (command: string): unknown[] =>
    transport.sent.filter((line) => commandOf(line) === command).map(parseLine)
  const countOf = (command: string): number => sentOf(command).length

  /** Un run affiche, en recherche : le point de depart de la plupart des gestes qui suivent. */
  const searchingRun = async (): Promise<void> => {
    await service.start()
    await service.startTagging("C:/Sets")
    transport.emit(RUN_STARTED)
  }

  /** Recherche finie avec un morceau resolu : le seul run que le moteur accepte de confirmer. */
  const resolvedRun = async (): Promise<void> => {
    await searchingRun()
    transport.emit(TRACK_RESOLVED)
    transport.emit(NETWORK_FINISHED)
  }

  /** Run confirme dont l'ecriture a laisse un morceau en erreur. */
  const failedWriteRun = async (): Promise<void> => {
    await resolvedRun()
    await service.commitRun()
    transport.emit(trackResolved("a.mp3", { state: "write_error" }))
    transport.emit(writeFinishedWithFailures())
  }

  /** Run confirme et entierement ecrit. */
  const writtenRun = async (): Promise<void> => {
    await resolvedRun()
    await service.commitRun()
    transport.emit(WRITE_FINISHED)
  }

  /** File d'arbitrage ouverte sur ces morceaux, sans lancement de run. */
  const queueArbitrations = async (...trackIds: string[]): Promise<void> => {
    await service.start()
    transport.emit(RUN_STARTED)
    for (const trackId of trackIds) {
      transport.emit(arbitrationRequired(trackId))
    }
  }

  it("keeps the choices of the extraction it launched", async () => {
    await service.start()

    await service.extractPlaylist(EXTRACTION_REQUEST)

    expect(service.extractionRequest()).toEqual(EXTRACTION_REQUEST)
  })

  it("remembers the file whose playlists it lists", async () => {
    await service.start()

    await service.listPlaylists("C:/x.m3u8")

    expect(service.listedPlaylistPath()).toBe("C:/x.m3u8")
  })

  it("spawns the sidecar only once", async () => {
    await service.start()
    await service.start()

    expect(transport.starts).toBe(1)
  })

  it("requests the version before any other command", async () => {
    await service.start()

    expect(parseLine(transport.sent[0] ?? "")).toEqual({ command: "get_version" })
  })

  it("feeds the version from the received event", async () => {
    await service.start()

    transport.emit(versionEvent())

    expect(service.version()).toBe(APP_VERSION)
  })

  it("feeds the api key state from the version event", async () => {
    await service.start()

    transport.emit(versionEvent({ api_key_configured: true }))

    expect(service.apiKeyConfigured()).toBe(true)
  })

  it("feeds the default thresholds and the log file from the version event", async () => {
    await service.start()

    transport.emit(versionEvent())

    expect(service.defaultThresholds()).toEqual(DEFAULT_THRESHOLDS)
    expect(service.logFile()).toBe(LOG_FILE)
  })

  it("tells whether the engine asks for the self-test", async () => {
    await service.start()

    transport.emit(versionEvent({ sentry_selftest: true }))

    expect(service.sentrySelftest()).toBe(true)
  })

  it("forgets the log file at a restart", async () => {
    await service.start()
    transport.emit(versionEvent())

    await service.restart()

    expect(service.logFile()).toBeNull()
  })

  it("learns the log file again from the new engine", async () => {
    await service.start()
    transport.emit(versionEvent())
    await service.restart()

    transport.emit(versionEvent())

    expect(service.logFile()).toBe(LOG_FILE)
  })

  it("feeds the cache size from a measure", async () => {
    await service.start()

    transport.emit({ event: "cache_size", size_bytes: 4096 })

    expect(service.cacheSize()).toBe(4096)
  })

  it("marks the cache as clearing once the clearing is sent", async () => {
    await service.start()

    await service.clearCache()

    expect(service.cacheClearing()).toBe(true)
  })

  it("stops clearing the cache when the engine answers", async () => {
    await service.start()
    await service.clearCache()

    transport.emit({ event: "cache_cleared", freed_bytes: 4000, size_bytes: 0 })

    expect(service.cacheClearing()).toBe(false)
  })

  it("stops clearing the cache when the engine refuses it", async () => {
    await service.start()
    await service.clearCache()

    transport.emit(commandError("clear_cache", "run_not_written"))

    expect(service.cacheClearing()).toBe(false)
  })

  it("sends a single clearing while one is in flight", async () => {
    await service.start()
    await service.clearCache()

    await service.clearCache()

    expect(countOf("clear_cache")).toBe(1)
  })

  it("feeds the cache size and the last clearing from a clearing", async () => {
    await service.start()
    transport.emit({ event: "cache_size", size_bytes: 4096 })

    transport.emit({ event: "cache_cleared", freed_bytes: 4000, size_bytes: 96 })

    expect(service.cacheSize()).toBe(96)
    expect(service.cacheCleared()).toEqual({
      event: "cache_cleared",
      freed_bytes: 4000,
      size_bytes: 96,
    })
  })

  it.each([
    { label: "matching versions", version: APP_VERSION, mismatch: null, ready: true },
    {
      label: "mismatched versions",
      version: "0.0.1-old",
      mismatch: { ui: APP_VERSION, sidecar: "0.0.1-old" },
      ready: false,
    },
  ] as const)("reports the mismatch and the readiness for $label", async (row) => {
    await service.start()

    transport.emit(versionEvent({ version: row.version }))

    expect(service.versionMismatch()).toEqual(row.mismatch)
    expect(service.ready()).toBe(row.ready)
  })

  it("is not ready before the version is received", async () => {
    await service.start()

    expect(service.ready()).toBe(false)
  })

  it("stays unavailable without throwing when the spawn fails", async () => {
    transport.startable = false

    await service.start()

    expect(service.available()).toBe(false)
  })

  it("is undecided until the launch has answered", () => {
    expect(service.available()).toBeNull()
  })

  it("relaunches on restart after a failed start", async () => {
    transport.startable = false
    await service.start()
    transport.startable = true

    await service.restart()

    expect(transport.starts).toBe(2)
    expect(service.available()).toBe(true)
    expect(commandOf(transport.sent[0] ?? "")).toBe("get_version")
  })

  it("reports unavailability when a command is sent without a sidecar", async () => {
    transport.startable = false

    await service.start()
    await service.listPlaylists("C:/playlists.m3u8")

    // Seule erreur que l'interface fabrique : elle nomme quand meme sa commande, que
    // l'ecran qui l'a emise lise son echec au meme endroit que celles du protocole.
    expect(service.lastError()).toEqual({
      event: "error",
      code: "sidecar_unavailable",
      params: {},
      message: "sidecar unavailable",
      command: "list_playlists",
    })
    expect(transport.sent).toEqual([])
  })

  it("reports unavailability when the write fails", async () => {
    const spy = silenceConsoleError()
    await service.start()
    transport.writable = false

    await service.extractPlaylist(EXTRACTION_REQUEST)

    expect(service.available()).toBe(false)
    expect(service.extracting()).toBe(false)
    expect(service.lastError()?.code).toBe("sidecar_unavailable")
    expect(spy).toHaveBeenCalled()
  })

  it("ends the run when the sidecar terminates", async () => {
    await service.start()
    await service.extractPlaylist(EXTRACTION_REQUEST)
    transport.emit(progressEvent("extraction", 2, 5))

    transport.handlers?.onTerminated()

    expect(service.available()).toBe(false)
    expect(service.extracting()).toBe(false)
    expect(service.progress()).toBeNull()
  })

  it("marks an extraction as running once its command is sent", async () => {
    await service.start()
    transport.emit(versionEvent())

    await service.extractPlaylist(EXTRACTION_REQUEST)

    expect(service.extracting()).toBe(true)
    expect(service.ready()).toBe(false)
  })

  it("clears the previous error when a command is sent", async () => {
    await service.start()
    transport.emit(commandError("list_playlists", "playlist_file_unreadable"))

    await service.listPlaylists("C:/x.m3u8")

    expect(service.lastError()).toBeNull()
  })

  it("forgets the previous listing when another file is listed", async () => {
    await service.start()
    transport.emit(playlistsListed())

    await service.listPlaylists("C:/x.m3u8")

    expect(service.playlists()).toEqual([])
    expect(service.playlistFormat()).toBeNull()
  })

  it("feeds the received playlists", async () => {
    await service.start()

    transport.emit(playlistsListed())

    expect(service.playlists()).toEqual(PLAYLISTS)
    expect(service.playlistFormat()).toBe("vlc_dump")
  })

  it("feeds the received progress", async () => {
    await service.start()

    transport.emit(progressEvent("extraction", 2, 5))

    expect(service.progress()).toEqual(progressEvent("extraction", 2, 5))
  })

  it("feeds the extraction result and ends the extraction", async () => {
    await service.start()
    await service.extractPlaylist(EXTRACTION_REQUEST)

    transport.emit({ ...EMPTY_EXTRACTION, extracted: ["a.mp3"] })

    expect(service.extraction()?.extracted).toEqual(["a.mp3"])
    expect(service.extracting()).toBe(false)
  })

  it("keeps the last progress once the result is in", async () => {
    await service.start()
    await service.extractPlaylist(EXTRACTION_REQUEST)
    transport.emit(progressEvent("extraction", 5, 5))

    transport.emit(EMPTY_EXTRACTION)

    expect(service.progress()?.processed).toBe(5)
  })

  it("clears the previous progress when a new extraction starts", async () => {
    await service.start()
    transport.emit(progressEvent("extraction", 5, 5))

    await service.extractPlaylist(EXTRACTION_REQUEST)

    expect(service.progress()).toBeNull()
  })

  it("feeds the error without interrupting the stream", async () => {
    await service.start()

    transport.emit(commandError("list_playlists", "playlist_not_found"))
    transport.emit(progressEvent("extraction", 5, 5))

    expect(service.lastError()?.code).toBe("playlist_not_found")
    expect(service.progress()?.processed).toBe(5)
  })

  it("ends the run on an error", async () => {
    await service.start()
    await service.extractPlaylist(EXTRACTION_REQUEST)
    transport.emit(progressEvent("extraction", 5, 5))

    transport.emit(commandError("extract_playlist", "report_write_failed"))

    expect(service.progress()).toBeNull()
    expect(service.extracting()).toBe(false)
  })

  it("ignores a line that is not JSON", async () => {
    const spy = silenceConsoleError()
    await service.start()

    transport.emitRaw("pas du json")
    transport.emit(versionEvent())

    expect(service.version()).toBe(APP_VERSION)
    expect(spy).toHaveBeenCalled()
  })

  it("ignores an event of unknown type", async () => {
    const spy = silenceConsoleError()
    await service.start()

    transport.emitRaw(JSON.stringify({ event: "unheard_of" }))

    expect(service.version()).toBeNull()
    expect(service.lastError()).toBeNull()
    expect(spy).toHaveBeenCalled()
  })

  it("never reads a stderr line as an event", async () => {
    silenceConsoleError()
    await service.start()

    transport.handlers?.onStderr(JSON.stringify(versionEvent({ version: "9.9.9" })))

    expect(service.version()).toBeNull()
  })

  it.each<[string, (target: SidecarService) => Promise<void>, unknown]>([
    [
      "the api key",
      (target) => target.setApiKey("k3y-t0k3n"),
      { command: "set_api_key", api_key: "k3y-t0k3n" },
    ],
    [
      "a tagging start without thresholds",
      (target) => target.startTagging("C:/Sets"),
      { command: "start_tagging", folder: "C:/Sets" },
    ],
    [
      "a tagging start with the thresholds the settings impose",
      (target) => target.startTagging("C:/Sets", { floor: 75, ceiling: 95 }),
      {
        command: "start_tagging",
        folder: "C:/Sets",
        thresholds: { floor: 75, ceiling: 95 },
      },
    ],
    ["a cache size request", (target) => target.loadCacheSize(), { command: "get_cache_size" }],
    ["a cache clearing", (target) => target.clearCache(), { command: "clear_cache" }],
    [
      "a feedback preparation",
      (target) => target.prepareFeedback(RUN_ID),
      { command: "prepare_feedback", run_id: RUN_ID },
    ],
  ])("sends %s as its command", async (_command, send, expected) => {
    await service.start()

    await send(service)

    expect(parseLine(transport.sent.at(-1) ?? "")).toEqual(expected)
  })

  it("cancels a running run and stops it locally", async () => {
    await service.start()
    await service.startTagging("C:/Sets")

    await service.cancelTagging()

    expect(parseLine(transport.sent.at(-1) ?? "")).toEqual({ command: "cancel_run" })
    expect(service.tagging()).toBe(false)
  })

  it("sends nothing when there is no run to cancel", async () => {
    await service.start()
    const before = transport.sent.length

    await service.cancelTagging()

    expect(transport.sent.length).toBe(before)
  })

  it("replays a whole tagging run and reports every track", async () => {
    await service.start()
    await service.startTagging("C:/Sets")

    transport.emit(RUN_STARTED)
    transport.emit(progressEvent("tagging", 1, 1))
    transport.emit(TRACK_RESOLVED)
    transport.emit(NETWORK_FINISHED)

    expect(service.taggingTracks()[0]?.state).toBe("resolved")
    expect(service.taggingProgress()).toEqual({ processed: 1, total: 1 })
    expect(service.taggingFinished()?.resolved).toBe(1)
    expect(service.tagging()).toBe(false)
    expect(service.progress()).toBeNull()
  })

  it("keeps the extraction progress out of the tagging run", async () => {
    await service.start()
    await service.startTagging("C:/Sets")

    transport.emit(progressEvent("extraction", 3, 10))

    expect(service.progress()?.processed).toBe(3)
    expect(service.taggingProgress()).toBeNull()
  })

  it("leaves the tagging run alone when a write phase finishes", async () => {
    await searchingRun()

    transport.emit({ ...NETWORK_FINISHED, phase: "write" })

    expect(service.taggingFinished()).toBeNull()
    expect(service.tagging()).toBe(true)
  })

  it("stops the tagging run on an error", async () => {
    await searchingRun()
    transport.emit(TRACK_RESOLVED)

    transport.emit(commandError("start_tagging", "api_key_rejected"))

    expect(service.tagging()).toBe(false)
    expect(service.lastError()?.code).toBe("api_key_rejected")
    expect(service.taggingTracks()[0]?.state).toBe("resolved")
  })

  it.each([
    {
      // `start_tagging` tourne en tache de fond : la boucle du sidecar a lu et refuse une
      // commande emise depuis un autre onglet pendant que le run continue.
      case: "another command fails",
      error: commandError("set_api_key", "api_key_not_stored"),
    },
    {
      // Les deux phases longues tournent en parallele : l'echec de l'une ne dit rien de
      // l'autre et l'ecran du tagging ne doit pas perdre son run.
      case: "an extraction fails",
      error: commandError("extract_playlist", "report_write_failed"),
    },
    {
      // Releve par /verify le 2026-09-24 : le refus porte `start_tagging`, comme l'echec
      // qui clot un run, mais ce code-la dit justement que le premier tourne toujours.
      case: "a second launch is refused",
      error: phaseBusy("start_tagging", "tagging"),
    },
  ])("keeps the run going when $case", async ({ error }) => {
    await searchingRun()

    transport.emit(error)

    expect(service.tagging()).toBe(true)
    expect(service.taggingTracks().length).toBeGreaterThan(0)
    expect(service.lastError()).toEqual(error)
  })

  it("refuses to open a second run over a running one", async () => {
    await searchingRun()
    const sent = transport.sent.length

    await service.startTagging("C:/Autre")

    // Releve par /verify le 2026-09-24 : `reset()` vidait la liste du run en cours,
    // que le sidecar laisse pourtant tourner en refusant la seconde commande.
    expect(transport.sent.length).toBe(sent)
    expect(service.taggingTracks().length).toBeGreaterThan(0)
    expect(service.tagging()).toBe(true)
  })

  it("refuses to open a second extraction over a running one", async () => {
    await service.start()
    await service.extractPlaylist(EXTRACTION_REQUEST)
    const sent = transport.sent.length

    await service.extractPlaylist(EXTRACTION_REQUEST)

    expect(transport.sent.length).toBe(sent)
    expect(service.extracting()).toBe(true)
  })

  it("keeps the extraction going when a second one is refused", async () => {
    await service.start()
    await service.extractPlaylist(EXTRACTION_REQUEST)
    transport.emit(progressEvent("extraction", 1, 5))

    transport.emit(phaseBusy("extract_playlist", "extraction"))

    expect(service.extracting()).toBe(true)
    expect(service.progress()).not.toBeNull()
  })

  it("writes a command as a single newline-terminated line", async () => {
    await service.start()

    await service.extractPlaylist(EXTRACTION_REQUEST)

    const line = transport.sent.at(-1) ?? ""
    expect(line.endsWith("\n")).toBe(true)
    expect(commandOf(line)).toBe("extract_playlist")
  })

  it.each<[string, (target: SidecarService) => Promise<void>, unknown]>([
    [
      "choice",
      (target) => target.chooseCandidate("a.mp3", "bandcamp", 1),
      { command: "resolve_arbitration", track_id: "a.mp3", source: "bandcamp", candidate: 1 },
    ],
    [
      "refusal",
      (target) => target.refuseCandidates("a.mp3", "beatport"),
      { command: "resolve_arbitration", track_id: "a.mp3", source: "beatport", candidate: null },
    ],
    [
      "switch",
      (target) => target.showArbitrationSource("a.mp3", "beatport"),
      { command: "switch_arbitration_source", track_id: "a.mp3", source: "beatport" },
    ],
  ])("sends a %s with its command", async (_gesture, gesture, expected) => {
    await queueArbitrations("a.mp3")

    await gesture(service)

    expect(parseLine(transport.sent.at(-1) ?? "")).toEqual(expected)
  })

  it("ignores a second gesture on a track awaiting an answer", async () => {
    await queueArbitrations("a.mp3")
    await service.refuseCandidates("a.mp3", "beatport")
    const before = transport.sent.length

    await service.refuseCandidates("a.mp3", "beatport")

    expect(transport.sent.length).toBe(before)
    expect(service.arbitrationBusy()).toBe(true)
  })

  it("routes the arbitration events to the queue", async () => {
    await queueArbitrations("a.mp3", "b.mp3")

    transport.emit(arbitrationUpdated("b.mp3"))
    transport.emit(TRACK_RESOLVED)

    expect(service.arbitrations().map((entry) => entry.track_id)).toEqual(["b.mp3"])
    expect(service.currentArbitration()?.source).toBe("bandcamp")
    expect(service.taggingTracks()[0]?.state).toBe("resolved")
  })

  it("releases a gesture the sidecar refuses", async () => {
    await queueArbitrations("a.mp3")
    await service.chooseCandidate("a.mp3", "beatport", 0)
    const refusal = commandError("resolve_arbitration", "arbitration_busy", { track_id: "a.mp3" })

    transport.emit(refusal)

    expect(service.arbitrationBusy()).toBe(false)
    expect(service.errorFor("resolve_arbitration")()).toEqual(refusal)
  })

  it("keeps a gesture waiting when the error names no track", async () => {
    await queueArbitrations("a.mp3")
    await service.chooseCandidate("a.mp3", "beatport", 0)

    transport.emit(commandError("resolve_arbitration", "arbitration_busy"))

    expect(service.arbitrationBusy()).toBe(true)
  })

  it("leaves the queue alone on the error of another command", async () => {
    await queueArbitrations("a.mp3")

    transport.emit(commandError("start_tagging", "arbitration_not_pending", { track_id: "a.mp3" }))

    expect(service.arbitrationCount()).toBe(1)
  })

  it.each<[string, (target: SidecarService, fake: FakeTransport) => Promise<void>]>([
    ["a new run starts", (target) => target.startTagging("C:/Sets")],
    [
      "the process dies",
      (_target, fake) => {
        fake.handlers?.onTerminated()

        return Promise.resolve()
      },
    ],
  ])("clears the queue when %s", async (_when, end) => {
    await queueArbitrations("a.mp3")

    await end(service, transport)

    expect(service.arbitrationCount()).toBe(0)
  })

  it("keeps the queue after a cancellation", async () => {
    await service.start()
    await service.startTagging("C:/Sets")
    transport.emit(RUN_STARTED)
    transport.emit(arbitrationRequired("a.mp3"))

    await service.cancelTagging()

    expect(service.arbitrationCount()).toBe(1)
  })

  describe("url recovery", () => {
    const openPhase = async (): Promise<void> => {
      await service.start()
      transport.emit(RUN_STARTED)
      transport.emit(progressEvent("url_recovery", 0, 2))
    }

    it("sends a url recovery command with its track and its url", async () => {
      await openPhase()

      await service.resolveByUrl("a.mp3", TRACK_URL)

      expect(parseLine(transport.sent.at(-1) ?? "")).toEqual({
        command: "resolve_by_url",
        track_id: "a.mp3",
        url: TRACK_URL,
      })
      expect(service.urlRecoveryBusy().has("a.mp3")).toBe(true)
    })

    it("ignores a second gesture while the first one waits", async () => {
      await openPhase()
      await service.resolveByUrl("a.mp3", TRACK_URL)
      const sent = transport.sent.length

      await service.resolveByUrl("a.mp3", "https://www.beatport.com/track/your-mind/99000202")

      expect(transport.sent).toHaveLength(sent)
    })

    it("ignores an empty url", async () => {
      await openPhase()
      const sent = transport.sent.length

      await service.resolveByUrl("a.mp3", "")

      expect(transport.sent).toHaveLength(sent)
      expect(service.urlRecoveryBusy().has("a.mp3")).toBe(false)
    })

    it("keeps the url recovery phase closed on the tagging progress", async () => {
      await service.start()
      transport.emit(RUN_STARTED)

      transport.emit(progressEvent("tagging", 1, 2))

      expect(service.urlRecoveryProgress()).toBeNull()
      expect(service.taggingProgress()).toEqual({ processed: 1, total: 2 })
    })

    it("routes the url recovery progress to its phase only", async () => {
      await service.start()
      transport.emit(RUN_STARTED)
      transport.emit(progressEvent("tagging", 1, 2))

      transport.emit(progressEvent("url_recovery", 0, 2))

      expect(service.urlRecoveryProgress()).toEqual({ processed: 0, total: 2 })
      expect(service.taggingProgress()).toEqual({ processed: 1, total: 2 })
    })

    it("releases a gesture on its resolution", async () => {
      await openPhase()
      await service.resolveByUrl("a.mp3", TRACK_URL)

      transport.emit(resolvedByUrl("a.mp3"))

      expect(service.urlRecoveryBusy().has("a.mp3")).toBe(false)
      expect(service.taggingTracks()[0]?.resolution).toBe("url")
    })

    it("attaches a url recovery error to its track", async () => {
      await openPhase()
      await service.resolveByUrl("a.mp3", TRACK_URL)
      const error = urlRecoveryError("a.mp3")

      transport.emit(error)

      expect(service.urlRecoveryBusy().has("a.mp3")).toBe(false)
      expect(service.urlRecoveryErrors().get("a.mp3")).toEqual(error)
      expect(service.urlRecoveryErrors().has("b.mp3")).toBe(false)
      expect(service.errorFor("resolve_by_url")()).toEqual(error)
    })

    it("keeps a url error without track out of the phase", async () => {
      await openPhase()
      await service.resolveByUrl("a.mp3", TRACK_URL)
      const malformed = { ...urlRecoveryError("a.mp3", "malformed_command"), params: {} }

      transport.emit(malformed)

      expect(service.urlRecoveryErrors().size).toBe(0)
      expect(service.urlRecoveryBusy().has("a.mp3")).toBe(true)
      expect(service.lastError()).toEqual(malformed)
    })

    it("lists the unresolved tracks and those resolved by url", async () => {
      await service.start()
      transport.emit({
        ...RUN_STARTED,
        tracks: [
          ...RUN_STARTED.tracks,
          {
            track_id: "c.mp3",
            file_name: "c.mp3",
            artist: "Sara Landry",
            title: "The Void",
            tags_before: null,
          },
          {
            track_id: "d.mp3",
            file_name: "d.mp3",
            artist: "Kasia",
            title: "Tarantula",
            tags_before: null,
          },
        ],
      })
      transport.emit(TRACK_RESOLVED)
      transport.emit(
        trackResolved("b.mp3", {
          state: "unresolved",
          resolution: "none",
          failure_reason: "no_result",
          source: null,
          after: null,
          scores: null,
          artwork_path: null,
        }),
      )
      transport.emit(resolvedByUrl("c.mp3"))
      transport.emit(arbitrationRequired("d.mp3"))

      const listed = service.recoverableTracks()

      expect(listed.map((track) => track.trackId)).toEqual(["b.mp3", "c.mp3"])
    })

    it.each<[string, () => Promise<void>]>([
      [
        "a new run starts",
        async () => {
          await service.startTagging("C:/music")
        },
      ],
      [
        "the process ends",
        () => {
          transport.handlers?.onTerminated()

          return Promise.resolve()
        },
      ],
    ])("closes the phase when %s", async (_moment, close) => {
      await openPhase()
      await service.resolveByUrl("a.mp3", TRACK_URL)
      transport.emit(urlRecoveryError("b.mp3"))

      await close()

      expect(service.urlRecoveryProgress()).toBeNull()
      expect(service.urlRecoveryBusy().size).toBe(0)
      expect(service.urlRecoveryErrors().size).toBe(0)
    })
  })

  describe("interrupted run", () => {
    const VERSION = versionEvent({ api_key_configured: true })
    const askedCount = (): number => countOf("get_interrupted_run")

    it("asks for an interrupted run once the engine version matches", async () => {
      await service.start()

      transport.emit(VERSION)

      expect(transport.sent.map(commandOf)).toEqual(["get_version", "get_interrupted_run"])
    })

    it("does not ask for an interrupted run from a mismatched engine", async () => {
      await service.start()

      transport.emit({ ...VERSION, version: "0.0.0-other" })

      expect(askedCount()).toBe(0)
    })

    it("asks again after a restart", async () => {
      await service.start()
      transport.emit(VERSION)

      await service.restart()
      transport.emit(VERSION)

      expect(askedCount()).toBe(2)
    })

    it("does not ask again when the version is echoed after set_api_key", async () => {
      await service.start()
      transport.emit(VERSION)

      await service.setApiKey("key")
      transport.emit(VERSION)

      expect(askedCount()).toBe(1)
    })

    it("asks again once the api key is saved", async () => {
      await service.start()
      transport.emit({ ...VERSION, api_key_configured: false })

      transport.emit(VERSION)

      expect(askedCount()).toBe(2)
    })

    it("drops the announced run at a restart", async () => {
      await service.start()
      transport.emit(interruptedRun(INTERRUPTED))

      await service.restart()

      expect(service.interruptedRun()).toBeNull()
    })

    it("feeds the announced run", async () => {
      await service.start()

      transport.emit(interruptedRun(INTERRUPTED))

      expect(service.interruptedRun()).toEqual(INTERRUPTED)
    })

    it("announces the run again after a restart", async () => {
      await service.start()
      transport.emit(interruptedRun(INTERRUPTED))
      await service.restart()

      transport.emit(interruptedRun(INTERRUPTED))

      expect(service.interruptedRun()).toEqual(INTERRUPTED)
    })

    it.each<[string, (target: SidecarService) => Promise<void>]>([
      ["resume_run", (target) => target.resume(INTERRUPTED).then(() => undefined)],
      ["discard_run", (target) => target.discard(INTERRUPTED.run_id)],
    ])("sends %s only once and closes the prompt", async (command, gesture) => {
      await service.start()
      transport.emit(interruptedRun(INTERRUPTED))

      await gesture(service)
      await gesture(service)

      expect(sentOf(command)).toEqual([{ command, run_id: INTERRUPTED.run_id }])
      expect(service.interruptedRun()).toBeNull()
    })

    it("shows the resumed run as launched on its folder", async () => {
      await service.start()
      transport.emit(interruptedRun(INTERRUPTED))

      await service.resume(INTERRUPTED)

      expect(service.requestedFolder()).toBe(INTERRUPTED.folder)
      expect(service.tagging()).toBe(true)
    })

    it("fills the run from the events the engine replays", async () => {
      await service.start()
      transport.emit(interruptedRun(INTERRUPTED))
      await service.resume(INTERRUPTED)

      transport.emit(RUN_STARTED)
      transport.emit(TRACK_RESOLVED)
      transport.emit(arbitrationRequired("b.mp3"))

      expect(service.taggingTracks().map((track) => track.state)).toEqual(["resolved", null])
      expect(service.arbitrationCount()).toBe(1)
    })

    it("closes the prompt at the gesture", async () => {
      await service.start()
      transport.emit(interruptedRun(INTERRUPTED))

      await service.discard(INTERRUPTED.run_id)

      expect(parseLine(transport.sent.at(-1) ?? "")).toEqual({
        command: "discard_run",
        run_id: RUN_ID,
      })
      expect(service.interruptedRun()).toBeNull()
    })

    it("prompts the next run once the previous one is discarded", async () => {
      await service.start()
      transport.emit(interruptedRun(INTERRUPTED))
      await service.discard(INTERRUPTED.run_id)

      transport.emit(interruptedRun({ ...INTERRUPTED, run_id: "1b2c3d" }))

      expect(service.interruptedRun()?.run_id).toBe("1b2c3d")
    })

    it.each([
      ["resume_run", "run_not_found"],
      ["resume_run", "tagging_folder_unreadable"],
      ["discard_run", "run_not_found"],
    ] as const)("asks again when %s is refused with %s", async (command, code) => {
      await service.start()
      transport.emit(interruptedRun(INTERRUPTED))

      transport.emit(commandError(command, code))

      expect(askedCount()).toBe(1)
    })

    it("keeps the refusal displayed when it asks again", async () => {
      await service.start()
      transport.emit(interruptedRun(INTERRUPTED))

      transport.emit(commandError("resume_run", "run_not_found"))

      expect(service.errorFor("resume_run")()?.code).toBe("run_not_found")
    })

    it.each([
      ["a busy phase refuses resume_run", phaseBusy("resume_run", "write")],
      ["a busy phase refuses discard_run", phaseBusy("discard_run", "write")],
      ["the api key is missing for resume_run", commandError("resume_run", "api_key_missing")],
      ["another command is refused", commandError("start_tagging", "tagging_folder_unreadable")],
    ])("does not ask again when %s", async (_name, error) => {
      await service.start()
      transport.emit(interruptedRun(INTERRUPTED))

      transport.emit(error)

      expect(askedCount()).toBe(0)
    })

    it("closes the prompt without sending anything when put off", async () => {
      await service.start()
      transport.emit(interruptedRun(FOLDER_MISSING))
      const sent = transport.sent.length

      service.dismissInterruptedRun()

      expect(service.interruptedRun()).toBeNull()
      expect(transport.sent).toHaveLength(sent)
    })
  })

  describe("past runs", () => {
    it("feeds the past runs from the listing", async () => {
      await service.start()

      transport.emit(runsListed(PAST_RUN))

      expect(service.pastRuns()).toEqual([PAST_RUN])
    })

    it("asks for a past run and marks it loading", async () => {
      await service.start()

      await service.loadRun(PAST_RUN.run_id)

      expect(parseLine(transport.sent.at(-1) ?? "")).toEqual({
        command: "load_run",
        run_id: PAST_RUN.run_id,
      })
      expect(TestBed.inject(PastRunsStore).loading()).toBe(PAST_RUN.run_id)
    })

    it("loads a past run from its events", async () => {
      await service.start()
      await service.loadRun(PAST_RUN.run_id)

      transport.emit(runLoaded(TRACK_LOADED))

      expect(service.loadedRun()?.runId).toBe(PAST_RUN.run_id)
      expect(TestBed.inject(PastRunsStore).loading()).toBeNull()
    })

    it("asks for a run once while it loads", async () => {
      await service.start()

      await service.loadRun(PAST_RUN.run_id)
      await service.loadRun(PAST_RUN.run_id)

      expect(countOf("load_run")).toBe(1)
    })

    it.each([
      [
        "the run is refused",
        "000000",
        commandError("load_run", "run_not_found", { run_id: "000000" }),
        "run_not_found",
      ],
      [
        "a running phase refuses the run",
        PAST_RUN.run_id,
        phaseBusy("load_run", "tagging"),
        "phase_busy",
      ],
    ])("ends the loading when %s", async (_case, runId, refusal, code) => {
      await service.start()
      await service.loadRun(runId)

      transport.emit(refusal)

      expect(TestBed.inject(PastRunsStore).loading()).toBeNull()
      expect(service.loadRefusal()?.error.code).toBe(code)
    })

    it("keeps the refusal when another command is sent", async () => {
      await service.start()
      await service.loadRun("000000")
      transport.emit(commandError("load_run", "run_not_found", { run_id: "000000" }))

      await service.listRuns()

      expect(service.loadRefusal()?.runId).toBe("000000")
    })

    it("ends the loading when the engine stops during it", async () => {
      await service.start()
      await service.loadRun(PAST_RUN.run_id)

      transport.handlers?.onTerminated()

      expect(TestBed.inject(PastRunsStore).loading()).toBeNull()
      expect(service.loadRefusal()).toBeNull()
    })

    it("lists the runs again once a write phase ends", async () => {
      await service.start()

      transport.emit(WRITE_FINISHED)

      expect(transport.sent.map(commandOf)).toContain("list_runs")
    })

    it("sends nothing and keeps the displayed run when asked without an engine", async () => {
      await searchingRun()
      transport.handlers?.onTerminated()
      const sent = transport.sent.length

      await service.listRuns()
      await service.loadRun(PAST_RUN.run_id)

      expect(transport.sent).toHaveLength(sent)
      expect(TestBed.inject(PastRunsStore).loading()).toBeNull()
      expect(service.errorFor("list_runs", "load_run")()).toBeNull()
      expect(service.taggingTracks()).toHaveLength(2)
    })
  })

  describe("feedback", () => {
    it("marks the run as pending until its feedback is ready", async () => {
      await service.start()

      await service.prepareFeedback(RUN_ID)
      const pending = service.feedbackPending()
      transport.emit(FEEDBACK_READY)

      expect(pending).toBe(RUN_ID)
      expect(service.feedbackPending()).toBeNull()
      expect(service.feedbackReady()).toEqual(FEEDBACK_READY)
    })

    it("sends nothing and leaves the displayed run alone when the engine is not up", async () => {
      await service.prepareFeedback(RUN_ID)

      expect(transport.sent).toEqual([])
      expect(service.lastError()).toBeNull()
      expect(service.feedbackPending()).toBeNull()
    })

    it("asks once while the feedback of a run is being prepared", async () => {
      await service.start()

      await service.prepareFeedback(RUN_ID)
      await service.prepareFeedback(RUN_ID)

      const sent = transport.sent.filter((line) => commandOf(line) === "prepare_feedback")
      expect(sent).toHaveLength(1)
    })

    it("ends the wait when the preparation is refused", async () => {
      await service.start()
      await service.prepareFeedback(RUN_ID)

      transport.emit(commandError("prepare_feedback", "run_not_found", { run_id: RUN_ID }))

      expect(service.feedbackPending()).toBeNull()
      expect(service.errorFor("prepare_feedback")()?.code).toBe("run_not_found")
    })

    it("keeps waiting for the asked run when another run answers", async () => {
      await service.start()
      await service.prepareFeedback("b4d2e0")

      transport.emit(FEEDBACK_READY)

      expect(service.feedbackPending()).toBe("b4d2e0")
      expect(service.feedbackReady()).toEqual(FEEDBACK_READY)
    })

    it("keeps waiting for the asked run when another run is refused", async () => {
      await service.start()
      await service.prepareFeedback("b4d2e0")

      transport.emit(commandError("prepare_feedback", "run_not_found", { run_id: RUN_ID }))

      expect(service.feedbackPending()).toBe("b4d2e0")
    })

    it("keeps waiting when another command fails", async () => {
      await service.start()
      await service.prepareFeedback(RUN_ID)

      transport.emit(commandError("clear_cache", "run_not_written"))

      expect(service.feedbackPending()).toBe(RUN_ID)
    })

    it("ends the wait when the engine stops during it", async () => {
      await service.start()
      await service.prepareFeedback(RUN_ID)

      transport.handlers?.onTerminated()

      expect(service.feedbackPending()).toBeNull()
    })
  })

  describe("write phase", () => {
    it("sends the confirmation of the run and marks the write as running", async () => {
      await resolvedRun()

      await service.commitRun()

      expect(sentOf("commit_run")).toEqual([{ command: "commit_run", run_id: RUN_ID }])
      expect(service.writing()).toBe(true)
    })

    it("replays a whole write", async () => {
      await resolvedRun()
      await service.commitRun()

      transport.emit(progressEvent("write", 1, 1))
      transport.emit(trackResolved("a.mp3", { state: "written" }))
      transport.emit(WRITE_FINISHED)

      expect(service.writing()).toBe(false)
      expect(service.committed()).toBe(true)
      expect(service.writeProgress()).toEqual({ processed: 1, total: 1 })
      expect(service.writeFinished()?.written).toBe(1)
      expect(service.taggingTracks()[0]?.state).toBe("written")
    })

    it("asks for the rollback target again once the write is over", async () => {
      await resolvedRun()
      await service.commitRun()

      transport.emit(WRITE_FINISHED)

      expect(countOf("get_rollback_target")).toBe(1)
    })

    it("lets the run be confirmed again when the dump cannot be written", async () => {
      await resolvedRun()
      await service.commitRun()

      transport.emit(commandError("commit_run", "tag_dump_write_failed"))

      expect(service.writing()).toBe(false)
      expect(service.committed()).toBe(false)
      expect(service.errorFor("commit_run")()?.code).toBe("tag_dump_write_failed")
    })

    it("sends the retry of the confirmed run and marks the write as running", async () => {
      await failedWriteRun()

      await service.retryWrite()

      expect(sentOf("retry_write")).toEqual([{ command: "retry_write", run_id: RUN_ID }])
      expect(service.writing()).toBe(true)
    })

    it("ends the retry when the write finishes, the run staying confirmed", async () => {
      await failedWriteRun()
      await service.retryWrite()

      transport.emit(WRITE_FINISHED)

      expect(service.writing()).toBe(false)
      expect(service.committed()).toBe(true)
    })

    it("keeps writing when a retry is refused because a write is already running", async () => {
      await failedWriteRun()
      await service.retryWrite()

      transport.emit(phaseBusy("retry_write", "write"))

      expect(service.writing()).toBe(true)
      expect(service.committed()).toBe(true)
    })

    it("stops writing but keeps the confirmation when a retry is refused", async () => {
      await failedWriteRun()
      await service.retryWrite()

      transport.emit(commandError("retry_write", "write_not_open"))

      expect(service.writing()).toBe(false)
      expect(service.committed()).toBe(true)
    })

    it("sends a single commit for a double click", async () => {
      await resolvedRun()

      await service.commitRun()
      await service.commitRun()

      expect(countOf("commit_run")).toBe(1)
    })

    it("keeps the run confirmed when a second commit follows a finished write", async () => {
      await resolvedRun()
      await service.commitRun()
      transport.emit(progressEvent("write", 1, 1))
      transport.emit(WRITE_FINISHED)

      await service.commitRun()

      expect(countOf("commit_run")).toBe(1)
      expect(service.committed()).toBe(true)
      expect(service.writeProgress()).toEqual({ processed: 1, total: 1 })
    })

    it("sends nothing and keeps the displayed run when asked for the target without an engine", async () => {
      await resolvedRun()
      transport.handlers?.onTerminated()
      const sent = transport.sent.length

      await service.loadRollbackTarget()

      expect(transport.sent).toHaveLength(sent)
      expect(service.errorFor("get_rollback_target")()).toBeNull()
      expect(service.taggingTracks()).toHaveLength(2)
    })

    it.each([
      {
        case: "files are being written",
        // `running` est faux : seule la garde de l'ecriture protege le lancement.
        busy: async () => {
          await resolvedRun()
          await service.commitRun()
        },
      },
      {
        case: "a rollback runs",
        busy: async () => {
          await resolvedRun()
          await service.rollback(RUN_ID)
        },
      },
    ])("ignores a launch while $case", async ({ busy }) => {
      await busy()

      await service.startTagging("C:/Other")

      expect(countOf("start_tagging")).toBe(1)
      expect(service.taggingTracks()).toHaveLength(2)
      expect(service.filesBusy()).toBe(true)
    })

    it("lets the run be confirmed again when the engine is gone before the commit", async () => {
      await resolvedRun()
      transport.handlers?.onTerminated()

      await service.commitRun()

      expect(countOf("commit_run")).toBe(0)
      expect(service.committed()).toBe(false)
      expect(service.writing()).toBe(false)
    })

    it("stops writing when the engine dies", async () => {
      await resolvedRun()
      await service.commitRun()

      transport.handlers?.onTerminated()

      expect(service.writing()).toBe(false)
    })

    it.each([
      {
        case: "lets a searched run with a resolved track be confirmed",
        setup: resolvedRun,
        confirmable: true,
      },
      {
        case: "does not let a run be confirmed while its search runs",
        setup: async () => {
          await searchingRun()
          transport.emit(TRACK_RESOLVED)
        },
        confirmable: false,
      },
      {
        case: "does not let a run without a resolved track be confirmed",
        setup: async () => {
          await searchingRun()
          transport.emit(trackResolved("a.mp3", { state: "unresolved" }))
          transport.emit(NETWORK_FINISHED)
        },
        confirmable: false,
      },
      {
        case: "keeps an interrupted run with a resolved track confirmable",
        setup: async () => {
          await searchingRun()
          transport.emit(TRACK_RESOLVED)
          await service.cancelTagging()
        },
        confirmable: true,
      },
      {
        case: "stops letting a run be confirmed once it is committed",
        setup: async () => {
          await resolvedRun()
          await service.commitRun()
        },
        confirmable: false,
      },
    ])("$case", async ({ setup, confirmable }) => {
      await setup()

      const result = service.runConfirmable()

      expect(result).toBe(confirmable)
    })

    it("freezes the shown run when its engine dies, rows kept", async () => {
      await resolvedRun()

      transport.handlers?.onTerminated()

      expect(service.runFrozen()).toBe(true)
      expect(service.runConfirmable()).toBe(false)
      expect(service.taggingTracks()).not.toHaveLength(0)
    })

    describe("runAwaitsWrite", () => {
      it("holds a searched run that is not written", async () => {
        await resolvedRun()

        expect(service.runAwaitsWrite()).toBe(true)
      })

      it("holds a written run while failed writes are left", async () => {
        await failedWriteRun()

        expect(service.runAwaitsWrite()).toBe(true)
      })

      it("releases a run written without failure", async () => {
        await resolvedRun()
        await service.commitRun()

        transport.emit(trackResolved("a.mp3", { state: "written" }))
        transport.emit(WRITE_FINISHED)

        expect(service.runAwaitsWrite()).toBe(false)
      })

      it("releases a run lost with its engine, failed writes kept on screen", async () => {
        await failedWriteRun()

        transport.handlers?.onTerminated()

        expect(service.runAwaitsWrite()).toBe(false)
        expect(service.writeFailureCount()).toBe(1)
      })
    })

    it("forgets the write but keeps the target when a new run starts", async () => {
      await writtenRun()
      transport.emit({ event: "rollback_target", run: ROLLBACK_RUN })

      await service.startTagging("C:/Sets")

      expect(service.committed()).toBe(false)
      expect(service.writeFinished()).toBeNull()
      expect(service.rollbackTarget()).toEqual(ROLLBACK_RUN)
    })

    it("empties the arbitration count once the run is confirmed", async () => {
      await searchingRun()
      transport.emit(arbitrationRequired("b.mp3"))
      transport.emit(TRACK_RESOLVED)
      transport.emit(NETWORK_FINISHED)

      await service.commitRun()

      expect(service.arbitrationCount()).toBe(0)
    })

    it("lists no recoverable track once the run is confirmed", async () => {
      await searchingRun()
      transport.emit(TRACK_RESOLVED)
      transport.emit(trackResolved("b.mp3", { state: "unresolved" }))
      transport.emit(NETWORK_FINISHED)

      await service.commitRun()

      expect(service.recoverableTracks()).toEqual([])
    })

    it("counts only the tracks whose write failed", async () => {
      await resolvedRun()
      transport.emit(trackResolved("a.mp3", { state: "write_error" }))
      transport.emit(trackResolved("b.mp3", { state: "rolled_back" }))

      expect(service.writeFailureCount()).toBe(1)
    })

    describe("phase", () => {
      it.each<{
        case: string
        setup: () => Promise<void>
        phase: SidecarPhase
        filesBusy: boolean
      }>([
        { case: "before any command", setup: () => service.start(), phase: "idle", filesBusy: false },
        {
          case: "from the extraction command",
          setup: async () => {
            await service.start()
            await service.extractPlaylist(EXTRACTION_REQUEST)
          },
          phase: "extracting",
          filesBusy: false,
        },
        {
          case: "while the run searches",
          setup: searchingRun,
          phase: "searching",
          filesBusy: false,
        },
        {
          case: "from the confirmation",
          setup: async () => {
            await resolvedRun()
            await service.commitRun()
          },
          phase: "writing",
          filesBusy: true,
        },
        {
          case: "during a rollback, ahead of an extraction",
          setup: async () => {
            await service.start()
            await service.extractPlaylist(EXTRACTION_REQUEST)
            await service.rollback(RUN_ID)
          },
          phase: "rollingBack",
          filesBusy: true,
        },
        { case: "once the write is over", setup: writtenRun, phase: "idle", filesBusy: false },
      ])("is $phase $case", async ({ setup, phase, filesBusy }) => {
        await setup()

        expect([service.phase(), service.filesBusy()]).toEqual([phase, filesBusy])
      })
    })

    describe("run action", () => {
      const actionFor = (folder: string) => service.runAction(signal(folder))

      it.each<{ case: string; setup: () => Promise<void>; folder?: string; expected: RunAction }>([
        { case: "before any run", setup: () => service.start(), expected: "start" },
        { case: "while the run searches", setup: searchingRun, expected: "cancel" },
        { case: "a searched run of the same folder", setup: resolvedRun, expected: "commit" },
        {
          case: "another folder over a confirmable run",
          setup: resolvedRun,
          folder: "C:/Other",
          expected: "start",
        },
        {
          case: "the same folder again when the run cannot be confirmed",
          setup: async () => {
            await searchingRun()
            transport.emit(trackResolved("a.mp3", { state: "unresolved" }))
            transport.emit(NETWORK_FINISHED)
          },
          expected: "start",
        },
        {
          case: "the first write, which keeps the confirmation",
          setup: async () => {
            await resolvedRun()
            await service.commitRun()
          },
          expected: "commit",
        },
        { case: "a write that left failures", setup: failedWriteRun, expected: "retry" },
        {
          case: "a retry that runs",
          setup: async () => {
            await failedWriteRun()
            await service.retryWrite()
          },
          expected: "retry",
        },
        {
          case: "a write that left no failure",
          setup: async () => {
            await resolvedRun()
            await service.commitRun()
            transport.emit(trackResolved("a.mp3", { state: "written" }))
            transport.emit(WRITE_FINISHED)
          },
          expected: "start",
        },
        {
          case: "a written run lost with its engine",
          setup: async () => {
            await failedWriteRun()
            transport.handlers?.onTerminated()
          },
          expected: "start",
        },
      ])("proposes to $expected for $case", async ({ setup, folder = "C:/Sets", expected }) => {
        await setup()

        const proposed = actionFor(folder)()

        expect(proposed).toBe(expected)
      })

      it("compares the folder to the one requested, not to the one the sidecar normalized", async () => {
        await service.start()
        await service.startTagging("C:/Musique/Extraction/")
        transport.emit({ ...RUN_STARTED, folder: "C:\\Musique\\Extraction" })
        transport.emit(TRACK_RESOLVED)
        transport.emit(NETWORK_FINISHED)

        expect(service.taggingFolder()).toBe("C:\\Musique\\Extraction")
        expect(actionFor("C:/Musique/Extraction/")()).toBe("commit")
      })
    })

    it("sends the rollback of a track and marks it in flight", async () => {
      await writtenRun()

      await service.rollback(RUN_ID, "a.mp3")

      expect(sentOf("rollback")).toEqual([{ command: "rollback", run_id: RUN_ID, track_id: "a.mp3" }])
      expect(service.rollingBack()).toEqual({ runId: RUN_ID, trackId: "a.mp3" })
    })

    it("replays a track rollback", async () => {
      await writtenRun()
      await service.rollback(RUN_ID, "a.mp3")

      transport.emit(trackResolved("a.mp3", { state: "rolled_back" }))
      transport.emit(rollbackFinished("a.mp3"))

      expect(service.rollingBack()).toBeNull()
      expect(service.rollbackFinished()?.restored).toEqual(["a.mp3"])
      expect(service.taggingTracks()[0]?.state).toBe("rolled_back")
    })

    it("asks for the rollback target again once a rollback is over", async () => {
      await writtenRun()
      await service.rollback(RUN_ID, "a.mp3")

      transport.emit(rollbackFinished("a.mp3"))

      expect(countOf("get_rollback_target")).toBe(2)
    })

    it("rolls back the shown rows from a summary sent by a new engine", async () => {
      await resolvedRun()
      await service.commitRun()
      transport.emit(trackResolved("a.mp3", { state: "written", restorable: true }))
      transport.emit(WRITE_FINISHED)
      transport.handlers?.onTerminated()
      await service.rollback(RUN_ID)

      transport.emit(rollbackFinished())

      expect(service.taggingTracks()[0]?.state).toBe("rolled_back")
      expect(service.taggingTracks()[0]?.restorable).toBe(false)
    })

    it.each([
      { outcome: "restorable", restorable: true },
      { outcome: "not restorable", restorable: false },
    ])("keeps a failed write $outcome when the event says so", async ({ restorable }) => {
      await resolvedRun()
      await service.commitRun()

      transport.emit(trackResolved("a.mp3", { state: "write_error", restorable }))

      expect(service.taggingTracks()[0]?.restorable).toBe(restorable)
    })

    it("does not know the rollback target before asking for it", async () => {
      await service.start()

      expect(service.rollbackTarget()).toBeUndefined()
    })

    it("exposes the rollback target once asked", async () => {
      await service.start()

      await service.loadRollbackTarget()
      transport.emit({ event: "rollback_target", run: ROLLBACK_RUN })

      expect(commandOf(transport.sent.at(-1) ?? "")).toBe("get_rollback_target")
      expect(service.rollbackTarget()).toEqual(ROLLBACK_RUN)
    })

    it("releases the rollback when it is refused", async () => {
      await service.start()
      await service.rollback("000000")

      transport.emit(commandError("rollback", "rollback_unavailable"))

      expect(service.rollingBack()).toBeNull()
      expect(service.errorFor("rollback")()?.code).toBe("rollback_unavailable")
    })

    /** Etat optimiste que chaque lancement pose a l'envoi et celui qui reste une fois le refus recu. */
    const LAUNCHES: readonly {
      readonly command: LaunchCommand
      readonly own: BusyPhase
      readonly launch: () => Promise<void>
      readonly observe: () => unknown
      readonly sent: unknown
      readonly refused: unknown
    }[] = [
      {
        command: "extract_playlist",
        own: "extraction",
        launch: async () => {
          await service.start()
          await service.extractPlaylist(EXTRACTION_REQUEST)
        },
        observe: () => ({ extracting: service.extracting() }),
        sent: { extracting: true },
        refused: { extracting: false },
      },
      {
        command: "start_tagging",
        own: "tagging",
        launch: searchingRun,
        // Les lignes affichees restent : seul l'etat « en cours » du lancement retombe.
        observe: () => ({ tagging: service.tagging(), shown: service.taggingTracks().length > 0 }),
        sent: { tagging: true, shown: true },
        refused: { tagging: false, shown: true },
      },
      {
        command: "resume_run",
        own: "tagging",
        launch: async () => {
          await service.start()
          transport.emit(interruptedRun(INTERRUPTED))
          await service.resume(INTERRUPTED)
        },
        // Le run affiche est vide des l'envoi et l'invite fermee : seul « en cours » retombe.
        observe: () => ({
          tagging: service.tagging(),
          prompted: service.interruptedRun() !== null,
        }),
        sent: { tagging: true, prompted: false },
        refused: { tagging: false, prompted: false },
      },
      {
        command: "commit_run",
        own: "write",
        launch: async () => {
          await resolvedRun()
          await service.commitRun()
        },
        observe: () => ({ writing: service.writing(), committed: service.committed() }),
        sent: { writing: true, committed: true },
        refused: { writing: false, committed: false },
      },
      {
        command: "retry_write",
        own: "write",
        launch: async () => {
          await failedWriteRun()
          await service.retryWrite()
        },
        observe: () => ({ writing: service.writing(), committed: service.committed() }),
        sent: { writing: true, committed: true },
        refused: { writing: false, committed: true },
      },
      {
        command: "rollback",
        own: "rollback",
        launch: async () => {
          await service.start()
          await service.rollback(RUN_ID)
        },
        observe: () => ({ rollingBack: service.rollingBack() }),
        sent: { rollingBack: { runId: RUN_ID, trackId: null } },
        refused: { rollingBack: null },
      },
    ]

    it.each(LAUNCHES)(
      "keeps the state set by $command when the refusal names its own phase",
      async ({ command, own, launch, observe, sent }) => {
        await launch()

        transport.emit(phaseBusy(command, own))

        expect(observe()).toEqual(sent)
      },
    )

    it.each(
      LAUNCHES.flatMap((launch) =>
        BUSY_PHASES.filter((phase) => phase !== launch.own).map((phase) => ({ ...launch, phase })),
      ),
    )(
      "undoes the state set by $command when it is refused for a busy $phase",
      async ({ command, phase, launch, observe, refused }) => {
        await launch()

        transport.emit(phaseBusy(command, phase))

        expect(observe()).toEqual(refused)
        expect(service.lastError()?.params).toEqual({ phase })
      },
    )

    it("releases the rollback when the engine dies", async () => {
      await service.start()
      await service.rollback(RUN_ID)

      transport.handlers?.onTerminated()

      expect(service.rollingBack()).toBeNull()
    })
  })
})
