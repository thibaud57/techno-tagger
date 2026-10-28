---
paths:
  - "release-please-config.json"
  - ".release-please-manifest.json"
  - "CHANGELOG.md"
---

# release-please : manifest et versionnement

## À faire
- Déclarer un seul package racine : l'application est un livrable unique, trois packages liés produiraient trois changelogs et trois tags
- Lister dans `extra-files` les fichiers de version que le `release-type` ne traite pas lui-même et vérifier après la première release qu'ils portent tous la même
- Laisser `tauri.conf.json` hors d'`extra-files` : son champ `version` vaut `"../package.json"`, Tauri acceptant un chemin plutôt qu'un littéral. Une source de vérité de moins à synchroniser
- Viser `$.project.version` pour un `pyproject.toml` en PEP 621, le `jsonpath` dépendant du backend de build
- Garder `include-component-in-tag: false` pour des tags `vX.Y.Z`, ce qu'attendent l'updater et le workflow
- Nommer le type de commit selon Conventional Commits : `fix:` bump le patch, `feat:` la mineure, `feat!:` ou un pied `BREAKING CHANGE:` la majeure, `chore(deps):` ne bumpe pas et n'entre pas au changelog, `chore` étant masqué par défaut faute de `changelog-sections`
- Relire le changelog de la PR de release avant merge : c'est le seul moment où un commit mal typé se rattrape
- Passer l'output `version` à la release Sentry (`getsentry/action-release`) sous la forme `techno-tagger@X.Y.Z` que posent les deux SDK, qui lisent eux la version du build (cf. [sentry/python.md](../sentry/python.md))

## À éviter
- Oublier un fichier de version dans `extra-files` : l'installeur annonce une version et le manifeste updater une autre, sans que rien n'échoue
- Bumper une version à la main dans un des fichiers de version : le manifest reprend la main au run suivant
- Committer hors convention : le commit disparaît du changelog sans avertissement
- Fermer et rouvrir la PR de release : elle se met à jour toute seule à chaque push sur la branche cible

## Gotchas
- Rien n'est publié tant que la PR de release n'est pas mergée : c'est le point de contrôle humain de la chaîne
- Le flux `develop → main` convient : le squash-merge de la PR est un commit ordinaire de `main`

> Chaînage du build et permissions : [github-actions/events.md](../github-actions/events.md), [github-actions/security-permissions.md](../github-actions/security-permissions.md).

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
