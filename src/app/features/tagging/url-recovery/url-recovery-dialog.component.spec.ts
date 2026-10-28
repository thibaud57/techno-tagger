import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"

import { dialogLabel, linkField, page, pasteLink } from "../../../../fixtures/dialog"
import { action, errorMessageOf, iconOf } from "../../../../fixtures/dom"
import { activeRun, provideSidecarStub, sidecarStub } from "../../../../fixtures/sidecar-stub"
import { PENDING_TRACK, recoveredTrack, unresolvedTrack } from "../../../../fixtures/tagging"
import { translateWith } from "../../../../fixtures/translate"
import { TRACK_URL, urlRecoveryError } from "../../../../fixtures/url-recovery"
import type { SidecarErrorEvent } from "../../../core/sidecar/protocol"
import type { TaggingTrack } from "../../../core/stores/tagging-run.store"

import { RecoveryUiStore } from "./recovery-ui.store"
import { UrlRecoveryDialogComponent } from "./url-recovery-dialog.component"

const FIRST = unresolvedTrack("a.mp3", "no_result")
const SECOND: TaggingTrack = {
  ...unresolvedTrack("b.mp3", "below_threshold"),
  artist: "Amelie Lens",
  title: "Basiel",
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
    ...activeRun(),
    tagging: signal(tagging),
    taggingTracks: signal(tracks),
    recoverableTracks: signal(tracks),
    urlRecoveryBusy: signal<ReadonlySet<string>>(new Set(busy)),
    urlRecoveryErrors: signal<ReadonlyMap<string, SidecarErrorEvent>>(errors ?? new Map()),
  })
  TestBed.configureTestingModule({
    imports: [UrlRecoveryDialogComponent],
    providers: [provideTranslateService(), provideSidecarStub(service)],
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

    expect(page().textContent).toContain("Adam Beyer - Your Mind")
    expect(page().textContent).toContain("tagging.reason.no_result")
  })

  it("names the dialog by the title of its header", () => {
    mount()

    expect(dialogLabel()).toBe(page().querySelector("[data-title]"))
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

  it("sends the pasted url on enter", () => {
    const { fixture, service } = mount()
    pasteLink(TRACK_URL)
    fixture.detectChanges()

    pressEnter()

    expect(service.resolveByUrl).toHaveBeenCalledWith("a.mp3", TRACK_URL)
  })

  it.each<{ case: string; url: string; busy: readonly string[] }>([
    { case: "an empty field", url: "", busy: [] },
    { case: "a waiting track", url: TRACK_URL, busy: ["a.mp3"] },
  ])("ignores enter on $case", ({ url, busy }) => {
    const { fixture, service } = mount({ busy })
    pasteLink(url)
    fixture.detectChanges()

    pressEnter()

    expect(service.resolveByUrl).not.toHaveBeenCalled()
  })

  it("names the track in the field label", () => {
    const { fixture } = mount()
    translateWith({ tagging: { recovery: { field: "Link for {{track}}" } } })

    fixture.detectChanges()

    expect(linkField()?.getAttribute("aria-label")).toBe("Link for Adam Beyer - Your Mind")
  })

  it("moves to the next track once the shown one is recovered", () => {
    const { fixture, service } = mount()
    pasteLink(TRACK_URL)
    fixture.detectChanges()
    action("resolve-url")?.click()

    service.recoverableTracks.set([recoveredTrack("a.mp3"), SECOND])
    service.urlRecovered.set({ trackId: "a.mp3" })
    fixture.detectChanges()

    expect(page().textContent).toContain("Amelie Lens - Basiel")
  })

  it("keeps the pasted url of a recovered track opened again", () => {
    const { fixture, service, recovery } = mount()
    pasteLink(TRACK_URL)
    fixture.detectChanges()
    action("resolve-url")?.click()
    service.recoverableTracks.set([recoveredTrack("a.mp3"), SECOND])
    service.urlRecovered.set({ trackId: "a.mp3" })
    fixture.detectChanges()

    recovery.open("a.mp3")
    fixture.detectChanges()

    expect(linkField()?.value).toBe(TRACK_URL)
  })

  it("disables the resolve button while the track waits", () => {
    const { fixture } = mount({ busy: ["a.mp3"] })
    pasteLink(TRACK_URL)

    fixture.detectChanges()

    expect(action("resolve-url")?.disabled).toBe(true)
  })

  it("shows a spinner in the resolve button while the track waits", () => {
    const { fixture } = mount({ busy: ["a.mp3"] })

    fixture.detectChanges()

    expect(iconOf(page(), "spinner")).not.toBeNull()
  })

  it("shows the error of the displayed track", () => {
    mount({ errors: new Map([["a.mp3", urlRecoveryError("a.mp3")]]) })

    expect(errorMessageOf(page())).not.toBeNull()
  })

  it("shows no error of another track", () => {
    mount({ errors: new Map([["b.mp3", urlRecoveryError("b.mp3", "unsupported_url")]]) })

    expect(errorMessageOf(page())).toBeNull()
  })

  it("goes to the next track on skip", () => {
    const { fixture } = mount()

    action("skip")?.click()
    fixture.detectChanges()

    expect(page().textContent).toContain("Amelie Lens - Basiel")
  })

  it("closes on skip of the last track", () => {
    const { fixture, recovery } = mount()
    action("skip")?.click()
    fixture.detectChanges()

    action("skip")?.click()

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
