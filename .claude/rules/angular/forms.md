---
paths:
  - "src/app/features/settings/**/*.ts"
  - "src/app/features/**/*.html"
---

# Angular Forms — Règles

## À faire
- Écrire les formulaires en Signal Forms (`form()` plus un schéma), stables depuis Angular 22 et alignés sur l'architecture signals du projet
- Faire du modèle `signal<T>()` la source de vérité, jamais une copie tenue à part
- Déclarer la validation par les validateurs natifs (`required()`, `min()`, `pattern()`, `minDate()`, `maxDate()`) plutôt que par des fonctions maison
- Isoler la validation conditionnelle avec `applyWhen()`
- Debouncer au niveau du validateur avec `validateAsync({ debounce })`, chaque validateur async ayant sa propre fenêtre
- Soumettre par `submit()` et remonter les erreurs serveur sous forme `{ kind, message }`
- Traduire les messages d'erreur par ngx-translate, aucun libellé en dur dans un template
- Si un formulaire reste en Reactive Forms : initialiser en champ de classe avec `inject(FormBuilder)`, marquer les champs obligatoires `nonNullable` et se désabonner par `takeUntilDestroyed()`

## À éviter
- Les template-driven forms
- Construire un formulaire dans `ngOnInit` plutôt qu'en champ de classe
- Soumettre `form.value` quand des champs sont `disabled` : leurs valeurs en sont absentes, utiliser `getRawValue()`
- Mélanger Reactive et Signal Forms sur un même écran sans passer par `SignalFormControl` ou `FormControlValue`

## Gotchas
- Angular 22 : `touched` n'est plus un model bidirectionnel ; un custom control le lit par un `input` et le déclenche par l'output `touch()`
- Angular 22 : `markAsTouched()` marque le champ et tous ses descendants, ce qui change le comportement des soumissions partielles
- Angular 21 zoneless : `FormArray.push()` ne déclenche plus la détection de changements
- La forme raccourcie `fb.group({ x: ['', Validators.required] })` produit un `FormControl<string | null>` nullable
- Les erreurs cross-field sont portées par le `FormGroup`, pas par les champs concernés
- Un `FormGroup` désactivé ignore ses validateurs

## Exemples
```typescript
// ✅ Signal Forms : modèle signal, validation déclarative
interface Settings { apiUrl: string; lowThreshold: number; }

export class SettingsPageComponent {
  protected readonly model = signal<Settings>({ apiUrl: '', lowThreshold: 70 });

  protected readonly settings = form(this.model, (f) => {
    f.apiUrl(required(), pattern(/^https?:\/\//));
    f.lowThreshold(required(), min(0));
  });
}

// ❌ Formulaire construit dans ngOnInit, contrôles nullables
ngOnInit() {
  this.form = this.fb.group({ apiUrl: ['', Validators.required] });
}
```
