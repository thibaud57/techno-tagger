---
paths:
  - ".github/workflows/**/*.yml"
  - ".github/workflows/**/*.yaml"
  - ".github/actions/**/action.yml"
---

# GitHub Actions — Workflows, jobs & steps

## À faire
- Placer chaque workflow dans `.github/workflows/`, un fichier par finalité : gate qualité sur PR, release-please + build
- Commencer par `actions/checkout` tout job qui touche au code : le runner démarre sur un système de fichiers vide
- Déclarer un job par zone indépendante (`sidecar/`, `src/`, `src-tauri/`) : les jobs tournent en parallèle sur des runners dédiés
- Poser `defaults.run.working-directory` au niveau job quand tous ses steps opèrent sur une seule zone, plutôt que répéter `working-directory` step par step
- Chaîner par `needs:` ce qui dépend d'un résultat antérieur, comme le build de release derrière release-please
- Nommer les steps non triviaux : ce nom est ce qu'on lit dans l'onglet Actions quand la CI casse
- Construire le sidecar PyInstaller et lancer `tauri build` dans le **même job** : `tauri-action` n'offre aucun hook pour produire un binaire externe avant son appel
- Installer un outil dont la version sert à plusieurs jobs par une action composite locale (`./.github/actions/setup-uv`, `./.github/actions/setup-pnpm`), seul endroit où vit cette version : jamais de version recopiée d'un job à l'autre

## À éviter
- Supposer qu'un fichier produit dans un job existe dans le suivant : chaque job repart d'un runner vierge, il faut un artifact ou un cache
- Répéter la même chaîne d'installation dans dix steps au lieu d'un `run: |` multi-ligne
- Sortir le job de build dans son propre fichier : le tag venant du `GITHUB_TOKEN` ne le déclencherait pas, et c'est ce qui impose le chaînage `needs:` dans le workflow release-please
- Un `workflow_call` tant qu'il n'y a qu'un appelant : secrets à repasser et logs imbriqués, sans rien factoriser
- Rejouer en CI ce que la CI joue déjà ailleurs : pas de hooks pre-commit, le même trio lint / typecheck / tests tourne sur chaque PR

## Gotchas
- `actions/checkout` v7 refuse par défaut de récupérer le code d'une PR de fork sous `pull_request_target` et sous `workflow_run` déclenché par une PR (opt-out `allow-unsafe-pr-checkout`). Un SHA épinglé sur une v6 ou antérieure ne reçoit pas cette garde
- Une action composite locale s'appelle par `uses: ./.github/actions/<nom>` après `actions/checkout`, et Dependabot ne la scanne que si son dossier figure dans les `directories` de l'entrée `github-actions`
- Le shell par défaut d'un job Windows est PowerShell : poser `shell: bash` explicitement si les commandes sont écrites pour bash

## Exemples
```yaml
# ✅ working-directory posé une fois pour tout le job
jobs:
  lint-python:
    runs-on: ubuntu-24.04
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
