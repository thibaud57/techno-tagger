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
- Fixer `virtualScrollItemSize` sur la hauteur réelle du `<tr>`, posée par une classe, et la revalider quand le style de ligne change : PrimeNG ne mesure pas les lignes, une valeur fausse produit un scroll qui saute ou des lignes coupées
- Dériver l'onglet actif de l'URL et naviguer sur `valueChange` : `p-tabs` n'a aucun mode router en v22, et dériver dans ce sens garde le deep-link fonctionnel
- Importer chaque icône `@primeicons/angular` individuellement dans les `imports` du composant, c'est ce qui permet le tree-shaking
- Apparier la taille d'un badge à celle des éléments de sa rangée, et garder neutre la puce portée par un bouton : un compteur n'est pas une action (cf. [DESIGN.md § États des Composants](../../../docs/DESIGN.md#états-des-composants))
- Porter le bloc « état vide » d'une table par le template `#emptymessage` de `p-table`, avec `[pt]="fullHeightTable(vide)"` (`shared/utils/table.ts`) sur la table et `border-b-0` sur la cellule : le bloc se centre sur toute la hauteur, et le pass-through n'atteint pas la bordure de la ligne

## À éviter
- `::ng-deep` : percer l'encapsulation d'un composant produit du style qui casse à la mise à jour et qu'aucune recherche ne retrouve. Passer par `[dt]` ou `[pt]`, voie explicitement recommandée par la doc PrimeNG
- `!important` : si un style ne s'applique pas, c'est l'ordre des couches qui est en cause, à corriger dans `cssLayer`
- Attendre un mode router de `p-tabs`, ou se replier sur `p-tabMenu` qui n'est plus la voie recommandée
- Les classes `pi pi-*` : la police n'est plus l'approche de la v22
- Un libellé en dur dans un template : tout passe par ngx-translate, y compris les messages d'erreur que le sidecar émet en `code` + `params`
- Une largeur en dur sur un bouton ou un libellé traduit : les libellés existent en FR et en EN. Seule une colonne de table se fige, mesurée sur son contenu le plus long dans les deux langues (cf. DESIGN.md § Conventions de Code)
- De la logique métier dans un composant : scores, seuils et classement des candidats viennent du sidecar
- Le composant `p-button` : déprécié depuis la v22 (`@typescript-eslint/no-deprecated` fait échouer le lint), au profit de `<button pButton type="button">` avec libellé et icône en contenu
- Le composant `p-password` : déprécié depuis la v22 au profit de `<input pInputPassword>` (`primeng/inputpassword`), qui n'a ni œil de bascule ni `feedback` intégrés : seulement le model `mask` et `toggleMask()`, l'icône se compose à la main

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
