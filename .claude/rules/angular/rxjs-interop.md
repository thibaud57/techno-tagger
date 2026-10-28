---
paths:
  - "src/app/**/*.ts"
---

# Angular : RxJS et interop signals

## À faire
- Garder RxJS pour ce qui est un flux dans le temps (événements NDJSON du sidecar, événements de navigation) et exposer le résultat en signals pour les composants
- Interposer un `Subject` entre la source et les signals seulement si un opérateur s'applique au flux (filtre, projection, annulation, retry) ; sinon écrire dans les signals depuis le handler
- Injecter le transport par un jeton plutôt qu'appeler le plugin Tauri en direct : le service reste testable hors Tauri. Tauri découpe déjà `stdout` en lignes
- Convertir avec `toSignal()` pour l'affichage et `toObservable()` pour appliquer des opérateurs à un signal
- Fournir un `initialValue` à `toSignal()` ; ne passer `requireSync: true` que sur une source qui émet à la souscription (`BehaviorSubject`, `of()`)
- Se désabonner par `takeUntilDestroyed()` sur toute souscription manuelle- Traiter les erreurs par `retry({ count, delay })` puis `catchError`, avec un backoff quand la source est réseau

## À éviter
- Le couple `destroy$ = new Subject<void>()` + `ngOnDestroy`, remplacé par `takeUntilDestroyed()`
- `firstValueFrom()` sur le flux du sidecar, qui ne complète jamais
- Les souscriptions imbriquées, à remplacer par un opérateur de projection
## Gotchas
- `toSignal()` et `toObservable()` exigent un injection context (champ de classe ou constructeur), sinon passer l'option `injector`- Angular 22 accepte RxJS `^6.5.3 || ^7.4.0` : rester sur la ligne 7

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
