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
- Un label d'image figé, jamais `-latest` : un label flottant change d'image sans préavis (`ubuntu-latest` bascule vers 26.04 entre le 2026-10-19 et le 2026-11-19). Dependabot ne suit pas les images, leur montée est manuelle
- Compter sur un runner neuf et éphémère à chaque job : aucun état ne survit d'un job à l'autre

## À éviter
- Se reposer sur les versions préinstallées de l'image : elles bougent au fil des mises à jour et feraient dériver silencieusement la version de Node, de Python ou de Rust utilisée
- Un self-hosted runner : le dépôt est public, un fork malveillant y exécuterait du code arbitraire sans isolation
- Les larger runners et runner groups : plan Team ou Enterprise, hors périmètre d'un projet à budget nul

## Gotchas
- La présence de WebView2 sur l'image `windows-2025` n'est pas confirmée (cf. [VERSIONS.md](../../../docs/VERSIONS.md) § GitHub Actions)
- Clippy déplace des lints d'une catégorie à l'autre entre toolchains : d'où l'épinglage par `rust-toolchain.toml`
- `windows-2025` embarque Visual Studio 2026 depuis juin 2026 : c'est la toolchain MSVC que voient Rust, Tauri et PyInstaller. `windows-2022` reste l'image Visual Studio 2022
- Node 20 est retiré des runners depuis le 2026-09-23 : une action en `runs.using: node20` échoue, vérifier ce champ avant d'épingler une action
- Limites d'un runner standard sur dépôt public : 6 h par job, 4 vCPU, 16 Go de RAM (2 vCPU et 8 Go sur dépôt privé)
