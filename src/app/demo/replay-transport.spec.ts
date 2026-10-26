import { TestBed } from "@angular/core/testing"

import type { SidecarHandlers } from "../core/sidecar/sidecar-transport"
import { silenceConsoleError } from "../../fixtures/console"
import { scenarioWith, statefulReply, statelessReply } from "../../fixtures/demo-scenario"
import { DemoScenarioService } from "./demo-scenario.service"
import { ReplayTransport } from "./replay-transport"
import { DemoScenarioError } from "./scenario"

const VERSION_LINE = { event: "version", version: "recorded", api_key_configured: true }
const INTERRUPTED_LINE = { event: "interrupted_run", run: null }
const LIST_RUNS_LINE = { event: "runs", from: "stateless" }
const LIST_RUNS_WRITE_FAILED_LINE = { event: "runs", from: "write_failed" }
const TAGGING_0 = { event: "tagging", n: 0 }
const TAGGING_1 = { event: "tagging", n: 1 }
const TAGGING_2 = { event: "tagging", n: 2 }
const ARBITRATION_LINE = { event: "arbitration" }
const COMMIT_0 = { event: "commit", n: 0 }
const COMMIT_1 = { event: "commit", n: 1 }

const line = (payload: object): string => JSON.stringify(payload)

describe("ReplayTransport", () => {
  const onLine = vi.fn<(line: string) => void>()
  const handlers: SidecarHandlers = { onLine, onStderr: vi.fn(), onTerminated: vi.fn() }
  const scenario = scenarioWith({
    lines: [
      VERSION_LINE,
      INTERRUPTED_LINE,
      LIST_RUNS_LINE,
      LIST_RUNS_WRITE_FAILED_LINE,
      TAGGING_0,
      TAGGING_1,
      TAGGING_2,
      ARBITRATION_LINE,
      COMMIT_0,
      COMMIT_1,
    ],
    stateless: [
      statelessReply("get_version", {}, [0]),
      statelessReply("get_interrupted_run", {}, [1]),
      statelessReply("list_runs", {}, [2]),
      statelessReply("start_tagging", { folder: "LIB" }, [4, 5, 6]),
      statelessReply("commit_run", { run_id: "run" }, [8, 9], { enters: "write_failed" }),
      statelessReply(
        "resolve_arbitration",
        { track_id: "t", source: "beatport", candidate: "1" },
        [7],
      ),
    ],
    stateful: [statefulReply("list_runs", {}, { outcomes: {}, phase: "write_failed" }, [3])],
  })
  const scenarios = {
    load: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    scenario: () => scenario,
  }
  const emitted = (): string[] => onLine.mock.calls.map(([sent]) => sent)
  let transport: ReplayTransport

  beforeEach(() => {
    vi.useFakeTimers()
    scenarios.load.mockResolvedValue()
    TestBed.configureTestingModule({
      providers: [ReplayTransport, { provide: DemoScenarioService, useValue: scenarios }],
    })
    transport = TestBed.inject(ReplayTransport)
  })

  afterEach(() => {
    vi.useRealTimers()
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
    vi.advanceTimersByTime(0)

    expect(onLine).toHaveBeenCalledWith(expect.stringContaining(`"version":"${APP_VERSION}"`))
  })

  it("reports an unreadable scenario and stays unavailable", async () => {
    scenarios.load.mockRejectedValue(new DemoScenarioError("schema_version", "1"))
    const error = silenceConsoleError()

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
    vi.advanceTimersByTime(0)

    expect(onLine).toHaveBeenCalledWith(line(INTERRUPTED_LINE))
  })

  it("emits nothing while send runs", async () => {
    await transport.start(handlers)

    await transport.send(line({ command: "list_runs" }))

    expect(onLine).not.toHaveBeenCalled()
  })

  it("emits a query's line on the next tick", async () => {
    await transport.start(handlers)

    await transport.send(line({ command: "list_runs" }))
    vi.advanceTimersByTime(0)

    expect(emitted()).toEqual([line(LIST_RUNS_LINE)])
  })

  it("spaces the lines of a long phase and answers a query at once", async () => {
    await transport.start(handlers)

    await transport.send(line({ command: "start_tagging", folder: "LIB" }))
    await transport.send(line({ command: "list_runs" }))
    vi.advanceTimersByTime(0)
    const atStart = emitted()
    vi.advanceTimersByTime(200)
    const afterFirstDelay = emitted()
    vi.advanceTimersByTime(200)

    expect(atStart).toEqual([line(TAGGING_0), line(LIST_RUNS_LINE)])
    expect(afterFirstDelay).toEqual([...atStart, line(TAGGING_1)])
    expect(emitted()).toEqual([...afterFirstDelay, line(TAGGING_2)])
  })

  it("interleaves a reply requested during a long phase in order", async () => {
    await transport.start(handlers)
    await transport.send(line({ command: "start_tagging", folder: "LIB" }))

    vi.advanceTimersByTime(250)
    await transport.send(
      line({
        command: "resolve_arbitration",
        track_id: "t",
        source: "beatport",
        candidate: "1",
      }),
    )
    vi.advanceTimersByTime(0)
    vi.advanceTimersByTime(150)

    expect(emitted()).toEqual([
      line(TAGGING_0),
      line(TAGGING_1),
      line(ARBITRATION_LINE),
      line(TAGGING_2),
    ])
  })

  it("answers a query sent during an emission with the new phase", async () => {
    await transport.start(handlers)
    await transport.send(line({ command: "commit_run", run_id: "run" }))
    vi.advanceTimersByTime(0)

    await transport.send(line({ command: "list_runs" }))
    vi.advanceTimersByTime(0)

    expect(emitted()).toEqual([line(COMMIT_0), line(LIST_RUNS_WRITE_FAILED_LINE)])
  })

  it("reports an unrecorded command in the console without answering", async () => {
    await transport.start(handlers)
    const error = silenceConsoleError()

    await transport.send(line({ command: "cancel_run" }))
    vi.runAllTimers()

    expect(onLine).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(
      "[demo] commande hors scenario",
      expect.stringContaining("cancel_run"),
    )
  })
})
