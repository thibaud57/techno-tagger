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
