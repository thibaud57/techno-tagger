import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"
import { openUrl } from "@tauri-apps/plugin-opener"

import { PENDING_TRACK, TAGS_AFTER, TAGS_BEFORE, resolvedTrack } from "../../../fixtures/tagging"
import type { TaggingTrack } from "../../core/tagging-run.store"

import type { RunRow } from "./run-list.component"
import { TrackDetailComponent } from "./track-detail.component"

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }))

const RESOLVED: TaggingTrack = {
  ...resolvedTrack(PENDING_TRACK.trackId),
  source: "beatport",
  artworkPath: "C:/AppData/cache/artworks/abc.jpg",
  tagsBefore: { ...TAGS_BEFORE, comment: null },
  tagsAfter: TAGS_AFTER,
}

const SOURCE_URL = "https://www.beatport.com/track/dim-orbit/99000101"

const WITH_SOURCE: TaggingTrack = {
  ...RESOLVED,
  sourceUrl: SOURCE_URL,
  tagsBefore: {
    ...TAGS_BEFORE,
    comment: null,
    fields: [...TAGS_BEFORE.fields, { field: "url", key: "WOAS", value: null }],
  },
  tagsAfter: [...TAGS_AFTER, { field: "url", key: "WOAS", value: SOURCE_URL }],
}

