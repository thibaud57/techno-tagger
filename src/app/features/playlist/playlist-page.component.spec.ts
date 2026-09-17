import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"
import { open } from "@tauri-apps/plugin-dialog"
import { load, type Store } from "@tauri-apps/plugin-store"

import { SidecarService } from "../../core/sidecar.service"

import PlaylistPageComponent from "./playlist-page.component"

/**
 * Le selecteur de fichier de Tauri n'existe pas sous Vitest : `open` y rejette.
 * Le mocker est la seule facon d'atteindre le code qui suit le choix du fichier.
 */
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(() => Promise.resolve("C:/x/vlc_media.db")),
}))

/** Store indisponible par defaut, comme hors Tauri, sauf quand un test fournit le sien. */
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(() => Promise.reject(new TypeError("store unavailable"))),
}))

/**
 * Ce qui se teste ici est la disponibilite de l'action et la commande emise :
 * le reste de l'ecran affiche ce qu'il recoit, et tester qu'un `@if` masque un
 * bloc reviendrait a tester Angular.
 */
function mountWith(overrides: Partial<Record<string, unknown>> = {}) {
  const service = {
    ready: signal(true),
    extracting: signal(false),
    available: signal(true),
    version: signal("1.0.0"),
    versionMismatch: signal(null),
    playlistFormat: signal<"vlc_dump" | "m3u8" | null>("vlc_dump"),
    playlists: signal([{ playlist_id: 1, name: "set", track_count: 8 }]),
    progress: signal(null),
    extraction: signal(null),
    lastError: signal(null),
    listPlaylists: vi.fn(),
    extractPlaylist: vi.fn(),
    ...overrides,
  }

  TestBed.configureTestingModule({
    imports: [PlaylistPageComponent],
    providers: [provideTranslateService(), { provide: SidecarService, useValue: service }],
  })

  const fixture = TestBed.createComponent(PlaylistPageComponent)

  return { fixture, component: fixture.componentInstance, service }
}

/** Acces par crochets aux membres `protected` : piloter l'ecran sans elargir sa surface. */
function withAllPathsChosen(component: PlaylistPageComponent): void {
  component["sourceFolder"].set("C:/lib")
  component["destinationFolder"].set("C:/work")
  component["playlistPath"].set("C:/x/vlc_media.db")
  choosePlaylist(component, "set")
}

function choosePlaylist(component: PlaylistPageComponent, name: string | null): void {
  component["choice"].update((current) => ({ ...current, playlist: name }))
}

