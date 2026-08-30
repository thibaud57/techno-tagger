set dotenv-load
set windows-shell := ["bash", "-cu"]

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

# Arreter le dev server Angular (port 4200, aligne sur devUrl de tauri.conf.json)
[group('dev')]
stop-ui:
    powershell -Command "(Get-NetTCPConnection -LocalPort 4200 -ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique | ForEach-Object { taskkill /PID \$_ /T /F *>\$null }; Write-Host 'Angular arrete'"

# Arreter la fenetre Tauri et le sidecar qu'elle a spawn
[group('dev')]
stop-app:
    powershell -Command "taskkill /IM techno-tagger.exe /T /F *>\$null; taskkill /IM tagger.exe /T /F *>\$null; Write-Host 'Application arretee'"

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
    # Le --define de la licence vit dans le script npm : c'est la zone Angular qui
    # sait comment on la build. `set dotenv-load` exporte la variable, npm en herite.
    pnpm build

# Produire l'installeur Windows
[group('quality')]
build: build-sidecar
    # Ordre impose : sans le binaire du sidecar, tauri build echoue sur externalBin
    pnpm exec tauri build

# Lint de la webview
[group('quality')]
lint-ui:
    pnpm exec ng lint --max-warnings 0
    pnpm exec prettier --check .

# Lint du sidecar
[group('quality')]
lint-sidecar:
    cd sidecar && uv run ruff check .
    cd sidecar && uv run ruff format --check .

# Lint de la coquille Tauri
[group('quality')]
lint-tauri:
    cd src-tauri && cargo clippy -- -D warnings
    cd src-tauri && cargo fmt --check

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
    cd sidecar && uv run mypy src tests

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

# Verifier que l'environnement local est pret. Le hook SessionStart s'en sert
# comme source de verite : sortie vide = rien a signaler, donc aucune ligne hors
# avertissement.
[group('setup')]
check:
    @node --version > /dev/null 2>&1 || echo "⚠️ Node requis (voir engines de package.json)"
    @pnpm --version > /dev/null 2>&1 || echo "⚠️ pnpm requis (version dans le workflow CI)"
    @uv --version > /dev/null 2>&1 || echo "⚠️ uv requis (version dans le workflow CI)"
    @rustc --version > /dev/null 2>&1 || echo "⚠️ Rust requis (version dans rust-toolchain.toml)"
    @test -d node_modules || echo "⚠️ Dependances webview absentes, lancer just install-ui"
    @test -d sidecar/.venv || echo "⚠️ Environnement du sidecar absent, lancer just install-sidecar"
    @test -f src-tauri/binaries/tagger-x86_64-pc-windows-msvc.exe || echo "⚠️ Binaire du sidecar absent, lancer just build-sidecar (sans lui toute commande Tauri echoue)"
    @test ! -f sidecar/src/tagger/_build_info.py || echo "⚠️ _build_info.py present : build interrompu, le DSN de production est reste dans les sources. Le supprimer, sinon les runs de dev remontent vers Sentry en production"
