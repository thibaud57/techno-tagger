---
title: "angular-eslint — Lint du frontend"
version: "22.1.0"
description: "Référence technique pour angular-eslint : flat config obligatoire, blocs TS et HTML, typed linting par projectService, règles Angular notables et cohabitation avec Prettier."
date: "2026-08-29"
keywords: ["angular-eslint", "eslint", "flat-config", "typed-linting", "a11y", "prettier"]
scope: ["docs"]
technologies: ["Angular", "TypeScript", "Prettier"]
---

# Description

Lint du frontend Angular : règles de la plateforme, règles de template et accessibilité. Sa version majeure suit celle d'Angular, la 22.1.0 accompagnant Angular 22.

Deux points structurent la configuration : **ESLint 9 impose la flat config** (`.eslintrc` a disparu) et **les templates HTML se lintent dans un bloc séparé** de celui des fichiers TypeScript.

---

# Concepts Clés

## Flat config à deux blocs

### Description

Un bloc pour les fichiers TypeScript, un bloc pour les templates HTML. Le processeur `processInlineTemplates` fait passer les templates inline des composants dans les règles de template.

### Exemple

```javascript
// eslint.config.js
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

module.exports = tseslint.config(
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...tseslint.configs.stylistic,
      ...angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/component-selector': ['error', { type: 'element', prefix: 'app', style: 'kebab-case' }],
      '@angular-eslint/directive-selector': ['error', { type: 'attribute', prefix: 'app', style: 'camelCase' }],
    },
  },
  {
    files: ['**/*.html'],
    extends: [
      ...angular.configs.templateRecommended,
      ...angular.configs.templateAccessibility,
    ],
  },
);
```

### Points Importants

- **`.eslintrc` n'est plus lu** : une configuration héritée d'un projet en ESLint 8 est simplement ignorée, sans erreur
- **Sans `processor: angular.processInlineTemplates`, les templates inline échappent aux règles HTML** : le composant passe le lint alors que son template ne le mérite pas
- L'ordre compte : le bloc HTML après le bloc TypeScript
- Le scaffold généré par `ng add angular-eslint` peut être en ESM (`import` / `export default`) là où la documentation montre du CommonJS : les deux fonctionnent, ne pas mélanger dans un même fichier

---

## Typed linting par `projectService`

### Description

Certaines règles ont besoin des types. `projectService` réutilise les tsconfig du projet, sans en créer un dédié au lint.

### Exemple

```javascript
languageOptions: {
  parserOptions: {
    projectService: true,
    tsconfigRootDir: __dirname,
  },
},
```

### Points Importants

- **`projectService` remplace `project: true`** depuis typescript-eslint v8
- **`tsconfigRootDir` est important dans ce dépôt** : `src/`, `src-tauri/` et `sidecar/` cohabitent, et un mauvais ancrage résout le mauvais tsconfig
- Le typed linting est plus lent : c'est le coût de règles qui raisonnent sur les types plutôt que sur la syntaxe
- Un fichier hors du périmètre des tsconfig produit une erreur de parsing, pas une violation de règle : le distinguer au diagnostic

---

## Règles Angular notables

### Description

Trois règles portent des décisions du projet, au-delà du style.

### Points Importants

- **`prefer-standalone`** : rejette `standalone: false`, cohérent avec une base entièrement standalone
- **`prefer-on-push-component-change-detection` a changé de sens en v22** : Angular 22 faisant d'OnPush le défaut implicite, la règle ne réclame plus une déclaration explicite mais **cible les opt-out** (`Default` / `Eager`). Une règle ou une documentation interne écrite avant Angular 22 dit l'inverse
- **`component-selector` et `directive-selector`** fixent le préfixe : `app` par défaut, aligné sur le CLI
- Le jeu `templateAccessibility` couvre `alt-text`, `click-events-have-key-events`, `interactive-supports-focus`, `label-has-associated-control`, `role-has-required-aria` et d'autres : utile sur une interface pilotée majoritairement à la souris, où l'accessibilité clavier se perd facilement
- `inject-at-top` et `require-switch-default` sont apparues en 22.1.0

