import type { ExtractionFinishedEvent } from "../../core/models/protocol"

import { toExtractionRows, type FormatSize } from "./extraction-rows"

const EMPTY: ExtractionFinishedEvent = {
  event: "extraction_finished",
  extracted: [],
  already_present: [],
  missing: [],
  duplicates: [],
  failures: [],
  report_path: "C:/work/report.json",
}

/** Mise en forme reconnaissable : ce qui se teste ici est ou la taille atterrit, pas son unite. */
const formatSize: FormatSize = (bytes) => `${bytes} o`

describe("toExtractionRows", () => {
  it("renders no row for an empty result", () => {
    expect(toExtractionRows(EMPTY, formatSize)).toEqual([])
  })

  it("renders one row per track across all categories", () => {
    const rows = toExtractionRows(
      {
        ...EMPTY,
        extracted: ["a.mp3", "b.mp3"],
        already_present: ["c.mp3"],
        missing: ["d.mp3"],
      },
      formatSize,
    )

    expect(rows).toHaveLength(4)
  })

  it("carries the category of each track", () => {
    const rows = toExtractionRows(
      { ...EMPTY, extracted: ["a.mp3"], missing: ["d.mp3"] },
      formatSize,
    )

    expect(rows.map((row) => row.category)).toEqual(["missing", "extracted"])
  })

  it("lists what needs a look before what went through", () => {
    const rows = toExtractionRows(
      {
        ...EMPTY,
        extracted: ["a.mp3"],
        already_present: ["c.mp3"],
        missing: ["d.mp3"],
        duplicates: [
          {
            file_name: "beta.mp3",
            kept_path: "C:/lib/beta.mp3",
            kept_size: 12_000,
            criterion: "largest_file",
            discarded: [{ path: "C:/lib/albums/beta.mp3", size: 5_000 }],
          },
        ],
        failures: [{ file_name: "locked.mp3", reason: "file_locked" }],
      },
      formatSize,
    )

    expect(rows.map((row) => row.category)).toEqual([
      "failure",
      "missing",
      "duplicate",
      "already_present",
      "extracted",
    ])
  })

  it("describes a duplicate by its discarded candidate and criterion", () => {
    const rows = toExtractionRows(
      {
        ...EMPTY,
        duplicates: [
          {
            file_name: "beta.mp3",
            kept_path: "C:/lib/singles/beta.mp3",
            kept_size: 12_000,
            criterion: "largest_file",
            discarded: [{ path: "C:/lib/albums/beta.mp3", size: 5_000 }],
          },
        ],
      },
      formatSize,
    )

    const row = rows[0]
    expect(row).toBeDefined()
    expect(row?.category).toBe("duplicate")
    expect(row?.detailKey).toBe("playlist.report.detail.duplicate")
    expect(row?.detailParams).toEqual({
      kept: "C:/lib/singles/beta.mp3",
      keptSize: "12000 o",
      discarded: "C:/lib/albums/beta.mp3",
      discardedSizes: "5000 o",
    })
    expect(row?.reasonKey).toBe("playlist.report.criterion.largest_file")
  })

  it("names a failure reason by a key, never by its raw value", () => {
    const rows = toExtractionRows(
      {
        ...EMPTY,
        failures: [{ file_name: "locked.mp3", reason: "file_locked" }],
      },
      formatSize,
    )

    const row = rows[0]
    expect(row).toBeDefined()
    expect(row?.category).toBe("failure")
    expect(row?.reasonKey).toBe("playlist.report.reason.file_locked")
  })

  it("keeps discarded paths and sizes in the same order", () => {
    const rows = toExtractionRows(
      {
        ...EMPTY,
        duplicates: [
          {
            file_name: "track.mp3",
            kept_path: "C:/lib/kept.mp3",
            kept_size: 8_000,
            criterion: "path_order",
            discarded: [
              { path: "C:/albums/old/track.mp3", size: 3_000 },
              { path: "C:/backup/track.mp3", size: 5_500 },
            ],
          },
        ],
      },
      formatSize,
    )

    const row = rows[0]
    expect(row).toBeDefined()
    expect(row?.detailParams?.["discarded"]).toBe("C:/albums/old/track.mp3, C:/backup/track.mp3")
    expect(row?.detailParams?.["discardedSizes"]).toBe("3000 o, 5500 o")
  })

  it("keeps two files of the same category in their input order", () => {
    const rows = toExtractionRows({ ...EMPTY, extracted: ["zebra.mp3", "alpha.mp3"] }, formatSize)

    expect(rows.map((row) => row.fileName)).toEqual(["zebra.mp3", "alpha.mp3"])
  })
})
