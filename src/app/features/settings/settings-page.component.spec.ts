import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { provideTranslateService } from "@ngx-translate/core"
import { Router, provideRouter } from "@angular/router"
import { ConfirmationService } from "primeng/api"

import { hostOf } from "../../../fixtures/dom"
import { PAST_RUN } from "../../../fixtures/past-runs"
import {
  type SidecarStubOverrides,
  commandFailed,
  sidecarStub,
} from "../../../fixtures/sidecar-stub"
import { translateWith } from "../../../fixtures/translate"
import { ROLLBACK_RUN, failedRollback } from "../../../fixtures/write"
import type { PastRun } from "../../core/sidecar/protocol"
import { SidecarService } from "../../core/sidecar/sidecar.service"
import type { RollbackInFlight } from "../../core/stores/write.store"

import SettingsPageComponent, { STORED_KEY_MASK } from "./settings-page.component"

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

    const input = hostOf(fixture).querySelector("input#api-key")

    expect(input?.getAttribute("placeholder")).toBe(placeholder)
  })

  it("offers no visibility toggle while nothing is typed", () => {
    const { fixture } = mountWith({ apiKeyConfigured: signal(true) })

    expect(hostOf(fixture).querySelector('svg[data-p-icon="eye"]')).toBeNull()
  })

  it("shows a key storage error under the row", () => {
    const { fixture } = mountWith(commandFailed("set_api_key", "api_key_not_stored"))

    const errorMessage = hostOf(fixture).querySelector("app-error-message")

    expect(errorMessage).not.toBeNull()
  })

  it("ignores an error raised by another screen", () => {
    const { fixture } = mountWith(commandFailed("list_playlists", "malformed_command"))

    const errorMessage = hostOf(fixture).querySelector("app-error-message")

    expect(errorMessage).toBeNull()
  })

  it("switches the visibility icon when the key is unmasked", () => {
    const { fixture, component } = mountWith()
    component["entry"].set({ apiKey: "k3y-t0k3n" })

    component["toggleMask"]()
    fixture.detectChanges()

    const host = hostOf(fixture)
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

    const line = hostOf(fixture).querySelector("[data-rollback-target]")

    expect(service.loadRollbackTarget).toHaveBeenCalled()
    expect(line?.textContent).toContain("|D:/Music/Promo Octobre|1")
    expect(line?.textContent).toContain("2026")
  })

  it.each(["loadRollbackTarget", "listRuns"] as const)(
    "calls %s once the engine answers, not at construction",
    (method) => {
      const available = signal<boolean | null>(null)
      const { fixture, service } = mountWith({ available })
      const before = service[method].mock.calls.length

      available.set(true)
      fixture.detectChanges()

      expect(before).toBe(0)
      expect(service[method]).toHaveBeenCalledTimes(1)
    },
  )

  it.each([
    ["waits for the target before offering anything", {}, "settings.admin.rollback.loading"],
    [
      "leaves the reason to the button tooltip without a target",
      { rollbackTarget: signal(null) },
      "settings.admin.rollback.none",
    ],
  ])("%s", (_case, overrides, reason) => {
    const { fixture, component } = mountWith(overrides)

    const line = hostOf(fixture).querySelector("[data-rollback-target]")

    expect(line).toBeNull()
    expect(component["restoreBlockedReason"]()).toBe(reason)
  })

  it("renders the raw date of a run whose date cannot be parsed", () => {
    const { fixture } = mountWith({
      rollbackTarget: signal({ ...ROLLBACK_RUN, written_at: "not-a-date" }),
    })
    translateWith({ settings: { admin: { rollback: { target: "{{date}}|{{folder}}" } } } })

    fixture.detectChanges()

    const line = hostOf(fixture).querySelector("[data-rollback-target]")
    expect(line?.textContent).toContain("not-a-date|D:/Music/Promo Octobre")
  })

  it.each([
    ["alone", {}],
    ["ahead of a write in progress", { writing: signal(true) }],
  ])("blocks the undo with the run in progress %s", (_case, overrides) => {
    const { component } = mountWith({
      rollbackTarget: signal(ROLLBACK_RUN),
      tagging: signal(true),
      ...overrides,
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

    const button = hostOf(fixture).querySelector<HTMLButtonElement>('[data-action="restore-last"]')

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

    it.each([
      [
        "keeps the chosen run when the list is refreshed",
        [{ ...PAST_RUN, run_id: "c7d8e9" }, PAST_RUN, { ...PAST_RUN, run_id: "b4c5d6" }],
        "b4c5d6",
      ],
      [
        "falls back on the latest run when the chosen one is gone",
        [{ ...PAST_RUN, run_id: "c7d8e9" }, PAST_RUN],
        "c7d8e9",
      ],
    ])("%s", (_case, refreshed, expected) => {
      const pastRuns = signal<readonly PastRun[] | null>([
        PAST_RUN,
        { ...PAST_RUN, run_id: "b4c5d6" },
      ])
      const { component } = mountWith({ pastRuns })
      component["pastChoice"].set({ runId: "b4c5d6" })

      pastRuns.set(refreshed)

      expect(component["pastChoice"]().runId).toBe(expected)
    })

    it("opens the summary of the chosen run", () => {
      const { fixture } = mountWith({ pastRuns: signal<readonly PastRun[] | null>([PAST_RUN]) })
      const navigate = vi.spyOn(TestBed.inject(Router), "navigateByUrl").mockResolvedValue(true)
      fixture.detectChanges()

      hostOf(fixture).querySelector<HTMLButtonElement>('[data-action="open-past-run"]')?.click()

      expect(navigate).toHaveBeenCalledWith("/tagging/recap/a3f9c1")
    })

    it("names the selector after the row label", () => {
      const { fixture } = mountWith({ pastRuns: signal<readonly PastRun[] | null>([PAST_RUN]) })

      const host = hostOf(fixture)
      const named = host.querySelector('[data-field="past-run"] [aria-labelledby]')

      expect(named?.getAttribute("aria-labelledby")).toBe("past-run-label")
      expect(host.querySelector("#past-run-label")).not.toBeNull()
    })

    it.each([
      { case: "enables the row once a run is listed", runs: [PAST_RUN], disabled: false },
      { case: "disables the row without past runs", runs: [], disabled: true },
    ])("$case", ({ runs, disabled }) => {
      const { fixture, component } = mountWith({
        pastRuns: signal<readonly PastRun[] | null>(runs),
      })

      const open = hostOf(fixture).querySelector<HTMLButtonElement>('[data-action="open-past-run"]')

      expect(open?.disabled).toBe(disabled)
      expect(component["pastFields"].runId().disabled()).toBe(disabled)
    })
  })

  it("shows the files left as they were and the rollback error", () => {
    const { fixture } = mountWith({
      rollbackTarget: signal(null),
      rollbackFinished: signal(failedRollback("name_taken")),
      ...commandFailed("rollback", "tag_dump_unreadable"),
    })

    const root = hostOf(fixture)

    expect(root.querySelector("[data-rollback-failures]")).not.toBeNull()
    expect(root.querySelector("app-error-message")).not.toBeNull()
  })
})
