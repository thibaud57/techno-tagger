---
title: "Tauri v2 — Coquille desktop et pont vers le sidecar"
version: "2.11.5"
description: "Référence technique pour Tauri v2 : sidecar, capabilities et permissions, plugins officiels, asset protocol, updater et configuration de fenêtre."
date: "2026-08-29"
keywords: ["tauri", "desktop", "sidecar", "capabilities", "permissions", "updater", "asset-protocol"]
scope: ["docs"]
technologies: ["Rust", "Angular", "PyInstaller", "Python"]
---

# Description

Framework desktop qui empaquette une webview système et un binaire Rust. Ici, Tauri est une **coquille** : il affiche l'interface Angular, ouvre les dialogues natifs, persiste les préférences et surtout lance le sidecar Python avec lequel il échange en NDJSON (cf. [ADR-001](../adrs/001-coquille-desktop-tauri.md) et [ADR-005](../adrs/005-sidecar-python-protocole-ndjson.md)).

Aucune logique métier ne vit côté Rust : le calcul des scores, la construction des requêtes et l'écriture des tags sont dans le sidecar.

Versions du projet (cf. [VERSIONS.md](../VERSIONS.md)) : crate `tauri` 2.11.5, `tauri-build` 2.6.3, `@tauri-apps/cli` 2.11.4, `@tauri-apps/api` 2.11.1. **Les quatre paquets ont chacun leur cadence de patch** : un décalage de numéro entre la crate et le paquet npm est normal, pas un défaut d'alignement à corriger.

---

# Concepts Clés

## Sidecar : déclaration et nommage

### Description

Un sidecar est un binaire externe embarqué dans le bundle. Il se déclare dans `bundle.externalBin` et le fichier sur disque doit porter le **target triple** en suffixe, que Tauri retire à l'exécution.

### Exemple

```json
// src-tauri/tauri.conf.json
{
  "bundle": {
    "externalBin": ["binaries/tagger"]
  }
}
```

```
# Le fichier réellement produit par PyInstaller doit s'appeler :
src-tauri/binaries/tagger-x86_64-pc-windows-msvc.exe

# Obtenir le triple de la machine :
rustc --print host-tuple
```

### Points Importants

- **Le chemin de `externalBin` est relatif à `src-tauri/tauri.conf.json`**, pas à la racine du projet
- **Le suffixe target triple est obligatoire sur le fichier, et absent de l'appel** : `sidecar("tagger")` côté code, `tagger-x86_64-pc-windows-msvc.exe` sur disque. Un binaire nommé sans suffixe est introuvable au lancement, avec une erreur peu explicite
- `app.shell().sidecar("tagger")` attend **le nom déclaré, jamais un chemin complet**
- Le script de build du sidecar doit donc renommer la sortie PyInstaller avec le triple avant que `tauri build` ne passe

---

## `spawn()` et non `execute()`

### Description

Deux façons de lancer un sidecar. `execute()` est bloquant et rend la sortie complète une fois le process terminé. `spawn()` est asynchrone, rend un `Receiver<CommandEvent>` plus un `Child`, et permet de lire `stdout` ligne par ligne tout en écrivant sur `stdin`.

Le protocole du projet étant un flux continu sur un process long, **seul `spawn()` convient**.

### Exemple

```rust
let sidecar = app.shell().sidecar("tagger")?;
let (mut rx, mut child) = sidecar.spawn()?;

while let Some(event) = rx.recv().await {
    if let CommandEvent::Stdout(line_bytes) = event {
        let line = String::from_utf8_lossy(&line_bytes);
        // 1 ligne = 1 événement NDJSON à réémettre vers la webview
    }
}

// Commande de l'UI vers le sidecar
child.write(b"{\"cmd\":\"start_run\"}\n")?;
```

### Points Importants

