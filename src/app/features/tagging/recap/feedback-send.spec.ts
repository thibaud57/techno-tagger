import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"

import { silenceConsoleError } from "../../../../fixtures/console"
import { nativeStub } from "../../../../fixtures/native-stub"
import { sidecarStub } from "../../../../fixtures/sidecar-stub"
import { NativeService } from "../../../core/platform/native.service"
import type { FeedbackReadyEvent } from "../../../core/sidecar/protocol"
import { SidecarService } from "../../../core/sidecar/sidecar.service"

import { type FeedbackTarget, injectFeedbackSend } from "./feedback-send"

const READY: FeedbackReadyEvent = {
  event: "feedback_ready",
  run_id: "a3f9c1",
  url: "https://github.example/issues/new?template=matching-report.yml",
  export_path: String.raw`C:\data\feedback\20261006T211403Z-a3f9c1.json`,
}

const setUp = (
  target: FeedbackTarget | null = { runId: "a3f9c1", hasReport: true },
  held: FeedbackReadyEvent | null = null,
) => {
  const available = signal<boolean | null>(true)
  const ready = signal<FeedbackReadyEvent | null>(held)
  const pending = signal<string | null>(null)
  const service = sidecarStub({ available, feedbackReady: ready, feedbackPending: pending })
  const native = nativeStub()
  TestBed.configureTestingModule({
    providers: [
      { provide: SidecarService, useValue: service },
      { provide: NativeService, useValue: native },
    ],
  })
  const send = TestBed.runInInjectionContext(() => injectFeedbackSend(signal(target)))

  return { send, service, native, available, ready, pending }
}

describe("injectFeedbackSend", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("asks the engine for the issue of the run on screen", () => {
    const { send, service } = setUp()

    send.send()

    expect(service.prepareFeedback).toHaveBeenCalledWith("a3f9c1")
  })

  it("opens the issue then reveals the export once the asked run is ready", async () => {
    const calls: string[] = []
    const { send, native, ready } = setUp()
    native.openUrl.mockImplementationOnce(() => {
      calls.push("open")
      return Promise.resolve()
    })
    native.revealItemInDir.mockImplementationOnce(() => {
      calls.push("reveal")
      return Promise.resolve()
    })
    send.send()

    ready.set(READY)
    TestBed.tick()

    await vi.waitFor(() => {
      expect(calls).toEqual(["open", "reveal"])
    })
    expect(native.openUrl).toHaveBeenCalledWith(READY.url)
    expect(native.revealItemInDir).toHaveBeenCalledWith(READY.export_path)
  })

  it("still reveals the export when the browser does not open", async () => {
    const logged = silenceConsoleError()
    const { send, native, ready } = setUp()
    native.openUrl.mockRejectedValueOnce(new Error("no default browser"))
    send.send()

    ready.set(READY)
    TestBed.tick()

    await vi.waitFor(() => {
      expect(native.revealItemInDir).toHaveBeenCalledWith(READY.export_path)
    })
    expect(logged).toHaveBeenCalledTimes(1)
  })

  it("logs the failure when the export cannot be revealed", async () => {
    const logged = silenceConsoleError()
    const { send, native, ready } = setUp()
    native.revealItemInDir.mockRejectedValueOnce(new Error("explorer refused"))
    send.send()

    ready.set(READY)
    TestBed.tick()

    await vi.waitFor(() => {
      expect(logged).toHaveBeenCalledTimes(1)
    })
    expect(native.openUrl).toHaveBeenCalledWith(READY.url)
  })

  it("opens nothing for the issue of another run", () => {
    const { send, native, ready } = setUp()
    send.send()

    ready.set({ ...READY, run_id: "b4c5d6" })
    TestBed.tick()

    expect(native.openUrl).not.toHaveBeenCalled()
  })

  it("opens nothing for an issue already held when the page is created", () => {
    const { native } = setUp(undefined, READY)

    TestBed.tick()

    expect(native.openUrl).not.toHaveBeenCalled()
  })

  it("asks once while the issue of the run is being prepared", () => {
    const { send, service, pending } = setUp()
    pending.set("a3f9c1")

    send.send()

    expect(send.pending()).toBe(true)
    expect(service.prepareFeedback).not.toHaveBeenCalled()
  })

  it("greys the button with the engine reason once the engine is lost during the wait", () => {
    const { send, available, pending } = setUp()
    pending.set("a3f9c1")

    pending.set(null)
    available.set(false)

    expect(send.pending()).toBe(false)
    expect(send.blockedReason()).toBe("settings.admin.starting")
  })

  it.each<[string, boolean | null, FeedbackTarget | null, string | null]>([
    [
      "an engine that is starting",
      null,
      { runId: "a3f9c1", hasReport: true },
      "settings.admin.starting",
    ],
    [
      "an engine that is starting and a run without report",
      null,
      { runId: "a3f9c1", hasReport: false },
      "settings.admin.starting",
    ],
    [
      "a run without report",
      true,
      { runId: "a3f9c1", hasReport: false },
      "recap.feedback.unavailable",
    ],
    ["no run on screen", true, null, "recap.feedback.unavailable"],
    ["a run with its report", true, { runId: "a3f9c1", hasReport: true }, null],
  ])("gives the reason of %s", (_case, engine, target, reason) => {
    const { send, available, service } = setUp(target)
    available.set(engine)

    send.send()

    expect(send.blockedReason()).toBe(reason)
    expect(service.prepareFeedback).toHaveBeenCalledTimes(reason === null ? 1 : 0)
  })
})
