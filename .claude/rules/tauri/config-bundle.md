---
paths:
  - "src-tauri/tauri.conf.json"
---

# Tauri — Asset protocol, updater & fenêtre

## À faire
- Activer `assetProtocol` avec un `scope` restreint au dossier de cache des pochettes, et traduire les chemins par `convertFileSrc()` côté webview
- Ajouter `asset:` et `http://asset.localhost` à l'`img-src` de la CSP en même temps que l'activation de l'asset protocol : les deux réglages n'ont de sens qu'ensemble
- Prévoir un fallback visuel quand une pochette a disparu entre l'événement et l'affichage : le cache est jetable (cf. [ADR-013](../../../docs/adrs/013-cache-disque-jetable.md))
- Renseigner `plugins.updater.pubkey` avec le **contenu** de la clé publique, pas un chemin
- Vérifier les mises à jour au démarrage uniquement, jamais pendant un run : sous Windows l'application se ferme avant l'installation, ce qui interromprait le run
- Poser `installMode: "passive"` pour éviter l'assistant d'installation à chaque mise à jour
- Cibler `nsis` en `bundle.targets` : le bootstrapper WebView2 couvre une installation Windows incomplète, et NSIS reçoit la signature comme le MSI ([ADR-015](../../../docs/adrs/015-cibles-distribution-windows.md))
- Contraindre la fenêtre par son plancher seulement, dicté par le jeu de colonnes de la liste d'un run (cf. [DESIGN.md § Layout](../../../docs/DESIGN.md#-layout--espacement))

## À éviter
- Un scope d'asset protocol couvrant le disque ou `$HOME` : il donnerait à la webview accès à la bibliothèque musicale
- Committer la clé privée de l'updater : elle passe par `TAURI_SIGNING_PRIVATE_KEY` au moment du build en CI, jamais par un `.env`
- Régénérer une paire de clés d'updater avec `--force` : une clé perdue rend non-updatables toutes les installations déjà distribuées
- Poser le mode sombre côté Tauri : il vit dans la webview, classe sur `<html>` plus `darkModeSelector` PrimeNG

## Gotchas
- Sans `asset:` dans la CSP, la webview refuse l'image sans erreur réseau visible
- La taille de fenêtre n'est pas mémorisée entre deux lancements : un agrandissement est perdu à la fermeture, le plugin `window-state` corrigerait ça mais n'est pas retenu au MVP
- Le manifeste de l'updater n'exige que `version`, `platforms.<target>.url` et `platforms.<target>.signature` ; `notes` et `pub_date` sont optionnels
- `bundle.createUpdaterArtifacts` doit être actif pour que le build produise les artefacts signés attendus par le manifeste
- Le MSI (WiX) ne peut être produit que sur Windows, là où NSIS se cross-compile : sans usage immédiat au MVP, mais c'est ce qui fait pencher le choix

## Exemples
```json
// ✅ périmètre du cache uniquement, CSP alignée
{
  "app": {
    "security": {
      "assetProtocol": { "enable": true, "scope": ["$APPLOCALDATA/cache/artworks/**"] },
      "csp": "default-src 'self'; img-src 'self' asset: http://asset.localhost blob: data:"
    },
    "windows": [{ "width": 1280, "height": 800, "minWidth": 1024, "minHeight": 700 }]
  }
}

// ❌ tout le disque exposé à la webview
{ "assetProtocol": { "enable": true, "scope": ["$HOME/**"] } }
```
