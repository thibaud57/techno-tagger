---
paths:
  - "src/app/**/*.ts"
---

# Angular Signals — Règles

## À faire
- Utiliser `signal()` pour tout état local, de composant comme de service : c'est le seul mécanisme de state du projet, aucune librairie de store n'est installée
- Utiliser `computed()` pour toute valeur dérivée
- Utiliser `.update()` quand la nouvelle valeur dépend de l'ancienne, `.set()` pour un remplacement complet
- Créer un nouvel objet ou tableau dans `.set()` / `.update()` : retourner la même référence ne notifie aucun consommateur
- Utiliser `linkedSignal()` pour un état dérivé modifiable qui doit se réinitialiser quand sa source change (playlist sélectionnée, candidat retenu dans une file qui se réduit)
- Passer par la forme `{ source, computation }` de `linkedSignal()` quand la sélection courante doit survivre au changement de source
- Exposer les signals d'un service en lecture seule avec `.asReadonly()` et garder le `WritableSignal` privé
- Réserver `effect()` aux side-effects : persistance dans le `store` Tauri, DOM externe, log
- Créer un `effect()` dans un injection context (champ de classe ou constructeur), sinon lui passer l'option `injector`

## À éviter
- Muter un tableau ou un objet contenu dans un signal (`push()`, `splice()`, affectation de propriété) : rien n'est notifié
- Utiliser un `effect()` pour calculer une valeur dérivée, c'est le rôle de `computed()`
- Écrire dans un signal lu par le même `effect()` : boucle infinie, aucune protection depuis Angular 19
- `httpResource()` : la webview n'appelle aucune API, tout le réseau passe par le sidecar
- Utiliser `resource()` pour le flux d'événements du sidecar : il est continu et unidirectionnel, cf. `rxjs-interop.md`

## Gotchas
- Angular 22 : `resource()` et `httpResource()` passent stables, ils étaient expérimentaux jusqu'en 21
- Angular 22 : `debounced()` est expérimental et retourne une `Resource<T>`, pas un signal : les consommateurs doivent traiter l'état `loading` pendant la fenêtre de debounce
- Une erreur levée dans un `computed()` est mise en cache et relancée à la lecture suivante, après changement d'une dépendance
- L'option `allowSignalWrites` n'existe plus depuis Angular 19 : écrire dans un `effect()` est autorisé par défaut

## Exemples
```typescript
// ✅ État privé, lecture publique, dérivation par computed
export class RunService {
  private readonly _tracks = signal<Track[]>([]);

  readonly tracks = this._tracks.asReadonly();
  readonly pendingCount = computed(() => this._tracks().filter(t => t.pending).length);

  add(track: Track): void {
    this._tracks.update(tracks => [...tracks, track]); // nouvelle référence
  }
}

// ❌ Mutation en place, aucune notification ; effect qui calcule au lieu de computed
this._tracks().push(track);
effect(() => this.pendingCount.set(this._tracks().length));
```
