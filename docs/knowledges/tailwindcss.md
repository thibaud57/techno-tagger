---
title: "Tailwind CSS v4 — Styling utilitaire"
version: "4.3.3"
description: "Référence technique pour Tailwind CSS v4 : config CSS-first, intégration Angular via PostCSS, plugin tailwindcss-primeui, variant dark aligné sur PrimeNG."
date: "2026-08-29"
keywords: ["tailwind", "postcss", "css-first", "design-tokens", "dark-mode", "primeui"]
scope: ["docs"]
technologies: ["Angular", "PrimeNG", "PostCSS", "Prettier"]
---

# Description

Couvre le layout et l'espacement que PrimeNG ne fournit pas. PrimeNG livre les composants, Tailwind écrit ce qui les entoure.

Cette fiche couvre `tailwindcss` 4.3.3, `@tailwindcss/postcss` 4.3.3 (même monorepo, versions alignées), `tailwindcss-primeui` 0.6.1 et `prettier-plugin-tailwindcss` 0.8.1.

**Contrainte structurante : Tailwind v4 ne compile ni SCSS ni LESS.** C'est un build tool complet, plus un plugin PostCSS qui cohabite avec un préprocesseur. Tout le styling du projet est donc en CSS pur.

---

# Concepts Clés

## Configuration CSS-first

### Description

`tailwind.config.js` a disparu. Toute la configuration vit dans le fichier CSS d'entrée : un `@import`, des `@theme` pour les tokens, des `@plugin` pour les extensions.

### Exemple

```css
/* src/styles.css */
@import "tailwindcss";
@plugin "tailwindcss-primeui";

@custom-variant dark (&:where(.app-dark, .app-dark *));

@theme {
  --font-sans: 'Inter Variable', system-ui, sans-serif;
}
```

### Points Importants

- **Les directives `@tailwind base/components/utilities` de la v3 n'existent plus** : un seul `@import "tailwindcss"`
- `@theme` remplace `theme.extend` du config JS, avec des custom properties nommées par convention (`--color-*`, `--font-*`, `--breakpoint-*`)
- `@plugin "nom"` remplace le tableau `plugins: [...]`
- **Le fichier d'entrée doit être un `.css`, jamais un `.scss`** : dans un `.scss`, l'`@import "tailwindcss"` ne serait jamais traité, et l'erreur ne dit pas pourquoi

---

## Intégration Angular via PostCSS

### Description

Angular détecte automatiquement un fichier de config PostCSS à la racine du projet ou du workspace, et y fait passer les feuilles de style.

### Exemple

```json
// .postcssrc.json (à la racine)
{
  "plugins": {
    "@tailwindcss/postcss": {}
  }
}
```

### Points Importants

- **Le nom du fichier doit être exactement `.postcssrc.json` ou `postcss.config.json`** pour être détecté : un autre nom est ignoré silencieusement
- La racine du projet prime sur la racine du workspace quand les deux existent
- **Un fichier PostCSS maison désactive l'intégration Tailwind automatique du builder Angular** et fait passer toutes les feuilles de style, globales comme composants, par PostCSS. Coût possible sur les temps de build et de rebuild
- `@tailwindcss/postcss` remplace l'ancien plugin `tailwindcss` utilisé directement en v3

---

## Alignement du variant `dark:` sur PrimeNG

### Description

Par défaut, `dark:` s'appuie sur `prefers-color-scheme`, une media query. Le projet force le mode sombre par une classe : le variant doit viser la même classe, sinon les deux systèmes divergent.

### Exemple

```css
/* Doit reproduire exactement le darkModeSelector passé à providePrimeNG() */
@custom-variant dark (&:where(.app-dark, .app-dark *));
```

### Points Importants

- **C'est la ligne qui relie Tailwind et PrimeNG.** Sans elle, les composants PrimeNG sont sombres et les utilitaires Tailwind suivent le réglage système de l'utilisateur
- Le sélecteur doit être **identique** des deux côtés : changer l'un sans l'autre produit un écart visuel difficile à diagnostiquer
- `&:where(...)` garde une spécificité nulle, ce qui évite de faire gagner le variant sur des règles voisines

---

## Plugin `tailwindcss-primeui`

### Description

