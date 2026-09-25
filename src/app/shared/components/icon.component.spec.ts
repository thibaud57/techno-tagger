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

  it("defaults the size token to 20 when none is given", () => {
    const fixture = TestBed.createComponent(IconComponent)
    fixture.componentRef.setInput("name", "file")

    fixture.detectChanges()

    expect(fixture.componentInstance.size()).toBe(20)
  })
})
