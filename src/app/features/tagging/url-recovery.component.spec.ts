import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { TranslateService, provideTranslateService } from "@ngx-translate/core"

import { PENDING_TRACK } from "../../../fixtures/tagging"
import { urlRecoveryError } from "../../../fixtures/url-recovery"
import type { SidecarErrorEvent, TrackFailureReason } from "../../core/models/protocol"
import { SidecarService } from "../../core/sidecar.service"
import type { TaggingTrack } from "../../core/tagging-run.store"

import { UrlRecoveryComponent } from "./url-recovery.component"

const URL = "https://amelielens.bandcamp.com/track/basiel"

const unresolved = (trackId: string, failureReason: TrackFailureReason): TaggingTrack => ({
  ...PENDING_TRACK,
  trackId,
  fileName: trackId,
  state: "unresolved",
  resolution: "none",
  failureReason,
})

const FIRST = unresolved("a.mp3", "no_result")
const SECOND: TaggingTrack = {
  ...unresolved("b.mp3", "below_threshold"),
  artist: "Amelie Lens",
  title: "Basiel",
}
const TWO_LINES: readonly TaggingTrack[] = [FIRST, SECOND]

const mount = (overrides: Partial<Record<string, unknown>> = {}) => {
  const service = {
    recoverableTracks: signal<readonly TaggingTrack[]>(TWO_LINES),
    urlRecoveryBusy: signal<ReadonlySet<string>>(new Set()),
    urlRecoveryErrors: signal<ReadonlyMap<string, SidecarErrorEvent>>(new Map()),
    resolveByUrl: vi.fn(() => Promise.resolve()),
    ...overrides,
  }
  TestBed.configureTestingModule({
    imports: [UrlRecoveryComponent],
    providers: [provideTranslateService(), { provide: SidecarService, useValue: service }],
  })
  const fixture = TestBed.createComponent(UrlRecoveryComponent)
  fixture.detectChanges()

  return { fixture, service }
}

const lines = (fixture: { nativeElement: unknown }): HTMLElement[] => [
  ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>("li"),
]

const resolveButton = (line: HTMLElement | undefined): HTMLButtonElement | null =>
  line?.querySelector<HTMLButtonElement>('[data-action="resolve-url"]') ?? null

const paste = (line: HTMLElement | undefined, url: string): void => {
  const field = line?.querySelector("input")
  if (field) {
    field.value = url
    field.dispatchEvent(new Event("input"))
  }
}

const pressEnter = (line: HTMLElement | undefined): void => {
  line?.querySelector("input")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))
}

const translateWith = (recovery: Record<string, string>): void => {
  const translate = TestBed.inject(TranslateService)
  translate.setTranslation("en", { tagging: { recovery } })
  translate.use("en")
}

describe("UrlRecoveryComponent", () => {
  it("lists a line per recoverable track with its identity and its reason", () => {
    const { fixture } = mount()

    const shown = lines(fixture)

    expect(shown).toHaveLength(2)
    expect(shown[0]?.textContent).toContain("Adam Beyer - Your Mind")
    expect(shown[0]?.textContent).toContain("tagging.reason.no_result")
    expect(shown[1]?.textContent).toContain("tagging.reason.below_threshold")
  })

  it("names the source of a track already resolved by url", () => {
    const recovered: TaggingTrack = {
      ...PENDING_TRACK,
      state: "resolved",
      resolution: "url",
      source: "soundcloud",
    }
    const { fixture } = mount({ recoverableTracks: signal([recovered]) })
    translateWith({ recovered: "Recovered on {{source}}" })

    fixture.detectChanges()

    expect(lines(fixture)[0]?.textContent).toContain("Recovered on SoundCloud")
  })

  it("disables the resolve button on an empty field", () => {
    const { fixture } = mount()

    const button = resolveButton(lines(fixture)[0])

    expect(button?.disabled).toBe(true)
  })

  it("sends the pasted url for its track", () => {
    const { fixture, service } = mount()
    paste(lines(fixture)[0], URL)
    fixture.detectChanges()

    resolveButton(lines(fixture)[0])?.click()

    expect(service.resolveByUrl).toHaveBeenCalledWith("a.mp3", URL)
  })

  it.each<[string, string, readonly string[], number]>([
    ["a pasted field", URL, [], 1],
    ["an empty field", "", [], 0],
    ["a waiting line", URL, ["a.mp3"], 0],
  ])("sends the pasted url on enter and ignores enter on %s", (_case, url, busy, calls) => {
    const { fixture, service } = mount({ urlRecoveryBusy: signal(new Set(busy)) })
    paste(lines(fixture)[0], url)
    fixture.detectChanges()

    pressEnter(lines(fixture)[0])

    expect(service.resolveByUrl).toHaveBeenCalledTimes(calls)
  })

  it("names the track in the field label", () => {
    const { fixture } = mount()
    translateWith({ field: "Link for {{track}}" })

    fixture.detectChanges()

    expect(lines(fixture)[0]?.querySelector("input")?.getAttribute("aria-label")).toBe(
      "Link for Adam Beyer - Your Mind",
    )
  })

  it("keeps the pasted url in its field once the track is recovered", () => {
    const { fixture, service } = mount()
    paste(lines(fixture)[0], URL)
    fixture.detectChanges()
    resolveButton(lines(fixture)[0])?.click()

    service.recoverableTracks.set([
      { ...FIRST, state: "resolved", resolution: "url", failureReason: null, source: "bandcamp" },
      SECOND,
    ])
    fixture.detectChanges()

    expect(lines(fixture)[0]?.querySelector("input")?.value).toBe(URL)
  })

  it("shows a spinner and disables the button while the track waits", () => {
    const { fixture } = mount({ urlRecoveryBusy: signal(new Set(["a.mp3"])) })
    paste(lines(fixture)[0], URL)
    fixture.detectChanges()

    const button = resolveButton(lines(fixture)[0])

    expect(button?.disabled).toBe(true)
    expect(button?.querySelector('[data-p-icon="spinner"]')).not.toBeNull()
  })

  it("shows an error under its own line only", () => {
    const { fixture } = mount({
      urlRecoveryErrors: signal(new Map([["b.mp3", urlRecoveryError("b.mp3", "unsupported_url")]])),
    })

    const shown = lines(fixture)

    expect(shown[0]?.querySelector("app-error-message")).toBeNull()
    expect(shown[1]?.querySelector("app-error-message")).not.toBeNull()
  })

  it("shows the empty state when nothing is left to recover", () => {
    const { fixture } = mount({ recoverableTracks: signal([]) })

    const host = fixture.nativeElement as HTMLElement

    expect(host.querySelector("app-empty-state")).not.toBeNull()
    expect(lines(fixture)).toHaveLength(0)
  })
})
