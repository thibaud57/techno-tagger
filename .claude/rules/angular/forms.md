---
paths:
  - "src/app/features/**/*.ts"
  - "src/app/features/**/*.html"
---

# Angular : forms

## À faire
- Écrire les formulaires en Signal Forms (`form()` plus un schéma), stables depuis Angular 22
- Faire du modèle `signal<T>()` la source de vérité, jamais une copie tenue à part
- Valider par les validateurs natifs, le path du champ en premier argument (`required(f.email)`, `min(f.threshold, 0)`), plutôt que par des fonctions maison
- Isoler la validation conditionnelle avec `applyWhen()`
- Debouncer au niveau du validateur avec `validateAsync(path, { debounce })`
- Écrire un custom control natif en implémentant `FormValueControl<T>` (un `value = model()` suffit) ; un composant `ControlValueAccessor` existant se branche tel quel sur `[formField]`
- Envoyer une commande par une méthode du composant, pas par `submit()` : la commande NDJSON rend la main aussitôt et son échec arrive plus tard dans `lastError`

## Gotchas
- Les états d'un champ Signal Forms sont des signals à appeler (`f.email().valid()`, `touched()`, `errors()`), alors que `getError('required')` rend une valeur directe
- Un écran dont la seule règle est « bouton actif quand le champ est rempli » n'a rien à valider : un `computed()` suffit, `form()` ne sert qu'à lier les composants PrimeNG par `[formField]`
- Angular 22 : `touched` n'est plus un model bidirectionnel ; un custom control le lit par un `input` et le déclenche par l'output `touch()`
- Angular 22 : `markAsTouched()` marque le champ et tous ses descendants, ce qui change le comportement des soumissions partielles

## Exemples
```typescript
// ✅ Signal Forms : modèle signal, validation déclarative quand il y a à valider
interface Settings { lowThreshold: number; }

export class SettingsPageComponent {
  protected readonly model = signal<Settings>({ lowThreshold: 70 });

  protected readonly settings = form(this.model, (f) => {
    required(f.lowThreshold);
    min(f.lowThreshold, 0);
  });
}

// ❌ Syntaxe antérieure à la stabilisation : la règle ne reçoit plus le champ en appel
f.lowThreshold(required(), min(0));

// ✅ Rien à valider : `form()` ne sert qu'au binding, l'affordance vient d'un computed
protected readonly entry = signal({ apiKey: '' });
protected readonly fields = form(this.entry);
protected readonly canSave = computed(() => this.entry().apiKey !== '');
```