describe("PlaylistPageComponent", () => {
  afterEach(() => {
    vi.resetAllMocks()
  })

  it("blocks extraction while a path is missing", () => {
    const { component } = mountWith()

    component["sourceFolder"].set("C:/lib")

    expect(component["canExtract"]()).toBe(false)
  })

  it("names every choice still missing", () => {
    const { component } = mountWith({ playlistFormat: signal(null), playlists: signal([]) })

    component["sourceFolder"].set("C:/lib")

    expect(component["missingChoices"]()).toEqual([
      "playlist.missing.destination",
      "playlist.missing.file",
    ])
  })

  it("asks for the file again when its listing failed", () => {
    const { component } = mountWith({
      playlistFormat: signal(null),
      playlists: signal([]),
      lastError: signal({ event: "error", code: "vlc_schema_mismatch", params: {}, message: "" }),
    })
    component["sourceFolder"].set("C:/lib")
    component["destinationFolder"].set("C:/work")

    component["playlistPath"].set("C:/x/vlc_media.db")

    expect(component["missingChoices"]()).toEqual(["playlist.missing.file"])
  })

  it("asks for a playlist once a dump is listed", () => {
    const { component } = mountWith()
    withAllPathsChosen(component)

    choosePlaylist(component, null)

    expect(component["missingChoices"]()).toEqual(["playlist.missing.playlist"])
  })

  it("blocks extraction on a dump with no playlist selected", () => {
    const { component } = mountWith()
    withAllPathsChosen(component)

    choosePlaylist(component, null)

    expect(component["canExtract"]()).toBe(false)
  })

  it("allows extraction on an M3U8 without a selected playlist", () => {
    const { component } = mountWith({ playlistFormat: signal("m3u8"), playlists: signal([]) })
    withAllPathsChosen(component)

    choosePlaylist(component, null)

    expect(component["canExtract"]()).toBe(true)
  })

  it("blocks extraction while the sidecar is not ready", () => {
    const { component } = mountWith({ ready: signal(false) })

    withAllPathsChosen(component)

    expect(component["canExtract"]()).toBe(false)
  })

  it("blocks extraction until the sidecar announces the format", () => {
    const { component } = mountWith({ playlistFormat: signal(null) })
    withAllPathsChosen(component)

    choosePlaylist(component, null)

    expect(component["canExtract"]()).toBe(false)
  })

  it("awaits the listing of a chosen file until the sidecar answers", () => {
    const { component } = mountWith({ playlistFormat: signal(null), playlists: signal([]) })

    component["playlistPath"].set("C:/x/vlc_media.db")

    expect(component["awaitsPlaylists"]()).toBe(true)
  })

  it("offers the playlist selector only for a VLC dump", () => {
    const { component } = mountWith()

    expect(component["showsPlaylistSelector"]()).toBe(true)
  })

  it("offers no playlist selector for an M3U8", () => {
    const { component } = mountWith({ playlistFormat: signal("m3u8") })

    expect(component["showsPlaylistSelector"]()).toBe(false)
  })

  it("defaults to copy", () => {
    const { component } = mountWith()

    expect(component["choice"]().mode).toBe("copy")
  })

  it("restores the mode stored at the previous run", async () => {
    vi.mocked(load).mockResolvedValueOnce({
      get: () => Promise.resolve("move"),
    } as unknown as Store)
    const { fixture, component } = mountWith()

    await fixture.whenStable()

    expect(component["choice"]().mode).toBe("move")
  })

  it("locks the choices while an extraction runs", () => {
    const { component } = mountWith({ extracting: signal(true) })

    const locked = [
      component["fields"].mode().disabled(),
      component["fields"].playlist().disabled(),
    ]

    expect(locked).toEqual([true, true])
  })

  it("requests no listing while an extraction runs", async () => {
    const { component, service } = mountWith({ extracting: signal(true) })

    await component["choosePlaylistFile"]()

    expect(service.listPlaylists).not.toHaveBeenCalled()
  })

  it("keeps the chosen folder when the dialog is cancelled", async () => {
    const { component } = mountWith()
    component["sourceFolder"].set("C:/lib")
    vi.mocked(open).mockResolvedValueOnce(null)

    await component["chooseFolder"](component["sourceFolder"])

    expect(component["sourceFolder"]()).toBe("C:/lib")
  })

  it("requests the playlist listing as soon as a file is chosen", async () => {
    const { component, service } = mountWith()

    await component["choosePlaylistFile"]()

    expect(service.listPlaylists).toHaveBeenCalledWith("C:/x/vlc_media.db")
  })

  it("sends a command carrying the paths, the playlist and the mode", async () => {
    const { component, service } = mountWith()
    withAllPathsChosen(component)

    await component["extract"]()

    expect(service.extractPlaylist).toHaveBeenCalledWith({
      source_folder: "C:/lib",
      destination_folder: "C:/work",
      playlist_path: "C:/x/vlc_media.db",
      playlist_name: "set",
      mode: "copy",
    })
  })

  it("sends no command while extraction is unavailable", async () => {
    const { component, service } = mountWith({ ready: signal(false) })
    withAllPathsChosen(component)

    await component["extract"]()

    expect(service.extractPlaylist).not.toHaveBeenCalled()
  })
})
