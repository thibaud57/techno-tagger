import { Component, InjectionToken, computed, inject } from "@angular/core"
import { TranslatePipe, TranslateService } from "@ngx-translate/core"
import { ButtonDirective } from "primeng/button"

import { languageFromTag } from "../core/i18n/language"
import { IconComponent } from "../shared/components/display/icon.component"

export const DEMO_CONTACT_ORIGIN = "https://thibaud-geisler.com"

/** Recharge la demo sur sa page d'accueil : l'etat du rejeu vit en memoire et repart de zero. */
export const DEMO_RELOAD = new InjectionToken<() => void>("DemoReload", {
  providedIn: "root",
  factory: () => () => {
    location.assign("/")
  },
})

/** Bandeau B (DESIGN.md § Mapping Composants) : parle de l'environnement, pas de l'application. */
@Component({
  selector: "app-demo-banner",
  imports: [TranslatePipe, ButtonDirective, IconComponent],
  templateUrl: "./demo-banner.component.html",
  host: {
    class:
      "flex h-8 shrink-0 items-center justify-center gap-2 border-b border-surface-800 bg-surface-900 text-xs text-muted-color",
  },
})
export class DemoBannerComponent {
  private readonly translate = inject(TranslateService)
  protected readonly restart = inject(DEMO_RELOAD)

  protected readonly contactUrl = computed(
    () => `${DEMO_CONTACT_ORIGIN}/${languageFromTag(this.translate.currentLang())}/contact`,
  )
}
