---
paths:
  - "src/app/**/*.html"
  - "src/app/**/*.ts"
---

# PrimeNG : modales et tooltips

## À faire
- Dimensionner un `p-dialog` par `styleClass` et des classes Tailwind, pas par `[style]`
- Lier tout `pTooltip` par `[tooltipOptions]` au jeu `TOOLTIP` (ou `WIDE_TOOLTIP` pour un texte long, `src/app/shared/utils/tooltip.ts`) : il pose le délai et la position sous l'élément (`TOOLTIP_POSITION`). PrimeNG n'a aucun défaut global : sans ce jeu le tooltip s'ouvre à droite et sans délai et sur le côté la place manque dès que l'élément touche le bord de la fenêtre

## À éviter
- Un `[tooltipPosition]` ou un `[showDelay]` posé sur l'instance (`"left"`, `"right"`, un délai en dur) : passer par `[tooltipOptions]`
- Repositionner la croix d'une modale par instance (marge, `[pt]`, classe) : une modale qui diverge se corrige dans le preset

## Gotchas
- Le preset pose `display: contents` sur `p-dialog` et `p-confirmdialog` : fermée, une modale ne rend que sa balise hôte, qui compte sinon comme un enfant vide de la colonne flex de la page et ajoute un `gap` sous le dernier élément (48px sous la liste de Tagging, relevé le 2026-10-11)
- `outline: none` est interdit : la modale d'arbitrage se traite entièrement au clavier et le focus doit rester visible
