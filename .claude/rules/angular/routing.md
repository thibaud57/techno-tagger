---
paths:
  - "src/app/app.routes.ts"
  - "src/app/**/*.routes.ts"
  - "src/app/app.config.ts"
  - "src/app/**/*.html"
---

# Angular : routing

## À faire
- Configurer le routing par `provideRouter(routes, ...)` dans `app.config.ts`
- Charger chaque feature par `loadComponent` ; déclarer dans son propre `*.routes.ts` (`loadChildren`), composé depuis `app.routes.ts`, les routes d'une feature qui en groupe plusieurs ; une feature à route unique reste une entrée `loadComponent` de `app.routes.ts`
- Activer `withComponentInputBinding()` et lire les paramètres par des `input()`, plutôt que par `ActivatedRoute`. Angular 22 lui ajoute `queryParams` et `unmatchedInputBehavior` (`'alwaysUndefined'` par défaut)
- Lire l'état de navigation par le signal `router.currentNavigation()` et l'activité d'une URL par la fonction autonome `isActive(url, router, matchOptions?)` qui rend un `Signal<boolean>`
- Placer la route wildcard `**` en dernier

## À éviter
- `RouterModule.forRoot()` et `forChild()` : l'application est standalone
- `Router.isActive()`, déprécié au profit de la fonction `isActive()`
- `provideRoutes()`, supprimé en Angular 22
- `href` pour une navigation interne : la webview rechargerait toute l'application

## Gotchas
- Angular 22 : `paramsInheritanceStrategy` vaut `'always'` par défaut (avant `'emptyOnly'`), les paramètres du parent sont visibles depuis l'enfant sans configuration
- Par défaut `onSameUrlNavigation: 'ignore'` : naviguer vers l'URL courante émet `NavigationSkipped` sans rejouer guards ni resolvers
- Angular 19 : passer un `UrlTree` à `routerLink` avec `queryParams` ou `fragment` lève une erreur, les options doivent être portées par le `UrlTree`
