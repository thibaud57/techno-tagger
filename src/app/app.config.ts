import {
  ApplicationConfig,
  ErrorHandler,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from "@angular/core"
import { provideRouter, withComponentInputBinding } from "@angular/router"
import { TranslateService, provideTranslateService } from "@ngx-translate/core"
import { provideTranslateHttpLoader } from "@ngx-translate/http-loader"
import * as Sentry from "@sentry/angular"
import { ConfirmationService, MessageService } from "primeng/api"
import { providePrimeNG } from "primeng/config"
import { firstValueFrom } from "rxjs"

import { routes } from "./app.routes"
import { FALLBACK_LANGUAGE, LANGUAGES, resolveStartupLanguage } from "./core/i18n/language"
import { SentrySelftestService } from "./core/observability/sentry-selftest.service"
import { CompletionSignalService } from "./core/platform/completion-signal.service"
import { PreferencesService } from "./core/platform/preferences.service"
import { TECHNO_TAGGER_PRESET } from "./core/platform/theme"
import { SidecarService } from "./core/sidecar/sidecar.service"

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: ErrorHandler, useValue: Sentry.createErrorHandler() },
    provideRouter(routes, withComponentInputBinding()),
    // Au root : CompletionSignalService (root) l'injecte, un provider pose sur AppComponent
    // lui serait invisible (NullInjectorError).
    MessageService,
    // Une seule instance entre `injectDangerConfirm` et le `p-confirmdialog` de chaque page.
    ConfirmationService,
    providePrimeNG({
      theme: {
        preset: TECHNO_TAGGER_PRESET,
        options: {
          // Doit rester identique au @custom-variant dark de styles.css
          darkModeSelector: ".app-dark",
          // Laisse les utilitaires Tailwind gagner sur les styles de composant
          cssLayer: { name: "primeng", order: "theme, base, primeng" },
        },
      },
      // Substituee au build par `--define` (cf. build-constants.d.ts), jamais
      // commitee. Requise meme en Community License.
      license: PRIMENG_LICENSE_KEY,
    }),
    provideTranslateService({
      fallbackLang: FALLBACK_LANGUAGE,
      loader: provideTranslateHttpLoader({
        prefix: "/i18n/",
        suffix: ".json",
        // Sinon un fichier absent rend `{}` en silence et l'interface affiche ses cles brutes.
        // En dev, l'ecran reste blanc et la cause est en console.
        failOnError: APP_ENVIRONMENT !== "production",
      }),
    }),
    // Avant le premier rendu : `locale()` est asynchrone, donc une bascule de langue apres
    // affichage se verrait.
    provideAppInitializer(async () => {
      const translate = inject(TranslateService)
      const preferences = inject(PreferencesService)
      translate.addLangs([...LANGUAGES])
      await firstValueFrom(
        translate.use(await resolveStartupLanguage(() => preferences.readLanguage())),
      )
    }),
    // Sans attendre : l'ecran lit `available` et `ready` au fil de l'eau. `start()` ne
    // leve jamais.
    provideAppInitializer(() => {
      void inject(SidecarService).start()
    }),
    // Construits des le demarrage : une phase s'annonce quel que soit l'onglet et le self-test
    // Sentry part sans attendre qu'un ecran l'injecte.
    provideAppInitializer(() => {
      inject(CompletionSignalService)
      inject(SentrySelftestService)
    }),
  ],
}
