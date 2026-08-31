---
paths:
  - "src/app/core/**/*.ts"
---

# RxJS & Interop Signals — Règles

## À faire
- Garder RxJS pour ce qui est un flux dans le temps (événements NDJSON du sidecar, événements de navigation) et exposer le résultat en signals pour les composants
- Alimenter le flux du sidecar par un `Subject`, poussé depuis les handlers `command.stdout.on('data')` et `command.on('close')`, puis le projeter en signals dans le service
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
// ✅ Flux RxJS en interne, signals en surface
export class SidecarService {
  private readonly events$ = new Subject<SidecarEvent>();

  readonly lastEvent = toSignal(this.events$, { initialValue: null });

  readonly progress = toSignal(
    this.events$.pipe(filter(isProgress), map(e => e.percent)),
    { initialValue: 0 },
  );
}

// ❌ Souscription manuelle non nettoyée, état hors signal
constructor() {
  this.events$.subscribe(e => { this.lastEvent = e; });
}
```
