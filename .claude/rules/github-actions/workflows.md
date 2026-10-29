---
paths:
  - ".github/workflows/**/*.yml"
  - ".github/workflows/**/*.yaml"
  - ".github/actions/**/action.yml"
  - ".github/dependabot.yml"
---

# GitHub Actions : workflows, jobs, runners et cache

## À faire
- Placer chaque workflow dans `.github/workflows/`, un fichier par finalité : gate qualité sur PR, release-please + build
- Déclarer un job par zone indépendante (`sidecar/`, `src/`, `src-tauri/`) : les jobs tournent en parallèle sur des runners dédiés
- Poser `defaults.run.working-directory` au niveau job quand tous ses steps opèrent sur une seule zone, plutôt que répéter `working-directory` step par step
- Chaîner par `needs:` ce qui dépend d'un résultat antérieur, comme le build de release derrière release-please
- Construire le sidecar PyInstaller et lancer `tauri build` dans le **même job** : `tauri-action` n'offre aucun hook pour produire un binaire externe avant son appel
- **Token de GitHub App** pour release-please : `actions/create-github-app-token` avant l'étape qui l'utilise (identifiants cf. [security-permissions.md](security-permissions.md)), puis `steps.<id>.outputs.token` en `token:` de release-please-action, pour que la PR de release lance sa CI
- Garder le `id: app-token`, **load-bearing** : sans lui l'expression résout à vide, l'action retombe sur `github.token`, le run reste vert mais la CI de la PR de release redevient bloquée en attente d'approbation
- Borner le token d'App par `permission-*` (`contents`, `issues` et `pull-requests` en `write` pour release-please), `owner` et `repositories` laissés vides pour le scoper au dépôt courant : sans `permission-*`, il reçoit toutes les permissions de l'installation de l'App
- Installer un outil dont la version sert à plusieurs jobs par une action composite locale (`./.github/actions/setup-uv`, `./.github/actions/setup-pnpm`), seul endroit où vit cette version : jamais de version recopiée d'un job à l'autre
- Construire une clé de cache avec `runner.os` et `hashFiles` sur le lockfile de la zone concernée, plus des `restore-keys` en repli
- Laisser les actions de setup gérer leur propre cache (`pnpm/setup` avec `cache: true`, désactivé par défaut ; `astral-sh/setup-uv` ; `Swatinem/rust-cache`) plutôt que câbler un `actions/cache` par-dessus
- Publier une valeur entre jobs par `echo "clé=valeur" >> $GITHUB_OUTPUT` sur un step porteur d'un `id:`, remontée dans `outputs:` du job et lue en `needs.<job>.outputs.<clé>`
- Annoter avec `::error file=…,line=…::` ce qui doit remonter dans la PR plutôt que se perdre dans la sortie du step
- `runs-on: ubuntu-24.04` pour les jobs de qualité, sauf le sidecar et la coquille Tauri : keyring WinVault, cp1252 et `%LOCALAPPDATA%` ne se testent que sous Windows ; le `cargo check` de la coquille exige le binaire PyInstaller du sidecar
- `runs-on: windows-2025` pour PyInstaller et `tauri build` : PyInstaller ne cross-compile pas
- Installer explicitement chaque toolchain (`pnpm/setup`, `astral-sh/setup-uv`, `dtolnay/rust-toolchain` cadré par `rust-toolchain.toml`) plutôt que prendre celle de l'image
- Un label d'image figé, jamais `-latest` : un label flottant change d'image sans préavis (`ubuntu-latest` bascule vers 26.04 entre le 2026-10-19 et le 2026-11-19). Dependabot ne suit pas les images, leur montée est manuelle

