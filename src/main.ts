import { bootstrapApplication } from "@angular/platform-browser"
import * as Sentry from "@sentry/angular"

import { AppComponent } from "./app/app.component"
import { appConfig } from "./app/app.config"
import { sentryOptions } from "./app/core/sentry-options"

// DSN vide = SDK inerte : c'est ainsi qu'on coupe la remontee en developpement.
Sentry.init(sentryOptions(SENTRY_DSN_UI, `${APP_NAME}@${APP_VERSION}`, APP_ENVIRONMENT))

bootstrapApplication(AppComponent, appConfig).catch((err: unknown) => {
  console.error(err)
})
