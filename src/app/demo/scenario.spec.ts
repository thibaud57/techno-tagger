import { scenarioWith } from "../../fixtures/demo-scenario"
import { DemoScenarioError, parseScenario } from "./scenario"

describe("parseScenario", () => {
  it("parses a scenario of schema version 1", () => {
    const raw = {
      schema_version: 1,
      paths: { vlc_dump: "a", library: "b", destination: "c" },
      key_fields: { get_version: [] },
      initial_outcomes: { "a.mp3": "pending" },
      lines: [{ event: "version" }],
      stateless: [
        { command: { command: "get_version" }, call: 1, sets: {}, enters: null, lines: [0] },
      ],
      stateful: [],
    }

    const scenario = parseScenario(raw)

    expect(scenario.paths.library).toBe("b")
    expect(scenario.initial_outcomes["a.mp3"]).toBe("pending")
  })

  it("rejects an unknown schema version", () => {
    expect(() => parseScenario({ ...scenarioWith({}), schema_version: 2 })).toThrow(
      DemoScenarioError,
    )
  })

  it("rejects a reply whose outcome or phase is unknown", () => {
    const valid = scenarioWith({})
    const outcome = { ...valid, initial_outcomes: { "a.mp3": "maybe" } }
    const phase = {
      ...valid,
      lines: [{ event: "x" }],
      stateful: [
        {
          command: { command: "list_runs" },
          outcomes: {},
          phase: "later",
          sets: {},
          enters: null,
          lines: [0],
        },
      ],
    }

    expect(() => parseScenario(outcome)).toThrow(DemoScenarioError)
    expect(() => parseScenario(phase)).toThrow(DemoScenarioError)
  })

  it("rejects a reply pointing outside the lines table", () => {
    const raw = scenarioWith({
      lines: [],
      stateless: [
        { command: { command: "get_version" }, call: 1, sets: {}, enters: null, lines: [3] },
      ],
    })

    expect(() => parseScenario(raw)).toThrow(DemoScenarioError)
  })
})
