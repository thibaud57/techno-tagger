import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"
import { Router, provideRouter } from "@angular/router"
import { ConfirmationService } from "primeng/api"

import { PAST_RUN } from "../../../fixtures/past-runs"
import { type SidecarStubOverrides, sidecarStub } from "../../../fixtures/sidecar-stub"
import { translateWith } from "../../../fixtures/translate"
import { ROLLBACK_RUN, commandError, rollbackFinished } from "../../../fixtures/write"
import type { PastRun } from "../../core/sidecar/protocol"
import { SidecarService } from "../../core/sidecar/sidecar.service"
import type { RollbackInFlight } from "../../core/stores/write.store"

import SettingsPageComponent, { STORED_KEY_MASK } from "./settings-page.component"

/**
 * Ce qui se teste ici est la disponibilite de l'enregistrement et la commande
 * emise : la cle ne doit jamais rester dans l'ecran une fois envoyee.
 */
const mountWith = (overrides: SidecarStubOverrides = {}) => {
  const service = sidecarStub({ apiKeyConfigured: signal<boolean | null>(false), ...overrides })

  TestBed.configureTestingModule({
    imports: [SettingsPageComponent],
    providers: [
      provideTranslateService(),
      provideRouter([]),
      ConfirmationService,
      { provide: SidecarService, useValue: service },
    ],
  })

  const fixture = TestBed.createComponent(SettingsPageComponent)
  fixture.detectChanges()

  return { fixture, component: fixture.componentInstance, service }
}

