import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"
import { vi } from "vitest"

import { silenceConsoleError } from "../../../../fixtures/console"
import { action, hostOf, tooltipOf } from "../../../../fixtures/dom"
import { type NativeStub, nativeStub } from "../../../../fixtures/native-stub"
import {
  PENDING_TRACK,
  RESOLVED_TRACK,
  SOURCE_URL,
  TAGS_AFTER,
  TAGS_BEFORE,
} from "../../../../fixtures/tagging"
import { type AppEdition, APP_EDITION, DEMO_UNAVAILABLE } from "../../../core/platform/app-edition"
import { NativeService } from "../../../core/platform/native.service"
import type { TaggingTrack } from "../../../core/stores/tagging-run.store"

import type { RunRow } from "./run-list.component"
import { TrackDetailComponent } from "./track-detail.component"

const BEFORE_WITHOUT_COMMENT = { ...TAGS_BEFORE, comment: null }

const RESOLVED: TaggingTrack = {
  ...RESOLVED_TRACK,
  tagsBefore: BEFORE_WITHOUT_COMMENT,
  tagsAfter: TAGS_AFTER,
}

const WITH_SOURCE: TaggingTrack = {
  ...RESOLVED,
  sourceUrl: SOURCE_URL,
  tagsBefore: {
    ...BEFORE_WITHOUT_COMMENT,
    fields: [...TAGS_BEFORE.fields, { field: "url", key: "WOAS", value: null }],
  },
  tagsAfter: [...TAGS_AFTER, { field: "url", key: "WOAS", value: SOURCE_URL }],
}

/** La liste construit la ligne ; le détail ne lit d'elle que le morceau, sa pochette et sa restauration. */
const asRow = (track: TaggingTrack, shown: Partial<RunRow> = {}): RunRow => ({
  ...track,
  status: "pending",
  mainLine: "",
  afterLine: null,
  artworkUrl: null,
  artworkPending: false,
  reason: null,
  arbitrable: false,
  recoverable: false,
  restorable: false,
  restoring: false,
  ...shown,
})

let native: NativeStub

