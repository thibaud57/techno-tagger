---
paths:
  - "src/app/**/*.html"
  - "src/app/**/*.css"
---

# Tailwind CSS — Utilitaires dans les templates

## À faire
- Écrire le layout en classes Tailwind dans le template, et laisser les composants à PrimeNG : réimplémenter un bouton en utilitaires duplique le thème
- Référencer toute couleur par un token ou une classe de `tailwindcss-primeui` (`bg-primary`, `text-muted-color`, `border-surface`, `bg-surface-*`)
- Conditionner une classe par `[class.x]` ou `[ngClass]`
- Réserver le CSS de composant à ce que Tailwind ne couvre pas : keyframes, et sélecteurs visant le DOM interne d'un composant PrimeNG
- Écrire les styles de composant en `.css`, le nesting natif étant supporté par la webview Windows
- Laisser `prettier-plugin-tailwindcss` ordonner les classes au format : aucune convention manuelle à retenir, rien à relire en review sur ce point
- Accompagner chaque état d'une icône et d'un libellé traduit : la couleur ne porte jamais seule l'information
- Réserver l'accent `primary` aux actions et à la sélection, et `danger` aux trois actions qui touchent aux fichiers musicaux (cf. [DESIGN.md § Palette de Couleurs](../../../docs/DESIGN.md#palette-de-couleurs))

## À éviter
- Une couleur en dur : ni hexadécimal, ni couleur Tailwind brute (`bg-emerald-500`). Un changement de preset doit rester un changement de preset
- Un style sous un variant `light:` : le mode clair n'existe pas, aucune valeur n'est doublée
- `!important` : c'est l'ordre des couches qu'il faut corriger, dans `cssLayer`. Seule exception, la coupure des animations sous `prefers-reduced-motion`
- Un `[style]` inline hors valeur calculée à l'exécution (largeur d'une barre, position d'un élément virtualisé)
- Un déplacement ou un `scale` au survol d'une zone cliquable : les lignes de la liste ne bougent pas sous le curseur
- Animer le chemin de décision : rien ne s'anime entre l'arrivée d'un `arbitration_required` et l'affichage des candidats

## Gotchas
- La classe `rounded-border` du plugin applique le rayon de contenu sans passer par la variable
- Les rayons viennent des primitives du preset Aura, consommées telles quelles : le tableau des usages est dans [DESIGN.md § Formes](../../../docs/DESIGN.md#formes)
- Un bouton désactivé garde son libellé et n'est jamais masqué : opacité du token `--p-disabled-opacity` plus `cursor: not-allowed`
- Un `p-skeleton` aux dimensions de la ligne finale évite le saut de layout à l'arrivée des événements

## Exemples
```html
<!-- ✅ tokens du preset, classes triées par Prettier -->
<div class="bg-surface-900 border-surface rounded-border flex items-center justify-between gap-4 px-4 py-2 text-sm">
  <span class="text-muted-color">{{ 'run.subtitle' | translate }}</span>
</div>

<!-- ❌ couleur brute, largeur fixe sur du texte traduit -->
<div class="w-32 bg-emerald-500">{{ 'run.subtitle' | translate }}</div>
```
