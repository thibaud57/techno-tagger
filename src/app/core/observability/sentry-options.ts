import type { BrowserOptions } from "@sentry/angular"

import { scrub } from "./scrub"

// Breadcrumbs capture les interactions et Console les lignes de console, donc les
// titres affiches (Console est a part depuis Sentry 11) ; Replay capture le DOM ;
// CultureContext envoie locale, calendrier et fuseau, qui localisent l'utilisateur.
const PRIVATE_INTEGRATIONS = new Set(["Breadcrumbs", "Console", "Replay", "CultureContext"])

// Sentry 11 collecte toute categorie absente de `dataCollection`, IP de l'utilisateur
// comprise (`userInfo`). Chacune est donc exigee ici, `frameContextLines` exceptee (des
// lignes de ce depot, public) : une categorie ajoutee par une montee du SDK casse la
// compilation au lieu de partir a son defaut.
type ClosedDataCollection = Required<
  Omit<NonNullable<BrowserOptions["dataCollection"]>, "frameContextLines">
>

const DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
} satisfies ClosedDataCollection

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
  dataCollection: DATA_COLLECTION,
  beforeSend: scrub,
})
