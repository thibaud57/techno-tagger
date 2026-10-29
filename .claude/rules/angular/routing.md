---
paths:
  - "src/app/app.routes.ts"
  - "src/app/**/*.routes.ts"
  - "src/app/app.config.ts"
  - "src/app/**/*.html"
---

# Angular : routing et lazy loading

## À faire
- Configurer le routing par `provideRouter(routes, ...)` dans `app.config.ts`
- Charger chaque feature par `loadComponent` ; déclarer dans son propre `*.routes.ts` (`loadChildren`), composé depuis `app.routes.ts`, les routes d'une feature qui en groupe plusieurs ; une feature à route unique reste une entrée `loadComponent` de `app.routes.ts`
- Activer `withComponentInputBinding()` et lire les paramètres par des `input()`, plutôt que par `ActivatedRoute`. Angular 22 lui ajoute `queryParams` et `unmatchedInputBehavior` (`'alwaysUndefined'` par défaut)
- Écrire les guards en fonctions (`CanActivateFn`, `CanDeactivateFn`, `CanMatchFn`) avec `inject()`
- Retourner un `UrlTree` ou un `RedirectCommand` depuis un guard, plutôt que d'y naviguer soi-même. Depuis 22.2, un helper imbriqué peut aussi lever `throw new RedirectCommand(...)`, qui étend `Error`
- Lire l'état de navigation par le signal `router.currentNavigation()` et l'activité d'une URL par la fonction autonome `isActive(url, router, matchOptions?)` qui rend un `Signal<boolean>`
- Placer la route wildcard `**` en dernier
- Différer avec `@defer` les blocs lourds absents du premier rendu, avec un `@placeholder` s'ils occupent une place dans le layout
- Différer toute modale du shell : `@defer (when <visible>; prefetch on idle)`, sinon elle part dans le bundle initial avec ses dépendances
- Combiner affichage et préchargement quand l'ouverture est déclenchée par l'utilisateur : `@defer (on interaction; prefetch on idle)`
- Utiliser `on idle(timeout)` (Angular 22) pour garantir le chargement même si le navigateur n'atteint jamais l'idle
- Extraire dans son propre fichier un composant destiné à être différé
- Contrôler le découpage réel avec `ng build --stats-json`, qui produit `browser-stats.json` depuis 22.2, à charger dans l'analyseur d'esbuild (esbuild.github.io/analyze)
- Faire porter la limite par les `budgets` d'`angular.json` plutôt que par une relecture manuelle

## À éviter
- `RouterModule.forRoot()` et `forChild()` : l'application est standalone
- Les guards et resolvers en classes, dépréciés depuis Angular 15.2
- `Router.isActive()`, déprécié au profit de la fonction `isActive()`
- `provideRoutes()`, supprimé en Angular 22
- `href` pour une navigation interne : la webview rechargerait toute l'application
- Importer un composant lazy dans les `imports` d'un composant eager : le lazy loading configuré dans les routes est annulé
- Différer du contenu visible au premier rendu, qui provoque un saut de layout
- Imbriquer des `@defer` avec les mêmes triggers : cascade de chargements
- `webpack-bundle-analyzer` : le CLI compile avec esbuild depuis la v17

## Gotchas
- Angular 22 : `paramsInheritanceStrategy` vaut `'always'` par défaut (avant `'emptyOnly'`), les paramètres du parent sont visibles depuis l'enfant sans configuration
- Angular 22 : le troisième paramètre `currentSnapshot: PartialMatchRouteSnapshot` de `CanMatchFn`, déjà passé au runtime, devient obligatoire dans le typage. Seules les classes `CanMatch` sont à réécrire (migration `ng update` fournie) et ce snapshot n'a ni parents, ni enfants, ni données résolues
- `CanMatchFn` empêche le chargement du chunk quand la route ne matche pas, contrairement à `CanActivateFn`
- Par défaut `onSameUrlNavigation: 'ignore'` : naviguer vers l'URL courante émet `NavigationSkipped` sans rejouer guards ni resolvers
- `@defer (when condition)` est one-time et irréversible : repasser la condition à `false` ne décharge pas le bundle
- `PreloadAllModules` ignore les routes protégées par un guard `canMatch` ou `canLoad`
- Un service `providedIn: 'root'` référencé uniquement depuis des routes lazy part dans leur chunk, pas dans le bundle initial
- Un service déclaré dans le `providers` d'une route lazy est instancié par l'`EnvironmentInjector` de cette route, donc dupliqué par feature
- Angular 19 : passer un `UrlTree` à `routerLink` avec `queryParams` ou `fragment` lève une erreur, les options doivent être portées par le `UrlTree`

## Exemples
```typescript
// ✅ Guard fonctionnel qui redirige par UrlTree
export const runInProgressGuard: CanDeactivateFn<TaggingPageComponent> = (page) =>
  page.canLeave() || inject(Router).createUrlTree(['/tagging']);

// ❌ Guard en classe, navigation impérative dans le guard
@Injectable({ providedIn: 'root' })
export class RunInProgressGuard implements CanDeactivate<TaggingPageComponent> {
  canDeactivate(page: TaggingPageComponent): boolean {
    if (!page.canLeave()) { this.router.navigate(['/tagging']); return false; }
    return true;
  }
}
```

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
