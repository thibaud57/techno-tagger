import { TestBed } from "@angular/core/testing"

import { ICON_NAMES, IconComponent } from "./icon.component"

/** Parcourt `ICON_NAMES` : Angular ne verifie pas l'exhaustivite d'un `@switch`. */
describe("IconComponent", () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [IconComponent] })
  })

  it.each(ICON_NAMES)("renders an SVG for %s", (name) => {
    const fixture = TestBed.createComponent(IconComponent)
    fixture.componentRef.setInput("name", name)

    fixture.detectChanges()

    const host = fixture.nativeElement as HTMLElement
    expect(host.querySelector(`svg[data-p-icon="${name}"]`)).not.toBeNull()
  })

  it("applies the size token to the SVG width and height", () => {
    const fixture = TestBed.createComponent(IconComponent)
    fixture.componentRef.setInput("name", "file")
    fixture.componentRef.setInput("size", 24)

    fixture.detectChanges()

    const host = fixture.nativeElement as HTMLElement
    const svg = host.querySelector("svg")
    expect(svg?.getAttribute("width")).toBe("24")
    expect(svg?.getAttribute("height")).toBe("24")
  })
})
