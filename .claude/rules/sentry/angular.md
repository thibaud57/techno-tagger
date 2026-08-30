---
paths:
  - "src/main.ts"
  - "src/app/app.config.ts"
---

# Sentry — SDK Angular

## À faire
- Initialiser dans `main.ts` **avant** `bootstrapApplication()`
- Retirer les intégrations `Breadcrumbs` et `Replay` du jeu par défaut plutôt que d'essayer de les filtrer après coup
- Enregistrer le gestionnaire d'erreurs par `Sentry.provideErrorHandler()`, forme standalone
- Poser la même `release` que côté sidecar, et renseigner `environment`
- Générer les source maps en mode `hidden` et les uploader vers Sentry
- Réserver Sentry aux erreurs techniques : le quota de 5 000 événements par mois est un budget, pas un plafond théorique

## À éviter
- Garder `Breadcrumbs` : elle capture les interactions et le contenu de la console, donc les noms de morceaux affichés à l'écran. `Replay` capture le DOM
- `createErrorHandler()` : elle visait le style NgModule et se tree-shake moins bien
- Livrer les source maps dans le bundle distribué : elles vont chez Sentry, pas chez l'utilisateur
- Envoyer des événements métier : le quota se remplit et le vrai crash est jeté

## Gotchas
- `sendDefaultPii` est déjà `false` par défaut côté JavaScript, contrairement à Python où le défaut documenté est `None`
- Sans `release` identique des deux côtés, une erreur de webview et une erreur de sidecar ne se croisent sur aucune livraison : le diagnostic à distance devient une devinette
- La `peerDependency` couvre `@angular/core >= 14.x <= 22.x`
- Le seul canal qui fait sortir des titres de morceaux est le bouton « envoyer ce rapport » de l'écran final : il ouvre une issue pré-remplie dans le navigateur via le plugin `opener`, que l'utilisateur relit et peut abandonner. L'application ne pousse rien elle-même, et ce canal ne consomme pas le quota Sentry

## Exemples
```typescript
// ✅ main.ts, avant le bootstrap, intégrations capteuses retirées
Sentry.init({
  dsn: environment.sentryDsn,
  release: environment.appVersion,      // identique au sidecar
  environment: 'production',
  integrations: (defaults) =>
    defaults.filter((i) => i.name !== 'Breadcrumbs' && i.name !== 'Replay'),
});

bootstrapApplication(AppComponent, appConfig);

// ✅ app.config.ts
providers: [Sentry.provideErrorHandler({ showDialog: false, logErrors: true })]
```
