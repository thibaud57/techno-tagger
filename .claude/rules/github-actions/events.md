---
paths:
  - ".github/workflows/**/*.yml"
  - ".github/workflows/**/*.yaml"
---

# GitHub Actions : événements déclencheurs

## À faire
- Déclencher le gate qualité sur `push` vers `main` et `pull_request` vers `main` et `develop` : tout atteint `develop` par PR
- Déclencher le build de release **depuis le workflow release-please**, par `needs:` conditionné à l'output `release_created`, jamais depuis un fichier séparé : il perdrait les outputs de release-please (`id`, `tag_name`, `version`), y compris avec le token d'App
- Ajouter `workflow_dispatch` sur un workflow qu'il faut pouvoir rejouer à la main sans pousser un commit
- Filtrer par `paths:` un workflow qui ne concerne qu'une zone du dépôt, sauf s'il porte un required check : sauté, il le laisse « Pending » (cf. [job-control.md](job-control.md))
- Laisser les activity types par défaut de `pull_request` (`opened`, `synchronize`, `reopened`) sauf besoin explicite

## À éviter
- `on: push: tags: 'v*'` pour le build de release : le build perdrait les outputs de release-please et un tag posé avec le `GITHUB_TOKEN` ne déclenche aucun workflow, la Release resterait vide sans erreur
- `pull_request_target` et `workflow_run` avec du code de la PR : le code du fork s'exécuterait avec accès aux secrets du dépôt. Le piège passe aussi par `git fetch`, `gh pr checkout` ou un artifact du workflow déclencheur, que la garde d'`actions/checkout` v7 ne couvre pas
- Mettre une expression `${{ }}` sous `on:` : aucun contexte n'y est disponible, sauf dans `on.workflow_call`
- Exclure `.github/workflows/**` d'un `paths-ignore` au point de ne plus jamais tester une modification de la CI elle-même

## Gotchas
- Un event émis par le `GITHUB_TOKEN` ne lance aucun workflow, sauf `workflow_dispatch`, `repository_dispatch` et les `pull_request` `opened` / `synchronize` / `reopened`, qui partent en attente d'approbation. Un push de tag n'en fait pas partie
- Une PR créée par le `GITHUB_TOKEN`, ou un commit qu'il pousse, lance ses workflows `pull_request` en attente d'approbation (changement GitHub du 2026-06-11) et le run s'affiche en échec (« workflow file issue », 0 job). release-please passe donc par le token de la GitHub App de release (cf. [workflows.md](workflows.md))
- Le flux `develop → main` convient à release-please : le squash-merge est un commit ordinaire de `main`

## Exemples
```yaml
# ✅ le build suit release-please dans le même workflow
jobs:
  release-please:
    outputs:
      release_created: ${{ steps.rp.outputs.release_created }}
  build:
    needs: release-please
    if: needs.release-please.outputs.release_created == 'true'

# ❌ ne partira jamais : le tag vient du GITHUB_TOKEN
on:
  push:
    tags: ['v*']
```
