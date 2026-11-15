import { TestBed } from "@angular/core/testing"
import { TranslateService, type TranslationObject } from "@ngx-translate/core"

/** Charge ces traductions et active la langue : sans elles, un composant affiche la cle brute. */
export const translateWith = (translations: TranslationObject, language = "en"): void => {
  const translate = TestBed.inject(TranslateService)
  translate.setTranslation(language, translations)
  translate.use(language)
}
