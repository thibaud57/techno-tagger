---
paths:
  - "src/app/app.routes.ts"
  - "src/app/**/*.routes.ts"
  - "src/app/app.config.ts"
---

# Angular Routing — Règles

## À faire
- Configurer le routing par `provideRouter(routes, ...)` dans `app.config.ts`
- Déclarer les routes d'une feature dans son propre `*.routes.ts` et les composer depuis `app.routes.ts`
- Activer `withComponentInputBinding()` et lire les paramètres par des `input()`, plutôt que par `ActivatedRoute`. Angular 22 lui ajoute `queryParams` et `unmatchedInputBehavior` (`'alwaysUndefined'` par défaut)
- Écrire les guards en fonctions (`CanActivateFn`, `CanDeactivateFn`, `CanMatchFn`) avec `inject()`
- Retourner un `UrlTree` ou un `RedirectCommand` depuis un guard, plutôt que d'y naviguer soi-même. Depuis 22.2, un helper imbriqué peut aussi lever `throw new RedirectCommand(...)`, qui étend `Error`
- Dériver l'onglet actif de `p-tabs` depuis l'URL et déclencher la navigation au changement de valeur : PrimeNG 22 ne fournit aucun mode router et `p-tabMenu` a été supprimé
- Lire l'état de navigation par le signal `router.currentNavigation()`, et l'activité d'une URL par la fonction autonome `isActive(url, router, matchOptions?)` qui rend un `Signal<boolean>`
- Placer la route wildcard `**` en dernier

## À éviter
- `RouterModule.forRoot()` et `forChild()` : l'application est standalone
- Les guards et resolvers en classes, dépréciés depuis Angular 15.2
- `Router.isActive()`, déprécié au profit de la fonction `isActive()`
- `provideRoutes()`, supprimé en Angular 22
- `href` pour une navigation interne : la webview rechargerait toute l'application
- Souscrire à `router.events` sans `takeUntilDestroyed()`

## Gotchas
- Angular 22 : `paramsInheritanceStrategy` vaut `'always'` par défaut (avant `'emptyOnly'`), les paramètres du parent sont visibles depuis l'enfant sans configuration
- Angular 22 : le troisième paramètre `currentSnapshot: PartialMatchRouteSnapshot` de `CanMatchFn`, déjà passé au runtime, devient obligatoire dans le typage. Seules les classes `CanMatch` sont à réécrire (migration `ng update` fournie), et ce snapshot n'a ni parents, ni enfants, ni données résolues
- `CanMatchFn` empêche le chargement du chunk quand la route ne matche pas, contrairement à `CanActivateFn`
- Par défaut `onSameUrlNavigation: 'ignore'` : naviguer vers l'URL courante émet `NavigationSkipped` sans rejouer guards ni resolvers
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
