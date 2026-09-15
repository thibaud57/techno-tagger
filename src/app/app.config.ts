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
import Aura from "@primeuix/themes/aura"
import * as Sentry from "@sentry/angular"
import { providePrimeNG } from "primeng/config"
import { firstValueFrom } from "rxjs"

import { routes } from "./app.routes"
import { FALLBACK_LANGUAGE, LANGUAGES, resolveInitialLanguage } from "./core/language"
import { SidecarService } from "./core/sidecar.service"

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: ErrorHandler, useValue: Sentry.createErrorHandler() },
    provideRouter(routes, withComponentInputBinding()),
    providePrimeNG({
      theme: {
        preset: Aura,
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
    // Avant le premier rendu : `locale()` est asynchrone, et une bascule de langue apres
    // affichage se verrait.
    provideAppInitializer(async () => {
      const translate = inject(TranslateService)
      translate.addLangs([...LANGUAGES])
      await firstValueFrom(translate.use(await resolveInitialLanguage()))
    }),
    // Sans attendre : l'ecran lit `available` et `ready` au fil de l'eau, et `start()` ne
    // leve jamais.
    provideAppInitializer(() => {
      void inject(SidecarService).start()
    }),
  ],
}
