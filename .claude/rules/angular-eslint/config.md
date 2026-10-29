---
paths:
  - "eslint.config.js"
  - ".prettierrc"
---

# angular-eslint : configuration du lint

## À faire
- Activer le typed linting (`parserOptions.projectService: true`) **et** étendre `strictTypeChecked` plus `stylisticTypeChecked` : `projectService` seul n'active aucune règle typée
- Fixer les préfixes par `component-selector` et `directive-selector`, alignés sur le CLI
- Installer par `ng add angular-eslint` (le paquet umbrella), pas par les paquets `@angular-eslint/*` séparés
- Passer `--max-warnings 0` en CI, sinon les warnings s'accumulent sans jamais bloquer

## À éviter
- Conserver un `.eslintrc` : il n'est plus lu et rien ne le signale
- Faire tourner Prettier comme une règle ESLint : deux outils au même endroit ralentissent le lint pour un résultat identique
- `eslint --fix` en CI : elle vérifie, elle ne réécrit pas et des corrections non relues se committeraient
- Désactiver une règle d'accessibilité faute de savoir la satisfaire : la corriger coûte généralement une ligne
- Mélanger CommonJS et ESM dans le fichier de config

## Gotchas
- `prefer-on-push-component-change-detection` a changé de sens en v22 : OnPush étant implicite, la règle cible les opt-out (`Default` / `Eager`). Une config antérieure à la v22 vise l'inverse
- `prefer-standalone` rejette `standalone: false` et depuis 22.6.0 `allowExplicitStandalone: false` signale aussi `standalone: true` comme redondant ; `inject-at-top` et `require-switch-default` existent depuis 22.1.0
- Un fichier hors des tsconfig produit une erreur de parsing, pas une violation : `--exit-on-fatal-error` sort en code 2 et distingue une config cassée d'un code fautif
- `npx eslint-config-prettier <fichier>` liste les règles encore en conflit
