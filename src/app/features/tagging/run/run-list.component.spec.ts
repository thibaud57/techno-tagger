import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"
import { vi } from "vitest"

import { type Hosted, hostOf, iconOf } from "../../../../fixtures/dom"
import { nativeStub } from "../../../../fixtures/native-stub"
import {
  PENDING_TRACK,
  RESOLVED_TRACK,
  TAGS_AFTER,
  TAGS_BEFORE,
  arbitrationRequired,
  awaitingTrack,
  unresolvedTrack,
} from "../../../../fixtures/tagging"
import {
  detailsOf,
  settleScroller as settle,
  stubOffscreenLayout,
  toggleOf,
} from "../../../../fixtures/virtual-scroll"
import { NativeService } from "../../../core/platform/native.service"
import type { TaggingTrack } from "../../../core/stores/tagging-run.store"

import { RunListComponent } from "./run-list.component"

const TRACK_ID = PENDING_TRACK.trackId

const UNRESOLVED = unresolvedTrack(TRACK_ID)

const NOT_RECOVERABLE: TaggingTrack = { ...UNRESOLVED, recoverable: false }

const AWAITING = awaitingTrack(TRACK_ID)

const READABLE: TaggingTrack = { ...PENDING_TRACK, tagsBefore: TAGS_BEFORE }

interface RunStatus {
  readonly frozen?: boolean
  readonly interrupted?: boolean
}

const COMMITTED: RunStatus = { frozen: true }

const INTERRUPTED: RunStatus = { interrupted: true }

const mountWith = async (
  tracks: readonly TaggingTrack[],
  { frozen = false, interrupted = false }: RunStatus = {},
) => {
  TestBed.configureTestingModule({
    imports: [RunListComponent],
    providers: [provideTranslateService(), { provide: NativeService, useValue: nativeStub() }],
  })
  const fixture = TestBed.createComponent(RunListComponent)
  fixture.componentRef.setInput("tracks", tracks)
  fixture.componentRef.setInput("frozen", frozen)
  fixture.componentRef.setInput("interrupted", interrupted)
  fixture.detectChanges()
  await settle(fixture)

  return fixture
}

/** Les sept colonnes de la seule ligne montee, dans l'ordre du template. */
const ART = 1
const BEFORE = 2
const AFTER = 3
const SOURCE = 4
const SCORE = 5

const cellOf = (fixture: Hosted, column: number): HTMLElement | undefined =>
  hostOf(fixture).querySelectorAll("td")[column]

const mainLineOf = (fixture: Hosted): string | undefined =>
  cellOf(fixture, BEFORE)?.querySelector("app-truncated-text span")?.textContent.trim()

const firstRowOf = (fixture: Hosted): HTMLElement | null =>
  hostOf(fixture).querySelector<HTMLElement>("tbody tr")

const rowsOf = (fixture: Hosted): HTMLElement[] => [
  ...hostOf(fixture).querySelectorAll<HTMLElement>("tbody tr"),
]

const carriersOf = (fixture: Hosted): HTMLElement[] =>
  rowsOf(fixture).filter((row) => row.hasAttribute("data-detail-carrier"))

const kindsOf = (fixture: Hosted): string[] =>
  rowsOf(fixture).map((row) => {
    if (row.hasAttribute("data-detail-carrier")) {
      return "carrier"
    }

    return row.getAttribute("aria-hidden") === "true" ? "filler" : "track"
  })

