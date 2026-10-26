import { TestBed } from "@angular/core/testing"

import { NativeService } from "../core/platform/native.service"
import { scenarioWith } from "../../fixtures/demo-scenario"
import { DemoNativeService } from "./demo-native.service"
import { DemoScenarioService } from "./demo-scenario.service"

describe("DemoNativeService", () => {
  let demoNative: NativeService

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        DemoNativeService,
        { provide: DemoScenarioService, useValue: { scenario: () => scenarioWith({}) } },
      ],
    })
    demoNative = TestBed.inject(DemoNativeService)
  })

  it.each([
    ["library", "LIB"],
    ["destination", "DEST"],
    ["tagging_folder", "DEST"],
    ["playlist", "LIB/dump.xspf"],
  ] as const)("picks the scenario path matching the %s target", async (target, expected) => {
    const path = await demoNative.pickPath(target)

    expect(path).toBe(expected)
  })

  it("serves a recorded artwork from the demo assets", () => {
    expect(demoNative.assetUrl("artworks/CH012.svg")).toBe("/demo/artworks/CH012.svg")
  })
})
