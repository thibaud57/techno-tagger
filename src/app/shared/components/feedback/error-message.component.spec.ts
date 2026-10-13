import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"

import { commandError, phaseBusy } from "../../../../fixtures/write"
import type { BusyPhase } from "../../../core/sidecar/protocol"
import { ErrorMessageComponent } from "./error-message.component"

describe("ErrorMessageComponent", () => {
  it("joins a list param before it reaches the translation", () => {
    TestBed.configureTestingModule({
      imports: [ErrorMessageComponent],
      providers: [provideTranslateService()],
    })
    const fixture = TestBed.createComponent(ErrorMessageComponent)

    fixture.componentRef.setInput(
      "error",
      commandError("list_playlists", "vlc_schema_mismatch", { missing: ["Media", "Playlist"] }),
    )

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

    fixture.componentRef.setInput(
      "error",
      commandError("resolve_by_url", "source_unavailable", params),
    )

    expect(fixture.componentInstance["params"]()).toEqual(expected)
  })

  it.each<BusyPhase>(["extraction", "tagging", "write", "rollback"])(
    "words a busy phase by the phase that runs (%s)",
    (phase) => {
      TestBed.configureTestingModule({
        imports: [ErrorMessageComponent],
        providers: [provideTranslateService()],
      })
      const fixture = TestBed.createComponent(ErrorMessageComponent)

      fixture.componentRef.setInput("error", phaseBusy("start_tagging", phase))

      expect(fixture.componentInstance["key"]()).toBe(`errors.phase_busy.${phase}`)
    },
  )

  it("keeps the code as the key of any other error", () => {
    TestBed.configureTestingModule({
      imports: [ErrorMessageComponent],
      providers: [provideTranslateService()],
    })
    const fixture = TestBed.createComponent(ErrorMessageComponent)

    fixture.componentRef.setInput("error", commandError("commit_run", "write_not_open"))

    expect(fixture.componentInstance["key"]()).toBe("errors.write_not_open")
  })
})
