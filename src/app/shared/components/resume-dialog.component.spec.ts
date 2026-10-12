import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { Router, provideRouter } from "@angular/router"
import { provideTranslateService } from "@ngx-translate/core"

import { action, page } from "../../../fixtures/dialog"
import { CORRUPTED, FOLDER_MISSING, INTERRUPTED, UNREADABLE } from "../../../fixtures/resume"
import type { DetectedRun } from "../../core/resume.store"
import { SidecarService } from "../../core/sidecar.service"

import { ResumeDialogComponent } from "./resume-dialog.component"

const mount = (run: DetectedRun | null) => {
  const sidecar = {
    interruptedRun: signal<DetectedRun | null>(run),
    resume: vi.fn(() => Promise.resolve(true)),
    discard: vi.fn(() => Promise.resolve()),
    dismissInterruptedRun: vi.fn(),
  }
  TestBed.configureTestingModule({
    imports: [ResumeDialogComponent],
    providers: [
      provideTranslateService(),
      provideRouter([]),
      { provide: SidecarService, useValue: sidecar },
    ],
  })
  const navigate = vi.spyOn(TestBed.inject(Router), "navigate").mockResolvedValue(true)
  const fixture = TestBed.createComponent(ResumeDialogComponent)
  fixture.detectChanges()

  return { fixture, component: fixture.componentInstance, sidecar, navigate }
}

describe("ResumeDialogComponent", () => {
  it("sums up the interrupted run", () => {
    const { component } = mount(INTERRUPTED)

    const text = page().textContent

    expect(text).toContain("resume.title")
    expect(text).toContain("resume.summary")
    expect(text).toContain(INTERRUPTED.folder)
    expect(component["summary"]()).toMatchObject({ processed: 62, total: 100 })
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

  it("offers to come back later when the folder is gone", () => {
    const { sidecar } = mount(FOLDER_MISSING)
    const resumable = action("resume")

    action("later")?.click()

    expect(resumable).toBeNull()
    expect(page().textContent).toContain("resume.folderMissing")
    expect(sidecar.dismissInterruptedRun).toHaveBeenCalledOnce()
  })

  it("only lets an unreadable plan be discarded, naming both versions", () => {
    mount(UNREADABLE)

    const offered = [action("resume"), action("later"), action("discard")].map(
      (button) => button !== null,
    )

    expect(offered).toEqual([false, false, true])
    expect(page().textContent).toContain("resume.unreadable.version")
  })

  it("names a damaged plan without any version", () => {
    mount(CORRUPTED)

    const text = page().textContent

    expect(text).toContain("resume.unreadable.corrupted")
    expect(text).not.toContain("resume.unreadable.version")
    expect(action("discard")).not.toBeNull()
  })

  it("shows nothing without an interrupted run", () => {
    mount(null)

    const opened = page().textContent.includes("resume.title")

    expect(opened).toBe(false)
  })
})
