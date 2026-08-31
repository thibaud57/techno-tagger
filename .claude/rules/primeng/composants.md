---
paths:
  - "src/app/**/*.html"
  - "src/app/**/*.ts"
---

# PrimeNG — Composants

## À faire
- Chercher le composant PrimeNG avant d'en écrire un : aucun composant custom tant que la bibliothèque fournit un équivalent
- Personnaliser dans cet ordre : `definePreset()` pour ce qui vaut partout, `[dt]` pour les tokens d'une seule instance, `[pt]` pour attacher classes et attributs aux éléments internes
- Fixer `virtualScrollItemSize` sur la hauteur réelle du `<tr>` et la revalider quand le style de ligne change : c'est une hauteur fixe, une valeur fausse produit un scroll qui saute ou des lignes coupées. `scrollHeight="flex"` plutôt qu'une valeur en pixels, la fenêtre étant redimensionnable
- Dériver l'onglet actif de l'URL et naviguer sur `valueChange` : `p-tabs` n'a aucun mode router en v22, et dériver dans ce sens garde le deep-link fonctionnel
- Importer chaque icône `@primeicons/angular` individuellement dans les `imports` du composant, c'est ce qui permet le tree-shaking
- Passer `[size]="'small'"` sur les tables : la densité compacte est la convention du projet, et `p-datatable-sm` est générée par le composant, jamais posée à la main
- Apparier la taille d'un badge à celle des éléments de sa rangée, et garder neutre la puce portée par un bouton : un compteur n'est pas une action (cf. [DESIGN.md § États des Composants](../../../docs/DESIGN.md#états-des-composants))
- Porter le bloc « état vide » de la liste d'un run par le template `#emptymessage` de `p-table`

## À éviter
- `::ng-deep` : percer l'encapsulation d'un composant produit du style qui casse à la mise à jour et qu'aucune recherche ne retrouve. Passer par `[dt]` ou `[pt]`, voie explicitement recommandée par la doc PrimeNG
- `!important` : si un style ne s'applique pas, c'est l'ordre des couches qui est en cause, à corriger dans `cssLayer`
- Attendre un mode router de `p-tabs`, ou se replier sur `p-tabMenu` qui n'est plus la voie recommandée
- Les classes `pi pi-*` : la police n'est plus l'approche de la v22
- Un libellé en dur dans un template : tout passe par ngx-translate, y compris les messages d'erreur que le sidecar émet en `code` + `params`
- Une largeur fixe sur du texte traduit : les libellés existent en FR et en EN, et le français est généralement le plus long
- De la logique métier dans un composant : scores, seuils et classement des candidats viennent du sidecar

## Gotchas
- `@primeicons/angular` rend des composants standalone en SVG inline, plus une police à classes. Le paquet CSS `primeicons` s'arrête à 7.0.0 pour le MIT, la 8.0.0 étant sous licence PrimeUI
- Quatre logos absents du jeu (Beatport, Bandcamp, SoundCloud, VLC) viennent de Simple Icons, en SVG dans `src/assets/icons/`
- Le scroll virtuel et le filtrage cohabitent, mais c'est le jeu de données filtré qui compte, pas le total
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
<!-- ✅ hauteur d'item alignée sur la ligne réelle, densité compacte -->
<p-table [value]="tracks()" [size]="'small'" [scrollable]="true" scrollHeight="flex"
         [virtualScroll]="true" [virtualScrollItemSize]="ROW_HEIGHT">

<!-- ❌ libellé en dur et style qui perce l'encapsulation -->
<p-button label="Valider" styleClass="my-btn" />
```
