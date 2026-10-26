---
paths:
  - "src/main.ts"
  - "src/app/app.config.ts"
  - "src/app/core/observability/scrub.ts"
  - "src/app/core/observability/scrub.spec.ts"
  - "src/app/core/observability/sentry-options.ts"
  - "src/app/core/observability/sentry-options.spec.ts"
---

# Sentry — SDK Angular

## À faire
- Initialiser dans `main.ts` **avant** `bootstrapApplication()`
- Retirer du jeu par défaut `Breadcrumbs` (interactions), `Console` (lignes de console, à part depuis Sentry 11), `Replay` (le DOM) et `CultureContext` (locale et fuseau) : les trois premières portent ce que l'écran affiche, la dernière localise l'utilisateur
- Fermer explicitement chaque catégorie de `dataCollection` (`userInfo`, `cookies`, `httpHeaders`, `httpBodies`, `urlQueryParams`, `graphQL`, `genAI`, `mcp`, `databaseQueryData`, `queues`, `stackFrameVariables`) : depuis Sentry 11, l'option absente collecte tout, IP comprise. Ce sont les onze catégories de `@sentry/core` 11.9.0 au 2026-10-26, `mcp` ajoutée par la 11.9.0. L'objet est typé `satisfies ClosedDataCollection` (toutes les catégories de `DataCollection` requises, `frameContextLines` exceptée) : une catégorie ajoutée par une montée casse la compilation et se ferme à cet endroit
- Masquer dans `scrub.ts` tout chemin de lecteur ou UNC en `<path>` et toute query string en `<query>`, par les motifs du `_scrub` du sidecar : un nom de fichier porte l'artiste et le titre
- Garder les options dans `core/observability/sentry-options.ts`, testées sur l'événement réellement envoyé : un défaut qui change à la montée du SDK fait alors échouer un test au lieu de fuiter
- Enregistrer le gestionnaire par `{ provide: ErrorHandler, useValue: Sentry.createErrorHandler() }` : il n'existe aucun `provideErrorHandler`
- Poser la même `release` que le sidecar, préfixe compris (`techno-tagger@X.Y.Z`), et `environment`, tous deux venus du `define` esbuild
- Générer les source maps en `hidden`, les uploader puis **les supprimer de `dist/`** dans les scripts npm de `pnpm build` : `tauri-codegen` embarque tout `frontendDist` sans filtre
- Réserver Sentry aux erreurs techniques : 5 000 événements par mois
- Envoyer une erreur par le jeton `CAPTURE_EXCEPTION` (`core/observability/`), jamais par `Sentry.captureException` importé : les specs le remplacent par TestBed

## À éviter
- Livrer les source maps dans le bundle distribué
- Envoyer des événements métier : le quota se remplit et le vrai crash est jeté

## Gotchas
- Sentry 11 remplace `sendDefaultPii` par `dataCollection`, dont l'absence vaut collecte maximale. L'IP se lit dans l'événement envoyé : `sdk.settings.infer_ip` vaut `never` quand `userInfo` est fermé, `auto` sinon
- Sans `release` identique des deux côtés, une erreur de webview et une erreur de sidecar ne se croisent sur aucune livraison
- Sentry résout par les Debug IDs qu'injecte `@angular/build`, pas par le chemin : supprimer les `.map` après l'upload ne lui enlève rien
- Seul le bouton « envoyer ce rapport » fait sortir des titres, par une issue pré-remplie que l'utilisateur relit : l'application ne pousse rien elle-même

## Exemples
```typescript
// ✅ intégrations capteuses retirées, chaque catégorie de collecte fermée
const PRIVATE = new Set(['Breadcrumbs', 'Console', 'Replay', 'CultureContext']);

Sentry.init({
  dsn: SENTRY_DSN_UI,
  release: `${APP_NAME}@${APP_VERSION}`,   // prefixe compris, identique au sidecar
  environment: APP_ENVIRONMENT,
  integrations: (defaults) => defaults.filter((i) => !PRIVATE.has(i.name)),
  dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false,
                    graphQL: { document: false, variables: false }, genAI: { inputs: false, outputs: false },
                    mcp: { inputs: false, outputs: false }, databaseQueryData: false, queues: false, stackFrameVariables: false },
});
bootstrapApplication(AppComponent, appConfig);

// ❌ Sentry 11 sans dataCollection : IP inférée, en-têtes, cookies et corps collectés
Sentry.init({ dsn: SENTRY_DSN_UI });

// ✅ app.config.ts
providers: [
  { provide: ErrorHandler, useValue: Sentry.createErrorHandler({ showDialog: false, logErrors: true }) },
]
```
