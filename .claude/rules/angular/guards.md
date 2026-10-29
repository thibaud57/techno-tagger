---
paths:
  - "src/app/app.routes.ts"
  - "src/app/**/*.routes.ts"
  - "src/app/**/*guard*.ts"
---

# Angular : guards de route

## À faire
- Écrire les guards en fonctions (`CanActivateFn`, `CanDeactivateFn`, `CanMatchFn`) avec `inject()`
- Retourner un `UrlTree` ou un `RedirectCommand` depuis un guard, plutôt que d'y naviguer soi-même. Depuis 22.2, un helper imbriqué peut aussi lever `throw new RedirectCommand(...)`, qui étend `Error`

## À éviter
- Les guards et resolvers en classes, dépréciés depuis Angular 15.2

## Gotchas
- Angular 22 : le troisième paramètre `currentSnapshot: PartialMatchRouteSnapshot` de `CanMatchFn`, déjà passé au runtime, devient obligatoire dans le typage. Seules les classes `CanMatch` sont à réécrire (migration `ng update` fournie) et ce snapshot n'a ni parents, ni enfants, ni données résolues
- `CanMatchFn` empêche le chargement du chunk quand la route ne matche pas, contrairement à `CanActivateFn`

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