- **`execute()` ne conviendrait pas** : il attend la fin du process, donc aucune barre de progression et aucun arbitrage en cours de run
- `CommandEvent` distingue `Stdout`, `Stderr`, `Terminated` et `Error` : le sidecar écrit ses événements sur `stdout` et ses logs sur `stderr`, ce qui rend le tri trivial
- **Une ligne `stdout` = un événement NDJSON.** Le découpage en lignes est fait par Tauri, pas à refaire
- Le mode `--onefile` de PyInstaller a une limite documentée : `Process.kill()` ne cible que le PID du bootloader, pas le process Python réel (cf. [pyinstaller.md](pyinstaller.md))

---

## Capabilities et permissions

### Description

Contrairement à Tauri v1 où toutes les commandes IPC étaient accessibles, **v2 exige un octroi explicite** par fichier de capability. Tous les fichiers de `src-tauri/capabilities/` sont actifs par défaut.

### Exemple

```json
// src-tauri/capabilities/default.json
{
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    "core:default",
    {
      "identifier": "shell:allow-spawn",
      "allow": [{ "name": "binaries/tagger", "sidecar": true }]
    },
    "dialog:allow-open",
    "store:default",
    "os:allow-locale",
    "opener:allow-open-path",
    "updater:default"
  ]
}
```

### Points Importants

- **`shell:allow-spawn` et non `shell:allow-execute`** : la permission suit la méthode réellement appelée. Accorder `allow-execute` sans l'utiliser élargit la surface pour rien
- **`"sidecar": true` restreint au binaire déclaré** : aucune commande arbitraire n'est autorisée, même avec le plugin `shell` actif
- Le champ `windows` restreint la capability à une fenêtre nommée, `platforms` à un OS
- **Un appel sans permission déclarée échoue côté frontend**, souvent sans message clair : c'est la première piste quand une API Tauri « ne fait rien »
- Un tableau `args` avec validateurs regex permet de whitelister les arguments passés au sidecar

---

## Plugins retenus par le projet

### Description

