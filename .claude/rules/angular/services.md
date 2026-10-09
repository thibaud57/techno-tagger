---
paths:
  - "src/app/core/**/*.ts"
  - "src/app/features/**/*.ts"
---

# Angular Services — Règles

## À faire
- Déclarer tout service avec `@Service()` (Angular 22), et `@Service({ autoProvided: false })` pour un service fourni explicitement par un `providers`
- Exposer l'état en lecture seule (`asReadonly()`, `computed()`) et le muter uniquement par des méthodes du service
- Injecter avec `inject()` en champ `private readonly`
- Créer un store par phase pour l'état que le sidecar envoie, sans jamais l'injecter dans un composant : le service qui route les événements ré-expose ses signaux en lecture seule, le contrat NDJSON reste sa seule source
- Injecter directement dans les composants un service d'état propre à l'interface (saisie en cours, modale ouverte, demande de sortie) : il ne tient rien du sidecar et n'a pas à passer par son routage
- Garder dans `core/models/` les types miroir du contrat NDJSON, maintenus à la main faute de package partagé avec le sidecar
- Réserver `providers` sur un composant aux cas où l'état doit être isolé et réinitialisé avec lui
- Charger un service lourd à la demande par `injectAsync()` en initialiseur de champ : il rend une fonction `() => Promise<T>`, le chunk n'est téléchargé qu'à son premier appel, et le service doit être auto-provided

## À éviter
- Toute logique métier dans un service Angular : lecture et écriture des tags, scoring, appels à techno-scraper et plan de run vivent dans le sidecar Python
- `providedIn: 'platform'` et `providedIn: Module`, obsolètes avec les composants standalone
- `firstValueFrom()` sur le flux d'événements du sidecar : il ne complète jamais
- Instancier un service avec `new` en dehors des tests

## Gotchas
- `@Service()` est strictement équivalent à `@Injectable({ providedIn: 'root' })`, pas un décorateur avec une portée différente. `ng generate @angular/core:service` migre l'un vers l'autre
- `injectAsync` : le loader veut `.then(m => m.X)` pour un export nommé, et l'option `prefetch` prend une fonction trigger (`onIdle`), jamais la string `'onIdle'`
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
@Service()
export class RunService {
  readonly queue = signal<Arbitration[]>([]);
}

// ✅ Service lourd chargé au premier appel, préchargé à l'idle
private readonly editor = injectAsync(
  () => import('./editor.service').then(m => m.EditorService),
  { prefetch: onIdle },
);
```
