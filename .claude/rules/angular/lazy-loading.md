---
paths:
  - "src/app/**/*.routes.ts"
  - "src/app/**/*.html"
---

# Angular Lazy Loading & Code Splitting — Règles

## À faire
- Charger chaque feature par `loadComponent`, et grouper un ensemble de routes liées par `loadChildren` vers son `*.routes.ts`
- Différer avec `@defer` les blocs lourds absents du premier rendu, avec un `@placeholder` s'ils occupent une place dans le layout
- Différer toute modale du shell : `@defer (when <visible>; prefetch on idle)`, sinon elle part dans le bundle initial avec ses dépendances
- Combiner affichage et préchargement quand l'ouverture est déclenchée par l'utilisateur : `@defer (on interaction; prefetch on idle)`
- Utiliser `on idle(timeout)` (Angular 22) pour garantir le chargement même si le navigateur n'atteint jamais l'idle
- Extraire dans son propre fichier un composant destiné à être différé
- Contrôler le découpage réel avec `ng build --stats-json`, qui produit `browser-stats.json` depuis 22.2, à charger dans l'analyseur d'esbuild (esbuild.github.io/analyze)
- Faire porter la limite par les `budgets` d'`angular.json` plutôt que par une relecture manuelle

## À éviter
- Importer un composant lazy dans les `imports` d'un composant eager : le lazy loading configuré dans les routes est annulé
- Différer du contenu visible au premier rendu, qui provoque un saut de layout
- Imbriquer des `@defer` avec les mêmes triggers : cascade de chargements
- `webpack-bundle-analyzer` : le CLI compile avec esbuild depuis la v17

## Gotchas
- `@defer (when condition)` est one-time et irréversible : repasser la condition à `false` ne décharge pas le bundle
- `PreloadAllModules` ignore les routes protégées par un guard `canMatch` ou `canLoad`
- Un service `providedIn: 'root'` référencé uniquement depuis des routes lazy part dans leur chunk, pas dans le bundle initial
- Un service déclaré dans le `providers` d'une route lazy est instancié par l'`EnvironmentInjector` de cette route, donc dupliqué par feature

## Exemples
```typescript
// ✅ Route lazy, une feature par chunk
export const routes: Routes = [
  { path: 'settings', loadComponent: () => import('./features/settings/settings-page.component') },
];

// ❌ Le composant est aussi importé par un composant eager : le chunk repart dans le bundle initial
@Component({ imports: [SettingsPageComponent] })
export class AppComponent {}
```

```html
<!-- ✅ Bloc lourd différé, placeholder fourni -->
@defer (on viewport; prefetch on idle) {
  <app-run-summary />
} @placeholder {
  <p-skeleton height="2rem" />
}
```
