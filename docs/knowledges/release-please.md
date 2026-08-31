---
title: "release-please — Versionnement et publication"
version: "5.0.0"
description: "Référence technique pour release-please-action : Conventional Commits, PR de release, synchronisation de quatre fichiers de version (mode manifest, extra-files, renvoi Tauri) et chaînage needs obligatoire."
date: "2026-08-29"
keywords: ["release-please", "conventional-commits", "versioning", "changelog", "github-actions", "tauri"]
scope: ["docs"]
technologies: ["GitHub Actions", "Tauri", "Renovate"]
---

# Description

Automatise le versionnement et la publication : lecture des Conventional Commits, calcul de la version, changelog, PR de release, tag et GitHub Release.

Deux particularités du projet dictent sa configuration : **quatre fichiers portent la version** (`package.json`, `Cargo.toml`, `tauri.conf.json`, `pyproject.toml`) et doivent rester synchronisés pour l'updater Tauri ; et **le job de build doit être chaîné en `needs:`**, un push de tag par `GITHUB_TOKEN` ne figurant pas dans les exceptions qui déclenchent un workflow.

L'action 5.0.0 tourne sur Node 24.

---

# Concepts Clés

## Conventional Commits et calcul de version

### Description

Le type du commit décide du bump. C'est le seul intrant du calcul.

### Exemple

```
fix: gestion du 504 sans retry immédiat        → patch  (1.4.1 → 1.4.2)
feat: rattrapage par URL SoundCloud            → minor  (1.4.2 → 1.5.0)
feat!: nouveau format du plan de run           → major  (1.5.0 → 2.0.0)
chore(deps): bump httpx2 to 2.12.0             → aucun bump, entrée de changelog
```

### Points Importants

- **Un `BREAKING CHANGE:` en pied de commit vaut aussi majeure**, comme le `!`
- `bump-minor-pre-major` et `bump-patch-for-minor-pre-major` adoucissent le calcul tant que la version est sous 1.0.0, tous deux désactivés par défaut
- **Un commit hors convention ne produit aucune entrée** : il disparaît du changelog sans avertir
- Les PR de Renovate doivent donc respecter la convention (cf. [renovate.md](renovate.md))

---

## PR de release

### Description

release-please maintient une PR persistante, mise à jour à chaque push sur la branche cible. Elle porte le bump de version et le changelog. **La merger déclenche le tag et la Release.**

### Points Importants

- **Rien n'est publié tant que la PR n'est pas mergée** : c'est le point de contrôle humain de la chaîne de release
- La PR se met à jour toute seule à chaque commit : inutile de la fermer et de la rouvrir
- `separate-pull-requests` est à `false` par défaut, ce qui groupe tout dans une seule PR — le bon comportement ici, l'application étant un seul livrable
- Le changelog généré se relit avant merge : c'est le moment de repérer un commit mal typé

---

## Mode manifest et `extra-files`

### Description

Le mode manifest est nécessaire dès qu'un fichier de version sort du fichier principal. Pour ce projet, trois des quatre en sortent.

### Exemple

```json
// release-please-config.json
{
  "packages": {
    ".": {
      "release-type": "node",
      "include-component-in-tag": false,
      "extra-files": [
        { "type": "toml", "path": "src-tauri/Cargo.toml",      "jsonpath": "$.package.version" },
        { "type": "toml", "path": "sidecar/pyproject.toml",    "jsonpath": "$.project.version" }
      ]
    }
  }
}
```

```json
// .release-please-manifest.json
{ ".": "0.0.0" }
```

### Points Importants

