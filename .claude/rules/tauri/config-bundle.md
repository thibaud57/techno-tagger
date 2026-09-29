---
paths:
  - "src-tauri/tauri.conf.json"
  - "src-tauri/installer-hooks.nsh"
---

# Tauri — Asset protocol, updater & fenêtre

## À faire
- Activer `assetProtocol` avec un `scope` restreint au dossier de cache des pochettes, et traduire les chemins par `convertFileSrc()` côté webview
- Ajouter `asset:` et `http://asset.localhost` à l'`img-src` de la CSP avec l'asset protocol
- Déclarer `connect-src 'self' ipc: http://ipc.localhost https://*.ingest.de.sentry.io` : l'IPC v2 passe par un `fetch()` que `default-src 'self'` refuse, et sans l'hôte Sentry aucun crash ne part
- Déclarer `style-src 'self' 'unsafe-inline'` : PrimeNG injecte son thème par un `<style>` créé à l'exécution, qu'aucun nonce ne couvre
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
- `installer-hooks.nsh` tue le sidecar avant que l'installeur n'écrase ses fichiers : en mise à jour, NSIS ne détecte que l'exe principal et un `tagger.exe` orphelin verrouillerait son propre fichier
- `identifier`, `productName`, `externalBin` et le scope `shell:allow-spawn` sont recopiés ailleurs (sidecar, `angular.json`, workflows) : un renommage se fait partout, `test_main.py` le garde
- Sans `asset:` dans la CSP, la webview refuse l'image sans erreur réseau visible
- La taille de fenêtre n'est pas mémorisée entre deux lancements (plugin `window-state` non retenu)
- Le manifeste de l'updater n'exige que `version`, `platforms.<target>.url` et `.signature`
- `bundle.createUpdaterArtifacts` reste à `false` tant que `plugins.updater.pubkey` et `TAURI_SIGNING_PRIVATE_KEY` ne sont pas posés : sans la paire de clés, le build de release échoue
- Tauri ne pose aucun nonce ni hash CSP sur les styles d'un build Angular : désactiver le critical CSS (`optimization.styles.inlineCritical: false`), dont l'`onload=` serait bloqué

## Exemples
```json
// ✅ périmètre du cache uniquement, CSP alignée
{
  "app": {
    "security": {
      "assetProtocol": { "enable": true, "scope": ["$APPLOCALDATA/cache/artworks/**"] },
      "csp": "default-src 'self'; connect-src 'self' ipc: http://ipc.localhost https://*.ingest.de.sentry.io; img-src 'self' asset: http://asset.localhost blob: data:; style-src 'self' 'unsafe-inline'"
    },
    "windows": [{ "width": 1280, "height": 800, "minWidth": 1024, "minHeight": 700 }]
  }
}

// ❌ tout le disque exposé à la webview
{ "assetProtocol": { "enable": true, "scope": ["$HOME/**"] } }
```