## À éviter
- Un `workflow_call` tant qu'il n'y a qu'un appelant : secrets à repasser et logs imbriqués, sans rien factoriser
- Rejouer en CI ce que la CI joue déjà ailleurs : pas de hooks pre-commit, le même trio lint / typecheck / tests tourne sur chaque PR
- Mettre `src-tauri/target/release/` en cache : Tauri y copie le sidecar sans invalider la copie, un cache périmé embarquerait un ancien binaire dans l'installeur distribué
- Confondre `$GITHUB_OUTPUT` (valeur partagée entre jobs via `needs:`) et `$GITHUB_ENV` (variable d'environnement des steps suivants du même job)
- Une clé de cache figée sans `hashFiles` : le cache ne s'invalide jamais et sert des dépendances périmées
- `actions/upload-artifact@v3`, dépréciée depuis le 2024-11-30, à ne jamais reprendre d'un exemple ancien
- Se reposer sur les versions préinstallées de l'image : elles bougent au fil des mises à jour et feraient dériver silencieusement la version de Node, de Python ou de Rust utilisée
- Un self-hosted runner : le dépôt est public, un fork malveillant y exécuterait du code arbitraire sans isolation

## Gotchas
- `actions/checkout` v7 refuse par défaut de récupérer le code d'une PR de fork sous `pull_request_target` et sous `workflow_run` déclenché par une PR (opt-out `allow-unsafe-pr-checkout`). Un SHA épinglé sur une v6 ou antérieure ne reçoit pas cette garde
- Une action composite locale s'appelle par `uses: ./.github/actions/<nom>` après `actions/checkout` et Dependabot ne la scanne que si son dossier figure dans les `directories` de l'entrée `github-actions`
- Le shell par défaut d'un job Windows est PowerShell : poser `shell: bash` explicitement si les commandes sont écrites pour bash
- Deux uploads d'artifact du même nom échouent (`upload-artifact@v7`), sauf avec `overwrite: true`
- Le cache est plafonné à 10 Go par dépôt, toutes branches et workflows confondus et une entrée non lue depuis 7 jours est supprimée : le build de release, mensuel au mieux, part à froid
- Un run ne restaure que les caches de sa branche, de la branche par défaut ou, pour une PR, de sa base : un cache créé par une PR ne sert qu'à ses re-runs
- `cache-mode` (`read`, `write`, `none`…) restreint l'accès au cache par workflow ou par job ; sans lui, les défauts sécurisés de GitHub s'appliquent
- `::add-mask::` masque une valeur calculée à l'exécution, ce que le masquage des secrets statiques ne couvre pas
- La rétention par défaut d'un artifact est de 90 jours ; l'installeur distribué vit sur la Release, pas dans un artifact
- La présence de WebView2 sur l'image `windows-2025` n'est pas confirmée (cf. [VERSIONS.md § GitHub Actions](../../../docs/VERSIONS.md#4-github-actions))
- Clippy déplace des lints d'une catégorie à l'autre entre toolchains : d'où l'épinglage par `rust-toolchain.toml`
- `windows-2025` embarque Visual Studio 2026 : c'est la toolchain MSVC que voient Rust, Tauri et PyInstaller. `windows-2022` reste l'image Visual Studio 2022
- Node 20 est retiré des runners depuis le 2026-09-23 : une action en `runs.using: node20` échoue, vérifier ce champ avant d'épingler une action

## Exemples
```yaml
# ✅ working-directory posé une fois pour tout le job
jobs:
  lint-python:
    runs-on: ubuntu-24.04
    defaults:
      run:
        working-directory: sidecar
    steps:
      - uses: actions/checkout@<sha>
      - run: uv run ruff check .
      - run: uv run pytest

# ❌ répété sur chaque step
    steps:
      - run: uv run ruff check .
        working-directory: sidecar
      - run: uv run pytest
        working-directory: sidecar
```

```yaml
# ✅ output d'un job consommé par le suivant
jobs:
  prepare:
    outputs:
      version: ${{ steps.read.outputs.version }}
    steps:
      - id: read
        run: echo "version=$(cat VERSION)" >> $GITHUB_OUTPUT
  build:
    needs: prepare
    steps:
      - run: echo "build ${{ needs.prepare.outputs.version }}"

# ❌ $GITHUB_ENV ne traverse pas les jobs
      - run: echo "version=1.2.3" >> $GITHUB_ENV
```
