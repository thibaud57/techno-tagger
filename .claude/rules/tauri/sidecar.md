---
paths:
  - "src-tauri/tauri.conf.json"
  - "src-tauri/src/lib.rs"
  - "src/app/core/sidecar.service.ts"
  - "sidecar/build.py"
---

# Tauri — Sidecar

## À faire
- Déclarer le binaire dans `bundle.externalBin`, avec un chemin relatif à `src-tauri/tauri.conf.json` et non à la racine du projet
- Suffixer le fichier produit du target triple depuis le script de build (`rustc --print host-tuple`), jamais à la main : `tagger-x86_64-pc-windows-msvc.exe` sur disque
- Appeler `app.shell().sidecar("tagger")` avec le nom déclaré, sans suffixe ni chemin complet
- Lancer par `spawn()` : le protocole est un flux continu sur un process long, `execute()` attend la fin du process
- Traiter `stdout` comme le canal de protocole et `stderr` comme le canal de logs, sans jamais mélanger les deux : `CommandEvent` distingue `Stdout`, `Stderr`, `Terminated` et `Error`
- Consommer une ligne `stdout` comme un événement NDJSON : le découpage est fait par Tauri, il n'est pas à refaire
- Construire le sidecar avant `tauri build` : `beforeDevCommand` et `beforeBuildCommand` déclenchent le build Angular, jamais celui du sidecar
- Déclarer le dossier `_internal/` d'un build `--onedir` en `bundle.resources`, résolu au runtime par `resolveResource()` : `externalBin` ne gère qu'un exécutable

## À éviter
- `execute()` pour le sidecar : bloque jusqu'à la fin du process, donc plus de barre de progression ni d'arbitrage en cours de run
- Omettre le suffixe target triple : le binaire est introuvable au lancement et le message d'erreur n'oriente pas vers cette cause
- Mettre de la logique métier dans les commandes Rust : la frontière du projet est le protocole, pas un appel de fonction
- Compter sur un `Process.kill()` pour arrêter un sidecar PyInstaller `--onefile` : il ne cible que le PID du bootloader, pas le process Python
- Transporter les pochettes en base64 dans le flux NDJSON : l'asset protocol existe pour ça (cf. [config-bundle.md](config-bundle.md))

## Gotchas
- `tauri build` échoue si le sidecar n'est pas présent sous le nom attendu : le produire d'abord par `uv run python build.py`
- Aucune cross-compilation : les artefacts Windows exigent un runner Windows
- `tauri-action` n'offre aucun hook pour construire un sidecar avant `tauri build` : la construction et la copie dans `src-tauri/binaries/` sont une étape antérieure du même job
- La documentation Tauri cite explicitement les applications Python empaquetées par PyInstaller comme cas d'usage d'`externalBin`
- `tauri info` est le premier réflexe quand une crate et son paquet npm divergent

## Exemples
```rust
// ✅ spawn : lecture ligne à ligne pendant que le process vit
let sidecar = app.shell().sidecar("tagger")?;   // nom déclaré, pas de suffixe
let (mut rx, mut child) = sidecar.spawn()?;

while let Some(event) = rx.recv().await {
    if let CommandEvent::Stdout(line) = event { /* 1 ligne = 1 événement NDJSON */ }
}
child.write(b"{\"cmd\":\"start_run\"}\n")?;

// ❌ execute : rend la sortie complète une fois le process terminé
let output = app.shell().sidecar("tagger")?.execute().await?;
```
