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
- Appeler `Command.sidecar("binaries/tagger")` depuis la webview, avec le nom exact de `bundle.externalBin` et de la capability, sans suffixe target triple. C'est ce chemin IPC, et lui seul, que le scope protège : l'API Rust `app.shell().sidecar(...)` ne passe par aucun scope, et le projet garde `src-tauri/src/` à la seule initialisation des plugins
- Lancer par `spawn()` : le protocole est un flux continu sur un process long, `execute()` attend la fin du process
- Traiter `stdout` comme le canal de protocole et `stderr` comme le canal de logs, sans jamais mélanger les deux : `CommandEvent` distingue `Stdout`, `Stderr`, `Terminated` et `Error`
- Consommer une ligne `stdout` comme un événement NDJSON : le découpage est fait par Tauri, il n'est pas à refaire
- Construire le sidecar avant `tauri build` : `beforeDevCommand` et `beforeBuildCommand` déclenchent le build Angular, jamais celui du sidecar
- Déclarer le dossier `_internal/` d'un build `--onedir` en `bundle.resources` **sous la forme objet** (`{ "binaries/_internal": "_internal" }`), qui le pose à côté de l'exécutable : `externalBin` ne gère qu'un exécutable

## À éviter
- `execute()` pour le sidecar : bloque jusqu'à la fin du process, donc plus de barre de progression ni d'arbitrage en cours de run
- Omettre le suffixe target triple : le binaire est introuvable au lancement et le message d'erreur n'oriente pas vers cette cause
- Mettre de la logique métier dans les commandes Rust : la frontière du projet est le protocole, pas un appel de fonction
- Compter sur un `Process.kill()` pour arrêter un sidecar PyInstaller `--onefile` : il ne cible que le PID du bootloader, pas le process Python
- Transporter les pochettes en base64 dans le flux NDJSON : l'asset protocol existe pour ça (cf. [config-bundle.md](config-bundle.md))

## Gotchas
- Le nom attendu diffère selon l'API : `Command.sidecar()` côté JS résout dans `bundle.externalBin` et exige donc `binaries/tagger`, là où `app.shell().sidecar()` côté Rust accepte `tagger`. Un `SidecarNotAllowed` au premier lancement vient de là
- `tauri build` échoue si le sidecar n'est pas présent sous le nom attendu : le produire d'abord par `uv run python build.py`
- Aucune cross-compilation : les artefacts Windows exigent un runner Windows
- `tauri-action` n'offre aucun hook pour construire un sidecar avant `tauri build` : la construction et la copie dans `src-tauri/binaries/` sont une étape antérieure du même job
- La documentation Tauri cite explicitement les applications Python empaquetées par PyInstaller comme cas d'usage d'`externalBin`
- `tauri info` est le premier réflexe quand une crate et son paquet npm divergent
- La forme tableau (`["binaries/_internal/**/*"]`) place le dossier sous `binaries/_internal/` dans le bundle, et `resolveResource()` n'y change rien : le bootloader `--onedir` de PyInstaller résout son dossier de contenu **relativement à l'exécutable**, sans passer par l'API Tauri. Symptôme : `Failed to load Python DLL ...\_internal\python314.dll` au premier spawn, invisible en `tauri dev`
- Tauri strippe le target triple en stageant l'`externalBin` : le fichier sur disque s'appelle `tagger-x86_64-pc-windows-msvc.exe`, le process lancé s'appelle `tagger.exe`. Un `taskkill /IM` sur le nom suffixé ne tue rien

## Exemples
```typescript
// ✅ spawn depuis la webview : lecture ligne à ligne pendant que le process vit
const command = Command.sidecar('binaries/tagger'); // nom d'externalBin, sans suffixe
const child = await command.spawn();

command.stdout.on('data', (line) => { /* 1 ligne = 1 événement NDJSON */ });
command.stderr.on('data', (line) => console.error(line));
await child.write('{"cmd":"start_run"}\n');

// ❌ execute : rend la sortie complète une fois le process terminé
const output = await Command.sidecar('binaries/tagger').execute();
```
