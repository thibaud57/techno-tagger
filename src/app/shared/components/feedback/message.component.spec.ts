import { TestBed } from "@angular/core/testing"

import { hostOf, iconOf } from "../../../../fixtures/dom"
import type { IconName } from "../display/icon.component"
import { MessageComponent, type MessageSeverity } from "./message.component"

describe("MessageComponent", () => {
  it.each<[MessageSeverity, "small" | undefined, IconName, number]>([
    ["info", undefined, "info-circle", 20],
    ["success", undefined, "check-circle", 20],
    ["warn", "small", "exclamation-triangle", 16],
    ["error", undefined, "times-circle", 20],
  ])("shows the icon of a %s message", (severity, size, icon, iconSize) => {
    TestBed.configureTestingModule({ imports: [MessageComponent] })
    const fixture = TestBed.createComponent(MessageComponent)
    fixture.componentRef.setInput("severity", severity)
    fixture.componentRef.setInput("size", size)

    fixture.detectChanges()

    expect(iconOf(hostOf(fixture), icon)).not.toBeNull()
    expect(fixture.componentInstance["iconSize"]()).toBe(iconSize)
  })
})
