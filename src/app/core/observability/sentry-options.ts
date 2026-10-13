import type { BrowserOptions } from "@sentry/angular"

import { scrub } from "./scrub"

// Breadcrumbs capture les interactions et Console les lignes de console, donc les
// titres affiches (Console est a part depuis Sentry 11) ; Replay capture le DOM ;
// CultureContext envoie locale, calendrier et fuseau, qui localisent l'utilisateur.
const PRIVATE_INTEGRATIONS = new Set(["Breadcrumbs", "Console", "Replay", "CultureContext"])

/** Options de `Sentry.init`, durcies selon l'ADR-014 : rien de personnel ne part. */
export const sentryOptions = (
  dsn: string,
  release: string,
  environment: string,
): BrowserOptions => ({
  dsn,
  release,
  environment,
  integrations: (defaults) => defaults.filter((i) => !PRIVATE_INTEGRATIONS.has(i.name)),
  // Sentry 11 collecte tout par defaut quand `dataCollection` est absent, IP de
  // l'utilisateur comprise (`userInfo`) : chaque categorie est fermee explicitement.
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    stackFrameVariables: false,
  },
  // Pendant du before_send du sidecar : les chemins que le sidecar envoie dans
  // ses evenements finissent affiches, donc dans un message d'erreur.
  beforeSend: scrub,
})
