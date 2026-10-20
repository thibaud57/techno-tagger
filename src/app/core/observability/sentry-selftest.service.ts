import { effect, inject, Service } from "@angular/core"

import { SidecarService } from "../sidecar/sidecar.service"

import { CAPTURE_EXCEPTION } from "./capture-exception"

/** Faux morceau du self-test : `scrub` doit l'effacer en `<path>` de l'evenement envoye. */
export const SELFTEST_PATH = String.raw`D:\Musique\Nova Pulse - Your Mind.mp3`

/**
 * Lancee avec `TECHNO_TAGGER_SENTRY_SELFTEST=1`, l'application envoie un evenement de test de la
 * webview, une seule fois par lancement : `version` revient apres `set_api_key` et a chaque
 * relance du moteur. Seul le sidecar lit l'environnement, il le dit dans `version`.
 */
@Service()
export class SentrySelftestService {
  private readonly sidecar = inject(SidecarService)
  private readonly captureException = inject(CAPTURE_EXCEPTION)
  private sent = false

  constructor() {
    effect(() => {
      if (!this.sidecar.sentrySelftest() || this.sent) {
        return
      }
      this.sent = true
      this.captureException(new Error(`sentry self test, must be masked: ${SELFTEST_PATH}`))
    })
  }
}