Expose les design tokens du preset PrimeNG en classes utilitaires : `bg-primary`, `text-surface-500`, `text-muted-color`. Le layout écrit en Tailwind reste donc dans la palette du thème.

### Exemple

```html
<div class="flex flex-col gap-4 bg-surface-900 p-6">
  <h2 class="text-primary text-lg font-semibold">{{ 'run.title' | translate }}</h2>
  <p class="text-muted-color">{{ 'run.subtitle' | translate }}</p>
</div>
```

### Points Importants

- Le plugin exige PrimeNG v18+ avec le theming next-gen : la v22 est couverte
- **Le paquet n'a pas été republié depuis mars 2025**, donc antérieur à PrimeNG 22 et à Tailwind 4.3. Il fonctionne, mais aucune correction n'est à attendre rapidement si un token nouveau n'est pas exposé
- Un bug d'intégration est documenté côté PrimeNG (résolution de `./theme/colors.css` avec Tailwind 4) : à garder en tête si l'installation échoue à cet endroit
- Utiliser ces classes plutôt que des couleurs Tailwind brutes garde la cohérence quand le preset change

---

## Tri des classes par Prettier

### Description

`prettier-plugin-tailwindcss` ordonne les classes utilitaires. En v4, il a besoin du chemin de la feuille d'entrée pour résoudre le thème et les plugins.

### Exemple

```json
// .prettierrc
{
  "plugins": ["prettier-plugin-tailwindcss"],
  "tailwindStylesheet": "./src/styles.css"
}
```

### Points Importants

- **`tailwindStylesheet` remplace `tailwindConfig` de la v3** : il n'y a plus de `tailwind.config.js` à détecter automatiquement
- Sans cette option, le plugin ne résout ni le thème ni les plugins, et le tri devient approximatif
- Le chemin est résolu relativement au fichier de config Prettier
- Exige Prettier ≥ 3.7.x, et le paquet est ESM-only

---

# Bonnes Pratiques

## ✅ Recommandations

- **Garder un seul fichier CSS d'entrée** (`src/styles.css`) qui porte l'`@import`, les `@plugin`, le `@custom-variant` et le `@theme`
- **Écrire le `@custom-variant dark` dans le même commit que le `darkModeSelector`** de PrimeNG : ils n'ont de sens qu'ensemble
- **Préférer les classes de `tailwindcss-primeui`** (`bg-surface-*`, `text-primary`) aux couleurs Tailwind brutes, pour rester dans la palette du preset
- **Laisser à PrimeNG les composants et à Tailwind le layout** : réimplémenter un bouton en utilitaires duplique le thème
- **Déclarer `tailwindStylesheet` dans `.prettierrc`** dès l'installation du plugin de tri

## ❌ Anti-Patterns

- **Mettre l'`@import "tailwindcss"` dans un `.scss`** : rien ne sera compilé, et l'échec est muet
- **Chercher à réintroduire SCSS pour des mixins ou des variables** : le nesting est natif et les variables sont des custom properties
- **Recréer un `tailwind.config.js`** : il n'est plus lu en v4
- **Nommer le fichier PostCSS autrement que `.postcssrc.json` / `postcss.config.json`** : il ne sera pas détecté
- **Utiliser `dark:` sans le `@custom-variant`** : le variant suivra le thème système, en désaccord avec l'interface

---

# 🔗 Ressources

## Documentation Officielle

- [Tailwind CSS v4 — annonce](https://tailwindcss.com/blog/tailwindcss-v4)
- [Guide d'installation Angular](https://tailwindcss.com/docs/installation/framework-guides/angular)
- [Dark Mode](https://tailwindcss.com/docs/dark-mode)
- [Functions and Directives](https://tailwindcss.com/docs/functions-and-directives)
- [Compatibility (préprocesseurs)](https://tailwindcss.com/docs/compatibility)

## Ressources Complémentaires

- [tailwindcss-primeui](https://github.com/primefaces/tailwindcss-primeui)
- [PrimeNG × Tailwind](https://primeng.dev/tailwind)
- [prettier-plugin-tailwindcss](https://github.com/tailwindlabs/prettier-plugin-tailwindcss)
- [primeng.md](primeng.md) — `darkModeSelector` et design tokens
- [DESIGN.md](../DESIGN.md) — tokens et layout du projet
