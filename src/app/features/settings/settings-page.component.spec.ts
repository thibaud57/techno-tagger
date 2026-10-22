import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { provideRouter } from "@angular/router"
import { TranslateService, provideTranslateService } from "@ngx-translate/core"
import { ConfirmationService, MessageService } from "primeng/api"
import { vi } from "vitest"

import { spyConfirmation } from "../../../fixtures/confirm"
import { action, errorMessageOf, hostOf, iconOf } from "../../../fixtures/dom"
import { type NativeStub, nativeStub } from "../../../fixtures/native-stub"
import { OTHER_PAST_RUN, PAST_RUN } from "../../../fixtures/past-runs"
import { type PreferencesStub, preferencesStub } from "../../../fixtures/preferences-stub"
import { stubNavigation } from "../../../fixtures/router"
import { CUSTOM_THRESHOLDS, DEFAULT_THRESHOLDS, LOG_FILE } from "../../../fixtures/settings"
import {
  type SidecarStubOverrides,
  commandFailed,
  provideSidecarStub,
  sidecarStub,
} from "../../../fixtures/sidecar-stub"
import { RUN_ID } from "../../../fixtures/tagging"
import { spyToast } from "../../../fixtures/toast"
import { translateWith } from "../../../fixtures/translate"
import { availableUpdate, updaterStub } from "../../../fixtures/updater"
import { ROLLBACK_RUN, failedRollback } from "../../../fixtures/write"
import { NativeService } from "../../core/platform/native.service"
import { PreferencesService } from "../../core/platform/preferences.service"
import { UpdateService } from "../../core/platform/update.service"
import { APP_UPDATER } from "../../core/platform/updater"
import type { CacheClearedEvent, PastRun } from "../../core/sidecar/protocol"
import type { RollbackInFlight } from "../../core/stores/write.store"

import SettingsPageComponent, {
  STORED_KEY_MASK,
  type SettingsSection,
} from "./settings-page.component"

interface Natives {
  native?: NativeStub
  preferences?: PreferencesStub
  updater?: ReturnType<typeof updaterStub>
}

const mountWith = (
  overrides: SidecarStubOverrides = {},
  section: SettingsSection = "api",
  { native = nativeStub(), preferences = preferencesStub(), updater = updaterStub() }: Natives = {},
) => {
  const service = sidecarStub({ apiKeyConfigured: signal<boolean | null>(false), ...overrides })

  TestBed.configureTestingModule({
    imports: [SettingsPageComponent],
    providers: [
      provideTranslateService(),
      provideRouter([]),
      ConfirmationService,
      MessageService,
      provideSidecarStub(service),
      { provide: NativeService, useValue: native },
      { provide: PreferencesService, useValue: preferences },
      { provide: APP_UPDATER, useValue: updater },
    ],
  })

  const fixture = TestBed.createComponent(SettingsPageComponent)
  fixture.componentInstance["section"].set(section)
  fixture.detectChanges()

  return { fixture, component: fixture.componentInstance, service, native, preferences }
}

/** Ouvre une section comme le menu : par la commande de son entree. */
const openSection = (component: SettingsPageComponent, section: SettingsSection): void => {
  component["menuItems"]()
    .find((item) => item.id === `settings-section-${section}`)
    ?.command?.({})
}

