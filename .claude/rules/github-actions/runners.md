---
paths:
  - ".github/workflows/**/*.yml"
  - ".github/workflows/**/*.yaml"
---

# GitHub Actions — Runners

## À faire
- `runs-on: ubuntu-latest` par défaut pour les jobs de qualité
- `runs-on: windows-latest` obligatoire pour PyInstaller et `tauri build` : PyInstaller ne cross-compile pas, l'installeur Windows ne peut être produit que sur un runner Windows
- Installer explicitement chaque toolchain (`pnpm/setup` avec son input `runtime`, `astral-sh/setup-uv`, `dtolnay/rust-toolchain` cadré par le `rust-toolchain.toml`) au lieu de consommer ce que l'image fournit
- Figer l'image (`windows-2025` plutôt que `windows-latest`) le jour où un changement d'image casse le build, pas avant
- Compter sur un runner neuf et éphémère à chaque job : aucun état ne survit d'un job à l'autre

## À éviter
- Se reposer sur les versions préinstallées de l'image : elles bougent au fil des mises à jour et feraient dériver silencieusement la version de Node, de Python ou de Rust utilisée
- Un self-hosted runner : le dépôt est public, un fork malveillant y exécuterait du code arbitraire sans isolation
- Les larger runners et runner groups : plan Team ou Enterprise, hors périmètre d'un projet à budget nul

## Gotchas
- `windows-latest` pointe désormais sur Windows Server 2025 avec Visual Studio 2026, plus sur Server 2022 ; `ubuntu-latest` sur Ubuntu 24.04
- Sur l'image Windows, Rust 1.98.0, Node, Python, MSVC et le SDK Windows sont préinstallés ; **la présence de WebView2 n'est pas confirmée** (cf. [VERSIONS.md](../../../docs/VERSIONS.md) § GitHub Actions)
- Clippy déplace régulièrement des lints entre catégories : le même code peut passer ou échouer selon la toolchain de l'image, d'où l'épinglage par `rust-toolchain.toml`
- Runners standard gratuits et illimités sur dépôt public, runners Windows compris
- Limites d'un runner standard : 6 h par job, 2 vCPU, 7 Go de RAM, 14 Go de disque