Huit plugins officiels couvrent les besoins natifs. Chacun a sa crate Rust et son paquet npm, **strictement alignés en version plugin par plugin** (cf. [VERSIONS.md](../VERSIONS.md#2-plugins-officiels-tauri-v2)).

### Exemple

| Plugin | Usage dans le projet |
|---|---|
| `shell` | Lancement du sidecar via `spawn()`, permission restreinte au binaire |
| `dialog` | Sélection des dossiers source et destination, et du fichier de playlist |
| `fs` | Accès aux chemins choisis, périmètre restreint |
| `store` | Préférences : langue, seuils, mode copie/déplacement, signal sonore, URL de l'API |
| `os` | Lecture de la locale système au premier lancement (`locale()`, BCP-47) |
| `opener` | Ouverture du dossier de logs, liens vers la fiche source |
| `single-instance` | Un second lancement donne le focus à la fenêtre existante |
| `updater` | Vérification du manifeste au démarrage, installation signée |

### Points Importants

- **`single-instance` doit être le premier plugin enregistré** dans le builder, avant tout autre `.plugin()`. Enregistré plus loin, il ne fonctionne pas de façon fiable
- **Ouvrir un chemin ou une URL relève de `opener`, plus de `shell`** en v2. La permission `shell` du projet étant `allow-spawn` restreinte au sidecar, elle ne couvre ni l'un ni l'autre
- **L'URL de l'API est persistée dans le `store` mais transmise au sidecar par une commande**, le `store` n'étant pas lisible depuis Python
- Le plugin `os` rend un tag BCP-47 complet (`fr-FR`) : extraire les deux premières lettres pour choisir la langue

---

## Asset protocol : afficher les pochettes du cache

### Description

La webview ne peut pas lire un fichier du disque par un chemin nu. L'asset protocol expose un périmètre choisi derrière un schéma `asset:`, et `convertFileSrc()` traduit un chemin absolu en URL consommable.

C'est ce qui évite de transporter les pochettes en base64 dans le flux NDJSON.

### Exemple

```json
// src-tauri/tauri.conf.json
{
  "app": {
    "security": {
      "assetProtocol": {
        "enable": true,
        "scope": ["$APPLOCALDATA/cache/artworks/**"]
      },
      "csp": "default-src 'self'; connect-src 'self' ipc: http://ipc.localhost; img-src 'self' asset: http://asset.localhost blob: data:; style-src 'self' 'unsafe-inline'"
    }
  }
}
```

```typescript
import { convertFileSrc } from '@tauri-apps/api/core';

const artworkUrl = convertFileSrc(event.artwork_path); // asset://localhost/...
```

### Points Importants

- **La CSP doit autoriser `asset:` et `http://asset.localhost`**, sinon la webview refuse l'image sans erreur réseau visible
- **Poser une CSP oblige à déclarer `connect-src`** : l'IPC v2 passe par un `fetch()` sur `http://ipc.localhost` (`scripts/ipc-protocol.js`), que `default-src 'self'` refuse. Sans lui, `invoke()` est bloqué, pas seulement les appels réseau
- **`style-src 'self' 'unsafe-inline'` est nécessaire dès qu'un composant injecte son style à l'exécution** (le thème PrimeNG le fait) : Tauri n'ajoute de nonce qu'aux balises portant ses jetons `__TAURI_STYLE_NONCE__`, absents d'un build Angular, et ne hashe que les fichiers `.js` / `.mjs`
- Un gestionnaire d'événement en attribut (`onload="…"`) n'est débloquable par aucune directive quand un hash est présent sur `script-src` : il faut le supprimer côté frontend
- **`deny` prime sur `allow`** dans le scope : un chemin listé des deux côtés est refusé
- Restreindre le scope au dossier de cache, jamais à l'ensemble du disque : c'est ce qui empêche la webview de lire la bibliothèque musicale de l'utilisateur
- Le cache étant jetable (cf. [ADR-013](../adrs/013-cache-disque-jetable.md)), une pochette peut disparaître entre l'événement et l'affichage : prévoir un fallback visuel

---

## Updater et artefacts signés

### Description

L'updater vérifie un manifeste au démarrage, télécharge et installe une mise à jour **signée**. La signature n'est pas désactivable.

### Exemple

```json
{
  "bundle": { "createUpdaterArtifacts": true },
  "plugins": {
    "updater": {
      "pubkey": "<clé publique en clair>",
      "endpoints": ["https://<host>/{{target}}/{{arch}}/{{current_version}}"],
      "windows": { "installMode": "passive" }
    }
  }
}
```

```bash
# Génération de la paire de clés, une fois pour toutes
tauri signer generate -w ~/.tauri/techno-tagger.key
```

### Points Importants

- **La clé privée ne va jamais dans le dépôt** : variable d'environnement au moment du build en CI
- Le manifeste requiert `version`, `platforms.<target>.url` et `platforms.<target>.signature` ; `notes` et `pub_date` sont optionnels
- **Sous Windows, l'application se ferme automatiquement avant l'installation** : un run en cours serait interrompu, d'où la vérification au démarrage et non en plein run
- `installMode: "passive"` évite l'assistant d'installation à chaque mise à jour

---

## Configuration de la fenêtre

### Description

Le dimensionnement vit dans `tauri.conf.json` et s'applique à chaque démarrage. Le plancher vient du jeu de colonnes de la liste d'un run (cf. [DESIGN.md § Layout](../DESIGN.md#-layout--espacement)).

### Exemple

```json
{
  "app": {
    "windows": [{
      "title": "techno-tagger",
      "width": 1280, "height": 800,
      "minWidth": 1024, "minHeight": 700,
      "resizable": true
    }]
  }
}
```

### Points Importants

- **La taille n'est pas mémorisée entre deux lancements** : un agrandissement est perdu à la fermeture. Le plugin `window-state` corrigerait ça, il n'est pas retenu au MVP
- `resizable: true` sans plafond : l'agrandissement est libre, seul le plancher est contraint
- Le mode sombre est posé côté webview (classe sur `<html>` plus `darkModeSelector` PrimeNG), pas par Tauri

---

# Commandes Clés

## Développement et build

### Description

Le cycle courant. `beforeDevCommand` et `beforeBuildCommand` déclenchent le build Angular, mais **jamais celui du sidecar** : il faut l'avoir produit avant.

### Syntaxe

```bash
pnpm tauri dev                  # build front + app en hot-reload Rust
pnpm tauri build                # build front + release + installeurs
pnpm tauri build --debug        # même chose, symboles conservés
pnpm tauri bundle               # installeurs seuls, sans recompiler
pnpm tauri info                 # versions crates/plugins, diagnostic de mismatch
```

### Points Importants

- **`tauri build` échoue si le sidecar n'est pas présent au bon nom** : le construire d'abord (`uv run python build.py`)
- **Aucune cross-compilation** : les artefacts Windows exigent un runner Windows
- `tauri info` est le premier réflexe quand une crate et son paquet npm divergent

## Signature et permissions

### Description

Génération des clés de l'updater et manipulation des fichiers de capabilities.

### Syntaxe

```bash
tauri signer generate -w <chemin-cle>   # paire de clés updater
tauri signer sign <fichier> -k <cle>    # signature manuelle d'un artefact
tauri permission ls                     # permissions disponibles
tauri permission add <identifiant>      # ajout dans une capability
```

### Points Importants

- **`tauri signer generate` écrase une clé existante avec `--force`** : une clé perdue rend toutes les installations déjà distribuées non-updatables
- `tauri permission ls` évite d'inventer un identifiant de permission, source d'échec silencieux

---

# Bonnes Pratiques

## ✅ Recommandations

- **Enregistrer `single-instance` en premier** dans le builder, avant tout autre plugin
- **Restreindre chaque permission au strict nécessaire** : `shell:allow-spawn` ciblé sur le sidecar, `fs` limité aux chemins choisis, `assetProtocol` limité au cache
- **Traiter `stdout` comme le canal de protocole et `stderr` comme le canal de logs**, sans jamais mélanger les deux
- **Nommer le sidecar avec son target triple dans le script de build**, pas à la main
- **Vérifier les mises à jour au démarrage uniquement**, jamais pendant un run : l'installation ferme l'application
- **Garder la CSP explicite** et y ajouter `asset:` en même temps que l'activation de l'asset protocol, les deux réglages n'ayant de sens qu'ensemble

## ❌ Anti-Patterns

- **`execute()` pour le sidecar** : bloque jusqu'à la fin du process, ce qui supprime progression et arbitrage
- **`shell:allow-execute` « au cas où »** : ouvre l'exécution de commandes arbitraires sans bénéfice
- **Un scope `assetProtocol` large** (`$HOME/**`) : la webview accéderait à toute la bibliothèque musicale
- **Transporter les pochettes en base64 dans le NDJSON** : le flux gonfle pour rien, l'asset protocol existe pour ça
- **Mettre de la logique métier dans les commandes Rust** : la frontière du projet est le protocole, pas un appel de fonction
- **Compter sur un `Process.kill()` pour arrêter un sidecar PyInstaller onefile** : il ne cible que le bootloader
- **Oublier le suffixe target triple** : le binaire est introuvable et le message d'erreur n'oriente pas vers cette cause

---

# 🔗 Ressources

## Documentation Officielle

- [Tauri v2](https://v2.tauri.app/)
- [Embedding External Binaries (sidecar)](https://v2.tauri.app/develop/sidecar/)
- [Capabilities](https://v2.tauri.app/security/capabilities/)
- [Asset Protocol](https://v2.tauri.app/security/asset-protocol/)
- [Updater Plugin](https://v2.tauri.app/plugin/updater/)
- [Configuration Reference](https://v2.tauri.app/reference/config/)
- [CLI Reference](https://v2.tauri.app/reference/cli/)

## Ressources Complémentaires

- [ADR-001 — Coquille desktop Tauri](../adrs/001-coquille-desktop-tauri.md)
- [ADR-005 — Sidecar Python et protocole NDJSON](../adrs/005-sidecar-python-protocole-ndjson.md)
- [ADR-015 — Cibles de distribution Windows](../adrs/015-cibles-distribution-windows.md)
- [pyinstaller.md](pyinstaller.md) — empaquetage du sidecar
