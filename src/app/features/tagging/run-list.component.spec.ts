import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"
import { convertFileSrc } from "@tauri-apps/api/core"

import {
  PENDING_TRACK,
  TAGS_AFTER,
  TAGS_BEFORE,
  arbitrationRequired,
} from "../../../fixtures/tagging"
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
  frozen = false,
) => {
  TestBed.configureTestingModule({
    imports: [RunListComponent],
    providers: [provideTranslateService()],
  })
  const fixture = TestBed.createComponent(RunListComponent)
  fixture.componentRef.setInput("tracks", tracks)
  fixture.componentRef.setInput("recoverable", recoverable)
  fixture.componentRef.setInput("frozen", frozen)
  fixture.detectChanges()

  // Le scroller s'initialise sur un microtask puis calcule ses lignes dans un `setTimeout(…, 1)`.
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 1))
  fixture.detectChanges()

  return fixture
}

/** Laisse le tiroir (rendu dans `body`) et le scroller digerer un changement d'entree ou de clic. */
const settle = async (fixture: { detectChanges: () => void; whenStable: () => Promise<void> }) => {
  await fixture.whenStable()
  await new Promise((resolve) => setTimeout(resolve, 1))
  fixture.detectChanges()
}

/** Les sept colonnes de la seule ligne montee, dans l'ordre du template. */
const ART = 1
const BEFORE = 2
const AFTER = 3
const SOURCE = 4
const SCORE = 5

const cellOf = (fixture: { nativeElement: unknown }, column: number): HTMLElement | undefined =>
  (fixture.nativeElement as HTMLElement).querySelectorAll("td")[column]

const mainLineOf = (fixture: { nativeElement: unknown }): string | undefined =>
  cellOf(fixture, BEFORE)?.querySelector("app-truncated-text span")?.textContent.trim()

const togglesOf = (fixture: { nativeElement: unknown }): HTMLElement[] => [
  ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>("[data-row-toggle]"),
]

const toggleOf = (fixture: { nativeElement: unknown }, index = 0): HTMLElement | null =>
  togglesOf(fixture)[index] ?? null

