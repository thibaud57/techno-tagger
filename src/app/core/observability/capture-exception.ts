import { InjectionToken } from "@angular/core"
import * as Sentry from "@sentry/angular"

/** Remplacable par TestBed : le builder unit-test ne supporte pas `vi.mock` (angular-cli#32641). */
export const CAPTURE_EXCEPTION = new InjectionToken<typeof Sentry.captureException>(
  "CaptureException",
  { providedIn: "root", factory: () => Sentry.captureException },
)
