---
paths:
  - "src/app/core/**/*.ts"
---

# RxJS & Interop Signals — Règles

## À faire
- Garder RxJS pour ce qui est un flux dans le temps (événements NDJSON du sidecar, événements de navigation) et exposer le résultat en signals pour les composants
- Interposer un `Subject` entre la source d'événements et les signals dès qu'un opérateur s'applique au flux : filtrage, projection, fenêtrage, annulation, retry. Sans opérateur, écrire directement dans les signals depuis le handler est plus court et se lit mieux, et un `Subject` qui ne fait que réalimenter le même `switch` n'apporte rien
- Vérifier la surface exacte du transport avant de coder contre elle : le découpage des lignes de `stdout` est déjà fait par Tauri, et un service testable hors Tauri reçoit son transport par un jeton d'injection plutôt que d'appeler l'API du plugin en direct
- Convertir avec `toSignal()` pour l'affichage et `toObservable()` pour appliquer des opérateurs à un signal
- Fournir un `initialValue` à `toSignal()` ; ne passer `requireSync: true` que sur une source qui émet à la souscription (`BehaviorSubject`, `of()`)
- Se désabonner par `takeUntilDestroyed()` sur toute souscription manuelle
- Choisir l'opérateur de projection selon l'intention : `switchMap` pour annuler l'opération remplacée, `concatMap` pour sérialiser, `exhaustMap` pour ignorer un double déclenchement
- Traiter les erreurs par `retry({ count, delay })` puis `catchError`, avec un backoff quand la source est réseau

## À éviter
- Le couple `destroy$ = new Subject<void>()` + `ngOnDestroy`, remplacé par `takeUntilDestroyed()`
- `retryWhen()`, déprécié depuis RxJS 7
- `mergeMap` quand l'ordre des réponses compte : elles arrivent dans l'ordre du réseau, pas des émissions
- `firstValueFrom()` sur le flux du sidecar, qui ne complète jamais
- Les souscriptions imbriquées, à remplacer par un opérateur de projection
- Exposer un Observable brut au template sans `async` ni `toSignal()`

## Gotchas
- `toSignal()` et `toObservable()` exigent un injection context (champ de classe ou constructeur), sinon passer l'option `injector`
- `combineLatest` reste silencieux tant que chacune de ses sources n'a pas émis au moins une valeur
- Sans `shareReplay(1)`, un cold observable rejoue son travail à chaque souscription
- Angular 22 accepte RxJS `^6.5.3 || ^7.4.0` : rester sur la ligne 7

## Exemples
```typescript
// ✅ Un opérateur s'applique au flux : Subject en interne, signals en surface
private readonly events$ = new Subject<SidecarEvent>();

readonly progress = toSignal(
  this.events$.pipe(filter(isProgress), map(e => e.percent)),
  { initialValue: 0 },
);

// ✅ Aucun opérateur : le handler écrit dans les signals, sans couche intermédiaire
#handleEvent(event: SidecarEvent): void {
  switch (event.event) {
    case 'progress': this.#progress.set(event); break;
    // ...
  }
}

// ❌ Souscription manuelle non nettoyée, état hors signal
constructor() {
  this.events$.subscribe(e => { this.lastEvent = e; });
}
```
