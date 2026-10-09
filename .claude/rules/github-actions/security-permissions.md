---
paths:
  - ".github/workflows/**/*.yml"
  - ".github/workflows/**/*.yaml"
  - ".github/actions/**/action.yml"
---

# GitHub Actions — Sécurité & permissions

## À faire
- Déclarer `permissions:` explicitement : `contents: read` sur le workflow, tout scope supplémentaire, en lecture (`pull-requests: read`) comme en écriture, sur le seul job qui en a l'usage
- Épingler chaque action tierce, actions composites locales comprises, sur le SHA de son tag avec la version en commentaire, jamais sur un tag flottant : un tag peut être réaffecté ou traîner avant un correctif, et seul le SHA laisse Dependabot proposer la montée
- Tenir les réglages Actions du dépôt public : token par défaut `restricted`, Actions sans droit d'approuver une PR, policy de SHA pinning, approbation de tous les contributeurs externes pour les PR de fork, et `dependabot[bot]` dans les actor rules s'il y en a (état relevé dans [PRODUCTION.md § Réglages Actions du dépôt](../../../docs/PRODUCTION.md#réglages-actions-du-dépôt))
- Laisser Dependabot (écosystème `github-actions`) faire remonter les bumps d'actions en PR mensuelle, gate qualité compris
- Passer toute valeur contrôlée par un tiers (titre de PR, corps d'issue, `client_payload`) par `env:` avant de la lire dans un `run:`
- Laisser « Dependency graph » et « Dependabot alerts » actifs côté dépôt : les mises à jour de sécurité de Dependabot s'appuient dessus

## À éviter
- Interpoler `${{ github.event.* }}` directement dans un `run:` : la valeur est substituée avant l'exécution du shell, ce qui exécute du code arbitraire choisi par l'auteur de la PR ou de l'issue
- `permissions: write-all`, ou l'absence de bloc `permissions:` qui laisse hériter le réglage du dépôt
- Un tag mutable (`@v1`, `@main`) sur une action tierce : une réaffectation de tag exfiltre les secrets
- Une action tierce non vérifiée dont le code source n'a pas été inspecté

## Gotchas
- Un bloc `permissions:` de job remplace celui du workflow, il ne s'y ajoute pas : dès qu'un scope est déclaré, tous les autres passent à `none`, donc `contents: read` se redéclare. `{}` vaut aucune permission, un bloc omis hérite
- Le `GITHUB_TOKEN` est régénéré par run et expire à la fin du job : rien à faire tourner
- Ni OIDC ni attestation de provenance : l'intégrité du livrable repose sur la signature updater

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
