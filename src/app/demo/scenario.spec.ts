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

  it.each([
    {
      case: "rejects an unknown schema version",
      raw: () => ({ ...scenarioWith({}), schema_version: 2 }),
    },
    {
      case: "rejects a reply whose outcome is unknown",
      raw: () => ({ ...scenarioWith({}), initial_outcomes: { "a.mp3": "maybe" } }),
    },
    {
      case: "rejects a reply whose phase is unknown",
      raw: () => ({
        ...scenarioWith({}),
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
      }),
    },
    {
      case: "rejects a reply pointing outside the lines table",
      raw: () =>
        scenarioWith({
          lines: [],
          stateless: [
            { command: { command: "get_version" }, call: 1, sets: {}, enters: null, lines: [3] },
          ],
        }),
    },
  ])("$case", ({ raw }) => {
    expect(() => parseScenario(raw())).toThrow(DemoScenarioError)
  })
})
