set minimum-version := "1.58.0"
set dotenv-load
set default-list
# Sans lui, un commentaire en corps de recette part au shell et s'affiche : check ne serait plus muet
set ignore-comments
# bash sur tous les OS (Git Bash sous Windows) : set windows-shell est deprecie depuis just 1.56
set shell := ["bash", "-cu"]

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
[working-directory('sidecar')]
dev-sidecar:
    uv run python -m tagger

# Construire la bibliotheque de demonstration, hors du depot, pour piloter l'app a la main
[group('dev')]
[working-directory('sidecar')]
demo *args:
    uv run python demo.py {{ args }}

# Arreter le dev server Angular (port 4200, aligne sur devUrl de tauri.conf.json)
[group('dev')]
stop-ui:
    # `//` : depuis Git Bash, MSYS convertirait `/PID` en chemin Windows
    -netstat -ano | awk '/:4200 .*LISTENING/ {print $NF}' | sort -u | xargs -r -I{} taskkill //PID {} //T //F

# Arreter la fenetre Tauri et le sidecar qu'elle a spawn
[group('dev')]
stop-app:
    -taskkill //IM techno-tagger.exe //T //F
    -taskkill //IM tagger.exe //T //F

# Tout arreter
[group('dev')]
stop: stop-ui stop-app

# ── Quality ───────────────────────────────────────────────────────────────────

# Empaqueter le sidecar Python et l'installer dans src-tauri/binaries/
[group('quality')]
[working-directory('sidecar')]
build-sidecar:
    uv run --group build python build.py

# Compiler la webview Angular
[group('quality')]
build-ui:
    # Tout le detail du build vit dans les scripts npm : `pnpm build` seul doit
    # rendre un dist livrable. `set dotenv-load` exporte les variables, npm en herite.
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
[working-directory('sidecar')]
lint-sidecar:
    uv run ruff check .
    uv run ruff format --check .

# Lint de la coquille Tauri
[group('quality')]
[working-directory('src-tauri')]
lint-tauri:
    cargo clippy -- -D warnings
    cargo fmt --check

# Lint des workflows GitHub Actions
[group('quality')]
lint-workflows:
    actionlint

# Lint des trois zones et des workflows
[group('quality')]
[parallel]
lint: lint-ui lint-sidecar lint-tauri lint-workflows

# Reformater la webview
[group('quality')]
format-ui:
    pnpm exec prettier --write .

# Reformater le sidecar et appliquer les fixes ruff auto-corrigeables
[group('quality')]
[working-directory('sidecar')]
format-sidecar:
    uv run ruff format .
    uv run ruff check --fix .

# Reformater la coquille Tauri
[group('quality')]
[working-directory('src-tauri')]
format-tauri:
    cargo fmt

# Reformater les trois zones
[group('quality')]
[parallel]
format: format-ui format-sidecar format-tauri

# Vulnerabilites des dependances de la webview (meme seuil que la CI)
[group('quality')]
audit-ui:
    pnpm audit --audit-level=high

# Vulnerabilites des dependances du sidecar
[group('quality')]
[working-directory('sidecar')]
audit-sidecar:
    uv audit --frozen --preview-features audit-command

# Vulnerabilites des deux zones auditables sans outil a installer (cargo audit exige cargo install)
[group('quality')]
[parallel]
audit: audit-ui audit-sidecar

# Typage de la webview, application et tests
[group('quality')]
typecheck-ui:
    pnpm exec tsc --noEmit -p tsconfig.app.json
    # tsconfig.app.json exclut les .spec.ts, que Vitest transpile par esbuild sans
    # jamais appeler tsc : sans cette ligne, une erreur de type dans un test est
    # verte partout.
    pnpm exec tsc --noEmit -p tsconfig.spec.json

# Typage du sidecar
[group('quality')]
[working-directory('sidecar')]
typecheck-sidecar:
    uv run mypy src tests

# Typage des deux zones typees
[group('quality')]
[parallel]
typecheck: typecheck-ui typecheck-sidecar

# Tests du sidecar, seuil de couverture compris
[group('quality')]
[working-directory('sidecar')]
test-sidecar:
    # Seuil porte ici et non dans addopts : sur un run cible, la couverture
    # globale serait mecaniquement basse
    uv run pytest --cov-fail-under=80

# Tests de la webview, sans watch
[group('quality')]
test-ui:
    # `--watch=false` explicite : le builder met watch a true des que le terminal
    # est un TTY, et `just test` (parallel) resterait bloque.
    pnpm exec ng test --watch=false

# Tous les tests
[group('quality')]
[parallel]
test: test-sidecar test-ui

# ── Setup ─────────────────────────────────────────────────────────────────────

# Installer les dependances de la webview
[group('setup')]
install-ui:
    pnpm install

# Installer les dependances du sidecar, groupes dev et build compris
[group('setup')]
[working-directory('sidecar')]
install-sidecar:
    uv sync --all-groups

# Recuperer les crates de la coquille Tauri
[group('setup')]
[working-directory('src-tauri')]
install-tauri:
    cargo fetch

# Installer les dependances des trois zones
[group('setup')]
[parallel]
install: install-ui install-sidecar install-tauri

# Setup complet : dependances puis binaire du sidecar, requis par toute commande Tauri (ordre impose, sans [parallel])
[group('setup')]
setup: install build-sidecar

# Verifier que l'environnement local est pret : sortie vide = rien a signaler
[group('setup')]
check:
    @node --version > /dev/null 2>&1 || echo "⚠️ Node requis (voir engines de package.json)"
    @pnpm --version > /dev/null 2>&1 || echo "⚠️ pnpm requis (version dans le workflow CI)"
    @uv --version > /dev/null 2>&1 || echo "⚠️ uv requis (version dans le workflow CI)"
    @rustc --version > /dev/null 2>&1 || echo "⚠️ Rust requis (version dans rust-toolchain.toml)"
    @command -v actionlint > /dev/null 2>&1 || echo "⚠️ actionlint requis pour just lint-workflows (winget install rhysd.actionlint)"
    @test -d node_modules || echo "⚠️ Dependances webview absentes, lancer just install-ui"
    @test -d sidecar/.venv || echo "⚠️ Environnement du sidecar absent, lancer just install-sidecar"
    @test -f src-tauri/binaries/tagger-$(rustc --print host-tuple).exe || echo "⚠️ Binaire du sidecar absent, lancer just build-sidecar (sans lui toute commande Tauri echoue)"
    @test ! -f sidecar/src/tagger/_build_info.py || echo "⚠️ _build_info.py present : build interrompu, le DSN de production est reste dans les sources. Le supprimer, sinon les runs de dev remontent vers Sentry en production"
