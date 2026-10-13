import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"

import { action, linkField, page, pasteLink } from "../../../../fixtures/dialog"
import { sidecarStub } from "../../../../fixtures/sidecar-stub"
import { PENDING_TRACK, recoveredTrack, unresolvedTrack } from "../../../../fixtures/tagging"
import { translateWith } from "../../../../fixtures/translate"
import { TRACK_URL, urlRecoveryError } from "../../../../fixtures/url-recovery"
import type { SidecarErrorEvent } from "../../../core/sidecar/protocol"
import { SidecarService } from "../../../core/sidecar/sidecar.service"
import type { TaggingTrack } from "../../../core/stores/tagging-run.store"

import { RecoveryUiStore } from "./recovery-ui.store"
import { UrlRecoveryDialogComponent } from "./url-recovery-dialog.component"

const FIRST = unresolvedTrack("a.mp3", "no_result")
const SECOND: TaggingTrack = {
  ...unresolvedTrack("b.mp3", "below_threshold"),
  artist: "Orla Quenby",
  title: "Kelvor",
}
const TWO_LINES: readonly TaggingTrack[] = [FIRST, SECOND]

interface Overrides {
  readonly tracks?: readonly TaggingTrack[]
  readonly tagging?: boolean
  readonly busy?: readonly string[]
  readonly errors?: ReadonlyMap<string, SidecarErrorEvent>
}

const mount = ({ tracks = TWO_LINES, tagging = false, busy = [], errors }: Overrides = {}) => {
  const service = sidecarStub({
    tagging: signal(tagging),
    taggingRunId: signal<string | null>("run-1"),
    taggingTracks: signal(tracks),
    recoverableTracks: signal(tracks),
    urlRecoveryBusy: signal<ReadonlySet<string>>(new Set(busy)),
    urlRecoveryErrors: signal<ReadonlyMap<string, SidecarErrorEvent>>(errors ?? new Map()),
  })
  TestBed.configureTestingModule({
    imports: [UrlRecoveryDialogComponent],
    providers: [provideTranslateService(), { provide: SidecarService, useValue: service }],
  })
  const recovery = TestBed.inject(RecoveryUiStore)
  const fixture = TestBed.createComponent(UrlRecoveryDialogComponent)
  recovery.open("a.mp3")
  fixture.detectChanges()

  return { fixture, service, recovery }
}

const pressEnter = (): void => {
  linkField()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
}

describe("UrlRecoveryDialogComponent", () => {
  it("shows the identity of the targeted track with its reason", () => {
    mount()

    const text = page().textContent

    expect(text).toContain("Lior Vance - Dim Orbit")
    expect(text).toContain("tagging.reason.no_result")
  })

  it("names the source of a track already resolved by url", () => {
    const recovered: TaggingTrack = {
      ...recoveredTrack(PENDING_TRACK.trackId),
      source: "soundcloud",
    }
    const { fixture } = mount({ tracks: [recovered] })
    translateWith({ tagging: { recovery: { recovered: "Recovered on {{source}}" } } })

    fixture.detectChanges()

    expect(page().textContent).toContain("Recovered on SoundCloud")
  })

  it("disables the resolve button on an empty field", () => {
    mount()

    expect(action("resolve-url")?.disabled).toBe(true)
  })

  it("sends the pasted url for its track", () => {
    const { fixture, service } = mount()
    pasteLink(TRACK_URL)
    fixture.detectChanges()

    action("resolve-url")?.click()

    expect(service.resolveByUrl).toHaveBeenCalledWith("a.mp3", TRACK_URL)
  })

  it.each<[string, string, readonly string[], number]>([
    ["a pasted field", TRACK_URL, [], 1],
    ["an empty field", "", [], 0],
    ["a waiting track", TRACK_URL, ["a.mp3"], 0],
  ])("sends the pasted url on enter and ignores enter on %s", (_case, url, busy, calls) => {
    const { fixture, service } = mount({ busy })
    pasteLink(url)
    fixture.detectChanges()

    pressEnter()

    expect(service.resolveByUrl).toHaveBeenCalledTimes(calls)
  })

  it("names the track in the field label", () => {
    const { fixture } = mount()
    translateWith({ tagging: { recovery: { field: "Link for {{track}}" } } })

    fixture.detectChanges()

    expect(linkField()?.getAttribute("aria-label")).toBe("Link for Lior Vance - Dim Orbit")
  })

  it("keeps the pasted url in its field once the track is recovered", () => {
    const { fixture, service } = mount()
    pasteLink(TRACK_URL)
    fixture.detectChanges()
    action("resolve-url")?.click()
    const recovered: TaggingTrack = {
      ...FIRST,
      state: "resolved",
      resolution: "url",
      failureReason: null,
      source: "bandcamp",
    }

    service.taggingTracks.set([recovered, SECOND])
    service.recoverableTracks.set([recovered, SECOND])
    fixture.detectChanges()

    expect(linkField()?.value).toBe(TRACK_URL)
  })

  it("shows a spinner and disables the button while the track waits", () => {
    const { fixture } = mount({ busy: ["a.mp3"] })
    pasteLink(TRACK_URL)
    fixture.detectChanges()

    const button = action("resolve-url")

    expect(button?.disabled).toBe(true)
    expect(button?.querySelector('[data-p-icon="spinner"]')).not.toBeNull()
  })

  it("shows an error for the displayed track only", () => {
    const { fixture, service } = mount({
      errors: new Map([["b.mp3", urlRecoveryError("b.mp3", "unsupported_url")]]),
    })
    const elsewhere = page().querySelector("app-error-message")

    service.urlRecoveryErrors.set(new Map([["a.mp3", urlRecoveryError("a.mp3")]]))
    fixture.detectChanges()

    expect(elsewhere).toBeNull()
    expect(page().querySelector("app-error-message")).not.toBeNull()
  })

  it("goes to the next track on skip and closes on the last one", () => {
    const { fixture, recovery } = mount()

    action("skip")?.click()
    fixture.detectChanges()
    const second = page().textContent
    action("skip")?.click()
    fixture.detectChanges()

    expect(second).toContain("Orla Quenby - Kelvor")
    expect(recovery.target()).toBeNull()
  })

  it("disables the field during a search", () => {
    mount({ tagging: true })

    expect(linkField()?.disabled).toBe(true)
  })

  it("closes when its track is no longer recoverable", () => {
    const { fixture, service, recovery } = mount()

    service.recoverableTracks.set([])
    fixture.detectChanges()

    expect(recovery.target()).toBeNull()
  })
})