const fillersOf = (fixture: Hosted): HTMLElement[] =>
  rowsOf(fixture).filter((row) => row.getAttribute("aria-hidden") === "true")

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
    const fixture = await mountWith([RESOLVED_TRACK])

    expect(hostOf(fixture).querySelector("img")?.getAttribute("src")).toBe(
      `asset://localhost/${RESOLVED_TRACK.artworkPath}`,
    )
  })

  it.each<{ case: string; track: TaggingTrack }>([
    { case: "a resolved track has no artwork", track: { ...RESOLVED_TRACK, artworkPath: null } },
    { case: "a track has no source", track: UNRESOLVED },
  ])("shows the placeholder and not the skeleton when $case", async ({ track }) => {
    const fixture = await mountWith([track])

    expect(cellOf(fixture, ART)?.querySelector("img")).toBeNull()
    expect(cellOf(fixture, ART)?.querySelector("p-skeleton")).toBeNull()
    expect(iconOf(cellOf(fixture, ART), "image")).not.toBeNull()
  })

  it("shows a skeleton artwork for a track awaiting its turn in a run in progress", async () => {
    const fixture = await mountWith([PENDING_TRACK])

    expect(cellOf(fixture, ART)?.querySelector("p-skeleton")).not.toBeNull()
  })

  it("shows no skeleton artwork for a track awaiting its turn in a settled run", async () => {
    const fixture = await mountWith([PENDING_TRACK], COMMITTED)

    expect(cellOf(fixture, ART)?.querySelector("p-skeleton")).toBeNull()
  })

  it.each<{ case: string; track: TaggingTrack; run?: RunStatus; label: string }>([
    {
      case: "awaiting an arbitration in a run in progress",
      track: AWAITING,
      label: "tagging.state.awaiting",
    },
    {
      case: "awaiting an arbitration in a committed run",
      track: AWAITING,
      run: COMMITTED,
      label: "tagging.state.notProcessed",
    },
    {
      case: "resolved in a run in progress",
      track: RESOLVED_TRACK,
      label: "tagging.state.auto",
    },
    {
      case: "unresolved in a committed run",
      track: UNRESOLVED,
      run: COMMITTED,
      label: "tagging.state.unresolved",
    },
    {
      case: "not searched yet in a run in progress",
      track: PENDING_TRACK,
      label: "tagging.state.pending",
    },
    {
      case: "not searched yet in an interrupted run",
      track: PENDING_TRACK,
      run: INTERRUPTED,
      label: "tagging.state.notProcessed",
    },
    {
      case: "unresolved with a pending arbitration in a run in progress",
      track: { ...UNRESOLVED, arbitration: arbitrationRequired(TRACK_ID) },
      label: "tagging.state.awaiting",
    },
  ])("labels a row $case", async ({ track, run, label }) => {
    const fixture = await mountWith([track], run)

    expect(hostOf(fixture).querySelector("app-state-tag")?.textContent.trim()).toBe(label)
  })

  it("marks every valueless cell of an unresolved track with an em dash", async () => {
    const fixture = await mountWith([NOT_RECOVERABLE])

    expect(
      [AFTER, SOURCE, SCORE].map((column) => cellOf(fixture, column)?.textContent.trim()),
    ).toEqual(["—", "—", "—"])
  })

  it.each([
    { output: "arbitrate", track: AWAITING },
    { output: "recover", track: UNRESOLVED },
  ] as const)(
    "emits $output with the track id when a row that offers it is clicked",
    async (row) => {
      const fixture = await mountWith([row.track])
      const asked = vi.fn()
      fixture.componentInstance[row.output].subscribe(asked)

      firstRowOf(fixture)?.click()

      expect(asked).toHaveBeenCalledWith(row.track.trackId)
    },
  )

  it.each([
    { output: "arbitrate", track: RESOLVED_TRACK },
    { output: "recover", track: NOT_RECOVERABLE },
  ] as const)("does not emit $output when a row that does not offer it is clicked", async (row) => {
    const fixture = await mountWith([row.track])
    const asked = vi.fn()
    fixture.componentInstance[row.output].subscribe(asked)

    firstRowOf(fixture)?.click()

    expect(asked).not.toHaveBeenCalled()
  })

  it("puts a recoverable row in the tab order", async () => {
    const fixture = await mountWith([UNRESOLVED])

    expect(firstRowOf(fixture)?.tabIndex).toBe(0)
  })

  it.each(["Enter", " "])(
    "asks to recover a recoverable row from the keyboard (%j)",
    async (key) => {
      const fixture = await mountWith([UNRESOLVED])
      const asked = vi.fn()
      fixture.componentInstance.recover.subscribe(asked)

      firstRowOf(fixture)?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))

      expect(asked).toHaveBeenCalledWith(UNRESOLVED.trackId)
    },
  )

  it("keeps a row without action out of the tab order", async () => {
    const fixture = await mountWith([NOT_RECOVERABLE])

    expect(firstRowOf(fixture)?.hasAttribute("tabindex")).toBe(false)
  })

  describe("committed run", () => {
    // Le sidecar refuserait tout geste sur un run fige : meme un morceau qu'il disait eligible n'en offre plus.
    const mountCommitted = () => mountWith([AWAITING, UNRESOLVED], COMMITTED)

    it("leaves the rows without action on click", async () => {
      const fixture = await mountCommitted()
      const asked = vi.fn()
      fixture.componentInstance.arbitrate.subscribe(asked)
      fixture.componentInstance.recover.subscribe(asked)

      rowsOf(fixture).forEach((row) => {
        row.click()
      })

      expect(asked).not.toHaveBeenCalled()
    })

    it("keeps the rows out of the tab order", async () => {
      const fixture = await mountCommitted()

      expect(rowsOf(fixture).some((row) => row.hasAttribute("tabindex"))).toBe(false)
    })

    it("shows the rows without skeleton", async () => {
      const fixture = await mountCommitted()

      expect(hostOf(fixture).querySelector("p-skeleton")).toBeNull()
    })
  })

  it("shows the paste hint on an unresolved recoverable row", async () => {
    const fixture = await mountWith([UNRESOLVED])

    expect(cellOf(fixture, AFTER)?.querySelector("[data-recover-hint]")).not.toBeNull()
  })

  it("shows no paste hint on an unresolved row that is not recoverable", async () => {
    const fixture = await mountWith([NOT_RECOVERABLE])

    expect(cellOf(fixture, AFTER)?.querySelector("[data-recover-hint]")).toBeNull()
  })

  it("shows the file name without its extension as the main line when the tags are empty", async () => {
    const fixture = await mountWith([{ ...RESOLVED_TRACK, artist: "", title: "" }])

    expect(mainLineOf(fixture)).toBe("a")
    expect(cellOf(fixture, BEFORE)?.textContent).toContain("a.mp3")
  })

  it.each([
    { case: "the title is empty", empty: { title: "" }, shown: RESOLVED_TRACK.artist },
    { case: "the artist is empty", empty: { artist: "" }, shown: RESOLVED_TRACK.title },
  ])(
    "shows only the other tag, without an orphan separator, when $case",
    async ({ empty, shown }) => {
      const fixture = await mountWith([{ ...RESOLVED_TRACK, ...empty }])

      expect(mainLineOf(fixture)).toBe(shown)
    },
  )

  describe("opened detail", () => {
    const chevronOf = (fixture: Hosted): string | null | undefined =>
      toggleOf(fixture)?.querySelector("[data-icon]")?.getAttribute("data-icon")

    it("opens under its row on one carrier row followed by aria-hidden fillers", async () => {
      const fixture = await mountWith([{ ...AWAITING, tagsBefore: TAGS_BEFORE }])

      toggleOf(fixture)?.click()
      await settle(fixture)

      expect(kindsOf(fixture)).toEqual(["track", "carrier", ...Array<string>(6).fill("filler")])
    })

    it("highlights its row and turns the chevron down", async () => {
      const fixture = await mountWith([{ ...AWAITING, tagsBefore: TAGS_BEFORE }])

      toggleOf(fixture)?.click()
      await settle(fixture)

      expect(rowsOf(fixture)[0]?.hasAttribute("data-shown")).toBe(true)
      expect(toggleOf(fixture)?.getAttribute("aria-expanded")).toBe("true")
      expect(chevronOf(fixture)).toBe("chevron-down")
    })

    it("closes on a second click", async () => {
      const fixture = await mountWith([{ ...AWAITING, tagsBefore: TAGS_BEFORE }])
      toggleOf(fixture)?.click()
      await settle(fixture)

      toggleOf(fixture)?.click()
      await settle(fixture)

      expect(rowsOf(fixture)).toHaveLength(1)
      expect(rowsOf(fixture)[0]?.hasAttribute("data-shown")).toBe(false)
      expect(toggleOf(fixture)?.getAttribute("aria-expanded")).toBe("false")
      expect(chevronOf(fixture)).toBe("chevron-right")
    })

    it("opens without asking for arbitration", async () => {
      const fixture = await mountWith([{ ...AWAITING, tagsBefore: TAGS_BEFORE }])
      const asked = vi.fn()
      fixture.componentInstance.arbitrate.subscribe(asked)

      toggleOf(fixture)?.click()
      await settle(fixture)

      expect(asked).not.toHaveBeenCalled()
    })
  })

  // `h-14` est la hauteur que `virtualScrollItemSize` suppose : une ligne qui en sort decale
  // toutes les suivantes (rule primeng/ligne-depliee.md).
  it("puts the detail inside the carrier row and keeps every row at the scroller height", async () => {
    const fixture = await mountWith([READABLE])

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

  describe("second detail", () => {
    const OTHER: TaggingTrack = {
      ...PENDING_TRACK,
      trackId: "b.mp3",
      fileName: "b.mp3",
      artist: "Amelie Lens",
      title: "Basiel",
      tagsBefore: TAGS_BEFORE,
    }

    /** JSDOM n'a pas `scrollBy`. */
    const spyScrollBy = (fixture: Hosted): ReturnType<typeof vi.fn> => {
      const scrollBy = vi.fn()
      Object.assign(hostOf(fixture).querySelector(".p-virtualscroller") ?? {}, { scrollBy })

      return scrollBy
    }

    it("closes the first detail when a second one opens", async () => {
      const fixture = await mountWith([READABLE, OTHER])
      toggleOf(fixture, 0)?.click()
      await settle(fixture)
      spyScrollBy(fixture)

      toggleOf(fixture, 1)?.click()
      await settle(fixture)

      expect(detailsOf(fixture)).toHaveLength(1)
      expect(toggleOf(fixture, 0)?.getAttribute("aria-expanded")).toBe("false")
      expect(toggleOf(fixture, 1)?.getAttribute("aria-expanded")).toBe("true")
      expect(rowsOf(fixture)).toHaveLength(9)
    })

    it("scrolls up by the height of the detail it closes above", async () => {
      const fixture = await mountWith([READABLE, OTHER])
      toggleOf(fixture, 0)?.click()
      await settle(fixture)
      const scrollBy = spyScrollBy(fixture)

      toggleOf(fixture, 1)?.click()

      expect(scrollBy).toHaveBeenCalledExactlyOnceWith({ top: -7 * 56 })
    })

    it("keeps the scroll when the detail it closes is below", async () => {
      const fixture = await mountWith([READABLE, OTHER])
      toggleOf(fixture, 1)?.click()
      await settle(fixture)
      const scrollBy = spyScrollBy(fixture)

      toggleOf(fixture, 0)?.click()

      expect(scrollBy).not.toHaveBeenCalled()
    })
  })

  it.each(["Enter", " "])("keeps the chevron keys away from the row action (%j)", async (key) => {
    const fixture = await mountWith([AWAITING])
    const asked = vi.fn()
    fixture.componentInstance.arbitrate.subscribe(asked)

    toggleOf(fixture)?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))

    expect(toggleOf(fixture)).not.toBeNull()
    expect(asked).not.toHaveBeenCalled()
  })

  it("shows the detail of a recoverable row without asking to recover it", async () => {
    const fixture = await mountWith([UNRESOLVED])
    const asked = vi.fn()
    fixture.componentInstance.recover.subscribe(asked)

    toggleOf(fixture)?.click()
    await settle(fixture)

    expect(asked).not.toHaveBeenCalled()
    expect(detailsOf(fixture)).toHaveLength(1)
  })

  it("makes the detail follow its track when it is resolved", async () => {
    const fixture = await mountWith([READABLE])
    toggleOf(fixture)?.click()
    await settle(fixture)

    fixture.componentRef.setInput("tracks", [
      { ...RESOLVED_TRACK, tagsBefore: TAGS_BEFORE, tagsAfter: TAGS_AFTER },
    ])
    await settle(fixture)

    expect(detailsOf(fixture)).toHaveLength(1)
    expect(detailsOf(fixture)[0]?.textContent).toContain("Adam Beyer")
  })

  it("closes the detail when its track leaves the list", async () => {
    const fixture = await mountWith([READABLE])
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
    const fixture = await mountWith([READABLE])
    toggleOf(fixture)?.click()
    await settle(fixture)
    fixture.componentRef.setInput("tracks", [{ ...PENDING_TRACK, trackId: "z.mp3" }])
    await settle(fixture)

    fixture.componentRef.setInput("tracks", [READABLE])
    await settle(fixture)

    expect(detailsOf(fixture)).toHaveLength(0)
  })
})
