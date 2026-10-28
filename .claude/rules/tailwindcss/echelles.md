---
paths:
  - "src/app/**/*.html"
  - "src/app/**/*.ts"
---

# Tailwind CSS : échelles du design system

Les valeurs et leur justification vivent dans [DESIGN.md](../../../docs/DESIGN.md) (§ Formes, § Scale Typographique, § Layout & Espacement, § Icônes, § Feedback et chargement) ; cette rule dit quelle classe porte quel usage.

## À faire
- Rayon selon le rôle : `rounded-sm` marqueur (tag, badge, vignette), `rounded-border` contrôle et contenu, `rounded-lg` ce qui est posé dans la page (panneau, carte), `rounded-xl` ce qui flotte (modale). `rounded-xs` est réservé
- Titres en `font-semibold` : `text-2xl` titre d'écran, `text-lg` titre de section et de modale
- Texte courant `text-sm` (tables, listes, formulaires), légende `text-xs text-muted-color`
- Espacer en `gap-2` ce qui forme un tout (icône et libellé, champ et son bouton, boutons d'un pied), `gap-4` ce qui reste distinct sur une ligne (cellules d'une rangée, contrôles indépendants), `gap-6` entre les blocs d'un écran ; le container est posé par le shell, une page ne pose que son contenu
- Donner à une surface le padding de sa taille : `p-6` un panneau, `p-4` un détail déplié (DESIGN.md § Structure de Page)
- Écrire un rôle répété en `@utility` de `src/styles.css` et l'employer comme une classe : `panel` pour le bloc principal d'une page, vide comme rempli (une table le reçoit par `fullHeightTable`), `hint` pour une aide, `page-host` pour l'hôte d'une page, `settings-rows` pour les rangées d'une section des Réglages (colonne d'actions comprise)
- Poser `[iconOnly]="true"` sur un bouton à icône seule : le preset le rend carré
- Bordure à 1px : `border-surface` pour un panneau ou un filet de structure, `border-surface-800` entre les lignes d'une liste ; un champ garde celle du preset
- Icônes à `16` inline et dans les boutons, `20` dans un message et pour le logo d'en-tête de modale, `24` dans un état vide
- Donner à un `app-error-message` le même écart au-dessus et en dessous, celui de son conteneur : rattaché à une ligne, il prend le `gap` qui sépare les lignes (§ Feedback et chargement de DESIGN.md)

## À éviter
- Un message d'erreur collé à ce qui précède en `gap-2` et séparé de ce qui suit par un écart plus grand : il se lit comme une marge ratée
- `rounded-border` sur un panneau ou un cadre custom : c'est le rayon de contenu, un panneau prend `rounded-lg`
- Recopier les classes d'un panneau au lieu de `panel` : le même bloc finit encadré sur un écran et plat sur l'autre
- Une taille, un rayon ou un espacement hors de ces échelles sans raison écrite à côté

## Gotchas
- `rounded-border` est la seule classe de rayon du plugin `tailwindcss-primeui` : les autres crans sont les classes Tailwind standard, dont l'échelle coïncide avec celle d'Aura (valeurs dans [DESIGN.md § Formes](../../../docs/DESIGN.md#formes))
- Les classes d'hôte d'un composant s'écrivent dans son `.ts` (`host: { class }`) : elles relèvent des mêmes échelles que le template

## Exemples
```html
<!-- ✅ panneau custom : rayon de panneau, tokens du preset -->
<section class="flex flex-col gap-4 rounded-lg border border-surface bg-surface-900 p-6">
  <h2 class="text-lg font-semibold">{{ 'section.title' | translate }}</h2>
</section>

<!-- ❌ rayon de contenu sur un panneau -->
<section class="rounded-border border border-surface bg-surface-900 p-4">
```
