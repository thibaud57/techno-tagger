---
paths:
  - ".github/workflows/**/*.yml"
  - ".github/workflows/**/*.yaml"
---

# GitHub Actions — Runners

## À faire
- `runs-on: ubuntu-24.04` par défaut pour les jobs de qualité, sauf celui du sidecar : ses tests touchent le backend keyring WinVault, l'encodage cp1252 des flux standard et `%LOCALAPPDATA%`, régressions que Linux laisserait passer
- `runs-on: windows-2025` obligatoire pour PyInstaller et `tauri build` : PyInstaller ne cross-compile pas, l'installeur Windows ne peut être produit que sur un runner Windows
- Installer explicitement chaque toolchain (`pnpm/setup` avec son input `runtime`, `astral-sh/setup-uv`, `dtolnay/rust-toolchain` cadré par le `rust-toolchain.toml`) au lieu de consommer ce que l'image fournit
- Toujours un label d'image figé, jamais `-latest` : un label flottant change d'image sans préavis (Ubuntu 22.04 → 24.04, Server 2022 → 2025) et casse un run sans qu'aucune PR ne l'annonce. Dependabot ne suit pas les images de runner : leur montée est manuelle, dans son propre commit, quand GitHub annonce la fin de vie de l'image
- Compter sur un runner neuf et éphémère à chaque job : aucun état ne survit d'un job à l'autre

## À éviter
- Se reposer sur les versions préinstallées de l'image : elles bougent au fil des mises à jour et feraient dériver silencieusement la version de Node, de Python ou de Rust utilisée
- Un self-hosted runner : le dépôt est public, un fork malveillant y exécuterait du code arbitraire sans isolation
- Les larger runners et runner groups : plan Team ou Enterprise, hors périmètre d'un projet à budget nul

## Gotchas
- `windows-2025` embarque Visual Studio 2026 ; c'est aussi la cible actuelle de `windows-latest`, comme `ubuntu-24.04` celle d'`ubuntu-latest`, mais les labels flottants ne sont pas utilisés
- Sur l'image Windows, Rust 1.98.0, Node, Python, MSVC et le SDK Windows sont préinstallés ; **la présence de WebView2 n'est pas confirmée** (cf. [VERSIONS.md](../../../docs/VERSIONS.md) § GitHub Actions)
- Clippy déplace régulièrement des lints entre catégories : le même code peut passer ou échouer selon la toolchain de l'image, d'où l'épinglage par `rust-toolchain.toml`
- Runners standard gratuits et illimités sur dépôt public, runners Windows compris
- Limites d'un runner standard : 6 h par job, 2 vCPU, 7 Go de RAM, 14 Go de disque
