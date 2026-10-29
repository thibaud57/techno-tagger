---
paths:
  - ".github/workflows/**/*.yml"
  - ".github/workflows/**/*.yaml"
---

# GitHub Actions : token de GitHub App pour release-please

## À faire
- **Token de GitHub App** pour release-please : `actions/create-github-app-token` avant l'étape qui l'utilise (identifiants cf. [security-permissions.md](security-permissions.md)), puis `steps.<id>.outputs.token` en `token:` de release-please-action, pour que la PR de release lance sa CI
- Garder le `id: app-token`, **load-bearing** : sans lui l'expression résout à vide, l'action retombe sur `github.token`, le run reste vert mais la CI de la PR de release redevient bloquée en attente d'approbation
- Borner le token d'App par `permission-*` (`contents`, `issues` et `pull-requests` en `write` pour release-please), `owner` et `repositories` laissés vides pour le scoper au dépôt courant : sans `permission-*`, il reçoit toutes les permissions de l'installation de l'App
