---
paths:
  - "src/styles.css"
  - ".postcssrc.json"
  - ".prettierrc"
---

# Tailwind CSS — Configuration

## À faire
- Garder un seul fichier CSS d'entrée, qui porte l'`@import "tailwindcss"`, les `@plugin`, le `@custom-variant` et le `@theme`
- Configurer en CSS : `@theme` remplace `theme.extend`, `@plugin "nom"` remplace le tableau `plugins`
- Nommer le fichier PostCSS exactement `.postcssrc.json` ou `postcss.config.json`, avec `@tailwindcss/postcss` pour seul plugin
- Écrire le `@custom-variant dark` sur exactement le sélecteur passé en `darkModeSelector` à `providePrimeNG()`, dans le même commit (valeur dans [DESIGN.md § Dark / Light Mode](../../../docs/DESIGN.md#dark--light-mode))
- Garder le `&:where(...)` du variant : sa spécificité nulle évite de faire gagner le variant sur des règles voisines
- Déclarer `tailwindStylesheet` dans `.prettierrc` dès l'installation du plugin de tri, le chemin étant résolu relativement au fichier de config Prettier
- Charger le plugin `tailwindcss-primeui` : il expose les design tokens du preset en classes utilitaires

## À éviter
- Mettre l'`@import "tailwindcss"` dans un `.scss` : rien n'est compilé et l'échec est muet
- Réintroduire SCSS pour des mixins ou des variables : le nesting est natif et les variables sont des custom properties
- Recréer un `tailwind.config.js` : il n'est plus lu en v4
- Les directives `@tailwind base/components/utilities` de la v3 : elles n'existent plus
- `dark:` sans le `@custom-variant` : le variant suivrait le thème système, en désaccord avec l'interface

## Gotchas
- Un fichier PostCSS maison désactive l'intégration Tailwind automatique du builder Angular et fait passer toutes les feuilles de style, globales comme composants, par PostCSS : coût possible sur les temps de build et de rebuild
- La racine du projet prime sur celle du workspace quand les deux portent un fichier PostCSS, et un fichier mal nommé est ignoré silencieusement
- Sans le sélecteur aligné des deux côtés, les composants PrimeNG sont sombres pendant que les utilitaires Tailwind suivent le réglage système : l'écart est visuel et difficile à diagnostiquer
- `tailwindcss-primeui` n'a pas été republié depuis mars 2025, donc avant PrimeNG 22 et Tailwind 4.3 : il ne consomme que des variables CSS générées, mais aucune correction rapide n'est à attendre si un token nouveau n'est pas exposé. Le repli est de déclarer les tokens directement dans `@theme`
- `tailwindStylesheet` remplace `tailwindConfig` de la v3 : sans lui, le plugin ne résout ni le thème ni les plugins et le tri devient approximatif. Il exige Prettier ≥ 3.7 et le paquet est ESM-only
- `minimumReleaseAge` côté Renovate doit rester aligné sur celui de pnpm, sans quoi un lockfile régénéré fait échouer `pnpm install --frozen-lockfile` (cas documenté sur `caniuse-lite`)

## Exemples
```css
/* ✅ toute la configuration dans le CSS d'entrée */
@import "tailwindcss";
@plugin "tailwindcss-primeui";

@custom-variant dark (&:where(.app-dark, .app-dark *));   /* même sélecteur que darkModeSelector */

@theme {
  --font-sans: 'Inter Variable', system-ui, sans-serif;
}

/* ❌ v3 : directives et config JS */
@tailwind base;
```
