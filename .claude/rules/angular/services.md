---
paths:
  - "src/app/core/**/*.ts"
  - "src/app/features/**/*.ts"
---

# Angular Services — Règles

## À faire
- Déclarer tout service avec `@Injectable({ providedIn: 'root' })`, ou son alias court `@Service()` (Angular 22)
- Exposer l'état en lecture seule (`asReadonly()`, `computed()`) et le muter uniquement par des méthodes du service
- Injecter avec `inject()` en champ `private readonly`
- Un service d'état par feature, alimenté par le flux d'événements du sidecar ; `SidecarService` détient l'état du run et la file d'arbitrage
- Garder dans `core/models/` les types miroir du contrat NDJSON, maintenus à la main faute de package partagé avec le sidecar
- Réserver `providers` sur un composant aux cas où l'état doit être isolé et réinitialisé avec lui
- Utiliser `injectAsync(() => import('./x.service'), { prefetch: 'onIdle' })` pour un service lourd chargé à la demande

## À éviter
- Toute logique métier dans un service Angular : lecture et écriture des tags, scoring, appels à techno-scraper et plan de run vivent dans le sidecar Python
- `providedIn: 'platform'` et `providedIn: Module`, obsolètes avec les composants standalone
- `firstValueFrom()` sur le flux d'événements du sidecar : il ne complète jamais
- Instancier un service avec `new` en dehors des tests

## Gotchas
- `@Service()` est strictement équivalent à `@Injectable({ providedIn: 'root' })`, pas un décorateur avec une portée différente
- Un service fourni par le `providers` d'une route lazy reçoit une instance par `EnvironmentInjector` : ce n'est plus un singleton applicatif
- Un service fourni au niveau composant est détruit avec lui, son état est perdu au rechargement de la route

## Exemples
```typescript
// ✅ État privé, API de lecture figée, mutations par méthodes
@Service()
export class RunService {
  private readonly _queue = signal<Arbitration[]>([]);

  readonly queue = this._queue.asReadonly();
  readonly hasPending = computed(() => this._queue().length > 0);

  enqueue(item: Arbitration): void {
    this._queue.update(q => [...q, item]);
  }
}

// ❌ Signal writable exposé : n'importe quel composant peut écrire l'état du run
@Injectable({ providedIn: 'root' })
export class RunService {
  readonly queue = signal<Arbitration[]>([]);
}
```
