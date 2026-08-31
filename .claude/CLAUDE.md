# techno-tagger

Application desktop Windows mono-utilisateur qui extrait les morceaux d'une playlist d'une bibliothèque musicale, puis remplace leurs métadonnées par des données propres issues de Beatport et Bandcamp. Aucun serveur, aucun port ouvert, aucun compte.

## Stack

Métier : Python 3.14 (sidecar autonome empaqueté par PyInstaller, protocole NDJSON sur stdin/stdout), pydantic 2.13, mutagen 1.48, rapidfuzz 3.14, httpx2 2.12, keyring 25.7 | Interface : Angular 22 + PrimeNG 22 (preset Aura, dark permanent) + Tailwind 4 + ngx-translate 18 | Coquille : Tauri v2 (Rust 1.98) | Gestionnaires : pnpm 11.24 (`src/`), uv 0.12.7 (`sidecar/`), cargo (`src-tauri/`)

## Documentation

| Doc | Rôle | Lire pour... |
|-----|------|-------------|
| [BRAINSTORM.md](../docs/BRAINSTORM.md) | Vision, features | Comprendre le projet et son périmètre |
| [ARCHITECTURE.md](../docs/ARCHITECTURE.md) | Architecture, contrat NDJSON, ADRs | Décisions techniques, structure, ordre de développement |
| [VERSIONS.md](../docs/VERSIONS.md) | Versions exactes, compatibilité croisée | Dépendances, pièges de packaging |
| [DESIGN.md](../docs/DESIGN.md) | Design system, mapping composants | Conventions UI |
| [PRODUCTION.md](../docs/PRODUCTION.md) | Release, distribution, observabilité | Publier, déboguer, gérer un incident |
| [adrs/](../docs/adrs/) | 22 Architecture Decision Records | Justification des décisions actées |
| [knowledges/](../docs/knowledges/) | Fiches techniques par techno | Références détaillées par librairie |
| [.claude/rules/](rules/) | Règles impératives par librairie | Conventions de code chargées dynamiquement |

## Must-do

### Standards

- **Tout le métier vit dans le sidecar Python** : scoring, seuils, classement des candidats, lecture et écriture des tags, plan de run. L'interface affiche ce qu'elle reçoit et émet des commandes, `src-tauri/src/` se limite à l'initialisation des plugins. Une règle métier écrite en TypeScript ou en Rust est au mauvais endroit, quelle que soit sa taille.
- **Aucune ligne de scraping dans ce dépôt** : techno-scraper est la seule source de données, via son API et le header `X-API-Key`. Le dépôt est public, et c'est ce qui rend la distribution anonyme possible.
- **Aucun fichier musical n'est modifié avant la confirmation globale du run**, et les tags d'origine sont sauvegardés avant toute réécriture. Le coût d'une erreur ici est la bibliothèque de l'utilisateur, pas un test rouge.
- **Rien de personnel ne quitte la machine** : SDK Sentry durci, aucun événement métier envoyé, et aucun titre de morceau ne part sans un geste manuel explicite. Les rapports et les logs restent en local.
- **Une valeur, une source** : version, nom d'application, identifiant de bundle, nom du binaire du sidecar vivent à un seul endroit et sont dérivés partout ailleurs (`extra-files` de release-please, `define` esbuild, lecture du manifeste). Quand la dérivation est impossible — un JSON n'interpole rien, un `.spec` PyInstaller n'importe rien — la copie est **gardée par un test de cohérence**, jamais laissée à la vigilance : ces divergences-là sont muettes et ne se voient qu'à l'exécution du bundle.
- **No-lib-test** : un test doit échouer contre une régression de notre code, jamais contre une mise à jour de dépendance. On ne teste ni que mutagen sait écrire un `TPE1`, ni qu'un `@if` masque un div, mais que **notre** table de correspondance envoie le bon champ au bon tag.
- **Diagnostic SessionStart (hook `env-check`)** : respecter les instructions injectées via `additionalContext`, énumérer les blocages à l'utilisateur et proposer le correctif (`just install`, `just build-sidecar`, `cp .env.example .env`) avant toute tâche qui construit, lance ou empaquette le projet.
- **Suivre l'ordre de développement** des 9 étapes d'[ARCHITECTURE.md](../docs/ARCHITECTURE.md#ordre-de-développement) : le métier avant l'interface, et le contrat NDJSON figé avant d'écrire du TypeScript contre lui.

> Les règles techniques (Angular, PrimeNG, Tauri, pydantic, keyring, PyInstaller, Ruff, Mypy…) sont dans [.claude/rules/](rules/) et chargées dynamiquement selon les fichiers touchés.

### Workflow Git

Branches : `feature/*` → `develop` → `main` → tag `vX.Y.Z` (créé par release-please uniquement) | `hotfix/*` → `main`
Commits : `type(scope): description`, types `feat | feat! | fix | docs | refactor | test | chore`, scopes `sidecar | ui | tauri` ou plus fin (`matching`, `playlists`, `files`, `plan`, `cache`, `settings`)

**Le titre d'une PR `develop → main` doit être `feat:`, `fix:` ou `feat!:`** : le squash-merge en fait le message lu par release-please. Un titre hors convention ne produit ni tag ni build, donc aucune mise à jour distribuée, et rien ne le signale.
**Merger cette PR avec un corps explicite** : `gh pr merge <n> --squash --body "<une ligne>"`. Le corps auto-généré re-liste des `BREAKING CHANGE:` déjà publiés et fait bumper en MAJOR à tort.

> Politique de tag, checklist release, flux hotfix : [PRODUCTION.md](../docs/PRODUCTION.md)

## Gotchas

- **Le mode développement ne prouve rien sur trois pièges** qui n'existent qu'en distribution : sidecar non remplacé à la mise à jour, backend keyring introuvable dans le binaire figé, sortie NDJSON bufferisée. Les valider demande un run sur le bundle, pas un `tauri dev`.
- **Toute commande Tauri exige le binaire du sidecar** dans `src-tauri/binaries/` : Tauri valide `externalBin` dès la compilation, donc `cargo check` lui-même échoue sans lui. `just build-sidecar` d'abord.

## Commandes

| Commande / Skill | Rôle |
|---|---|
| `dev-server` | Lance l'app, la webview seule ou le sidecar en CLI (`just dev` / `dev-ui` / `dev-sidecar` / `stop`) |
| `quality-check` | Lint, typage, tests sur les trois zones (`just lint` / `typecheck` / `test`) |
| `setup-ops` | Installation et diagnostic (`just check` / `install` / `setup` / `build-sidecar`) |
| `git-ops` | Branches, commits Conventional, PR, versionnement. Invocation explicite uniquement |

> Recettes complètes : `just --list` ou voir le [Justfile](../Justfile).
