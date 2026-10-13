import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"

import { translateWith } from "../../../../fixtures/translate"
import type { RollbackFailure } from "../../../core/sidecar/protocol"

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
  translateWith({
    rollback: {
      failures: "not restored {{count}}",
      failure: "{{file}} = {{reason}}",
      reason: { name_taken: "taken" },
    },
    reason: {
      file_locked: "locked",
      write_failed: "not written",
      fix: { file_locked: "Close it, then {{retry}}." },
      retry: { rollback: "restore again", write: "retry the write" },
    },
  })
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

  it("composes a shared file reason with the gesture to restore again", () => {
    const root = mount([{ ...TAKEN, reason: "file_locked" }])

    const text = root.querySelector("[data-rollback-failures]")?.textContent ?? ""

    expect(text).toContain("= locked\nClose it, then restore again.")
    expect(text).not.toContain("retry the write")
  })

  it("gives a shared reason without a gesture its cause alone", () => {
    const root = mount([{ ...TAKEN, reason: "write_failed" }])

    const text = root.querySelector("[data-rollback-failures]")?.textContent ?? ""

    expect(text).toContain("= not written")
    expect(text).not.toContain("then")
  })

  it("renders nothing without failure", () => {
    const root = mount([])

    expect(root.querySelector("[data-rollback-failures]")).toBeNull()
  })
})
