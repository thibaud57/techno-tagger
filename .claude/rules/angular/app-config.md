---
paths:
  - "src/app/app.config.ts"
  - "src/main.ts"
  - "angular.json"
---

# Angular CLI & Bootstrap — Règles

## À faire
- Garder `app.config.ts` minimal : router, PrimeNG, ngx-translate, Sentry et les `provideAppInitializer()` du bootstrap (langue, sidecar)
- Ajouter `provideBrowserGlobalErrorListeners()` : sans zone.js, les rejets non gérés ne sont plus capturés
- Configurer PrimeNG avec le preset du projet (`definePreset()` sur Aura, dans `core/theme.ts`), `darkModeSelector` et `cssLayer` de DESIGN.md. Un écart global va dans le preset, un écart d'instance dans un `[dt]`
- Déclarer la configuration applicative par un `InjectionToken` avec factory, plutôt que par un objet importé
- Régler `budgets`, `fileReplacements` et `outputHashing` par configuration dans `angular.json`
- Poser dans le `define` d'`angular.json` un repli inerte pour chaque constante de build : sans lui, `ng build` ou `ng test` hors script npm lève un `ReferenceError` au bootstrap. Jamais de secret dans ce JSON
- Pointer `frontendDist` de `tauri.conf.json` sur `dist/<app>/browser`
- Monter de version par `ng update @angular/core@<v> @angular/cli@<v>`, qui applique les migrations

## À éviter
- `provideZonelessChangeDetection()` et `provideHttpClient()` : activés par défaut en Angular 22
- `provideZoneChangeDetection()` et la réintroduction de zone.js dans les polyfills
- `withFetch()`, déprécié en Angular 22 : `fetch` est le backend par défaut
- Un fichier de styles global en `.scss` : Tailwind v4 ne compile ni SCSS ni LESS
- Toute ressource servie par CDN, polices comprises : l'application doit s'afficher à l'identique hors ligne
- `import.meta.env` : le CLI compile avec esbuild, pas Vite

## Gotchas
- Angular 22.1 : chaque bundle reçoit un `//# debugId=<uuid>` dès que les source maps de scripts sont émises, c'est par lui que Sentry relie un bundle à sa map
- Angular 22.1 : dans un git worktree, un chemin de cache relatif se résout depuis la racine du dépôt principal, donc `.angular/cache` est partagé entre worktrees
- Angular 22 exige Node `^22.22.3 || ^24.15.0 || >=26.0.0` et TypeScript `>=6.0.0 <6.1.0` : TypeScript 7 casse `@angular/compiler-cli` et `typescript-eslint`
- Les suffixes de fichiers générés, supprimés en Angular 20, sont restaurés par le bloc `schematics` d'`angular.json` : `ng g c user` produit `user.component.ts` et `UserComponent`
- `devEngines.packageManager`, écrit par `pnpm init`, déclenche un lockfile multi-document qui casse le graphe de dépendances GitHub : le retirer de `package.json`

## Exemples
```typescript
// ✅ Angular 22 : les défauts suffisent
export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withComponentInputBinding()),
    provideBrowserGlobalErrorListeners(),
    providePrimeNG({ theme: { preset: TECHNO_TAGGER_PRESET, options: { darkModeSelector: '.app-dark' } } }),
  ],
};

// ❌ Redéclare des défauts et réintroduit zone.js
providers: [
  provideZoneChangeDetection({ eventCoalescing: true }),
  provideHttpClient(withFetch()),
]
```
