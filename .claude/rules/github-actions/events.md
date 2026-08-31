---
paths:
  - ".github/workflows/**/*.yml"
  - ".github/workflows/**/*.yaml"
---

# GitHub Actions — Événements déclencheurs

## À faire
- Déclencher le gate qualité sur `push` et `pull_request` filtrés par `branches: [main, develop]`
- Déclencher le build de release **depuis le workflow release-please**, par `needs:` conditionné à l'output `release_created`, jamais depuis un fichier séparé
- Ajouter `workflow_dispatch` sur un workflow qu'il faut pouvoir rejouer à la main sans pousser un commit
- Filtrer par `paths:` un workflow qui ne concerne qu'une zone du dépôt
- Laisser les activity types par défaut de `pull_request` (`opened`, `synchronize`, `reopened`) sauf besoin explicite

## À éviter
- `on: push: tags: 'v*'` pour le build de release : le tag créé par release-please via `GITHUB_TOKEN` ne déclenche **aucun** workflow, le build ne partirait jamais et sans erreur, laissant une Release vide qu'aucun updater ne verrait
- `pull_request_target` avec checkout du code de la PR : le code du fork s'exécuterait avec accès aux secrets du dépôt
- `branches` et `branches-ignore` sur le même event (mutuellement exclusifs), idem `paths` / `paths-ignore`
- Mettre une expression `${{ }}` sous `on:` : aucun contexte n'y est disponible
- Exclure `.github/workflows/**` d'un `paths-ignore` au point de ne plus jamais tester une modification de la CI elle-même

## Gotchas
- Verbatim GitHub : « events triggered by the `GITHUB_TOKEN` will not create a new workflow run, **with the following exceptions** ». Les exceptions sont `workflow_dispatch`, `repository_dispatch`, et les `pull_request` de type `opened` / `synchronize` / `reopened`, ces derniers créant des runs **en état approval-required**. Un push de **tag** n'en fait pas partie : `on: push: tags` ne partirait toujours jamais, et le chaînage `needs:` reste le contournement du projet. PAT et token de GitHub App restent les alternatives, au prix d'un secret à faire tourner
- La PR de release, et tout commit qu'un job y pousse, produisent des runs `pull_request` **bloqués en attente d'approbation**, pas des runs absents. Sans clic « Approve workflows to run », rien ne valide la tête de cette PR
- Le flux `develop` → `main` n'est pas documenté côté release-please, qui raisonne sur une branche de vérité unique pilotée par `target-branch` : à valider sur un dépôt de test avant la première release (cf. [VERSIONS.md](../../../docs/VERSIONS.md) § release-please)
- Un workflow `schedule` est désactivé après 60 jours sans activité sur le dépôt

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
