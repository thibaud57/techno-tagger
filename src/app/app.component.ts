import { NgTemplateOutlet } from "@angular/common"
import { Component, DOCUMENT, computed, effect, inject, linkedSignal } from "@angular/core"
import { toSignal } from "@angular/core/rxjs-interop"
import { NavigationEnd, Router, RouterOutlet } from "@angular/router"
import { TranslatePipe, TranslateService } from "@ngx-translate/core"
import { ButtonDirective } from "primeng/button"
import { Card } from "primeng/card"
import { Tab, TabList, Tabs } from "primeng/tabs"
import { Tag } from "primeng/tag"
import { Toast } from "primeng/toast"
import { filter, map } from "rxjs"

import { languageFromTag } from "./core/i18n/language"
import { CloseGuard } from "./core/platform/close-guard.service"
import { TABS, isTabName, tabFromUrl, type TabName, type TabValue } from "./core/platform/tabs"
import { UpdateService } from "./core/platform/update.service"
import { SIDECAR_FILE } from "./core/sidecar/sidecar-transport"
import { SidecarService } from "./core/sidecar/sidecar.service"
import { ArbitrationDialogComponent } from "./features/tagging/arbitration/arbitration-dialog.component"
import { RecoveryUiStore } from "./features/tagging/url-recovery/recovery-ui.store"
import { CloseConfirmationComponent } from "./shared/components/dialogs/close-confirmation.component"
import { ResumeDialogComponent } from "./shared/components/dialogs/resume-dialog.component"
import { UpdateDialogComponent } from "./shared/components/dialogs/update-dialog.component"
import { IconComponent, type IconName } from "./shared/components/display/icon.component"
import { WindowControlsComponent } from "./shared/components/window/window-controls.component"
import { FADE_IN } from "./shared/utils/motion"

/** Une icone devant chaque libelle de la barre ; Reglages n'a que la sienne (DESIGN.md § Icones). */
const TAB_ICONS = {
  playlist: "list",
  tagging: "tag",
  settings: "cog",
} as const satisfies Record<TabName, IconName>

const SETTINGS_TAB = "settings" satisfies TabName

@Component({
  selector: "app-root",
  imports: [
    NgTemplateOutlet,
    RouterOutlet,
    Tabs,
    TabList,
    Tab,
    Tag,
    TranslatePipe,
    ButtonDirective,
    Card,
    Toast,
    ArbitrationDialogComponent,
    CloseConfirmationComponent,
    ResumeDialogComponent,
    UpdateDialogComponent,
    IconComponent,
    WindowControlsComponent,
  ],
  templateUrl: "./app.component.html",
  // `overflow-hidden` tient la regle « la page ne defile jamais » : sans lui, un pixel de
  // trop fait defiler le document et la barre d'onglets quitte l'ecran.
  // `bg-surface-950` : sans fond pose, la page prendrait le gris par defaut de WebView2, hors palette.
  host: { class: "flex h-screen flex-col overflow-hidden bg-surface-950" },
})
export class AppComponent {
  private readonly translate = inject(TranslateService)
  private readonly document = inject(DOCUMENT)
  private readonly router = inject(Router)
  private readonly sidecar = inject(SidecarService)
  private readonly closeGuard = inject(CloseGuard)
  private readonly recovery = inject(RecoveryUiStore)
  private readonly updates = inject(UpdateService)

  /** Le flux de travail au centre de la barre ; les Reglages a part, en engrenage a droite. */
  protected readonly workflowTabs = TABS.filter((tab) => tab !== SETTINGS_TAB)
  protected readonly settingsTab = SETTINGS_TAB
  protected readonly tabIcons = TAB_ICONS
  /**
   * Le trait de l'onglet actif passe de l'ink bar a la bordure de l'onglet : PrimeNG ne recale
   * l'ink bar qu'au changement d'onglet, et des onglets centres bougent avec la fenetre.
   */
  protected readonly tabsTokens = {
    // Padding vertical nul : la hauteur vient de `h-10`, celle d'une barre de titre Windows.
    tab: { borderWidth: "0 0 1px 0", activeBorderColor: "{primary.color}", padding: "0 0.875rem" },
    activeBar: { height: "0" },
  }
  protected readonly appTitle = APP_TITLE
  protected readonly fadeIn = FADE_IN

  /** Derive de l'URL (le deep-link reste vrai) et non l'inverse : `p-tabs` n'a aucun mode router. */
  protected readonly activeTab = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => tabFromUrl(this.router.url)),
    ),
    { initialValue: tabFromUrl(this.router.url) },
  )

  /** Ecran bloquant : `null` tant que le lancement n'a pas repondu, pour ne pas clignoter. */
  protected readonly blocked = computed<"missing" | "versionMismatch" | null>(() => {
    if (this.sidecar.available() === false) {
      return "missing"
    }

    return this.sidecar.versionMismatch() === null ? null : "versionMismatch"
  })

  protected readonly blockedParams = computed(() => ({
    file: SIDECAR_FILE,
    ...this.sidecar.versionMismatch(),
  }))

  protected readonly arbitrationCount = this.sidecar.arbitrationCount
  protected readonly interruptedRun = this.sidecar.interruptedRun
  /** L'etape lien d'un morceau sorti de la file garde la modale ouverte, meme file videe. */
  private readonly queueEmpty = computed(
    () => this.arbitrationCount() === 0 && this.recovery.linkStep() === null,
  )
  private readonly arbitrationDismissed = linkedSignal({
    source: () => [this.queueEmpty(), this.sidecar.arbitrationOpenings()],
    computation: () => false,
  })
  protected readonly arbitrationVisible = computed(
    () => !this.queueEmpty() && !this.arbitrationDismissed(),
  )

  /** Masque pendant la recherche : le sidecar y refuse le geste. */
  protected readonly recoveryCount = computed(() =>
    this.recovery.available() ? this.recovery.unresolvedCount() : 0,
  )
  protected readonly closeRequested = computed(() => this.closeGuard.request() !== null)
  protected readonly update = this.updates.update
  protected readonly updateBadgeVisible = this.updates.badgeVisible
  protected readonly updateDialogVisible = this.updates.dialogVisible

  constructor() {
    void this.closeGuard.install()

    effect(() => {
      this.document.documentElement.lang = languageFromTag(this.translate.currentLang())
    })
  }

  protected navigate(tab: TabValue): void {
    if (isTabName(tab)) {
      void this.router.navigate([tab])
    }
  }

  protected async retry(): Promise<void> {
    await this.sidecar.restart()
  }

  /** La croix sur l'etape lien la quitte : le morceau reste a rattraper par le badge. */
  protected dismissArbitration(): void {
    this.recovery.leaveLinkStep()
    this.arbitrationDismissed.set(true)
  }

  /** Le rattrapage concerne le run : la modale du lien s'ouvre sur Tagging, liste en fond. */
  protected openRecovery(): void {
    this.recovery.open()
    void this.router.navigate(["tagging"])
  }

  protected reopenArbitration(): void {
    this.arbitrationDismissed.set(false)
  }

  protected reopenUpdate(): void {
    this.updates.reopen()
  }
}
