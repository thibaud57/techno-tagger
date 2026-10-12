import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { vi } from "vitest"

import { PAST_RUN, TRACK_LOADED, runLoaded, runsListed } from "../../fixtures/past-runs"
import { INTERRUPTED, interruptedRun } from "../../fixtures/resume"
import { RUN_STARTED, TRACK_RESOLVED, arbitrationRequired } from "../../fixtures/tagging"
import {
  TRACK_URL,
  resolvedByUrl,
  urlProgress,
  urlRecoveryError,
} from "../../fixtures/url-recovery"
import {
  NETWORK_FINISHED,
  ROLLBACK_RUN,
  WRITE_FINISHED,
  commandError,
  phaseBusy,
  rollbackFinished,
  writeProgress,
} from "../../fixtures/write"
import { BusyPhase, SidecarEvent } from "./models/protocol"
import { PastRunsStore } from "./past-runs.store"
import { SIDECAR_TRANSPORT, SidecarHandlers, SidecarTransport } from "./sidecar-transport"
import { SidecarService } from "./sidecar.service"

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

const EXTRACTION = {
  source_folder: "C:/lib",
  destination_folder: "C:/work",
  playlist_path: "C:/x.m3u8",
  playlist_name: null,
  mode: "copy",
} as const

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

  it("keeps the choices of the extraction it launched", async () => {
    await service.start()

    await service.extractPlaylist(EXTRACTION)

    expect(service.extractionRequest()).toEqual(EXTRACTION)
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

    transport.emit({ event: "version", version: APP_VERSION, api_key_configured: false })

    expect(service.version()).toBe(APP_VERSION)
  })

  it("feeds the api key state from the version event", async () => {
    await service.start()

    transport.emit({ event: "version", version: APP_VERSION, api_key_configured: true })

    expect(service.apiKeyConfigured()).toBe(true)
  })

  it.each([
    { label: "matching versions", version: APP_VERSION, expected: null },
    {
      label: "mismatched versions",
      version: "0.0.1-old",
      expected: { ui: APP_VERSION, sidecar: "0.0.1-old" },
    },
  ] as const)("reports the mismatch for $label", async ({ version, expected }) => {
    await service.start()

    transport.emit({ event: "version", version, api_key_configured: false })

    expect(service.versionMismatch()).toEqual(expected)
  })

  it("is not ready before the version is received", async () => {
    await service.start()

    expect(service.ready()).toBe(false)
  })

  it("is ready once the matching version is received", async () => {
    await service.start()

    transport.emit({ event: "version", version: APP_VERSION, api_key_configured: false })

    expect(service.ready()).toBe(true)
  })

  it("is not ready when the versions mismatch", async () => {
    await service.start()

    transport.emit({ event: "version", version: "0.0.1-old", api_key_configured: false })

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
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined)
    await service.start()
    transport.writable = false

    await service.extractPlaylist(EXTRACTION)

    expect(service.available()).toBe(false)
    expect(service.extracting()).toBe(false)
    expect(service.lastError()?.code).toBe("sidecar_unavailable")
    expect(spy).toHaveBeenCalled()
  })

  it("ends the run when the sidecar terminates", async () => {
    await service.start()
    await service.extractPlaylist(EXTRACTION)
    transport.emit({ event: "progress", phase: "extraction", processed: 2, total: 5 })

    transport.handlers?.onTerminated()

    expect(service.available()).toBe(false)
    expect(service.extracting()).toBe(false)
    expect(service.progress()).toBeNull()
  })

  it("marks an extraction as running once its command is sent", async () => {
    await service.start()
    transport.emit({ event: "version", version: APP_VERSION, api_key_configured: false })

    await service.extractPlaylist(EXTRACTION)

    expect(service.extracting()).toBe(true)
    expect(service.ready()).toBe(false)
  })

  it("clears the previous error when a command is sent", async () => {
    await service.start()
    transport.emit({
      event: "error",
      code: "playlist_file_unreadable",
      params: {},
      message: "x",
      command: "list_playlists",
    })

    await service.listPlaylists("C:/x.m3u8")

    expect(service.lastError()).toBeNull()
  })

  it("forgets the previous listing when another file is listed", async () => {
    await service.start()
    transport.emit({
      event: "playlists_listed",
      playlist_format: "vlc_dump",
      playlists: [{ playlist_id: 1, name: "set", track_count: 8 }],
    })

    await service.listPlaylists("C:/x.m3u8")

    expect(service.playlists()).toEqual([])
    expect(service.playlistFormat()).toBeNull()
  })

  it("feeds the received playlists", async () => {
    await service.start()

    transport.emit({
      event: "playlists_listed",
      playlist_format: "vlc_dump",
      playlists: [{ playlist_id: 1, name: "set", track_count: 8 }],
    })

    expect(service.playlists()).toEqual([{ playlist_id: 1, name: "set", track_count: 8 }])
    expect(service.playlistFormat()).toBe("vlc_dump")
  })

  it("feeds the received progress", async () => {
    await service.start()

    transport.emit({ event: "progress", phase: "extraction", processed: 2, total: 5 })

    expect(service.progress()).toEqual({
      event: "progress",
      phase: "extraction",
      processed: 2,
      total: 5,
    })
  })

  it("feeds the result and keeps the last progress", async () => {
    await service.start()
    await service.extractPlaylist(EXTRACTION)
    transport.emit({ event: "progress", phase: "extraction", processed: 5, total: 5 })

    transport.emit({
      event: "extraction_finished",
      extracted: ["a.mp3"],
      already_present: [],
      missing: [],
      duplicates: [],
      failures: [],
      report_path: "C:/work/report.json",
    })

    expect(service.extraction()?.report_path).toBe("C:/work/report.json")
    expect(service.progress()?.processed).toBe(5)
    expect(service.extracting()).toBe(false)
  })

  it("clears the previous progress when a new extraction starts", async () => {
    await service.start()
    transport.emit({ event: "progress", phase: "extraction", processed: 5, total: 5 })

    await service.extractPlaylist(EXTRACTION)

    expect(service.progress()).toBeNull()
  })

  it("feeds the error without interrupting the stream", async () => {
    await service.start()

    transport.emit({
      event: "error",
      code: "playlist_not_found",
      params: {},
      message: "x",
      command: "list_playlists",
    })
    transport.emit({ event: "progress", phase: "extraction", processed: 5, total: 5 })

    expect(service.lastError()?.code).toBe("playlist_not_found")
    expect(service.progress()?.processed).toBe(5)
  })

  it("ends the run on an error", async () => {
    await service.start()
    await service.extractPlaylist(EXTRACTION)
    transport.emit({ event: "progress", phase: "extraction", processed: 5, total: 5 })

    transport.emit({
      event: "error",
      code: "report_write_failed",
      params: {},
      message: "x",
      command: "extract_playlist",
    })

    expect(service.progress()).toBeNull()
    expect(service.extracting()).toBe(false)
  })

  it("ignores a line that is not JSON", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined)
    await service.start()

    transport.emitRaw("pas du json")
    transport.emit({ event: "version", version: APP_VERSION, api_key_configured: false })

    expect(service.version()).toBe(APP_VERSION)
    expect(spy).toHaveBeenCalled()
  })

  it("ignores an event of unknown type", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined)
    await service.start()

    transport.emitRaw(JSON.stringify({ event: "unheard_of" }))

    expect(service.version()).toBeNull()
    expect(service.lastError()).toBeNull()
    expect(spy).toHaveBeenCalled()
  })

  it("never reads a stderr line as an event", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    await service.start()

    transport.handlers?.onStderr(
      JSON.stringify({ event: "version", version: "9.9.9", api_key_configured: true }),
    )

    expect(service.version()).toBeNull()
  })

  it("sends the api key command", async () => {
    await service.start()

    await service.setApiKey("k3y-t0k3n")

    expect(parseLine(transport.sent.at(-1) ?? "")).toEqual({
      command: "set_api_key",
      api_key: "k3y-t0k3n",
    })
  })

  it("sends the start tagging command without thresholds", async () => {
    await service.start()

    await service.startTagging("C:/Sets")

    expect(parseLine(transport.sent.at(-1) ?? "")).toEqual({
      command: "start_tagging",
      folder: "C:/Sets",
    })
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

  it("sends the thresholds when the settings impose them", async () => {
    await service.start()

    await service.startTagging("C:/Sets", { floor: 75, ceiling: 95 })

    expect(parseLine(transport.sent.at(-1) ?? "")).toEqual({
      command: "start_tagging",
      folder: "C:/Sets",
      thresholds: { floor: 75, ceiling: 95 },
    })
  })

  it("replays a whole tagging run and reports every track", async () => {
    await service.start()
    await service.startTagging("C:/Sets")

    transport.emit(RUN_STARTED)
    transport.emit({ event: "progress", phase: "tagging", processed: 1, total: 1 })
    transport.emit(TRACK_RESOLVED)
    transport.emit({
      event: "run_finished",
      phase: "network",
      run_id: "a3f9c1",
      resolved: 1,
      unresolved: 0,
      written: 0,
      write_error: 0,
      awaiting_arbitration: 0,
      report_path: null,
    })

    expect(service.taggingTracks()[0]?.state).toBe("resolved")
    expect(service.taggingProgress()).toEqual({ processed: 1, total: 1 })
    expect(service.taggingFinished()?.resolved).toBe(1)
    expect(service.tagging()).toBe(false)
    expect(service.progress()).toBeNull()
  })

  it("keeps the extraction progress out of the tagging run", async () => {
    await service.start()
    await service.startTagging("C:/Sets")

    transport.emit({ event: "progress", phase: "extraction", processed: 3, total: 10 })

    expect(service.progress()?.processed).toBe(3)
    expect(service.taggingProgress()).toBeNull()
  })

  it("leaves the tagging run alone when a write phase finishes", async () => {
    await service.start()
    await service.startTagging("C:/Sets")
    transport.emit(RUN_STARTED)

    transport.emit({
      event: "run_finished",
      phase: "write",
      run_id: "a3f9c1",
      resolved: 1,
      unresolved: 0,
      written: 0,
      write_error: 0,
      awaiting_arbitration: 0,
      report_path: null,
    })

    expect(service.taggingFinished()).toBeNull()
    expect(service.tagging()).toBe(true)
  })

  it("stops the tagging run on an error", async () => {
    await service.start()
    await service.startTagging("C:/Sets")
    transport.emit(RUN_STARTED)
    transport.emit(TRACK_RESOLVED)

    transport.emit({
      event: "error",
      code: "api_key_rejected",
      params: {},
      message: "rejected",
      command: "start_tagging",
    })

    expect(service.tagging()).toBe(false)
    expect(service.lastError()?.code).toBe("api_key_rejected")
    expect(service.taggingTracks()[0]?.state).toBe("resolved")
  })

  it("leaves a running tagging run alone when another command fails", async () => {
    await service.start()
    await service.startTagging("C:/Sets")
    transport.emit(RUN_STARTED)

    // `start_tagging` tourne en tache de fond : la boucle du sidecar a lu et refuse une
    // commande emise depuis un autre onglet pendant que le run continue.
    transport.emit({
      event: "error",
      code: "api_key_not_stored",
      params: {},
      message: "keyring refused",
      command: "set_api_key",
    })

    expect(service.tagging()).toBe(true)
    expect(service.lastError()?.code).toBe("api_key_not_stored")
  })

  it("refuses to open a second run over a running one", async () => {
    await service.start()
    await service.startTagging("C:/Sets")
    transport.emit(RUN_STARTED)
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
    await service.extractPlaylist(EXTRACTION)
    const sent = transport.sent.length

    await service.extractPlaylist(EXTRACTION)

    expect(transport.sent.length).toBe(sent)
    expect(service.extracting()).toBe(true)
  })

  it("keeps the extraction going when a second one is refused", async () => {
    await service.start()
    await service.extractPlaylist(EXTRACTION)
    transport.emit({ event: "progress", phase: "extraction", processed: 1, total: 5 })

    transport.emit(phaseBusy("extract_playlist", "extraction"))

    expect(service.extracting()).toBe(true)
    expect(service.progress()).not.toBeNull()
  })

  it("keeps a tagging run going when an extraction fails", async () => {
    await service.start()
    await service.startTagging("C:/Sets")
    transport.emit(RUN_STARTED)

    // Les deux phases longues tournent en parallele : l'echec de l'une ne dit rien
    // de l'autre, et l'ecran du tagging ne doit pas perdre son run.
    transport.emit({
      event: "error",
      code: "report_write_failed",
      params: {},
      message: "report not written",
      command: "extract_playlist",
    })

    expect(service.tagging()).toBe(true)
    expect(service.taggingTracks().length).toBeGreaterThan(0)
  })

  it("keeps the run going when a second launch is refused", async () => {
    await service.start()
    await service.startTagging("C:/Sets")
    transport.emit(RUN_STARTED)

    // Releve par /verify le 2026-09-24 : le refus porte `start_tagging`, comme l'echec
    // qui clot un run, mais ce code-la dit justement que le premier tourne toujours.
    transport.emit(phaseBusy("start_tagging", "tagging"))

    expect(service.tagging()).toBe(true)
    expect(service.lastError()?.code).toBe("phase_busy")
    expect(service.lastError()?.params).toEqual({ phase: "tagging" })
  })

  it("writes a command as a single newline-terminated line", async () => {
    await service.start()

    await service.extractPlaylist(EXTRACTION)

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
    await service.start()
    transport.emit(RUN_STARTED)
    transport.emit(arbitrationRequired("a.mp3"))

    await gesture(service)

    expect(parseLine(transport.sent.at(-1) ?? "")).toEqual(expected)
  })

  it("ignores a second gesture on a track awaiting an answer", async () => {
    await service.start()
    transport.emit(RUN_STARTED)
    transport.emit(arbitrationRequired("a.mp3"))
    await service.refuseCandidates("a.mp3", "beatport")
    const before = transport.sent.length

    await service.refuseCandidates("a.mp3", "beatport")

    expect(transport.sent.length).toBe(before)
    expect(service.arbitrationBusy()).toBe(true)
  })

  it("routes the arbitration events to the queue", async () => {
    await service.start()
    transport.emit(RUN_STARTED)
    transport.emit(arbitrationRequired("a.mp3"))
    transport.emit(arbitrationRequired("b.mp3"))

    transport.emit({
      ...arbitrationRequired("b.mp3"),
      event: "arbitration_updated",
      source: "bandcamp",
      other_source: "beatport",
    })
    transport.emit(TRACK_RESOLVED)

    expect(service.arbitrations().map((entry) => entry.track_id)).toEqual(["b.mp3"])
    expect(service.currentArbitration()?.source).toBe("bandcamp")
    expect(service.taggingTracks()[0]?.state).toBe("resolved")
  })

  it("releases a gesture the sidecar refuses", async () => {
    await service.start()
    transport.emit(RUN_STARTED)
    transport.emit(arbitrationRequired("a.mp3"))
    await service.chooseCandidate("a.mp3", "beatport", 0)
    const refusal = {
      event: "error",
      code: "arbitration_busy",
      params: { track_id: "a.mp3" },
      message: "a gesture is already in flight for this track",
      command: "resolve_arbitration",
    } as const

    transport.emit(refusal)

    expect(service.arbitrationBusy()).toBe(false)
    expect(service.errorFor("resolve_arbitration")()).toEqual(refusal)
  })

  it("keeps a gesture waiting when the error names no track", async () => {
    await service.start()
    transport.emit(RUN_STARTED)
    transport.emit(arbitrationRequired("a.mp3"))
    await service.chooseCandidate("a.mp3", "beatport", 0)

    transport.emit({
      event: "error",
      code: "arbitration_busy",
      params: {},
      message: "a gesture is already in flight for this track",
      command: "resolve_arbitration",
    })

    expect(service.arbitrationBusy()).toBe(true)
  })

  it("leaves the queue alone on the error of another command", async () => {
    await service.start()
    transport.emit(RUN_STARTED)
    transport.emit(arbitrationRequired("a.mp3"))

    transport.emit({
      event: "error",
      code: "arbitration_not_pending",
      params: { track_id: "a.mp3" },
      message: "track not awaiting arbitration",
      command: "start_tagging",
    })

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
    await service.start()
    transport.emit(RUN_STARTED)
    transport.emit(arbitrationRequired("a.mp3"))

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
      transport.emit(urlProgress(0, 2))
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

      await service.resolveByUrl("a.mp3", "https://www.beatport.com/track/dim-orbit/99000202")

      expect(transport.sent).toHaveLength(sent)
    })

    it("ignores an empty url", async () => {
      await openPhase()
      const sent = transport.sent.length

      await service.resolveByUrl("a.mp3", "")

      expect(transport.sent).toHaveLength(sent)
      expect(service.urlRecoveryBusy().has("a.mp3")).toBe(false)
    })

    it("routes the url recovery progress to its phase only", async () => {
      await service.start()
      transport.emit(RUN_STARTED)
      transport.emit({ event: "progress", phase: "tagging", processed: 1, total: 2 })
      const closed = service.urlRecoveryProgress()

      transport.emit(urlProgress(0, 2))

      expect(closed).toBeNull()
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
            artist: "Dara Winter",
            title: "The Weir",
            tags_before: null,
          },
          {
            track_id: "d.mp3",
            file_name: "d.mp3",
            artist: "Zelka",
            title: "Mothlight",
            tags_before: null,
          },
        ],
      })
      transport.emit(TRACK_RESOLVED)
      transport.emit({
        ...TRACK_RESOLVED,
        track_id: "b.mp3",
        state: "unresolved",
        resolution: "none",
        failure_reason: "no_result",
        source: null,
        after: null,
        scores: null,
        artwork_path: null,
      })
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
    const VERSION = { event: "version", version: APP_VERSION, api_key_configured: true } as const
    const askedCount = (): number =>
      transport.sent.filter((line) => commandOf(line) === "get_interrupted_run").length

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

    it("drops the announced run at a restart until the engine announces again", async () => {
      await service.start()
      transport.emit(interruptedRun(INTERRUPTED))

      await service.restart()
      const stale = service.interruptedRun()
      transport.emit(interruptedRun(INTERRUPTED))

      expect(stale).toBeNull()
      expect(service.interruptedRun()).toEqual(INTERRUPTED)
    })

    it("feeds the announced run", async () => {
      await service.start()

      transport.emit(interruptedRun(INTERRUPTED))

      expect(service.interruptedRun()).toEqual(INTERRUPTED)
    })

    it("sends resume_run only once", async () => {
      await service.start()
      transport.emit(interruptedRun(INTERRUPTED))

      await service.resume(INTERRUPTED)
      await service.resume(INTERRUPTED)

      const resumed = transport.sent.filter((line) => commandOf(line) === "resume_run")
      expect(resumed.map(parseLine)).toEqual([{ command: "resume_run", run_id: "a3f9c1" }])
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

    it("closes the prompt at the gesture then prompts the next run", async () => {
      await service.start()
      transport.emit(interruptedRun(INTERRUPTED))

      await service.discard(INTERRUPTED.run_id)
      const closed = service.interruptedRun()
      transport.emit(interruptedRun({ ...INTERRUPTED, run_id: "1b2c3d" }))

      expect(parseLine(transport.sent.at(-1) ?? "")).toEqual({
        command: "discard_run",
        run_id: "a3f9c1",
      })
      expect(closed).toBeNull()
      expect(service.interruptedRun()?.run_id).toBe("1b2c3d")
    })

    it("sends discard_run only once", async () => {
      await service.start()
      transport.emit(interruptedRun(INTERRUPTED))

      await service.discard(INTERRUPTED.run_id)
      await service.discard(INTERRUPTED.run_id)

      const discarded = transport.sent.filter((line) => commandOf(line) === "discard_run")
      expect(discarded).toHaveLength(1)
    })
  })

  describe("past runs", () => {
    it("feeds the past runs from the listing", async () => {
      await service.start()

      transport.emit(runsListed(PAST_RUN))

      expect(service.pastRuns()).toEqual([PAST_RUN])
    })

    it("loads a past run", async () => {
      await service.start()

      await service.loadRun(PAST_RUN.run_id)
      const loading = TestBed.inject(PastRunsStore).loading()
      transport.emit(runLoaded(TRACK_LOADED))

      expect(parseLine(transport.sent.at(-1) ?? "")).toEqual({
        command: "load_run",
        run_id: PAST_RUN.run_id,
      })
      expect(loading).toBe(PAST_RUN.run_id)
      expect(service.loadedRun()?.runId).toBe(PAST_RUN.run_id)
      expect(TestBed.inject(PastRunsStore).loading()).toBeNull()
    })

    it("asks for a run once while it loads", async () => {
      await service.start()

      await service.loadRun(PAST_RUN.run_id)
      await service.loadRun(PAST_RUN.run_id)

      const loads = transport.sent.filter((line) => commandOf(line) === "load_run")
      expect(loads).toHaveLength(1)
    })

    it("ends the loading when the run is refused", async () => {
      await service.start()
      await service.loadRun("000000")

      transport.emit(commandError("load_run", "run_not_found", { run_id: "000000" }))

      expect(TestBed.inject(PastRunsStore).loading()).toBeNull()
      expect(service.loadRefusal()?.error.code).toBe("run_not_found")
    })

    it("keeps the refusal when another command is sent", async () => {
      await service.start()
      await service.loadRun("000000")
      transport.emit(commandError("load_run", "run_not_found", { run_id: "000000" }))

      await service.listRuns()

      expect(service.loadRefusal()?.runId).toBe("000000")
    })

    it("ends the loading when a running phase refuses the run", async () => {
      await service.start()
      await service.loadRun(PAST_RUN.run_id)

      transport.emit(phaseBusy("load_run", "tagging"))

      expect(TestBed.inject(PastRunsStore).loading()).toBeNull()
      expect(service.loadRefusal()?.error.code).toBe("phase_busy")
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
      await service.start()
      await service.startTagging("C:/Sets")
      transport.emit(RUN_STARTED)
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

  describe("write phase", () => {
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
    const sentOf = (command: string): unknown[] =>
      transport.sent.filter((line) => commandOf(line) === command).map(parseLine)
    const countOf = (command: string): number => sentOf(command).length

    it("replays a whole write and asks for the rollback target again", async () => {
      await resolvedRun()

      await service.commitRun()
      const writing = service.writing()
      transport.emit(writeProgress(1, 1))
      transport.emit({ ...TRACK_RESOLVED, state: "written" })
      transport.emit(WRITE_FINISHED)

      expect(sentOf("commit_run")).toEqual([{ command: "commit_run", run_id: "a3f9c1" }])
      expect(writing).toBe(true)
      expect(service.writing()).toBe(false)
      expect(service.committed()).toBe(true)
      expect(service.writeProgress()).toEqual({ processed: 1, total: 1 })
      expect(service.writeFinished()?.written).toBe(1)
      expect(service.taggingTracks()[0]?.state).toBe("written")
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

    it("retries the failed writes of the confirmed run", async () => {
      await resolvedRun()
      await service.commitRun()
      transport.emit({ ...WRITE_FINISHED, written: 0, write_error: 1 })

      await service.retryWrite()
      const writing = service.writing()
      transport.emit(WRITE_FINISHED)

      expect(sentOf("retry_write")).toEqual([{ command: "retry_write", run_id: "a3f9c1" }])
      expect(writing).toBe(true)
      expect(service.writing()).toBe(false)
      expect(service.committed()).toBe(true)
    })

    it("keeps writing when a retry is refused because a write is already running", async () => {
      await resolvedRun()
      await service.commitRun()
      transport.emit({ ...WRITE_FINISHED, written: 0, write_error: 1 })
      await service.retryWrite()

      transport.emit(phaseBusy("retry_write", "write"))

      expect(service.writing()).toBe(true)
      expect(service.committed()).toBe(true)
    })

    it("stops writing but keeps the confirmation when a retry is refused", async () => {
      await resolvedRun()
      await service.commitRun()
      transport.emit({ ...WRITE_FINISHED, written: 0, write_error: 1 })
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
      transport.emit(writeProgress(1, 1))
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

    it("ignores a launch while files are being written", async () => {
      await resolvedRun()
      // `running` est faux : seule la garde de l'ecriture protege le lancement.
      transport.emit(NETWORK_FINISHED)
      await service.commitRun()

      await service.startTagging("C:/Other")

      expect(countOf("start_tagging")).toBe(1)
      expect(service.taggingTracks()).toHaveLength(2)
      expect(service.writing()).toBe(true)
    })

    it("clears nothing while files are being written", async () => {
      await resolvedRun()
      transport.emit(NETWORK_FINISHED)
      await service.commitRun()

      service.clearRun()

      expect(service.taggingTracks()).toHaveLength(2)
      expect(service.writing()).toBe(true)
    })

    it("lets a new run start after the displayed one is cleared", async () => {
      await resolvedRun()
      transport.emit(WRITE_FINISHED)

      service.clearRun()
      const cleared = {
        tagging: service.tagging(),
        tracks: service.taggingTracks().length,
        requested: service.requestedFolder(),
      }
      await service.startTagging("C:/Sets")

      expect(cleared).toEqual({ tagging: false, tracks: 0, requested: null })
      expect(countOf("start_tagging")).toBe(2)
      expect(service.tagging()).toBe(true)
    })

    it("clears nothing while a search runs", async () => {
      await searchingRun()

      service.clearRun()

      expect(service.taggingTracks()).toHaveLength(2)
      expect(service.tagging()).toBe(true)
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

    it("lets a searched run with a resolved track be confirmed", async () => {
      await searchingRun()
      transport.emit(TRACK_RESOLVED)

      transport.emit(NETWORK_FINISHED)

      expect(service.runConfirmable()).toBe(true)
    })

    it("does not let a run be confirmed while its search runs", async () => {
      await searchingRun()

      transport.emit(TRACK_RESOLVED)

      expect(service.runConfirmable()).toBe(false)
    })

    it("does not let a run without a resolved track be confirmed", async () => {
      await searchingRun()

      transport.emit({ ...TRACK_RESOLVED, state: "unresolved" })
      transport.emit(NETWORK_FINISHED)

      expect(service.runConfirmable()).toBe(false)
    })

    it("keeps an interrupted run with a resolved track confirmable", async () => {
      await searchingRun()
      transport.emit(TRACK_RESOLVED)

      await service.cancelTagging()

      expect(service.runConfirmable()).toBe(true)
    })

    it("stops letting a run be confirmed once it is committed", async () => {
      await resolvedRun()
      transport.emit(NETWORK_FINISHED)

      await service.commitRun()

      expect(service.runConfirmable()).toBe(false)
    })

    it("freezes the shown run when its engine dies, rows kept", async () => {
      await resolvedRun()
      transport.emit(NETWORK_FINISHED)

      transport.handlers?.onTerminated()

      expect(service.runFrozen()).toBe(true)
      expect(service.runConfirmable()).toBe(false)
      expect(service.taggingTracks()).not.toHaveLength(0)
    })

    it("forgets the write but keeps the target when a new run starts", async () => {
      await resolvedRun()
      transport.emit(NETWORK_FINISHED)
      await service.commitRun()
      transport.emit(WRITE_FINISHED)
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
      const before = service.arbitrationCount()

      await service.commitRun()

      expect(before).toBe(1)
      expect(service.arbitrationCount()).toBe(0)
    })

    it("lists no recoverable track once the run is confirmed", async () => {
      await searchingRun()
      transport.emit(TRACK_RESOLVED)
      transport.emit({ ...TRACK_RESOLVED, track_id: "b.mp3", state: "unresolved" })
      transport.emit(NETWORK_FINISHED)
      const before = service.recoverableTracks().map((track) => track.trackId)

      await service.commitRun()

      expect(before).toEqual(["b.mp3"])
      expect(service.recoverableTracks()).toEqual([])
    })

    it("counts only the tracks whose write failed", async () => {
      await resolvedRun()
      transport.emit({ ...TRACK_RESOLVED, state: "write_error" })
      transport.emit({ ...TRACK_RESOLVED, track_id: "b.mp3", state: "rolled_back" })

      expect(service.writeFailureCount()).toBe(1)
    })

    describe("phase", () => {
      it("is idle before any command", async () => {
        await service.start()

        expect(service.phase()).toBe("idle")
        expect(service.filesBusy()).toBe(false)
      })

      it("is extracting from the extraction command", async () => {
        await service.start()

        await service.extractPlaylist(EXTRACTION)

        expect(service.phase()).toBe("extracting")
        expect(service.filesBusy()).toBe(false)
      })

      it("is searching while the run searches", async () => {
        await searchingRun()

        expect(service.phase()).toBe("searching")
        expect(service.filesBusy()).toBe(false)
      })

      it("is writing from the confirmation, and keeps the files busy", async () => {
        await resolvedRun()

        await service.commitRun()

        expect(service.phase()).toBe("writing")
        expect(service.filesBusy()).toBe(true)
      })

      it("is rollingBack during a rollback, ahead of an extraction", async () => {
        await service.start()
        await service.extractPlaylist(EXTRACTION)

        await service.rollback("a3f9c1")

        expect(service.phase()).toBe("rollingBack")
        expect(service.filesBusy()).toBe(true)
      })

      it("returns to idle once the write is over", async () => {
        await resolvedRun()
        await service.commitRun()

        transport.emit(WRITE_FINISHED)

        expect(service.phase()).toBe("idle")
      })
    })

    describe("run action", () => {
      const actionFor = (folder: string) => service.runAction(signal(folder))

      it("proposes to start before any run", async () => {
        await service.start()

        expect(actionFor("C:/Sets")()).toBe("start")
      })

      it("proposes to interrupt while the run searches", async () => {
        await searchingRun()

        expect(actionFor("C:/Sets")()).toBe("cancel")
      })

      it("proposes to confirm a searched run of the same folder", async () => {
        await resolvedRun()

        expect(actionFor("C:/Sets")()).toBe("commit")
      })

      it("proposes to start another folder over a confirmable run", async () => {
        await resolvedRun()

        expect(actionFor("C:/Other")()).toBe("start")
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

      it("proposes to start the same folder again when the run cannot be confirmed", async () => {
        await searchingRun()
        transport.emit({ ...TRACK_RESOLVED, state: "unresolved" })
        transport.emit(NETWORK_FINISHED)

        expect(actionFor("C:/Sets")()).toBe("start")
      })

      it("keeps the confirmation while the first write runs", async () => {
        await resolvedRun()

        await service.commitRun()

        expect(actionFor("C:/Sets")()).toBe("commit")
      })

      it("proposes the retry once a write left failures, and while it runs", async () => {
        await resolvedRun()
        await service.commitRun()
        transport.emit({ ...TRACK_RESOLVED, state: "write_error" })
        transport.emit({ ...WRITE_FINISHED, written: 0, write_error: 1 })
        const action = actionFor("C:/Sets")
        const settled = action()

        await service.retryWrite()

        expect(settled).toBe("retry")
        expect(action()).toBe("retry")
      })

      it("proposes to start again once a write left no failure", async () => {
        await resolvedRun()
        await service.commitRun()
        transport.emit({ ...TRACK_RESOLVED, state: "written" })
        transport.emit(WRITE_FINISHED)

        expect(actionFor("C:/Sets")()).toBe("start")
      })

      it("proposes to start again when the written run was lost with its engine", async () => {
        await resolvedRun()
        await service.commitRun()
        transport.emit({ ...TRACK_RESOLVED, state: "write_error" })
        transport.emit({ ...WRITE_FINISHED, written: 0, write_error: 1 })

        transport.handlers?.onTerminated()

        expect(actionFor("C:/Sets")()).toBe("start")
      })
    })

    it("replays a track rollback and asks for the target again", async () => {
      await resolvedRun()
      await service.commitRun()
      transport.emit(WRITE_FINISHED)

      await service.rollback("a3f9c1", "a.mp3")
      const inFlight = service.rollingBack()
      transport.emit({ ...TRACK_RESOLVED, state: "rolled_back" })
      transport.emit(rollbackFinished("a.mp3"))

      expect(sentOf("rollback")).toEqual([
        { command: "rollback", run_id: "a3f9c1", track_id: "a.mp3" },
      ])
      expect(inFlight).toEqual({ runId: "a3f9c1", trackId: "a.mp3" })
      expect(service.rollingBack()).toBeNull()
      expect(service.rollbackFinished()?.restored).toEqual(["a.mp3"])
      expect(service.taggingTracks()[0]?.state).toBe("rolled_back")
      expect(countOf("get_rollback_target")).toBe(2)
    })

    it("rolls back the shown rows from a summary sent by a new engine", async () => {
      await resolvedRun()
      await service.commitRun()
      transport.emit({ ...TRACK_RESOLVED, state: "written", restorable: true })
      transport.emit(WRITE_FINISHED)
      transport.handlers?.onTerminated()
      await service.rollback("a3f9c1")

      transport.emit(rollbackFinished())

      expect(service.taggingTracks()[0]?.state).toBe("rolled_back")
      expect(service.taggingTracks()[0]?.restorable).toBe(false)
    })

    it.each([true, false])(
      "carries the restorable flag of a written row (%s)",
      async (restorable) => {
        await resolvedRun()
        await service.commitRun()

        transport.emit({ ...TRACK_RESOLVED, state: "write_error", restorable })

        expect(service.taggingTracks()[0]?.restorable).toBe(restorable)
      },
    )

    it("exposes the rollback target once asked", async () => {
      await service.start()
      const unknown = service.rollbackTarget()

      await service.loadRollbackTarget()
      transport.emit({ event: "rollback_target", run: ROLLBACK_RUN })

      expect(unknown).toBeUndefined()
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

    /** Etat optimiste que chaque lancement pose a l'envoi, et celui qui reste une fois le refus recu. */
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
          await service.extractPlaylist(EXTRACTION)
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
          await resolvedRun()
          await service.commitRun()
          transport.emit({ ...WRITE_FINISHED, written: 0, write_error: 1 })
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
          await service.rollback("a3f9c1")
        },
        observe: () => ({ rollingBack: service.rollingBack() }),
        sent: { rollingBack: { runId: "a3f9c1", trackId: null } },
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

    it("ignores a launch while a rollback runs", async () => {
      await resolvedRun()
      await service.rollback("a3f9c1")

      await service.startTagging("C:/Other")

      expect(countOf("start_tagging")).toBe(1)
      expect(service.taggingTracks()).toHaveLength(2)
    })

    it("releases the rollback when the engine dies", async () => {
      await service.start()
      await service.rollback("a3f9c1")

      transport.handlers?.onTerminated()

      expect(service.rollingBack()).toBeNull()
    })
  })
})
