---
paths:
  - "release-please-config.json"
  - ".release-please-manifest.json"
  - "CHANGELOG.md"
---

# release-please — Manifest & versionnement

## À faire
- Déclarer un seul package racine : l'application est un livrable unique, trois packages liés produiraient trois changelogs et trois tags
- Lister les quatre fichiers de version dans `extra-files` et vérifier après la première release qu'ils portent tous la même
- Laisser `tauri.conf.json` hors d'`extra-files` : son champ `version` vaut `"../package.json"`, Tauri acceptant un chemin plutôt qu'un littéral. Une source de vérité de moins à synchroniser
- Viser `$.project.version` pour un `pyproject.toml` en PEP 621, le `jsonpath` dépendant du backend de build
- Garder `include-component-in-tag: false` pour des tags `vX.Y.Z`, ce qu'attendent l'updater et le workflow
- Nommer le type de commit selon Conventional Commits : `fix:` bump le patch, `feat:` la mineure, `feat!:` ou un pied `BREAKING CHANGE:` la majeure, `chore(deps):` ne bumpe pas mais entre au changelog
- Relire le changelog de la PR de release avant merge : c'est le seul moment où un commit mal typé se rattrape
- Passer l'output `version` en `release` des deux SDK Sentry et en version affichée dans l'application (cf. [sentry/python.md](../sentry/python.md))

## À éviter
- Oublier un fichier de version dans `extra-files` : l'installeur annonce une version et le manifeste updater une autre, sans que rien n'échoue
- Bumper une version à la main dans un des quatre fichiers : le manifest reprend la main au run suivant
- Committer hors convention : le commit disparaît du changelog sans avertissement
- Fermer et rouvrir la PR de release : elle se met à jour toute seule à chaque push sur la branche cible

## Gotchas
- Rien n'est publié tant que la PR de release n'est pas mergée : c'est le point de contrôle humain de la chaîne
- `bump-minor-pre-major` et `bump-patch-for-minor-pre-major` adoucissent le calcul sous 1.0.0, tous deux désactivés par défaut
- `separate-pull-requests` est à `false` par défaut, ce qui groupe tout dans une seule PR : le bon comportement ici
- Le flux `develop` → `main` n'est pas documenté, l'outil raisonnant sur une branche de vérité unique pilotée par `target-branch` : à valider sur un dépôt de test avant la première release
- En mode monorepo les outputs sont préfixés par le chemin : sans objet avec un package racine unique

> Le chaînage `needs:` du build sur `release_created`, la raison pour laquelle `on: push: tags` ne partirait jamais et les permissions du job sont dans [github-actions/events.md](../github-actions/events.md) et [github-actions/security-permissions.md](../github-actions/security-permissions.md). Les règles de nommage des commits ne s'auto-injectent sur aucun fichier : elles valent au moment d'écrire le message.

## Exemples
```json
// ✅ un package racine ; tauri.conf.json est absent, il pointe vers package.json
{
  "packages": {
    ".": {
      "release-type": "node",
      "include-component-in-tag": false,
      "extra-files": [
        { "type": "toml", "path": "src-tauri/Cargo.toml", "jsonpath": "$.package.version" },
        { "type": "toml", "path": "sidecar/pyproject.toml", "jsonpath": "$.project.version" }
      ]
    }
  }
}
```
