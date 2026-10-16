import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"

import { hostOf, iconOf } from "../../../../fixtures/dom"
import type { TrackResolution, TrackState } from "../../../core/sidecar/protocol"

import type { IconName } from "./icon.component"
import { StateTagComponent } from "./state-tag.component"

interface Case {
  readonly name: string
  readonly state: TrackState | null
  readonly resolution: TrackResolution | null
  readonly awaiting: boolean
  readonly interrupted?: boolean
  readonly severity: string
  readonly icon: IconName
  readonly label: string
}

/** Les lignes de DESIGN.md § Couleurs Semantiques que le flux fait circuler. */
const CASES: readonly Case[] = [
  {
    name: "a pending arbitration",
    state: null,
    resolution: null,
    awaiting: true,
    severity: "info",
    icon: "info-circle",
    label: "tagging.state.awaiting",
  },
  {
    name: "a track not searched yet",
    state: null,
    resolution: null,
    awaiting: false,
    severity: "secondary",
    icon: "clock",
    label: "tagging.state.pending",
  },
  {
    name: "an automatic resolution",
    state: "resolved",
    resolution: "auto",
    awaiting: false,
    severity: "success",
    icon: "check",
    label: "tagging.state.auto",
  },
  {
    name: "an arbitrated resolution",
    state: "resolved",
    resolution: "arbitration",
    awaiting: false,
    severity: "success",
    icon: "check",
    label: "tagging.state.arbitrated",
  },
  {
    name: "a resolution by url",
    state: "resolved",
    resolution: "url",
    awaiting: false,
    severity: "success",
    icon: "check",
    label: "tagging.state.url",
  },
  {
    name: "an unresolved track",
    state: "unresolved",
    resolution: "none",
    awaiting: false,
    severity: "danger",
    icon: "times",
    label: "tagging.state.unresolved",
  },
  {
    name: "a track written after an arbitration",
    state: "written",
    resolution: "arbitration",
    awaiting: false,
    severity: "success",
    icon: "check",
    label: "tagging.state.arbitrated",
  },
  {
    name: "a failed write",
    state: "write_error",
    resolution: "auto",
    awaiting: false,
    severity: "danger",
    icon: "exclamation-triangle",
    label: "tagging.state.writeError",
  },
  {
    name: "a rolled back track",
    state: "rolled_back",
    resolution: "auto",
    awaiting: false,
    severity: "secondary",
    icon: "undo",
    label: "tagging.state.rolledBack",
  },
  {
    name: "a track the interrupted run did not process",
    state: null,
    resolution: null,
    awaiting: false,
    interrupted: true,
    severity: "secondary",
    icon: "minus-circle",
    label: "tagging.state.notProcessed",
  },
]

const mount = (shown: Partial<Case>) => {
  const fixture = TestBed.createComponent(StateTagComponent)
  fixture.componentRef.setInput("state", shown.state ?? null)
  fixture.componentRef.setInput("resolution", shown.resolution ?? null)
  fixture.componentRef.setInput("awaiting", shown.awaiting ?? false)
  fixture.componentRef.setInput("interrupted", shown.interrupted ?? false)
  fixture.detectChanges()

  return hostOf(fixture)
}

describe("StateTagComponent", () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [StateTagComponent],
      providers: [provideTranslateService()],
    })
  })

  it.each(CASES)("renders the family, the icon and the label of $name", (shown) => {
    const element = mount(shown)

    expect(element.textContent).toContain(shown.label)
    expect(element.querySelector(`[data-severity="${shown.severity}"]`)).not.toBeNull()
    expect(iconOf(element, shown.icon)).not.toBeNull()
  })

  it("prefers the pending arbitration over the received state", () => {
    const element = mount({ state: "unresolved", resolution: "none", awaiting: true })

    expect(element.textContent).toContain("tagging.state.awaiting")
  })
})