/** Le tiroir est rendu hors de l'hote (`appendTo="body"`) : on le cherche dans le document. */
const drawerDetail = (): Element | null => document.querySelector("app-track-detail")
const drawerHeader = (): string | undefined =>
  document.querySelector(".p-drawer-header")?.textContent.trim()

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

  it("leaves the rows of a committed run without action", async () => {
    const fixture = await mountWith(
      [{ ...PENDING_TRACK, arbitration: arbitrationRequired(PENDING_TRACK.trackId) }, UNRESOLVED],
      new Set([UNRESOLVED.trackId]),
      true,
    )
    const asked = vi.fn()
    fixture.componentInstance.arbitrate.subscribe(asked)
    fixture.componentInstance.recover.subscribe(asked)
    const root = fixture.nativeElement as HTMLElement
    const rows = root.querySelectorAll<HTMLElement>("tbody tr")

    rows.forEach((row) => {
      row.click()
    })

    expect(asked).not.toHaveBeenCalled()
    expect([...rows].some((row) => row.hasAttribute("tabindex"))).toBe(false)
    expect(root.querySelector("p-skeleton")).toBeNull()
    expect(root.textContent).toContain("tagging.state.notProcessed")
  })

  it("hints at pasting a link on an unresolved recoverable row only", async () => {
    const recoverable = await mountWith([UNRESOLVED], new Set([UNRESOLVED.trackId]))
    const hinted = cellOf(recoverable, AFTER)?.querySelector("[data-recover-hint]")
    TestBed.resetTestingModule()
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

  it("shows the track detail in the drawer and hides it on a second click, without asking for arbitration", async () => {
    const fixture = await mountWith([
      {
        ...PENDING_TRACK,
        tagsBefore: TAGS_BEFORE,
        arbitration: arbitrationRequired(PENDING_TRACK.trackId),
      },
    ])
    const asked = vi.fn()
    fixture.componentInstance.arbitrate.subscribe(asked)

    toggleOf(fixture)?.click()
    await settle(fixture)
    const shown = drawerDetail() !== null
    const pressed = toggleOf(fixture)?.getAttribute("aria-pressed")
    const highlighted = (fixture.nativeElement as HTMLElement)
      .querySelector("tbody tr")
      ?.hasAttribute("data-shown")
    toggleOf(fixture)?.click()
    await settle(fixture)

    expect(shown).toBe(true)
    expect(pressed).toBe("true")
    expect(highlighted).toBe(true)
    expect(drawerDetail()).toBeNull()
    expect(toggleOf(fixture)?.getAttribute("aria-pressed")).toBe("false")
    expect(asked).not.toHaveBeenCalled()
  })

  it("titles the drawer with the resolved line, or the main line while the track is unresolved", async () => {
    const fixture = await mountWith([TRACK])
    toggleOf(fixture)?.click()
    await settle(fixture)
    const resolved = drawerHeader()
    TestBed.resetTestingModule()
    const other = await mountWith([UNRESOLVED])

    toggleOf(other)?.click()
    await settle(other)

    expect(resolved).toBe("Adam Beyer - Your Mind (Original Mix)")
    expect(drawerHeader()).toBe("Adam Beyer - Your Mind")
  })

  it("replaces the detail shown when the chevron of another row is clicked", async () => {
    const other: TaggingTrack = {
      ...PENDING_TRACK,
      trackId: "b.mp3",
      fileName: "b.mp3",
      artist: "Amelie Lens",
      title: "Basiel",
    }
    const fixture = await mountWith([{ ...PENDING_TRACK, tagsBefore: TAGS_BEFORE }, other])

    toggleOf(fixture, 0)?.click()
    await settle(fixture)
    toggleOf(fixture, 1)?.click()
    await settle(fixture)

    expect(document.querySelectorAll("app-track-detail")).toHaveLength(1)
    expect(drawerHeader()).toBe("Amelie Lens - Basiel")
    expect(toggleOf(fixture, 0)?.getAttribute("aria-pressed")).toBe("false")
    expect(toggleOf(fixture, 1)?.getAttribute("aria-pressed")).toBe("true")
  })

  it.each(["Enter", " "])("keeps the chevron keys away from the row action (%j)", async (key) => {
    const fixture = await mountWith([
      { ...PENDING_TRACK, arbitration: arbitrationRequired(PENDING_TRACK.trackId) },
    ])
    const asked = vi.fn()
    fixture.componentInstance.arbitrate.subscribe(asked)

    toggleOf(fixture)?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))

    expect(toggleOf(fixture)).not.toBeNull()
    expect(asked).not.toHaveBeenCalled()
  })

  it("shows the detail of a recoverable row without asking to recover it", async () => {
    const fixture = await mountWith([UNRESOLVED], new Set([UNRESOLVED.trackId]))
    const asked = vi.fn()
    fixture.componentInstance.recover.subscribe(asked)

    toggleOf(fixture)?.click()
    await settle(fixture)

    expect(asked).not.toHaveBeenCalled()
    expect(drawerDetail()).not.toBeNull()
  })

  it("makes the detail follow its track when it is resolved", async () => {
    const fixture = await mountWith([{ ...PENDING_TRACK, tagsBefore: TAGS_BEFORE }])
    toggleOf(fixture)?.click()
    await settle(fixture)

    fixture.componentRef.setInput("tracks", [
      { ...TRACK, tagsBefore: TAGS_BEFORE, tagsAfter: TAGS_AFTER },
    ])
    await settle(fixture)

    expect(drawerDetail()?.textContent).toContain("Adam Beyer")
    expect(drawerHeader()).toBe("Adam Beyer - Your Mind (Original Mix)")
  })

  it("closes the drawer when the shown track leaves the list", async () => {
    const fixture = await mountWith([{ ...PENDING_TRACK, tagsBefore: TAGS_BEFORE }])
    toggleOf(fixture)?.click()
    await settle(fixture)

    fixture.componentRef.setInput("tracks", [
      { ...PENDING_TRACK, trackId: "z.mp3", fileName: "z.mp3" },
    ])
    await settle(fixture)

    expect(drawerDetail()).toBeNull()
  })

  it("keeps the drawer closed when a track of the same id comes back with a new run", async () => {
    const first = { ...PENDING_TRACK, tagsBefore: TAGS_BEFORE }
    const fixture = await mountWith([first])
    toggleOf(fixture)?.click()
    await settle(fixture)
    fixture.componentRef.setInput("tracks", [{ ...PENDING_TRACK, trackId: "z.mp3" }])
    await settle(fixture)

    fixture.componentRef.setInput("tracks", [first])
    await settle(fixture)

    expect(drawerDetail()).toBeNull()
  })
})
