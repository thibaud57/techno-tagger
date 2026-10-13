import { TestBed } from "@angular/core/testing"

import { SourceLogoComponent, type SourceName } from "./source-logo.component"

/** Une source sans trace rendrait une cellule vide, sans erreur. */
describe("SourceLogoComponent", () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [SourceLogoComponent] })
  })

  it.each<SourceName>(["beatport", "bandcamp", "soundcloud", "vlc"])(
    "renders a path for %s",
    (source) => {
      const fixture = TestBed.createComponent(SourceLogoComponent)
      fixture.componentRef.setInput("source", source)

      fixture.detectChanges()

      const path = (fixture.nativeElement as HTMLElement).querySelector("path")
      expect(path?.getAttribute("d")).toBeTruthy()
    },
  )
})
