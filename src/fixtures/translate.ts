import { TestBed } from "@angular/core/testing"
import { TranslateService, type TranslationObject } from "@ngx-translate/core"

/** Charge ces traductions en anglais : sans elles, un composant affiche la cle brute. */
export const translateWith = (translations: TranslationObject): void => {
  const translate = TestBed.inject(TranslateService)
  translate.setTranslation("en", translations)
  translate.use("en")
}
