---
paths:
  - "src/app/**/*.html"
  - "src/app/**/*.ts"
---

# PrimeNG : tables et onglets

## À faire
- Laisser `p-table` à sa taille par défaut, en `[scrollable]` avec `scrollHeight="flex"` plutôt qu'une valeur en pixels, la fenêtre étant redimensionnable
- Fixer `virtualScrollItemSize` sur la hauteur réelle du `<tr>`, posée par une classe : PrimeNG ne mesure pas les lignes, une valeur fausse fait sauter le scroll
- Dériver l'onglet actif de l'URL et naviguer sur `valueChange` : `p-tabs` n'a aucun mode router et `p-tabMenu` est absent de PrimeNG 22
- Nommer en commentaire ce sur quoi une largeur figée a été mesurée
- Poser `[pt]="fullHeightTable(vide)"` (`shared/utils/table.ts`) sur toute `p-table` : colonnes figées sur l'en-tête et état vide centré sur toute la hauteur

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
```
