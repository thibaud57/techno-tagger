---
paths:
  - "src/app/**/*.ts"
  - "src/app/**/*.html"
---

# Angular Change Detection — Règles

## À faire
- Omettre `changeDetection` dans `@Component` : `OnPush` est le défaut Angular 22
- Faire porter toute réactivité par des signals : l'application est zoneless, zone.js n'est pas installé
- Binder une propriété ou un `computed()` dans un template, jamais un appel de méthode
- Appeler `markForCheck()` après une mise à jour venant d'un callback hors signal, par exemple un handler `command.stdout.on('data')` qui écrit dans une propriété simple
- Utiliser le pipe `async` quand un Observable est affiché directement, il souscrit, se désabonne et déclenche la détection

## À éviter
- `ChangeDetectionStrategy.Default` : déprécié depuis Angular 21.1, simple alias de `Eager`
- Déclarer `ChangeDetectionStrategy.Eager` pour contourner un problème de réactivité : mettre la valeur dans un signal
- `NgZone`, `runOutsideAngular()` et `run()` : sans zone.js, ces APIs n'ont plus d'objet
- `detectChanges()` depuis un hook de cycle de vie : il est synchrone et provoque des cycles imbriqués, préférer `markForCheck()`
- Modifier une valeur bindée dans `ngAfterViewInit`

## Gotchas
- Angular 22 : `OnPush` devient le défaut pour tout composant sans `changeDetection` explicite ; `ng update` pose `Eager` sur les composants existants, ce qui ne concerne pas un projet neuf
- En zoneless, `setTimeout(0)` ne déclenche plus de cycle : le contournement classique de `ExpressionChangedAfterItHasBeenCheckedError` doit être suivi d'un `markForCheck()`
- Une librairie tierce qui pilote `NgZone` directement se comporte mal en zoneless : vérifier avant d'en introduire une
- `provideBrowserGlobalErrorListeners()` est requis pour ne pas perdre le tracking d'erreurs, zone.js ne captant plus les rejets non gérés (cf. `app-config.md`)

## Exemples
```typescript
// ✅ Rien à déclarer, la réactivité vient du signal
@Component({
  selector: 'app-run-summary',
  template: `<p>{{ pendingCount() }}</p>`
})
export class RunSummary {
  protected readonly pendingCount = computed(() => this.store.tracks().length);
}

// ❌ Eager pour compenser une propriété mutable, et méthode appelée depuis le template
@Component({
  template: `<p>{{ countPending() }}</p>`,
  changeDetection: ChangeDetectionStrategy.Eager
})
export class RunSummary {
  countPending(): number { ... }
}
```
