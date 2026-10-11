import { computed, signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import {
  TranslateService,
  type TranslationObject,
  provideTranslateService,
} from "@ngx-translate/core"
import { ConfirmationService } from "primeng/api"

import type {
  RollbackFinishedEvent,
  RollbackRun,
  SidecarErrorEvent,
} from "../../core/models/protocol"
import { SidecarService } from "../../core/sidecar.service"
import type { RollbackInFlight } from "../../core/write.store"
import { ROLLBACK_RUN, rollbackFinished } from "../../../fixtures/write"

import SettingsPageComponent, { STORED_KEY_MASK } from "./settings-page.component"

/** Sous-ensemble reellement mocke : une divergence avec `SidecarService` casse ici, jamais en silence. */
type SidecarServiceStub = Pick<
  SidecarService,
  | "apiKeyConfigured"
  | "available"
  | "lastError"
  | "lastErrorCommand"
  | "errorFor"
  | "setApiKey"
  | "rollbackTarget"
  | "rollingBack"
  | "rollbackFinished"
  | "writing"
  | "filesBusy"
  | "tagging"
  | "loadRollbackTarget"
  | "rollback"
>

/**
 * Ce qui se teste ici est la disponibilite de l'enregistrement et la commande
 * emise : la cle ne doit jamais rester dans l'ecran une fois envoyee.
 * `filesBusy` suit `writing` et `rollingBack`, surcharges comprises.
 */
const mountWith = (overrides: Partial<Omit<SidecarServiceStub, "filesBusy">> = {}) => {
  const base = {
    apiKeyConfigured: signal<boolean | null>(false),
    available: signal(true),
    lastError: signal(null),
    lastErrorCommand: signal(null),
    errorFor: SidecarService.prototype.errorFor,
    setApiKey: vi.fn(() => Promise.resolve()),
    rollbackTarget: signal<RollbackRun | null | undefined>(undefined),
    rollingBack: signal<RollbackInFlight | null>(null),
    rollbackFinished: signal<RollbackFinishedEvent | null>(null),
    writing: signal(false),
    tagging: signal(false),
    loadRollbackTarget: vi.fn(() => Promise.resolve()),
    rollback: vi.fn(() => Promise.resolve()),
    ...overrides,
  }
  const service: SidecarServiceStub = {
    ...base,
    filesBusy: computed(() => base.writing() || base.rollingBack() !== null),
  }

  TestBed.configureTestingModule({
    imports: [SettingsPageComponent],
    providers: [
      provideTranslateService(),
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
      lastError: signal<SidecarErrorEvent>({
        event: "error",
        code: "api_key_not_stored",
        params: {},
        message: "",
        command: "set_api_key",
      }),
      lastErrorCommand: signal("set_api_key"),
    })

    const errorMessage = (fixture.nativeElement as HTMLElement).querySelector("app-error-message")

    expect(errorMessage).not.toBeNull()
  })

  it("ignores an error raised by another screen", () => {
    const { fixture } = mountWith({
      lastError: signal<SidecarErrorEvent>({
        event: "error",
        code: "malformed_command",
        params: {},
        message: "",
        command: "list_playlists",
      }),
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

  const translateWith = (admin: TranslationObject): void => {
    const translate = TestBed.inject(TranslateService)
    translate.setTranslation("en", { settings: { admin } })
    translate.use("en")
  }

  it("asks for the last undoable run and names it", () => {
    const { fixture, service } = mountWith({ rollbackTarget: signal(ROLLBACK_RUN) })
    translateWith({ rollback: { target: "{{date}}|{{folder}}|{{count}}" } })
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
    translateWith({ rollback: { target: "{{date}}|{{folder}}" } })

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
    translateWith({ rollback: { message: "{{folder}} {{count}}" } })
    const confirm = vi.spyOn(TestBed.inject(ConfirmationService), "confirm")

    component["restoreLast"]()
    const options = confirm.mock.calls[0]?.[0]
    options?.accept?.()

    expect(options?.message).toBe("D:/Music/Promo Octobre 1")
    expect(options?.acceptButtonProps).toMatchObject({ severity: "danger" })
    expect(service.rollback).toHaveBeenCalledWith("a3f9c1")
  })

  it("shows the files left as they were and the rollback error", () => {
    const { fixture } = mountWith({
      rollbackTarget: signal(null),
      rollbackFinished: signal({
        ...rollbackFinished(),
        failed: [{ track_id: "a.mp3", file_name: "X - Y.mp3", reason: "name_taken" }],
      }),
      lastError: signal<SidecarErrorEvent>({
        event: "error",
        code: "tag_dump_unreadable",
        params: {},
        message: "",
        command: "rollback",
      }),
      lastErrorCommand: signal("rollback"),
    })

    const root = fixture.nativeElement as HTMLElement

    expect(root.querySelector("[data-rollback-failures]")).not.toBeNull()
    expect(root.querySelector("app-error-message")).not.toBeNull()
  })
})
