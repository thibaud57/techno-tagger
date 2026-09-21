---
paths:
  - "src/app/features/settings/**/*.ts"
  - "src/app/features/**/*.html"
---

# Angular Forms — Règles

## À faire
- Écrire les formulaires en Signal Forms (`form()` plus un schéma), stables depuis Angular 22 et alignés sur l'architecture signals du projet
- Faire du modèle `signal<T>()` la source de vérité, jamais une copie tenue à part
- Déclarer la validation par les validateurs natifs (`required()`, `min()`, `pattern()`, `minDate()`, `maxDate()`) plutôt que par des fonctions maison, **quand un champ a quelque chose à valider et un message à afficher**. Un écran dont la seule règle est « le bouton s'active quand le champ est rempli » n'a pas de validation : un `computed()` le dit, et `form()` n'est là que pour lier les composants par `[formField]` (les composants PrimeNG n'exposent leur valeur que par `ControlValueAccessor`)
- Isoler la validation conditionnelle avec `applyWhen()`
- Debouncer au niveau du validateur avec `validateAsync({ debounce })`, chaque validateur async ayant sa propre fenêtre
- Soumettre par `submit()` **quand la réponse du serveur revient de l'appel lui-même**, et remonter les erreurs sous forme `{ kind, message }`. Ce n'est pas le cas ici : une commande part sur le protocole NDJSON, rend la main aussitôt, et son échec arrive plus tard par le flux d'événements dans `lastError`. `submit()` n'attraperait rien, l'envoi est une méthode du composant
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
  this.form = this.fb.group({ apiUrl: ['', Validators.required] });
}
```