---

## Cohabitation avec Prettier

### Description

Prettier formate, ESLint vérifie. `eslint-config-prettier` désactive les règles stylistiques qui se contrediraient.

### Exemple

```javascript
const eslintConfigPrettier = require('eslint-config-prettier/flat');

module.exports = tseslint.config(
  // ...blocs TS et HTML
  eslintConfigPrettier,   // toujours en dernier
);
```

### Points Importants

- **Le bloc Prettier va en dernier** : il désactive, donc tout ce qui vient après le rétablirait
- `npx eslint-config-prettier <fichier>` diagnostique les règles encore en conflit, sans rien écrire
- **Ne pas faire tourner Prettier comme une règle ESLint** : deux outils au même endroit ralentissent le lint pour un résultat identique

---

# Commandes Clés

## Lint

### Description

En local et en CI. Le `--fix` reste local.

### Syntaxe

```bash
pnpm exec ng lint                                   # via le builder Angular
pnpm exec eslint . --fix                            # correction locale
pnpm exec eslint . --max-warnings 0 --format json   # CI
pnpm exec eslint . --cache --cache-strategy content # relint des seuls fichiers modifiés
```

### Points Importants

- **Codes de sortie** : 0 succès, 1 violations ou dépassement du seuil de warnings, 2 problème de configuration. `--exit-on-fatal-error` force le 2 sur une erreur de parsing, ce qui distingue une config cassée d'un code fautif
- **`--max-warnings 0` en CI** : sinon les warnings s'accumulent sans jamais bloquer
- **Pas de `--fix` en CI** : elle vérifie, elle ne réécrit pas
- `ng lint` passe par le builder ; `eslint` direct est plus rapide et plus explicite pour un job CI

---

# Bonnes Pratiques

## ✅ Recommandations

- **Garder `processor: angular.processInlineTemplates`** pour que les templates inline soient lintés
- **Ancrer `tsconfigRootDir` explicitement** dans un dépôt à plusieurs zones
- **Placer `eslint-config-prettier/flat` en dernier**
- **Utiliser `--max-warnings 0` en CI** pour que les warnings soient traités
- **Garder le jeu `templateAccessibility`** : l'interface se pilote surtout à la souris, c'est justement là que le clavier se perd
- **Relire les règles de détection de changement à la lumière d'Angular 22** avant de reprendre une configuration antérieure

## ❌ Anti-Patterns

- **Conserver un `.eslintrc`** : il n'est plus lu, et rien ne le signale
- **Omettre le processeur de templates inline** : les composants passent le lint sans que leur template soit vérifié
- **Faire tourner Prettier via une règle ESLint** : redondant et lent
- **Lancer `eslint --fix` en CI** : des corrections non relues se committent
- **Désactiver une règle d'accessibilité** faute de savoir la satisfaire : la corriger coûte généralement une ligne
- **Reprendre une configuration `prefer-on-push-component-change-detection`** écrite avant Angular 22 : la règle vise désormais l'inverse

---

# 🔗 Ressources

## Documentation Officielle

- [angular-eslint](https://github.com/angular-eslint/angular-eslint)
- [Configurer ESLint](https://github.com/angular-eslint/angular-eslint/blob/main/docs/CONFIGURING_ESLINT.md)
- [Support des versions Angular](https://github.com/angular-eslint/angular-eslint/blob/main/docs/ANGULAR_VERSION_SUPPORT.md)
- [Règles de template](https://github.com/angular-eslint/angular-eslint/tree/main/packages/eslint-plugin-template/docs/rules)

## Ressources Complémentaires

- [typescript-eslint — projectService](https://typescript-eslint.io/blog/project-service/)
- [eslint-config-prettier](https://github.com/prettier/eslint-config-prettier)
- [typescript.md](typescript.md) — contrainte de version
