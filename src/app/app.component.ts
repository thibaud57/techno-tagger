import { Component, DOCUMENT, effect, inject } from "@angular/core"
import { RouterOutlet } from "@angular/router"
import { TranslatePipe, TranslateService } from "@ngx-translate/core"
import { Tab, TabList, Tabs } from "primeng/tabs"

import { FALLBACK_LANGUAGE } from "./core/language"

@Component({
  selector: "app-root",
  imports: [RouterOutlet, Tabs, TabList, Tab, TranslatePipe],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css",
  // Onglets en haut, page sur le reste : la hauteur descend jusqu'a la table qui defile.
  host: { class: "flex h-screen flex-col" },
})
export class AppComponent {
  private readonly translate = inject(TranslateService)
  private readonly document = inject(DOCUMENT)

  constructor() {
    effect(() => {
      this.document.documentElement.lang = this.translate.currentLang() ?? FALLBACK_LANGUAGE
    })
  }
}
