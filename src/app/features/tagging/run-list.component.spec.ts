import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"
import { convertFileSrc } from "@tauri-apps/api/core"

import { PENDING_TRACK, arbitrationRequired } from "../../../fixtures/tagging"
import type { TaggingTrack } from "../../core/tagging-run.store"

import { RunListComponent } from "./run-list.component"

/** `convertFileSrc` n'existe pas hors Tauri : la mocker est le seul moyen de tester la vignette. */
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
}))

const TRACK: TaggingTrack = {
  ...PENDING_TRACK,
  state: "resolved",
  resolution: "auto",
  source: "beatport",
  after: { artist: "Adam Beyer", title: "Your Mind (Original Mix)" },
  scores: { artist: 96, title: 92, average: 94 },
  artworkPath: "C:/AppData/cache/artworks/abc.jpg",
}

const UNRESOLVED: TaggingTrack = {
  ...TRACK,
  state: "unresolved",
  resolution: "none",
  source: null,
  after: null,
  scores: null,
  artworkPath: null,
}

/**
 * Sans ces mesures, JSDOM n'en calculant aucune, `[virtualScroll]` ne monte pas une seule ligne.
 * Par `vi.spyOn` et non `Object.defineProperty` : le builder tourne en `isolate: false`, un stub
 * non restaure fuirait vers les specs suivantes (`showOnEllipsis` de `pTooltip`, entre autres).
 */
const stubOffscreenLayout = (): void => {
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockReturnValue(document.body)
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800)
}

const mountWith = async (
  tracks: readonly TaggingTrack[],
  recoverable: ReadonlySet<string> = new Set(),
) => {
  TestBed.configureTestingModule({
    imports: [RunListComponent],
    providers: [provideTranslateService()],
  })
  const fixture = TestBed.createComponent(RunListComponent)
  fixture.componentRef.setInput("tracks", tracks)
  fixture.componentRef.setInput("recoverable", recoverable)
  fixture.detectChanges()

  // Le scroller s'initialise sur un microtask puis calcule ses lignes dans un `setTimeout(…, 1)`.
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 1))
  fixture.detectChanges()

  return fixture
}

/** Les six colonnes de la seule ligne montee, dans l'ordre du template. */
const ART = 0
const BEFORE = 1
const AFTER = 2
const SOURCE = 3
const SCORE = 4

const cellOf = (fixture: { nativeElement: unknown }, column: number): HTMLElement | undefined =>
  (fixture.nativeElement as HTMLElement).querySelectorAll("td")[column]

const mainLineOf = (fixture: { nativeElement: unknown }): string | undefined =>
  cellOf(fixture, BEFORE)?.querySelector("app-truncated-text span")?.textContent.trim()

