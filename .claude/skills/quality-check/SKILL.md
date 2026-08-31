---
name: quality-check
description: Lance les gates qualité de techno-tagger (lint, typage, tests, build) sur les trois zones du dépôt. À utiliser avant un commit, avant une PR, ou quand l'utilisateur demande de vérifier que tout passe.
allowed-tools: Bash(just *)
---

# quality-check - Gates qualité

Ta mission est de faire tourner les mêmes gates que la CI, et de rapporter ce qui casse sans le minimiser.

## Recettes

| Zone | Lint | Typage | Tests |
|------|------|--------|-------|
| `src/` (Angular) | `just lint-ui` | `just typecheck-ui` | `just test-ui` |
| `sidecar/` (Python) | `just lint-sidecar` | `just typecheck-sidecar` | `just test-sidecar` |
| `src-tauri/` (Rust) | `just lint-tauri` | inclus dans le lint | aucun test |

Agrégats : `just lint`, `just typecheck`, `just test`, tous en `[parallel]`. Build : `just build-ui`, `just build-sidecar`, `just build`.

## Workflow

1. **Cibler la zone touchée** plutôt que tout lancer : un changement Python n'a pas besoin du lint Angular.
2. **Lint, puis typage, puis tests**, dans cet ordre : une erreur de typage rend souvent l'échec de test illisible.
3. **Rapporter chaque échec avec sa sortie**, jamais un résumé rassurant.
4. **Ne jamais annoncer que tout passe sans avoir lu la sortie** de chaque commande.

## Règles

- **`just lint-tauri` et `just build` exigent le binaire du sidecar** : Tauri valide `externalBin` dès la compilation. Lancer `just build-sidecar` d'abord.
- **Le seuil de couverture de 80 % vit dans `just test-sidecar`**, pas dans `addopts`. Lancer `uv run pytest tests/test_x.py` en direct pendant le développement n'applique pas le seuil, et c'est voulu.
- **Les agrégats entrelacent la sortie des trois zones**, ligne à ligne. La ligne `error: recipe X failed` de fin nomme la zone fautive et son code de retour est celui de `just`. Pour une sortie lisible, lancer la recette ciblée.
- **Ne jamais corriger un échec de lint par une désactivation de règle** sans avoir compris ce qu'elle signale. `S607`, `TC002` et consorts pointent des choses réelles.
- La CI rejoue exactement ces recettes : ce qui passe ici passe là-bas, et inversement.
