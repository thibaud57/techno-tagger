---
title: "release-please : Versionnement et publication"
version: "5.0.0"
description: "Référence technique pour release-please-action : Conventional Commits, PR de release, synchronisation de quatre fichiers de version (mode manifest, extra-files, renvoi Tauri) et chaînage needs obligatoire."
date: "2026-08-29"
keywords: ["release-please", "conventional-commits", "versioning", "changelog", "github-actions", "tauri"]
scope: ["docs"]
technologies: ["GitHub Actions", "Tauri", "Dependabot"]
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
chore(deps): bump httpx2 to 2.12.0             → aucun bump, aucune entrée de changelog
```

### Points Importants

- **Un `BREAKING CHANGE:` en pied de commit vaut aussi majeure**, comme le `!`
- `bump-minor-pre-major` et `bump-patch-for-minor-pre-major` adoucissent le calcul tant que la version est sous 1.0.0, tous deux désactivés par défaut
- **Un commit hors convention ne produit aucune entrée** : il disparaît du changelog sans avertir
- **`chore`, `docs`, `style`, `refactor`, `test`, `build` et `ci` sont masqués du changelog par défaut** : seuls `feat`, `fix`, `perf` et `revert` y entrent tant que `changelog-sections` n'est pas posé (preset `conventional-changelog-conventionalcommits` 6.1.0 que tire release-please, `hidden: true` dans `writer-opts.js`, relevé le 2026-10-28)
- Les PR de Dependabot ciblent `develop` et disparaissent dans le squash `develop → main` : seul le titre de cette PR-là compte pour release-please

---

## PR de release

### Description

release-please maintient une PR persistante, mise à jour à chaque push sur la branche cible. Elle porte le bump de version et le changelog. **La merger déclenche le tag et la Release.**

### Exemple

```bash
# Titre généré par release-please, visible dans l'historique du dépôt :
# chore(main): release 0.1.0 (#11)

# Merge sans modification : c'est ce merge qui crée le tag vX.Y.Z
gh pr merge <numero> --squash
```

### Points Importants

- **Rien n'est publié tant que la PR n'est pas mergée** : c'est le point de contrôle humain de la chaîne de release
- La PR se met à jour toute seule à chaque commit : inutile de la fermer et de la rouvrir
- `separate-pull-requests` est à `false` par défaut, ce qui groupe tout dans une seule PR : le bon comportement ici, l'application étant un seul livrable
- Le changelog généré se relit avant merge : c'est le moment de repérer un commit mal typé

---

## Forcer une version

### Description

`Release-As: X.Y.Z` impose la version de la prochaine PR de release. Il se lit dans le **corps d'un commit** de la branche de production, jamais dans la description de la pull request : « When a commit to the main branch has `Release-As: x.x.x` (case insensitive) in the commit body, Release Please will open a new pull request for the specified version ».

### Exemple

```bash
# Commit vide de rattrapage sur la branche de production
git commit --allow-empty -m "chore: forcer la version" -m "Release-As: X.Y.Z"

