---
name: setup-ops
description: Installe et vérifie l'environnement local de techno-tagger (dépendances des trois zones, binaire du sidecar, prérequis). À utiliser au premier clone, après un changement de dépendances, ou quand une commande échoue sur un outil manquant.
allowed-tools: Bash(just *)
---

# setup-ops - Installation et diagnostic

Ta mission est de rendre l'environnement local utilisable, et de diagnostiquer ce qui manque quand une commande échoue.

## Recettes

| Recette | Effet |
|---------|-------|
| `just check` | Diagnostic. N'installe rien, liste ce qui manque. **Premier réflexe** |
| `just install` | Dépendances des trois zones, en `[parallel]` : sortie entrelacée |
| `just install-ui` / `install-sidecar` / `install-tauri` | Installation ciblée |
| `just setup` | `install` + construction du binaire du sidecar |
| `just build-sidecar` | Empaquette le sidecar et l'installe dans `src-tauri/binaries/` |

## Workflow

1. **Toujours commencer par `just check`** : il ne modifie rien et dit exactement ce qui manque.
2. **Traiter uniquement ce qu'il signale**, plutôt que de tout réinstaller par réflexe.
3. **Relancer `just check`** après correction pour confirmer, plutôt que de supposer.

## Règles

- **`just setup` et non `just install` au premier clone** : `install` s'arrête aux dépendances, alors que toute commande Tauri exige en plus le binaire du sidecar dans `src-tauri/binaries/`. Une sortie vide de `just check` est le seul signal fiable.
- **Le binaire du sidecar est un artefact, jamais commité.** Il se reconstruit par `just build-sidecar` après chaque clone et à chaque changement du code Python.
- **Les prérequis Windows ne s'installent pas depuis ce skill** : Visual Studio Build Tools avec le workload « Desktop development with C++ » et la toolchain MSVC sont un prérequis manuel. Sans eux, la compilation Rust échoue.
- **Ne jamais contourner un échec d'installation** en changeant une version dans un manifeste : les versions sont arbitrées dans `docs/VERSIONS.md`, et un désaccord se corrige là.
- Le `.env` n'est requis par aucune commande : il ne porte que des secrets de build, et un DSN vide rend les SDK Sentry inertes, ce qui est le comportement voulu en développement.
