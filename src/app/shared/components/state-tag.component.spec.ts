import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"

import type { TrackResolution, TrackState } from "../../core/models/protocol"

import { StateTagComponent } from "./state-tag.component"

interface Case {
  readonly state: TrackState | null
  readonly resolution: TrackResolution | null
  readonly awaiting: boolean
  readonly severity: string
  readonly icon: string
  readonly label: string
}

/** Les six lignes de DESIGN.md § Couleurs Semantiques que la Feature 2 fait circuler. */
const CASES: readonly Case[] = [
  {
    state: null,
    resolution: null,
    awaiting: true,
    severity: "info",
    icon: "info-circle",
    label: "tagging.state.awaiting",
  },
  {
    state: null,
    resolution: null,
    awaiting: false,
    severity: "secondary",
    icon: "clock",
    label: "tagging.state.pending",
  },
  {
    state: "resolved",
    resolution: "auto",
    awaiting: false,
    severity: "success",
    icon: "check",
    label: "tagging.state.auto",
  },
  {
    state: "resolved",
    resolution: "arbitration",
    awaiting: false,
    severity: "success",
    icon: "check",
    label: "tagging.state.arbitrated",
  },
  {
    state: "resolved",
    resolution: "url",
    awaiting: false,
    severity: "success",
    icon: "check",
    label: "tagging.state.url",
  },
  {
    state: "unresolved",
    resolution: "none",
    awaiting: false,
    severity: "danger",
    icon: "times",
    label: "tagging.state.unresolved",
  },
]

const mount = (shown: Partial<Case>) => {
  const fixture = TestBed.createComponent(StateTagComponent)
  fixture.componentRef.setInput("state", shown.state ?? null)
  fixture.componentRef.setInput("resolution", shown.resolution ?? null)
  fixture.componentRef.setInput("awaiting", shown.awaiting ?? false)
  fixture.detectChanges()

  return fixture
}

describe("StateTagComponent", () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [StateTagComponent],
      providers: [provideTranslateService()],
    })
  })

  it.each(CASES)("renders the family, the icon and the label of $label", (shown) => {
    const fixture = mount(shown)

    const element = fixture.nativeElement as HTMLElement

    expect(element.textContent).toContain(shown.label)
    expect(element.querySelector(`[data-severity="${shown.severity}"]`)).not.toBeNull()
    expect(element.querySelector(`[data-p-icon="${shown.icon}"]`)).not.toBeNull()
  })

  it("shows a track left behind by an interrupted run as not processed", () => {
    const fixture = TestBed.createComponent(StateTagComponent)
    fixture.componentRef.setInput("interrupted", true)

    fixture.detectChanges()

    const element = fixture.nativeElement as HTMLElement
    expect(element.textContent).toContain("tagging.state.notProcessed")
    expect(element.querySelector('[data-severity="secondary"]')).not.toBeNull()
    expect(element.querySelector('[data-p-icon="minus-circle"]')).not.toBeNull()
  })

  it("prefers the pending arbitration over the received state", () => {
    const fixture = mount({ state: "unresolved", resolution: "none", awaiting: true })

    const element = fixture.nativeElement as HTMLElement

    expect(element.textContent).toContain("tagging.state.awaiting")
  })
})