describe("SettingsPageComponent", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    { case: "a stored key", configured: true, placeholder: STORED_KEY_MASK },
    { case: "no stored key", configured: false, placeholder: "settings.api.key.placeholder" },
  ])("signals $case in the placeholder", ({ configured, placeholder }) => {
    const { fixture } = mountWith({ apiKeyConfigured: signal(configured) })

    expect(hostOf(fixture).querySelector("input#api-key")?.getAttribute("placeholder")).toBe(
      placeholder,
    )
  })

  it("offers no visibility toggle while nothing is typed", () => {
    const { fixture } = mountWith({ apiKeyConfigured: signal(true) })

    expect(iconOf(hostOf(fixture), "eye")).toBeNull()
  })

  it("shows a key storage error under the row", () => {
    const { fixture } = mountWith(commandFailed("set_api_key", "api_key_not_stored"))

    expect(errorMessageOf(hostOf(fixture))).not.toBeNull()
  })

  it("ignores an error raised by another screen", () => {
    const { fixture } = mountWith(commandFailed("list_playlists", "malformed_command"))

    expect(errorMessageOf(hostOf(fixture))).toBeNull()
  })

  it("switches the visibility icon when the key is unmasked", () => {
    const { fixture, component } = mountWith()
    component["entry"].set({ apiKey: "k3y-t0k3n" })

    component["toggleMask"]()
    fixture.detectChanges()

    expect(iconOf(hostOf(fixture), "eye-slash")).not.toBeNull()
    expect(iconOf(hostOf(fixture), "eye")).toBeNull()
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

    expect(component["canSave"]()).toBe(false)
  })

  it("sends the key then clears the field", async () => {
    const { component, service } = mountWith()
    component["entry"].set({ apiKey: "k3y-t0k3n" })

    await component["save"]()

    expect(service.setApiKey).toHaveBeenCalledWith("k3y-t0k3n")
    expect(component["entry"]().apiKey).toBe("")
  })

  it("asks for the last undoable run", () => {
    const { service } = mountWith({ rollbackTarget: signal(ROLLBACK_RUN) }, "admin")

    expect(service.loadRollbackTarget).toHaveBeenCalled()
  })

  it("names the last undoable run", () => {
    const { fixture } = mountWith({ rollbackTarget: signal(ROLLBACK_RUN) }, "admin")
    translateWith({
      settings: { admin: { rollback: { target: "{{date}}|{{folder}}|{{count}}" } } },
    })

    fixture.detectChanges()

    const line = hostOf(fixture).querySelector("[data-rollback-target]")
    expect(line?.textContent).toContain("|D:/Music/Promo Octobre|1")
    expect(line?.textContent).toContain("2026")
  })

  it.each(["loadRollbackTarget", "listRuns", "loadCacheSize"] as const)(
    "does not call %s at construction",
    (method) => {
      const { service } = mountWith({ available: signal<boolean | null>(null) })

      expect(service[method]).not.toHaveBeenCalled()
    },
  )

  it.each(["loadRollbackTarget", "listRuns", "loadCacheSize"] as const)(
    "calls %s once the engine answers",
    (method) => {
      const available = signal<boolean | null>(null)
      const { fixture, service } = mountWith({ available })

      available.set(true)
      fixture.detectChanges()

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

    expect(hostOf(fixture).querySelector("[data-rollback-target]")).toBeNull()
    expect(component["restoreBlockedReason"]()).toBe(reason)
  })

  it("renders the raw date of a run whose date cannot be parsed", () => {
    const { fixture } = mountWith(
      { rollbackTarget: signal({ ...ROLLBACK_RUN, written_at: "not-a-date" }) },
      "admin",
    )
    translateWith({ settings: { admin: { rollback: { target: "{{date}}|{{folder}}" } } } })

    fixture.detectChanges()

    expect(hostOf(fixture).querySelector("[data-rollback-target]")?.textContent).toContain(
      "not-a-date|D:/Music/Promo Octobre",
    )
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
        rollingBack: signal<RollbackInFlight | null>({ runId: RUN_ID, trackId: null }),
      },
    },
  ])("blocks the undo while $name is in progress", ({ overrides }) => {
    const { fixture, component } = mountWith(
      { rollbackTarget: signal(ROLLBACK_RUN), ...overrides },
      "admin",
    )

    expect(component["restoreBlockedReason"]()).toBe("tagging.rollback.blocked")
    expect(action("restore-last", hostOf(fixture))?.disabled).toBe(true)
  })

  describe("undo of the last run", () => {
    const mountUndo = () => {
      const mounted = mountWith({ rollbackTarget: signal(ROLLBACK_RUN) })
      translateWith({ settings: { admin: { rollback: { message: "{{folder}} {{count}}" } } } })

      return { ...mounted, confirmation: spyConfirmation() }
    }

    it("asks a danger confirmation that names the run", () => {
      const { component, confirmation } = mountUndo()

      component["restoreLast"]()

      expect(confirmation.options()?.message).toBe("D:/Music/Promo Octobre 1")
      expect(confirmation.options()?.acceptButtonProps).toMatchObject({ severity: "danger" })
    })

    it("undoes the run once confirmed", () => {
      const { component, service, confirmation } = mountUndo()
      component["restoreLast"]()

      confirmation.accept()

      expect(service.rollback).toHaveBeenCalledWith(RUN_ID)
    })
  })

  it("shows the API section first", () => {
    const { fixture } = mountWith()

    expect(hostOf(fixture).querySelector("input#api-key")).not.toBeNull()
    expect(action("restore-last", hostOf(fixture))).toBeNull()
  })

  it("shows only the section chosen in the menu", () => {
    const { fixture, component } = mountWith({ rollbackTarget: signal(ROLLBACK_RUN) })
    openSection(component, "admin")

    fixture.detectChanges()

    expect(action("restore-last", hostOf(fixture))).not.toBeNull()
    expect(hostOf(fixture).querySelector("input#api-key")).toBeNull()
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

  // L'entree est composee par le template : Entree passe par le contenu de l'entree, pas par un lien.
  it("opens a section from the keyboard through the composed menu entry", () => {
    const { fixture } = mountWith()
    fixture.detectChanges()
    const list = hostOf(fixture).querySelector<HTMLElement>("p-menu ul")
    list?.focus()
    list?.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowDown", bubbles: true }))

    list?.dispatchEvent(new KeyboardEvent("keydown", { code: "Enter", bubbles: true }))
    fixture.detectChanges()

    expect(hostOf(fixture).querySelector("h2")?.textContent.trim()).toBe("settings.matching.title")
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

    expect(errorMessageOf(hostOf(fixture))).not.toBeNull()
  })

  describe("past runs", () => {
    const THIRD_RUN: PastRun = { ...PAST_RUN, run_id: "c7d8e9" }

    it("lists the past runs as the engine ordered them, the latest first", () => {
      const pastRuns = signal<readonly PastRun[] | null>([
        { ...OTHER_PAST_RUN, folder: "D:/Sets/Septembre" },
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
      const pastRuns = signal<readonly PastRun[] | null>([OTHER_PAST_RUN, PAST_RUN])
      const { component } = mountWith({ pastRuns })

      expect(component["pastChoice"]().runId).toBe(OTHER_PAST_RUN.run_id)
    })

    it.each([
      {
        case: "keeps the chosen run when the list is refreshed",
        refreshed: [THIRD_RUN, PAST_RUN, OTHER_PAST_RUN],
        expected: OTHER_PAST_RUN.run_id,
      },
      {
        case: "falls back on the latest run when the chosen one is gone",
        refreshed: [THIRD_RUN, PAST_RUN],
        expected: THIRD_RUN.run_id,
      },
    ])("$case", ({ refreshed, expected }) => {
      const pastRuns = signal<readonly PastRun[] | null>([PAST_RUN, OTHER_PAST_RUN])
      const { component } = mountWith({ pastRuns })
      component["pastChoice"].set({ runId: OTHER_PAST_RUN.run_id })

      pastRuns.set(refreshed)

      expect(component["pastChoice"]().runId).toBe(expected)
    })

    it("opens the summary of the chosen run", () => {
      const { fixture } = mountWith(
        { pastRuns: signal<readonly PastRun[] | null>([PAST_RUN]) },
        "admin",
      )
      const navigate = stubNavigation("navigateByUrl")
      fixture.detectChanges()

      action("open-past-run", hostOf(fixture))?.click()

      expect(navigate).toHaveBeenCalledWith(`/tagging/recap/${PAST_RUN.run_id}`)
    })

    it.each([
      { case: "enables the row once a run is listed", runs: [PAST_RUN], disabled: false },
      { case: "disables the row without past runs", runs: [], disabled: true },
    ])("$case", ({ runs, disabled }) => {
      const { fixture, component } = mountWith(
        { pastRuns: signal<readonly PastRun[] | null>(runs) },
        "admin",
      )

      expect(action("open-past-run", hostOf(fixture))?.disabled).toBe(disabled)
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

    expect(hostOf(fixture).querySelector("[data-rollback-failures]")).not.toBeNull()
    expect(errorMessageOf(hostOf(fixture))).not.toBeNull()
  })

  describe("interface", () => {
    it("switches the language and stores the choice", () => {
      const { component, preferences } = mountWith({}, "interface")

      component["chooseLanguage"]("en")

      expect(TestBed.inject(TranslateService).getCurrentLang()).toBe("en")
      expect(preferences.writeLanguage).toHaveBeenCalledWith("en")
    })

    it("stores nothing when the page opens", () => {
      const { preferences } = mountWith({}, "interface")

      expect(preferences.readSoundSignal).toHaveBeenCalled()
      expect(preferences.writeSoundSignal).not.toHaveBeenCalled()
      expect(preferences.writeLanguage).not.toHaveBeenCalled()
    })

    it("translates the menu again once the language changes", () => {
      const { component } = mountWith()
      translateWith({ settings: { admin: { title: "Admin" } } }, "en")
      translateWith({ settings: { admin: { title: "Administration" } } }, "fr")

      component["chooseLanguage"]("en")

      const admin = component["menuItems"]().find((item) => item.id === "settings-section-admin")
      expect(admin?.label).toBe("Admin")
    })

    it("stores a muted completion sound", () => {
      const { component, preferences } = mountWith({}, "interface")

      component["chooseSound"](false)

      expect(preferences.writeSoundSignal).toHaveBeenCalledWith(false)
    })

    it("keeps a sound choice made before the stored one is read", async () => {
      const { fixture, component, preferences } = mountWith({}, "interface", {
        preferences: preferencesStub({ soundSignal: true }),
      })
      const toggle = hostOf(fixture).querySelector<HTMLInputElement>('[data-field="sound"] input')

      toggle?.click()

      await vi.waitFor(() => {
        expect(preferences.writeSoundSignal).toHaveBeenCalledWith(false)
      })
      expect(component["soundChoice"]().enabled).toBe(false)
    })

    it("shows the completion sound as stored", async () => {
      const { component } = mountWith({}, "interface", {
        preferences: preferencesStub({ soundSignal: false }),
      })

      // La lecture est une promesse que `whenStable` ne suit pas.
      await vi.waitFor(() => {
        expect(component["soundChoice"]().enabled).toBe(false)
      })
    })
  })

  describe("matching", () => {
    const mountMatching = (stored: Parameters<typeof preferencesStub>[0] = {}) =>
      mountWith({ defaultThresholds: signal(DEFAULT_THRESHOLDS) }, "matching", {
        preferences: preferencesStub(stored),
      })

    it("shows the engine defaults without a setting", async () => {
      const { component } = mountMatching()

      await vi.waitFor(() => {
        expect(component["storedThresholds"]()).toBeNull()
      })
      expect(component["thresholdsChoice"]()).toEqual(DEFAULT_THRESHOLDS)
      expect(component["thresholdsCustomized"]()).toBe(false)
    })

    it("prefers the stored setting over the engine defaults", async () => {
      const { component } = mountMatching({ thresholds: CUSTOM_THRESHOLDS })

      await vi.waitFor(() => {
        expect(component["thresholdsChoice"]()).toEqual(CUSTOM_THRESHOLDS)
      })
      expect(component["thresholdsCustomized"]()).toBe(true)
    })

    it("disables the thresholds until the engine answers", async () => {
      const { component } = mountWith({ defaultThresholds: signal(null) }, "matching")
      await vi.waitFor(() => {
        expect(component["storedThresholds"]()).toBeNull()
      })

      expect(component["thresholdsFields"].floor().disabled()).toBe(true)
    })

    it("disables the thresholds until the setting is read", () => {
      const preferences = preferencesStub()
      preferences.readThresholds.mockReturnValue(new Promise(() => undefined))

      const { component } = mountWith(
        { defaultThresholds: signal(DEFAULT_THRESHOLDS) },
        "matching",
        {
          preferences,
        },
      )

      expect(component["thresholdsFields"].floor().disabled()).toBe(true)
    })

    it("enables the thresholds once the setting is read", async () => {
      const { component } = mountMatching()

      await vi.waitFor(() => {
        expect(component["storedThresholds"]()).toBeNull()
      })

      expect(component["thresholdsFields"].floor().disabled()).toBe(false)
    })

    it("stores thresholds that differ from the defaults", () => {
      const { component, preferences } = mountMatching()
      component["thresholdsChoice"].set({ floor: 65, ceiling: 95 })

      component["storeThresholds"]()

      expect(preferences.writeThresholds).toHaveBeenCalledWith({ floor: 65, ceiling: 95 })
    })

    it.each([
      {
        case: "the engine defaults without a setting",
        stored: {},
        shown: DEFAULT_THRESHOLDS,
      },
      {
        case: "the stored setting",
        stored: { thresholds: CUSTOM_THRESHOLDS },
        shown: CUSTOM_THRESHOLDS,
      },
    ])("ignores a cleared field and shows $case again", async ({ stored, shown }) => {
      const { component, preferences } = mountMatching(stored)
      await vi.waitFor(() => {
        expect(component["storedThresholds"]()).not.toBeUndefined()
        expect(component["thresholdsChoice"]()).toEqual(shown)
      })
      component["thresholdsChoice"].set({ floor: null as unknown as number, ceiling: 99 })

      component["storeThresholds"]()

      expect(preferences.writeThresholds).not.toHaveBeenCalled()
      expect(component["thresholdsChoice"]()).toEqual(shown)
    })

    it("writes nothing when the thresholds did not change", async () => {
      const { component, preferences } = mountMatching({ thresholds: CUSTOM_THRESHOLDS })
      await vi.waitFor(() => {
        expect(component["thresholdsCustomized"]()).toBe(true)
      })

      component["storeThresholds"]()

      expect(preferences.writeThresholds).not.toHaveBeenCalled()
    })

    it("stores no setting for thresholds equal to the defaults", async () => {
      const { component, preferences } = mountMatching({ thresholds: CUSTOM_THRESHOLDS })
      await vi.waitFor(() => {
        expect(component["thresholdsCustomized"]()).toBe(true)
      })
      component["thresholdsChoice"].set({ ...DEFAULT_THRESHOLDS })

      component["storeThresholds"]()

      expect(preferences.writeThresholds).toHaveBeenCalledWith(null)
      expect(component["thresholdsCustomized"]()).toBe(false)
    })

    it("resets the thresholds to the engine defaults", async () => {
      const { component, preferences } = mountMatching({ thresholds: CUSTOM_THRESHOLDS })
      await vi.waitFor(() => {
        expect(component["thresholdsCustomized"]()).toBe(true)
      })

      component["resetThresholds"]()

      expect(component["thresholdsChoice"]()).toEqual(DEFAULT_THRESHOLDS)
      expect(preferences.writeThresholds).toHaveBeenCalledWith(null)
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
      const { fixture, component } = mountWith(
        { cacheSize: signal<number | null>(418_000_000) },
        "admin",
      )

      expect(component["cacheSize"]()).toBe("418 MB")
      expect(hostOf(fixture).querySelector("[rowControl][data-cache-size]")).not.toBeNull()
    })

    it("sends the clearing", () => {
      const { fixture, service } = mountWith({}, "admin")

      action("clear-cache", hostOf(fixture))?.click()

      expect(service.clearCache).toHaveBeenCalled()
    })

    it.each([
      {
        case: "the freed bytes of a new clearing",
        cleared: CLEARED,
        detail: "418 MB freed",
      },
      {
        case: "what is left after a partial clearing",
        cleared: { ...CLEARED, size_bytes: 12_000_000 },
        detail: "418 MB freed\n12 MB left",
      },
    ])("announces $case", ({ cleared, detail }) => {
      const cacheCleared = signal<CacheClearedEvent | null>(null)
      const { fixture } = mountWith({ cacheCleared }, "admin")
      const toast = spyToast()
      withClearedTranslations()

      cacheCleared.set(cleared)
      fixture.detectChanges()

      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ severity: "success", summary: "Cleared", detail }),
      )
    })

    it("announces nothing for a clearing already known when the page opens", () => {
      // Sur le prototype et avant le montage : l'annonce se jouerait au premier rendu.
      const toast = vi.spyOn(MessageService.prototype, "add")

      mountWith({ cacheCleared: signal<CacheClearedEvent | null>(CLEARED) }, "admin")

      expect(toast).not.toHaveBeenCalled()
    })

    it.each([
      [
        "an engine still starting",
        { available: signal<boolean | null>(null) },
        "settings.admin.starting",
      ],
      ["a long phase", { tagging: signal(true) }, "settings.admin.cache.blocked.busy"],
      ["a run awaiting its write", { runAwaitsWrite: signal(true) }, "errors.run_not_written"],
      ["no run awaiting its write", {}, null],
    ])("blocks the clearing according to %s", (_case, overrides, reason) => {
      const { fixture, component } = mountWith(overrides, "admin")

      expect(component["cacheBlockedReason"]()).toBe(reason)
      expect(action("clear-cache", hostOf(fixture))?.disabled).toBe(reason !== null)
    })

    it("shows a clearing in flight on its button", () => {
      const { fixture } = mountWith({ cacheClearing: signal(true) }, "admin")

      const button = action("clear-cache", hostOf(fixture))

      expect(button?.disabled).toBe(true)
      expect(button?.querySelector('[data-icon="spinner"]')).not.toBeNull()
    })

    it("shows a refused clearing under the cache row", () => {
      const { fixture } = mountWith(commandFailed("clear_cache", "run_not_written"), "admin")

      expect(hostOf(fixture).querySelector("[data-cache-error]")).not.toBeNull()
    })
  })

  describe("logs", () => {
    it("reveals the log file named by the engine", async () => {
      const { component, native } = mountWith({ logFile: signal<string | null>(LOG_FILE) }, "admin")

      await component["revealLogs"]()

      expect(native.revealItemInDir).toHaveBeenCalledWith(LOG_FILE)
    })

    it.each([
      ["is not named yet", null, "settings.admin.starting"],
      ["is named", LOG_FILE, null],
    ])("blocks the logs button while the log file %s", (_case, file, reason) => {
      const { fixture, component } = mountWith({ logFile: signal<string | null>(file) }, "admin")

      expect(component["logsBlockedReason"]()).toBe(reason)
      expect(action("reveal-logs", hostOf(fixture))?.disabled).toBe(reason !== null)
    })

    it("forgets a failed reveal once a relaunched engine names its log file", async () => {
      const native = nativeStub()
      native.revealItemInDir.mockRejectedValueOnce(new Error("path not found"))
      const logFile = signal<string | null>(LOG_FILE)
      const { fixture, component } = mountWith({ logFile }, "admin", { native })
      await component["revealLogs"]()

      logFile.set("C:/data/relaunched.log")
      fixture.detectChanges()

      expect(hostOf(fixture).querySelector("[data-logs-error]")).toBeNull()
    })

    it("tells to restart when the log file cannot be revealed", async () => {
      const native = nativeStub()
      native.revealItemInDir.mockRejectedValueOnce(new Error("path not found"))
      const { fixture, component } = mountWith(
        { logFile: signal<string | null>(LOG_FILE) },
        "admin",
        { native },
      )

      await component["revealLogs"]()
      fixture.detectChanges()

      expect(hostOf(fixture).querySelector("[data-logs-error]")).not.toBeNull()
    })
  })

  describe("version row", () => {
    const row = (fixture: { nativeElement: unknown }) =>
      hostOf(fixture).querySelector<HTMLElement>("[data-version-row]")
    const settled = async (
      fixture: { detectChanges(): void },
      component: SettingsPageComponent,
    ) => {
      await vi.waitFor(() => {
        expect(component["updateCheck"]()).not.toBe("checking")
      })
      fixture.detectChanges()
    }

    it("shows the installed version", () => {
      const { fixture } = mountWith({}, "admin")
      translateWith({ settings: { admin: { version: { installed: "Installed {{version}}" } } } })

      fixture.detectChanges()

      expect(row(fixture)?.textContent).toContain(`Installed ${APP_VERSION}`)
    })

    it.each([
      ["finds nothing", null, "[data-version-up-to-date]"],
      ["fails", new Error("offline"), "[data-version-error]"],
    ])("shows the matching feedback after a check that %s", async (_, result, feedback) => {
      const { fixture, component } = mountWith({}, "admin", { updater: updaterStub(result) })

      action("check-update", hostOf(fixture))?.click()
      await settled(fixture, component)

      expect(row(fixture)?.querySelector(feedback)).not.toBeNull()
    })

    it("shows no feedback when an update is found", async () => {
      const { fixture, component } = mountWith({}, "admin", {
        updater: updaterStub(availableUpdate()),
      })
      const updates = TestBed.inject(UpdateService)

      action("check-update", hostOf(fixture))?.click()
      await settled(fixture, component)

      expect(updates.dialogVisible()).toBe(true)
      expect(row(fixture)?.querySelector("app-message")).toBeNull()
    })

    it("disables the button and shows the spinner while checking", () => {
      const updater = updaterStub()
      updater.check.mockReturnValueOnce(new Promise(() => undefined))
      const { fixture } = mountWith({}, "admin", { updater })

      action("check-update", hostOf(fixture))?.click()
      action("check-update", hostOf(fixture))?.click()
      fixture.detectChanges()

      expect(action("check-update", hostOf(fixture))?.disabled).toBe(true)
      expect(iconOf(hostOf(fixture), "spinner")).not.toBeNull()
      expect(updater.check).toHaveBeenCalledOnce()
    })

    it("forgets the feedback when the section changes", async () => {
      const { fixture, component } = mountWith({}, "admin", { updater: updaterStub(null) })
      action("check-update", hostOf(fixture))?.click()
      await settled(fixture, component)

      openSection(component, "api")
      openSection(component, "admin")
      fixture.detectChanges()

      expect(row(fixture)?.querySelector("app-message")).toBeNull()
    })

    it("drops the outcome of a check still running when the section changes", async () => {
      let finish: (update: null) => void = () => undefined
      const updater = updaterStub()
      updater.check.mockReturnValueOnce(
        new Promise<null>((resolve) => {
          finish = resolve
        }),
      )
      const { fixture, component } = mountWith({}, "admin", { updater })
      const checking = component["checkUpdate"]()
      openSection(component, "api")
      openSection(component, "admin")

      finish(null)
      await checking
      fixture.detectChanges()

      expect(row(fixture)?.querySelector("app-message")).toBeNull()
    })

    it("clears the previous feedback as soon as a new check starts", async () => {
      const updater = updaterStub(null)
      const { fixture, component } = mountWith({}, "admin", { updater })
      action("check-update", hostOf(fixture))?.click()
      await settled(fixture, component)
      const shownBefore = row(fixture)?.querySelector("app-message")
      updater.check.mockReturnValueOnce(new Promise(() => undefined))

      action("check-update", hostOf(fixture))?.click()
      fixture.detectChanges()

      expect(shownBefore).not.toBeNull()
      expect(row(fixture)?.querySelector("app-message")).toBeNull()
    })
  })
})
