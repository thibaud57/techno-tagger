---
paths:
  - "src/main.ts"
  - "src/app/app.config.ts"
  - "src/app/core/scrub.ts"
  - "src/app/core/scrub.spec.ts"
---

# Sentry — SDK Angular

## À faire
- Initialiser dans `main.ts` **avant** `bootstrapApplication()`
- Retirer du jeu par défaut `Breadcrumbs` (console et interactions, donc les titres affichés), `Replay` (le DOM) et `CultureContext` (locale et fuseau)
- Enregistrer le gestionnaire par `{ provide: ErrorHandler, useValue: Sentry.createErrorHandler() }` : il n'existe aucun `provideErrorHandler`
- Poser la même `release` que le sidecar, préfixe compris (`techno-tagger@X.Y.Z`), et `environment`, tous deux venus du `define` esbuild
- Générer les source maps en `hidden`, les uploader puis **les supprimer de `dist/`** dans les scripts npm de `pnpm build` : `tauri-codegen` embarque tout `frontendDist` sans filtre
- Réserver Sentry aux erreurs techniques : 5 000 événements par mois

## À éviter
- Livrer les source maps dans le bundle distribué
- Envoyer des événements métier : le quota se remplit et le vrai crash est jeté

## Gotchas
- `sendDefaultPii` est déjà `false` par défaut côté JavaScript, contrairement à Python où le défaut documenté est `None`
- Sans `release` identique des deux côtés, une erreur de webview et une erreur de sidecar ne se croisent sur aucune livraison
- Sentry résout par les Debug IDs qu'injecte `@angular/build`, pas par le chemin : supprimer les `.map` après l'upload ne lui enlève rien
- Seul le bouton « envoyer ce rapport » fait sortir des titres, par une issue pré-remplie que l'utilisateur relit : l'application ne pousse rien elle-même

## Exemples
```typescript
// ✅ main.ts, avant le bootstrap, intégrations capteuses retirées
Sentry.init({
  dsn: SENTRY_DSN_UI,
  release: `${APP_NAME}@${APP_VERSION}`,   // prefixe compris, identique au sidecar
  environment: APP_ENVIRONMENT,
  integrations: (defaults) =>
    defaults.filter(
      (i) => i.name !== 'Breadcrumbs' && i.name !== 'Replay' && i.name !== 'CultureContext',
    ),
});

bootstrapApplication(AppComponent, appConfig);

// ✅ app.config.ts
providers: [
  { provide: ErrorHandler, useValue: Sentry.createErrorHandler({ showDialog: false, logErrors: true }) },
]
```
