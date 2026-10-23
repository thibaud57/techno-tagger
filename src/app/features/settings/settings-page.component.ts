import { Component, computed, effect, inject, linkedSignal, signal, untracked } from "@angular/core"
import { type FieldTree, FormField, disabled, form } from "@angular/forms/signals"
import { Router } from "@angular/router"
import { TranslatePipe, TranslateService } from "@ngx-translate/core"
import { type MenuItem, MessageService, type PassThroughContext } from "primeng/api"
import { ButtonDirective } from "primeng/button"
import { IconField } from "primeng/iconfield"
import { InputIcon } from "primeng/inputicon"
import { InputNumber } from "primeng/inputnumber"
import { InputPassword } from "primeng/inputpassword"
import { Label } from "primeng/label"
import { Menu } from "primeng/menu"
import type { MenuPassThrough } from "primeng/types/menu"
import { Select } from "primeng/select"
import { Slider } from "primeng/slider"
import { ToggleSwitch } from "primeng/toggleswitch"
import { Tooltip } from "primeng/tooltip"

import { LANGUAGES, type Language, languageFromTag } from "../../core/i18n/language"
import { TOAST_LIFE } from "../../core/platform/completion-signal.service"
import { NativeService } from "../../core/platform/native.service"
import { type ManualCheck, UpdateService } from "../../core/platform/update.service"
import {
  DEFAULT_SOUND_SIGNAL,
  PreferencesService,
  isThresholds,
} from "../../core/platform/preferences.service"
import {
  type CacheClearedEvent,
  SCORE_SCALE,
  type ThresholdsPayload,
} from "../../core/sidecar/protocol"
import { SidecarService } from "../../core/sidecar/sidecar.service"
import {
  DangerConfirmComponent,
  injectDangerConfirm,
} from "../../shared/components/dialogs/danger-confirm.component"
import { RollbackFailuresComponent } from "../../shared/components/dialogs/rollback-failures.component"
import { IconComponent, type IconName } from "../../shared/components/display/icon.component"
import { TruncatedTextComponent } from "../../shared/components/display/truncated-text.component"
import { ErrorMessageComponent } from "../../shared/components/feedback/error-message.component"
import { MessageComponent } from "../../shared/components/feedback/message.component"
import { formatBytes } from "../../shared/utils/bytes"
import { FADE_IN } from "../../shared/utils/motion"
import { runLine } from "../../shared/utils/run-date"
import { TOOLTIP } from "../../shared/utils/tooltip"

import { SettingsRowComponent } from "./settings-row.component"

interface ApiKeyEntry {
  apiKey: string
}

interface PastRunOption {
  readonly value: string
  readonly label: string
}

interface PastRunChoice {
  runId: string | null
}

interface LanguageOption {
  readonly value: Language
  readonly label: string
}

interface LanguageChoice {
  language: Language
}

interface SoundChoice {
  enabled: boolean
}

interface ThresholdsChoice {
  floor: number
  ceiling: number
}

/** Une cle enregistree se signale par des points en placeholder, sans etre relue (ADR-012). */
export const STORED_KEY_MASK = "•".repeat(24)

/** Chiffres alignes d'une rangee a l'autre (fiche InputNumber). */
const NUMBER_PT = { pcInputText: { root: { class: "tabular-nums" } } }

const choiceOf = (shown: ThresholdsPayload | null): ThresholdsChoice => ({
  floor: Math.round(shown?.floor ?? SCORE_SCALE.min),
  ceiling: Math.round(shown?.ceiling ?? SCORE_SCALE.max),
})

/** Un champ vide (`null`) ne se compare a rien : il passe tel quel, `storeThresholds` le rejette. */
const uncrossed = (next: ThresholdsChoice, current: ThresholdsChoice): ThresholdsChoice => {
  if (!(next.floor > next.ceiling)) {
    return next
  }

  return next.floor === current.floor
    ? { ...next, ceiling: next.floor }
    : { ...next, floor: next.ceiling }
}

/** Compare dans l'espace arrondi de l'affichage : un defaut non entier ne doit pas se croire modifie. */
const sameChoice = (a: ThresholdsChoice, b: ThresholdsChoice): boolean =>
  a.floor === b.floor && a.ceiling === b.ceiling

/** Ordre du menu, celui de la maquette ; une section sans rangee n'y entre pas. */
const SECTIONS = ["api", "matching", "interface", "admin"] as const

export type SettingsSection = (typeof SECTIONS)[number]