describe("SettingsPageComponent", () => {
  it.each([
    { configured: true, placeholder: STORED_KEY_MASK },
    { configured: false, placeholder: "settings.api.key.placeholder" },
  ])("signals a stored key in the placeholder ($configured)", ({ configured, placeholder }) => {
    const { fixture } = mountWith({ apiKeyConfigured: signal(configured) })

    const input = (fixture.nativeElement as HTMLElement).querySelector("input#api-key")

    expect(input?.getAttribute("placeholder")).toBe(placeholder)
  })

  it("offers no visibility toggle while nothing is typed", () => {
    const { fixture } = mountWith({ apiKeyConfigured: signal(true) })

    const host = fixture.nativeElement as HTMLElement

    expect(host.querySelector('svg[data-p-icon="eye"]')).toBeNull()
  })

  it("shows a key storage error under the row", () => {
    const { fixture } = mountWith({
      lastError: signal(commandError("set_api_key", "api_key_not_stored")),
      lastErrorCommand: signal("set_api_key"),
    })

    const errorMessage = (fixture.nativeElement as HTMLElement).querySelector("app-error-message")

    expect(errorMessage).not.toBeNull()
  })

  it("ignores an error raised by another screen", () => {
    const { fixture } = mountWith({
      lastError: signal(commandError("list_playlists", "malformed_command")),
      lastErrorCommand: signal("list_playlists"),
    })

    const errorMessage = (fixture.nativeElement as HTMLElement).querySelector("app-error-message")

    expect(errorMessage).toBeNull()
  })

  it("switches the visibility icon when the key is unmasked", () => {
    const { fixture, component } = mountWith()
    component["entry"].set({ apiKey: "k3y-t0k3n" })

    component["toggleMask"]()
    fixture.detectChanges()

    const host = fixture.nativeElement as HTMLElement
    expect(host.querySelector('svg[data-p-icon="eye-slash"]')).not.toBeNull()
    expect(host.querySelector('svg[data-p-icon="eye"]')).toBeNull()
  })

  it("masks the field again once the key is sent", async () => {
    const { component } = mountWith()
    component["entry"].set({ apiKey: "k3y-t0k3n" })
    component["toggleMask"]()

    await component["save"]()

    expect(component["masked"]()).toBe(true)
  })

  it("disables saving while the field is empty", () => {
    const { component } = mountWith()

    const enabled = component["canSave"]()

    expect(enabled).toBe(false)
  })

  it("sends the key then clears the field", async () => {
    const { component, service } = mountWith()
    component["entry"].set({ apiKey: "k3y-t0k3n" })

    await component["save"]()

    expect(service.setApiKey).toHaveBeenCalledWith("k3y-t0k3n")
    expect(component["entry"]().apiKey).toBe("")
  })

  it("asks for the last undoable run and names it", () => {
    const { fixture, service } = mountWith({ rollbackTarget: signal(ROLLBACK_RUN) })
    translateWith({
      settings: { admin: { rollback: { target: "{{date}}|{{folder}}|{{count}}" } } },
    })
    fixture.detectChanges()

    const line = (fixture.nativeElement as HTMLElement).querySelector("[data-rollback-target]")

    expect(service.loadRollbackTarget).toHaveBeenCalled()
    expect(line?.textContent).toContain("|D:/Music/Promo Octobre|1")
    expect(line?.textContent).toContain("2026")
  })

  it("asks for the target once the engine answers, not at construction", () => {
    const available = signal<boolean | null>(null)
    const { fixture, service } = mountWith({ available })
    const before = vi.mocked(service.loadRollbackTarget).mock.calls.length

    available.set(true)
    fixture.detectChanges()

    expect(before).toBe(0)
    expect(service.loadRollbackTarget).toHaveBeenCalledTimes(1)
  })

  it("waits for the target before offering anything", () => {
    const { fixture, component } = mountWith()

    const line = (fixture.nativeElement as HTMLElement).querySelector("[data-rollback-target]")

    expect(line).toBeNull()
    expect(component["restoreBlockedReason"]()).toBe("settings.admin.rollback.loading")
  })

  it("leaves the reason to the button tooltip without a target", () => {
    const { fixture, component } = mountWith({ rollbackTarget: signal(null) })

    const line = (fixture.nativeElement as HTMLElement).querySelector("[data-rollback-target]")

    expect(line).toBeNull()
    expect(component["restoreBlockedReason"]()).toBe("settings.admin.rollback.none")
  })

  it("waits for the end of a run in progress before offering the undo", () => {
    const { component } = mountWith({ rollbackTarget: signal(ROLLBACK_RUN), tagging: signal(true) })

    expect(component["restoreBlockedReason"]()).toBe("tagging.blocked.running")
  })

  it("renders the raw date of a run whose date cannot be parsed", () => {
    const { fixture } = mountWith({
      rollbackTarget: signal({ ...ROLLBACK_RUN, written_at: "not-a-date" }),
    })
    translateWith({ settings: { admin: { rollback: { target: "{{date}}|{{folder}}" } } } })

    fixture.detectChanges()

    const line = (fixture.nativeElement as HTMLElement).querySelector("[data-rollback-target]")
    expect(line?.textContent).toContain("not-a-date|D:/Music/Promo Octobre")
  })

  it("gives a run in progress priority over a write in progress", () => {
    const { component } = mountWith({
      rollbackTarget: signal(ROLLBACK_RUN),
      tagging: signal(true),
      writing: signal(true),
    })

    expect(component["restoreBlockedReason"]()).toBe("tagging.blocked.running")
  })

  it.each([
    { name: "a write", overrides: { writing: signal(true) } },
    {
      name: "a restore",
      overrides: {
        rollingBack: signal<RollbackInFlight | null>({ runId: "a3f9c1", trackId: null }),
      },
    },
  ])("blocks the undo while $name is in progress", ({ overrides }) => {
    const { fixture, component } = mountWith({ rollbackTarget: signal(ROLLBACK_RUN), ...overrides })

    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-action="restore-last"]',
    )

    expect(component["restoreBlockedReason"]()).toBe("tagging.rollback.blocked")
    expect(button?.disabled).toBe(true)
  })

  it("undoes the last run after a confirmation that names it", () => {
    const { component, service } = mountWith({ rollbackTarget: signal(ROLLBACK_RUN) })
    translateWith({ settings: { admin: { rollback: { message: "{{folder}} {{count}}" } } } })
    const confirm = vi.spyOn(TestBed.inject(ConfirmationService), "confirm")

    component["restoreLast"]()
    const options = confirm.mock.calls[0]?.[0]
    options?.accept?.()

    expect(options?.message).toBe("D:/Music/Promo Octobre 1")
    expect(options?.acceptButtonProps).toMatchObject({ severity: "danger" })
    expect(service.rollback).toHaveBeenCalledWith("a3f9c1")
  })

  describe("past runs", () => {
    it("asks for the past runs once the engine is available", () => {
      const available = signal<boolean | null>(null)
      const { fixture, service } = mountWith({ available })
      const before = vi.mocked(service.listRuns).mock.calls.length

      available.set(true)
      fixture.detectChanges()

      expect(before).toBe(0)
      expect(service.listRuns).toHaveBeenCalledTimes(1)
    })

    it("lists the past runs as the engine ordered them, the latest first", () => {
      const pastRuns = signal<readonly PastRun[] | null>([
        { ...PAST_RUN, run_id: "b4c5d6", folder: "D:/Sets/Septembre" },
        PAST_RUN,
      ])
      const { component } = mountWith({ pastRuns })
      translateWith({ settings: { admin: { rollback: { target: "{{date}}|{{folder}}" } } } })

      const labels = component["pastRunOptions"]().map((option) => option.label)

      expect(labels.map((label) => label.split("|")[1])).toEqual([
        "D:/Sets/Septembre",
        "D:/Sets/Aout",
      ])
      expect(labels[0]).toContain("2026")
    })

    it("chooses the latest run first", () => {
      const pastRuns = signal<readonly PastRun[] | null>([
        { ...PAST_RUN, run_id: "b4c5d6" },
        PAST_RUN,
      ])
      const { component } = mountWith({ pastRuns })

      const chosen = component["pastChoice"]().runId

      expect(chosen).toBe("b4c5d6")
    })

    it("keeps the chosen run when the list is refreshed", () => {
      const pastRuns = signal<readonly PastRun[] | null>([
        PAST_RUN,
        { ...PAST_RUN, run_id: "b4c5d6" },
      ])
      const { component } = mountWith({ pastRuns })
      component["pastChoice"].set({ runId: "b4c5d6" })

      pastRuns.set([{ ...PAST_RUN, run_id: "c7d8e9" }, PAST_RUN, { ...PAST_RUN, run_id: "b4c5d6" }])

      expect(component["pastChoice"]().runId).toBe("b4c5d6")
    })

    it("falls back on the latest run when the chosen one is gone", () => {
      const pastRuns = signal<readonly PastRun[] | null>([
        PAST_RUN,
        { ...PAST_RUN, run_id: "b4c5d6" },
      ])
      const { component } = mountWith({ pastRuns })
      component["pastChoice"].set({ runId: "b4c5d6" })

      pastRuns.set([{ ...PAST_RUN, run_id: "c7d8e9" }, PAST_RUN])

      expect(component["pastChoice"]().runId).toBe("c7d8e9")
    })

    it("opens the summary of the chosen run", () => {
      const { fixture } = mountWith({ pastRuns: signal<readonly PastRun[] | null>([PAST_RUN]) })
      const navigate = vi.spyOn(TestBed.inject(Router), "navigateByUrl").mockResolvedValue(true)
      fixture.detectChanges()

      const host = fixture.nativeElement as HTMLElement
      host.querySelector<HTMLButtonElement>('[data-action="open-past-run"]')?.click()

      expect(navigate).toHaveBeenCalledWith("/tagging/recap/a3f9c1")
    })

    it("names the selector after the row label", () => {
      const { fixture } = mountWith({ pastRuns: signal<readonly PastRun[] | null>([PAST_RUN]) })

      const host = fixture.nativeElement as HTMLElement
      const named = host.querySelector('[data-field="past-run"] [aria-labelledby]')

      expect(named?.getAttribute("aria-labelledby")).toBe("past-run-label")
      expect(host.querySelector("#past-run-label")).not.toBeNull()
    })

    it("enables the row once a run is listed", () => {
      const { fixture, component } = mountWith({
        pastRuns: signal<readonly PastRun[] | null>([PAST_RUN]),
      })

      const host = fixture.nativeElement as HTMLElement
      const open = host.querySelector<HTMLButtonElement>('[data-action="open-past-run"]')

      expect(open?.disabled).toBe(false)
      expect(component["pastFields"].runId().disabled()).toBe(false)
    })

    it("disables the row without past runs", () => {
      const { fixture, component } = mountWith({
        pastRuns: signal<readonly PastRun[] | null>([]),
      })

      const host = fixture.nativeElement as HTMLElement
      const open = host.querySelector<HTMLButtonElement>('[data-action="open-past-run"]')

      expect(open?.disabled).toBe(true)
      expect(component["pastFields"].runId().disabled()).toBe(true)
    })
  })

  it("shows the files left as they were and the rollback error", () => {
    const { fixture } = mountWith({
      rollbackTarget: signal(null),
      rollbackFinished: signal(
        rollbackFinished(null, [
          { track_id: "a.mp3", file_name: "X - Y.mp3", reason: "name_taken" },
        ]),
      ),
      lastError: signal(commandError("rollback", "tag_dump_unreadable")),
      lastErrorCommand: signal("rollback"),
    })

    const root = fixture.nativeElement as HTMLElement

    expect(root.querySelector("[data-rollback-failures]")).not.toBeNull()
    expect(root.querySelector("app-error-message")).not.toBeNull()
  })
})
