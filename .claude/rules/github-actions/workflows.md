---
paths:
  - ".github/workflows/**/*.yml"
  - ".github/workflows/**/*.yaml"
---

# GitHub Actions — Workflows, jobs & steps

## À faire
- Placer chaque workflow dans `.github/workflows/`, un fichier par finalité : gate qualité sur PR, release-please + build
- Commencer par `actions/checkout` tout job qui touche au code : le runner démarre sur un système de fichiers vide
- Déclarer un job par zone indépendante (`sidecar/`, `src/`, `src-tauri/`) : les jobs tournent en parallèle sur des runners dédiés
- Poser `defaults.run.working-directory` au niveau job quand tous ses steps opèrent sur une seule zone, plutôt que répéter `working-directory` step par step
- Chaîner par `needs:` ce qui dépend réellement d'un résultat antérieur : le build de release est chaîné au job release-please et conditionné à son output (cf. [PRODUCTION.md](../../../docs/PRODUCTION.md) § Pipelines)
- Nommer les steps non triviaux : ce nom est ce qu'on lit dans l'onglet Actions quand la CI casse
- Construire le sidecar PyInstaller et lancer `tauri build` dans le **même job** : `tauri-action` n'offre aucun hook pour produire un binaire externe avant son appel

## À éviter
- Supposer qu'un fichier produit dans un job existe dans le suivant : chaque job repart d'un runner vierge, il faut un artifact ou un cache
- Répéter la même chaîne d'installation dans dix steps au lieu d'un `run: |` multi-ligne
- Sortir le job de build dans son propre fichier : le tag venant du `GITHUB_TOKEN` ne le déclencherait pas, et c'est ce qui impose le chaînage `needs:` dans le workflow release-please
- Passer par un `workflow_call` tant qu'il n'y a qu'un appelant : l'indirection coûte des secrets à repasser explicitement et des logs imbriqués, sans rien factoriser. Le jour où un second appelant existe (un build à la demande sans release, par exemple), le refactor est mécanique
- Rejouer en CI ce que la CI joue déjà ailleurs : pas de hooks pre-commit, le même trio lint / typecheck / tests tourne sur chaque PR

## Gotchas
- `actions/checkout` v7 est passé à ESM et bloque le checkout d'une PR de fork sur `pull_request_target`
- Le shell par défaut d'un job Windows est PowerShell : poser `shell: bash` explicitement si les commandes sont écrites pour bash

## Exemples
```yaml
# ✅ working-directory posé une fois pour tout le job — exemple générique,
# le job sidecar réel de ce projet tourne sur windows-latest via `just lint-sidecar`
jobs:
  lint-python:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: sidecar
    steps:
      - uses: actions/checkout@<sha>
      - run: uv run ruff check .
      - run: uv run pytest

# ❌ répété sur chaque step
    steps:
      - run: uv run ruff check .
        working-directory: sidecar
      - run: uv run pytest
        working-directory: sidecar
```
