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

import { CloseGuard } from "./core/close-guard.service"
import { languageFromTag } from "./core/language"
import { SIDECAR_FILE } from "./core/sidecar-transport"
import { SidecarService } from "./core/sidecar.service"
import { TABS, isTabName, tabFromUrl, type TabValue } from "./core/tabs"
import { ArbitrationDialogComponent } from "./features/tagging/arbitration-dialog.component"
import { RecoveryUiStore } from "./features/tagging/recovery-ui.store"
import { CloseConfirmationComponent } from "./shared/components/close-confirmation.component"
import { IconComponent } from "./shared/components/icon.component"
import { FADE_IN } from "./shared/utils/motion"

@Component({
  selector: "app-root",
  imports: [
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
    IconComponent,
  ],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css",
  // `overflow-hidden` tient la regle « la page ne defile jamais » : sans lui, un pixel de
  // trop fait defiler le document et la barre d'onglets quitte l'ecran.
  host: { class: "flex h-screen flex-col overflow-hidden" },
})
export class AppComponent {
  private readonly translate = inject(TranslateService)
  private readonly document = inject(DOCUMENT)
  private readonly router = inject(Router)
  private readonly sidecar = inject(SidecarService)
  private readonly closeGuard = inject(CloseGuard)
  private readonly recovery = inject(RecoveryUiStore)

  protected readonly tabs = TABS
  protected readonly fadeIn = FADE_IN

  /** Derive de l'URL et non l'inverse : `p-tabs` n'a aucun mode router, et le deep-link reste vrai. */
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
  /** L'etape lien d'un morceau sorti de la file garde la modale ouverte, meme file videe. */
  private readonly queueEmpty = computed(
    () => this.sidecar.arbitrationCount() === 0 && this.recovery.linkStep() === null,
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
}