const SECTION_ICONS = {
  api: "key",
  matching: "sliders-h",
  interface: "desktop",
  admin: "wrench",
} as const satisfies Record<SettingsSection, IconName>

const menuItemId = (section: SettingsSection): string => `settings-section-${section}`

/** PrimeNG passe `context` (item, index, focused, disabled) aux fonctions `pt` sans le typer. */
type MenuItemPassThroughContext = PassThroughContext & { context?: { item?: MenuItem } }

@Component({
  selector: "app-settings-page",
  imports: [
    TranslatePipe,
    FormField,
    ButtonDirective,
    IconField,
    InputIcon,
    InputNumber,
    InputPassword,
    Label,
    Menu,
    Select,
    Slider,
    Tooltip,
    ToggleSwitch,
    ErrorMessageComponent,
    MessageComponent,
    IconComponent,
    RollbackFailuresComponent,
    TruncatedTextComponent,
    DangerConfirmComponent,
    SettingsRowComponent,
  ],
  templateUrl: "./settings-page.component.html",
  host: { class: "page-host", "animate.enter": FADE_IN },
})
export default class SettingsPageComponent {
  private readonly sidecar = inject(SidecarService)
  private readonly translate = inject(TranslateService)
  private readonly confirmDanger = injectDangerConfirm()
  private readonly router = inject(Router)
  private readonly messages = inject(MessageService)
  private readonly native = inject(NativeService)
  private readonly preferences = inject(PreferencesService)
  private readonly updates = inject(UpdateService)

  /**
   * Une section a la fois : les rangees de toutes les sections ne tiennent pas au plancher de
   * 700px, la page ne defilant pas (DESIGN.md § Structure de Page). Locale : aucun lien ne vise
   * une section.
   */
  protected readonly section = signal<SettingsSection>("api")
  protected readonly menuItems = computed<MenuItem[]>(() => {
    // `currentLang()` est lu ici : le menu se retraduit au changement de langue.
    this.translate.currentLang()

    return SECTIONS.map((section) => ({
      id: menuItemId(section),
      icon: SECTION_ICONS[section],
      label: this.translate.instant(`settings.${section}.title`) as string,
      command: () => {
        this.openSection(section)
      },
    }))
  })
  /** Chaque langue se nomme dans sa propre langue, quelle que soit celle de l'interface. */
  protected readonly languageOptions = computed<LanguageOption[]>(() => {
    this.translate.currentLang()

    return LANGUAGES.map((value) => ({
      value,
      label: this.translate.instant(`settings.interface.language.options.${value}`) as string,
    }))
  })
  private readonly language = computed(() => languageFromTag(this.translate.currentLang()))
  /** Suit la langue courante ; seul `chooseLanguage` en fait un choix enregistre. */
  protected readonly languageChoice = linkedSignal<LanguageChoice>(() => ({
    language: this.language(),
  }))
  protected readonly languageFields = form(this.languageChoice)
  protected readonly soundChoice = signal<SoundChoice>({ enabled: DEFAULT_SOUND_SIGNAL })
  protected readonly soundFields = form(this.soundChoice)
  private soundChosen = false
  /** `undefined` tant que le store n'est pas lu, `null` sans reglage. */
  protected readonly storedThresholds = signal<ThresholdsPayload | null | undefined>(undefined)
  /** Le reglage, sinon les defauts du moteur ; `null` tant qu'aucun des deux n'est connu. */
  private readonly shownThresholds = computed(
    () => this.storedThresholds() ?? this.sidecar.defaultThresholds(),
  )
  /**
   * Les deux curseurs partagent l'echelle 0-100 : une meme valeur au meme endroit. Le seuil qui
   * bouge bute donc sur l'autre ici, `check_thresholds` refusant un plancher au-dessus du seuil haut.
   */
  protected readonly thresholdsChoice = linkedSignal<ThresholdsChoice>(
    () => choiceOf(this.shownThresholds()),
    {
      set: (next, rawSet) => {
        rawSet(uncrossed(next, untracked(this.thresholdsChoice)))
      },
    },
  )
  protected readonly thresholdsFields = form(this.thresholdsChoice, (path) => {
    // Sans valeur connue, un geste enregistrerait 0 et 100. Store pas encore lu : le geste
    // s'enregistrerait sur des defauts, ou la lecture tardive l'annulerait.
    const unknown = (): boolean =>
      this.shownThresholds() === null || this.storedThresholds() === undefined
    disabled(path.floor, { when: unknown })
    disabled(path.ceiling, { when: unknown })
  })
  /** Bornes croisees des champs, que `p-inputnumber` applique a la sortie du champ. */
  protected readonly floorMax = computed(() => this.thresholdsChoice().ceiling)
  protected readonly ceilingMin = computed(() => this.thresholdsChoice().floor)
  protected readonly thresholdsCustomized = computed(() => {
    const stored = this.storedThresholds()

    return stored !== null && stored !== undefined
  })
  protected readonly activeItemId = computed(() => menuItemId(this.section()))
  /**
   * Le marqueur va sur le contenu de l'entree, pas sur son `li` : Aura peint le survol et le focus
   * sur le contenu, qui recouvrirait un fond pose sur le `li`. L'entree active l'emporte ainsi.
   */
  protected readonly menuPt = computed<MenuPassThrough>(() => {
    const activeId = this.activeItemId()
    const isActive = (options: PassThroughContext): boolean =>
      (options as MenuItemPassThroughContext).context?.item?.id === activeId

    // Valeur vide explicite : `pBind` ne retire pas ce qu'une valeur absente laisse en place.
    // `border-0` : le cadre est celui du panneau de la page.
    return {
      root: "border-0",
      itemContent: (options) => (isActive(options) ? "bg-highlight" : ""),
    }
  })
  protected readonly menuTokens = { list: { padding: "0.5rem" } }

