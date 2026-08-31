---
paths:
  - "src/app/**/*.ts"
  - "src/app/**/*.html"
---

# Angular Components — Règles

## À faire
- Injecter avec `inject()` en champ de classe `private readonly`, jamais par le constructeur
- Exposer au template en `protected readonly`, garder l'implémentation interne en `private`
- Utiliser `input()`, `output()`, `viewChild()` et `contentChild()`, jamais les décorateurs `@Input()`, `@Output()`, `@ViewChild()`
- Utiliser `input.required<T>()` pour un input obligatoire (erreur de compilation) et `viewChild.required()` pour un élément toujours présent
- Utiliser `@if`, `@for` et `@switch`, avec un `track` sur chaque `@for`
- Nettoyer avec `takeUntilDestroyed()` ou `inject(DestroyRef)` plutôt que le couple `destroy$ = new Subject()` + `ngOnDestroy`
- Animer avec `animate.enter` / `animate.leave` et des `@keyframes` CSS
- Ordonner les membres : injections, signals, constantes, inputs, outputs, requêtes de vue, propriétés, getters, constructeur, hooks, méthodes publiques puis privées
- Prendre le composant PrimeNG existant avant d'écrire un composant custom, et personnaliser par `[dt]` ou `[pt]` (cf. DESIGN.md)
- Passer tout libellé par ngx-translate, y compris les messages d'erreur, que le sidecar émet en `code` + `params`

## À éviter
- Toute logique métier dans un composant : scores, seuils et classement des candidats viennent du sidecar, l'interface affiche ce qu'elle reçoit
- `@angular/animations` et le DSL `trigger()` / `state()` : déprécié depuis Angular 20.2, suppression prévue en 23
- `::ng-deep` et `!important` pour percer un composant PrimeNG
- Déclarer deux fois le même input, output ou model dans un composant : erreur de compilation depuis Angular 22
- `createComponent()` avec un `hostElement` créé à la main : `destroy()` ne retire pas l'élément du DOM

## Gotchas
- Angular 22 : `strictTemplates` est activé par défaut, les erreurs de type dans les templates deviennent des erreurs de compilation
- Angular 22 : l'optional chaining `?.` retourne `undefined` et non plus `null`, ce qui change les conditions qui distinguaient les deux
- Angular 22 : un `@for` malformé est type-checked, là où l'échec était silencieux au runtime
- PrimeNG 22 : `pTemplate` supprimé (utiliser `ng-template` plus une variable de référence), `styleClass` supprimé sur les composants host-enabled (utiliser `class`), sélecteurs camelCase supprimés au profit du kebab-case
- `pInputText` et `pTooltip` sont des directives posées sur un élément existant, pas des composants

## Exemples
```typescript
// ✅
@Component({
  selector: 'app-track-row',
  template: `
    @if (track(); as t) {
      <span>{{ t.title }}</span>
    }
  `
})
export class TrackRowComponent {
  private readonly sidecar = inject(SidecarService);

  readonly track = input.required<Track>();
  readonly arbitrated = output<TrackDecision>();
}

// ❌
export class TrackRowComponent {
  @Input() track!: Track;
  @Output() arbitrated = new EventEmitter<TrackDecision>();
  constructor(private sidecar: SidecarService) {}
}
```
