---
title: "Renovate — Mise à jour des dépendances"
version: "44.51.0"
description: "Référence technique pour Renovate : une config pour trois gestionnaires, packageRules, lockFileMaintenance, limites de PR et cohabitation avec release-please."
date: "2026-08-29"
keywords: ["renovate", "dependances", "pnpm", "uv", "cargo", "github-actions"]
scope: ["docs"]
technologies: ["pnpm", "uv", "Rust", "GitHub Actions", "release-please"]
---

# Description

Automatise les montées de dépendances. Il remplace Dependabot pour une raison précise : **une seule configuration couvre les quatre gestionnaires du dépôt** — `npm` pour `src/`, `pep621` pour `sidecar/` (uv), `cargo` pour `src-tauri/` et `github-actions` pour `.github/`.

Point qui compte pour ce projet : **la régénération des lockfiles est déléguée aux CLI elles-mêmes** (`pnpm`, `uv`, `cargo`), ce qui rend Renovate insensible à leur format.

---

# Concepts Clés

## Une configuration, quatre gestionnaires

### Description

Les gestionnaires se détectent par pattern de fichier. Aucune configuration par sous-dossier n'est nécessaire.

### Exemple

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended", "helpers:pinGitHubActionDigests"],
  "semanticCommits": "enabled",
  "dependencyDashboard": true,
  "prConcurrentLimit": 5,
  "prHourlyLimit": 2
}
```

### Points Importants

- **`config:recommended` apporte déjà l'essentiel** : tableau de bord, groupement des monorepos, remplacements connus, contournements
- La détection se fait sur `package.json`, `pyproject.toml`, `Cargo.toml` et `.github/workflows/*.yml` : rien à déclarer
- `helpers:pinGitHubActionDigests` épingle les actions par SHA tout en gardant le tag lisible en commentaire
- **Une action déjà épinglée sur un SHA nu sans commentaire de version ne sera pas mise à jour** : conserver le commentaire

---

## `packageRules` par zone

### Description

Grouper les mises à jour par zone limite le nombre de PR et rend chacune relisible.

### Exemple

```json
{
  "packageRules": [
    { "matchManagers": ["npm"],            "groupName": "frontend (src/)",  "semanticCommitType": "fix" },
    { "matchManagers": ["pep621"],         "groupName": "sidecar (uv)",     "semanticCommitType": "fix" },
    { "matchManagers": ["cargo"],          "groupName": "tauri (rust)",     "semanticCommitType": "fix" },
    { "matchManagers": ["github-actions"], "groupName": "github actions",   "semanticCommitType": "chore" },
    { "matchUpdateTypes": ["minor", "patch"], "automerge": true, "automergeType": "pr" },
    { "matchUpdateTypes": ["major"], "automerge": false }
  ]
}
```

### Points Importants

- **Séparer les majeures du reste** : une majeure demande une lecture du changelog, un patch non
- `semanticCommitType: "fix"` sur les dépendances de production les fait apparaître au changelog ; `"chore"` sur l'outillage les en sort
- **L'automerge n'a de sens que si la CI couvre réellement le risque** : lint, typecheck et tests des trois zones
- Une majeure de PrimeNG, d'Angular ou de Tauri touche à des contrats documentés dans `docs/knowledges/` : la fiche correspondante se relit en même temps que la PR

---

## `lockFileMaintenance`

### Description

Rafraîchit les lockfiles indépendamment des montées de version directes, ce qui met à jour les transitives.

### Exemple

```json
{
  "lockFileMaintenance": {
    "enabled": true,
    "schedule": ["before 4am on monday"]
  }
}
```

### Points Importants

- **Sans elle, les dépendances transitives ne bougent jamais** tant qu'une directe ne les tire pas
- La planifier hors des heures de travail évite d'ajouter du bruit en pleine session
- La régénération passe par les CLI (`pnpm install`, `uv lock`, `cargo update`) : le format des lockfiles n'est pas réimplémenté par Renovate

---

## Cohabitation avec release-please

### Description

release-please lit les Conventional Commits. Les commits de Renovate doivent donc s'y conformer, sinon ils disparaissent du changelog.

### Exemple

```json
{
  "semanticCommits": "enabled",
  "packageRules": [
    { "matchManagers": ["github-actions"], "semanticCommitType": "chore" }
  ]
}
```

### Points Importants

- **`semanticCommits` est le bon levier**, pas `commitMessagePrefix` : le premier produit un `type(scope):` conforme, le second n'est qu'un préfixe libre
- `semanticCommitType` décide de ce qui apparaît au changelog : `fix` oui, `chore` non
- **Aucune documentation officielle ne traite ce couple** : le comportement se vérifie sur une PR de test avant de l'automatiser
- Une PR Renovate automergée déclenche la CI puis met à jour la PR de release : les deux mécanismes s'enchaînent sans intervention

---

## Limites et tableau de bord

### Description

Sans bornes, Renovate ouvre autant de PR qu'il trouve de mises à jour, ce qui sature la CI d'un dépôt à quatre gestionnaires.

### Points Importants

- **`prConcurrentLimit` et `prHourlyLimit` cadrent le débit** : les mises à jour non ouvertes attendent, elles ne sont pas perdues
- `dependencyDashboard` crée une issue listant tout ce qui est en attente, et permet de déclencher une PR à la demande
- **Le tableau de bord est le bon endroit pour voir ce qui est retenu** par les limites, plutôt que de les relever

---

## Limites connues côté uv

### Description

Le gestionnaire `pep621` couvre uv, avec deux frictions documentées.

### Points Importants

- **La régénération du lockfile échoue si le dépôt a des dépendances privées** non résolubles publiquement : sans objet ici, toutes les dépendances du sidecar venant de PyPI
- Renovate traite `tool.uv.index.name` comme requis alors qu'il est optionnel côté uv : à connaître si un index alternatif est ajouté un jour
- Le reste du fonctionnement (détection, PEP 735, régénération par la CLI) est nominal

---

# Bonnes Pratiques

## ✅ Recommandations

- **Partir de `config:recommended`** et n'ajouter que ce qui manque
- **Grouper par zone** pour que chaque PR reste relisible
- **Activer `semanticCommits`** et fixer le `semanticCommitType` par groupe, pour un changelog propre
- **Vérifier le format des messages sur une PR de test** avant d'automatiser quoi que ce soit
- **Activer `lockFileMaintenance` avec un créneau**, sinon les transitives se figent
- **Relire la fiche `knowledges/` correspondante** en même temps qu'une PR de montée majeure

## ❌ Anti-Patterns

- **Automerger les majeures** : un contrat documenté peut avoir changé
- **Utiliser `commitMessagePrefix` pour la conformité Conventional** : c'est `semanticCommits` qui produit le bon format
- **Relever les limites de PR** au lieu de consulter le tableau de bord
- **Écrire une configuration Renovate par sous-dossier** : une seule suffit pour les quatre gestionnaires
- **Épingler une action sur un SHA nu sans commentaire de version** : elle ne sera plus mise à jour
- **Laisser Dependabot actif en parallèle** : deux robots ouvriraient des PR concurrentes sur les mêmes dépendances

---

# 🔗 Ressources

## Documentation Officielle

- [Renovate — options de configuration](https://docs.renovatebot.com/configuration-options/)
- [Presets](https://docs.renovatebot.com/presets-config/)
- [Gestionnaires : npm](https://docs.renovatebot.com/modules/manager/npm/) · [pep621](https://docs.renovatebot.com/modules/manager/pep621/) · [cargo](https://docs.renovatebot.com/modules/manager/cargo/) · [github-actions](https://docs.renovatebot.com/modules/manager/github-actions/)
- [Automerge](https://docs.renovatebot.com/key-concepts/automerge/) · [Dependency Dashboard](https://docs.renovatebot.com/key-concepts/dashboard/)

## Ressources Complémentaires

- [Intégration uv × Renovate](https://docs.astral.sh/uv/guides/integration/renovate/)
- [release-please.md](release-please.md) — Conventional Commits et changelog
- [VERSIONS.md](../VERSIONS.md) — versions épinglées du projet
