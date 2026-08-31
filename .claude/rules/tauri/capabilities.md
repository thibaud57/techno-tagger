---
paths:
  - "src-tauri/capabilities/**/*.json"
  - "src-tauri/src/lib.rs"
  - "src-tauri/Cargo.toml"
---

# Tauri — Capabilities & plugins

## À faire
- Octroyer chaque permission explicitement : v2 n'expose aucune commande IPC par défaut, contrairement à v1
- Restreindre au strict nécessaire : `shell:allow-spawn` ciblé sur le sidecar, `fs` limité aux chemins choisis, `assetProtocol` limité au cache
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
- Lire le `store` depuis le sidecar : l'URL de l'API y est persistée mais transmise au sidecar par une commande, Python n'y a pas accès

## Gotchas
- `args` absent vaut `"args": false`, soit **aucun argument autorisé**, et non « arguments libres » : seul `"args": true` ouvre le passage, et poser `false` explicitement est un no-op. Corollaire : un argument passé malgré tout est **silencieusement retiré** du spawn, pas rejeté, le plugin construisant la ligne de commande depuis la liste autorisée et non depuis celle reçue
- Tous les fichiers de `src-tauri/capabilities/` sont actifs par défaut : en ajouter un élargit la surface sans autre geste
- Un appel sans permission déclarée échoue côté frontend, souvent sans message clair : c'est la première piste quand une API Tauri « ne fait rien »
- `deny` prime sur `allow` dans un scope : un chemin listé des deux côtés est refusé
- La syntaxe `shell:allow-spawn` avec `"sidecar": true` n'est pas confirmée verbatim par la documentation, seul l'équivalent sur `allow-execute` l'est : vérifier dans les exemples du dépôt `plugins-workspace`. L'échec serait immédiat et explicite (`program not allowed on the configured shell scope`). Cela vaut pour le **nom du programme** ; un argument non autorisé, lui, est retiré en silence (gotcha ci-dessus)
- `single-instance` n'a aucune permission à déclarer, et c'est le seul plugin retenu sans paquet npm
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
