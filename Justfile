set dotenv-load
set windows-shell := ["bash", "-cu"]

WEB_PORT := env("WEB_PORT", "4200")

# Lister les recettes disponibles
default:
    @just --list

# ── Dev ───────────────────────────────────────────────────────────────────────

# Lancer l'application complete (Angular + fenetre Tauri)
[group('dev')]
dev:
    pnpm exec tauri dev

# Lancer la webview Angular seule, dans le navigateur
[group('dev')]
dev-ui:
    pnpm start

# Lancer le sidecar en CLI, pour tester le protocole sans interface
[group('dev')]
dev-sidecar:
    cd sidecar && uv run python -m tagger

# Arreter le dev server Angular (libere le port {{WEB_PORT}})
[group('dev')]
[windows]
stop-ui:
    powershell -Command "(Get-NetTCPConnection -LocalPort {{WEB_PORT}} -ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique | ForEach-Object { taskkill /PID \$_ /T /F *>\$null }; Write-Host 'Angular arrete'"

# Arreter le dev server Angular
[group('dev')]
[unix]
stop-ui:
    pkill -f "ng serve" || true

# Arreter la fenetre Tauri et le sidecar qu'elle a spawn
[group('dev')]
[windows]
stop-app:
    powershell -Command "taskkill /IM techno-tagger.exe /T /F *>\$null; taskkill /IM tagger-x86_64-pc-windows-msvc.exe /T /F *>\$null; Write-Host 'Application arretee'"

# Arreter la fenetre Tauri et le sidecar qu'elle a spawn
[group('dev')]
[unix]
stop-app:
    pkill -f "techno-tagger" || true
    pkill -f "tagger-" || true

# Tout arreter
[group('dev')]
stop: stop-ui stop-app

# ── Quality ───────────────────────────────────────────────────────────────────

# Empaqueter le sidecar Python et l'installer dans src-tauri/binaries/
[group('quality')]
build-sidecar:
    cd sidecar && uv run --group build python build.py

# Compiler la webview Angular
[group('quality')]
build-ui:
    pnpm build

# Produire l'installeur Windows
[group('quality')]
build: build-sidecar
    # Ordre impose : sans le binaire du sidecar, tauri build echoue sur externalBin
    pnpm exec tauri build

# Lint de la webview
[group('quality')]
lint-ui:
    pnpm exec ng lint

# Lint du sidecar
[group('quality')]
lint-sidecar:
    cd sidecar && uv run ruff check .
    cd sidecar && uv run ruff format --check .

# Lint de la coquille Tauri
[group('quality')]
lint-tauri:
    cd src-tauri && cargo clippy -- -D warnings

# Lint des trois zones
[group('quality')]
lint: lint-ui lint-sidecar lint-tauri

# Typage de la webview
[group('quality')]
typecheck-ui:
    pnpm exec tsc --noEmit -p tsconfig.app.json

# Typage du sidecar
[group('quality')]
typecheck-sidecar:
    cd sidecar && uv run mypy src

# Typage des deux zones typees
[group('quality')]
typecheck: typecheck-ui typecheck-sidecar

# Tests du sidecar, seuil de couverture compris
[group('quality')]
test-sidecar:
    # Seuil porte ici et non dans addopts : sur un run cible, la couverture
    # globale serait mecaniquement basse
    cd sidecar && uv run pytest --cov-fail-under=80

# Tests de la webview
[group('quality')]
test-ui:
    pnpm exec ng test

# Tous les tests
[group('quality')]
test: test-sidecar test-ui

# ── Setup ─────────────────────────────────────────────────────────────────────

# Installer les dependances de la webview
[group('setup')]
install-ui:
    pnpm install

# Installer les dependances du sidecar, groupes dev et build compris
[group('setup')]
install-sidecar:
    cd sidecar && uv sync --all-groups

# Recuperer les crates de la coquille Tauri
[group('setup')]
install-tauri:
    cd src-tauri && cargo fetch

# Installer les dependances des trois zones
[group('setup')]
install: install-ui install-sidecar install-tauri

# Setup complet : dependances puis binaire du sidecar, requis par toute commande Tauri
[group('setup')]
setup: install build-sidecar

# Verifier que l'environnement local est pret
[group('setup')]
check:
    @node --version > /dev/null 2>&1 || echo "⚠️ Node requis (>=24.15.0)"
    @pnpm --version > /dev/null 2>&1 || echo "⚠️ pnpm requis (11.24.0)"
    @uv --version > /dev/null 2>&1 || echo "⚠️ uv requis (0.12.7)"
    @rustc --version > /dev/null 2>&1 || echo "⚠️ Rust requis (1.98.0, toolchain epinglee dans rust-toolchain.toml)"
    @test -d node_modules || echo "⚠️ Dependances webview absentes, lancer just install-ui"
    @test -d sidecar/.venv || echo "⚠️ Environnement du sidecar absent, lancer just install-sidecar"
    @test -f src-tauri/binaries/tagger-x86_64-pc-windows-msvc.exe || echo "⚠️ Binaire du sidecar absent, lancer just build-sidecar (sans lui toute commande Tauri echoue)"
