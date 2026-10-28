---
paths:
  - "src/app/**/*.ts"
  - "src/app/**/*.html"
---

# Angular : pipes et directives

## À faire
- Laisser les pipes purs (comportement par défaut) et les réserver aux transformations d'affichage
- Filtrer et trier avec un `computed()` dans le composant, jamais avec un pipe
- Déclarer les bindings et listeners d'une directive dans la propriété `host` du décorateur plutôt qu'avec `@HostBinding` / `@HostListener`
- Passer par `Renderer2` pour toucher au DOM depuis une directive
- Appeler `viewContainer.clear()` avant de recréer les vues d'une directive structurelle, sinon elles s'accumulent
## À éviter
- Les pipes impurs (`pure: false`) : réévalués à chaque cycle de détection
- Écrire une directive structurelle pour ce que `@if` et `@for` couvrent déjà
- `bypassSecurityTrust*()` sur une donnée non validée : c'est une faille XSS ouverte
## Gotchas
- Un pipe pur ne se réévalue que sur une nouvelle référence : muter le tableau qu'il reçoit ne déclenche rien
- `standalone: true` est implicite depuis Angular 19 pour les pipes comme pour les directives
## Exemples
```typescript
// ✅ Dérivation par computed, réévaluée uniquement quand une dépendance change
export class SummaryList {
  protected readonly filter = signal<Filter>('all');
  protected readonly visible = computed(() =>
    this.tracks().filter(t => matches(t, this.filter()))
  );
}

// ❌ Pipe impur : rejoué à chaque cycle sur toute la liste
@Pipe({ name: 'filterBy', pure: false })
export class FilterByPipe implements PipeTransform { ... }
```
