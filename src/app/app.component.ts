import { Component, DOCUMENT, computed, effect, inject } from "@angular/core"
import { toSignal } from "@angular/core/rxjs-interop"
import { NavigationEnd, Router, RouterOutlet } from "@angular/router"
import { TranslatePipe, TranslateService } from "@ngx-translate/core"
import { ButtonDirective } from "primeng/button"
import { Card } from "primeng/card"
import { Tab, TabList, Tabs } from "primeng/tabs"
import { filter, map } from "rxjs"

import { languageFromTag } from "./core/language"
import { SIDECAR_FILE } from "./core/sidecar-transport"
import { SidecarService } from "./core/sidecar.service"
import { TABS, isTabName, tabFromUrl, type TabValue } from "./core/tabs"
import { FADE_IN } from "./shared/utils/motion"

@Component({
  selector: "app-root",
  imports: [RouterOutlet, Tabs, TabList, Tab, TranslatePipe, ButtonDirective, Card],
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

  constructor() {
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
}
