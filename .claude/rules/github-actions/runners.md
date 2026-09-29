---
paths:
  - ".github/workflows/**/*.yml"
  - ".github/workflows/**/*.yaml"
---

# GitHub Actions — Runners

## À faire
- `runs-on: ubuntu-24.04` pour les jobs de qualité, sauf le sidecar : keyring WinVault, cp1252 et `%LOCALAPPDATA%` ne se testent que sous Windows
- `runs-on: windows-2025` pour PyInstaller et `tauri build` : PyInstaller ne cross-compile pas
- Installer explicitement chaque toolchain (`pnpm/setup`, `astral-sh/setup-uv`, `dtolnay/rust-toolchain` cadré par `rust-toolchain.toml`) plutôt que prendre celle de l'image
- Un label d'image figé, jamais `-latest` : un label flottant change d'image sans préavis. Dependabot ne suit pas les images, leur montée est manuelle
- Compter sur un runner neuf et éphémère à chaque job : aucun état ne survit d'un job à l'autre

## À éviter
- Se reposer sur les versions préinstallées de l'image : elles bougent au fil des mises à jour et feraient dériver silencieusement la version de Node, de Python ou de Rust utilisée
- Un self-hosted runner : le dépôt est public, un fork malveillant y exécuterait du code arbitraire sans isolation
- Les larger runners et runner groups : plan Team ou Enterprise, hors périmètre d'un projet à budget nul

## Gotchas
- La présence de WebView2 sur l'image `windows-2025` n'est pas confirmée (cf. [VERSIONS.md](../../../docs/VERSIONS.md) § GitHub Actions)
- Clippy déplace des lints d'une catégorie à l'autre entre toolchains : d'où l'épinglage par `rust-toolchain.toml`
- Limites d'un runner standard : 6 h par job, 2 vCPU, 7 Go de RAM, 14 Go de disque