const mountFixture = (
  track: TaggingTrack,
  inputs: Record<string, unknown> = {},
  shown: Partial<RunRow> = {},
  edition: AppEdition = "desktop",
) => {
  TestBed.configureTestingModule({
    imports: [TrackDetailComponent],
    providers: [
      provideTranslateService(),
      { provide: NativeService, useValue: native },
      { provide: APP_EDITION, useValue: edition },
    ],
  })
  const fixture = TestBed.createComponent(TrackDetailComponent)
  fixture.componentRef.setInput("track", asRow(track, shown))
  for (const [name, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(name, value)
  }
  fixture.detectChanges()

  return fixture
}

const mount = (...args: Parameters<typeof mountFixture>): HTMLElement =>
  hostOf(mountFixture(...args))

/** Textes de chaque ligne : libelle (cle brute sans fichier de langue), cle, avant, apres. */
const rowsOf = (root: HTMLElement): string[][] =>
  [...root.querySelectorAll("[data-detail-row]")].map((row) =>
    [...row.querySelectorAll("[data-cell]")].map((cell) => cell.textContent.trim()),
  )

const columnOf = (root: HTMLElement, index: number): (string | undefined)[] =>
  rowsOf(root).map((row) => row[index])

describe("TrackDetailComponent", () => {
  beforeEach(() => {
    native = nativeStub()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders the rows it receives in order, with their key, before and after", () => {
    const root = mount(RESOLVED)

    expect(rowsOf(root)).toEqual([
      ["tagging.detail.field.artist", "TPE1", "adam beyer", "Adam Beyer"],
      ["tagging.detail.field.bpm", "TBPM", "130", "130"],
    ])
  })

  it("leaves the source id out of the grid", () => {
    const sourceId = { field: "source_id", key: "TXXX:SOURCE_ID", value: "99000101" } as const
    const root = mount({
      ...RESOLVED,
      tagsBefore: { ...BEFORE_WITHOUT_COMMENT, fields: [...TAGS_BEFORE.fields, sourceId] },
      tagsAfter: [...TAGS_AFTER, sourceId],
    })

    expect(columnOf(root, 0)).toEqual(["tagging.detail.field.artist", "tagging.detail.field.bpm"])
  })

  it("shows the source row by its brand name, not the contract value", () => {
    const source = { field: "source", key: "TXXX:SOURCE", value: "bandcamp" } as const
    const root = mount({
      ...RESOLVED,
      tagsBefore: {
        ...BEFORE_WITHOUT_COMMENT,
        fields: [...TAGS_BEFORE.fields, { ...source, value: null }],
      },
      tagsAfter: [...TAGS_AFTER, source],
    })

    expect(columnOf(root, 3).at(-1)).toBe("Bandcamp")
  })

  it("marks a missing value with an em dash", () => {
    const root = mount({
      ...RESOLVED,
      tagsBefore: {
        ...BEFORE_WITHOUT_COMMENT,
        fields: [{ field: "label", key: "TPUB", value: null }],
      },
      tagsAfter: [{ field: "label", key: "TPUB", value: "Drumcode" }],
    })

    expect(rowsOf(root)).toEqual([["tagging.detail.field.label", "TPUB", "—", "Drumcode"]])
  })

  it("adds a comment row when the file carries one", () => {
    const root = mount({ ...RESOLVED, tagsBefore: TAGS_BEFORE })

    expect(rowsOf(root).at(-1)).toEqual(["tagging.detail.field.comment", "Ripped by X", "—"])
  })

  it("adds no comment row when the file carries none", () => {
    const root = mount(RESOLVED)

    expect(rowsOf(root)).toHaveLength(2)
  })

  it("shows em dashes after an unresolved track", () => {
    const root = mount({ ...RESOLVED, state: "unresolved", resolution: "none", tagsAfter: null })

    expect(columnOf(root, 3)).toEqual(["—", "—"])
  })

  it("builds the rows from the tags after when the tags before are unreadable", () => {
    const root = mount({ ...RESOLVED, tagsBefore: null })

    expect(rowsOf(root).map((row) => [row[0], row[2], row[3]])).toEqual([
      ["tagging.detail.field.artist", "—", "Adam Beyer"],
      ["tagging.detail.field.bpm", "—", "130"],
    ])
  })

  it("says the tags could not be read when there is neither before nor after", () => {
    const root = mount({ ...RESOLVED, state: "unresolved", tagsBefore: null, tagsAfter: null })

    expect(root.querySelector("[data-unreadable]")?.textContent.trim()).toBe(
      "tagging.detail.unreadable",
    )
    expect(root.querySelector("[data-detail-row]")).toBeNull()
  })

  it("shows the artwork it receives", () => {
    const root = mount(RESOLVED, {}, { artworkUrl: "asset://localhost/abc.jpg" })

    expect(root.querySelector("img")?.getAttribute("src")).toBe("asset://localhost/abc.jpg")
  })

  it("shows a skeleton artwork while the track awaits its turn", () => {
    const root = mount({ ...PENDING_TRACK, tagsBefore: TAGS_BEFORE }, {}, { artworkPending: true })

    expect(root.querySelector("p-skeleton")).not.toBeNull()
  })

  it("offers the restore on a restorable track", () => {
    const root = mount(RESOLVED, {}, { restorable: true })

    expect(action("restore-track", root)).not.toBeNull()
  })

  it("offers no restore on a track that is not restorable", () => {
    const root = mount(RESOLVED)

    expect(action("restore-track", root)).toBeNull()
  })

  it("asks to restore its track on click", () => {
    const fixture = mountFixture(RESOLVED, {}, { restorable: true })
    const asked = vi.fn()
    fixture.componentInstance.restore.subscribe(asked)

    action("restore-track", hostOf(fixture))?.click()

    expect(asked).toHaveBeenCalledWith(RESOLVED.trackId)
  })

  it("disables the restore while files are busy", () => {
    const root = mount(RESOLVED, { blocked: true }, { restorable: true })

    expect(action("restore-track", root)?.disabled).toBe(true)
  })

  it("opens the source page from the url line", () => {
    const root = mount(WITH_SOURCE)

    action("open-source", root)?.click()

    expect(native.openUrl).toHaveBeenCalledWith(SOURCE_URL)
  })

  it("logs the failure when the source page cannot be opened", async () => {
    const error = silenceConsoleError()
    native.openUrl.mockRejectedValueOnce(new Error("no default browser"))
    const root = mount(WITH_SOURCE)

    action("open-source", root)?.click()

    await vi.waitFor(() => {
      expect(error).toHaveBeenCalled()
    })
  })

  it("puts the link on the url line only", () => {
    const root = mount(WITH_SOURCE)

    expect(root.querySelectorAll('[data-action="open-source"]')).toHaveLength(1)
  })

  it("keeps the url line as text without a source page", () => {
    const root = mount({ ...WITH_SOURCE, sourceUrl: null })

    expect(action("open-source", root)).toBeNull()
    expect(columnOf(root, 3).at(-1)).toBe(SOURCE_URL)
  })

  it("greys out restoring one track and opening the source page in the demo edition", () => {
    const fixture = mountFixture(WITH_SOURCE, {}, { restorable: true }, "demo")

    const names = ["restore-track", "open-source"]

    expect(names.map((name) => action(name, hostOf(fixture))?.disabled)).toEqual([true, true])
    expect(names.map((name) => tooltipOf(fixture, name))).toEqual(Array(2).fill(DEMO_UNAVAILABLE))
  })
})