/** La liste construit la ligne ; le détail ne lit d'elle que le morceau et l'état de sa pochette. */
const asRow = (track: TaggingTrack, shown: Partial<RunRow> = {}): RunRow => ({
  ...track,
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

const mount = (
  track: TaggingTrack,
  inputs: Record<string, unknown> = {},
  shown: Partial<RunRow> = {},
) => {
  TestBed.configureTestingModule({
    imports: [TrackDetailComponent],
    providers: [provideTranslateService()],
  })
  const fixture = TestBed.createComponent(TrackDetailComponent)
  fixture.componentRef.setInput("track", asRow(track, shown))
  for (const [name, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(name, value)
  }
  fixture.detectChanges()

  return fixture.nativeElement as HTMLElement
}

/** Textes de chaque ligne : libelle (cle brute sans fichier de langue), cle, avant, apres. */
const rowsOf = (root: HTMLElement): string[][] =>
  [...root.querySelectorAll("[data-detail-row]")].map((row) =>
    [...row.querySelectorAll("[data-cell]")].map((cell) => cell.textContent.trim()),
  )

describe("TrackDetailComponent", () => {
  it("renders the rows it receives in order, with their key, before and after", () => {
    const root = mount(RESOLVED)

    const rows = rowsOf(root)

    expect(rows).toEqual([
      ["tagging.detail.field.artist", "TPE1", "lior vance", "Lior Vance"],
      ["tagging.detail.field.bpm", "TBPM", "130", "130"],
    ])
  })

  it("leaves the source id out of the grid", () => {
    const sourceId = { field: "source_id", key: "TXXX:SOURCE_ID", value: "99000101" } as const
    const root = mount({
      ...RESOLVED,
      tagsBefore: { ...TAGS_BEFORE, comment: null, fields: [...TAGS_BEFORE.fields, sourceId] },
      tagsAfter: [...TAGS_AFTER, sourceId],
    })

    const labels = rowsOf(root).map((row) => row[0])

    expect(labels).toEqual(["tagging.detail.field.artist", "tagging.detail.field.bpm"])
  })

  it("shows the source row by its brand name, not the contract value", () => {
    const source = { field: "source", key: "TXXX:SOURCE", value: "bandcamp" } as const
    const root = mount({
      ...RESOLVED,
      tagsBefore: {
        ...TAGS_BEFORE,
        comment: null,
        fields: [...TAGS_BEFORE.fields, { ...source, value: null }],
      },
      tagsAfter: [...TAGS_AFTER, source],
    })

    const row = rowsOf(root).at(-1)

    expect(row?.[3]).toBe("Bandcamp")
  })

  it("marks a missing value with an em dash", () => {
    const root = mount({
      ...RESOLVED,
      tagsBefore: {
        ...TAGS_BEFORE,
        comment: null,
        fields: [{ field: "label", key: "TPUB", value: null }],
      },
      tagsAfter: [{ field: "label", key: "TPUB", value: "Kestrel" }],
    })

    const rows = rowsOf(root)

    expect(rows).toEqual([["tagging.detail.field.label", "TPUB", "—", "Kestrel"]])
  })

  it("adds a comment row only when the file carries one", () => {
    const withComment = mount({ ...RESOLVED, tagsBefore: TAGS_BEFORE })
    const commented = rowsOf(withComment).at(-1)
    TestBed.resetTestingModule()

    const without = rowsOf(mount(RESOLVED))

    expect(commented).toEqual(["tagging.detail.field.comment", "", "Ripped by X", "—"])
    expect(without).toHaveLength(2)
  })

  it("shows em dashes after an unresolved track", () => {
    const root = mount({ ...RESOLVED, state: "unresolved", resolution: "none", tagsAfter: null })

    const afters = rowsOf(root).map((row) => row[3])

    expect(afters).toEqual(["—", "—"])
  })

  it("builds the rows from the tags after when the tags before are unreadable", () => {
    const root = mount({ ...RESOLVED, tagsBefore: null })

    const rows = rowsOf(root)

    expect(rows.map((row) => [row[0], row[2], row[3]])).toEqual([
      ["tagging.detail.field.artist", "—", "Lior Vance"],
      ["tagging.detail.field.bpm", "—", "130"],
    ])
  })

  it("says the tags could not be read when there is neither before nor after", () => {
    const root = mount({ ...RESOLVED, state: "unresolved", tagsBefore: null, tagsAfter: null })

    const message = root.querySelector("[data-unreadable]")?.textContent.trim()

    expect(message).toBe("tagging.detail.unreadable")
    expect(root.querySelector("[data-detail-row]")).toBeNull()
  })

  it("shows the artwork in large", () => {
    const root = mount(RESOLVED, {}, { artworkUrl: "asset://localhost/abc.jpg" })

    const image = root.querySelector("img")

    expect(image?.getAttribute("src")).toBe("asset://localhost/abc.jpg")
    expect(image?.getAttribute("width")).toBe("168")
  })

  it("shows a skeleton artwork while the track awaits its turn", () => {
    const root = mount({ ...PENDING_TRACK, tagsBefore: TAGS_BEFORE }, {}, { artworkPending: true })

    const skeleton = root.querySelector("p-skeleton")

    expect(skeleton).not.toBeNull()
  })

  it("offers to restore only a restorable track", () => {
    const plain = mount(RESOLVED)
    const absent = plain.querySelector('[data-action="restore-track"]')
    TestBed.resetTestingModule()

    const root = mount(RESOLVED, { restorable: true })

    expect(absent).toBeNull()
    expect(root.querySelector('[data-action="restore-track"]')).not.toBeNull()
  })

  it("asks to restore its track on click", () => {
    TestBed.configureTestingModule({
      imports: [TrackDetailComponent],
      providers: [provideTranslateService()],
    })
    const fixture = TestBed.createComponent(TrackDetailComponent)
    fixture.componentRef.setInput("track", asRow(RESOLVED))
    fixture.componentRef.setInput("restorable", true)
    fixture.detectChanges()
    const asked = vi.fn()
    fixture.componentInstance.restore.subscribe(asked)

    ;(fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-action="restore-track"]')
      ?.click()

    expect(asked).toHaveBeenCalledWith(RESOLVED.trackId)
  })

  it("disables the restore while files are busy", () => {
    const root = mount(RESOLVED, { restorable: true, blocked: true })

    const button = root.querySelector<HTMLButtonElement>('[data-action="restore-track"]')

    expect(button?.disabled).toBe(true)
  })

  it("opens the source page from the url line", () => {
    const root = mount(WITH_SOURCE)

    root.querySelector<HTMLButtonElement>('[data-action="open-source"]')?.click()

    expect(openUrl).toHaveBeenCalledWith(SOURCE_URL)
  })

  it("puts the link on the url line only", () => {
    const root = mount(WITH_SOURCE)

    const links = root.querySelectorAll('[data-action="open-source"]')

    expect(links).toHaveLength(1)
  })

  it("keeps the url line as text without a source page", () => {
    const root = mount({ ...WITH_SOURCE, sourceUrl: null })

    const link = root.querySelector('[data-action="open-source"]')

    expect(link).toBeNull()
    expect(rowsOf(root).at(-1)?.[3]).toBe(SOURCE_URL)
  })
})
