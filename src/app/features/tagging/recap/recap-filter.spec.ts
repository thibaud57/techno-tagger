import { resolvedTrack, unresolvedTrack } from "../../../../fixtures/tagging"
import type { TaggingTrack } from "../../../core/stores/tagging-run.store"

import { inFilter, matchesSearch, recapCounts, type RecapFilter } from "./recap-filter"

const track = (overrides: Partial<TaggingTrack>): TaggingTrack => ({
  ...resolvedTrack("t"),
  ...overrides,
})

const AUTO = track({ trackId: "auto", state: "written", resolution: "auto" })
const ARBITRATED = track({ trackId: "arbitrated", state: "written", resolution: "arbitration" })
const BY_URL = track({ trackId: "url", state: "resolved", resolution: "url" })
const FAILED_WRITE = track({
  trackId: "failed-write",
  state: "write_error",
  resolution: "arbitration",
})
const UNRESOLVED = unresolvedTrack("unresolved")
const RESTORED = track({ trackId: "restored", state: "rolled_back", resolution: "auto" })
const RUN = [AUTO, ARBITRATED, BY_URL, FAILED_WRITE, UNRESOLVED, RESTORED]

const kept = (filter: RecapFilter): string[] =>
  RUN.filter((candidate) => inFilter(candidate, filter)).map((candidate) => candidate.trackId)

describe("recap filters", () => {
  it.each<[RecapFilter, string[]]>([
    ["all", ["auto", "arbitrated", "url", "failed-write", "unresolved", "restored"]],
    ["validated", ["auto"]],
    ["arbitrated", ["arbitrated", "url"]],
    ["failed", ["failed-write", "unresolved"]],
  ])("keeps in %s the tracks the rule names", (filter, expected) => {
    const result = kept(filter)

    expect(result).toEqual(expected)
  })

  it.each<[string, TaggingTrack[], Record<RecapFilter, number>]>([
    ["each filter with the same rule", RUN, { all: 6, validated: 1, arbitrated: 2, failed: 2 }],
    [
      "nothing in the three filters for a fully restored run",
      [RESTORED, { ...RESTORED, trackId: "restored-2" }],
      { all: 2, validated: 0, arbitrated: 0, failed: 0 },
    ],
  ])("counts %s", (_case, tracks, expected) => {
    const counts = recapCounts(tracks)

    expect(counts).toEqual(expected)
  })

  it.each([
    ["the artist", "adam"],
    ["the title, ignoring case", "MIND"],
    ["the file name", "a.mp3"],
    ["the spaces around the search", "  mind "],
  ])("matches the search on %s", (_field, query) => {
    const tagged = track({ artist: "Adam Beyer", title: "Your Mind", fileName: "a.mp3" })

    const matched = matchesSearch(tagged, query)

    expect(matched).toBe(true)
  })

  it("does not match a search the original tags do not carry", () => {
    const tagged = track({ artist: "Adam Beyer", title: "Your Mind", fileName: "a.mp3" })

    const matched = matchesSearch(tagged, "basiel")

    expect(matched).toBe(false)
  })
})