  protected readonly cacheSize = computed(() => {
    const bytes = this.sidecar.cacheSize()

    return bytes === null ? null : formatBytes(bytes, this.language())
  })
  /**
   * Sur ce que l'interface sait deja, comme `restoreBlockedReason` : le sidecar reste l'arbitre,
   * un refus `phase_busy` ou `run_not_written` s'affiche sous la rangee.
   */
  protected readonly cacheBlockedReason = computed(() => {
    if (this.sidecar.available() !== true) {
      return "settings.admin.starting"
    }
    if (this.sidecar.phase() !== "idle") {
      return "settings.admin.cache.blocked.busy"
    }

    return this.sidecar.runAwaitsWrite() ? "errors.run_not_written" : null
  })
  protected readonly cacheClearing = this.sidecar.cacheClearing
  protected readonly cacheError = this.sidecar.errorFor("clear_cache", "get_cache_size")
  /** Dernier vidage deja connu au montage : un retour sur l'onglet ne rejoue pas son toast. */
  private announcedClear = untracked(this.sidecar.cacheCleared)
  protected readonly logFile = this.sidecar.logFile
  protected readonly logsBlockedReason = computed(() =>
    this.logFile() === null ? "settings.admin.starting" : null,
  )
  /** Un moteur relance recree le fichier : sa nouvelle annonce efface l'echec du precedent. */
  protected readonly logsUnavailable = linkedSignal({
    source: this.logFile,
    computation: () => false,
  })

  /** « Trouvee » n'a pas de retour : la modale s'ouvre. Perdu en changeant de section. */
  protected readonly updateCheck = linkedSignal<
    SettingsSection,
    "checking" | Exclude<ManualCheck, "found"> | null
  >({ source: this.section, computation: () => null })
  protected readonly appVersion = APP_VERSION

  /** Jamais prerempli : la cle n'est pas relue depuis le trousseau. */
  protected readonly entry = signal<ApiKeyEntry>({ apiKey: "" })
  protected readonly fields = form(this.entry)
  protected readonly typing = computed(() => this.entry().apiKey !== "")
  /**
   * `pInputPassword` n'expose que ce model : la bascule est portee par le template. Toute saisie
   * commencee ou effacee repart masquee, l'oeil n'etant visible que pendant une saisie.
   */
  protected readonly masked = linkedSignal({ source: this.typing, computation: () => true })
  protected readonly apiKeyConfigured = this.sidecar.apiKeyConfigured
  protected readonly storedKeyMask = computed(() =>
    this.apiKeyConfigured() ? STORED_KEY_MASK : null,
  )
  protected readonly canSave = computed(() => this.typing() && this.sidecar.available() === true)
  protected readonly error = this.sidecar.errorFor("set_api_key")

