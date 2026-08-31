---
name: dev-server
description: Démarre et arrête l'environnement de développement de techno-tagger (fenêtre Tauri, webview Angular seule, ou sidecar en CLI). À utiliser quand l'utilisateur demande de lancer, redémarrer ou arrêter l'application.
allowed-tools: Bash(just *)
---

# dev-server - Démarrage local

Ta mission est de démarrer ou d'arrêter l'environnement de développement, en choisissant la bonne recette selon ce que l'utilisateur veut réellement observer.

## Recettes

| Recette | Ce qu'elle lance | Quand la choisir |
|---------|------------------|------------------|
| `just dev` | Angular + fenêtre Tauri | Vérifier l'application complète, y compris ce qui passe par les plugins Tauri |
| `just dev-ui` | Webview Angular seule, dans le navigateur sur le port 4200 | Travailler sur l'interface pure. Aucune API Tauri n'est disponible : dialogues, store et sidecar échouent |
| `just dev-sidecar` | Sidecar Python en CLI | Tester le protocole NDJSON en injectant des commandes sur stdin, sans lancer d'interface |
| `just stop` | Arrête tout | Libérer le port et tuer les process restants |
| `just stop-ui` / `just stop-app` | Arrêt ciblé | Ne tuer qu'une moitié |

## Workflow

1. **Lancer en arrière-plan** : ces recettes ne rendent jamais la main, toujours `run_in_background: true`.
2. **Vérifier le démarrage** en relisant la sortie, jamais en supposant que c'est parti.
3. **Rendre l'URL ou l'état** à l'utilisateur, sans commenter davantage.

## Règles

- **`just dev` exige le binaire du sidecar** dans `src-tauri/binaries/`. Sans lui, Tauri échoue sur `externalBin` avant même de compiler. Lancer `just build-sidecar` d'abord, ou `just check` qui le signale.
- **Ne jamais enchaîner un `just stop` juste après un `just dev`** pour « vérifier » : le démarrage prend plusieurs secondes et l'arrêt tuerait le process en cours de compilation.
- **Un seul `just dev` à la fois** : l'application est en instance unique, un second lancement redonne le focus au premier au lieu d'ouvrir une fenêtre.
- Le mode développement ne prouve rien sur trois pièges qui n'existent qu'en distribution : sidecar non remplacé à la mise à jour, backend keyring introuvable, sortie NDJSON bufferisée. Les valider demande un run sur le bundle.
