---
paths:
  - "src/app/app.config.ts"
  - "src/main.ts"
  - "angular.json"
---

# Angular CLI & Bootstrap — Règles

## À faire
- Garder `app.config.ts` minimal : `provideRouter(routes)`, `providePrimeNG(...)`, les providers ngx-translate et Sentry, rien de plus
- Ajouter `provideBrowserGlobalErrorListeners()` : sans zone.js, les rejets non gérés ne sont plus capturés
- Configurer PrimeNG avec le preset `Aura` importé de `@primeuix/themes/aura`, `darkModeSelector: '.dark'` et `cssLayer: { name: 'primeng', order: 'theme, base, primeng' }` (valeurs exactes dans DESIGN.md)
- Déclarer la configuration applicative par un `InjectionToken` avec factory, plutôt que par un objet importé
- Régler `budgets`, `fileReplacements` et `outputHashing` par configuration dans `angular.json`
- Pointer `frontendDist` de `tauri.conf.json` sur `dist/<app>/browser`, la sortie de `ng build`
- Monter de version par `ng update @angular/core@<v> @angular/cli@<v>`, qui applique les migrations

## À éviter
- `provideZonelessChangeDetection()` et `provideHttpClient()` : activés par défaut en Angular 22
- `provideZoneChangeDetection()` et la réintroduction de zone.js dans les polyfills
- `withFetch()`, déprécié en Angular 22 puisque `fetch` est le backend par défaut ; `withXhr()` uniquement pour forcer XHR
- Un fichier de styles global en `.scss` : Tailwind v4 ne compile ni SCSS ni LESS
- Toute ressource servie par CDN, polices comprises : l'application doit s'afficher à l'identique hors ligne
- `import.meta.env` : le CLI compile avec esbuild, pas Vite

## Gotchas
- Angular 22 : `strictTemplates` est activé par défaut dans `tsconfig.json`
- Contraintes d'`engines` d'Angular 22 : Node `^22.22.3 || ^24.15.0 || ^26.0.0` et TypeScript `>=6.0.0 <6.1.0`. TypeScript 7 casse simultanément `@angular/compiler-cli` et `typescript-eslint`
- Angular 20 a supprimé les suffixes de fichiers générés : `ng g c user` produit `user.ts`, pas `user.component.ts`
- Retirer `devEngines.packageManager` de `package.json` : écrit par défaut par `pnpm init` en pnpm 11, il déclenche le lockfile multi-document qui casse le graphe de dépendances GitHub
- L'optimiseur de chunks tourne par défaut en Angular 22 ; `NG_BUILD_CHUNKS_ROLLDOWN=1` reste expérimental

## Exemples
```typescript
// ✅ Angular 22 : les défauts suffisent
export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withComponentInputBinding()),
    provideBrowserGlobalErrorListeners(),
    providePrimeNG({ theme: { preset: Aura, options: { darkModeSelector: '.dark' } } }),
  ],
};

// ❌ Redéclare des défauts et réintroduit zone.js
providers: [
  provideZoneChangeDetection({ eventCoalescing: true }),
  provideHttpClient(withFetch()),
]
```