  protected readonly tooltip = TOOLTIP
  protected readonly scale = SCORE_SCALE
  protected readonly numberPt = NUMBER_PT
  /** `undefined` tant que le moteur n'a pas repondu, `null` sans run annulable. */
  protected readonly target = this.sidecar.rollbackTarget
  protected readonly rollingBack = computed(() => this.sidecar.rollingBack() !== null)
  protected readonly targetLine = computed(() => {
    const target = this.target()

    return target
      ? {
          runId: target.run_id,
          ...runLine(target.written_at, target.folder, this.translate.currentLang()),
          count: target.tracks,
        }
      : null
  })
  protected readonly restoreBlockedReason = computed(() => {
    if (this.sidecar.tagging()) {
      return "tagging.blocked.running"
    }
    if (this.sidecar.filesBusy()) {
      return "tagging.rollback.blocked"
    }
    const target = this.target()
    if (target === undefined) {
      return "settings.admin.rollback.loading"
    }

    return target === null ? "settings.admin.rollback.none" : null
  })
  protected readonly rollbackFailures = computed(
    () => this.sidecar.rollbackFinished()?.failed ?? [],
  )
  protected readonly rollbackError = this.sidecar.errorFor("rollback", "get_rollback_target")
  /** Tableau modifiable : `p-select` n'accepte pas un tableau en lecture seule. */
  protected readonly pastRunOptions = computed<PastRunOption[]>(() => {
    // `currentLang()` est lu ici : la liste se retraduit au changement de langue.
    const language = this.translate.currentLang()

    return (this.sidecar.pastRuns() ?? []).map((run) => ({
      value: run.run_id,
      label: this.translate.instant(
        "settings.admin.rollback.target",
        runLine(run.written_at, run.folder, language),
      ) as string,
    }))
  })
  /**
   * Le plus recent par defaut, dans l'ordre du registre. Le choix survit a une nouvelle liste ou a
   * un changement de langue tant que son run y figure.
   */
  protected readonly pastChoice = linkedSignal<PastRunOption[], PastRunChoice>({
    source: this.pastRunOptions,
    computation: (options, previous) => ({
      runId:
        options.find((option) => option.value === previous?.value.runId)?.value ??
        options[0]?.value ??
        null,
    }),
  })
  protected readonly pastFields = form(this.pastChoice, (path) => {
    disabled(path.runId, { when: () => this.pastRunOptions().length === 0 })
  })

  constructor() {
    // Le dernier run annulable a pu etre ecrit dans une autre session : seul le moteur le sait.
    // La page se monte avant sa reponse : la demande suit la disponibilite du moteur.
    effect(() => {
      if (this.sidecar.available() === true) {
        untracked(() => {
          void this.sidecar.loadRollbackTarget()
          void this.sidecar.listRuns()
          void this.sidecar.loadCacheSize()
        })
      }
    })

    effect(() => {
      const cleared = this.sidecar.cacheCleared()
      if (cleared === null || cleared === this.announcedClear) {
        return
      }
      this.announcedClear = cleared
      untracked(() => {
        this.announceClear(cleared)
      })
    })

    // Une lecture qui arrive apres un clic n'ecrase pas le choix.
    void this.preferences.readSoundSignal().then((enabled) => {
      if (!this.soundChosen) {
        this.soundChoice.set({ enabled })
      }
    })

    // Une lecture tardive n'ecrase pas un geste deja fait : elle ne pose que l'etat initial.
    void this.preferences.readThresholds().then((stored) => {
      this.storedThresholds.update((current) => (current === undefined ? stored : current))
    })
  }

  protected toggleMask(): void {
    this.masked.update((masked) => !masked)
  }

  /** Le champ est vide avant l'envoi : un double clic ne renvoie rien. */
  protected async save(): Promise<void> {
    const apiKey = this.entry().apiKey
    if (apiKey === "") {
      return
    }
    this.entry.set({ apiKey: "" })
    await this.sidecar.setApiKey(apiKey)
  }

  protected restoreLast(): void {
    // Sans cible, la raison de blocage est non nulle et la ligne l'est aussi.
    const line = this.targetLine()
    if (line === null || this.restoreBlockedReason() !== null) {
      return
    }
    this.confirmDanger(
      "settings.admin.rollback",
      this.translate.instant("settings.admin.rollback.message", line) as string,
      () => {
        void this.sidecar.rollback(line.runId)
      },
      true,
    )
  }

  protected openPastRun(): void {
    const runId = this.pastChoice().runId
    if (runId !== null) {
      void this.router.navigateByUrl(`/tagging/recap/${runId}`)
    }
  }

