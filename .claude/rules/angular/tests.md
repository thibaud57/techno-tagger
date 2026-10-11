---
paths:
  - "src/app/**/*.spec.ts"
  - "src/fixtures/**/*.ts"
---

# Angular Tests unitaires — Règles

## À faire
- Écrire les tests pour Vitest, runner par défaut du builder `@angular/build:unit-test`
- Vérifier une règle métier du projet : le plumbing du framework ou d'une librairie ne mérite pas de test
- Nommer `describe` et `it` en anglais, comme les tests du sidecar ; les commentaires restent en français
- Déclarer le composant testé dans `imports` de `TestBed.configureTestingModule()`
- Alimenter un signal input par `fixture.componentRef.setInput(name, value)`
- Tester un `effect()` dans `TestBed.runInInjectionContext()`, ou via le service qui le crée, puis forcer son exécution avec `TestBed.tick()` : `flushEffects()` est déprécié en Angular 22
- Mocker avec `vi.fn()` et `vi.spyOn()`, et contrôler le temps par `vi.useFakeTimers()` / `vi.advanceTimersByTime()`
- Écouter un `output()` par `subscribe(vi.fn())` : `firstValueFrom()` exige `outputToObservable()` et ne prouve pas qu'il n'a rien émis
- Assertions DOM : `not.toBeNull()` ou `toBeTruthy()`
- Appeler `fixture.detectChanges()` dans le `it()` quand des blocs `@if` conditionnent l'élément cherché
- Mocker le protocole NDJSON au niveau du service qui l'expose, pas les plugins Tauri sous-jacents
- Chercher dans `src/fixtures/` le stub, le jeu d'événements ou le helper DOM avant d'en écrire un. Dès qu'une deuxième spec en a besoin, il y rejoint les autres ; à usage unique, il reste dans sa spec

## À éviter
- `toBeDefined()` sur un élément du DOM : vrai même quand la requête retourne `null`
- `fakeAsync`, `tick` et `flush` : ils exigent zone.js et le patch `zone.js/plugins/vitest-patch`, absents d'un projet zoneless
- `compileComponents()`, inutile pour un composant standalone
- Jasmine et Karma : Jest est supprimé du CLI en 22 et Karma est remplacé par Vitest
- `vi.advanceTimersByTime()` pour tester `debounceTime()` ou `delay()` : ces opérateurs passent par l'`asyncScheduler` RxJS, utiliser `TestScheduler` de `rxjs/testing`

## Gotchas
- Vitest 5 : `clearMocks` vaut `true` par défaut (`vi.clearAllMocks()` avant chaque test), et une assertion async non attendue (`resolves`, `rejects`) fait échouer le test au lieu d'un warning
- Vitest 5 : `vi.mock`, `vi.unmock` et `vi.hoisted` hors du top level lèvent une erreur, et `toThrow('texte')` matche une sous-chaîne, donc `toThrow('')` passe sur toute erreur
- Angular 22.2 : l'option `splitting` du builder `unit-test` est dépréciée, inutile avec Vitest 5. Ne pas la poser
- `vi.resetAllMocks()` réinitialise appels et retours mais ne restaure pas l'implémentation d'origine, contrairement à `vi.restoreAllMocks()` qui n'agit que sur les spies
- `describe`, `it`, `expect` et `beforeEach` sont des globals ; seul `vi` s'importe
- Angular 22 : `TestBed.getLastFixture()` récupère le dernier fixture créé sans en garder la référence
- `jsdom` est l'environnement par défaut, `happy-dom` est détecté automatiquement s'il est installé
- L'option `providersFile` centralise les providers communs à tous les tests
- `src/fixtures/` est exclu de `tsconfig.app.json` et déclaré dans `tsconfig.spec.json` : un dossier de helpers de test absent des deux n'est rattaché à aucun projet et ESLint échoue à le parser
- La limitation « configuration Vitest personnalisée non supportée », documentée pour Angular 20, n'a pas été reconfirmée en 22 : à vérifier si les tests du flux NDJSON demandent une configuration particulière

## Exemples
```typescript
// ✅
it('marks the track as arbitrated', () => {
  fixture.componentRef.setInput('track', aTrack({ pending: true }));
  fixture.detectChanges();

  fixture.nativeElement.querySelector('[data-testid=accept]').click();

  expect(fixture.debugElement.query(By.css('.arbitrated'))).not.toBeNull();
});

// ❌ Assertion trompeuse et timers zone-based
expect(fixture.debugElement.query(By.css('.arbitrated'))).toBeDefined();
it('...', fakeAsync(() => { tick(1000); }));
```