- **`tauri.conf.json` reste hors d'`extra-files`** : son champ `version` vaut `"../package.json"`, la doc Tauri acceptant « a semver version number or a path to a `package.json` file ». Une source de vérité de moins à synchroniser. L'alternative, un littéral bumpé par `extra-files` avec un `jsonpath` (aucun `release-type: tauri` n'existe), marche aussi mais ajoute un fichier au problème
- **`include-component-in-tag: false` donne un tag `vX.Y.Z`** au lieu de `<composant>-vX.Y.Z` : c'est ce qu'attendent l'updater et le workflow
- **Un fichier de version oublié dans `extra-files` produit une désynchronisation silencieuse** : l'installeur annonce une version, le manifeste updater une autre
- Un seul package racine plutôt que trois packages liés : l'application est un livrable unique, pas trois bibliothèques indépendantes. Trois packages produiraient trois changelogs et trois tags
- Le `jsonpath` d'un `pyproject.toml` dépend du backend de build (`$.project.version` en PEP 621)

---

## Chaînage `needs:` obligatoire

### Description

**C'est le point critique.** Un tag ou une release créés avec le `GITHUB_TOKEN` par défaut ne déclenchent aucun workflow : les seules exceptions de GitHub sont `workflow_dispatch`, `repository_dispatch` et les `pull_request` `opened` / `synchronize` / `reopened`, ces derniers en état approval-required. Un fichier séparé écoutant `on: push: tags` ne partirait jamais, sans erreur, laissant une Release vide qu'aucun updater ne verrait.

### Exemple

```yaml
on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    outputs:
      release_created: ${{ steps.release.outputs.release_created }}
      tag_name: ${{ steps.release.outputs.tag_name }}
    steps:
      - uses: googleapis/release-please-action@v5
        id: release
        with:
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json

  build:
    needs: release-please
    if: needs.release-please.outputs.release_created == 'true'
    runs-on: windows-latest      # PyInstaller + tauri build : pas de cross-compilation
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ needs.release-please.outputs.tag_name }}
      # build du sidecar, tauri build, signature, upload des artefacts
```

### Points Importants

- **Le job de build tourne dans le run déclenché par le push sur `main`**, pas par un nouveau déclencheur sur tag : c'est ce qui contourne la limitation
- **`if: needs.release-please.outputs.release_created`** évite de builder à chaque push
- Le `checkout` doit viser `tag_name`, sinon le build part du dernier commit et non de la version publiée
- **L'alternative est un PAT ou un token de GitHub App**, qui restaure les déclencheurs mais ajoute un secret à gérer : le chaînage évite ce secret
- Le runner est `windows-latest` par nécessité, PyInstaller ne cross-compilant pas (cf. [pyinstaller.md](pyinstaller.md))

---

## Outputs utiles

### Description

Les sorties de l'action pilotent la suite du workflow.

### Exemple

```yaml
release_created  # booléen, condition du job de build
tag_name         # v1.4.2, cible du checkout
version          # 1.4.2, à passer en release Sentry
upload_url       # dépôt des artefacts sur la Release
```

### Points Importants

- **`version` alimente la `release` des deux SDK Sentry** : c'est ce qui permet de corréler une erreur avec une livraison (cf. [sentry.md](sentry.md))
- `upload_url` sert à attacher l'installeur et le manifeste updater à la Release
- En mode monorepo, les sorties sont préfixées par le chemin : sans objet ici, le projet ayant un package racine unique

---

# Bonnes Pratiques

## ✅ Recommandations

- **Lister dans `extra-files` les deux fichiers que `release-type: node` ne couvre pas** (`Cargo.toml`, `pyproject.toml`) et vérifier après la première release qu'ils portent bien la même version que `package.json` ; `tauri.conf.json` reste hors d'`extra-files`, son champ `version` pointant vers `../package.json`
- **Chaîner le build en `needs:`** avec `if: release_created`, jamais sur `on: push: tags`
- **Checkouter `tag_name`** dans le job de build
- **Relire le changelog de la PR avant merge** : c'est le seul moment où un commit mal typé se rattrape
- **Passer `version` en release Sentry** et en version affichée dans l'application
- **Garder `include-component-in-tag: false`** pour des tags `vX.Y.Z` simples

## ❌ Anti-Patterns

- **Un workflow séparé déclenché par `on: push: tags`** : il ne partira jamais, et l'absence d'erreur rend le diagnostic long
- **Oublier un fichier de version dans `extra-files`** : l'updater et l'installeur divergent sans que rien n'échoue
- **Bumper une version à la main** dans un des quatre fichiers : le manifest reprend la main au run suivant
- **Committer hors convention** : le commit disparaît du changelog
- **Déclarer trois packages liés** pour un livrable unique : trois changelogs et trois tags à maintenir
- **Ajouter un PAT sans nécessité** : le chaînage `needs:` répond au même besoin sans secret supplémentaire

---

# 🔗 Ressources

## Documentation Officielle

- [release-please-action](https://github.com/googleapis/release-please-action)
- [Mode manifest](https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md)
- [Personnalisation et `extra-files`](https://github.com/googleapis/release-please/blob/main/docs/customizing.md)
- [Déclencher un workflow depuis un workflow](https://docs.github.com/en/actions/using-workflows/triggering-a-workflow)

## Ressources Complémentaires

- [Conventional Commits](https://www.conventionalcommits.org/)
- [PRODUCTION.md](../PRODUCTION.md) — pipelines et secrets
- [pyinstaller.md](pyinstaller.md) · [sentry.md](sentry.md) · [renovate.md](renovate.md)
