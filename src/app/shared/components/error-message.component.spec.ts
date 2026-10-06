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

  it.each<[string, Record<string, unknown>, Record<string, unknown>]>([
    [
      "known-source",
      { source: "bandcamp", track_id: "a.mp3" },
      { source: "Bandcamp", track_id: "a.mp3" },
    ],
    ["unknown-source", { source: "deezer" }, { source: "deezer" }],
  ])("names the source brand in a translated message (%s)", (_case, params, expected) => {
    TestBed.configureTestingModule({
      imports: [ErrorMessageComponent],
      providers: [provideTranslateService()],
    })
    const fixture = TestBed.createComponent(ErrorMessageComponent)

    fixture.componentRef.setInput("error", {
      event: "error",
      code: "source_unavailable",
      params,
      message: "",
      command: "resolve_by_url",
    })

    expect(fixture.componentInstance["params"]()).toEqual(expected)
  })
})