describe("RunListComponent", () => {
  beforeEach(() => {
    stubOffscreenLayout()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("converts an artwork path into an asset url", async () => {
    const fixture = await mountWith([TRACK])

    const image = (fixture.nativeElement as HTMLElement).querySelector("img")

    expect(convertFileSrc).toHaveBeenCalledWith(TRACK.artworkPath)
    expect(image?.getAttribute("src")).toBe(`asset://localhost/${TRACK.artworkPath}`)
  })

  it("falls back to a placeholder when a resolved track has no artwork", async () => {
    const fixture = await mountWith([{ ...TRACK, artworkPath: null }])

    const artCell = cellOf(fixture, ART)

    expect(artCell?.querySelector("img")).toBeNull()
    expect(artCell?.querySelector("p-skeleton")).toBeNull()
    expect(artCell?.querySelector('[data-p-icon="image"]')).not.toBeNull()
  })

  it("shows the placeholder and not the skeleton on a track without a source", async () => {
    const fixture = await mountWith([
      { ...TRACK, state: "unresolved", resolution: "none", artworkPath: null, after: null },
    ])

    const artCell = cellOf(fixture, ART)

    expect(artCell?.querySelector("p-skeleton")).toBeNull()
    expect(artCell?.querySelector('[data-p-icon="image"]')).not.toBeNull()
  })

  it("marks every valueless cell of an unresolved track with an em dash", async () => {
    const fixture = await mountWith([
      {
        ...TRACK,
        state: "unresolved",
        resolution: "none",
        source: null,
        after: null,
        scores: null,
      },
    ])

    const valueless = [AFTER, SOURCE, SCORE].map((column) =>
      cellOf(fixture, column)?.textContent.trim(),
    )

    expect(valueless).toEqual(["—", "—", "—"])
  })

  it("asks for the arbitration of a row that awaits one when it is clicked", async () => {
    const fixture = await mountWith([
      { ...PENDING_TRACK, arbitration: arbitrationRequired(PENDING_TRACK.trackId) },
    ])
    const asked = vi.fn()
    fixture.componentInstance.arbitrate.subscribe(asked)

    ;(fixture.nativeElement as HTMLElement).querySelector<HTMLElement>("tbody tr")?.click()

    expect(asked).toHaveBeenCalledWith(PENDING_TRACK.trackId)
  })

  it("asks for nothing when a row without arbitration is clicked", async () => {
    const fixture = await mountWith([TRACK])
    const asked = vi.fn()
    fixture.componentInstance.arbitrate.subscribe(asked)

    ;(fixture.nativeElement as HTMLElement).querySelector<HTMLElement>("tbody tr")?.click()

    expect(asked).not.toHaveBeenCalled()
  })

  it("asks to recover a recoverable row when it is clicked", async () => {
    const fixture = await mountWith([UNRESOLVED], new Set([UNRESOLVED.trackId]))
    const asked = vi.fn()
    fixture.componentInstance.recover.subscribe(asked)

    ;(fixture.nativeElement as HTMLElement).querySelector<HTMLElement>("tbody tr")?.click()

    expect(asked).toHaveBeenCalledWith(UNRESOLVED.trackId)
  })

  it("asks to recover nothing when a row that is not recoverable is clicked", async () => {
    const fixture = await mountWith([UNRESOLVED])
    const asked = vi.fn()
    fixture.componentInstance.recover.subscribe(asked)

    ;(fixture.nativeElement as HTMLElement).querySelector<HTMLElement>("tbody tr")?.click()

    expect(asked).not.toHaveBeenCalled()
  })

  it.each(["Enter", " "])(
    "asks to recover a recoverable row from the keyboard (%j)",
    async (key) => {
      const fixture = await mountWith([UNRESOLVED], new Set([UNRESOLVED.trackId]))
      const asked = vi.fn()
      fixture.componentInstance.recover.subscribe(asked)
      const row = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>("tbody tr")

      row?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))

      expect(row?.tabIndex).toBe(0)
      expect(asked).toHaveBeenCalledWith(UNRESOLVED.trackId)
    },
  )

  it("keeps a row without action out of the tab order", async () => {
    const fixture = await mountWith([UNRESOLVED])

    const row = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>("tbody tr")

    expect(row?.hasAttribute("tabindex")).toBe(false)
  })

  it("hints at pasting a link on an unresolved recoverable row only", async () => {
    const recoverable = await mountWith([UNRESOLVED], new Set([UNRESOLVED.trackId]))
    const hinted = cellOf(recoverable, AFTER)?.querySelector("[data-recover-hint]")
    TestBed.resetTestingModule()
    stubOffscreenLayout()
    const plain = await mountWith([UNRESOLVED])

    expect(hinted).not.toBeNull()
    expect(cellOf(plain, AFTER)?.querySelector("[data-recover-hint]")).toBeNull()
  })

  it("shows the file name without its extension as the main line when the tags are empty", async () => {
    const fixture = await mountWith([{ ...TRACK, artist: "", title: "" }])

    expect(mainLineOf(fixture)).toBe("a")
    expect(cellOf(fixture, BEFORE)?.textContent).toContain("a.mp3")
  })

  it("shows only the artist, without an orphan separator, when the title is empty", async () => {
    const fixture = await mountWith([{ ...TRACK, title: "" }])

    expect(mainLineOf(fixture)).toBe(TRACK.artist)
  })

  it("shows only the title, without an orphan separator, when the artist is empty", async () => {
    const fixture = await mountWith([{ ...TRACK, artist: "" }])

    expect(mainLineOf(fixture)).toBe(TRACK.title)
  })
})
