---
paths:
  - "src/main.ts"
  - "src/app/app.config.ts"
---

# Sentry — SDK Angular

## À faire
- Initialiser dans `main.ts` **avant** `bootstrapApplication()`
- Retirer les intégrations `Breadcrumbs`, `Replay` et `CultureContext` du jeu par défaut plutôt que d'essayer de les filtrer après coup : `Breadcrumbs` capture la console et les interactions (donc les titres de morceaux affichés), `Replay` capture le DOM, `CultureContext` envoie la locale, le calendrier et le fuseau horaire de l'utilisateur
- Enregistrer le gestionnaire d'erreurs par `{ provide: ErrorHandler, useValue: Sentry.createErrorHandler() }` : en 10.72.0 le paquet n'exporte que `createErrorHandler` et `SentryErrorHandler`, il n'existe aucun `provideErrorHandler`
- Poser la même `release` que côté sidecar, **préfixe compris** (`techno-tagger@X.Y.Z`), et renseigner `environment`. Les deux valeurs viennent du `define` esbuild, ce projet n'ayant aucun `environment.ts` : Angular compile avec esbuild, pas Vite
- Générer les source maps en mode `hidden`, les uploader vers Sentry puis **les supprimer de `dist/`** : `tauri-codegen` embarque tout fichier de `frontendDist` sans filtre d'extension. Les trois gestes vivent dans les scripts npm, enchaînés par `pnpm build` : `tauri build` appelle lui-même `beforeBuildCommand`, et un `pnpm build` lancé à la main doit rendre le même `dist/` livrable
- Réserver Sentry aux erreurs techniques : le quota de 5 000 événements par mois est un budget, pas un plafond théorique

## À éviter
- Garder `Breadcrumbs` : elle capture les interactions et le contenu de la console, donc les noms de morceaux affichés à l'écran. `Replay` capture le DOM. `CultureContext` envoie la locale, le calendrier et le fuseau horaire, ce qui localise grossièrement l'utilisateur
- Livrer les source maps dans le bundle distribué : elles vont chez Sentry, pas chez l'utilisateur
- Envoyer des événements métier : le quota se remplit et le vrai crash est jeté

## Gotchas
- `sendDefaultPii` est déjà `false` par défaut côté JavaScript, contrairement à Python où le défaut documenté est `None`
- Sans `release` identique des deux côtés, une erreur de webview et une erreur de sidecar ne se croisent sur aucune livraison : le diagnostic à distance devient une devinette
- `@angular/build` injecte des Debug IDs ECMA-426 dès que les source maps de scripts sont actives : c'est par eux que Sentry résout, pas par le chemin ni par un `sourceMappingURL`. Supprimer les `.map` après l'upload ne lui enlève donc rien
- La `peerDependency` couvre `@angular/core >= 14.x <= 22.x`
- Le seul canal qui fait sortir des titres de morceaux est le bouton « envoyer ce rapport » de l'écran final : il ouvre une issue pré-remplie dans le navigateur via le plugin `opener`, que l'utilisateur relit et peut abandonner. L'application ne pousse rien elle-même, et ce canal ne consomme pas le quota Sentry

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
