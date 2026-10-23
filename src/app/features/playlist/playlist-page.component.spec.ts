import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { provideRouter } from "@angular/router"
import { provideTranslateService } from "@ngx-translate/core"
import { vi } from "vitest"

import { heightClassPx } from "../../../fixtures/dom"
import { EMPTY_EXTRACTION, EXTRACTION_REQUEST } from "../../../fixtures/extraction"
import { type NativeStub, nativeStub } from "../../../fixtures/native-stub"
import { type PreferencesStub, preferencesStub } from "../../../fixtures/preferences-stub"
import { stubNavigation } from "../../../fixtures/router"
import {
  type SidecarStubOverrides,
  commandFailed,
  provideSidecarStub,
  sidecarStub,
} from "../../../fixtures/sidecar-stub"
import { NativeService } from "../../core/platform/native.service"
import { PreferencesService } from "../../core/platform/preferences.service"
import type { PlaylistFormat } from "../../core/sidecar/protocol"

import PlaylistPageComponent, {
  REPORT_ROW_CLASS,
  REPORT_ROW_HEIGHT,
} from "./playlist-page.component"

interface Natives {
  native?: NativeStub
  preferences?: PreferencesStub
}

const mountWith = (
  overrides: SidecarStubOverrides = {},
  { native = nativeStub(), preferences = preferencesStub() }: Natives = {},
) => {
  const service = sidecarStub(overrides)

  TestBed.configureTestingModule({
    imports: [PlaylistPageComponent],
    providers: [
      provideTranslateService(),
      provideRouter([]),
      provideSidecarStub(service),
      { provide: NativeService, useValue: native },
      { provide: PreferencesService, useValue: preferences },
    ],
  })
  const navigate = stubNavigation("navigate")
  const fixture = TestBed.createComponent(PlaylistPageComponent)

  return { fixture, component: fixture.componentInstance, service, navigate, preferences }
}

const choosePlaylist = (component: PlaylistPageComponent, name: string | null): void => {
  component["choice"].update((current) => ({ ...current, playlist: name }))
}

const withAllPathsChosen = (component: PlaylistPageComponent): void => {
  component["sourceFolder"].set(EXTRACTION_REQUEST.source_folder)
  component["destinationFolder"].set(EXTRACTION_REQUEST.destination_folder)
  component["playlistPath"].set(EXTRACTION_REQUEST.playlist_path)
  choosePlaylist(component, EXTRACTION_REQUEST.playlist_name)
}

