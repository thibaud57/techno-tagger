import { EMPTY_EXTRACTION } from "../../../fixtures/extraction"
import type { DuplicateResolution, ExtractionFailure } from "../../core/sidecar/protocol"

import { toExtractionRows, type FormatSize } from "./extraction-rows"

/** Mise en forme reconnaissable : ce qui se teste ici est ou la taille atterrit, pas son unite. */
const formatSize: FormatSize = (bytes) => `${bytes} o`

const DUPLICATE: DuplicateResolution = {
  file_name: "beta.mp3",
  kept_path: "C:/lib/singles/beta.mp3",
  kept_size: 12_000,
  criterion: "largest_file",
  discarded: [{ path: "C:/lib/albums/beta.mp3", size: 5_000 }],
}

const FAILURE: ExtractionFailure = { file_name: "locked.mp3", reason: "file_locked" }

describe("toExtractionRows", () => {
  it("renders no row for an empty result", () => {
    expect(toExtractionRows(EMPTY_EXTRACTION, formatSize)).toEqual([])
  })

  it("renders one row per track across all categories", () => {
    const rows = toExtractionRows(
      {
        ...EMPTY_EXTRACTION,
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
      { ...EMPTY_EXTRACTION, extracted: ["a.mp3"], missing: ["d.mp3"] },
      formatSize,
    )

    expect(rows.map((row) => row.category)).toEqual(["missing", "extracted"])
  })

  it("lists what needs a look before what went through", () => {
    const rows = toExtractionRows(
      {
        ...EMPTY_EXTRACTION,
        extracted: ["a.mp3"],
        already_present: ["c.mp3"],
        missing: ["d.mp3"],
        duplicates: [DUPLICATE],
        failures: [FAILURE],
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
    const rows = toExtractionRows({ ...EMPTY_EXTRACTION, duplicates: [DUPLICATE] }, formatSize)

    expect(rows).toHaveLength(1)
    const [row] = rows
    expect(row?.category).toBe("duplicate")
    expect(row?.detail?.key).toBe("playlist.report.detail.duplicate")
    expect(row?.detail?.params).toEqual({
      kept: "C:/lib/singles/beta.mp3",
      keptSize: "12000 o",
      discarded: "C:/lib/albums/beta.mp3",
      discardedSizes: "5000 o",
    })
    expect(row?.reason?.cause).toBe("playlist.report.criterion.largest_file")
  })

  it("names a failure reason by a key, never by its raw value", () => {
    const rows = toExtractionRows({ ...EMPTY_EXTRACTION, failures: [FAILURE] }, formatSize)

    expect(rows).toHaveLength(1)
    const [row] = rows
    expect(row?.category).toBe("failure")
    expect(row?.reason).toEqual({
      cause: "reason.file_locked",
      remedy: { fix: "reason.fix.file_locked", retry: "reason.retry.extraction" },
    })
  })

  it("keeps discarded paths and sizes in the same order", () => {
    const rows = toExtractionRows(
      {
        ...EMPTY_EXTRACTION,
        duplicates: [
          {
            ...DUPLICATE,
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

    expect(rows).toHaveLength(1)
    const [row] = rows
    expect(row?.detail?.params["discarded"]).toBe("C:/albums/old/track.mp3, C:/backup/track.mp3")
    expect(row?.detail?.params["discardedSizes"]).toBe("3000 o, 5500 o")
  })

  it("keeps two files of the same category in their input order", () => {
    const rows = toExtractionRows(
      { ...EMPTY_EXTRACTION, extracted: ["zebra.mp3", "alpha.mp3"] },
      formatSize,
    )

    expect(rows.map((row) => row.fileName)).toEqual(["zebra.mp3", "alpha.mp3"])
  })
})
