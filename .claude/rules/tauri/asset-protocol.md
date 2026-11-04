---
paths:
  - "src-tauri/tauri.conf.json"
---

# Tauri : asset protocol et CSP

## À faire
- Activer `assetProtocol` avec un `scope` restreint au dossier de cache des pochettes et traduire les chemins par `convertFileSrc()` côté webview
- Ajouter `asset:` et `http://asset.localhost` à l'`img-src` de la CSP avec l'asset protocol
- Déclarer `connect-src 'self' ipc: http://ipc.localhost https://*.ingest.de.sentry.io` : l'IPC v2 passe par un `fetch()` que `default-src 'self'` refuse et sans l'hôte Sentry aucun crash ne part
- Déclarer `style-src 'self' 'unsafe-inline'` : PrimeNG injecte son thème par un `<style>` créé à l'exécution, qu'aucun nonce ne couvre
- Prévoir un fallback visuel quand une pochette a disparu entre l'événement et l'affichage : le cache est jetable (cf. [ADR-013](../../../docs/adrs/013-cache-disque-jetable.md))

## À éviter
- Un scope d'asset protocol couvrant le disque ou `$HOME` : il donnerait à la webview accès à la bibliothèque musicale

## Gotchas
- Sans `asset:` dans la CSP, la webview refuse l'image sans erreur réseau visible
- Tauri ne pose aucun nonce ni hash CSP sur les styles d'un build Angular : le critical CSS reste désactivé dans `angular.json` (cf. [angular/app-config.md](../angular/app-config.md))

## Exemples
```json
// ✅ périmètre du cache uniquement
{
  "app": {
    "security": {
      "assetProtocol": { "enable": true, "scope": ["$APPLOCALDATA/cache/artworks/**"] }
    }
  }
}

// ❌ tout le disque exposé à la webview
{ "assetProtocol": { "enable": true, "scope": ["$HOME/**"] } }
```
