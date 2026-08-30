---
paths:
  - "eslint.config.js"
  - ".prettierrc"
---

# angular-eslint — Configuration du lint

## À faire
- Écrire une flat config à deux blocs, TypeScript puis HTML dans cet ordre
- Poser `processor: angular.processInlineTemplates` sur le bloc TypeScript, sans quoi les templates inline échappent aux règles HTML et le composant passe le lint sans que son template soit vérifié
- Étendre `angular.configs.templateRecommended` **et** `angular.configs.templateAccessibility` : les règles d'accessibilité ne sont pas dans le preset recommandé
- Activer le typed linting par `parserOptions.projectService: true`, qui remplace `project: true` depuis typescript-eslint v8
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
- Reprendre une configuration `prefer-on-push-component-change-detection` écrite avant Angular 22 : la règle vise désormais l'inverse
- Mélanger CommonJS et ESM dans le fichier de config : le scaffold généré peut différer de la documentation, les deux fonctionnent séparément

## Gotchas
- `prefer-on-push-component-change-detection` a changé de sens en v22 : OnPush étant le défaut implicite, la règle ne réclame plus la déclaration explicite mais cible les opt-out (`Default` / `Eager`)
- `prefer-standalone` rejette `standalone: false`, et `inject-at-top` comme `require-switch-default` sont apparues en 22.1.0
- Un fichier hors du périmètre des tsconfig produit une erreur de parsing, pas une violation de règle : `--exit-on-fatal-error` force le code de sortie 2 et distingue une config cassée d'un code fautif
- Codes de sortie : 0 succès, 1 violations ou dépassement du seuil de warnings, 2 problème de configuration
- Le typed linting est plus lent : c'est le coût de règles qui raisonnent sur les types plutôt que sur la syntaxe
- `typescript-eslint` contraint TypeScript sous la borne 6.1 (cf. [types.md](../typescript/types.md)), et Prettier 3.9.4 reformate `@content(name)` en `@content (name)` côté parser Angular
- `npx eslint-config-prettier <fichier>` diagnostique les règles encore en conflit sans rien écrire