describe("PlaylistPageComponent", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Une ligne d'une autre hauteur ferait sauter le defilement virtuel.
  it("sizes the virtual scroll on the height of the report row class", () => {
    expect(heightClassPx(REPORT_ROW_CLASS)).toBe(REPORT_ROW_HEIGHT)
  })

  it("restores the choices of the last extraction when the tab is reopened", () => {
    const extractionRequest = signal(EXTRACTION_REQUEST)

    const { component } = mountWith({
      extractionRequest,
      listedPlaylistPath: signal(EXTRACTION_REQUEST.playlist_path),
    })

    expect([
      component["sourceFolder"](),
      component["destinationFolder"](),
      component["playlistPath"](),
      component["choice"]().playlist,
    ]).toEqual([
      EXTRACTION_REQUEST.source_folder,
      EXTRACTION_REQUEST.destination_folder,
      EXTRACTION_REQUEST.playlist_path,
      EXTRACTION_REQUEST.playlist_name,
    ])
  })

  it("restores the file listed since the last extraction, without its playlist", () => {
    const listedPlaylistPath = signal("C:/x/samedi.m3u8")

    const { component } = mountWith({
      extractionRequest: signal(EXTRACTION_REQUEST),
      listedPlaylistPath,
    })

    expect([component["playlistPath"](), component["choice"]().playlist]).toEqual([
      "C:/x/samedi.m3u8",
      null,
    ])
  })

  it("reopens the form on request once the extraction is over", () => {
    const { component } = mountWith({ extraction: signal(EMPTY_EXTRACTION) })

    component["expandForm"]()

    expect(component["formCollapsed"]()).toBe(false)
  })

  it("collapses the form again when the next extraction starts", () => {
    const extracting = signal(false)
    const { component } = mountWith({ extracting, extraction: signal(EMPTY_EXTRACTION) })
    component["expandForm"]()

    extracting.set(true)

    expect(component["formCollapsed"]()).toBe(true)
  })

  it("names the playlist of the displayed run in the summary", () => {
    const extractionRequest = signal(EXTRACTION_REQUEST)

    const { component } = mountWith({ extractionRequest })

    expect(component["lastRunPlaylist"]()).toBe("set")
  })

  it("names an M3U8 run by its file name", () => {
    const extractionRequest = signal({
      ...EXTRACTION_REQUEST,
      playlist_path: "C:\\sets\\samedi.m3u8",
      playlist_name: null,
    })

    const { component } = mountWith({ extractionRequest })

    expect(component["lastRunPlaylist"]()).toBe("samedi.m3u8")
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
      ...commandFailed("list_playlists", "vlc_schema_mismatch"),
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

  it("allows extraction on an M3U8 without a selected playlist", () => {
    const { component } = mountWith({
      playlistFormat: signal<PlaylistFormat>("m3u8"),
      playlists: signal([]),
    })
    withAllPathsChosen(component)

    choosePlaylist(component, null)

    expect(component["canExtract"]()).toBe(true)
  })

  it.each<{
    case: string
    overrides: SidecarStubOverrides
    choose: (component: PlaylistPageComponent) => void
  }>([
    {
      case: "a path is missing",
      overrides: {},
      choose: (component) => {
        component["sourceFolder"].set(EXTRACTION_REQUEST.source_folder)
      },
    },
    {
      case: "the sidecar is not ready",
      overrides: { ready: signal(false) },
      choose: withAllPathsChosen,
    },
    { case: "a run searches", overrides: { tagging: signal(true) }, choose: withAllPathsChosen },
    {
      case: "a dump has no playlist selected",
      overrides: {},
      choose: (component) => {
        withAllPathsChosen(component)
        choosePlaylist(component, null)
      },
    },
    {
      case: "the sidecar has not announced the format",
      overrides: { playlistFormat: signal(null) },
      choose: (component) => {
        withAllPathsChosen(component)
        choosePlaylist(component, null)
      },
    },
  ])("blocks extraction while $case", ({ overrides, choose }) => {
    const { component } = mountWith(overrides)

    choose(component)

    expect(component["canExtract"]()).toBe(false)
  })

  it("says why extraction is blocked while a run searches", () => {
    const { component } = mountWith({ tagging: signal(true) })

    withAllPathsChosen(component)

    expect(component["extractHint"]()).toBe("playlist.blocked.tagging")
  })

  it("awaits the listing of a chosen file until the sidecar answers", () => {
    const { component } = mountWith({
      playlistFormat: signal(null),
      playlists: signal([]),
      listingPending: signal(true),
    })

    component["playlistPath"].set("C:/x/vlc_media.db")

    expect(component["awaitsPlaylists"]()).toBe(true)
  })

  // Un listage refuse puis un passage par les Reglages ont efface `lastError` : le fichier
  // restaure sans format ne doit plus se lire comme une attente.
  it("asks for the file again when its listing failed and the error is gone", () => {
    const { component } = mountWith({
      playlistFormat: signal(null),
      playlists: signal([]),
      listedPlaylistPath: signal("C:/x/vlc_media.db"),
      listingPending: signal(false),
      lastError: signal(null),
    })

    expect([component["awaitsPlaylists"](), component["missingChoices"]()]).toEqual([
      false,
      expect.arrayContaining(["playlist.missing.file"]),
    ])
  })

  it.each([
    { format: "vlc_dump", outcome: "shows", expected: true },
    { format: "m3u8", outcome: "hides", expected: false },
  ] as const)("$outcome the playlist selector for a $format", ({ format, expected }) => {
    const { component } = mountWith({ playlistFormat: signal(format) })

    expect(component["showsPlaylistSelector"]()).toBe(expected)
  })

  it("defaults to copy", () => {
    const { component } = mountWith()

    expect(component["choice"]().mode).toBe("copy")
  })

  it("restores the mode stored at the previous run", async () => {
    const { fixture, component } = mountWith(
      {},
      { preferences: preferencesStub({ extractionMode: "move" }) },
    )

    await fixture.whenStable()

    expect(component["choice"]().mode).toBe("move")
  })

  it("keeps the chosen folder when the dialog is cancelled", async () => {
    const { component } = mountWith({}, { native: nativeStub(null) })
    component["sourceFolder"].set("C:/lib")

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

    expect(service.extractPlaylist).toHaveBeenCalledWith(EXTRACTION_REQUEST)
  })

  it("sends no command while extraction is unavailable", async () => {
    const { component, service } = mountWith({ ready: signal(false) })
    withAllPathsChosen(component)

    await component["extract"]()

    expect(service.extractPlaylist).not.toHaveBeenCalled()
  })

  it("memorizes the destination when starting an extraction", async () => {
    const { component, preferences } = mountWith()
    withAllPathsChosen(component)

    await component["extract"]()

    expect(preferences.writeLastDestination).toHaveBeenCalledWith(
      EXTRACTION_REQUEST.destination_folder,
    )
  })

  it("navigates to the tagging tab when asked to go on with the extracted folder", () => {
    const { component, navigate } = mountWith({ extraction: signal(EMPTY_EXTRACTION) })

    component["goTagging"]()

    expect(navigate).toHaveBeenCalledWith(["tagging"])
  })
})
