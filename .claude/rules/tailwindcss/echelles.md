---
paths:
  - "src/app/**/*.html"
  - "src/app/**/*.ts"
---

# Tailwind CSS — Échelles du design system

Les valeurs et leur justification vivent dans [DESIGN.md](../../../docs/DESIGN.md) (§ Formes, § Scale Typographique, § Layout & Espacement, § Icônes) ; cette rule dit quelle classe porte quel usage.

## À faire
- Rayon selon l'élément : `rounded-xs` badge, `rounded-sm` tag et vignette, `rounded-border` champ et contenu, `rounded-lg` panneau et carte, `rounded-xl` modale
- Titres en `font-semibold` : `text-2xl` titre d'écran, `text-xl` section, `text-lg` entête de modale ou sous-section
- Texte dense `text-sm` dans les tables et les listes, légende `text-xs text-muted-color`
- Espacer en `gap-2` dans un groupe, `gap-4` entre groupes, `gap-6` entre sections d'un écran ; le container est posé par le shell, une page ne pose que son contenu
- Icônes à `16` inline et dans les boutons, `20` en entête et dans un message d'erreur, `24` dans un état vide

## À éviter
- `rounded-border` sur un panneau ou un cadre custom : c'est le rayon de contenu (6px), un panneau prend 8px
- Une taille, un rayon ou un espacement hors de ces échelles sans raison écrite à côté

## Gotchas
- `rounded-border` est la seule classe de rayon du plugin `tailwindcss-primeui` : les autres crans sont les classes Tailwind standard, dont l'échelle coïncide avec celle d'Aura (2, 4, 6, 8, 12px)
- Les classes d'hôte d'un composant s'écrivent dans son `.ts` (`host: { class }`) : elles relèvent des mêmes échelles que le template

## Exemples
```html
<!-- ✅ panneau custom : rayon de panneau, tokens du preset -->
<section class="flex flex-col gap-4 rounded-lg border border-surface bg-surface-900 p-4">
  <h2 class="text-xl font-semibold">{{ 'section.title' | translate }}</h2>
</section>

<!-- ❌ rayon de contenu sur un panneau -->
<section class="rounded-border border border-surface bg-surface-900 p-4">
```
