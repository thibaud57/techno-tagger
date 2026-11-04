---
paths:
  - "src/app/core/**/*.ts"
  - "src/app/features/**/*.ts"
---

# Angular : services

## À faire
- Déclarer tout service avec `@Service()` (Angular 22) et `@Service({ autoProvided: false })` pour un service fourni explicitement par un `providers`
- Exposer l'état en lecture seule (`asReadonly()`, `computed()`) et le muter uniquement par des méthodes du service
- Injecter avec `inject()` en champ `private readonly`, plugins Tauri compris : passer par `PreferencesService`, `NativeService` ou le jeton d'un adaptateur (`APP_WINDOW`, `APP_UPDATER`, `SIDECAR_TRANSPORT`), jamais par un appel direct au plugin hors de son adaptateur
- Créer un store par phase pour l'état que le sidecar envoie, sans jamais l'injecter dans un composant : le service qui route les événements ré-expose ses signaux en lecture seule, le contrat NDJSON reste sa seule source
- Injecter directement dans les composants un service d'état propre à l'interface (saisie en cours, modale ouverte, demande de sortie) : il ne tient rien du sidecar et n'a pas à passer par son routage
- Garder dans `core/sidecar/` les types miroir du contrat NDJSON (`protocol.ts`), maintenus à la main faute de package partagé avec le sidecar
- Réserver `providers` sur un composant aux cas où l'état doit être isolé et réinitialisé avec lui

## À éviter
- `providedIn: 'platform'` et `providedIn: Module`, obsolètes avec les composants standalone
- Instancier un service avec `new` en dehors des tests

## Gotchas
- `@Service()` est strictement équivalent à `@Injectable({ providedIn: 'root' })`, pas un décorateur avec une portée différente. `ng generate @angular/core:service` migre l'un vers l'autre
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
```
