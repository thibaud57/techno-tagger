import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"

import { closeGuardStub } from "../../../../fixtures/close-guard"
import { dialogLabel, page } from "../../../../fixtures/dialog"
import { action } from "../../../../fixtures/dom"
import { CloseGuard } from "../../../core/platform/close-guard.service"

import { CloseConfirmationComponent } from "./close-confirmation.component"

const mount = (blocked = false) => {
  const guard = closeGuardStub(["extraction", "write"], blocked)
  TestBed.configureTestingModule({
    imports: [CloseConfirmationComponent],
    providers: [provideTranslateService(), { provide: CloseGuard, useValue: guard }],
  })
  const fixture = TestBed.createComponent(CloseConfirmationComponent)
  fixture.detectChanges()

  return { fixture, component: fixture.componentInstance, guard }
}

describe("CloseConfirmationComponent", () => {
  it("names every pending work", () => {
    mount()

    const positions = ["extraction", "write"].map((kind) =>
      page().textContent.indexOf(`app.close.${kind}`),
    )
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it.each([
    { button: "stay", other: "leave" },
    { button: "leave", other: "stay" },
  ] as const)("only calls $button on the $button button, not $other", ({ button, other }) => {
    const { guard } = mount()

    action(button)?.click()

    expect(guard[button]).toHaveBeenCalledOnce()
    expect(guard[other]).not.toHaveBeenCalled()
  })

  it("stays when the dialog is dismissed", () => {
    const { component, guard } = mount()

    component["onVisibleChange"](false)

    expect(guard.stay).toHaveBeenCalledOnce()
    expect(guard.leave).not.toHaveBeenCalled()
  })

  it("offers only to stay while files are being written", () => {
    mount(true)

    expect(page().textContent).toContain("app.close.blockedTitle")
    expect(action("leave")).toBeNull()
    expect(action("stay")).not.toBeNull()
  })

  it("names the dialog by its title", () => {
    mount(true)

    expect(dialogLabel()?.textContent).toContain("app.close.blockedTitle")
  })

  it("puts the focus on the stay button", async () => {
    const { fixture } = mount()

    await fixture.whenStable()

    expect(document.activeElement).toBe(action("stay"))
  })
})