  /** Sans confirmation : le cache est jetable (ADR-013), rien a restaurer. */
  protected clearCache(): void {
    if (this.cacheBlockedReason() !== null) {
      return
    }
    void this.sidecar.clearCache()
  }

  protected async checkUpdate(): Promise<void> {
    // Le bouton n'est grise qu'au rendu suivant : la garde tient le double clic.
    if (this.updateCheck() === "checking") {
      return
    }
    this.updateCheck.set("checking")
    const outcome = await this.updates.checkNow()
    // Un changement de section l'a remis a zero entre-temps : le retour serait perime.
    if (this.updateCheck() === "checking") {
      this.updateCheck.set(outcome === "found" ? null : outcome)
    }
  }

  /**
   * Revele le fichier courant plutot que le dossier : l'Explorateur s'ouvre dans `logs`, le
   * fichier a joindre selectionne. `opener:allow-reveal-item-in-dir` n'a pas de scope.
   */
  protected async revealLogs(): Promise<void> {
    const file = this.logFile()
    if (file === null) {
      return
    }
    try {
      await this.native.revealItemInDir(file)
      this.logsUnavailable.set(false)
    } catch {
      // Fichier efface a la main : le relancement du moteur le recree.
      this.logsUnavailable.set(true)
    }
  }

  /**
   * Sur l'evenement du select, jamais par un `effect` : celui-ci enregistrerait au premier
   * rendu la langue detectee, qui deviendrait un choix fige.
   */
  protected chooseLanguage(language: Language): void {
    this.translate.use(language)
    void this.preferences.writeLanguage(language)
  }

  /** `CompletionSignalService` relit la preference a chaque annonce : rien d'autre a prevenir. */
  protected chooseSound(enabled: boolean): void {
    this.soundChosen = true
    void this.preferences.writeSoundSignal(enabled)
  }

  /**
   * En fin de geste, jamais a chaque cran. Des valeurs egales aux defauts s'enregistrent `null` :
   * le reglage suit alors les defauts du moteur, recalibrage futur compris (ADR-008).
   */
  protected storeThresholds(): void {
    const choice = this.thresholdsChoice()
    const shown = choiceOf(this.shownThresholds())
    // Un champ vide arrive en `null` (InputNumber) : l'enregistrer ecrirait un reglage que la
    // lecture rejette, le run repartant des defauts sous des reglages affiches comme perso.
    if (!isThresholds(choice)) {
      this.thresholdsChoice.set(shown)
      return
    }
    // Un blur sans changement (Tab dans le champ) ne reecrit pas le store.
    if (sameChoice(choice, shown)) {
      return
    }
    const defaults = this.sidecar.defaultThresholds()
    const atDefaults = defaults !== null && sameChoice(choice, choiceOf(defaults))
    const stored = atDefaults ? null : choice
    this.storedThresholds.set(stored)
    void this.preferences.writeThresholds(stored)
  }

  /**
   * En butee, le modele borne ne change plus d'un cran a l'autre : le `controlValue` du champ, que
   * Signal Forms ne recalcule que sur un changement du modele, garderait la valeur du geste :
   * curseur comme champ continueraient de monter. `p-slider` a deja ecrit le champ a l'emission.
   */
  protected holdAtBound(field: FieldTree<number>): void {
    const state = field()
    if (state.controlValue() !== state.value()) {
      state.controlValue.set(state.value())
    }
  }

  protected resetThresholds(): void {
    this.storedThresholds.set(null)
    void this.preferences.writeThresholds(null)
  }

  /** Sans signal sonore : ce n'est pas la fin d'une phase longue. */
  private announceClear(cleared: CacheClearedEvent): void {
    const language = this.language()
    const lines = [
      this.translate.instant("settings.admin.cache.cleared.freed", {
        size: formatBytes(cleared.freed_bytes, language),
      }) as string,
    ]
    if (cleared.size_bytes > 0) {
      lines.push(
        this.translate.instant("settings.admin.cache.cleared.left", {
          size: formatBytes(cleared.size_bytes, language),
        }) as string,
      )
    }
    this.messages.add({
      severity: "success",
      summary: this.translate.instant("settings.admin.cache.cleared.summary") as string,
      detail: lines.join("\n"),
      life: TOAST_LIFE,
    })
  }

  /** Une cle saisie sans etre enregistree ne survit pas a sa section : elle y restait en clair. */
  private openSection(section: SettingsSection): void {
    this.section.set(section)
    if (section !== "api") {
      this.entry.set({ apiKey: "" })
    }
  }
}
