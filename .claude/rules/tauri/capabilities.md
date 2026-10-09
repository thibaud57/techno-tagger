---
paths:
  - "src-tauri/capabilities/**/*.json"
  - "src-tauri/src/lib.rs"
  - "src-tauri/Cargo.toml"
---

# Tauri — Capabilities & plugins

## À faire
- Octroyer chaque permission de plugin explicitement : en v2 les commandes de plugin passent toujours par l'ACL. Les commandes d'application, elles, sont autorisées par défaut tant qu'aucun manifeste d'app (`permissions/*.toml`) ne les déclare
- Restreindre au strict nécessaire : `shell:allow-spawn` ciblé sur le sidecar, `fs` limité à `$APPLOCALDATA` (les fichiers musicaux sont gérés par le sidecar, pas par la webview), `assetProtocol` limité au cache
- Accorder `shell:allow-spawn` et non `shell:allow-execute` : la permission suit la méthode réellement appelée
- Poser `"sidecar": true` sur l'entrée `allow` : aucune commande arbitraire n'est autorisée, même avec le plugin `shell` actif
- Restreindre la capability par `windows` (fenêtre nommée) et `platforms` (OS)
- Enregistrer `single-instance` en premier dans le builder, avant tout autre `.plugin()`
- Ouvrir un chemin ou une URL par `opener`, plus par `shell` en v2
- Extraire les deux premières lettres du tag BCP-47 rendu par `os.locale()` pour choisir la langue au premier lancement
- Vérifier un identifiant de permission par `tauri permission ls` plutôt que de l'inventer
- Aligner strictement chaque crate de plugin et son paquet npm : même numéro, plugin par plugin, release simultanée du même monorepo

## À éviter
- `shell:allow-execute` « au cas où » : ouvre l'exécution de commandes arbitraires sans bénéfice
- Un scope `assetProtocol` large (`$HOME/**`) : la webview accéderait à toute la bibliothèque musicale de l'utilisateur
- Déclarer une permission `fs` sans scope : « permissions alone do not grant a scope », l'appel échoue en `forbidden path` au runtime
- Lire le `store` depuis le sidecar : Python n'y a pas accès, une préférence que le sidecar doit connaître lui est transmise par une commande NDJSON

## Gotchas
- `args` absent vaut `false`, soit **aucun argument autorisé** : un argument passé malgré tout est retiré du spawn en silence, pas rejeté
- Tous les fichiers de `src-tauri/capabilities/` sont actifs par défaut : en ajouter un élargit la surface sans autre geste
- Un appel sans permission déclarée échoue côté frontend, souvent sans message clair : c'est la première piste quand une API Tauri « ne fait rien ». L'erreur ACL est détaillée en debug et réduite à `Command X not allowed by ACL` en release, donc le diagnostic se fait en `tauri dev`
- `deny` prime sur `allow` dans un scope : un chemin listé des deux côtés est refusé
- Un programme hors du scope `shell:allow-spawn` échoue explicitement (`program not allowed on the configured shell scope`), contrairement à un argument
- `single-instance` et `prevent-default` n'ont aucune permission à déclarer ni paquet npm : la règle d'alignement crate / npm ne les concerne pas
- `updater` 2.5.0 supprime `UpdaterBuilder::new` au profit de `UpdaterExt::updater_builder` : concerne l'usage Rust bas niveau, pas l'API JS

## Exemples
```json
// ✅ permission ciblée sur le seul sidecar déclaré
{
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    "core:default",
    { "identifier": "shell:allow-spawn", "allow": [{ "name": "binaries/tagger", "sidecar": true }] },
    "dialog:allow-open",
    "store:default"
  ]
}

// ❌ exécution de commandes arbitraires ouverte
{ "permissions": ["shell:allow-execute"] }
```

```rust
// ✅ single-instance enregistré avant tout autre plugin
tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, _, _| { /* focus */ }))
    .plugin(tauri_plugin_shell::init())
```