# Merge de la PR develop -> main avec un corps explicite
gh pr merge <numero> --squash --body "<une ligne>"
```

### Points Importants

- **Le corps du commit final dépend du réglage `squash_merge_commit_message` du dépôt** : en `COMMIT_MESSAGES`, le texte tapé dans la description de la PR n'atteint jamais le commit et le footer reste sans effet, silencieusement. Le poser dans l'éditeur de message au moment du squash, ou passer le dépôt en `PR_BODY`
- **Le corps auto-généré par GitHub liste tous les commits de la PR** : en GitFlow, chaque squash précédent ayant créé un SHA neuf sur `main`, les commits d'origine de `develop` y restent « absents » et sont re-listés à chaque release. release-please relit alors des `BREAKING CHANGE:` déjà publiés et bumpe en majeure à tort (constaté sur techno-scraper, deux majeures indues). D'où le corps explicite au merge
- **Rattrapage a posteriori d'une version indue** : un commit vide portant `Release-As: X.Y.Z` sur la branche de production

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
        { "type": "toml", "path": "sidecar/pyproject.toml",    "jsonpath": "$.project.version" },
        { "type": "toml", "path": "sidecar/uv.lock",           "jsonpath": "$.package[?(@.name.value=='tagger')].version" },
        { "type": "toml", "path": "src-tauri/Cargo.lock",      "jsonpath": "$.package[?(@.name.value=='techno-tagger')].version" }
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
- **Un lockfile porte la version du package local dans un tableau `[[package]]`** : il se cible par un filtre sur le nom, écrit `@.name.value` et non `@.name`. L'updater TOML parse avec `TaggedTOMLParser`, qui enveloppe chaque scalaire dans `{start, end, value}` pour réécrire la valeur sans toucher au reste du fichier. `@.name=='tagger'` ne matche donc rien et rend `No entries modified` sans échouer. Recette de [release-please#2455](https://github.com/googleapis/release-please/issues/2455), vérifiée le 2026-10-28 sur release-please 17.6.0 (celle qu'embarque l'action 5.0.0) et 17.11.2
- **Le support natif d'`uv.lock` ([release-please#2693](https://github.com/googleapis/release-please/pull/2693), ouverte au 2026-10-28) ne vise que la stratégie `python`** : en `release-type: node`, l'extra-file reste nécessaire même après son merge. Aucun support natif de `Cargo.lock` hors stratégie `rust`

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
    runs-on: ubuntu-24.04
    outputs:
      release_created: ${{ steps.release.outputs.release_created }}
      tag_name: ${{ steps.release.outputs.tag_name }}
    steps:
      - uses: googleapis/release-please-action@<sha> # v5.0.0
        id: release
        with:
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json

  build:
    needs: release-please
    if: needs.release-please.outputs.release_created == 'true'
    runs-on: windows-2025      # PyInstaller + tauri build : pas de cross-compilation
    steps:
      - uses: actions/checkout@<sha> # v7.0.1
        with:
          ref: ${{ needs.release-please.outputs.tag_name }}
      # build du sidecar, tauri build, signature, upload des artefacts
```

### Points Importants

- **Le job de build tourne dans le run déclenché par le push sur `main`**, pas par un nouveau déclencheur sur tag : c'est ce qui contourne la limitation
- **`if: needs.release-please.outputs.release_created`** évite de builder à chaque push
- Le `checkout` doit viser `tag_name`, sinon le build part du dernier commit et non de la version publiée
- **Le token de GitHub App** (`actions/create-github-app-token`, `id: app-token`, passé en `token:`) restaurerait les déclencheurs sur tag, mais le chaînage `needs:` reste le choix : le build reçoit directement les outputs de release-please. L'App sert à lancer la CI de la PR de release sans approbation manuelle
- Le runner est Windows (`windows-2025`, image figée) par nécessité, PyInstaller ne cross-compilant pas (cf. [pyinstaller.md](pyinstaller.md))

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

- **Lister dans `extra-files` les fichiers que `release-type: node` ne couvre pas** (`Cargo.toml`, `pyproject.toml` et leurs lockfiles) et vérifier après la première release qu'ils portent bien la même version que `package.json` ; `tauri.conf.json` reste hors d'`extra-files`, son champ `version` pointant vers `../package.json`
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
- **Ajouter un PAT** : le token de la GitHub App est borné au dépôt, expire au bout d'une heure et n'est lié à aucun compte

---

# 🔗 Ressources

## Documentation Officielle

- [release-please-action](https://github.com/googleapis/release-please-action)
- [Mode manifest](https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md)
- [Personnalisation et `extra-files`](https://github.com/googleapis/release-please/blob/main/docs/customizing.md)
- [Déclencher un workflow depuis un workflow](https://docs.github.com/en/actions/using-workflows/triggering-a-workflow)

## Ressources Complémentaires

- [Conventional Commits](https://www.conventionalcommits.org/)
- [PRODUCTION.md](../PRODUCTION.md) : pipelines et secrets
- [pyinstaller.md](pyinstaller.md) · [sentry.md](sentry.md)
