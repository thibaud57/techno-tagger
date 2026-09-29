---
paths:
  - "src/app/**/*.html"
  - "src/app/**/*.ts"
---

# PrimeNG — Composants

## À faire
- Chercher le composant PrimeNG avant d'en écrire un : aucun composant custom tant que la bibliothèque fournit un équivalent
- Personnaliser dans cet ordre : `definePreset()` pour ce qui vaut partout, `[dt]` pour les tokens d'une seule instance, `[pt]` pour attacher classes et attributs aux éléments internes
- Laisser `p-table` à sa taille par défaut, en `[scrollable]` avec `scrollHeight="flex"` plutôt qu'une valeur en pixels, la fenêtre étant redimensionnable
- Fixer `virtualScrollItemSize` sur la hauteur réelle du `<tr>`, posée par une classe : PrimeNG ne mesure pas les lignes, une valeur fausse fait sauter le scroll
- Dériver l'onglet actif de l'URL et naviguer sur `valueChange` : `p-tabs` n'a aucun mode router
- Importer chaque icône `@primeicons/angular` individuellement, pour le tree-shaking
- Apparier la taille d'un badge à celle de sa rangée, et garder neutre la puce d'un bouton : un compteur n'est pas une action
- Nommer en commentaire ce sur quoi une largeur figée a été mesurée
- Dimensionner un `p-dialog` par `styleClass` et des classes Tailwind, pas par `[style]`
- Poser `[pt]="fullHeightTable(vide)"` (`shared/utils/table.ts`) sur toute `p-table` : colonnes figées sur l'en-tête et état vide centré sur toute la hauteur

## À éviter
- `::ng-deep` : il casse à la mise à jour, passer par `[dt]` ou `[pt]`
- `!important` : si un style ne s'applique pas, c'est l'ordre des couches qui est en cause, à corriger dans `cssLayer`
- Attendre un mode router de `p-tabs`, ou se replier sur `p-tabMenu` qui n'est plus la voie recommandée
- Les classes `pi pi-*` : la police n'est plus l'approche de la v22
- Un libellé en dur dans un template : tout passe par ngx-translate, y compris les messages d'erreur que le sidecar émet en `code` + `params`
- Une largeur en dur sur un bouton ou un libellé traduit. Seule se fige une colonne qui aligne plusieurs lignes, mesurée sur son contenu le plus long en FR et en EN
- De la logique métier dans un composant : scores, seuils et classement des candidats viennent du sidecar
- `p-button`, déprécié en v22 : `<button pButton type="button">`
- `p-password`, déprécié en v22 : `<input pInputPassword>`, sans œil de bascule intégré (`mask` et `toggleMask()`, icône à composer)

## Gotchas
- `@primeicons/angular` rend des composants standalone en SVG inline, plus une police à classes. Le paquet CSS `primeicons` s'arrête à 7.0.0 pour le MIT, la 8.0.0 étant sous licence PrimeUI
- Les logos absents du jeu (Beatport, Bandcamp, SoundCloud, VLC) viennent de Simple Icons, en SVG dans `src/assets/icons/`
- Le câblage tabs ↔ router est manuel, une dizaine de lignes dans le shell, sans aucune synchronisation automatique
- `outline: none` est interdit : la modale d'arbitrage se traite entièrement au clavier et le focus doit rester visible

## Exemples
```typescript
// ✅ l'onglet actif se dérive de l'URL, la navigation part du changement de valeur
readonly activeTab = toSignal(
  this.router.events.pipe(map(() => this.router.url.split('/')[1])),
);

onTabChange(value: string): void {
  void this.router.navigate([value]);
}
```

```html
<!-- ✅ taille par défaut, hauteur d'item alignée sur la ligne réelle -->
<p-table [value]="tracks()" [scrollable]="true" scrollHeight="flex"
         [virtualScroll]="true" [virtualScrollItemSize]="ROW_HEIGHT">

<!-- ❌ libellé en dur et style qui perce l'encapsulation -->
<p-button label="Valider" styleClass="my-btn" />
```
