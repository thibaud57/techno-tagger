import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"

import { PENDING_TRACK, TAGS_AFTER, TAGS_BEFORE } from "../../../fixtures/tagging"
import type { TaggingTrack } from "../../core/tagging-run.store"

import { TrackDetailComponent } from "./track-detail.component"

/** `convertFileSrc` n'existe pas hors Tauri. */
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
}))

const RESOLVED: TaggingTrack = {
  ...PENDING_TRACK,
  state: "resolved",
  resolution: "auto",
  source: "beatport",
  artworkPath: "C:/AppData/cache/artworks/abc.jpg",
  tagsBefore: { ...TAGS_BEFORE, comment: null },
  tagsAfter: TAGS_AFTER,
}

const mount = (track: TaggingTrack) => {
  TestBed.configureTestingModule({
    imports: [TrackDetailComponent],
    providers: [provideTranslateService()],
  })
  const fixture = TestBed.createComponent(TrackDetailComponent)
  fixture.componentRef.setInput("track", track)
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
      ["tagging.detail.field.artist", "TPE1", "adam beyer", "Adam Beyer"],
      ["tagging.detail.field.bpm", "TBPM", "130", "130"],
    ])
  })

  it("leaves the source id out of the grid", () => {
    const sourceId = { field: "source_id", key: "TXXX:SOURCE_ID", value: "17492013" } as const
    const root = mount({
      ...RESOLVED,
      tagsBefore: { ...TAGS_BEFORE, comment: null, fields: [...TAGS_BEFORE.fields, sourceId] },
      tagsAfter: [...TAGS_AFTER, sourceId],
    })

    const labels = rowsOf(root).map((row) => row[0])

    expect(labels).toEqual(["tagging.detail.field.artist", "tagging.detail.field.bpm"])
  })

  it("marks a missing value with an em dash", () => {
    const root = mount({
      ...RESOLVED,
      tagsBefore: {
        ...TAGS_BEFORE,
        comment: null,
        fields: [{ field: "label", key: "TPUB", value: null }],
      },
      tagsAfter: [{ field: "label", key: "TPUB", value: "Drumcode" }],
    })

    const rows = rowsOf(root)

    expect(rows).toEqual([["tagging.detail.field.label", "TPUB", "—", "Drumcode"]])
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
      ["tagging.detail.field.artist", "—", "Adam Beyer"],
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
    const root = mount(RESOLVED)

    const image = root.querySelector("img")

    expect(image?.getAttribute("src")).toBe(`asset://localhost/${RESOLVED.artworkPath}`)
    expect(image?.getAttribute("width")).toBe("160")
  })

  it("shows a skeleton artwork while the track awaits its turn", () => {
    const root = mount({ ...PENDING_TRACK, tagsBefore: TAGS_BEFORE })

    const skeleton = root.querySelector("p-skeleton")

    expect(skeleton).not.toBeNull()
  })
})
