import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"

import { ErrorMessageComponent } from "./error-message.component"

describe("ErrorMessageComponent", () => {
  it("joins a list param before it reaches the translation", () => {
    TestBed.configureTestingModule({
      imports: [ErrorMessageComponent],
      providers: [provideTranslateService()],
    })
    const fixture = TestBed.createComponent(ErrorMessageComponent)

    fixture.componentRef.setInput("error", {
      event: "error",
      code: "vlc_schema_mismatch",
      params: { missing: ["Media", "Playlist"] },
      message: "",
    })

    expect(fixture.componentInstance["params"]()).toEqual({ missing: "Media, Playlist" })
  })
})
