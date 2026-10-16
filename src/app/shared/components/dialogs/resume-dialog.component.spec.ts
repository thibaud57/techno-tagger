import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { provideRouter } from "@angular/router"
import { provideTranslateService } from "@ngx-translate/core"
import { vi } from "vitest"

import { page } from "../../../../fixtures/dialog"
import { action } from "../../../../fixtures/dom"
import { CORRUPTED, FOLDER_MISSING, INTERRUPTED, UNREADABLE } from "../../../../fixtures/resume"
import { provideSidecarStub, sidecarStub } from "../../../../fixtures/sidecar-stub"
import { stubNavigation } from "../../../../fixtures/router"
import { translateWith } from "../../../../fixtures/translate"
import type { DetectedRun } from "../../../core/stores/resume.store"

import { ResumeDialogComponent } from "./resume-dialog.component"

const mount = (run: DetectedRun | null) => {
  const sidecar = sidecarStub({ interruptedRun: signal(run) })
  TestBed.configureTestingModule({
    imports: [ResumeDialogComponent],
    providers: [provideTranslateService(), provideRouter([]), provideSidecarStub(sidecar)],
  })
  const navigate = stubNavigation("navigate")
  const fixture = TestBed.createComponent(ResumeDialogComponent)
  fixture.detectChanges()

  return { fixture, component: fixture.componentInstance, sidecar, navigate }
}

const offeredActions = (): string[] =>
  ["resume", "later", "discard"].filter((name) => action(name) !== null)

describe("ResumeDialogComponent", () => {
  it("sums up the interrupted run", () => {
    const { fixture } = mount(INTERRUPTED)
    translateWith({ resume: { summary: "{{date}}|{{processed}}/{{total}}" } })
    fixture.detectChanges()

    expect(page().textContent).toContain("resume.title")
    expect(page().textContent).toContain("2026")
    expect(page().textContent).toContain("|62/100")
    expect(page().textContent).toContain(INTERRUPTED.folder)
  })

  it("leaves the initial focus off the destructive button", async () => {
    const { fixture } = mount(INTERRUPTED)

    await fixture.whenStable()

    expect(document.activeElement).not.toBe(action("discard"))
  })

  it("resumes the run then shows the tagging tab", async () => {
    const { sidecar, navigate } = mount(INTERRUPTED)

    action("resume")?.click()

    await vi.waitFor(() => {
      expect(navigate).toHaveBeenCalledWith(["tagging"])
    })
    expect(sidecar.resume).toHaveBeenCalledWith(INTERRUPTED)
  })

  it("stays on the current tab when nothing was resumed", async () => {
    const { component, sidecar, navigate } = mount(INTERRUPTED)
    sidecar.resume.mockResolvedValue(false)

    await component["resume"](INTERRUPTED)

    expect(navigate).not.toHaveBeenCalled()
  })

  it("starts over without asking", () => {
    const { sidecar } = mount(INTERRUPTED)

    action("discard")?.click()

    expect(sidecar.discard).toHaveBeenCalledWith(INTERRUPTED.run_id)
  })

  it("names the missing folder and offers no resume", () => {
    mount(FOLDER_MISSING)

    expect(action("resume")).toBeNull()
    expect(page().textContent).toContain(FOLDER_MISSING.folder)
    expect(page().textContent).toContain("resume.folderMissing")
  })

  it("puts the run off, without discarding it, on the later button", () => {
    const { sidecar } = mount(FOLDER_MISSING)

    action("later")?.click()

    expect(sidecar.dismissInterruptedRun).toHaveBeenCalledOnce()
    expect(sidecar.discard).not.toHaveBeenCalled()
  })

  it("only lets an unreadable plan be discarded", () => {
    mount(UNREADABLE)

    expect(offeredActions()).toEqual(["discard"])
  })

  it("names both versions of an unreadable plan", () => {
    const { fixture } = mount(UNREADABLE)
    translateWith({ resume: { unreadable: { version: "{{found}}>{{expected}}" } } })

    fixture.detectChanges()

    expect(page().textContent).toContain("2>1")
  })

  it("names a damaged plan without any version", () => {
    mount(CORRUPTED)

    expect(page().textContent).toContain("resume.unreadable.corrupted")
    expect(page().textContent).not.toContain("resume.unreadable.version")
    expect(action("discard")).not.toBeNull()
  })

  it("shows nothing without an interrupted run", () => {
    mount(null)

    expect(page().textContent).not.toContain("resume.title")
  })
})
