---
paths:
  - "src/app/**/*.html"
  - "src/app/**/*.ts"
---

# PrimeNG — Ligne dépliée dans une table virtualisée

## À faire
- Déplier un détail sous une ligne d'une `p-table` en `[virtualScroll]` par des lignes synthétiques de la hauteur des autres : une porteuse qui contient le détail en `position: absolute`, des lignes vides `aria-hidden` qu'il recouvre
- Donner au cadre du détail un nombre entier de lignes, mesuré sur son plus haut contenu, et étirer le contenu sur cette hauteur plutôt que laisser une bande vide
- Poser `virtualScrollOptions.numToleratedItems` au plus grand nombre de lignes d'un détail plus un : la porteuse reste montée tant qu'une ligne du détail est à l'écran
- Préfixer les clés de ligne par leur nature (`track:`, `detail:`, `filler:`) : `rowTrackBy` et `dataKey` lisent la même clé
- Porter l'état ouvert sur l'entrée de ligne de la liste rendue, mémoïsée, plutôt que le rechercher dans le template
- Laisser le composant du détail exporter le nombre de lignes qu'il occupe : c'est lui qui connaît son contenu

## À éviter
- `#expandedrow` sur une table en `[virtualScroll]` : la ligne qui grandit décale toutes les suivantes, et le retrait du scroll virtuel coûte des secondes au premier rendu d'un gros run
- Un `z-index` sur le cadre du détail : il passe au-dessus de l'en-tête collant de la table
- Mesurer le contenu du détail à l'exécution pour choisir son nombre de lignes : la liste se décale après l'affichage

## Gotchas
- PrimeNG 22.1.2 : la marge de lignes rendues au-dessus de la première visible (`numToleratedItems`) n'est pas documentée, elle se lit dans le scroller. À revérifier à chaque mise à jour de PrimeNG, cf. [knowledges/primeng.md § Détail déplié sous une ligne virtualisée](../../../docs/knowledges/primeng.md#détail-déplié-sous-une-ligne-virtualisée)

## Exemples
```html
<!-- ✅ Toutes les lignes gardent la hauteur du scroller -->
<tr class="h-14" data-detail-carrier>
  <td colspan="7" class="relative p-0">
    <div class="absolute inset-x-0 top-0" [style.height.px]="item.height">…</div>
  </td>
</tr>
<tr class="h-14" aria-hidden="true"><td colspan="7"></td></tr>

<!-- ❌ Ligne de hauteur variable sous scroll virtuel -->
<ng-template #expandedrow let-row><tr><td colspan="7"><app-detail [row]="row" /></td></tr></ng-template>
```
