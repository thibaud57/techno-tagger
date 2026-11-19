---
name: git-ops
description: Applique les conventions git de techno-tagger (branches, messages de commit, PR, versionnement). À utiliser pour créer une branche, écrire un message de commit, ouvrir ou merger une PR.
disable-model-invocation: true
allowed-tools: Bash(git *), Bash(gh *)
---

# git-ops - Conventions git

Ta mission est de respecter le flux de branches et le format de commits dont dépend toute la chaîne de release.

## Branches

Types de commit et nommage des branches de travail : convention Git commune (CLAUDE.md user § Git & intégration).

| Branche | Rôle |
|---------|------|
| `main` | Production. N'avance que par PR, et c'est le **tag** qui construit et publie |
| `develop` | Intégration, où s'accumulent les features |
| `<type>/<slug>` | Développement (`feat/<feature-slug>` pour un epic), part de `develop` et y retourne |
| `hotfix/<slug>` | Correctif urgent, part de `main` et y retourne directement, PR titrée `fix:` |

Flux normal : `<type>/<slug>` → `develop` → `main` → tag `vX.Y.Z` → build → Release.
Après chaque tag : back-merge `main` → `develop` en local puis push (GitHub n'offre que le squash), qui fait redescendre le bump et le CHANGELOG.

## Messages de commit

Format `<type>(<scope>): <description>`. Scopes : `sidecar`, `ui`, `tauri`, ou plus fin (`matching`, `playlists`, `files`, `plan`, `cache`, `settings`).

| Type | Effet sur la version |
|------|---------------------|
| `feat` | MINOR |
| `feat!` ou pied `BREAKING CHANGE:` | MAJOR, réservé à un schéma de rapport ou de plan de run incompatible |
| `fix` | PATCH |
| `docs`, `refactor`, `test`, `chore`, `ci` | aucun |

## Workflow

1. **Vérifier la branche courante** avant toute chose : un commit part vite sur la mauvaise.
2. **Créer la branche depuis la bonne base** : `develop` pour une branche de travail, `main` pour un hotfix.
3. **Proposer le message de commit à l'utilisateur** et attendre son accord avant de committer.
4. **Ne jamais pousser sans demande explicite.**

## Règles

- **Le titre d'une PR `develop → main` doit être `feat:`, `fix:` ou `feat!:`.** Le squash-merge en fait le message du commit sur `main`, et c'est lui que release-please lit. Un titre hors convention ne produit ni PR de release, ni tag, ni build : aucune mise à jour n'est distribuée, et rien ne le signale.
- **Merge en squash seul** : `gh pr merge <n> --squash`, le commit prend le titre de la PR et un corps vide. `--delete-branch` sur une PR de travail, jamais sur la promotion `develop → main` (`delete_branch_on_merge` est désactivé, GitHub supprimerait `develop`). Merger seulement CI verte. `--body "Release-As: X.Y.Z"` seulement pour forcer une version.
- **Revert d'un changement livré** : jamais de commit direct sur `main`. Une branche `fix/<slug>` (ou `hotfix/<slug>` depuis `main` pour une correction urgente) et une PR typée `fix`.
- **Dépendances** : Dependabot reste en `chore(deps)`. Une montée à livrer s'écrit `fix(deps)`, et une PR de sécurité se retitre `fix(deps):` avant le merge quand le correctif se livre.
- **Aucun tag n'est créé à la main.** Ils viennent de release-please au merge de la PR de release. Un tag manuel ne déclenche aucun build.
- **Ne jamais supprimer un tag fautif** : il atteste qu'une version a été publiée, pas qu'elle est bonne. Un problème se corrige par un `hotfix/<slug>` et un nouveau tag PATCH.
- **Ne jamais bumper une version à la main** dans `package.json`, `Cargo.toml` ou `pyproject.toml` : le manifest de release-please reprend la main au run suivant.
- **Ne jamais committer de secret**, même de test, même une minute : le dépôt est public et l'historique git est indélébile.
