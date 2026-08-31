---
paths:
  - ".github/workflows/**/*.yml"
  - ".github/workflows/**/*.yaml"
---

# GitHub Actions — Sécurité & permissions

## À faire
- Déclarer `permissions:` explicitement, au plus près du besoin : `contents: read` par défaut sur le workflow, les écritures ouvertes seulement sur le job qui en a l'usage (`contents: write` et `pull-requests: write` pour release-please et la publication de la Release)
- Épingler chaque action tierce sur un SHA de commit, avec la version en commentaire
- Épingler à la version exacte quand un tag flottant traîne : `pnpm/setup` doit être posé sur la v2.1.0, le tag `@v2` restant sur une version antérieure au correctif de chemin de cache Windows
- Laisser Renovate (manager `github-actions`) faire remonter les bumps d'actions en PR mensuelle, gate qualité compris
- Passer toute valeur contrôlée par un tiers (titre de PR, corps d'issue, `client_payload`) par `env:` avant de la lire dans un `run:`
- Laisser « Dependency graph » et « Dependabot alerts » actifs côté dépôt : Renovate les lit, il ne les produit pas

## À éviter
- Interpoler `${{ github.event.* }}` directement dans un `run:` : la valeur est substituée avant l'exécution du shell, ce qui exécute du code arbitraire choisi par l'auteur de la PR ou de l'issue
- `permissions: write-all`, ou l'absence de bloc `permissions:` qui laisse hériter le réglage du dépôt
- Un tag mutable (`@v1`, `@main`) sur une action tierce : l'incident `tj-actions/changed-files` de mars 2025 a exfiltré les secrets de milliers de dépôts par réaffectation de tag
- Une action tierce non vérifiée dont le code source n'a pas été inspecté

## Gotchas
- Le `GITHUB_TOKEN` est régénéré par run, limité au dépôt courant et expire à la fin du job : rien à faire tourner, et les seuls events qu'il déclenche à relancer un workflow sont ceux listés en exception par [events.md](events.md), toujours en état approval-required
- Pas d'OIDC ni d'attestation de provenance dans ce projet : aucun provider cloud, la garantie d'intégrité du livrable repose sur la signature updater (cf. [PRODUCTION.md](../../../docs/PRODUCTION.md) § Sécurité & Configuration)

## Exemples
```yaml
# ✅ valeur tierce passée en variable d'environnement, jamais interpolée
- run: |
    if [[ "$PR_TITLE" == *"WIP"* ]]; then exit 1; fi
  env:
    PR_TITLE: ${{ github.event.pull_request.title }}

# ❌ injection de script : le titre est substitué dans le shell
- run: |
    if [[ "${{ github.event.pull_request.title }}" == *"WIP"* ]]; then exit 1; fi

# ✅ action tierce épinglée sur un SHA
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1  # v7.0.1
```
