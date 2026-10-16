import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { By } from "@angular/platform-browser"
import { TranslateService, provideTranslateService } from "@ngx-translate/core"
import { revealItemInDir } from "@tauri-apps/plugin-opener"
import { load } from "@tauri-apps/plugin-store"
import { Router, provideRouter } from "@angular/router"
import { ConfirmationService, MessageService } from "primeng/api"

import { hostOf } from "../../../fixtures/dom"
import { PAST_RUN } from "../../../fixtures/past-runs"
import {
  type SidecarStubOverrides,
  commandFailed,
  sidecarStub,
} from "../../../fixtures/sidecar-stub"
import { storeOf, storeStub } from "../../../fixtures/tauri-store"
import { translateWith } from "../../../fixtures/translate"
import { ROLLBACK_RUN, failedRollback } from "../../../fixtures/write"
import type { CacheClearedEvent, PastRun } from "../../core/sidecar/protocol"
import { SidecarService } from "../../core/sidecar/sidecar.service"
import type { RollbackInFlight } from "../../core/stores/write.store"

import SettingsPageComponent, {
  STORED_KEY_MASK,
  type SettingsSection,
} from "./settings-page.component"

/** Store indisponible par defaut, comme hors Tauri, sauf quand un test fournit le sien. */
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(() => Promise.reject(new TypeError("store unavailable"))),
}))

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn(() => Promise.resolve()),
}))

const mountWith = (overrides: SidecarStubOverrides = {}, section: SettingsSection = "api") => {
  const service = sidecarStub({ apiKeyConfigured: signal<boolean | null>(false), ...overrides })

  TestBed.configureTestingModule({
    imports: [SettingsPageComponent],
    providers: [
      provideTranslateService(),
      provideRouter([]),
      ConfirmationService,
      MessageService,
      { provide: SidecarService, useValue: service },
    ],
  })

  const fixture = TestBed.createComponent(SettingsPageComponent)
  fixture.componentInstance["section"].set(section)
  fixture.detectChanges()

  return { fixture, component: fixture.componentInstance, service }
}

