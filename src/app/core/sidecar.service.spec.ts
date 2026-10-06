import { TestBed } from "@angular/core/testing"
import { vi } from "vitest"

import { RUN_STARTED, TRACK_RESOLVED, arbitrationRequired } from "../../fixtures/tagging"
import { resolvedByUrl, urlProgress, urlRecoveryError } from "../../fixtures/url-recovery"
import { SidecarEvent } from "./models/protocol"
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
    transport.emit({ event: "version", version: APP_VERSION, api_key_configured: false })

    expect(service.lastError()?.code).toBe("playlist_not_found")
    expect(service.version()).toBe(APP_VERSION)
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

  it("stops the sidecar through the protocol", async () => {
    await service.start()

    await service.shutdown()

    expect(parseLine(transport.sent.at(-1) ?? "")).toEqual({ command: "shutdown" })
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
      awaiting_arbitration: 0,
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
      awaiting_arbitration: 0,
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

    transport.emit({
      event: "error",
      code: "extraction_in_progress",
      params: {},
      message: "an extraction is already in progress",
      command: "extract_playlist",
    })

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
    transport.emit({
      event: "error",
      code: "tagging_in_progress",
      params: {},
      message: "a run is already in progress",
      command: "start_tagging",
    })

    expect(service.tagging()).toBe(true)
    expect(service.lastError()?.code).toBe("tagging_in_progress")
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
    const URL = "https://amelielens.bandcamp.com/track/basiel"

    const openPhase = async (): Promise<void> => {
      await service.start()
      transport.emit(RUN_STARTED)
      transport.emit(urlProgress(0, 2))
    }

    it("sends a url recovery command with its track and its url", async () => {
      await openPhase()

      await service.resolveByUrl("a.mp3", URL)

      expect(parseLine(transport.sent.at(-1) ?? "")).toEqual({
        command: "resolve_by_url",
        track_id: "a.mp3",
        url: URL,
      })
      expect(service.urlRecoveryBusy().has("a.mp3")).toBe(true)
    })

    it("ignores a second gesture while the first one waits", async () => {
      await openPhase()
      await service.resolveByUrl("a.mp3", URL)
      const sent = transport.sent.length

      await service.resolveByUrl("a.mp3", "https://www.beatport.com/track/your-mind/22708005")

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
      await service.resolveByUrl("a.mp3", URL)

      transport.emit(resolvedByUrl("a.mp3"))

      expect(service.urlRecoveryBusy().has("a.mp3")).toBe(false)
      expect(service.taggingTracks()[0]?.resolution).toBe("url")
    })

    it("attaches a url recovery error to its track", async () => {
      await openPhase()
      await service.resolveByUrl("a.mp3", URL)
      const error = urlRecoveryError("a.mp3")

      transport.emit(error)

      expect(service.urlRecoveryBusy().has("a.mp3")).toBe(false)
      expect(service.urlRecoveryErrors().get("a.mp3")).toEqual(error)
      expect(service.urlRecoveryErrors().has("b.mp3")).toBe(false)
      expect(service.errorFor("resolve_by_url")()).toEqual(error)
    })

    it("keeps a url error without track out of the phase", async () => {
      await openPhase()
      await service.resolveByUrl("a.mp3", URL)
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
          { track_id: "c.mp3", file_name: "c.mp3", artist: "Sara Landry", title: "The Void" },
          { track_id: "d.mp3", file_name: "d.mp3", artist: "Kasia", title: "Tarantula" },
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
      await service.resolveByUrl("a.mp3", URL)
      transport.emit(urlRecoveryError("b.mp3"))

      await close()

      expect(service.urlRecoveryProgress()).toBeNull()
      expect(service.urlRecoveryBusy().size).toBe(0)
      expect(service.urlRecoveryErrors().size).toBe(0)
    })
  })
})
