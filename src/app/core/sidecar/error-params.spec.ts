import { commandError, phaseBusy } from "../../../fixtures/write"
import { busyPhase, errorRunId, errorTrackId } from "./error-params"
import { BUSY_PHASES, type BusyPhase, type SidecarErrorEvent } from "./protocol"

type TextAccessor = (event: SidecarErrorEvent) => string | null

const PARAMS = { track_id: "a.mp3", run_id: "run-1" } as const

const TEXT_ACCESSORS: readonly (readonly [keyof typeof PARAMS, TextAccessor])[] = [
  ["track_id", errorTrackId],
  ["run_id", errorRunId],
]

describe("textual error params", () => {
  describe.each(TEXT_ACCESSORS)("%s", (key, accessor) => {
    it("reads no other param than its own", () => {
      const event = commandError("rollback", "rollback_unavailable", PARAMS)

      expect(accessor(event)).toBe(PARAMS[key])
    })

    it.each<[string, Record<string, unknown>]>([
      ["an absent value", {}],
      ["a number", { [key]: 42 }],
      ["a null", { [key]: null }],
      ["a list", { [key]: [PARAMS[key]] }],
    ])("is null for %s", (_case, params) => {
      const event = commandError("rollback", "rollback_unavailable", params)

      expect(accessor(event)).toBeNull()
    })
  })
})

describe("busyPhase", () => {
  it.each<BusyPhase>(BUSY_PHASES)("names the phase that runs (%s)", (phase) => {
    const event = phaseBusy("start_tagging", phase)

    expect(busyPhase(event)).toBe(phase)
  })

  it.each<[string, SidecarErrorEvent]>([
    ["an unknown phase", commandError("start_tagging", "phase_busy", { phase: "indexing" })],
    ["a non textual phase", commandError("start_tagging", "phase_busy", { phase: 3 })],
    ["an absent phase", commandError("start_tagging", "phase_busy")],
    ["another code", commandError("start_tagging", "run_not_written", { phase: "write" })],
  ])("is null for %s", (_case, event) => {
    expect(busyPhase(event)).toBeNull()
  })
})
