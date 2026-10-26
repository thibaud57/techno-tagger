import { TestBed } from "@angular/core/testing"

import type { SidecarHandlers } from "../core/sidecar/sidecar-transport"
import { scenarioWith } from "../../fixtures/demo-scenario"
import { DemoScenarioService } from "./demo-scenario.service"
import { ReplayTransport } from "./replay-transport"
import { DemoScenarioError } from "./scenario"

const VERSION_LINE = { event: "version", version: "recorded", api_key_configured: true }
const INTERRUPTED_LINE = { event: "interrupted_run", run: null }

const line = (payload: object): string => JSON.stringify(payload)

describe("ReplayTransport", () => {
  const onLine = vi.fn<(line: string) => void>()
  const handlers: SidecarHandlers = { onLine, onStderr: vi.fn(), onTerminated: vi.fn() }
  const scenarios = {
    load: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    scenario: () =>
      scenarioWith({
        lines: [VERSION_LINE, INTERRUPTED_LINE],
        stateless: [
          { command: { command: "get_version" }, sets: {}, enters: null, lines: [0], call: 1 },
          {
            command: { command: "get_interrupted_run" },
            sets: {},
            enters: null,
            lines: [1],
            call: 1,
          },
        ],
      }),
  }
  let transport: ReplayTransport

  beforeEach(() => {
    scenarios.load.mockResolvedValue()
    TestBed.configureTestingModule({
      providers: [ReplayTransport, { provide: DemoScenarioService, useValue: scenarios }],
    })
    transport = TestBed.inject(ReplayTransport)
  })

  it("does not answer before the scenario is loaded", async () => {
    const { promise } = Promise.withResolvers<undefined>()
    scenarios.load.mockReturnValue(promise)
    const started = transport.start(handlers)

    const outcome = await Promise.race([started, Promise.resolve("pending")])

    expect(outcome).toBe("pending")
    expect(onLine).not.toHaveBeenCalled()
  })

  it("answers get_version only once the scenario is loaded, with the app version", async () => {
    const { promise, resolve } = Promise.withResolvers<undefined>()
    scenarios.load.mockReturnValue(promise)
    const started = transport.start(handlers)
    resolve(undefined)
    await started

    await transport.send(line({ command: "get_version" }))

    expect(onLine).toHaveBeenCalledWith(expect.stringContaining(`"version":"${APP_VERSION}"`))
  })

  it("reports an unreadable scenario and stays unavailable", async () => {
    scenarios.load.mockRejectedValue(new DemoScenarioError("schema_version", "1"))
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const available = await transport.start(handlers)

    expect(available).toBe(false)
    expect(error).toHaveBeenCalled()
  })

  it("lets a programming error outside the scenario path propagate", async () => {
    scenarios.load.mockRejectedValue(new TypeError("bug"))

    const started = transport.start(handlers)

    await expect(started).rejects.toThrow("bug")
  })

  it("rejects a malformed line instead of throwing synchronously", async () => {
    await transport.start(handlers)

    const sent = transport.send("not json")

    await expect(sent).rejects.toBeInstanceOf(SyntaxError)
  })

  it("answers get_interrupted_run with its recorded line", async () => {
    await transport.start(handlers)

    await transport.send(line({ command: "get_interrupted_run" }))

    expect(onLine).toHaveBeenCalledWith(line(INTERRUPTED_LINE))
  })

  it("leaves any other command unanswered", async () => {
    await transport.start(handlers)

    await transport.send(line({ command: "list_runs" }))

    expect(onLine).not.toHaveBeenCalled()
  })
})
