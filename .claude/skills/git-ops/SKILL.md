---
name: git-ops
description: Applique les conventions git de techno-tagger (branches, messages de commit, PR, versionnement). À utiliser pour créer une branche, écrire un message de commit, ouvrir ou merger une PR.
disable-model-invocation: true
allowed-tools: Bash(git *), Bash(gh *)
---

# git-ops - Conventions git

Ta mission est de respecter le flux de branches et le format de commits dont dépend toute la chaîne de release.

## Branches

| Branche | Rôle |
|---------|------|
| `main` | Production. N'avance que par PR, et c'est le **tag** qui construit et publie |
| `develop` | Intégration, où s'accumulent les features |
| `feature/*` | Développement, part de `develop` et y retourne |
| `hotfix/*` | Correctif urgent, part de `main` et y retourne directement |

Flux normal : `feature/*` → `develop` → `main` → tag `vX.Y.Z` → build → Release.
Après chaque tag : back-merge `main` → `develop`, qui fait redescendre le bump et le CHANGELOG.

## Messages de commit

Format `<type>(<scope>): <description>`. Scopes : `sidecar`, `ui`, `tauri`, ou plus fin (`matching`, `playlists`, `files`, `plan`, `cache`, `settings`).

| Type | Effet sur la version |
|------|---------------------|
| `feat` | MINOR |
| `feat!` ou pied `BREAKING CHANGE:` | MAJOR, réservé à un schéma de rapport ou de plan de run incompatible |
| `fix` | PATCH |
| `docs`, `refactor`, `test`, `chore` | aucun |

## Workflow

1. **Vérifier la branche courante** avant toute chose : un commit part vite sur la mauvaise.
2. **Créer la branche depuis la bonne base** : `develop` pour une feature, `main` pour un hotfix.
3. **Proposer le message de commit à l'utilisateur** et attendre son accord avant de committer.
4. **Ne jamais pousser sans demande explicite.**

## Règles

- **Le titre d'une PR `develop → main` doit être `feat:`, `fix:` ou `feat!:`.** Le squash-merge en fait le message du commit sur `main`, et c'est lui que release-please lit. Un titre hors convention ne produit ni PR de release, ni tag, ni build : aucune mise à jour n'est distribuée, et rien ne le signale.
- **Merger cette PR avec un corps explicite** : `gh pr merge <n> --squash --body "<une ligne>"`. Le corps auto-généré par GitHub re-liste tous les commits de la branche, dont des `BREAKING CHANGE:` déjà publiés, ce qui fait bumper en MAJOR à tort. Piège constaté en production sur techno-scraper, deux fois.
- **Aucun tag n'est créé à la main.** Ils viennent de release-please au merge de la PR de release. Un tag manuel ne déclenche aucun build.
- **Ne jamais supprimer un tag fautif** : il atteste qu'une version a été publiée, pas qu'elle est bonne. Un problème se corrige par un `hotfix/*` et un nouveau tag PATCH.
- **Ne jamais bumper une version à la main** dans `package.json`, `Cargo.toml` ou `pyproject.toml` : le manifest de release-please reprend la main au run suivant.
- **Ne jamais committer de secret**, même de test, même une minute : le dépôt est public et l'historique git est indélébile.
