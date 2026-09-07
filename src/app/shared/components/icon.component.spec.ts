import { TestBed } from "@angular/core/testing"

import { ICON_NAMES, IconComponent } from "./icon.component"

/**
 * Le `@switch` n'est pas verifie exhaustif par Angular : un nom ajoute a l'union
 * sans son `@case` rendrait une icone vide, sans erreur nulle part.
 */
describe("IconComponent", () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [IconComponent] })
  })

  it.each(ICON_NAMES)("rend un SVG pour %s", (name) => {
    const fixture = TestBed.createComponent(IconComponent)
    fixture.componentRef.setInput("name", name)

    fixture.detectChanges()

    const host = fixture.nativeElement as HTMLElement
    expect(host.querySelector(`svg[data-p-icon="${name}"]`)).not.toBeNull()
  })

  it("pose le token de taille en largeur et hauteur du SVG", () => {
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
