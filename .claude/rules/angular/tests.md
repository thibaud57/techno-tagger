---
paths:
  - "src/app/**/*.spec.ts"
---

# Angular Tests unitaires — Règles

## À faire
- Écrire les tests pour Vitest, runner par défaut du builder `@angular/build:unit-test`
- Vérifier une règle métier du projet : le plumbing du framework ou d'une librairie ne mérite pas de test
- Déclarer le composant testé dans `imports` de `TestBed.configureTestingModule()`
- Alimenter un signal input par `fixture.componentRef.setInput(name, value)`
- Tester un `effect()` dans `TestBed.runInInjectionContext()` puis forcer son exécution avec `TestBed.flushEffects()`
- Mocker avec `vi.fn()` et `vi.spyOn()`, et contrôler le temps par `vi.useFakeTimers()` / `vi.advanceTimersByTime()`
- Récupérer la valeur d'un `output()` par `firstValueFrom()`
- Assertions DOM : `not.toBeNull()` ou `toBeTruthy()`
- Appeler `fixture.detectChanges()` dans le `it()` quand des blocs `@if` conditionnent l'élément cherché
- Mocker le protocole NDJSON au niveau du service qui l'expose, pas les plugins Tauri sous-jacents

## À éviter
- `toBeDefined()` sur un élément du DOM : vrai même quand la requête retourne `null`
- `fakeAsync`, `tick` et `flush` : ils exigent zone.js et le patch `zone.js/plugins/vitest-patch`, absents d'un projet zoneless
- `compileComponents()`, inutile pour un composant standalone
- Jasmine et Karma : Jest est supprimé du CLI en 22 et Karma est remplacé par Vitest
- `vi.advanceTimersByTime()` pour tester `debounceTime()` ou `delay()` : ces opérateurs passent par l'`asyncScheduler` RxJS, utiliser `TestScheduler` de `rxjs/testing`

## Gotchas
- `vi.resetAllMocks()` réinitialise appels et retours mais ne restaure pas l'implémentation d'origine, contrairement à `vi.restoreAllMocks()` qui n'agit que sur les spies
- `describe`, `it`, `expect` et `beforeEach` sont des globals ; seul `vi` s'importe
- Angular 22 : `TestBed.getLastFixture()` récupère le dernier fixture créé sans en garder la référence
- `jsdom` est l'environnement par défaut, `happy-dom` est détecté automatiquement s'il est installé
- L'option `providersFile` centralise les providers communs à tous les tests
- La limitation « configuration Vitest personnalisée non supportée », documentée pour Angular 20, n'a pas été reconfirmée en 22 : à vérifier si les tests du flux NDJSON demandent une configuration particulière

## Exemples
```typescript
// ✅
it('marque le morceau comme arbitré', () => {
  fixture.componentRef.setInput('track', aTrack({ pending: true }));
  fixture.detectChanges();

  fixture.nativeElement.querySelector('[data-testid=accept]').click();

  expect(fixture.debugElement.query(By.css('.arbitrated'))).not.toBeNull();
});

// ❌ Assertion trompeuse et timers zone-based
expect(fixture.debugElement.query(By.css('.arbitrated'))).toBeDefined();
it('...', fakeAsync(() => { tick(1000); }));
```
