---
paths:
  - "src/app/**/*.html"
  - "src/app/**/*.ts"
---

# PrimeNG : composants

## À faire
- Chercher le composant PrimeNG avant d'en écrire un : aucun composant custom tant que la bibliothèque fournit un équivalent
- Personnaliser dans cet ordre : `definePreset()` pour ce qui vaut partout, `[dt]` pour les tokens d'une seule instance, `[pt]` pour attacher classes et attributs aux éléments internes
- Importer chaque icône `@primeicons/angular` individuellement, pour le tree-shaking
- Apparier la taille d'un badge à celle de sa rangée et garder neutre la puce d'un bouton : un compteur n'est pas une action
- Poser `size="small"` sur tout bouton, `link` excepté, boutons des modales de confirmation compris (`acceptButtonProps` et `rejectButtonProps` de `injectDangerConfirm`) et sur tout champ (`pSize="small"` sur un `pInputText`) : la densité compacte vaut pour tous les contrôles
- Régler dans le preset (`src/app/core/platform/theme.ts`) un écart d'Aura aux échelles du design system : badge à 12px, `info` de `p-message` en `sky`, pied de modale à 8px, croix des modales et du toast en carré de 28px (celle des modales calée sur la première ligne du titre et sur le bord du contenu), bouton à icône seule carré (avec `[iconOnly]="true"`), bouton `link` en lien de texte, onglet centré

## À éviter
- Un `message` HTML ou un `[innerHTML]` dans une confirmation qui cite un chemin : interpoler le texte, le chemin vient du disque
- `::ng-deep` : il casse à la mise à jour, passer par `[dt]` ou `[pt]`
- Les classes `pi pi-*` : la police n'est plus l'approche de la v22
- Une largeur en dur sur un bouton ou un libellé traduit. Seule se fige une colonne qui aligne plusieurs lignes, mesurée sur son contenu le plus long en FR et en EN
- `p-button`, déprécié en v22 : `<button pButton type="button">`
- `p-password`, déprécié en v22 : `<input pInputPassword>`, sans œil de bascule intégré (`mask` et `toggleMask()`, icône à composer)

## Gotchas
- `@primeicons/angular` rend des composants standalone en SVG inline, plus une police à classes. Le paquet CSS `primeicons` s'arrête à 7.0.0 pour le MIT, la 8.0.0 étant sous licence PrimeUI
- Les logos absents du jeu (Beatport, Bandcamp, SoundCloud, VLC) viennent de Simple Icons, en SVG dans `src/assets/icons/`
- La sévérité d'avertissement s'écrit `warn` partout (`p-tag`, `p-badge`, `p-message`, `pButton` et son `badgeSeverity`), le compilateur refuse `warning` ; `p-message` n'a pas `danger`, son erreur est `error`

## Exemples
```html
<!-- ❌ libellé en dur et style qui perce l'encapsulation -->
<p-button label="Valider" styleClass="my-btn" />
```
