import {
  ApplicationConfig,
  ErrorHandler,
  Provider,
  inject,
  mergeApplicationConfig,
} from "@angular/core"

import { appConfig } from "../app.config"
import { CAPTURE_EXCEPTION } from "../core/observability/capture-exception"
import { APP_BANNER, APP_EDITION } from "../core/platform/app-edition"
import { APP_WINDOW } from "../core/platform/app-window"
import { NativeService } from "../core/platform/native.service"
import { PreferencesService } from "../core/platform/preferences.service"
import { APP_UPDATER } from "../core/platform/updater"
import { SIDECAR_TRANSPORT } from "../core/sidecar/sidecar-transport"
import { RECOVERY_URL_HINT } from "../features/tagging/url-recovery/recovery-url-hint"
import { DemoBannerComponent } from "./demo-banner.component"
import { DemoNativeService } from "./demo-native.service"
import { demoUpdater, demoWindow } from "./demo-platform"
import { DemoPreferencesService } from "./demo-preferences.service"
import { DemoScenarioService } from "./demo-scenario.service"
import { recoveryUrlOf } from "./replay"
import { ReplayTransport } from "./replay-transport"

// Sentry n'est pas initialise dans l'edition demo : on remplace le handler Sentry par celui d'Angular.
const DEMO_PROVIDERS: Provider[] = [
  { provide: APP_EDITION, useValue: "demo" },
  { provide: APP_BANNER, useValue: DemoBannerComponent },
  { provide: ErrorHandler, useClass: ErrorHandler },
  DemoScenarioService,
  { provide: NativeService, useClass: DemoNativeService },
  { provide: SIDECAR_TRANSPORT, useClass: ReplayTransport },
  { provide: APP_UPDATER, useValue: demoUpdater },
  {
    provide: RECOVERY_URL_HINT,
    // Le scenario se lit a l'appel : ReplayTransport.start() le charge, apres la construction du store.
    useFactory: () => {
      const scenarios = inject(DemoScenarioService)

      return (trackId: string) => recoveryUrlOf(scenarios.scenario(), trackId)
    },
  },
  { provide: APP_WINDOW, useValue: demoWindow },
  { provide: PreferencesService, useClass: DemoPreferencesService },
  {
    provide: CAPTURE_EXCEPTION,
    useValue: (exception: unknown) => {
      console.error(exception)
      return ""
    },
  },
]

export const demoConfig: ApplicationConfig = mergeApplicationConfig(appConfig, {
  providers: DEMO_PROVIDERS,
})
