import { TestBed } from "@angular/core/testing"

import { DemoScenarioService } from "./demo-scenario.service"
import { DemoScenarioError } from "./scenario"

describe("DemoScenarioService", () => {
  let service: DemoScenarioService

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [DemoScenarioService] })
    service = TestBed.inject(DemoScenarioService)
  })

  it("reports an unreachable scenario as a DemoScenarioError carrying the cause", async () => {
    const cause = new TypeError("Failed to fetch")
    vi.spyOn(globalThis, "fetch").mockRejectedValue(cause)

    const loaded = service.load()

    await expect(loaded).rejects.toMatchObject({ name: "DemoScenarioError", cause })
  })

  it.each([
    {
      case: "reports an unreadable JSON body as a DemoScenarioError",
      response: () => new Response("{broken"),
    },
    {
      case: "reports a failed response as a DemoScenarioError",
      response: () => new Response("", { status: 404 }),
    },
  ])("$case", async ({ response }) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response())

    const loaded = service.load()

    await expect(loaded).rejects.toBeInstanceOf(DemoScenarioError)
  })

  it("fetches the scenario again after a failed load", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    await expect(service.load()).rejects.toBeInstanceOf(DemoScenarioError)
    fetch.mockResolvedValueOnce(new Response("{broken"))

    const retried = service.load()

    await expect(retried).rejects.toBeInstanceOf(DemoScenarioError)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
