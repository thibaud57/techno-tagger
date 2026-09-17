import { TestBed } from "@angular/core/testing"
import { vi } from "vitest"

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

  it("reports no mismatch when the versions match", async () => {
    await service.start()

    transport.emit({ event: "version", version: APP_VERSION, api_key_configured: true })

    expect(service.versionMismatch()).toBeNull()
  })

  it("reports the mismatch with both versions", async () => {
    await service.start()

    transport.emit({ event: "version", version: "0.0.1-old", api_key_configured: false })

    expect(service.versionMismatch()).toEqual({ ui: APP_VERSION, sidecar: "0.0.1-old" })
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

    expect(service.lastError()).toEqual({
      event: "error",
      code: "sidecar_unavailable",
      params: {},
      message: "sidecar unavailable",
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
    transport.emit({ event: "error", code: "playlist_file_unreadable", params: {}, message: "x" })

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

  it("feeds the result and ends the run", async () => {
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
    expect(service.progress()).toBeNull()
    expect(service.extracting()).toBe(false)
  })

  it("feeds the error without interrupting the stream", async () => {
    await service.start()

    transport.emit({ event: "error", code: "playlist_not_found", params: {}, message: "x" })
    transport.emit({ event: "version", version: APP_VERSION, api_key_configured: false })

    expect(service.lastError()?.code).toBe("playlist_not_found")
    expect(service.version()).toBe(APP_VERSION)
  })

  it("ends the run on an error", async () => {
    await service.start()
    await service.extractPlaylist(EXTRACTION)
    transport.emit({ event: "progress", phase: "extraction", processed: 5, total: 5 })

    transport.emit({ event: "error", code: "report_write_failed", params: {}, message: "x" })

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

  it("writes a command as a single newline-terminated line", async () => {
    await service.start()

    await service.extractPlaylist(EXTRACTION)

    const line = transport.sent.at(-1) ?? ""
    expect(line.endsWith("\n")).toBe(true)
    expect(commandOf(line)).toBe("extract_playlist")
  })
})
