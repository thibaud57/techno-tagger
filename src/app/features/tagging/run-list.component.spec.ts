import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"
import { convertFileSrc } from "@tauri-apps/api/core"

import {
  PENDING_TRACK,
  TAGS_AFTER,
  TAGS_BEFORE,
  arbitrationRequired,
  resolvedTrack,
} from "../../../fixtures/tagging"
import { settleScroller as settle, stubOffscreenLayout } from "../../../fixtures/virtual-scroll"
import type { TaggingTrack } from "../../core/tagging-run.store"

import { RunListComponent } from "./run-list.component"

/** `convertFileSrc` n'existe pas hors Tauri : la mocker est le seul moyen de tester la vignette. */
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
}))

const TRACK: TaggingTrack = {
  ...resolvedTrack(PENDING_TRACK.trackId),
  source: "beatport",
  after: { artist: "Lior Vance", title: "Dim Orbit (Original Mix)" },
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
  vi.advanceTimersByTime(1)
  fixture.detectChanges()

  return fixture
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

const rowsOf = (fixture: { nativeElement: unknown }): HTMLElement[] => [
  ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>("tbody tr"),
]

const carriersOf = (fixture: { nativeElement: unknown }): HTMLElement[] =>
  rowsOf(fixture).filter((row) => row.hasAttribute("data-detail-carrier"))

const kindsOf = (fixture: { nativeElement: unknown }): string[] =>
  rowsOf(fixture).map((row) => {
    if (row.hasAttribute("data-detail-carrier")) {
      return "carrier"
    }

    return row.getAttribute("aria-hidden") === "true" ? "filler" : "track"
  })

const fillersOf = (fixture: { nativeElement: unknown }): HTMLElement[] =>
  rowsOf(fixture).filter((row) => row.getAttribute("aria-hidden") === "true")

const detailsOf = (fixture: { nativeElement: unknown }): HTMLElement[] => [
  ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>("app-track-detail"),
]

describe("RunListComponent", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    stubOffscreenLayout()
  })

  afterEach(() => {
    vi.useRealTimers()
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

  it.each([
    { name: "a run in progress", frozen: false, skeleton: true },
    { name: "a settled run", frozen: true, skeleton: false },
  ])(
    "shows a skeleton artwork for a track awaiting its turn only in $name",
    async ({ frozen, skeleton }) => {
      const fixture = await mountWith([PENDING_TRACK], new Set(), frozen)

      const artCell = cellOf(fixture, ART)

      expect(artCell?.querySelector("p-skeleton") !== null).toBe(skeleton)
    },
  )

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
    // Sur un run fige le service ne rend aucun morceau rattrapable : l'ensemble arrive vide.
    const fixture = await mountWith(
      [{ ...PENDING_TRACK, arbitration: arbitrationRequired(PENDING_TRACK.trackId) }, UNRESOLVED],
      new Set(),
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

  it("opens the detail under its row on one carrier row followed by aria-hidden fillers, and closes it on a second click, without asking for arbitration", async () => {
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
    const opened = kindsOf(fixture)
    const highlighted = rowsOf(fixture)[0]?.hasAttribute("data-shown")
    const expanded = toggleOf(fixture)?.getAttribute("aria-expanded")
    const openIcon = toggleOf(fixture)?.querySelector("[data-p-icon]")?.getAttribute("data-p-icon")
    toggleOf(fixture)?.click()
    await settle(fixture)

    expect(opened).toEqual(["track", "carrier", ...Array<string>(6).fill("filler")])
    expect(highlighted).toBe(true)
    expect(expanded).toBe("true")
    expect(openIcon).toBe("chevron-down")
    expect(rowsOf(fixture)).toHaveLength(1)
    expect(toggleOf(fixture)?.getAttribute("aria-expanded")).toBe("false")
    expect(toggleOf(fixture)?.querySelector("[data-p-icon]")?.getAttribute("data-p-icon")).toBe(
      "chevron-right",
    )
    expect(rowsOf(fixture)[0]?.hasAttribute("data-shown")).toBe(false)
    expect(asked).not.toHaveBeenCalled()
  })

  it("puts the detail inside the carrier row and keeps every row at the scroller height", async () => {
    const fixture = await mountWith([{ ...PENDING_TRACK, tagsBefore: TAGS_BEFORE }])

    toggleOf(fixture)?.click()
    await settle(fixture)

    expect(carriersOf(fixture)[0]?.querySelector("app-track-detail")).not.toBeNull()
    expect(fillersOf(fixture).every((row) => row.querySelector("app-track-detail") === null)).toBe(
      true,
    )
    expect(rowsOf(fixture).every((row) => row.classList.contains("h-14"))).toBe(true)
  })

  it.each([
    ["readable tags", { tagsBefore: TAGS_BEFORE }, new Set<string>(), 7],
    ["the restore button", { tagsBefore: TAGS_BEFORE }, new Set([PENDING_TRACK.trackId]), 7],
    ["unreadable tags", {}, new Set<string>(), 4],
  ] as const)(
    "sizes the detail frame on its content (%s)",
    async (_case, tags, restorable, span) => {
      const fixture = await mountWith([{ ...PENDING_TRACK, ...tags }])
      fixture.componentRef.setInput("restorableIds", restorable)
      await settle(fixture)

      toggleOf(fixture)?.click()
      await settle(fixture)

      expect(rowsOf(fixture)).toHaveLength(1 + span)
      expect(carriersOf(fixture)[0]?.querySelector<HTMLElement>("td > div")?.style.height).toBe(
        `${span * 56}px`,
      )
    },
  )

  it("opens a second detail while the first stays open", async () => {
    const other: TaggingTrack = {
      ...PENDING_TRACK,
      trackId: "b.mp3",
      fileName: "b.mp3",
      artist: "Orla Quenby",
      title: "Kelvor",
    }
    const fixture = await mountWith([
      { ...PENDING_TRACK, tagsBefore: TAGS_BEFORE },
      { ...other, tagsBefore: TAGS_BEFORE },
    ])

    toggleOf(fixture, 0)?.click()
    await settle(fixture)
    toggleOf(fixture, 1)?.click()
    await settle(fixture)

    expect(detailsOf(fixture)).toHaveLength(2)
    expect(toggleOf(fixture, 0)?.getAttribute("aria-expanded")).toBe("true")
    expect(toggleOf(fixture, 1)?.getAttribute("aria-expanded")).toBe("true")
    expect(rowsOf(fixture)).toHaveLength(16)
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
    expect(detailsOf(fixture)).toHaveLength(1)
  })

  it("makes the detail follow its track when it is resolved", async () => {
    const fixture = await mountWith([{ ...PENDING_TRACK, tagsBefore: TAGS_BEFORE }])
    toggleOf(fixture)?.click()
    await settle(fixture)

    fixture.componentRef.setInput("tracks", [
      { ...TRACK, tagsBefore: TAGS_BEFORE, tagsAfter: TAGS_AFTER },
    ])
    await settle(fixture)

    expect(detailsOf(fixture)).toHaveLength(1)
    expect(detailsOf(fixture)[0]?.textContent).toContain("Lior Vance")
  })

  it("closes the detail when its track leaves the list", async () => {
    const fixture = await mountWith([{ ...PENDING_TRACK, tagsBefore: TAGS_BEFORE }])
    toggleOf(fixture)?.click()
    await settle(fixture)

    fixture.componentRef.setInput("tracks", [
      { ...PENDING_TRACK, trackId: "z.mp3", fileName: "z.mp3" },
    ])
    await settle(fixture)

    expect(detailsOf(fixture)).toHaveLength(0)
    expect(fillersOf(fixture)).toHaveLength(0)
  })

  it("keeps the detail closed when a track of the same id comes back with a new run", async () => {
    const first = { ...PENDING_TRACK, tagsBefore: TAGS_BEFORE }
    const fixture = await mountWith([first])
    toggleOf(fixture)?.click()
    await settle(fixture)
    fixture.componentRef.setInput("tracks", [{ ...PENDING_TRACK, trackId: "z.mp3" }])
    await settle(fixture)

    fixture.componentRef.setInput("tracks", [first])
    await settle(fixture)

    expect(detailsOf(fixture)).toHaveLength(0)
  })
})
