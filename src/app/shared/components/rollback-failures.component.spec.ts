import { TestBed } from "@angular/core/testing"
import { TranslateService, provideTranslateService } from "@ngx-translate/core"

import type { RollbackFailure } from "../../core/models/protocol"

import { RollbackFailuresComponent } from "./rollback-failures.component"

const TAKEN: RollbackFailure = {
  track_id: "a.mp3",
  file_name: "Lior Vance - Dim Orbit.mp3",
  reason: "name_taken",
}

const mount = (failures: readonly RollbackFailure[]) => {
  TestBed.configureTestingModule({
    imports: [RollbackFailuresComponent],
    providers: [provideTranslateService()],
  })
  const translate = TestBed.inject(TranslateService)
  translate.setTranslation("en", {
    rollback: {
      failures: "not restored {{count}}",
      failure: "{{file}} = {{reason}}",
      reason: { name_taken: "taken", file_locked: "restore again" },
    },
    tagging: { reason: { file_locked: "retry the write" } },
  })
  translate.use("en")
  const fixture = TestBed.createComponent(RollbackFailuresComponent)
  fixture.componentRef.setInput("failures", failures)
  fixture.detectChanges()

  return fixture.nativeElement as HTMLElement
}

describe("RollbackFailuresComponent", () => {
  it("names each file left as it was with the reason to act on", () => {
    const root = mount([TAKEN])

    const text = root.querySelector("[data-rollback-failures]")?.textContent ?? ""

    expect(text).toContain("not restored 1")
    expect(text).toContain("Lior Vance - Dim Orbit.mp3 = taken")
  })

  it("words the reason for a restore, not for a write", () => {
    const root = mount([{ ...TAKEN, reason: "file_locked" }])

    const text = root.querySelector("[data-rollback-failures]")?.textContent ?? ""

    expect(text).toContain("= restore again")
    expect(text).not.toContain("retry the write")
  })

  it("renders nothing without failure", () => {
    const root = mount([])

    expect(root.querySelector("[data-rollback-failures]")).toBeNull()
  })

  it("takes no space in a column when the list is empty", () => {
    const root = mount([])

    expect(root.classList.contains("contents")).toBe(true)
  })
})