/** Ouvre une section comme le menu : par la commande de son entree. */
const openSection = (component: SettingsPageComponent, section: SettingsSection): void => {
  component["menuItems"]()
    .find((item) => item.id === `settings-section-${section}`)
    ?.command?.({})
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
    const { fixture, service } = mountWith({ rollbackTarget: signal(ROLLBACK_RUN) }, "admin")
    translateWith({
      settings: { admin: { rollback: { target: "{{date}}|{{folder}}|{{count}}" } } },
    })
    fixture.detectChanges()

    const line = hostOf(fixture).querySelector("[data-rollback-target]")

    expect(service.loadRollbackTarget).toHaveBeenCalled()
    expect(line?.textContent).toContain("|D:/Music/Promo Octobre|1")
    expect(line?.textContent).toContain("2026")
  })

  it.each(["loadRollbackTarget", "listRuns", "loadCacheSize"] as const)(
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
    const { fixture, component } = mountWith(overrides, "admin")

    const line = hostOf(fixture).querySelector("[data-rollback-target]")

    expect(line).toBeNull()
    expect(component["restoreBlockedReason"]()).toBe(reason)
  })

  it("renders the raw date of a run whose date cannot be parsed", () => {
    const { fixture } = mountWith(
      { rollbackTarget: signal({ ...ROLLBACK_RUN, written_at: "not-a-date" }) },
      "admin",
    )
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
    const { fixture, component } = mountWith(
      { rollbackTarget: signal(ROLLBACK_RUN), ...overrides },
      "admin",
    )

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

  it("shows the API section first", () => {
    const { fixture } = mountWith()

    const host = hostOf(fixture)

    expect(host.querySelector("input#api-key")).not.toBeNull()
    expect(host.querySelector('[data-action="restore-last"]')).toBeNull()
  })

  it("shows only the section chosen in the menu", () => {
    const { fixture, component } = mountWith({ rollbackTarget: signal(ROLLBACK_RUN) })

    openSection(component, "admin")
    fixture.detectChanges()

    const host = hostOf(fixture)
    expect(host.querySelector('[data-action="restore-last"]')).not.toBeNull()
    expect(host.querySelector("input#api-key")).toBeNull()
  })

  it("marks the active menu entry on its content, which hover and focus would cover", () => {
    const { fixture, component } = mountWith({ rollbackTarget: signal(ROLLBACK_RUN) })

    openSection(component, "admin")
    fixture.detectChanges()

    const marked = Array.from(hostOf(fixture).querySelectorAll(".bg-highlight"))
    const current = Array.from(hostOf(fixture).querySelectorAll('[aria-current="page"]'))
    expect(marked.map((content) => content.textContent.trim())).toEqual(["settings.admin.title"])
    expect(current.map((link) => link.textContent.trim())).toEqual(["settings.admin.title"])
  })

  it("drops an unsaved key once its section is left", () => {
    const { fixture, component } = mountWith()
    component["entry"].set({ apiKey: "typed-but-not-saved" })

    openSection(component, "admin")
    openSection(component, "api")
    fixture.detectChanges()

    expect(component["entry"]().apiKey).toBe("")
  })

  it("shows a key storage error again once its section is reopened", () => {
    const { fixture, component } = mountWith(commandFailed("set_api_key", "api_key_not_stored"))
    openSection(component, "admin")
    fixture.detectChanges()

    openSection(component, "api")
    fixture.detectChanges()

    expect(hostOf(fixture).querySelector("app-error-message")).not.toBeNull()
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
      const { fixture } = mountWith(
        { pastRuns: signal<readonly PastRun[] | null>([PAST_RUN]) },
        "admin",
      )
      const navigate = vi.spyOn(TestBed.inject(Router), "navigateByUrl").mockResolvedValue(true)
      fixture.detectChanges()

      hostOf(fixture).querySelector<HTMLButtonElement>('[data-action="open-past-run"]')?.click()

      expect(navigate).toHaveBeenCalledWith("/tagging/recap/a3f9c1")
    })

    it("names the selector after the row label", () => {
      const { fixture } = mountWith(
        { pastRuns: signal<readonly PastRun[] | null>([PAST_RUN]) },
        "admin",
      )

      const host = hostOf(fixture)
      const named = host.querySelector('[data-field="past-run"] [aria-labelledby]')

      expect(named?.getAttribute("aria-labelledby")).toBe("past-run-label")
      expect(host.querySelector("#past-run-label")).not.toBeNull()
    })

    it.each([
      { case: "enables the row once a run is listed", runs: [PAST_RUN], disabled: false },
      { case: "disables the row without past runs", runs: [], disabled: true },
    ])("$case", ({ runs, disabled }) => {
      const { fixture, component } = mountWith(
        { pastRuns: signal<readonly PastRun[] | null>(runs) },
        "admin",
      )

      const open = hostOf(fixture).querySelector<HTMLButtonElement>('[data-action="open-past-run"]')

      expect(open?.disabled).toBe(disabled)
      expect(component["pastFields"].runId().disabled()).toBe(disabled)
    })
  })

  it("shows the files left as they were and the rollback error", () => {
    const { fixture } = mountWith(
      {
        rollbackTarget: signal(null),
        rollbackFinished: signal(failedRollback("name_taken")),
        ...commandFailed("rollback", "tag_dump_unreadable"),
      },
      "admin",
    )

    const root = hostOf(fixture)

    expect(root.querySelector("[data-rollback-failures]")).not.toBeNull()
    expect(root.querySelector("app-error-message")).not.toBeNull()
  })

  describe("interface", () => {
    // `clearMocks` garde les implementations : sans cela, le store d'un test fuit dans les suivants.
    beforeEach(() => {
      vi.mocked(load).mockRejectedValue(new TypeError("store unavailable"))
    })

    it("switches the language and stores the choice when the select changes", async () => {
      const store = storeStub()
      vi.mocked(load).mockResolvedValue(store)
      const { fixture } = mountWith({}, "interface")
      const select = fixture.debugElement.query(By.css('[data-field="language"]'))

      select.triggerEventHandler("onChange", { value: "en" })

      expect(TestBed.inject(TranslateService).getCurrentLang()).toBe("en")
      await vi.waitFor(() => {
        expect(store.set).toHaveBeenCalledWith("language", "en")
      })
    })

    it("switches the language even when the store is unavailable", () => {
      const { component } = mountWith({}, "interface")

      component["chooseLanguage"]("en")

      expect(TestBed.inject(TranslateService).getCurrentLang()).toBe("en")
    })

    it("stores nothing when the page opens", async () => {
      const store = storeStub(true)
      vi.mocked(load).mockResolvedValue(store)

      mountWith({}, "interface")

      // Le montage a bien lu le store : l'absence d'ecriture n'est pas une lecture manquee.
      await vi.waitFor(() => {
        expect(store.get).toHaveBeenCalled()
      })
      expect(store.set).not.toHaveBeenCalled()
    })

    it("translates the menu again once the language changes", () => {
      const { component } = mountWith()
      const translate = TestBed.inject(TranslateService)
      translate.setTranslation("fr", { settings: { admin: { title: "Administration" } } })
      translate.setTranslation("en", { settings: { admin: { title: "Admin" } } })
      translate.use("fr")

      component["chooseLanguage"]("en")

      const admin = component["menuItems"]().find((item) => item.id === "settings-section-admin")
      expect(admin?.label).toBe("Admin")
    })

    it("stores a muted completion sound when the toggle changes", async () => {
      const store = storeStub(true)
      vi.mocked(load).mockResolvedValue(store)
      const { fixture } = mountWith({}, "interface")
      const toggle = fixture.debugElement.query(By.css('[data-field="sound"]'))

      toggle.triggerEventHandler("onChange", { checked: false })

      await vi.waitFor(() => {
        expect(store.set).toHaveBeenCalledWith("sound_signal", false)
      })
    })

    it("keeps a sound choice made before the stored one is read", async () => {
      const store = storeStub(true)
      vi.mocked(load).mockResolvedValue(store)
      const { fixture, component } = mountWith({}, "interface")
      const toggle = hostOf(fixture).querySelector<HTMLInputElement>('[data-field="sound"] input')

      toggle?.click()

      await vi.waitFor(() => {
        expect(store.get).toHaveBeenCalled()
        expect(store.set).toHaveBeenCalledWith("sound_signal", false)
      })
      expect(component["soundChoice"]().enabled).toBe(false)
    })

    it("shows the completion sound as stored", async () => {
      vi.mocked(load).mockResolvedValue(storeStub(false))

      const { component } = mountWith({}, "interface")

      // La lecture est une promesse que `whenStable` ne suit pas.
      await vi.waitFor(() => {
        expect(component["soundChoice"]().enabled).toBe(false)
      })
    })
  })

  describe("matching", () => {
    // `clearMocks` garde les implementations : sans cela, le store d'un test fuit dans les suivants.
    beforeEach(() => {
      vi.mocked(load).mockRejectedValue(new TypeError("store unavailable"))
    })

    /** Defauts fictifs du moteur, distincts des vrais : rien ici ne doit les recopier. */
    const DEFAULTS = { floor: 65, ceiling: 85 }
    const CUSTOM = { floor: 72, ceiling: 95 }

    const mountMatching = (entries: Record<string, unknown> = {}) => {
      const store = storeOf(entries)
      vi.mocked(load).mockResolvedValue(store)

      return { store, ...mountWith({ defaultThresholds: signal(DEFAULTS) }, "matching") }
    }

    it("shows the engine defaults without a setting", async () => {
      const { component } = mountMatching()

      await vi.waitFor(() => {
        expect(component["storedThresholds"]()).toBeNull()
      })
      expect(component["thresholdsChoice"]()).toEqual(DEFAULTS)
      expect(component["thresholdsCustomized"]()).toBe(false)
    })

    it("prefers the stored setting over the engine defaults", async () => {
      const { component } = mountMatching({ thresholds: CUSTOM })

      await vi.waitFor(() => {
        expect(component["thresholdsChoice"]()).toEqual(CUSTOM)
      })
      expect(component["thresholdsCustomized"]()).toBe(true)
    })

    it("disables the thresholds until the engine answers", async () => {
      const store = storeOf({})
      vi.mocked(load).mockResolvedValue(store)
      const { component } = mountWith({ defaultThresholds: signal(null) }, "matching")
      await vi.waitFor(() => {
        expect(component["storedThresholds"]()).toBeNull()
      })

      const disabled = component["thresholdsFields"].floor().disabled()

      expect(disabled).toBe(true)
    })

    it("disables the thresholds until the setting is read", () => {
      vi.mocked(load).mockReturnValue(new Promise(() => undefined))
      const { component } = mountWith({ defaultThresholds: signal(DEFAULTS) }, "matching")

      const disabled = component["thresholdsFields"].floor().disabled()

      expect(disabled).toBe(true)
    })

    it("enables the thresholds once the setting is read", async () => {
      const { component } = mountMatching()
      await vi.waitFor(() => {
        expect(component["storedThresholds"]()).toBeNull()
      })

      const disabled = component["thresholdsFields"].floor().disabled()

      expect(disabled).toBe(false)
    })

    it("stores thresholds that differ from the defaults", async () => {
      const { component, store } = mountMatching()
      component["thresholdsChoice"].set({ floor: 65, ceiling: 95 })

      component["storeThresholds"]()

      await vi.waitFor(() => {
        expect(store.set).toHaveBeenCalledWith("thresholds", { floor: 65, ceiling: 95 })
      })
    })

    it.each([
      { case: "the engine defaults without a setting", stored: {}, shown: DEFAULTS },
      { case: "the stored setting", stored: { thresholds: CUSTOM }, shown: CUSTOM },
    ])("ignores a cleared field and shows $case again", async ({ stored, shown }) => {
      const { component, store } = mountMatching(stored)
      await vi.waitFor(() => {
        expect(component["storedThresholds"]()).not.toBeUndefined()
        expect(component["thresholdsChoice"]()).toEqual(shown)
      })
      component["thresholdsChoice"].set({ floor: null as unknown as number, ceiling: 99 })

      component["storeThresholds"]()

      await new Promise((resolve) => setTimeout(resolve))
      expect(store.set).not.toHaveBeenCalled()
      expect(component["thresholdsChoice"]()).toEqual(shown)
    })

    it("writes nothing when the thresholds did not change", async () => {
      const { component, store } = mountMatching({ thresholds: CUSTOM })
      await vi.waitFor(() => {
        expect(component["thresholdsCustomized"]()).toBe(true)
      })

      component["storeThresholds"]()

      await new Promise((resolve) => setTimeout(resolve))
      expect(store.set).not.toHaveBeenCalled()
    })

    it("stores no setting for thresholds equal to the defaults", async () => {
      const { component, store } = mountMatching({ thresholds: CUSTOM })
      await vi.waitFor(() => {
        expect(component["thresholdsCustomized"]()).toBe(true)
      })
      component["thresholdsChoice"].set({ ...DEFAULTS })

      component["storeThresholds"]()

      await vi.waitFor(() => {
        expect(store.set).toHaveBeenCalledWith("thresholds", null)
      })
      expect(component["thresholdsCustomized"]()).toBe(false)
    })

    it("resets the thresholds to the engine defaults", async () => {
      const { component, store } = mountMatching({ thresholds: CUSTOM })
      await vi.waitFor(() => {
        expect(component["thresholdsCustomized"]()).toBe(true)
      })

      component["resetThresholds"]()

      expect(component["thresholdsChoice"]()).toEqual(DEFAULTS)
      await vi.waitFor(() => {
        expect(store.set).toHaveBeenCalledWith("thresholds", null)
      })
    })

    it("never lets the floor pass the high threshold", () => {
      const { component } = mountMatching()

      component["thresholdsChoice"].set({ floor: 60, ceiling: 80 })

      expect(component["floorMax"]()).toBe(80)
      expect(component["ceilingMin"]()).toBe(60)
    })

    it.each([
      { case: "the floor", moved: { floor: 95, ceiling: 80 }, kept: { floor: 80, ceiling: 80 } },
      {
        case: "the high threshold",
        moved: { floor: 60, ceiling: 40 },
        kept: { floor: 60, ceiling: 60 },
      },
    ])("stops $case against the other threshold", ({ moved, kept }) => {
      const { component } = mountMatching()
      component["thresholdsChoice"].set({ floor: 60, ceiling: 80 })

      component["thresholdsChoice"].set(moved)

      expect(component["thresholdsChoice"]()).toEqual(kept)
    })

    it("brings the controls of a threshold dragged past the other one back to the bound", () => {
      const { component } = mountMatching()
      component["thresholdsChoice"].set({ floor: 60, ceiling: 80 })
      const floor = component["thresholdsFields"].floor
      floor().controlValue.set(95)

      component["holdAtBound"](floor)

      expect(floor().controlValue()).toBe(80)
      expect(component["thresholdsChoice"]()).toEqual({ floor: 80, ceiling: 80 })
    })
  })

  describe("cache", () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    const CLEARED: CacheClearedEvent = {
      event: "cache_cleared",
      freed_bytes: 418_000_000,
      size_bytes: 0,
    }

    const withClearedTranslations = (): void => {
      translateWith({
        settings: {
          admin: {
            cache: {
              cleared: { summary: "Cleared", freed: "{{size}} freed", left: "{{size}} left" },
            },
          },
        },
      })
    }

    it("shows the cache size in the interface language", () => {
      const { fixture } = mountWith({ cacheSize: signal<number | null>(418_000_000) }, "admin")

      const size = hostOf(fixture).querySelector("[data-cache-size]")

      expect(size?.textContent.trim()).toBe("418 MB")
    })

    it("sends the clearing", () => {
      const { fixture, service } = mountWith({}, "admin")

      hostOf(fixture).querySelector<HTMLButtonElement>('[data-action="clear-cache"]')?.click()

      expect(service.clearCache).toHaveBeenCalled()
    })

    it("announces the freed bytes of a new clearing", () => {
      const cacheCleared = signal<CacheClearedEvent | null>(null)
      const add = vi.spyOn(MessageService.prototype, "add")
      const { fixture } = mountWith({ cacheCleared }, "admin")
      withClearedTranslations()

      cacheCleared.set(CLEARED)
      fixture.detectChanges()

      expect(add).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: "success",
          summary: "Cleared",
          detail: "418 MB freed",
        }),
      )
    })

    it("announces what is left after a partial clearing", () => {
      const cacheCleared = signal<CacheClearedEvent | null>(null)
      const add = vi.spyOn(MessageService.prototype, "add")
      const { fixture } = mountWith({ cacheCleared }, "admin")
      withClearedTranslations()

      cacheCleared.set({ ...CLEARED, size_bytes: 12_000_000 })
      fixture.detectChanges()

      expect(add).toHaveBeenCalledWith(
        expect.objectContaining({ detail: "418 MB freed\n12 MB left" }),
      )
    })

    it("announces nothing for a clearing already known when the page opens", () => {
      const add = vi.spyOn(MessageService.prototype, "add")

      const { fixture } = mountWith(
        { cacheCleared: signal<CacheClearedEvent | null>(CLEARED) },
        "admin",
      )
      fixture.detectChanges()

      expect(add).not.toHaveBeenCalled()
    })

    it.each([
      [
        "an engine still starting",
        { available: signal<boolean | null>(null) },
        "settings.admin.starting",
      ],
      ["a long phase", { tagging: signal(true) }, "settings.admin.cache.blocked.busy"],
      [
        "a run awaiting its write",
        { runAwaitsWrite: signal(true) },
        "settings.admin.cache.blocked.unwritten",
      ],
      ["no run awaiting its write", {}, null],
    ])("blocks the clearing according to %s", (_case, overrides, reason) => {
      const { fixture, component } = mountWith(overrides, "admin")

      const button = hostOf(fixture).querySelector<HTMLButtonElement>('[data-action="clear-cache"]')

      expect(component["cacheBlockedReason"]()).toBe(reason)
      expect(button?.disabled).toBe(reason !== null)
    })

    it("shows a clearing in flight on its button", () => {
      const { fixture } = mountWith({ cacheClearing: signal(true) }, "admin")

      const button = hostOf(fixture).querySelector<HTMLButtonElement>('[data-action="clear-cache"]')

      expect(button?.disabled).toBe(true)
      expect(button?.querySelector('[data-p-icon="spinner"]')).not.toBeNull()
    })

    it("shows a refused clearing under the cache row", () => {
      const { fixture } = mountWith(commandFailed("clear_cache", "run_not_written"), "admin")

      const error = hostOf(fixture).querySelector("[data-cache-error]")

      expect(error).not.toBeNull()
    })
  })

  describe("logs", () => {
    const LOG_FILE = "C:/data/trace.log"

    it("reveals the log file named by the engine", async () => {
      const { component } = mountWith({ logFile: signal<string | null>(LOG_FILE) }, "admin")

      await component["revealLogs"]()

      expect(revealItemInDir).toHaveBeenCalledWith(LOG_FILE)
    })

    it.each([
      ["is not named yet", null, "settings.admin.starting"],
      ["is named", LOG_FILE, null],
    ])("blocks the logs button while the log file %s", (_case, file, reason) => {
      const { fixture, component } = mountWith({ logFile: signal<string | null>(file) }, "admin")

      const button = hostOf(fixture).querySelector<HTMLButtonElement>('[data-action="reveal-logs"]')

      expect(component["logsBlockedReason"]()).toBe(reason)
      expect(button?.disabled).toBe(reason !== null)
    })

    it("forgets a failed reveal once a relaunched engine names its log file", async () => {
      vi.mocked(revealItemInDir).mockRejectedValueOnce(new Error("path not found"))
      const logFile = signal<string | null>(LOG_FILE)
      const { fixture, component } = mountWith({ logFile }, "admin")
      await component["revealLogs"]()

      logFile.set("C:/data/relaunched.log")
      fixture.detectChanges()

      expect(hostOf(fixture).querySelector("[data-logs-error]")).toBeNull()
    })

    it("tells to restart when the log file cannot be revealed", async () => {
      vi.mocked(revealItemInDir).mockRejectedValueOnce(new Error("path not found"))
      const { fixture, component } = mountWith(
        { logFile: signal<string | null>(LOG_FILE) },
        "admin",
      )

      await component["revealLogs"]()
      fixture.detectChanges()

      expect(hostOf(fixture).querySelector("[data-logs-error]")).not.toBeNull()
    })
  })
})
