---
paths:
  - "src/app/features/settings/**/*.ts"
  - "src/app/features/**/*.html"
---

# Angular Forms — Règles

## À faire
- Écrire les formulaires en Signal Forms (`form()` plus un schéma), stables depuis Angular 22
- Faire du modèle `signal<T>()` la source de vérité, jamais une copie tenue à part
- Valider par les validateurs natifs (`required()`, `min()`, `pattern()`…) plutôt que par des fonctions maison
- Isoler la validation conditionnelle avec `applyWhen()`
- Debouncer au niveau du validateur avec `validateAsync({ debounce })`
- Envoyer une commande par une méthode du composant, pas par `submit()` : la commande NDJSON rend la main aussitôt et son échec arrive plus tard dans `lastError`
- Traduire les messages d'erreur par ngx-translate
- En Reactive Forms : `inject(FormBuilder)` en champ de classe, champs obligatoires `nonNullable`, `takeUntilDestroyed()`

## À éviter
- Les template-driven forms
- Construire un formulaire dans `ngOnInit` plutôt qu'en champ de classe
- Soumettre `form.value` quand des champs sont `disabled` : leurs valeurs en sont absentes, utiliser `getRawValue()`
- Mélanger Reactive et Signal Forms sur un même écran sans passer par `SignalFormControl` ou `FormControlValue`

## Gotchas
- Un écran dont la seule règle est « bouton actif quand le champ est rempli » n'a rien à valider : un `computed()` suffit, `form()` ne sert qu'à lier les composants PrimeNG par `[formField]`
- Angular 22 : `touched` n'est plus un model bidirectionnel ; un custom control le lit par un `input` et le déclenche par l'output `touch()`
- Angular 22 : `markAsTouched()` marque le champ et tous ses descendants, ce qui change le comportement des soumissions partielles
- Angular 21 zoneless : `FormArray.push()` ne déclenche plus la détection de changements
- La forme raccourcie `fb.group({ x: ['', Validators.required] })` produit un `FormControl<string | null>` nullable
- Les erreurs cross-field sont portées par le `FormGroup`, pas par les champs concernés
- Un `FormGroup` désactivé ignore ses validateurs

## Exemples
```typescript
// ✅ Signal Forms : modèle signal, validation déclarative quand il y a à valider
interface Settings { lowThreshold: number; }

export class SettingsPageComponent {
  protected readonly model = signal<Settings>({ lowThreshold: 70 });

  protected readonly settings = form(this.model, (f) => {
    f.lowThreshold(required(), min(0));
  });
}

// ✅ Rien à valider : `form()` ne sert qu'au binding, l'affordance vient d'un computed
protected readonly entry = signal({ apiKey: '' });
protected readonly fields = form(this.entry);
protected readonly canSave = computed(() => this.entry().apiKey !== '');

// ❌ Formulaire construit dans ngOnInit, contrôles nullables
ngOnInit() {
  this.form = this.fb.group({ apiKey: ['', Validators.required] });
}
```
