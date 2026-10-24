import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"

import { hostOf, iconOf } from "../../../../fixtures/dom"
import type { TrackResolution } from "../../../core/sidecar/protocol"

import type { IconName } from "./icon.component"
import { type RowStatus, StateTagComponent } from "./state-tag.component"

interface Case {
  readonly name: string
  readonly status: RowStatus
  readonly resolution: TrackResolution | null
  readonly severity: string
  readonly icon: IconName
  readonly label: string
}

/** Les lignes de DESIGN.md § Couleurs Semantiques que le flux fait circuler. */
const CASES: readonly Case[] = [
  {
    name: "a pending arbitration",
    status: "awaiting",
    resolution: null,
    severity: "info",
    icon: "info-circle",
    label: "tagging.state.awaiting",
  },
  {
    name: "a track not searched yet",
    status: "pending",
    resolution: null,
    severity: "secondary",
    icon: "clock",
    label: "tagging.state.pending",
  },
  {
    name: "an automatic resolution",
    status: "resolved",
    resolution: "auto",
    severity: "success",
    icon: "check",
    label: "tagging.state.auto",
  },
  {
    name: "an arbitrated resolution",
    status: "resolved",
    resolution: "arbitration",
    severity: "success",
    icon: "check",
    label: "tagging.state.arbitrated",
  },
  {
    name: "a resolution by url",
    status: "resolved",
    resolution: "url",
    severity: "success",
    icon: "check",
    label: "tagging.state.url",
  },
  {
    name: "an unresolved track",
    status: "unresolved",
    resolution: "none",
    severity: "danger",
    icon: "times",
    label: "tagging.state.unresolved",
  },
  {
    name: "a track written after an arbitration",
    status: "written",
    resolution: "arbitration",
    severity: "success",
    icon: "check",
    label: "tagging.state.arbitrated",
  },
  {
    name: "a failed write",
    status: "write_error",
    resolution: "auto",
    severity: "danger",
    icon: "exclamation-triangle",
    label: "tagging.state.writeError",
  },
  {
    name: "a rolled back track",
    status: "rolled_back",
    resolution: "auto",
    severity: "secondary",
    icon: "undo",
    label: "tagging.state.rolledBack",
  },
  {
    name: "a track the settled run did not process",
    status: "not_processed",
    resolution: null,
    severity: "secondary",
    icon: "minus-circle",
    label: "tagging.state.notProcessed",
  },
]

const mount = (shown: Pick<Case, "status" | "resolution">) => {
  const fixture = TestBed.createComponent(StateTagComponent)
  fixture.componentRef.setInput("status", shown.status)
  fixture.componentRef.setInput("resolution", shown.resolution)
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
})
