---
paths:
  - "src-tauri/tauri.conf.json"
---

# Tauri : fenêtre

## À faire
- Contraindre la fenêtre par son plancher seulement, dicté par le jeu de colonnes de la liste d'un run (cf. [DESIGN.md § Layout](../../../docs/DESIGN.md#-layout--espacement))

## À éviter
- Poser le mode sombre côté Tauri : il vit dans la webview, classe sur `<html>` plus `darkModeSelector` PrimeNG

## Gotchas
- La taille de fenêtre n'est pas mémorisée entre deux lancements (plugin `window-state` non retenu)
