---
paths:
  - "eslint.config.js"
  - ".prettierrc"
---

# angular-eslint — Configuration du lint

## À faire
- Écrire une flat config à deux blocs, TypeScript puis HTML dans cet ordre
- Poser `processor: angular.processInlineTemplates` sur le bloc TypeScript, sans quoi les templates inline échappent au lint
- Étendre `angular.configs.templateRecommended` **et** `angular.configs.templateAccessibility` : l'accessibilité n'est pas dans le preset recommandé
- Activer le typed linting (`parserOptions.projectService: true`) **et** étendre `strictTypeChecked` plus `stylisticTypeChecked` : `projectService` seul n'active aucune règle typée
- Régler `@typescript-eslint/no-extraneous-class` avec `allowWithDecorator: true` : un composant sans logique est une classe vide décorée, ce que le preset strict interdit par défaut
- Ancrer `tsconfigRootDir` explicitement : `src/`, `src-tauri/` et `sidecar/` cohabitent, un mauvais ancrage résout le mauvais tsconfig
- Fixer les préfixes par `component-selector` et `directive-selector`, alignés sur le CLI
- Placer `eslint-config-prettier/flat` en dernier : il désactive, donc tout bloc placé après le rétablirait
- Installer par `ng add angular-eslint` (le paquet umbrella), pas par les paquets `@angular-eslint/*` séparés
- Passer `--max-warnings 0` en CI, sinon les warnings s'accumulent sans jamais bloquer

## À éviter
- Conserver un `.eslintrc` : il n'est plus lu, et rien ne le signale
- Faire tourner Prettier comme une règle ESLint : deux outils au même endroit ralentissent le lint pour un résultat identique
- `eslint --fix` en CI : elle vérifie, elle ne réécrit pas, et des corrections non relues se committeraient
- Désactiver une règle d'accessibilité faute de savoir la satisfaire : la corriger coûte généralement une ligne
- Mélanger CommonJS et ESM dans le fichier de config

## Gotchas
- `prefer-on-push-component-change-detection` a changé de sens en v22 : OnPush étant implicite, la règle cible les opt-out (`Default` / `Eager`). Une config antérieure à la v22 vise l'inverse
- `prefer-standalone` rejette `standalone: false` ; `inject-at-top` et `require-switch-default` existent depuis 22.1.0
- Un fichier hors des tsconfig produit une erreur de parsing, pas une violation : `--exit-on-fatal-error` sort en code 2 et distingue une config cassée d'un code fautif
- `typescript-eslint` contraint TypeScript sous 6.1 (cf. [types.md](../typescript/types.md))
- Prettier 3.9.4 reformate `@content(name)` en `@content (name)` côté parser Angular
- `npx eslint-config-prettier <fichier>` liste les règles encore en conflit
