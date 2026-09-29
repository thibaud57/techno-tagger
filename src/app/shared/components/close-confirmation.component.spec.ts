import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"

import { action, page } from "../../../fixtures/dialog"
import { CloseGuard, type PendingWork } from "../../core/close-guard.service"

import { CloseConfirmationComponent } from "./close-confirmation.component"

const mount = () => {
  const guard = {
    request: signal<readonly PendingWork[] | null>([
      { kind: "extraction" },
      { kind: "tagging" },
      { kind: "arbitration", count: 2 },
    ]),
    stay: vi.fn(),
    leave: vi.fn(() => Promise.resolve()),
  }
  TestBed.configureTestingModule({
    imports: [CloseConfirmationComponent],
    providers: [provideTranslateService(), { provide: CloseGuard, useValue: guard }],
  })
  const fixture = TestBed.createComponent(CloseConfirmationComponent)
  fixture.detectChanges()

  return { fixture, guard }
}

describe("CloseConfirmationComponent", () => {
  it("names every pending work", () => {
    mount()

    const text = page().textContent

    const positions = ["extraction", "tagging", "arbitration"].map((kind) =>
      text.indexOf(`app.close.${kind}`),
    )
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it("leaves the application only on the leave button", () => {
    const { guard } = mount()
    action("stay")?.click()
    const afterStay = guard.leave.mock.calls.length

    action("leave")?.click()

    expect(afterStay).toBe(0)
    expect(guard.stay).toHaveBeenCalledOnce()
    expect(guard.leave).toHaveBeenCalledOnce()
  })

  it("stays when the cross is used", () => {
    const { guard } = mount()

    page().querySelector<HTMLButtonElement>('[aria-label="app.close.stay"]')?.click()

    expect(guard.stay).toHaveBeenCalledOnce()
    expect(guard.leave).not.toHaveBeenCalled()
  })

  it("puts the focus on the stay button", async () => {
    const { fixture } = mount()

    await fixture.whenStable()

    expect(document.activeElement).toBe(action("stay"))
  })
})
