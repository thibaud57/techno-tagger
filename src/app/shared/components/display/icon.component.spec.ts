import { TestBed } from "@angular/core/testing"

import { hostOf } from "../../../../fixtures/dom"
import { ICON_NAMES, IconComponent } from "./icon.component"

/** Parcourt `ICON_NAMES` : Angular ne verifie pas l'exhaustivite d'un `@switch`. */
describe("IconComponent", () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [IconComponent] })
  })

  it.each(ICON_NAMES)("renders an SVG and names its host for %s", (name) => {
    const fixture = TestBed.createComponent(IconComponent)
    fixture.componentRef.setInput("name", name)

    fixture.detectChanges()

    expect(hostOf(fixture).querySelector("svg")).not.toBeNull()
    expect(hostOf(fixture).getAttribute("data-icon")).toBe(name)
  })
})
