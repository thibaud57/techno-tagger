---
title: "VERSIONS - Matrice de compatibilité (Fullstack)"
description: "Versions des dépendances du sidecar Python, de la webview Angular et de la coquille Tauri, compatibilité croisée, configuration et migration."
date: "2026-10-29"
keywords: ["versions", "dependencies", "compatibility", "setup", "migration", "fullstack", "tauri", "angular", "python"]
scope: ["docs", "config", "setup"]
technologies: ["Python", "Angular", "Tauri", "Rust"]
---

> **Périmètre : ce que le dépôt déclare.** Les versions installées sont lues dans les **lockfiles** (`sidecar/uv.lock`, `pnpm-lock.yaml`, `src-tauri/Cargo.lock`), jamais dans les plages des manifestes, et dans les fichiers qui épinglent des outils et des images : `rust-toolchain.toml`, `Justfile`, `.github/workflows/`, `.github/actions/`, `demo/Dockerfile`. Relevé le **2026-10-29**. Les dernières versions publiées de chaque entrée (npm, PyPI, crates.io, GitHub, Docker Hub, python.org via endoflife.date) ont été recontrôlées le 2026-10-27 ; les notes de version et les constats d'une fiche gardent la date de leur relevé, citée au point concerné. Les technos Post-MVP (PydanticAI, WebdriverIO + `tauri-driver`) sont hors périmètre : elles seront documentées le jour où elles entrent dans un fichier de dépendances.

> **La plateforme d'hébergement est hors périmètre.** Le VPS, Docker Engine et Dokploy, qui hébergent la démo web, ne sont déclarés par aucun fichier versionné : ils sont documentés dans [PRODUCTION.md § Plateforme d'hébergement](PRODUCTION.md#plateforme-dhébergement) (renvoi vers la doc privée d'exploitation), [§ Liste Environnements](PRODUCTION.md#liste-environnements) et [§ Mise en place de la démo](PRODUCTION.md#mise-en-place-de-la-démo).

> **Trois écosystèmes, trois gestionnaires de paquets.** `sidecar/` en uv, `src/` en pnpm, `src-tauri/` en cargo. Aucun workspace transverse (cf. [ARCHITECTURE.md § Package Manager](ARCHITECTURE.md#package-manager)). La section « Partagé / Infrastructure » couvre la coquille Tauri et la chaîne CI/CD, qui traversent les trois zones.

> **Politique de version du projet : la dernière stable, toujours.** Une version antérieure ne se retient que sur une incompatibilité dure, documentée dans [Conflits Potentiels](#conflits-potentiels), et qu'aucune ligne de configuration ne contourne. Une rupture qui se règle par une règle de lint, un réglage ou une tournure de code à éviter n'est pas une raison de rester en arrière : elle se mécanise et on avance. Deux entrées s'écartent par choix de la dernière version publiée au relevé, et chacune s'en explique dans sa fiche : **TypeScript**, bloqué en 6.0.x par une incompatibilité qu'aucun réglage ne lève ; et **Python**, tenu en 3.14.x malgré la 3.15 (décision du projet, `requires-python >=3.14,<3.15`). Node suit la ligne LTS depuis le passage de la 26 en LTS (relevé le 2026-10-29).

---

# Vue d'ensemble

## Backend

Zone `sidecar/`, gestionnaire **uv**, fichier `sidecar/pyproject.toml` + `sidecar/uv.lock`.

| Technologie | Version Recommandée | Statut Production | Notes Critiques |
|-------------|-------------------|-----------------|----------------|
| Python | `3.14.10` | ✅ | Publiée le 2026-10-25, épinglée par `sidecar/.python-version`. Déclarée par toutes les dépendances, wheels `cp314` Windows pour rapidfuzz, supportée par PyInstaller depuis 6.15.0. Support jusqu'en 2030-10 |
| uv | `0.13.6` | ✅ | Format `uv.lock` couvert par la politique de versionnement, ne casse qu'en bump mineur. Minor figé par `required-version` de `sidecar/pyproject.toml`, que `setup-uv` lit en CI (patch flottant dans le minor, `0.13.6` au relevé) |
| Pydantic | `2.14.1` | ✅ | Porte les modèles du protocole NDJSON. `pydantic-core` (`2.50.1`) est une extension native : wheels `cp314` Windows publiées, hook livré par `pyinstaller-hooks-contrib` |
| mutagen | `1.48.1` | ⚠️ | Projet peu actif (2 ans 9 mois entre 1.47.0 et 1.48.0). Piège `EasyID3` + `v2_version=3` sur TDRC/TYER |
| RapidFuzz | `3.14.6` | ⚠️ | MIT, wheels Windows précompilées. **Aucun hook PyInstaller ne le couvre**, ni le paquet ni `pyinstaller-hooks-contrib`. La 3.14.6 abandonne Python 3.10, sans effet sur la cible `cp314` |
| httpx2 | `2.16.0` | ⚠️ | Fork de `httpx` par Pydantic Services. Import `httpx2`, pas `httpx`. **Aucun mock (`respx`, `pytest-httpx`) ne le supporte encore** |
| keyring | `25.7.0` | ⚠️ | Backends chargés par entry points : casse sous PyInstaller sans forçage explicite du backend |
| sentry-sdk | `2.73.0` | ✅ | Intégrations chargées par `importlib` : le hook `pyinstaller-hooks-contrib` est indispensable |
| PyInstaller | `6.22.3` | ✅ | Supporte Python 3.8 à 3.15. Ne cross-compile pas, runner Windows obligatoire |
| pyinstaller-hooks-contrib | `2026.9` | ✅ | Hooks `sentry_sdk`, `pydantic` et `keyring` : sans eux les intégrations chargées par `importlib` manquent du binaire |
| pytest | `9.2.0` | ✅ | `PytestRemovedIn9Warning` n'existe plus depuis la 9.1.1, seul `PytestRemovedIn10Warning` reste (`_pytest/warning_types.py`, relevé le 2026-10-28). La 9.2.0 applique `filterwarnings = error` dès `pytest_configure` : `asyncio_default_fixture_loop_scope` est posé explicitement dans `pyproject.toml` (relevé le 2026-10-29) |
| pytest-asyncio | `1.4.1` | ✅ | Fixture `event_loop` supprimée en 1.0, `event_loop_policy` dépréciée en 1.4 |
| pytest-cov | `7.1.0` | ✅ | Corrige un calcul de total qui faussait `--cov-fail-under` |
| Ruff | `0.17.3` | ⚠️ | La 0.16.0 fait passer le jeu par défaut de 59 à 413 règles. Une config copiée d'un projet antérieur produira un diff massif |
| Mypy | `2.4.1` | ✅ | Toutes les dépendances du projet livrent un `py.typed`, aucun paquet `types-*` requis. Parser natif par défaut depuis la 2.4 |

## Frontend

Zone `src/`, gestionnaire **pnpm**, fichier `package.json` + `pnpm-lock.yaml`.

| Technologie | Version Recommandée | Statut Production | Notes Critiques |
|-------------|-------------------|-----------------|----------------|
| Angular | `22.2.3` | ✅ | OnPush par défaut, `fetch` remplace XHR, `provideRoutes()` supprimé. `@angular/cli` et `@angular/build` suivent leur propre cadence de patch, en `22.2.5` au relevé du 2026-10-29 |
| TypeScript | `6.0.3` | ✅ | Contrainte dure d'Angular 22 : `>=6.0.0 <6.1.0`. **TS 7 (tsgo) casse `compiler-cli` et `typescript-eslint`**. `noUncheckedIndexedAccess` activé le 2026-09-06 : zéro erreur sur la base existante |
| Node.js | `26.x` (Active LTS depuis le 2026-10-28) | ✅ | Bascule faite le 2026-10-29, une ligne dans `.github/actions/setup-pnpm`. Installée par `pnpm/setup`, pas par `actions/setup-node` |
| pnpm | `12.15.0` | ✅ | Réécriture Rust, sous le dist-tag `latest` depuis le 2026-10-21. Épinglé par `devEngines.packageManager` (`onFail: download`), que `pnpm/setup` lit en CI. Lockfile à deux documents depuis le 2026-10-15, cf. § Dependabot |
| PrimeNG | `22.1.4` | ❌ | Licence PrimeUI avec clé obligatoire même en Community. Le dépôt public ne porte plus que la lignée MIT 21.x, le code 22.x vit dans un dépôt privé. Voir [Conflits Potentiels](#conflits-potentiels) |
| @primeuix/themes | `3.1.0` | ⚠️ | **Pas une dépendance transitive de PrimeNG**, à déclarer explicitement. Base rem passée de 14px à 16px |
| PrimeIcons | `@primeicons/angular 8.0.2` | ❌ | Dépendance directe de PrimeNG 22, **à déclarer quand même** : pnpm isole, une transitive n'est pas importable depuis `src/`. Le paquet CSS `primeicons` s'arrête à 7.0.0 pour le MIT, la 8.0.0 est sous licence PrimeUI |
| Angular CDK | `@angular/cdk 22.2.4` | ✅ | **peerDependency de PrimeNG 22**, donc jamais installée seule : son absence ne se voit qu'au premier composant qui en dépend. Déclare `@angular/forms` en peerDependency depuis la 22.1.5 |
| Tailwind CSS | `4.3.3` | ✅ | Config CSS-first, `tailwind.config.js` disparu, ne compile ni SCSS ni LESS |
| @tailwindcss/postcss | `4.3.3` | ✅ | Version alignée sur `tailwindcss` (même monorepo) |
| tailwindcss-primeui | `0.6.1` | ⚠️ | Aucune publication depuis mars 2025, donc antérieure à PrimeNG 22 et à Tailwind 4.3 |
| @fontsource-variable/inter | `5.3.0` | ✅ | SIL OFL, aucun CDN, importer `wght.css` |
| @ngx-translate/core | `18.1.0` | ✅ | 18.1.0 publiée le 2026-10-27 : additive, aucune rupture dans les notes de version, adoptée le 2026-10-29. `TranslateModule` supprimé, `defaultLang` renommé `fallbackLang`, `currentLang` devient un Signal |
| @ngx-translate/http-loader | `18.1.0` | ✅ | `provideTranslateHttpLoader({ prefix, suffix })` remplace le pattern `useFactory` |
| @tauri-apps/api | `2.12.4` | ✅ | Même mineure que la crate `tauri` : `tauri build` et `test_main.py` contrôlent l'accord des paquets npm et des crates |
| @sentry/angular | `11.9.0` | ⚠️ | `dataCollection` absent collecte tout, IP comprise : chaque catégorie est fermée explicitement. `peerDependency` : `@angular/core >= 14.x <= 22.x` |
| @sentry/cli | `3.8.2` | ✅ | Script `sourcemaps` de `package.json` : upload des source maps `hidden` puis suppression de `dist/` |
| rxjs | `7.8.2` | ✅ | Réservé aux flux dans le temps (événements NDJSON, navigation), exposés aux composants en signals par `toSignal()` |
| tslib | `2.8.1` | ✅ | Dépendance d'exécution requise par Angular (peer `^2.3.0` d'`@angular/build`), `^2.8.1` dans `package.json`, version lue dans `pnpm-lock.yaml` (relevé le 2026-10-29) |
| jsdom | `30.1.3` | ✅ | Environnement par défaut de Vitest sous `@angular/build:unit-test`. Plancher Node `^24.15.0 || >=26.0.0` depuis la 30.0.0, couvre l'`engines` du projet (`^26.0.0`) |
| Vitest | `5.0.5` | ✅ | Runner par défaut du CLI Angular 22, accepté en 5.x par `@angular/build` depuis 22.2.0. `clearMocks` à `true` par défaut |
| angular-eslint | `22.6.0` | ✅ | ESLint 9+ en flat config uniquement, `.eslintrc` supprimé |
| @eslint/js | `10.0.1` | ✅ | Preset `recommended` importé par `eslint.config.js`, peer `eslint ^10.0.0` (lue dans `pnpm-lock.yaml`, relevé le 2026-10-29), ajouté par `ng add angular-eslint`. `^10.0.1` dans `package.json` |
| Prettier | `3.9.10` | ✅ | Parser Angular embarqué dans Prettier : `@angular/compiler` 22.0.6 (lu dans `node_modules/prettier/plugins/angular.js`, relevé le 2026-10-29), contre 22.2.3 installé pour le build. `semi: false` depuis le 2026-09-06, aligné sur le portfolio |
| prettier-plugin-tailwindcss | `0.8.1` | ✅ | Exige Prettier ≥ 3.7.x et l'option `tailwindStylesheet` en Tailwind v4 |

## Partagé / Infrastructure

Zone `src-tauri/` (cargo) et `.github/` (CI/CD).

| Technologie | Version Recommandée | Statut Production | Notes Critiques |
|-------------|-------------------|-----------------|----------------|
| tauri (crate) | `2.12.5` | ✅ | MSRV 1.90 depuis la 2.12, comme toutes les crates Tauri. Même mineure que `@tauri-apps/api` |
| tauri-build (crate) | `2.7.4` | ✅ | MSRV 1.90, reporté dans le `rust-version` de `src-tauri/Cargo.toml` |
| @tauri-apps/cli | `2.12.4` | ✅ | Refuse au build un paquet npm et une crate de mineures différentes, même garde en CI que pour `@tauri-apps/api` |
| Plugins Tauri v2 | voir [§ Plugins](#2-plugins-officiels-tauri-v2) | ✅ | Versions crate et npm strictement alignées plugin par plugin, gardées en CI par `test_the_tauri_crates_and_their_npm_packages_are_aligned` (`sidecar/tests/unit/test_main.py`) |
| Rust | `1.99.1` (stable) | ✅ | Édition 2024. Les images Windows Server 2025 du 2026-10-21 (`win25/20261021.299`, `win25-vs2026/20261021.278`) livrent la 1.99.1, la 1.99.0 auparavant ; `rustup` installe de toute façon la 1.99.1 épinglée. La 1.98.0 contenait une miscompilation corrigée en 1.98.1, la 1.99.0 une autre (booléens FFI renvoyés sur x86_64) corrigée en 1.99.1 |
| just | `1.58.0` (plancher) | ✅ | Plancher `set minimum-version := "1.58.0"` du `Justfile`, lu par `extractions/setup-just` en CI : la CI installe donc ce plancher, non monté ici. Le poste est en 1.59.0 (`just --version`, relevé le 2026-10-29) |
| GitHub Actions | voir [§ CI/CD](#4-github-actions) | ✅ | Images figées `windows-2025` (Visual Studio 2026) et `ubuntu-24.04`, jamais de label `-latest` |
| release-please-action | `5.0.0` | ⚠️ | Le tag créé avec `GITHUB_TOKEN` ne déclenche aucun workflow. Chaînage `needs:` obligatoire |
| Dependabot | app GitHub intégrée, version non épinglée par le dépôt | ✅ | Écosystèmes `npm`, `uv`, `cargo`, `github-actions` et `docker` (`/demo`) couverts par un seul `dependabot.yml`. PR de mise à jour fonctionnelles ; alertes de sécurité npm non fiables sur le lockfile à deux documents, `just audit-ui` en CI prend le relais (cf. [§ Dependabot](#6-dependabot)) |
| pnpm/setup (action) | `3.1.2` | ✅ | Installe pnpm **et** Node en une étape. Exige pnpm 11+. La v3 détecte un fichier de version Node, sans effet ici : `runtime: node@26` est posé explicitement dans `.github/actions/setup-pnpm` |
| nginx/nginx-unprivileged (image) | `1.31.8-alpine` | ✅ | Image de service de la démo web (`demo/Dockerfile`), non-root (UID 101), écoute sur 8080. `nginxinc/nginx-unprivileged`, l'ancien nom, n'est plus maintenu (cf. [§ Images Docker de la démo](#7-images-docker-de-la-démo)) |
| node (image) | `26.13.0-slim` | ✅ | Étape de build de l'image de la démo. Debian, pour le `bash` qu'exige `scriptShell: bash`. Majeure gardée égale à `engines.node` et à `setup-pnpm` par `test_demo_image_coherence.py` |

---

# Détails par Technologie

## Backend

### 1. Python
**Version actuelle** : `3.14.10` (2026-10-25, endoflife.date, relevé le 2026-10-27), installée via uv 0.13.6
**Stabilité** : ✅

**Breaking Changes Majeurs** (et ce qu'ils coûtent réellement à un sidecar écrit de zéro) :

| Changement 3.14 | Impact réel ici | Parade |
|---|---|---|
| `asyncio.get_event_loop()` lève `RuntimeError` hors loop au lieu d'en créer une | **Nul.** Ne casse que le code antérieur à `asyncio.run()`, qui comptait sur la création implicite | `asyncio.run(main())` en point d'entrée, `asyncio.get_running_loop()` si une référence est nécessaire. Interdiction mécanisée par le lint, voir ci-dessous |
| `sqlite3.version` et `sqlite3.version_info` supprimés | **Nul.** C'est la version du module Python, figée à `"2.6.0"` depuis des années, pas celle du moteur. `sqlite3.connect()` n'est pas concerné | Utiliser `sqlite3.sqlite_version` pour journaliser la version du moteur, utile au diagnostic d'un dump VLC (cf. [ADR-019](adrs/019-resilience-schema-vlc-media-db.md)) |
| Placeholders nommés avec une séquence de paramètres : `ProgrammingError` au lieu d'un `DeprecationWarning` | **Nul** si les deux styles ne sont pas mélangés | `?` avec un tuple, ou `:nom` avec un dict. Jamais l'un avec l'autre. Couvert par les tests de parsing VLC |
| Policy asyncio (`AbstractEventLoopPolicy`, `get/set_event_loop_policy`) dépréciée, suppression en 3.16 | **Nul.** Aucun usage prévu | `asyncio.Runner(loop_factory=...)` si le besoin apparaît |
| Windows 10 devient la version minimale | **Nul.** La cible est Windows 10/11 | — |

**Nouvelles Features Pertinentes** :
- `httpx2` gagne la décompression **zstd native sur 3.14+**, là où les versions antérieures passent par `backports.zstd`. Un gain gratuit sur les réponses de techno-scraper

**Compatibilité Écosystème** : toutes les dépendances déclarent 3.14, aucune n'est en retard.

| Dépendance | Déclaration | Vérification |
|---|---|---|
| PyInstaller 6.22.3 | `>=3.8,<3.16` | Support de 3.14 depuis 6.15.0 (2025-08-03), **un an de recul** |
| rapidfuzz 3.14.6 | classifiers 3.11 à 3.14 | **Wheels `cp314` publiées pour `win_amd64`**, une des deux dépendances à extension native |
| pydantic 2.14.1 | `>=3.10` | Compatibilité 3.14 annoncée en 2.12, **wheels `cp314` et `cp314t` de `pydantic-core` 2.50.1 pour `win_amd64`** |
| httpx2 2.16.0 | classifiers 3.11 à 3.15 | Explicite, `requires-python >=3.11` depuis la 2.16.0 |
| sentry-sdk 2.73.0 | classifiers jusqu'à 3.15 | Explicite |
| mypy 2.4.1 | classifiers jusqu'à 3.15 | Wheels `cp314` |
| pytest 9.2.0 | `>=3.10` | Support de 3.14 depuis pytest 8.4.0 |
| Ruff 0.17.3 | dérivé de `requires-python` du projet | Pas de `target-version` posé : Ruff le lit dans `pyproject.toml` |
| keyring 25.7.0 | `>=3.9` | `pywin32-ctypes` est pur Python, rien à compiler |
| mutagen 1.48.1 | `>=3.10,<4` | Classifiers non détaillés par version mineure, mais pur Python sans dépendance : risque structurellement nul |
| uv 0.13.0 | — | Livre le build 3.14.8 depuis 0.12.22 (2026-10-01), pas le 3.14.10 (ajouté en 0.13.5). Python 3.15 devient son défaut sans pin : neutralisé par `sidecar/.python-version` et `requires-python` |

**Recommandation** : ✅ **3.14.10**. Le seul critère qui aurait pu bloquer, le support PyInstaller, est acquis depuis un an, et les deux extensions natives de la stack, rapidfuzz et `pydantic-core`, publient leurs wheels `cp314` Windows. Les cinq breaking changes de 3.14 ne touchent que des tournures qu'un sidecar neuf n'écrit pas. Le gain n'est pas cosmétique : le support court jusqu'en **2030-10** au lieu de 2029-10, ce qui repousse d'un an la procédure lourde de bump du runtime (rebuild PyInstaller plus retest des faux positifs antivirus, cf. [PRODUCTION.md § Composants applicatifs](PRODUCTION.md#composants-applicatifs)).

**Les deux règles de codage se mécanisent plutôt qu'elles ne se surveillent.** Bannir `asyncio.get_event_loop()` et `sqlite3.version` dans `[tool.ruff.lint.flake8-tidy-imports.banned-api]` transforme la vigilance en gate CI : le lint échoue si l'un des deux réapparaît, y compris dans du code copié depuis la CLI d'origine. `TID251` attrape l'accès qualifié (sonde `ruff check` du 2026-10-23 : `asyncio.get_event_loop()` et `sqlite3.version` signalés), aucun `grep` de CI n'est nécessaire.

### 2. uv
**Version actuelle** : `0.13.6` (2026-10-27), dernière 0.13.x ; la 0.13.0 date du 2026-10-09. Le dépôt ne fige que le minor, le patch flotte
**Stabilité** : ✅

**Breaking Changes Majeurs** :
- **0.12.0** : `uv init` pose désormais un `build-system` par défaut (`uv_build`) et un layout `src/`
- **0.12.0** : le mode de résolution par défaut passe à `if-necessary`, les versions stables sont préférées avant tout repli sur une pré-release
- **0.12.0** : rejet des archives sdist hors `.tar.gz`, rejet des hashs MD5 seuls, `--require-hashes` désormais respecté dans `requirements.txt`
- **0.12.0** : `uv run` découvre le projet relativement au script passé, plus au répertoire courant
- **0.12.0** : `--reinstall` préserve la version patch de Python installée au lieu de l'upgrader implicitement
- **0.12.9** : `--locked`, `--frozen`, `--check` et `--check-exists` priment sur `UV_LOCKED` et `UV_FROZEN` en cas de conflit
- **0.12.11** : les archives sources sont vérifiées contre les hashs de `uv.lock` avant tout build : un hash divergent fait échouer un build qui passait
- **0.12.16** : le backend `uv_build` embarqué ne sert que si sa version satisfait les pins actifs. Un uv épinglé plus ancien que le plancher de `[build-system]` retélécharge le backend depuis l'index à chaque build : c'est ce que produisait la plage `>=0.12.19` face à l'uv `0.12.16` de la CI, corrigé le 2026-10-09 en alignant les deux sur `0.12.24`
- **0.12.19 à 0.12.22** : `uv.lock` omet les réglages de résolution inutilisés et les tables `[manifest]` vides, et enregistre les default groups des membres du workspace. Un lock produit par une version antérieure est réécrit au premier `uv lock`
- **0.12.24** : les options mal formées d'un fichier `requirements` sont rejetées au lieu d'être ignorées, et les hashes fournis sont vérifiés même avec `--no-require-hashes`
- **0.13.0** : Python 3.15 devient la version stable par défaut quand rien n'est configuré. Sans effet ici : `sidecar/.python-version` pose `3.14.10` et `requires-python` borne à `<3.15`
- **0.13.0** : les tarballs passent par le backend `tar-codec`, plus strict (liens physiques et extensions non gérés rejetés), et les sdists produits par `uv_build` peuvent changer d'octets donc de hash. Sans effet constaté : `uv sync` construit `tagger` en editable, aucun sdist n'est figé dans `uv.lock`
- **0.13.0** : `--require-hashes` d'un fichier de contraintes `-c` est respecté, les contraintes éditables sont refusées, `uv build --clear` refuse un répertoire de sortie qui contient la source. Hors usage du projet
- **0.13.1 à 0.13.6** (2026-10-14 au 2026-10-27) : aucune rupture dans les notes de version (relevé le 2026-10-27). 0.13.5 et 0.13.6 ajoutent les builds CPython 3.14.9 et 3.14.10
- **0.13.0** : le plancher `uv_build` doit inclure 0.13 (`>=0.13.0,<0.14`), et `required-version = ">=0.13,<0.14"` sous `[tool.uv]` refuse un uv hors de la mineure

**Nouvelles Features Pertinentes** :
- **0.12.18** corrige GHSA-2cv4-cqwr-gwf7, un path traversal à l'installation d'une wheel sous Windows : raison suffisante, à elle seule, de ne pas rester en deçà
- Le build CPython 3.14.10 retenu par le projet est téléchargeable depuis la 0.13.5 ; le 3.14.8 l'était via `uv python install` depuis la 0.12.22
- **0.12.14** : installation des chemins plus longs que `MAX_PATH` sans activer les chemins longs de Windows
- `[dependency-groups]` (PEP 735) pour les dépendances de développement, préférable à `[project.optional-dependencies]` qui reste réservé aux extras publiés

**Compatibilité Écosystème** :
- Politique officielle : « the minor version number is bumped for breaking changes, and the patch version number is bumped for bug fixes ». Le format `uv.lock` fait partie de l'API publique et ne casse donc qu'en bump mineur
- Dependabot couvre `pyproject.toml` et `uv.lock` nativement via l'écosystème `uv`, en disponibilité générale depuis le 2025-03-13 (cf. [§ Dependabot](#6-dependabot))
- CI : `astral-sh/setup-uv@v10.3.3`. La doc CI d'Astral montre encore un exemple pinné sur v9.0.0, elle est en retard sur le dépôt
- **PyInstaller + interpréteur géré par uv** : ✅ **validé sur le binaire du bootstrap** : il démarre, sort en 0, écrit son log dans `%LOCALAPPDATA%`, et embarque `pydantic_core`, `rapidfuzz.fuzz`, `sentry_sdk.integrations.logging` et `win32ctypes.pywin32.win32cred`. Aucune source officielle ne documente ce couple. La doc `python-build-standalone` signale que les chemins absolus figés dans les métadonnées de build sont corrigés à l'installation par uv, donc le piège connu ne s'applique pas. **Confirmé par le build CI** : le sidecar de la 0.11.0, construit après `uv sync --locked`, est installé et fonctionnel ([PRODUCTION.md § Checklist Distribution](PRODUCTION.md#checklist-distribution), 2026-10-21)

**Recommandation** : ✅ `sidecar/pyproject.toml` est la seule source de la version d'uv : `required-version` fige le minor, le poste et la CI prennent n'importe quel patch de ce minor (`setup-uv` sans `version`, `version-file: sidecar/pyproject.toml` dans l'action composite). Au minor suivant, monter `required-version` et `uv_build` ensemble, `test_main.py` garde leur alignement. Même schéma que pnpm (`devEngines.packageManager`) et que les autres projets uv du poste (aligné le 2026-10-15).

### 3. Pydantic
**Version actuelle** : `2.14.1` (2026-10-11), `pydantic-core 2.50.1` (2026-10-11)
**Stabilité** : ✅

**Breaking Changes Majeurs** :
- **2.11** : Python 3.8 abandonné, validation du core schema désactivée par défaut, et un champ `Final` porteur d'une valeur par défaut émet un warning de dépréciation
- **2.12** (2025-10-07) : première compatibilité Python 3.14. La page PyPI est explicite : « Pydantic V1 is not compatible with Python 3.14 and greater ». La borne basse du projet est donc 2.12, pas 2.0
- **2.12** : l'accès à `model_fields` et `model_computed_fields` depuis une instance est déprécié, il passe par la classe
- **2.14** : Python 3.9 abandonné, support de 3.15, aucune dépréciation déclarée. Deux changements de comportement non classés breaking : `model_config` n'est plus muté après la définition de la classe (#13825), et `ser_json_timedelta` ne s'applique plus aux autres types date en sérialisation inférée (#13892). Validé le 2026-10-09 par la suite du sidecar sous `filterwarnings = error`
- **v1 → v2** : `@validator`, `class Config`, `.dict()` et `.json()` ont disparu au profit de `@field_validator`, `model_config = ConfigDict(...)`, `model_dump()` et `model_dump_json()`. Aucun exemple antérieur à 2023 trouvé en ligne n'est transposable tel quel

**Nouvelles Features Pertinentes** :
- `computed_field(exclude_if=...)` (2.13) : exclut un champ calculé de la sortie sans post-traitement du dict, utile aux rapports JSON
- Syntaxe PEP 695 pour les génériques (2.11), alignée sur le reste du code du sidecar
- `model_validate_json()` parse et valide en une passe, c'est exactement ce que consomme une ligne NDJSON reçue sur `stdin`

**Compatibilité Écosystème** :
- **`pydantic-core` publie des wheels `cp314` et `cp314t` pour `win_amd64`** : c'est la seconde extension native de la stack après rapidfuzz, et la seule autre à devoir être vérifiée au build PyInstaller
- `pyinstaller-hooks-contrib` livre un hook `pydantic`, mis à jour pour la v2 (PR #611) : même mécanique que sentry-sdk, validé sur le binaire figé de la 0.11.0 (run complet, 2026-10-21)
- Livre un `py.typed`, et distribue en plus un plugin Mypy (`plugins = ["pydantic.mypy"]`) : « Pydantic also ships with a mypy plugin that adds a number of important Pydantic-specific features that improve its ability to type-check your code ». Il génère la signature réelle d'`__init__` et vérifie les types de `default` et `default_factory`
- PydanticAI (Post-MVP, [ADR-008](adrs/008-matching-rapidfuzz-et-agent-ia.md)) repose sur la même définition de modèles : la dette est nulle le jour où le mode agent entre

**Recommandation** : ✅ **2.14.1**, borné `>=2.14.1,<3` (cf. [ADR-022](adrs/022-modeles-pydantic-du-protocole.md)). Le point à instruire n'est pas la bibliothèque, dont la v2 a trois ans de recul, mais son extension native dans le binaire figé, au même titre que rapidfuzz, avec le même geste de validation sur binaire gelé que keyring.

### 4. mutagen
**Version actuelle** : `1.48.1` (2026-06-25)
**Stabilité** : ⚠️

**Breaking Changes Majeurs** :
- **1.48.0** : Python 3.7, 3.8 et 3.9 abandonnés, plancher à 3.10
- **1.48.0** : nouvel attribut `salt` sur `APIC`, qui change la `HashKey` des frames en `APIC:<desc><salt>` pour autoriser plusieurs pochettes avec la même description. L'unicité ne se comporte donc plus comme avant
- **1.48.0** : l'ordre des frames `APIC` est préservé à la sauvegarde (le comportement précédent les réordonnait)
- **1.48.0** : lecture et écriture des champs comment et track ID3v1.0/1.1 modifiées
- **1.48.1** : annule une régression de 1.48.0 qui dupliquait les frames `COMM` écrites depuis `EasyID3`

**Nouvelles Features Pertinentes** :
- 1.47.0 : support du WAVE extensible et gestion des fichiers WAVE/AIFF tronqués

**Compatibilité Écosystème** :
- Pur Python, aucune dépendance hors bibliothèque standard : c'est précisément l'argument de l'[ADR-011](adrs/011-politique-ecriture-tags.md) contre pytaglib. Aucun hook PyInstaller dédié n'existe dans `pyinstaller-hooks-contrib`, et aucun n'est nécessaire
- Livre un `py.typed`, donc typé pour Mypy strict sans stub externe
- **WAV** : seul le chunk ID3v2 est supporté, le chunk RIFF/INFO ne l'est pas. Le chunk est écrit en minuscules (`id3 `) là où d'autres implémentations attendent `ID3 `. La lecture côté mutagen est insensible à la casse. Rekordbox, lui, ignore ce chunk quelle que soit sa casse et ne lit que le RIFF INFO (relevé le 2026-10-23, [knowledges/rekordbox.md](knowledges/rekordbox.md))
- **ID3v2.3** : `save(v2_version=3)` repasse les frames texte d'UTF-8 en UTF-16, mais ne convertit pas `TDRC` ni `TDOR` : sans `update_to_v23()` préalable ils restent sur le disque sous un en-tête v2.3 (constaté le 2026-10-06 sur 1.48.1). techno-tagger écrit une seule chaîne par champ, `v23_sep` ne lui sert donc pas, et n'écrit aucun `TDOR` : seul un `TDOR` déjà présent dans le fichier est converti en `TORY`

**Recommandation** : ⚠️ Retenu, sans alternative crédible. Deux points à couvrir par des tests, tous deux dans le périmètre déjà prévu par [ARCHITECTURE.md § Stratégie de Tests](ARCHITECTURE.md#stratégie-de-tests) :
1. `EasyID3` combiné à `v2_version=3` a produit historiquement une frame `TDRC` v2.4 vide en plus du `TYER` v2.3 attendu (issue #188, fermée sans détail de correctif vérifiable). Écrire l'assertion sur le contenu réel du fichier, pas sur le retour de l'API
2. La casse du chunk WAV (`id3 ` vs `ID3 `) ne règle rien côté Rekordbox, qui ignore ce chunk : le RIFF INFO, que mutagen n'écrit pas, est à la charge du projet (Post-MVP « Compatibilité des tags avec les logiciels DJ » du BRAINSTORM)

### 5. RapidFuzz
**Version actuelle** : `3.14.6` (2026-08-30)
**Stabilité** : ✅

**Breaking Changes Majeurs** :
- **3.0.0** : module `rapidfuzz.string_metric` supprimé, remplacé par `rapidfuzz.distance`
- **3.0.0** : `rapidfuzz.process` n'appelle plus les scorers avec `processor=None`, et les `**kwargs` vers le scorer sont supprimés
- **3.14.0** : Python 3.9 abandonné, wheels Linux 32 bits abandonnées, et correction de `WRatio` pour un ratio de longueur exactement égal à 8.0
- **3.14.6** : abandon de Python 3.10 et des wheels free-threaded 3.13. La wheel `cp314-cp314-win_amd64` reste publiée

**Nouvelles Features Pertinentes** :
- SIMD sur `ratio`, `QRatio`, `Levenshtein`, `Indel`, `LCSseq` et `OSA`, gain réel sur les chaînes courtes en `cdist`
- `score_cutoff` court-circuite le calcul quand le score ne peut pas atteindre le seuil : à passer directement le plancher du projet pour économiser sur les candidats hors-jeu

**Compatibilité Écosystème** :
- Licence MIT, ce qui règle le problème de `fuzzywuzzy` / `python-Levenshtein` sous GPL
- Wheels `win_amd64` publiées pour cp311 à cp314, aucune compilation locale requise
- **Aucun hook PyInstaller ne couvre rapidfuzz**, contrairement à ce que laisse croire son entry point `pyinstaller40` : celui-ci s'appelle `tests` et pointe `rapidfuzz.__pyinstaller:get_PyInstaller_tests`, qui fournit des tests à PyInstaller et non un hook. Vérifié dans le venv du projet en 3.14.5 : `rapidfuzz/__pyinstaller/` ne contient que `__init__.py` et `test_rapidfuzz_packaging.py`, et `pyinstaller-hooks-contrib` n'expose pas de `hook-rapidfuzz.py`. L'extension native est collectée par l'analyse d'imports statiques, mais les cibles SIMD (`avx2`/`sse2`, issue #391) se chargent dynamiquement : le `.spec` déclare donc `collect_submodules("rapidfuzz")`, et le scoring se teste sur le binaire figé
- Livre un `py.typed`

**Recommandation** : ✅ Sur le choix de scorer, `WRatio` reste le défaut tout-usage pour du matching artiste/titre, mais `token_set_ratio` tolère mieux les mots surnuméraires (`Live`, `Remastered`, `feat.`) qui sont le cas courant sur Beatport. Le calibrage relève de l'implémentation, pas de la compatibilité.

### 6. httpx2
**Version actuelle** : `2.16.0` (2026-10-21)
**Stabilité** : ⚠️

`httpx2` est bien réel : c'est le fork de `httpx` piloté par **Pydantic Services Inc.**, publié sur PyPI et documenté sur `httpx2.pydantic.dev`. L'[ADR-007](adrs/007-client-http-httpx2.md) tient. Le contexte qui le motive est confirmé : `httpx` d'origine n'a plus publié depuis `0.28.1` (2024-12-06), et son mainteneur a fermé issues et discussions le 2026-02-27.

**Breaking Changes Majeurs** (par rapport à `httpx`) :
- **Import renommé** : `import httpx2`, pas `import httpx`. Ce n'est pas un drop-in silencieux, malgré une API identique
- **Transport** : dépend de `httpcore2`, pas de `httpcore`
- **Vérification SSL** : `truststore` (trust store natif de l'OS) par défaut au lieu de `certifi`, qui reste disponible en configuration explicite
- **Python >=3.10** requis, là où `httpx` acceptait 3.8+

**Nouvelles Features Pertinentes** :
- Décompression zstd native sur Python 3.14+, donc acquise avec l'interpréteur retenu

**Compatibilité Écosystème** :
- `httpx2.Limits(max_connections=...)` et `httpx2.Timeout(..., connect=...)` ont exactement la signature de `httpx` : le pool borné à 3/2 et le timeout client de l'[ADR-017](adrs/017-taille-pool-concurrence.md), fixé **au-dessus** du budget de 90 secondes de l'API pour recevoir son `504` structuré plutôt qu'un timeout local aveugle, se transposent sans changement de conception. Deux sources aux sémaphores distincts imposent **deux instances de client**, chacune avec ses propres `Limits`
- Livre un `py.typed`
- **PyInstaller** : le passage à `truststore` supprime le besoin de bundler `certifi/cacert.pem` mais introduit des appels `ctypes` vers l'API Windows dans un binaire figé. Validé : le run complet de l'installeur de la 0.11.0 interroge l'API en TLS (2026-10-21)
- **Mocking** : voir [Conflits Potentiels](#conflits-potentiels), c'est le vrai point dur

**Recommandation** : ⚠️ Choix maintenu. Stratégie de test tranchée : `MockTransport` natif, fixtures dans `sidecar/tests/conftest.py` et `sidecar/tests/helpers/scraper_responses.py`.

### 7. keyring
**Version actuelle** : `25.7.0` (2025-11-16)
**Stabilité** : ⚠️

**Breaking Changes Majeurs** :
- **12.0.0** : les backends ne sont plus listés en dur, ils sont découverts exclusivement par entry points. C'est la cause racine de tous les problèmes d'empaquetage
- **22.4.0** : bascule vers `importlib_metadata` pour cette découverte
- **25.3.0** : dépréciation des `username` vides
- **25.7.0** : retrait du code de compatibilité Python 3.8

**Compatibilité Écosystème** :
- `WinVaultKeyring` reste le backend Windows par défaut, avec `priority=5`, depuis la 8.0 (2016)
- La dépendance déclarée est **`pywin32-ctypes>=0.2.0`**, pas `pywin32`. C'est une réimplémentation pure Python via `ctypes`, sans extension compilée, ce qui est un avantage net pour PyInstaller
- Livre un `py.typed`
- **Limite du Credential Manager** : `CRED_MAX_CREDENTIAL_BLOB_SIZE` vaut 2560 octets (5 × 512). Un `X-API-Key` généré par `secrets.token_urlsafe(32)` en est très loin. Dépasser la limite produit une erreur cryptique `CredWrite ... (1783, "The stub received bad data")`

**Recommandation** : ⚠️ Le risque n'est pas la version mais l'empaquetage : voir [Conflits Potentiels](#conflits-potentiels). Le test de sécurité déjà prévu (« la clé API n'apparaît ni dans les logs, ni dans les rapports, ni dans les payloads Sentry ») doit être doublé d'un **test de fumée sur le binaire figé**, pas seulement sur les sources. Fait le 2026-10-21 (clé relue après relance de l'application installée).

### 8. sentry-sdk
**Version actuelle** : `2.73.0` (2026-10-22)
**Stabilité** : ✅

**Breaking Changes Majeurs** :
- **2.68.0** : `enable_logs` et `enable_metrics` deviennent des no-op, suppression à la prochaine majeure
- **2.70.0** : `data_collection` promue en option de premier niveau, successeur annoncé de `send_default_pii`. Dès qu'elle est posée, `include_local_variables` et `include_source_context` ne sont plus lus et une catégorie omise est collectée (lu dans `data_collection.py` et `utils.py` de 2.71.0 le 2026-10-15). Une catégorie `mcp` est en préparation (getsentry/sentry-python#7750, ouverte au 2026-10-15)
- **2.70.0** : `data_collection` posée, le SDK n'installe plus son `EventScrubber` par défaut (`client.py`, `_get_options`, lu en 2.71.0 le 2026-10-16) : le denylist (`api_key`, `secret`, `token`, `password`...) ne s'applique plus aux champs libres. Aucune donnée sensible dans `set_extra`, `set_context` ni `set_tag` et pas de rappel manuel de `EventScrubber` dans `_scrub`
- **2.71.0** : les notes annoncent « Keep event if processor raises », mais `before_send` se comporte comme en 2.70.0 : s'il lève, l'événement est jeté (lu dans `_Client._prepare_event` des deux versions le 2026-10-02). Le `_scrub` du sidecar reste un filet fermé
- **Ce qui invalide les exemples en 1.x** : `with_locals` s'appelle désormais `include_local_variables`, et l'API Hub a cédé la place aux scopes. Pas de ligne 3.x à ce jour

**Compatibilité Écosystème** :
- Classifiers explicites pour Python 3.13 et 3.14
- `AsyncioIntegration` **n'est pas** dans les intégrations par défaut, elle s'ajoute à la main
- Livre un `py.typed`

**Les réglages de durcissement d'[ARCHITECTURE.md § Monitoring](ARCHITECTURE.md#monitoring), vérifiés dans le code source du SDK** :

| Réglage | Défaut réel | Vérification |
|---|---|---|
| `data_collection` | `None` ; posée, toute catégorie omise vaut collecte, `stack_frame_variables` compris | `_resolve_explicit` : `d.get("stack_frame_variables", True)` |
| `server_name` | `None`, **mais** repli automatique sur le hostname | `client.py` : `if rv["server_name"] is None and hasattr(socket, "gethostname"): rv["server_name"] = socket.gethostname()` |
| `send_default_pii` | `None`, traité comme `False` | Ne pas activer |

- **`LoggingIntegration`** est active par défaut, avec `level=logging.INFO` pour les breadcrumbs et `event_level=logging.ERROR` pour les événements. Tout log INFO devient donc un breadcrumb attaché au prochain événement, y compris un chemin complet ou un titre de morceau. `level=None` coupe les breadcrumbs
- **Intégrations par défaut hors web** : `Argv`, `Atexit`, `Dedupe`, `Excepthook`, `Logging`, `Modules`, `Stdlib`, `Threading`. `ArgvIntegration` capture `sys.argv` et mérite d'être désactivée ici
- **Plan Developer gratuit** : 5 000 erreurs par mois, rétention 30 jours, un seul utilisateur. Doc officielle : « Events and attachments that exceed your quota will not be accepted »

**Recommandation** : ✅ Tester sur l'enveloppe réellement construite : variables de frame absentes, `server_name` fixe, `data_collection` résolu entièrement fermé (`sidecar/tests/unit/core/test_sentry_payload.py`).

### 9. PyInstaller
**Version actuelle** : `6.22.3` (2026-09-12)
**Stabilité** : ✅

**Breaking Changes Majeurs** :
- **6.8.0** : un hidden-import invalide (chemin de fichier au lieu d'un nom de module) devient une erreur de build bloquante. Build interdit depuis `C:\Windows`. Dépréciation de l'exécution avec privilèges élevés et de l'ajout du `site-packages` d'un venv à `pathex`, tous deux bloqués en v7.0
- **6.10.0** : `-m` comme raccourci de `--manifest` déprécié, suppression en v7.0
- **6.22.1** : le bootloader vérifie le process parent pour détecter un environnement usurpé

**Compatibilité Écosystème** :
- `requires_python` : `>=3.8,<3.16`. Le support de 3.14 date de 6.15.0, celui de 3.15 de 6.21.0. **Le décalage de support redouté n'existe pas ici**
- Confirmé verbatim : « it is not a cross-compiler; to make a Windows app you run PyInstaller on Windows »
- **Hooks livrés par `pyinstaller-hooks-contrib`** : `hook-sentry_sdk.py` (interroge dynamiquement `_AUTO_ENABLING_INTEGRATIONS` au build), le hook `pydantic` (mis à jour pour la v2, PR #611) et `hook-certifi.py` (`collect_data_files`). **Aucun hook pour mutagen ou httpx**. keyring est couvert par `hook-keyring.py`, livré par PyInstaller lui-même. RapidFuzz ne l'est par aucun : son entry point `pyinstaller40` s'appelle `tests`, pas `hook-dirs`
- **Licence** : GPL 2.0+ avec exception explicite sur le bootloader : « unlimited permission to link or embed compiled bootloader and related files into combinations with other programs, and to distribute those combinations without any restriction ». Le binaire distribué peut donc rester sous la licence du projet

**`--onedir` vs `--onefile`** : le choix `--onedir` d'[ARCHITECTURE.md](ARCHITECTURE.md#arborescence) est confirmé par la doc officielle (« One-folder launches faster »), et il évite le piège du `--onefile` : « The `_MEI_xxxxxx_` folder is not removed if the program crashes or is killed », soit une accumulation de dossiers temporaires chez l'utilisateur à chaque crash du sidecar. `--contents-directory '.'` permet un layout plat si le sous-dossier `_internal/` gêne.

**Faux positifs antivirus** : la signature de code n'est pas l'atténuation retenue ici : elle suppose un certificat, écarté au vu du budget nul ([PRODUCTION.md § Code Signing](PRODUCTION.md#code-signing)). L'atténuation effective est le mode `--onedir`, qui évite l'extraction en dossier temporaire déclenchant les heuristiques. Mesuré le 2026-10-21 : aucun blocage ni quarantaine chez un utilisateur réel, installation et mise à jour ([PRODUCTION.md § Checklist Post-MEP](PRODUCTION.md#checklist-post-mep)).

**Recommandation** : ✅

### 10. pytest et son écosystème
**Version actuelle** : `pytest 9.2.0` (relevé le 2026-10-29), `pytest-asyncio 1.4.1` (2026-10-25), `pytest-cov 7.1.0`, `anyio 4.15.1`
**Stabilité** : ✅

**Breaking Changes Majeurs** :
- **pytest 9.0.0** : Python 3.9 abandonné. Surtout, « PytestRemovedIn9Warning deprecation warnings are now errors by default », et le contournement `filterwarnings = ignore::pytest.PytestRemovedIn9Warning` cesse de fonctionner en 9.1+
- **pytest 9.0.0** : les subtests (ex-plugin `pytest-subtests`) sont fusionnés dans le core, et la table `[tool.pytest]` de `pyproject.toml` est supportée nativement en plus de `[tool.pytest.ini_options]`
- **pytest 9.1.0** : dépréciation des fixtures class-scoped définies comme méthodes d'instance, et de `request.getfixturevalue()` pendant le teardown
- **pytest-asyncio 1.0.0** : fixture `event_loop` supprimée, remplacée par le paramètre `loop_scope` de `@pytest.mark.asyncio`
- **pytest-asyncio 1.4.0** : fixture `event_loop_policy` dépréciée au profit du hook `pytest_asyncio_loop_factories`

**Compatibilité Écosystème** :
- `pytest-cov 7.1.0` corrige un défaut de cohérence du calcul de couverture totale qui affectait `--cov-fail-under`, et un `ResourceWarning` sur les connexions `sqlite3` : les deux touchent directement ce projet (seuil bloquant à 80 % et parsing du dump VLC)
- `pytest-asyncio` et `anyio` fournissent chacun leur plugin. Les deux peuvent cohabiter mais ne doivent pas piloter la même boucle sur un même test

**Recommandation** : ✅ pour pytest lui-même. ❌ pour le mock HTTP, voir [Conflits Potentiels](#conflits-potentiels).

### 11. Ruff
**Version actuelle** : `0.17.3` (2026-10-27)
**Stabilité** : ⚠️ (par le volume du changement de défauts, pas par la qualité de l'outil)

**Breaking Changes Majeurs** :
- **0.16.0** (2026-07-23) : « Ruff now enables a much larger set of rules by default (413, up from 59) ». Quelques règles sont au contraire retirées de ce jeu, dont E401, E402, la famille E7xx, F403, F405, F406 et F722
- **0.16.0** : `ruff format` formate désormais par défaut les blocs Python dans les fichiers Markdown
- **0.16.0** : les champs `filename`, `location` et `end_location` de la sortie JSON peuvent être `null`
- **0.16.0** : nouvelle syntaxe de suppression `# ruff: ignore` en fin de ligne, équivalente à `noqa`
- **0.17.0** : Python par défaut 3.11 (3.15 pour les erreurs de syntaxe), sans effet : `requires-python` prime. `DTZ001`, `DTZ005`, `DTZ006`, `DTZ007`, `DTZ011`, `DTZ012` et `DTZ901` quittent le jeu par défaut et `F406` y entre : sans effet, `select` est explicite et contient `DTZ`
- **0.17.0** : stabilise `TID254`, `TID255` et `RUF071`. `RUF` et `TID` étant sélectionnés, `RUF071` s'applique désormais, sans violation sur la base. Aucune règle renommée ni retirée
- **0.17.0** : le formateur, `I001`, `E501` et `W505` ignorent les commentaires pragma de fin de ligne dans le calcul de la longueur. ruff-lsp est supprimé

**Compatibilité Écosystème** :
- `target-version = "py313"` et `"py314"` tous deux supportés
- **Le formateur ne trie pas les imports** : `ruff check --select I --fix` puis `ruff format`, dans cet ordre. La catégorie `I` reste hors du jeu par défaut même après l'expansion, tout comme `ANN`, `N` et `C90`
- **Règles incompatibles avec `ruff format`**, à exclure : `W191`, `E111`, `E114`, `E117`, `D203`, `D206`, `D300`, `Q000` à `Q004`, `COM812`, `COM819`, `ISC002`. `COM812` est le cas classique qui casse
- Doc officielle : « Ruff is a linter, not a type checker […] It's recommended that you use Ruff in conjunction with a type checker, like Mypy ». Aucun recouvrement avec le gate Mypy
- CI : Ruff tourne par `uv run` dans `just lint-sidecar`, à la version du lockfile, sans action dédiée

**Recommandation** : ⚠️ Figer un `select` explicite plutôt que d'hériter du défaut de Ruff, une montée de version pouvant sinon ajouter une règle en silence. Ne pas déclarer `target-version`, que Ruff dérive de `requires-python` (cf. [`.claude/rules/ruff/lint-format.md`](../.claude/rules/ruff/lint-format.md)).

### 12. Mypy
**Version actuelle** : `2.4.1` (relevé le 2026-10-29)
**Stabilité** : ✅

**Breaking Changes Majeurs** :
- **2.0** : `--local-partial-types` et `--strict-bytes` (PEP 688, `bytearray`/`memoryview` ne sont plus assignables à `bytes`) activés par défaut, `--allow-redefinition` adopte la sémantique de `--allow-redefinition-new`, Python 3.9 abandonné, narrowing plus agressif
- **2.2** : les types de retour explicites de `__new__()` sont désormais respectés, ce qui peut révéler des erreurs latentes. TypedDict fermés (PEP 728)
- **2.3** : parser natif expérimental derrière `--native-parser`. Les attributs `Final` deviennent read-only à l'exécution, mais seulement dans les classes natives compilées par mypyc : un projet qui n'utilise Mypy que comme checker n'est pas touché
- **2.4** : le parser natif, basé sur celui de Ruff, devient le défaut ; `native_parser = false` rétablit l'ancien, dont le retrait est annoncé début 2027. Un commentaire `# type:` sur un `for` ou un `with` est désormais ignoré sans erreur, et le parallel checking (`-n auto`) sort de l'expérimental. Aucun changement de la liste `--strict`

**Compatibilité Écosystème** :
- **Aucune dépendance du projet n'exige de stub externe** : `mutagen`, `rapidfuzz`, `httpx2`, `keyring`, `pydantic` et `sentry-sdk` livrent tous un `py.typed`. Ni paquet `types-*`, ni `ignore_missing_imports` à écrire
- `strict = true` active 13 flags mais **pas** `warn_unreachable`, ni la famille `disallow_any_unimported` / `disallow_any_expr` / `disallow_any_decorated` / `disallow_any_explicit`
- Les alternatives récentes ne conviennent pas à un gate bloquant : `ty` (Astral) annonce des changements de diagnostics entre deux versions quelconques, et `pyrefly` (Meta) manque de recul d'usage vérifiable

**Recommandation** : ✅ Ajouter `warn_unreachable = true` au-delà de `strict`. Après le premier passage, tourner une fois avec `--warn-unused-ignores` pour repérer les `# type: ignore[code]` devenus obsolètes.

## Frontend

### 1. Angular
**Version actuelle** : runtime `@angular/*` en `22.2.3` (2026-10-14), `@angular/cli` et `@angular/build` en `22.2.5` (relevé le 2026-10-29), `@angular/cdk` en `22.2.4` (2026-10-21)
**Stabilité** : ✅

Les deux numéros viennent de dépôts distincts et n'ont pas à converger. `@angular/build` déclare `@angular/core` en `^22.0.0` : les aligner bloquerait les correctifs du builder.

**Breaking Changes Majeurs** :
- **`ChangeDetectionStrategy.OnPush` devient le défaut** pour tout composant qui n'en déclare pas. `ChangeDetectionStrategy.Eager` restaure l'ancien comportement, et `ng update` pose ce marqueur là où il le faut
- `paramsInheritanceStrategy` passe de `'emptyOnly'` à `'always'`
- Le backend HTTP par défaut passe de XHR à `fetch`. `provideHttpClient(withXhr)` revient en arrière
- APIs supprimées : `ChangeDetectorRef.checkNoChanges`, `createNgModuleRef`, `ComponentFactoryResolver`, `provideRoutes()`, intégration Hammer.js
- TypeScript < 6.0 non supporté, Node 20 abandonné

**Nouvelles Features Pertinentes** :
- Signal Forms, API Signals, architecture zoneless et `httpResource`/`rxResource` passent en stable
- **22.2.0** corrige GHSA-ff3f-86qr-9cv3 dans `@angular/router`, un déni de service du rendu serveur : sans objet ici, l'application n'a pas de SSR, mais `pnpm audit` le remonte jusqu'à la montée
- **22.2.0** : `@angular/build:unit-test` accepte Vitest 5 et déprécie son option `splitting`. **22.2.1** durcit le sanitizer d'URL (`data:` et `vbscript:` bloqués), **22.2.2** ne livre que des correctifs
- **`@angular/build` 22.2.4 figeait `vite` en `8.3.0`** : `pnpm audit` y remontait six avis du serveur de dev (`launch-editor` en sévérité haute, `server.fs`), corrigés en `vite` 8.3.3. Un `overrides: vite: 8.3.5` le contournait. La 22.2.5 épingle `vite` en `8.3.5` (`pnpm view @angular/build@22.2.5 dependencies.vite`, relevé le 2026-10-29) : l'override est retiré. Outil de dev, absent du bundle livré
- **22.2** : option `strictUnclaimedEventNames` (opt-in, activée ici), qui rend une erreur de compilation sur un `(output)` qu'aucune directive ne déclare

**Compatibilité Écosystème** :
- `engines` : Node `^22.22.3 || ^24.15.0 || >=26.0.0`, TypeScript `>=6.0.0 <6.1.0`, RxJS `^6.5.3 || ^7.4.0`
- `ng build` produit `dist/<app>/browser`, à pointer directement en `frontendDist` dans `tauri.conf.json`. Aucun serveur Node au runtime
- pnpm supporté nativement : `ng new --package-manager pnpm`, ou champ `cli.packageManager` d'`angular.json`
- Vitest promu stable en v21 : « we decided on Vitest as our new default test runner, and are promoting it to stable in Angular v21 »

**Recommandation** : ✅ Le passage d'OnPush en défaut est sans incidence, l'état passant entièrement par des signals et ngx-translate documentant la compatibilité OnPush de son pipe. Le point à surveiller est ailleurs : Angular 22 verrouille TypeScript sur la ligne 6.0.

### 2. TypeScript
**Version actuelle** : `6.0.3` (retenue, dernière 6.0.x au 2026-10-27) / `7.0.2` (dernière stable, **inutilisable ici**)
**Stabilité** : ✅ sur 6.0.x

**Breaking Changes Majeurs** :
- **6.0** : `strict` à `true` par défaut, `module=esnext`, `target=es2025`, `types=[]` (ne charge plus tous les `@types` automatiquement). Dépréciation de `target es5`, `moduleResolution node`, `baseUrl`. Suppression de `module amd/umd/systemjs`, `moduleResolution classic`, `outFile`. Flag `--ts6-migration` pour l'analyse statique
- **7.0 (Corsa, compilateur natif Go)** : rend ces ruptures définitives, et surtout **l'API programmatique du compilateur n'existe pas dans `tsgo`**, elle est annoncée pour 7.1

**Compatibilité Écosystème** :
- **Angular 22 exige `>=6.0.0 <6.1.0`**, toujours vrai en 22.2.3. La demande d'élargissement à TS 7 a été fermée en `not planned` le 2026-07-09 (angular/angular#69704) : « Supporting TS 7.0, requires a major refactoring of our compiler ». Angular 23 est attendu vers juin 2027
- **Aucune TS 6.1 ne sortira** : « we do not intend to release a TypeScript 6.1 » (blog TypeScript, décembre 2025). La 7.1, qui doit rendre une API programmatique (microsoft/TypeScript#63703, ouverte au 2026-10-27), a publié `7.1.0-beta` le 2026-10-20 (dist-tag `beta` de npm, relevé le 2026-10-27) ; la stable n'est pas sortie, et la présence de l'API dans la beta n'a pas été vérifiée
- `typescript-eslint` 8.72.1 déclare `typescript: >=4.8.4 <6.1.0`, et son parseur crashe réellement sous TS 7, pas seulement un avertissement de peer dependency. Le support de TS 7.1 se prépare dans typescript-eslint#10940 (PR #12803), sans version annoncée
- `@tauri-apps/api` 2.12.4 ne déclare aucune contrainte : TypeScript n'y apparaît qu'en `devDependency`
- `tsconfig.json` : `target: "ES2022"` (celui du schematic `ng new` 22.2.1) et `lib: ["es2024", "dom"]` depuis le 2026-10-12. Le schematic ne pose pas de `lib` et la doc Angular ne se prononce pas sur ce réglage : la cible est la WebView2 évergreen. `dom` inclut `dom.iterable` et `dom.asynciterable` depuis TypeScript 6.0. `tsconfig.app.json` et `tsconfig.spec.json` héritent sans le redéfinir

**Recommandation** : ✅ Rester sur **6.0.x**. TS 7 casse simultanément `@angular/compiler-cli` et `typescript-eslint`, soit le build et le lint. Ce n'est pas un arbitrage, c'est un blocage. Réévaluable quand TS 7.1 sera stable et qu'un `@angular/compiler-cli` puis un `typescript-eslint` l'accepteront dans leurs `peerDependencies`, ce qu'une mineure 22.x peut faire comme Angular 23.

### 3. Node.js
**Version actuelle** : `26.13.0` (Lithium, Active LTS depuis le 2026-10-28, installée en local et en CI le 2026-10-29, source : `https://nodejs.org/dist/index.json`, champ `lts`)
**Stabilité** : ✅

**Calendrier** :

| Ligne | Statut | Maintenance | EOL |
|---|---|---|---|
| 20.x (Iron) | ❌ EOL | — | 2026-04-30 |
| 22.x (Jod) | Maintenance LTS | depuis 2025-10-21 | 2027-04-30 |
| 24.x (Krypton) | Maintenance LTS | depuis 2026-10-20 | 2028-04-30 |
| 26.x (Lithium) | **Active LTS** depuis le 2026-10-28 | 2027-10-20 | 2029-04-30 |

Calendrier relevé le 2026-10-09 (nodejs/Release), passage LTS de la 26 confirmé le 2026-10-29 par l'index officiel.

**Breaking Changes Majeurs** :
- **Corepack retiré de la distribution Node à partir de la 25.x** et absent de la 26.0.0 (vote du TSC, PR nodejs/node#57617). Le projet ne l'utilise pas : `pnpm/setup` installe pnpm, `corepack enable` n'est appelé nulle part
- **22.20.0** : OpenSSL bundlé passé de 3.0.x à 3.5.2, OpenSSL 3.0.x sortant de support en septembre 2026. Tout pin sur 22.x doit être ≥ 22.20.0
- **26.0.0** : `NODE_MODULE_VERSION` 147 (les addons natifs doivent publier un prebuild pour la 26), suppression des modules `_stream_*` hérités et de `--experimental-transform-types`, `module.register()` déprécié à l'exécution, API `Temporal` activée par défaut. Aucun effet constaté sur la chaîne de build : `just install`, le gate complet et `just build` sont verts sous 26.13.0 (2026-10-29), prebuilds d'esbuild, lmdb, @parcel/watcher et msgpackr-extract compris

**Compatibilité Écosystème** :
- Angular 22 : `^22.22.3 || ^24.15.0 || >=26.0.0`
- pnpm 12 tourne en binaire natif, sans Node une fois installé ; pnpm 11.x exige Node `>=22.13`
- Vitest 5.0.x : `^22.12.0 || ^24.0.0 || >=26.0.0`, jsdom 30.1 : `^22.22.2 || ^24.15.0 || >=26.0.0`
- `@tauri-apps/cli` : `>= 10`, sans contrainte réelle (le binaire Tauri est en Rust)

**Recommandation** : ✅ **26.13.0, ligne LTS.**

Node n'est pas une dépendance du produit, c'est un outil de build : il n'est jamais embarqué dans le binaire distribué, contrairement à l'interpréteur Python que PyInstaller empaquette. La bascule a été déclenchée sur la confirmation du passage LTS (issue #60), pas sur la date annoncée. Elle a porté `runtime: node@26` dans `.github/actions/setup-pnpm`, `engines.node` (`^26.0.0`) et `demo/Dockerfile` (`node:26.13.0-slim`), que garde `test_demo_image_coherence.py`. Prochaine bascule : Node 28, à revérifier dans le calendrier nodejs/Release.

Sur la ligne 26, **Corepack n'existe plus** : la chaîne d'installation passe par l'input `runtime: node@26` de `pnpm/setup`, qui remplace `actions/setup-node`. Ne jamais s'en remettre au Node préinstallé sur l'image du runner, qui change au fil de ses mises à jour.

### 4. pnpm
**Version actuelle** : `12.15.0` (2026-10-21), épinglée par `devEngines.packageManager` et égale au dist-tag `latest` au 2026-10-27. `next-12` vaut `12.16.1` (2026-10-27), non adoptées. Dernière 11.x : `11.28.8` (dist-tag `latest-11`, relevé le 2026-10-27), maintenue jusqu'au 2027-04-30 selon le `SECURITY.md` de pnpm (relevé le 2026-10-16)
**Stabilité** : ✅

`latest` a basculé de la ligne 11 à la ligne 12 entre le 2026-09-04 et le 2026-09-06 (pnpm.io PR #918 : « `npm view pnpm dist-tags` now reports `latest: 12.3.4` »). Le relevé précédent de ce document, daté du 2026-10-02, la croyait encore sous `next-12` : c'était déjà faux.

**Breaking Changes Majeurs** :
- **11.0.0** (2026-04-28) : Node `>=22.13` requis, distribution ESM pure. `onlyBuiltDependencies` et ses variantes remplacées par un unique `allowBuilds`. `.npmrc` restreint à l'auth et au registry, le reste migre vers `pnpm-workspace.yaml`. Variables `npm_config_*` renommées `pnpm_config_*`. `minimumReleaseAge` passe à 1440 minutes et `blockExoticSubdeps` à `true`
- **12.0.0** (2026-08-26) : réécriture en Rust, binaire natif qui ne demande plus Node une fois installé, **format de lockfile inchangé** (`lockfileVersion: '9.0'`, champ optionnel `revision` par paquet). `--frozen-lockfile false` et `--resolution-only` supprimés (`--no-frozen-lockfile`, `pnpm peers check`). Une clé inconnue de `pnpm-workspace.yaml` est signalée avec suggestion de typo, en warning tant que le projet n'épingle pas pnpm. Première résolution complète : les variantes de peers des paquets cycliques sont réécrites une fois
- Aucune de ces ruptures ne touche les réglages du projet (`allowBuilds`, `minimumReleaseAge`, `scriptShell`, `packages: []`) : les montées 11.24.0 → 12.15.0 (2026-10-09 au 2026-10-21) n'ont changé que le contenu résolu du lockfile. À surveiller : la 12.11.0 ajoute un réglage `permissions`, qui primerait sur `allowBuilds` s'il était posé

**Ce que la migration 10 → 11 coûte réellement sur ce projet** : moins de dix lignes. `allowBuilds: { esbuild: true }` remplace `onlyBuiltDependencies: [esbuild]` (esbuild étant tiré par `@angular/build`), et les réglages non-auth du `.npmrc` déménagent dans un `pnpm-workspace.yaml`, à créer même sans monorepo. Le renommage `npm_config_*` n'a d'effet que si la CI pilote pnpm par variables d'environnement, ce qui n'est pas le cas ici.

**Le lockfile multi-document est conditionnel, pas systématique.** C'est le point le plus mal compris de cette version. Doc officielle : « `pnpm-lock.yaml` is a YAML file, but it is not always a **single** YAML document. Depending on what the project uses, pnpm writes either one document or two ». Trois déclencheurs seulement :

| Déclencheur | Présent ici ? |
|---|---|
| `configDependencies` dans `pnpm-workspace.yaml` | Non |
| `devEngines.packageManager` dans `package.json` | **Oui depuis le 2026-10-15** : pnpm épinglé en version exacte avec `onFail: download` |
| Champ legacy `packageManager` | Non |

Le second document (`packageManagerDependencies`) porte la résolution de pnpm lui-même. `lockfileVersion` reste `'9.0'` dans les deux. Son coût, assumé, est décrit en [§ Dependabot](#6-dependabot).

**Compatibilité Écosystème** :
- **Angular CLI tourne sur pnpm 12 en interne** : la branche 22.2.x du dépôt `angular/angular-cli` est passée à pnpm 12.6.0 (PR #34160, mergée le 2026-09-24)
- Aucun `node-linker=hoisted` n'est nécessaire, le résolveur strict par défaut convient
- **Dependabot supporte pnpm 12** côté PR depuis le 2026-09-15 (dependabot-core PR #16169 et #16170). Le graphe de dépendances GitHub ne lit toujours que le premier document du lockfile, voir la fiche [Dependabot](#6-dependabot)
- CI : `pnpm/setup@v3.1.2`, qui **exige pnpm 11 ou plus récent** et télécharge le binaire natif (`pnpm/action-setup` : cf. matrice)

**Recommandation** : ✅ **12.15.0**, adoptée le 2026-10-27 (`latest` depuis le 2026-10-21). `package.json` est la seule source de la version : `devEngines.packageManager` avec `onFail: download` fait télécharger la bonne version sur chaque poste, et `pnpm/setup` la lit en CI (sans `version`, l'action composite ne porte plus que celle de Node). Même schéma que pour uv (`required-version`) et que les autres projets pnpm du poste, aligné le 2026-10-15.

> ⚠️ **Piège de CI à désamorcer avant le premier build.** `minimumReleaseAge` à 24 h combiné à `pnpm install --frozen-lockfile` fait échouer la CI quand un bot vient de regénérer un lockfile pointant une dépendance transitive publiée dans les dernières 24 heures. Le cas est documenté sur Angular avec `caniuse-lite`, via la chaîne browserslist, et se solde par `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`. `--frozen-lockfile` ne fait que vérifier, sans repli possible. Dependabot ne régénère pas le lockfile lui-même, il appelle la CLI pnpm, qui applique son propre `minimumReleaseAge` : rien à aligner côté bot. Seule parade restante côté pnpm : `minimumReleaseAgeExclude` pour les paquets qui se republient trop souvent.

### 5. PrimeNG
**Version actuelle** : `22.1.4` (2026-10-22). Aucune 22.2 ni 23 annoncée, la cadence observée sur npm étant d'un patch toutes les trois semaines environ
**Stabilité** : ❌ (sur le modèle de licence, pas sur la qualité technique)

**Statut du dépôt, relevé le 2026-10-09** : `primefaces/primeng` a été archivé le 2026-06-28 puis désarchivé au plus tard le 2026-08-27 (commits poussés ce jour-là), sans annonce. Il ne porte plus que la lignée MIT 21.x, verbatim de son README : « This repository is no longer under active development and receives security fixes only ». Issues en lecture seule, dernière release GitHub `21.1.10` (2026-09-09). Le code des 22.x vit dans `primefaces/primeng-nextchapter`, privé. `primefaces/primeicons`, lui, reste archivé.

**Breaking Changes Majeurs** :
- **v22 supprime toutes les API dépréciées en v20 et v21** : « In v22, the APIs that were deprecated in v20 and v21 are now removed ». Disparaissent notamment `TabMenu`, `TabView`, `Chips`, `Steps`, `InlineMessage`, `Messages`, `AccordionTab`, `pDefer`, `Calendar`, `Dropdown`, `InputSwitch`, `OverlayPanel`, `Sidebar`
- **v22** : directive `pTemplate` supprimée (`ng-template` + variable de référence), `styleClass` supprimé sur les composants host-enabled (utiliser `class`), sélecteurs camelCase supprimés (kebab-case obligatoire)
- **v22** : la base rem passe de 14px à 16px, avec un variant `-compat` par preset maintenu jusqu'en juin 2027
- **v22** : le système d'icônes bascule sur `@primeicons/angular ^8.0.0`, des composants Angular standalone rendant du SVG inline
- `MultiSelect`, `PanelMenu`, `Password`, `Galleria`, `ColorPicker`, `InputMask`, `Chart`, `Image`, `Editor`, `ScrollPanel` et `primeng/icons` sont dépréciés mais **pas encore supprimés**, suppression annoncée en v24
- **22.1.4** : `UniqueComponentId` (`primeng/utils`) déprécié au profit du service `UseId` (`primeng/useid`). Seul usage du projet, `PathPickerComponent` est passé à `UseId` le 2026-10-26, `@typescript-eslint/no-deprecated` refusant le lint

**Compatibilité Écosystème** :
- `peerDependencies` de 22.1.4 : `@angular/core`, `common`, `forms`, `router`, `platform-browser` et `cdk` en `^22.1.0`. **La contrainte est `^22.1.0`, pas `22.x`** : un projet resté sur Angular 22.0.0 déclencherait un avertissement de peer dependency. `@angular/cdk` n'étant tiré par aucun autre paquet, il est à déclarer explicitement
- Dépendances directes : `@primeuix/utils`, `@primeuix/motion`, `@primeuix/styled`, `@primeuix/styles ^3.1.0`, `@primeicons/angular ^8.0.0`, `@primeui/license-manager`
- **La clé de licence ne couvre que les versions publiées avant son expiration.** `providePrimeNG` compare la date de sortie gravée dans la version (`RELEASE_DATE`, `2026-09-29` en 22.1.2) à l'échéance de la clé, et affiche le bandeau « Invalid PrimeUI License » au-delà comme en l'absence de clé. Un build local sans `PRIMENG_LICENSE_KEY` l'affiche donc aussi (relevé le 2026-10-02 sur un build de release). Termes de la Community License, verbatim de primeui.dev : « Community Licenses are valid for 12 months from the date of issue », renouvelables gratuitement, avec « A 30-day grace period is provided after expiration »
- **Scroll virtuel de `p-table`** : `virtualScrollItemSize` ne mesure aucune ligne et `#expandedrow` n'est pas supporté avec `[virtualScroll]`. Le détail déplié sous une ligne de la liste du run repose donc sur une marge non documentée du scroller : avec `virtualScrollOptions.numToleratedItems` fourni, il rend toujours au moins cette valeur moins un de lignes au-dessus de la première visible (lu dans `primeng-scroller.mjs` 22.1.2 le 2026-10-10). À revérifier à chaque montée de PrimeNG, cf. [knowledges/primeng.md § Détail déplié sous une ligne virtualisée](knowledges/primeng.md#détail-déplié-sous-une-ligne-virtualisée)
- **Tabs et router** : aucune suppression formelle d'un « mode router » dans le guide de migration, mais plusieurs issues ouvertes (#17563, #17505, #11999) décrivent l'état actif d'onglet non synchronisé avec `routerLink`. La dizaine de lignes de dérivation depuis l'URL prévue par [ARCHITECTURE.md § Navigation](ARCHITECTURE.md#navigation) reste donc la bonne approche

**Recommandation** : ⚠️ **Retenu, l'[ADR-003](adrs/003-primeng-community-license.md) ayant déjà instruit la sortie du code du dépôt public et la Community License.** Le désarchivage ne change rien à la décision : le dépôt rouvert ne sert que la lignée 21.x. Un seul point lui échappe, à ajouter à ses Négatives : le paquet d'icônes bascule sous la même licence, ce qui étend la dépendance à PrimeTek au-delà des composants (cf. [Conflits Potentiels](#conflits-potentiels)).

### 6. @primeuix/themes
**Version actuelle** : `3.1.0` (2026-10-21)
**Stabilité** : ⚠️

**Breaking Changes Majeurs** :
- Base rem de 16px, citée verbatim du guide de migration : « PrimeNG sizes its components in rem units relative to the document root font size, now assumed to be 16px to match the browser default. Earlier versions assumed 14px, so every preset also ships a compat variant calibrated for a 14px root to keep existing layouts intact »
- `@primeng/themes` (v20) est supprimé, remplacé par ce paquet

**Compatibilité Écosystème** :
- **N'est pas une dépendance transitive de `primeng`** : à déclarer explicitement dans `package.json`
- Import documenté : `import Aura from '@primeuix/themes/aura'`. Le chemin exact de la variante `-compat` n'a pas pu être confirmé sur une source officielle, seule son existence l'est
- Aucun changelog officiel ne documente un changement de signature de `definePreset()`

**Recommandation** : ⚠️ Le projet démarrant de zéro, prendre directement `aura` (16px) et **jamais** `-compat` : [ARCHITECTURE.md](ARCHITECTURE.md#styling--ui) et [DESIGN.md](DESIGN.md) sont déjà écrits sur cette base. La variante compat n'existe que pour ne pas casser un layout hérité, ce qui n'est pas le cas ici.

### 7. PrimeIcons
**Version actuelle** : `@primeicons/angular 8.0.2` (2026-09-23, tiré par PrimeNG) / `primeicons 8.0.2` (2026-09-23, CSS, sous licence) / `primeicons 7.0.0` (dernière MIT, 2024-03-29)
**Stabilité** : ❌

**Breaking Changes Majeurs** :
- **8.0.0** (2026-07-15) : passage sous « PrimeUI License ». Verbatim du `LICENSE.md` du paquet : « A valid license key is required to use this software. License verification is performed offline, with no telemetry and no remote connection »
- Le dépôt `primefaces/primeicons` a été archivé le 2026-06-28
- **v22 de PrimeNG** retire son ancien paquet `primeng/icons` au profit de `@primeicons/angular`, des composants SVG standalone

**Compatibilité Écosystème** :
- `primeng@22.1.4` déclare `@primeicons/angular ^8.0.0` en dépendance directe. Le paquet CSS `primeicons` (classes `pi pi-*`) **n'est pas** dans ses dépendances : il faut le déclarer soi-même pour l'utiliser
- Avec les composants SVG, aucune police à copier dans `angular.json`, donc rien à embarquer pour l'affichage hors ligne
- **Confirmé** : les logos Beatport, Bandcamp, SoundCloud et VLC sont absents des 357 SVG du paquet. Les quatre SVG Simple Icons prévus dans `src/assets/icons/` restent nécessaires
- **Simple Icons** est en CC0-1.0, donc redistribuable sans condition dans le bundle

**Recommandation** : ❌ Traité avec PrimeNG dans [Conflits Potentiels](#conflits-potentiels). Si l'on reste sur PrimeNG 22, s'en tenir aux composants `@primeicons/angular` et ne pas ajouter le paquet CSS : cela évite d'introduire une seconde dépendance sous licence.

### 8. Tailwind CSS
**Version actuelle** : `4.3.3` (2026-07-16), `@tailwindcss/postcss` en `4.3.3`
**Stabilité** : ✅

**Breaking Changes Majeurs** :
- Configuration CSS-first : `@import "tailwindcss"` remplace les directives `@tailwind`, le thème se déclare en `@theme`. `tailwind.config.js` n'est plus chargé automatiquement, `corePlugins` et `separator` ont disparu, `safelist` devient `@source inline()`
- Le plugin PostCSS a son propre paquet : « En v3, le package tailwindcss était un plugin PostCSS, mais en v4 le plugin PostCSS vit dans un package dédié `@tailwindcss/postcss` ». `postcss-import` et `autoprefixer` deviennent inutiles
- **Aucun préprocesseur** : « Tailwind CSS v4.0 is not designed to be used with CSS preprocessors like Sass, Less, or Stylus ». Confirme le choix CSS pur du projet
- `darkMode` ne se configure plus en JS : `@custom-variant` en CSS
- Renommages : `shadow-sm`→`shadow-xs`, `shadow`→`shadow-sm`, `rounded`→`rounded-sm`, `outline-none`→`outline-hidden`, `ring`→`ring-3`. `border-*` utilise `currentColor` au lieu de `gray-200`. Le modificateur important passe en suffixe : `flex!`

**Compatibilité Écosystème** :
- Angular : `@tailwindcss/postcss` via `.postcssrc.json` est la voie recommandée à la fois par la doc Angular et par celle de Tailwind, décrite comme « the most seamless way to integrate it with frameworks like Next.js and Angular ». Pas de bascule vers le plugin Vite
- Alignement du `dark:` sur PrimeNG : `@custom-variant dark (&:where(.app-dark, .app-dark *));` avec le même sélecteur que le `darkModeSelector` passé à `providePrimeNG()`

**Recommandation** : ✅

### 9. tailwindcss-primeui
**Version actuelle** : `0.6.1` (2025-03-26)
**Stabilité** : ⚠️

**Breaking Changes Majeurs** :
- Aucun depuis 0.6.1. Le paquet embarque deux builds : une entrée CSS compatible Tailwind v4 (`@plugin "tailwindcss-primeui";`) et une entrée JS pour Tailwind v3

**Compatibilité Écosystème** :
- Tokens exposés : palettes `primary` et `surface` (50 à 950), classes sémantiques `primary-contrast`, `primary-emphasis`, `border-surface`, `bg-emphasis`, `bg-highlight`, `text-color`, `text-muted-color`, `rounded-border`, plus les animations héritées de PrimeFlex
- **Le plugin n'aligne pas le variant `dark:` tout seul** : il ne lit pas la config PrimeNG. Dès qu'un `darkModeSelector` personnalisé est posé, le `@custom-variant dark` reste à écrire à la main. C'est bien ce qu'annonce [ARCHITECTURE.md § Styling & UI](ARCHITECTURE.md#styling--ui)
- **Aucune publication depuis mars 2025**, soit avant PrimeNG 22 (base 16px, icônes SVG) et avant Tailwind 4.2/4.3. Le dépôt reste public, sous MIT et non archivé au 2026-10-09, contrairement à celui de PrimeIcons

**Recommandation** : ⚠️ Retenu, avec une vérification visuelle dès la première page composée : le plugin ne consomme que des variables CSS générées par PrimeNG, ce qui rend une rupture peu probable, mais rien ne l'atteste depuis 17 mois. Repli sans coût si besoin : consommer directement les variables CSS de PrimeNG dans `@theme`.

### 10. @fontsource-variable/inter
**Version actuelle** : `5.3.0` (2026-07-19)
**Stabilité** : ✅

**Breaking Changes Majeurs** :
- Aucun depuis 5.2.8. La dernière rupture structurelle est la migration v4 → v5 : scission des polices variables sous le scope `@fontsource-variable/*` et correction du nom de famille (`InterVariable` devient `Inter Variable`, avec l'espace)

**Compatibilité Écosystème** :
- Import unique en tête de `src/styles.css` : `@import "@fontsource-variable/inter/wght.css";`, qui couvre l'axe `wght` de 100 à 900 en romain. Ajouter `wght-italic.css` seulement si de l'italique est réellement utilisé
- **Aucune entrée `angular.json` requise** : les `url()` du CSS sont résolus par esbuild comme n'importe quel asset, et les `.woff2` sortent en fichiers hashés
- Famille déclarée par `--font-sans` dans le `@theme` de Tailwind, le preset Aura en hérite (`fontFamily: 'inherit'`)
- Licence SIL OFL 1.1 : redistribution libre dans un installeur Windows, à condition de conserver le fichier de licence

**Recommandation** : ✅

### 11. ngx-translate
**Version actuelle** : `@ngx-translate/core 18.1.0` et `@ngx-translate/http-loader 18.1.0` (publiées le 2026-10-27, npm), adoptées le 2026-10-29. Notes de version lues le 2026-10-27 : ajouts (`hasTranslationKey`, `deleteLanguage`, option de retry au chargement, récupération asynchrone des traductions), correctif `getValue` sur les clés imbriquées, aucune rupture
**Stabilité** : ✅

**Breaking Changes Majeurs** :
- **`TranslateModule` supprimé**, remplacé par `provideTranslateService()` et `provideChildTranslateService()`. Attention au sens de la correspondance, cité verbatim : « Do not invert the mapping: `{ extend: true }` maps to `provideChildTranslateService()`. `{ isolate: true }` maps to `provideTranslateService()` »
- **`defaultLang` renommé `fallbackLang`** partout : `setDefaultLang()` devient `setFallbackLang()`, l'option de config `defaultLanguage` devient `fallbackLang`. L'option `useDefaultLang` est supprimée
- `currentLang` est désormais un `Signal<Language | null>`, à appeler comme une fonction
- `setValue()` remplacé par `insertValue()` (sans mutation), `onTranslationChange` renommé `translationChange$`
- Le pattern `<span translate>HELLO</span>` est déprécié avec avertissement console
- `http-loader` v18 expose `provideTranslateHttpLoader({ prefix, suffix })` à la place du couple `useFactory` + `HttpLoaderFactory`

**Nouvelles Features Pertinentes** :
- Directive structurelle `*translateBlock="let t"` et signal `isLoading`

**Compatibilité Écosystème** :
- Doc officielle : « Tested against Angular 18, 19, 20, 21, and 22 »
- **OnPush** : la doc de compatibilité note qu'« Angular 22 makes OnPush the default change-detection strategy for components that don't declare one » et indique que les composants ngx-translate restent compatibles, en recommandant `markForCheck()` seulement si l'application change de langue hors du cycle Angular
- **Chargement des traductions dans Tauri** : la webview sert le `frontendDist` en same-origin (`tauri://localhost`), donc un `HttpClient.get()` relatif fonctionne sans passer par le protocole `asset:`
- **Piège de chemin** : la doc ngx-translate signale que « In newer versions of Angular, the assets folder is no longer used. Instead, translations are stored in the public folder ». Vérifier le `prefix` contre la configuration réelle d'`angular.json`

**Recommandation** : ✅ L'[ADR-004](adrs/004-i18n-ngx-translate.md) tient. Le projet démarrant de zéro, écrire directement l'API v18 (providers standalone, `fallbackLang`), sans jamais recopier un exemple à base de `TranslateModule.forRoot()`.

### 12. @tauri-apps/api et plugins JS
**Version actuelle** : `@tauri-apps/api 2.12.4` (2026-10-14)
**Stabilité** : ✅

| Paquet npm | Version | Publication |
|---|---|---|
| `@tauri-apps/plugin-shell` | `2.6.0` | relevé le 2026-10-29 |
| `@tauri-apps/plugin-dialog` | `2.8.4` | relevé le 2026-10-29 |
| `@tauri-apps/plugin-store` | `2.5.0` | 2026-09-26 |
| `@tauri-apps/plugin-os` | `2.4.0` | 2026-09-26 |
| `@tauri-apps/plugin-opener` | `2.7.2` | 2026-10-14 |
| `@tauri-apps/plugin-updater` | `2.14.1` | relevé le 2026-10-29 |
| `@tauri-apps/plugin-single-instance` | **n'existe pas** | — |

`plugin-shell` 2.4.1 corrige un `close` (`Terminated`) émis avant la fin de `stdout` quand le process sort vite, ce qui concerne directement la lecture du flux NDJSON du sidecar.

**Breaking Changes Majeurs** :
- `@tauri-apps/api/shell` supprimé au profit de `@tauri-apps/plugin-shell`. Idem pour `dialog`, `os` et `updater`
- L'`allowlist` de `tauri.conf.json` est remplacée par les capabilities
- Updater : « The built-in dialog with an automatic update check was removed », la vérification et l'interface sont désormais à écrire

**Compatibilité Écosystème** :
- **Les versions npm et crate sont strictement identiques plugin par plugin** (même monorepo, release simultanée), et `@tauri-apps/api` partage la mineure de la crate `tauri`. **`tauri build` refuse un écart de mineure entre un paquet npm et sa crate**, et la CI des PR ne lance jamais `tauri build` : un groupe Dependabot npm qui monte les plugins sans le groupe cargo cassait le build de release (relevé le 2026-10-02). `test_the_tauri_crates_and_their_npm_packages_are_aligned` (`sidecar/tests/unit/test_main.py`) garde désormais en CI l'égalité des numéros crate ↔ paquet npm de chaque plugin, et la mineure de `tauri` égale à celle de `@tauri-apps/api` et de `@tauri-apps/cli`
- **`single-instance` n'a aucune API JS** : « this Plugin currently does not have JavaScript APIs, you do not have to configure capabilities to use it ». Rien à installer côté pnpm, seulement la crate côté cargo
- `Command.sidecar(program, args?, options?)` retourne un `Command`. `spawn()` donne un `Child` réutilisable pour `child.write()` sur stdin et `child.kill()`. Les événements sont `command.stdout.on('data')`, `command.stderr.on('data')`, `command.on('close')` et `command.on('error')`
- **`spawn()` et non `execute()`** : `execute()` attend la fin du process et collecte la sortie, ce qui est incompatible avec un sidecar long. C'est cohérent avec le choix de `shell:allow-spawn` d'[ARCHITECTURE.md § Capacités Natives](ARCHITECTURE.md#capacités-natives)

**Issues à connaître** :
- `plugins-workspace#2418` : « program not allowed on the configured shell scope » malgré une capability correcte en apparence, dû à un décalage entre le `name` déclaré et celui utilisé côté JS
- `plugins-workspace#687` : les arguments passés dynamiquement depuis le JS peuvent être ignorés au profit de ceux figés dans la configuration. Statut de correction non vérifié sur la 2.3.5

**Recommandation** : ✅

### 13. @sentry/angular
**Version actuelle** : `11.9.0` (2026-10-23)
**Stabilité** : ✅

**Breaking Changes Majeurs** :
- **11.9.0** : nouvelle catégorie `mcp` (`inputs`, `outputs`) dans `dataCollection`. Le typage `satisfies ClosedDataCollection` a cassé le build comme prévu, la catégorie est fermée depuis le 2026-10-26
- **11.1 → 11.6** : aucune rupture côté navigateur ni sur `dataCollection`, dont le fichier de types (`build/types/types/datacollection.d.ts` de `@sentry/core`) est identique octet pour octet entre 11.1.0 et 11.6.0 (diff du 2026-10-09). La 11.5 change `Sentry.init()` répété : il avertit si un client est déjà actif, et `close()` délie désormais le client qu'il ferme
- **v8** : `@sentry/angular-ivy` supprimé, fusionné dans `@sentry/angular`. Les intégrations deviennent des fonctions `xxxIntegration()` au lieu de classes `Integrations.XXX`
- **v9** : `getCurrentHub()`, `Hub`, `enableTracing` et `autoSessionTracking` supprimés au profit des scopes. ES2020 et TypeScript ≥ 5.0.4 requis
- **v10** : la capture de l'IP est entièrement pilotée par `sendDefaultPii`. Renommages `BaseClient` → `Client`, `logger` → `debug`
- **v11** : `sendDefaultPii` remplacé par `dataCollection`, **dont l'absence collecte tout** : `userInfo` (IP inférée par `infer_ip: auto`), cookies, en-têtes, corps HTTP, paramètres d'URL. Les breadcrumbs de console passent par une intégration `Console` distincte de `Breadcrumbs`. `attachStacktrace` passe à `true`, le span streaming devient le défaut, `enableLogs` disparaît, Node 20.19 minimum

**Compatibilité Écosystème** :
- `peerDependencies` : `@angular/core >= 14.x <= 22.x`, inchangé en 11.9.0. Angular 22 est dans la fenêtre
- **Intégrations actives par défaut en 11.1.0** (relevé le 2026-10-03 par `getDefaultIntegrations`, identiques en 11.0.0 ; aucune intégration navigateur ajoutée par défaut jusqu'à 11.6.0 selon ses notes) : `EventFilters`, `FunctionToString`, `ConversationId`, `BrowserApiErrors`, `Breadcrumbs`, `Console`, `GlobalHandlers`, `LinkedErrors`, `Dedupe`, `HttpContext`, `CultureContext`, `BrowserSession`. `browserTracing` et `replay` sont **opt-in** : ne pas les ajouter suffit à ce qu'aucun tracing ni replay ne parte
- `httpContextIntegration` envoie toujours l'URL complète de la requête, soit ici `tauri://localhost/...`. Pas de donnée personnelle, mais la route interne est exposée. `beforeSend` la retire si besoin
- **Zoneless** : aucune déclaration officielle de Sentry sur le comportement en Angular zoneless. L'`ErrorHandler` ne dépend pas de Zone.js, donc le cas d'usage retenu ici n'est pas concerné. L'issue `sentry-javascript#8983` (le `finalTimeout` du tracing bloque la stabilisation de `NgZone`) ne s'applique qu'avec `browserTracingIntegration`, non utilisée
- Aucune documentation Sentry ne couvre Tauri : le SDK fonctionne comme dans n'importe quelle webview, sans enrichissement du contexte machine côté Rust

**Recommandation** : ⚠️ Ne pas activer `browserTracing`, fermer explicitement chaque catégorie de `dataCollection` et retirer `Breadcrumbs`, `Console`, `Replay` et `CultureContext`. En v11 les défauts ne sont plus les bons : la config vit dans `core/observability/sentry-options.ts`, dont le test lit l'événement réellement envoyé.

### 14. Vitest
**Version actuelle** : `5.0.5` (2026-10-15)
**Stabilité** : ✅

**Breaking Changes Majeurs** :
- **5.0** (2026-09-03) : Node `>=22.12.0` et Vite `>=6.4.0`, Vite devenant peer dependency. `clearMocks` passe à `true` par défaut. `vi.mock`, `vi.unmock` et `vi.hoisted` hors top level lèvent une erreur, une assertion async non attendue (`resolves`, `rejects`) fait échouer le test, `expect.poll` échoue au timeout, et `toThrow('texte')` matche une sous-chaîne. Fake timers : `Temporal` est mocké avec `Date`. Options `sequential` et entry points dépréciés en 4.1 supprimés, reporters `json` et `junit` écrits en fichier par défaut, artefacts regroupés sous `.vitest/`. Les 345 tests de la webview sont passés sans modification à la montée du 2026-10-09
- **4.0** : browser mode réécrit sur une architecture de providers, `instances` remplace `browser.name`. `workspace` renommé `projects`. Suppression d'API dépréciées dont `poolMatchGlobs`. Les défauts du sérialiseur de snapshots changent (régénérer avec `vitest run -u`)

**Compatibilité Écosystème** :
- **Runner par défaut du CLI Angular 22** via `@angular/build:unit-test` : « This guide covers the default testing setup for new Angular CLI projects, which uses Vitest ». Stable pour un nouveau projet, ce qui est le cas ici
- `@angular/build` déclare `vitest: ^4.0.8 || ^5.0.0` depuis la 22.2.0, dont les notes précisent : « The `splitting` option in the unit-test builder is deprecated as it is no longer needed with Vitest 5 »
- `@analogjs/vitest-angular` n'est plus nécessaire, le builder natif suffit
- DOM : jsdom par défaut, happy-dom détecté automatiquement s'il est installé. Aucune préférence tranchée par Angular
- Angular 22 ajoute les flags `--quiet` et `--isolate`, et le support de `fakeAsync`/`flush`/`waitForAsync` sous Vitest

**Point de vigilance levé** : aucun fichier de configuration Vitest dans le dépôt, `angular.json` ne pose que `isolate: true` sur `@angular/build:unit-test` (relevé le 2026-10-23).

**Recommandation** : ✅

### 15. angular-eslint
**Version actuelle** : `22.6.0` (2026-10-11)
**Stabilité** : ✅

**Breaking Changes Majeurs** :
- **22.0.0** : Angular 22 et TypeScript 6 requis, Node 20 abandonné
- **ESLint 8 et le format `.eslintrc` sont totalement supprimés** : `eslint: ^9.0.0 || ^10.0.0` en peer dependency, flat config `eslint.config.js` obligatoire
- Règle `no-conflicting-lifecycle` supprimée
- `prefer-on-push-component-change-detection` change de sens : OnPush étant le défaut en Angular 22, la règle ne signale plus que les opt-out explicites. Elle a rejoint le preset `recommended`, donc de nouveaux avertissements peuvent apparaître
- **22.1.0** : nouvelles règles `prefer-service-decorator`, `inject-at-top`, `require-switch-default`, `no-outerhtml`
- **22.2.0** : `no-duplicates-in-metadata-arrays`, du preset `recommended`, couvre aussi `providers`, `viewProviders` et `styleUrls`, et `valid-aria` valide chaque jeton d'une liste : un lint en `--max-warnings 0` peut échouer sur du code déjà en place

**Compatibilité Écosystème** :
- Le paquet suit la majeure d'Angular. `@angular-eslint/builder` ne déclare plus `@angular/cli` en peerDependency depuis la 22.2.0 : un écart de majeure se signale à l'exécution, plus à l'installation
- `typescript-eslint ^8.0.0` (8.72.1 au relevé), qui contraint TypeScript à `>=4.8.4 <6.1.0`
- **Les règles d'accessibilité ne sont pas dans `recommended`** : il faut étendre explicitement les deux presets, `angular.configs.templateRecommended` **et** `angular.configs.templateAccessibility`. C'est ce dernier qui apporte `alt-text`, `click-events-have-key-events`, `interactive-supports-focus`, `label-has-associated-control`, `role-has-required-aria`, `valid-aria`
- `eslint-config-prettier` reste nécessaire : angular-eslint ne désactive pas ses règles stylistiques

**Recommandation** : ✅ Installation par `ng add angular-eslint` (le paquet umbrella), pas par les paquets `@angular-eslint/*` séparés.

### 16. Prettier et prettier-plugin-tailwindcss
**Version actuelle** : `prettier 3.9.10` (2026-10-10), `prettier-plugin-tailwindcss 0.8.1` (2026-07-15)
**Stabilité** : ✅

**Breaking Changes Majeurs** :
- Prettier reste en ligne 3.x, aucune 4.0 stable (seulement des alphas sous le tag `next`)
- **plugin 0.8.0** : « Require at least Prettier 3.7.x »
- **plugin 0.7.0** : Tailwind v4 devient le comportement de repli par défaut au lieu de v3
- **prettier 3.9.4** : le parser Angular reformate `@content(name)` en `@content (name)`

**Compatibilité Écosystème** :
- **Tailwind v4 sans `tailwind.config.js`** : « When using Tailwind CSS v4 you must specify your CSS file entry point […] use the `tailwindStylesheet` option in your Prettier configuration. Note that paths are resolved relative to the Prettier configuration file »
- Le tri des classes couvre nativement `class`, `className`, `:class` et `[ngClass]`
- Prettier 3.9.10 embarque son propre parser Angular (`@angular/compiler` 22.0.6, lu dans `node_modules/prettier/plugins/angular.js` le 2026-10-29) : il ne suit pas la version d'`@angular/compiler` du build (22.2.3), et un template qui emploie une syntaxe plus récente que la 22.0 serait à vérifier au premier échec de `prettier --check`

**Recommandation** : ✅

## Partagé / Infrastructure

### 1. Tauri v2
**Version actuelle** : crate `tauri 2.12.5` (2026-10-21), `tauri-build 2.7.4` (2026-10-21), `@tauri-apps/cli 2.12.4` (2026-10-21)
**Stabilité** : ✅

**Les quatre paquets ont chacun leur cycle de patch, mais la mineure se partage** entre `tauri` et `@tauri-apps/api`, comme entre chaque plugin et son paquet npm : `tauri build` le contrôle, et `test_the_tauri_crates_and_their_npm_packages_are_aligned` (`sidecar/tests/unit/test_main.py`) le garde en CI pour les plugins, `@tauri-apps/api` et `@tauri-apps/cli`. Combo validé le 2026-10-02 par un `tauri build` de release : `tauri 2.12.1` + `tauri-build 2.7.1` + `@tauri-apps/cli 2.12.1` + `@tauri-apps/api 2.12.1`. Le passage de la crate en 2.12.2 garde la mineure partagée.

**Breaking Changes Majeurs** (dans la ligne v2) :
- **2.3.0** : `Manager::unmanage` déprécié pour corriger un use-after-free
- **2.6.0** : le code de manipulation HTML de `tauri-utils` passe derrière un feature flag
- **2.11.4** : `time` avait été épinglé à `<0.3.52`, dépinglé en 2.11.5. Un lockfile figé sur 2.11.4 peut en hériter
- **2.12.2** : correctifs seuls, dont une panique quand un listener `once` reçoit plusieurs événements avant son retrait
- **2.12.5** (2026-10-21) : correctifs seuls dans la ligne 2.12, `tauri-build` 2.7.4 et `tauri-runtime-wry` 2.12.3 suivent. Aucune adaptation du code (`just lint-tauri` vert sous Rust 1.99.1, relevé le 2026-10-27)

**Compatibilité Écosystème** :
- **MSRV** : 1.90 pour `tauri`, `tauri-build` et tous les plugins depuis la 2.12. Rust 1.99 le satisfait. Sous un `rust-version` plus bas, cargo résout en silence les dernières versions compatibles et garde Tauri en 2.11
- **Windows** : « Tauri uses Microsoft Edge WebView2 to render content on Windows », préinstallé depuis Windows 10 build 1803. Build Tools C++ (workload « Desktop development with C++ ») et toolchain MSVC requis
- **Sidecar** : la doc cite explicitement « Python CLI apps or API servers bundled with PyInstaller » comme cas d'usage d'`externalBin`. Le suffixe target-triple s'obtient par `rustc --print host-tuple` (flag disponible depuis Rust 1.84.0). **`externalBin` ne gère qu'un exécutable** : le dossier `_internal/` d'un build `--onedir` passe par `bundle.resources`, **en forme objet** (`{ "binaries/_internal": "_internal" }`), seule forme qui le pose à côté de l'exécutable. `resolveResource()` n'y sert à rien : le bootloader `--onedir` cherche son dossier de contenu relativement à l'exe, sans passer par l'API Tauri
- **`assetProtocol`** : `{ "enable": true, "scope": ["$APPLOCALDATA/cache/artworks/**"] }`, plus une CSP dont `img-src` doit inclure `'self' asset: http://asset.localhost blob: data:`. Côté webview, `convertFileSrc(filePath)` produit l'URL à poser dans le `src`
- **Updater** : le `latest.json` minimal ne requiert que `version`, `platforms.[target].url` et `platforms.[target].signature`. La signature vient de `TAURI_SIGNING_PRIVATE_KEY` (chemin ou contenu, **jamais un `.env`**) et la `pubkey` de `tauri.conf.json` doit être le contenu de la clé publique, pas un chemin
- **NSIS et MSI sont tous deux compatibles avec l'updater** : « MSI and NSIS installers receive signatures and can be used with the updater ». NSIS a deux avantages : le mode `downloadBootstrapper` pour WebView2, et la cross-compilation possible, là où le MSI (WiX) « can only be created on Windows »

**Recommandation** : ✅ Retenir **NSIS** comme format de bundle. La cross-compilation n'a pas d'usage immédiat (Windows seul au MVP, cf. [ADR-015](adrs/015-cibles-distribution-windows.md)) mais le bootstrapper WebView2 est un filet de sécurité gratuit chez un utilisateur dont l'installation Windows serait incomplète.

### 2. Plugins officiels Tauri v2
**Version actuelle** : une par crate, voir le tableau ci-dessous
**Stabilité** : ✅

| Crate | Version | Publication | Exige `tauri` |
|---|---|---|---|
| `tauri-plugin-shell` | `2.6.0` | relevé le 2026-10-29 | `^2.12` |
| `tauri-plugin-dialog` | `2.8.4` | relevé le 2026-10-29 | `^2.12` |
| `tauri-plugin-store` | `2.5.0` | 2026-09-26 | `^2.12` |
| `tauri-plugin-os` | `2.4.0` | 2026-09-26 | `^2.12` |
| `tauri-plugin-opener` | `2.7.2` | 2026-10-14 | `^2.12` |
| `tauri-plugin-single-instance` | `2.5.5` | relevé le 2026-10-29 | `^2.12` |
| `tauri-plugin-updater` | `2.14.1` | relevé le 2026-10-29 | `^2.12` |

**Breaking Changes Majeurs** :
- **`updater` 2.12** : `plugins.updater.requireSignedVersion` (défaut `false`, posé à `true` par `tauri add updater`) rejette une réponse d'endpoint dont la version diffère de celle inscrite dans la signature, et `check()` n'accepte plus `allowDowngrades` depuis le webview. Les releases signées avant le CLI 2.12 ne portent aucune version et sont rejetées. Sans conséquence ici : la paire de clés updater date du 2026-10-20 et la mise à jour 0.10.0 → 0.11.0 est vérifiée depuis le 2026-10-21 ([PRODUCTION.md § Checklist Post-MEP](PRODUCTION.md#checklist-post-mep))
- **`updater` 2.14.0** : sous Windows, l'échec du lancement de l'installeur rapporte la raison de `ShellExecuteW` (« Access is denied » sur un refus UAC), et `install` revérifie les octets du paquet avant de l'installer
- **`updater` 2.11.0** : sous Windows, `install` lève une erreur si l'installeur ne démarre pas. `downloadAndInstall` gagne l'option `restartAfterInstall`, vraie par défaut : l'installeur relance l'application, sans plugin `process` (vérifié dans le crate 2.14.0, `updater.rs`, le 2026-10-21)
- **`updater` 2.5.0** : `UpdaterBuilder::new` supprimé au profit de `UpdaterExt::updater_builder`. Concerne l'usage Rust bas niveau, pas l'API JS

**Compatibilité Écosystème** :
- Toutes les crates exigent `tauri` en `^2.12` : un plugin à jour impose la crate `tauri` 2.12
- **Les versions crate et npm sont strictement identiques plugin par plugin**, release simultanée du même monorepo. `test_the_tauri_crates_and_their_npm_packages_are_aligned` (`sidecar/tests/unit/test_main.py`) le garde en CI, `single-instance` et `prevent-default` (sans paquet npm) en étant exclus
- `tauri-plugin-fs` et `@tauri-apps/plugin-fs` ne sont plus déclarés (la webview n'importe aucun des deux). La crate reste dans `Cargo.lock` comme dépendance transitive de `tauri-plugin-dialog`
- MSRV 1.90 pour toutes, en deçà de la toolchain 1.99 retenue

**Points structurants** :
- **`single-instance` doit être enregistré en premier**, verbatim : « The Single Instance plugin must be the first one to be registered to work well. This assures that it runs before other plugins can interfere ». Le `lib.rs` doit donc respecter cet ordre
- **`updater` sur Windows** : signatures obligatoires et non désactivables, et l'application se ferme automatiquement à l'installation (limitation des installeurs Windows). Un hook `on_before_exit` permet de nettoyer avant. Trois modes : `passive` (défaut), `basicUi`, `quiet`
- **`tauri-plugin-prevent-default` `6.0.1`** (plugin tiers, publié le 2026-10-05) : ni paquet npm ni permission. La 6.0.0 n'a qu'une rupture, l'exigence de `tauri` 2.12 et d'un MSRV 1.90 ; `Builder`, `Flags` et `PlatformOptions` sont inchangés. Seuls `Flags::RELOAD | Flags::CONTEXT_MENU | Flags::OPEN | Flags::SOURCE` en release (`src-tauri/src/lib.rs`) : le jeu par défaut coupe aussi `FOCUS_MOVE` (`Shift+Tab`), et l'option Windows `browser_accelerator_keys(false)` coupe aussi le zoom clavier
- **`opener`** : `opener:allow-reveal-item-in-dir` pour le bouton « ouvrir le dossier de logs », `opener:allow-open-url` avec un scope glob pour le lien vers la fiche source
- **`store`** : fichier JSON, chemin défini par l'appelant au `load()`, résolu dans le répertoire app data. API asynchrone en v2, `LazyStore` pour l'initialisation différée

**Recommandation** : ✅ Une zone grise reste, non bloquante : le format retourné par `locale()` du plugin `os` n'est documenté que par renvoi vers la référence JavaScript. Le format BCP-47 attendu par [ARCHITECTURE.md § i18n](ARCHITECTURE.md#i18n) n'est attesté ni par le dépôt ni par PRODUCTION.md, la règle « commence par `fr` » (`src/app/core/i18n/language.ts`) étant de toute façon tolérante. Levée : la syntaxe de `shell:allow-spawn` restreinte au sidecar (`"sidecar": true`) est portée par `src-tauri/capabilities/default.json` et le spawn fonctionne sur l'installeur de la 0.11.0 (2026-10-21).

### 3. Rust
**Version actuelle** : `1.99.1` (2026-10-16, correctif de la 1.99.0 du 2026-10-01), canal stable. Prochaine, `1.100.0`, attendue le 2026-11-12 selon le cycle de six semaines
**Stabilité** : ✅

**Breaking Changes Majeurs** :
- **1.98.1** (2026-09-03) : corrige une miscompilation de la 1.98.0, qui pouvait poser un pointeur nul à la place d'un pointeur de fonction dans la vtable d'un trait object. Raison suffisante de ne pas rester épinglé en 1.98.0
- **1.99.0** : modules entiers hérités (`std::i32::MAX`) pleinement dépréciés, `no_mangle_generic_items` devient une erreur, plusieurs nouveaux warnings rustc (macros à point-virgule final, `#[path]` inutile, attributs `doc` invalides), et trois lints Clippy entrent dans les groupes par défaut (`nonnull_unchecked_on_box_ptr`, `block_scrutinee`, `mismatched_bit_width_type`). Cargo désactive la compilation incrémentale quand `CI` est posée. `cargo clippy -- -D warnings` passe sans changement sur le code du projet (vérifié le 2026-10-09)
- **1.99.1** (2026-10-16) : corrige une miscompilation des valeurs `bool` de retour FFI sur x86_64, un symbole `wcslen` manquant sur UEFI et le rpath de `libLLVM` sur macOS (notes de version). `cargo clippy -- -D warnings` passe sans changement (relevé le 2026-10-27)
- Édition 2024 stabilisée en 1.85.0 et générée par défaut par `cargo new`
- Clippy déplace régulièrement des lints entre catégories : **le même code peut passer ou échouer selon la toolchain du runner**

**Compatibilité Écosystème** :
- MSRV Tauri : 1.90 pour toutes les crates depuis la 2.12. Large marge
- Rust 1.99.0 était **préinstallé sur l'image `windows-2025`** depuis sa version 20261004.281.1, la 1.99.1 l'est depuis les images du 2026-10-21 ; `rustup` installe de toute façon la toolchain épinglée
- Cache CI : `Swatinem/rust-cache@v2.9.3`, d'autant plus rentable ici que le rapport dépendances / code propre est extrême
- Dependabot met à jour `Cargo.toml` et `Cargo.lock` via l'écosystème `cargo`, en déléguant la régénération à cargo

**Recommandation** : ✅ Poser un `rust-toolchain.toml` épinglant la stable utilisée. Le code Rust se limitant à l'initialisation des plugins (`src-tauri/src/lib.rs`), la seule chose que la CI peut casser est un lint Clippy nouvellement promu, et Clippy déplace régulièrement des lints entre catégories. L'épinglage rend ce risque explicite au lieu de le laisser survenir au gré des mises à jour d'image de runner.

### 4. GitHub Actions
**Version actuelle** : voir le tableau des actions ci-dessous, confronté aux workflows et aux actions composites le 2026-10-29 (dates entre parenthèses : publication)
**Stabilité** : ✅

| Action | Version | Notes |
|---|---|---|
| `actions/checkout` | `v7.0.1` (2026-07-17) | v7 : migration ESM, blocage du checkout de PR de fork sur `pull_request_target` |
| `pnpm/setup` | `v3.1.2` (2026-10-25) | Installe pnpm et Node en une étape, à la place d'`actions/setup-node`. **Exige pnpm 11+.** La v3 détecte un fichier de version Node et inclut l'id du run dans la clé de cache ; `runtime: node@26` reste explicite. La v3.1.0 ajoute les inputs `registry` et `save-cache`. Appelée par la seule action composite `.github/actions/setup-pnpm` |
| `astral-sh/setup-uv` | `v10.3.3` | Runtime `node24`. La v10.1.0 vérifie les téléchargements d'uv contre des checksums, la v10.3.0 embarque ceux d'uv jusqu'à 0.13.0. Appelée par la seule action composite `.github/actions/setup-uv` |
| `dorny/paths-filter` | `v4.0.3` (2026-08-05) | Job `changes` : saute les trois zones sur une PR de markdown seul. La 4.0.3 corrige GHSA-7hc6-8hq5-9q2m (noms de fichiers multi-lignes) |
| `dtolnay/rust-toolchain` | `@stable` | Pas de semver : la révision **est** la sélection. Le `rust-toolchain.toml` du dépôt prime ensuite sur ce choix |
| `Swatinem/rust-cache` | `v2.9.3` (2026-10-20) | Supporte le layout de build Cargo V2 |
| `tauri-apps/tauri-action` | `v1.0.0` (2026-06-29) | v1 abandonne Tauri v1, supprime `includeRelease`/`includeDebug`, renomme `assetNamePattern` en `releaseAssetNamePattern`. Écrit dans `latest.json` l'URL d'API de l'asset (tauri-action#1315), limitée à 60 appels par heure et par IP sans token : le workflow la remplace par le lien sous le tag (constaté sur la v0.10.0) |
| `googleapis/release-please-action` | `v5.0.0` (2026-04-22) | v5 : passage au runtime Node 24 |
| `extractions/setup-just` | `v4.0.0` | Installe `just` sur le runner : les deux workflows appellent les recettes du `Justfile` plutôt que de dupliquer les commandes. Appelée par la seule action composite `.github/actions/setup-just`, qui lit la version dans `minimum-version` du `Justfile` |
| `getsentry/action-release` | `v3.7.2` (2026-10-21) | Job `sentry-release` : une release par projet Sentry (`techno-tagger-ui`, `techno-tagger-sidecar`), `set_commits: auto` d'où le `fetch-depth: 0`. Action composite, la 3.7.1 ne corrige que des dépendances transitives (`js-yaml`, `undici`) |
| `docker/setup-buildx-action` | `v4.4.1` (2026-09-16) | Jobs `demo-image` (`ci.yml`) et `demo` (`release-please.yml`) |
| `docker/build-push-action` | `v7.4.0` (2026-09-15) | Build de l'image de la démo (`demo/Dockerfile`), sonde en CI puis publication au tag |
| `docker/login-action` | `v4.7.0` (2026-10-23) | Connexion à GHCR, job `demo` |
| `docker/metadata-action` | `v6.2.0` (2026-07-02) | Tags et labels de l'image `ghcr.io/<dépôt>-demo`, job `demo` |
| `rhysd/actionlint` | `1.7.12` (2026-03-30) | Script et binaire épinglés dans le job `ui`. Le support du label `ubuntu-26.04` n'est pas confirmé dans ses notes |

**Breaking Changes Majeurs** :
- `actions/upload-artifact@v3` dépréciée depuis le 2024-11-30, à ne jamais reprendre d'un exemple ancien
- **`windows-latest` ne pointe plus sur Windows Server 2022** mais sur Windows Server 2025 avec Visual Studio 2026 : c'est ce genre de bascule silencieuse que l'épinglage `windows-2025` / `ubuntu-24.04` des workflows évite. Dependabot ne suit pas les images, leur montée est manuelle
- **`ubuntu-latest` bascule vers Ubuntu 26.04** entre le 2026-10-19 et le 2026-11-19, l'image `ubuntu-26.04` étant GA depuis le 2026-09-17 : sans effet sur les jobs épinglés en `ubuntu-24.04`
- **Node 20 est retiré des runners le 2026-09-23** : une action en `runs.using: node20` échoue. Celles du projet sont en `node24` ou composites (relevé le 2026-10-09)
- **`pull_request_target` restreint par défaut sur dépôt public à partir du 2026-11-02** (source tierce, non retrouvée dans le changelog officiel) : sans effet, aucun workflow du projet ne s'en sert

**Compatibilité Écosystème** :
- **Runners Windows** : Rust 1.99.1 (images du 2026-10-21, 1.99.0 auparavant, relevé le 2026-10-27), MSVC de Visual Studio 2026 et le SDK Windows sont préinstallés, Node, Python et uv venant des actions de setup du projet. La présence de WebView2 n'a pas pu être confirmée
- **Ressources d'un runner standard sur dépôt public** : 4 vCPU et 16 Go de RAM, Windows compris
- **Coût nul** : « GitHub Actions usage is free […] for public repositories that use standard GitHub-hosted runners », runners Windows compris
- **`tauri-action` et le sidecar** : l'action « will build the app, create a GitHub release itself, and upload the app bundles to the newly created release », et gère le `latest.json` via `uploadUpdaterJson` (`true` par défaut). Mais elle ne fait qu'appeler `tauri build` : **aucun hook pour construire un sidecar avant**. Le binaire PyInstaller doit être en place dans `src-tauri/binaries/` à son invocation, posé par une étape antérieure du même job

**Recommandation** : ✅ Pinner chaque action sur le SHA de son tag, jamais sur un tag flottant : c'est ce qui laisse Dependabot proposer chaque montée par une PR. Une version d'outil qui sert à plusieurs jobs vit dans une action composite locale (`.github/actions/setup-uv`, `.github/actions/setup-pnpm`), jamais recopiée d'un job à l'autre.

### 5. release-please
**Version actuelle** : action `5.0.0` (2026-04-22), CLI npm `17.11.2` (2026-08-24)
**Stabilité** : ⚠️

Projet activement maintenu par Google, ni archivé ni déprécié.

**Breaking Changes Majeurs** :
- **action v5.0.0** : passage au runtime Node 24
- L'action v5.0.0 embarque release-please 17.6.0 en interne, en retard sur le CLI npm public en 17.11.2

**Compatibilité Écosystème** :
- `release-type` natifs pour les trois langages du projet, mais un seul est utilisé : `node`
- `extra-files` accepte les formats `generic`, `json` (jsonpath), `yaml`, `xml` et `toml`, ce qui couvre `Cargo.toml` et `pyproject.toml`
- Se chaîne à `tauri-action` par `needs:` et les outputs, sans dépendance de version entre les deux

**Le point critique d'[ARCHITECTURE.md § CI/CD](ARCHITECTURE.md#cicd) est confirmé par la doc GitHub**, verbatim : « When you use the repository's `GITHUB_TOKEN` to perform tasks, events triggered by the `GITHUB_TOKEN` will not create a new workflow run. […] if a workflow run pushes code using the repository's `GITHUB_TOKEN`, a new workflow will not run even when the repository contains a workflow configured to run when push events occur ».

Trois contournements, dans l'ordre de préférence :
1. **Chaînage `needs:` dans le même workflow** en consommant les outputs `release_created` et `tag_name`. Ne dépend d'aucun token supplémentaire. C'est le choix du projet
2. Personal Access Token
3. Token de GitHub App

**Outputs disponibles** : `releases_created`, `paths_released`, `prs_created`, `pr`, `prs`, plus pour le composant racine `release_created`, `upload_url`, `html_url`, `tag_name`, `version`, `major`, `minor`, `patch`, `sha`, `body`.

**Propagation d'une version dans trois langages** : le montage retenu est décrit par [PRODUCTION.md § Propagation de la version](PRODUCTION.md#propagation-de-la-version) et repose sur **un seul composant** en `release-type: node`, `package.json` faisant seul foi. Les autres fichiers suivent par `extra-files`, sauf `tauri.conf.json` qui se retire du problème en pointant `"version": "../package.json"`. Le plugin `linked-versions`, qui aligne plusieurs composants entre eux, n'a donc pas d'objet ici.

**Le piège n'est pas la propagation mais les lockfiles** : `uv.lock` et `Cargo.lock` portent la version du paquet local dans un tableau `[[package]]`, et `uv sync --locked` refuse un lock désaccordé, ce qui ferait échouer le build de release. Depuis le 2026-10-28, les deux sont suivis par `extra-files` avec un filtre `@.name.value`, recette vérifiée ce jour-là sur release-please 17.6.0 (celle de l'action 5.0.0). Syntaxe, piège du `No entries modified` silencieux et portée du support natif à venir : [knowledges/release-please.md § Mode manifest et `extra-files`](knowledges/release-please.md#mode-manifest-et-extra-files).

**Comportement `chore:`** confirmé verbatim : « A releasable unit is a commit to the branch with one of the following prefixes: 'feat', 'fix', and 'deps'. (A 'chore' or 'build' commit is not a releasable unit.) ». L'échappatoire l'est aussi : « When a commit to the main branch has `Release-As: x.x.x` (case insensitive) in the commit body, Release Please will open a new pull request for the specified version ».

**Recommandation** : ✅ Le flux `develop` → `main` **n'est documenté nulle part**, release-please raisonnant sur une branche de vérité unique (« A config file must exist at the tip of the default/configured branch ») pilotée par `target-branch`. Il marche pourtant sans réglage : le squash-merge de la PR `develop → main` est un commit ordinaire de `main`, et c'est lui que l'outil lit. **Confirmé au premier run**, tag `v0.1.0` et `CHANGELOG.md` à l'appui.

### 6. Dependabot
**Version actuelle** : app GitHub intégrée à la plateforme, aucune version épinglée par le dépôt : la CLI qui régénère chaque lockfile est celle installée par le job (pnpm, uv, cargo), pas un binaire versionné côté Dependabot
**Stabilité** : ✅

**Mode de panne assumé depuis le 2026-10-15.** Sur un `pnpm-lock.yaml` à deux documents, format que pnpm écrit dès que `devEngines.packageManager` est déclaré, le graphe de dépendances GitHub ne lit que le premier document et rapporte zéro dépendance : **les alertes de sécurité npm se referment sans rien afficher**, les PR de bump continuent de fonctionner ([dependabot-core#15904](https://github.com/dependabot/dependabot-core/issues/15904), ouverte, derniers constats du 2026-09-23). Jusqu'au 2026-10-15 le projet retirait la cause (aucun pin dans `package.json`, version portée par la CI). Le pin dans `package.json` a été retenu pour avoir le même schéma qu'uv et que les autres projets du poste ; la veille CVE côté npm repose sur `just audit-ui` en CI, non bloquant, lu à chaque release ([PRODUCTION.md § Dépendances](PRODUCTION.md#dépendances)).

**Nouvelles Features Pertinentes** :
- Support natif de l'écosystème `uv` en disponibilité générale depuis le 2025-03-13 : « Developers can now use Dependabot to automatically keep their `uv` dependencies up to date » (GitHub Changelog). Dependabot comprend `pyproject.toml` et régénère `uv.lock` directement, sans détour par l'écosystème `pip`
- `groups` avec `update-types: [minor, patch]` groupe les mises à jour mineures et correctifs par écosystème, laissant les majeures sortir isolées, une par dépendance : c'est le réglage posé dans `.github/dependabot.yml`

**Compatibilité Écosystème** :
- **Une entrée `updates` par écosystème**, déclarée explicitement : `npm` en `/` (Angular), `uv` en `/sidecar`, `cargo` en `/src-tauri`, `github-actions` en `/` et `/.github/actions/*` (le premier ne couvre que `.github/workflows`, le second les actions composites locales), `docker` en `/demo` (`demo/Dockerfile`). Les cinq valeurs de `package-ecosystem` sont celles de la doc officielle
- **Dependabot ne régénère pas le lockfile lui-même, il appelle la CLI du gestionnaire** (`pnpm install`, `uv lock`, `cargo update`), qui applique ses propres réglages : le `minimumReleaseAge: 1440` posé dans `pnpm-workspace.yaml` s'applique donc à une PR Dependabot exactement comme à une installation locale, rien à répliquer côté configuration du bot
- **Gratuit et intégré à GitHub**, aucune app tierce à installer ni à autoriser séparément. « Dependency graph » et « Dependabot alerts » restent à activer dans les réglages de sécurité du dépôt, ce sont eux qui alimentent le *dependency grapher* que Dependabot consomme

**Issue à surveiller** : [dependabot-core#15904](https://github.com/dependabot/dependabot-core/issues/15904), lecture du lockfile à deux documents par le graphe de dépendances. Sa clôture rend les alertes npm à nouveau fiables, sans rien changer au dépôt.

**Recommandation** : ✅ Dependabot pour les PR de mise à jour, `just audit-ui` pour la veille CVE npm tant que #15904 est ouverte. Voir [PRODUCTION.md § Dépendances](PRODUCTION.md#dépendances) et [§ Composants applicatifs](PRODUCTION.md#composants-applicatifs) pour la procédure opérationnelle.

### 7. Images Docker de la démo
**Version actuelle** : `nginx/nginx-unprivileged:1.31.8-alpine` et `node:26.13.0-slim`, relevées le 2026-10-29 (Docker Hub)
**Stabilité** : ✅

**Compatibilité Écosystème** :
- **`nginx/nginx-unprivileged`** : processus sous l'UID 101, port 8080 par défaut, PID dans `/tmp/nginx.pid` et fichiers temporaires sous `/tmp`, `/usr/bin/wget` présent (busybox) pour le healthcheck. Le dépôt `nginxinc/nginx-unprivileged` est déprécié au profit de `nginx/nginx-unprivileged` (github.com/nginx/docker-nginx-unprivileged, relevé le 2026-10-26)
- **`node:26.13.0-slim`** : Debian, `bash` présent. L'alpine n'en a pas, or `scriptShell: bash` de `pnpm-workspace.yaml` l'exige pour `pnpm build:demo`

**Recommandation** : ✅ Tags complets, jamais `26-slim` ni `latest` : Dependabot (écosystème `docker` sur `/demo`) propose chaque montée. La majeure de Node suit `engines.node`, la montée de l'une sans l'autre fait échouer le test de cohérence.

---

# Matrice de Compatibilité Croisée

| Dépendance A | Dépendance B | Compatibilité | Notes |
|--------------|--------------|---------------|-------|
| Angular 22.2.3 | TypeScript 6.0.x | ✅ | Contrainte dure `>=6.0.0 <6.1.0` |
| Angular 22.2.3 | TypeScript 7.0.x | ❌ | `compiler-cli` ne compile pas, élargissement refusé en `not planned` |
| Angular 22.2.3 | Node 26.x (24.x aussi accepté) | ✅ | `engines` : `^22.22.3 \|\| ^24.15.0 \|\| >=26.0.0` |
| Angular 22.2.3 | PrimeNG 22.1.4 | ✅ | `peerDependency` en `^22.1.0`, pas `22.x` |
| Angular 22.2.3 | Vitest 5.0.5 | ✅ | Runner par défaut du CLI depuis la v21, peer `^4.0.8 \|\| ^5.0.0` depuis 22.2.0 |
| Angular 22.2.3 | ngx-translate 18.1.0 | ✅ | « Tested against Angular 18, 19, 20, 21, and 22 » |
| Angular 22.2.3 | @sentry/angular 11.9.0 | ✅ | `>= 14.x <= 22.x` |
| Angular 22.2.3 | angular-eslint 22.6.0 | ✅ | Alignement de majeure, contrôlé à l'exécution depuis que la 22.2.0 a retiré la peer `@angular/cli` |
| Angular 22.2.3 | Tauri 2.12.5 | ✅ | `ng build` → `dist/<app>/browser` en `frontendDist`, aucun SSR |
| jsdom 30.1.3 | Node 26.x | ✅ | `engines` : `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0`, couvre l'`engines` du projet |
| Angular 22.2.3 | Tailwind 4.3.3 | ✅ | Via `@tailwindcss/postcss` et `.postcssrc.json`, voie recommandée par les deux docs |
| ngx-translate 18.1.0 | Tauri 2.12.5 | ✅ | Les JSON de traduction sont servis en same-origin depuis `frontendDist`, sans `asset:` |
| TypeScript 6.0.x | typescript-eslint 8.72.1 | ✅ | `>=4.8.4 <6.1.0` |
| PrimeNG 22.1.4 | @primeuix/themes 3.1.0 | ✅ | À installer explicitement, pas de dépendance transitive |
| PrimeNG 22.1.4 | @primeicons/angular 8.0.2 | ⚠️ | Dépendance directe, sous licence PrimeUI |
| PrimeNG 22.1.4 | tailwindcss-primeui 0.6.1 | ⚠️ | Plugin figé depuis mars 2025, antérieur à la v22 |
| PrimeNG 22.1.4 | Tailwind 4.3.3 | ✅ | Layer `primeng` à placer après `theme` et `base`, avant `utilities` |
| Tailwind 4.3.3 | @tailwindcss/postcss 4.3.3 | ✅ | Versions synchronisées, même monorepo |
| Tailwind 4.3.3 | prettier-plugin-tailwindcss 0.8.1 | ✅ | Option `tailwindStylesheet` obligatoire |
| Tailwind 4.3.3 | SCSS / LESS | ❌ | Non supporté par conception, d'où le CSS pur |
| Tailwind 4.3.3 | WebView2 | ✅ | Plancher navigateur de la v4 très en deçà du Chromium de WebView2 |
| pnpm 12.15.0 | Angular CLI 22 | ✅ | La branche 22.2.x d'`angular/angular-cli` tourne elle-même sur pnpm 12.6.0 depuis le 2026-09-24 |
| pnpm 12.15.0 (lockfile à deux documents) | Dependabot | ⚠️ | PR de mise à jour OK ; alertes de sécurité npm non fiables tant que dependabot-core#15904 est ouverte, `just audit-ui` en relais |
| Dependabot | uv, cargo, github-actions, docker | ✅ | Écosystèmes `uv`, `cargo`, `github-actions` et `docker` (`/demo`) couverts par le même `dependabot.yml` que `npm` |
| pnpm 12.15.0 | `pnpm/setup` v3.1.2 | ✅ | L'action exige pnpm 11+, télécharge le binaire natif et lit `devEngines.packageManager` sans `version` |
| pnpm 12.15.0 | `pnpm/action-setup` v6 | ⚠️ | Support de pnpm 12 annoncé en v6.1.0, mais `pnpm.cmd` non reconnu sous PowerShell Windows (action-setup#291, ouverte) : le projet reste sur `pnpm/setup` |
| pnpm 12.15.0 | `--frozen-lockfile` en CI | ⚠️ | `minimumReleaseAge` à 24 h fait échouer l'install sur une transitive trop fraîche |
| Node 26.x | `pnpm/setup` v3.1.2 | ✅ | `runtime: node@26`, sans Corepack ni `actions/setup-node` |
| Node 25.x et au-delà | Corepack | ❌ | Retiré des binaires officiels, sans effet : le projet n'utilise pas Corepack |
| Python 3.14.10 | PyInstaller 6.22.3 | ✅ | Plage `>=3.8,<3.16`, support de 3.14 depuis 6.15.0 (2025-08-03) |
| Python 3.14.10 | rapidfuzz 3.14.6 | ✅ | **Wheels `cp314` pour `win_amd64`**, une des deux extensions natives de la stack |
| Python 3.14.10 | pydantic 2.14.1 | ✅ | Wheels `cp314` et `cp314t` de `pydantic-core` pour `win_amd64`, compatibilité 3.14 annoncée depuis pydantic 2.12 |
| Python 3.14.10 | httpx2 2.16.0 | ✅ | Classifiers 3.11 à 3.15, et zstd natif à partir de 3.14 |
| Python 3.14.10 | sentry-sdk 2.73.0 | ✅ | Classifier 3.14 explicite |
| Python 3.14.10 | mypy 2.4.1 / pytest 9.2.0 | ✅ | Wheels `cp314` pour mypy, support pytest depuis 8.4.0 |
| Python 3.14.10 | mutagen 1.48.1 | ✅ | `>=3.10,<4`. Classifiers non détaillés, mais pur Python sans dépendance |
| Python 3.14.10 | `asyncio.get_event_loop()` | ❌ | Lève `RuntimeError` hors loop. À bannir par le lint, `asyncio.run()` à la place |
| Python 3.14.10 | `sqlite3.version` | ❌ | Supprimé. Utiliser `sqlite3.sqlite_version` (moteur), `connect()` non concerné |
| httpx2 2.16.0 | respx 0.23.1 | ❌ | Dépend de `httpx>=0.25.0`, PR #317 ouverte non mergée |
| httpx2 2.16.0 | pytest-httpx 0.36.2 | ❌ | Dépend de `httpx==0.28.*`, PR #239 ouverte non mergée |
| httpx2 2.16.0 | truststore + PyInstaller | ✅ | Appels `ctypes` vers l'API OS dans un binaire figé, validés par le run complet de l'installeur 0.11.0 (2026-10-21) |
| keyring 25.7.0 | PyInstaller 6.22.3 | ⚠️ | Backends par entry points, aucun hook contrib. Forçage explicite requis, validé sur l'application installée (2026-10-21) |
| sentry-sdk 2.73.0 | PyInstaller 6.22.3 | ✅ | `hook-sentry_sdk.py` fourni par `pyinstaller-hooks-contrib` |
| rapidfuzz 3.14.6 | PyInstaller 6.22.3 | ⚠️ | **Aucun hook**, ni du paquet ni de `hooks-contrib` : son entry point `pyinstaller40` est `tests`, pas `hook-dirs`. Couvrir par `collect_submodules("rapidfuzz")` à cause des cibles SIMD |
| pydantic 2.14.1 | PyInstaller 6.22.3 | ✅ | Hook `pydantic` livré par `pyinstaller-hooks-contrib`, couple `pydantic-core` + interpréteur géré par uv validé sur l'installeur 0.11.0 (2026-10-21) |
| mutagen 1.48.1 | PyInstaller 6.22.3 | ✅ | Pur Python, aucun hook nécessaire |
| Mypy 2.4.1 strict | toutes les deps Python | ✅ | Toutes livrent un `py.typed` |
| Ruff 0.17.3 lint | Ruff 0.17.3 format | ⚠️ | Exclure `COM812`, `ISC002`, `Q000`-`Q004`, `E111`, `E114`, `E117`, `W191`, `D203`, `D206`, `D300` |
| Ruff 0.17.3 | Mypy 2.4.1 | ✅ | Périmètres disjoints, aucun recouvrement |
| Rust 1.99.1 | tauri 2.12.5 | ✅ | MSRV 1.90 |
| Rust 1.99.1 | tauri-build 2.7.4 | ✅ | MSRV 1.90 |
| tauri 2.12.5 | plugins v2 (7 crates) | ✅ | Toutes en `^2.12` |
| Crates plugins | Paquets npm plugins | ✅ | Numéros strictement identiques plugin par plugin, gardés par `test_main.py` et par `tauri build` |
| tauri 2.12.5 | @tauri-apps/api 2.12.4 | ✅ | Mineure partagée (avec `@tauri-apps/cli` aussi), gardée par `test_main.py` et par `tauri build` ; les patchs restent libres |
| PyInstaller `--onedir` | Tauri `externalBin` | ⚠️ | `externalBin` ne prend qu'un exécutable, `_internal/` passe par `bundle.resources` |
| release-please + `GITHUB_TOKEN` | `on: push: tags` | ❌ | Aucun workflow déclenché, confirmé par la doc GitHub |
| release-please | flux `develop` → `main` | ✅ | Non documenté mais confirmé au premier run (`v0.1.0`) : le squash-merge est un commit ordinaire de `main` |
| tauri-action v1.0.0 | build sidecar préalable | ⚠️ | Aucun hook : le binaire doit être en place avant l'invocation |
| NSIS | plugin updater | ✅ | « MSI and NSIS installers receive signatures and can be used with the updater » |

---

# Conflits Potentiels

| Conflit | Risque | Solution |
|---------|--------|---------|
| **La bascule sous licence PrimeUI s'étend au paquet d'icônes**, que l'[ADR-003](adrs/003-primeng-community-license.md) n'avait pas couvert : PrimeNG 22 tire `@primeicons/angular ^8.0.0`, sous la même licence, la dernière version MIT du paquet d'icônes étant `primeicons` 7.0.0 | 🟡 | Consigné dans les Négatives de l'ADR-003 : la dépendance à PrimeTek dépasse la seule bibliothèque de composants, porte de sortie Optimus UI côté icônes comprise. **La décision elle-même tient** : l'ADR a instruit l'archivage du dépôt et la Community License, et rien de nouveau ne la remet en cause |
| **Aucun mock HTTP ne supporte `httpx2`.** `respx` dépend de `httpx>=0.25.0`, `pytest-httpx` de `httpx==0.28.*`. Les PR de support (respx#317, pytest-httpx#239) sont ouvertes, non mergées | 🟢 | Le « client techno-scraper mocké » d'[ARCHITECTURE.md § Stratégie de Tests](ARCHITECTURE.md#stratégie-de-tests) doit reposer sur le `MockTransport` natif d'`httpx2`, injecté dans le client via son paramètre `transport`. C'est quelques dizaines de lignes de fixture, sans dépendance externe, et le pattern survit à l'arrivée d'un vrai `respx` compatible. **Tranché** : fixtures dans `sidecar/tests/conftest.py` et `sidecar/tests/helpers/scraper_responses.py` |
| **`keyring` ne trouve pas son backend dans le binaire PyInstaller.** Les backends sont découverts par entry points depuis la 12.0.0, l'analyse statique ne les voit pas, et l'échec est `RuntimeError: No recommended backend was available` au runtime | 🔴 | Ne pas compter sur l'auto-détection : forcer `PYTHON_KEYRING_BACKEND=keyring.backends.Windows.WinVaultKeyring` ou appeler `keyring.set_keyring(WinVaultKeyring())` en code, plus `--collect-metadata keyring` et `--hidden-import win32ctypes.pywin32.win32cred,win32ctypes.pywin32.pywintypes` à la commande PyInstaller. **Tester sur le binaire figé, jamais seulement sur les sources** (validé sur l'application installée le 2026-10-21) |
| **`sentry_sdk.init()` peut planter dans le binaire figé.** Les intégrations sont importées par `importlib.import_module`, et le code n'intercepte que `DidNotEnable` et `SyntaxError`, pas `ImportError` : un module manquant fait tomber l'initialisation au lieu de désactiver silencieusement l'intégration | 🟡 | `hook-sentry_sdk.py` de `pyinstaller-hooks-contrib` couvre le cas nominal en interrogeant `_AUTO_ENABLING_INTEGRATIONS` au build. Vérifier sa présence, et couvrir l'appel à `init()` d'un `try/except` : une remontée d'erreurs cassée ne doit jamais empêcher l'application de démarrer. `init_sentry` (`sidecar/src/tagger/core/observability.py`) protège l'import et l'appel, self-test de l'application installée confirmé le 2026-10-19 |
| **Le `pnpm-lock.yaml` à deux documents referme les alertes de sécurité npm en silence.** Déclenché par `devEngines.packageManager`, retenu le 2026-10-15 pour le même schéma de pin que les autres projets : le graphe de dépendances lit le premier document et rapporte zéro dépendance, les PR de bump fonctionnent (dependabot-core#15904, ouverte) | 🟡 | Veille CVE npm par `just audit-ui` en CI (non bloquant, lu à chaque release, cf. [§ Dependabot](#6-dependabot)). Surveiller #15904 : sa clôture rétablit les alertes sans rien changer au dépôt |
| **`minimumReleaseAge` à 24 h fait échouer `pnpm install --frozen-lockfile`** quand un bot vient de regénérer un lockfile pointant une transitive publiée dans la fenêtre. Cas documenté sur Angular via `caniuse-lite` | 🟡 | Dependabot régénère le lockfile via la CLI pnpm, qui applique elle-même son `minimumReleaseAge` : rien à aligner côté bot. Garder `minimumReleaseAgeExclude` côté pnpm en parade ciblée. Ne pas désactiver le réglage, c'est une protection supply-chain réelle |
| **Corepack disparaît sous les pieds de la CI.** Retiré des binaires officiels Node depuis la 25.x, absent de la 26.0.0 | 🟢 | `pnpm/setup@v3.1.2` installe pnpm et Node en une étape, sans Corepack. pnpm le déconseille de toute façon en CI, même là où il existe encore : « Corepack installs a JavaScript shim in place of pnpm, so every `pnpm` call starts Node.js to run the shim before pnpm itself starts » |
| **`tailwindcss-primeui` n'a pas bougé depuis mars 2025**, soit avant la base 16px et le nouveau système d'icônes de PrimeNG 22 | 🟡 | Vérification visuelle dès la première page composée. Le plugin ne consommant que des variables CSS générées par PrimeNG, une rupture est peu probable, et le repli consiste à déclarer les tokens directement dans `@theme` |
| **Deux tournures interdites par Python 3.14** : `asyncio.get_event_loop()` hors loop lève `RuntimeError`, et `sqlite3.version` est supprimé | 🟢 | Aucune des deux n'a de raison d'exister dans du code neuf. Les bannir dans `[tool.ruff.lint.flake8-tidy-imports.banned-api]` fait porter la garantie par la CI plutôt que par la mémoire, y compris sur du code repris de la CLI d'origine |
| **`pydantic-core` est une seconde extension native à empaqueter.** Le hook `pydantic` de `pyinstaller-hooks-contrib` couvre le cas nominal, mais aucune source ne documente le couple `pydantic-core` + interpréteur géré par uv sous PyInstaller | 🟢 | Même traitement que rapidfuzz et keyring : valider sur le binaire figé, pas seulement sur les sources. Validé par le run complet de l'installeur 0.11.0 (2026-10-21) ; un échec serait un `ImportError` au démarrage, immédiat et explicite |
| **La config Ruff de techno-scraper n'est pas transposable** si elle date d'avant la 0.16.0 : le jeu par défaut est passé de 59 à 413 règles | 🟡 | Le projet ne part pas du défaut : `sidecar/pyproject.toml` fige un `select` explicite (commentaire « Liste figee plutot que le defaut de Ruff »), pour qu'une montée de version de Ruff n'ajoute pas de règle silencieusement. Ne pas copier-coller la config d'un autre projet telle quelle, figée ou non |
| **`externalBin` ne prend qu'un exécutable**, or PyInstaller `--onedir` produit un exe plus un dossier `_internal/` | 🟡 | Déclarer l'exe suffixé en `bundle.externalBin` et le dossier en `bundle.resources` **sous forme objet** (`{ "binaries/_internal": "_internal" }`). La forme tableau le range sous `binaries/_internal/` et le sidecar meurt sur `Failed to load Python DLL`, invisible en `tauri dev`. Vérifié sur artefact, pas seulement au build |
| **release-please n'est pas documenté sur un flux `develop` → `main`.** L'outil raisonne sur une branche de vérité unique pilotée par `target-branch` | 🟢 | Confirmé au premier run (`v0.1.0`) : le squash-merge de la PR est un commit ordinaire de `main`, rien à régler. Le chaînage `needs:` est indépendant de ce point |
| **`tauri-action` n'offre aucun hook pour construire un sidecar** avant `tauri build` | 🟢 | Construire le binaire PyInstaller et le copier dans `src-tauri/binaries/` dans une étape antérieure du même job. Contrainte connue, sans contournement à inventer |
| **PyInstaller et les faux positifs antivirus** : ampleur mesurable seulement sur machine tierce | 🟢 | Le mode `--onedir` est la seule atténuation retenue, la signature de code supposant un certificat écarté par le budget nul. Mesuré le 2026-10-21 : aucun blocage chez un utilisateur réel ([PRODUCTION.md § Checklist Post-MEP](PRODUCTION.md#checklist-post-mep)). Un build qui passe en local ne prouve rien |

---

# Configuration Recommandée

## Backend

### sidecar/pyproject.toml

Métadonnées : nom `tagger`, `requires-python = ">=3.14,<3.15"`, version pilotée par release-please via `extra-files`. La borne haute existe pour que PyInstaller empaquette exactement l'interpréteur testé, pas pour exclure 3.15. Un `.python-version` à côté fige la version qu'`uv` installe et que la CI reprend, et c'est le fichier que vise la procédure de bump de [PRODUCTION.md § Composants applicatifs](PRODUCTION.md#composants-applicatifs).

**Build et uv** : `[build-system] requires = ["uv_build>=0.13.5,<0.14"]` et `[tool.uv] required-version = ">=0.13,<0.14"`, seule source de la version d'uv (uv refuse un autre minor en local, `setup-uv` la lit en CI). `test_uv_build_follows_the_required_uv_minor` garde les deux plages sur le même minor.

**Dépendances d'exécution** : `pydantic>=2.14.1,<3`, `mutagen>=1.48.1,<2`, `rapidfuzz>=3.14.6,<4`, `httpx2>=2.16.0,<3`, `keyring>=25.7.0,<26`, `sentry-sdk>=2.73.0,<3`.

**Groupe `dev`** (via `[dependency-groups]`, PEP 735) : `pytest>=9.2.0`, `pytest-asyncio>=1.4.1`, `pytest-cov>=7.1.0`, `ruff>=0.17.3`, `mypy>=2.4.1`.

**Groupe `build`** : `pyinstaller>=6.22.3`, `pyinstaller-hooks-contrib>=2026.9`.

**`[tool.ruff]`** : pas de `target-version` déclaré, Ruff le dérive de `requires-python` (l'écrire en ferait une seconde source à synchroniser). Sous `[tool.ruff.lint]`, un `select` explicite plutôt que le défaut de la 0.16.x (commentaire « Liste figee plutot que le defaut de Ruff », pour qu'une montée de version n'ajoute pas de règle silencieusement), et les règles incompatibles avec le formateur en `ignore` (`COM812` en premier lieu). Sous `[tool.ruff.lint.flake8-tidy-imports.banned-api]`, interdire `asyncio.get_event_loop` et `sqlite3.version` avec un message renvoyant à leur remplaçant.

**`[tool.mypy]`** : `strict = true` et `warn_unreachable = true`. `untyped_calls_exclude = ["mutagen"]` sort mutagen du contrôle `disallow_untyped_calls` : son `py.typed` n'annote ni ses frames ni les méthodes de ses tags (`setall`, `delall`, `add`, `update_to_v23`, `add_picture`), et chaque appel demanderait sinon un `# type: ignore[no-untyped-call]`. Une section `[[tool.mypy.overrides]]` existe pour `tagger._build_info` (`ignore_missing_imports = true`) : ce module est gravé par `build.py` au packaging puis supprimé, donc absent d'un arbre propre où Mypy ne le trouve pas. Ciblée plutôt que globale, pour que la disparition des types d'une vraie dépendance reste une erreur. Toutes les autres dépendances livrent un `py.typed`. Ajouter `plugins = ["pydantic.mypy"]`, qui donne au checker la signature réelle des `__init__` générés. `explicit_package_bases = true` et un `mypy_path` ancré sur le fichier (`$MYPY_CONFIG_FILE_DIR`) sur `src`, `tests/helpers` et `tests` : les tests ne sont pas des packages (pytest en `importlib`), et sans bases explicites deux `conftest.py` donnent le même module `conftest`, ce qui arrête Mypy.

**`[tool.pytest.ini_options]`** : `asyncio_mode = "strict"`, `pythonpath = ["tests/helpers"]` (helpers importables à plat), `addopts` portant `--cov=tagger` et `--import-mode=importlib`.

Le seuil `--cov-fail-under=80` vit dans la recette `just test` et non dans `addopts` : il mesure la couverture globale, donc dans `addopts` il ferait échouer toute exécution ciblée sur un seul fichier.

### sidecar/build.py

Commande PyInstaller en `--onedir`, avec au minimum le forçage du backend keyring (`--collect-metadata keyring`, `--hidden-import win32ctypes.pywin32.win32cred`, `--hidden-import win32ctypes.pywin32.pywintypes`) et le nommage de sortie aligné sur le target-triple attendu par Tauri.

## Frontend

### package.json

`engines.node` sur `^26.0.0`, monté avec le `runtime` de `setup-pnpm` (`test_the_ci_node_major_is_declared_in_engines` les garde). Le `^24.15.0 || ^26.0.0` prévu pour la transition n'a pas été retenu (2026-10-29) : le poste, la CI et l'image de la démo sont tous en 26, et garder la 24 déclarée n'aurait été testé nulle part. Un `>=` laisserait passer Node 25.x, hors de la plage supportée par Angular 22. Un `pnpm-workspace.yaml` est à créer même sans monorepo, pour accueillir `allowBuilds: { esbuild: true }` et les réglages que le `.npmrc` n'accepte plus depuis pnpm 11.

`devEngines.packageManager` épingle pnpm (`12.15.0`, `onFail: download`) : seule source de la version, lue par `pnpm/setup` en CI. Pas de champ `packageManager` (legacy, Corepack). Le lockfile à deux documents qui en résulte est assumé, cf. [§ Dependabot](#6-dependabot).

**Dépendances** : les paquets runtime `@angular/*` en `22.2.3` (`@angular/cli` et `@angular/build`, qui sont des devDependencies, en `22.2.5`), `primeng` en `22.1.4`, `@primeuix/themes` en `3.1.0` (**déclaration explicite obligatoire**), `@ngx-translate/core` et `@ngx-translate/http-loader` en `18.1.0`, `@fontsource-variable/inter` en `5.3.0`, `@sentry/angular` en `11.9.0`, `rxjs` en `~7.8.2`, `@tauri-apps/api` en `2.12.4`, plus les six paquets `@tauri-apps/plugin-*` aux versions du tableau (pas de paquet pour `single-instance`, aucun `plugin-fs`).

**`overrides` de `pnpm-workspace.yaml`** : aucun depuis le 2026-10-29. Le `vite` en `8.3.5` posé le 2026-10-27 est retiré, `@angular/build` 22.2.5 l'épingle lui-même (cf. § Angular).

**devDependencies** : `typescript` en `~6.0.0` (tilde, pour rester sous 6.1), `tailwindcss` et `@tailwindcss/postcss` en `4.3.3`, `tailwindcss-primeui` en `0.6.1`, `vitest` en `5.0.5`, `angular-eslint` en `22.6.0`, `eslint` en `^10.13.0`, `@eslint/js` en `^10.0.1`, `typescript-eslint` en `^8.72.1`, `eslint-config-prettier` en `^10.1.8`, `prettier` en `3.9.10`, `prettier-plugin-tailwindcss` en `0.8.1`, `@tauri-apps/cli` en `2.12.4`, `@sentry/cli` en `^3.8.2`, `jsdom` en `^30.1.3`.

> `eslint` en `^10.13.0` : la ligne 9 est marquée dépréciée sur npm, et `angular-eslint` 22.6.0 accepte `^9.0.0 || ^10.0.0` (peer lue dans `pnpm-lock.yaml`, relevé le 2026-10-29). `ng add angular-eslint` ajoute aussi `@angular-eslint/builder` et `@eslint/js`.

### .postcssrc.json

Un seul plugin, `@tailwindcss/postcss`, sans `postcss-import` ni `autoprefixer` (gérés en interne depuis la v4).

### src/styles.css

Ordre à respecter : `@import "tailwindcss";`, puis `@plugin "tailwindcss-primeui";`, puis le `@custom-variant dark` aligné sur le `darkModeSelector` passé à `providePrimeNG()`, puis `@theme` pour la `font-family` Inter. Le layer `primeng` se place après `theme` et `base`, avant `utilities`.

### .prettierrc

Option `tailwindStylesheet` pointant sur `./src/styles.css`, chemin résolu **relativement au fichier de config Prettier**, plus `plugins: ["prettier-plugin-tailwindcss"]`.

### eslint.config.js

Flat config obligatoire. Étendre `angular.configs.tsRecommended`, `angular.configs.templateRecommended` **et** `angular.configs.templateAccessibility` (ce dernier n'est pas inclus dans le premier), puis `eslint-config-prettier` en dernier.

## Partagé / Infrastructure

### src-tauri/Cargo.toml

`tauri` en `2.12.5`, `tauri-build` en `2.7.4` (build-dependency), les sept crates de plugins officiels aux versions du tableau et `tauri-plugin-prevent-default` en `6.0.1`, plus `serde_json` en `1.0.154` : `tauri::generate_context!` le référence dès que `tauri.conf.json` porte une section `plugins`. Édition 2024, `rust-version = "1.90"` : en dessous, cargo écarte en silence les crates Tauri 2.12. `test_the_tauri_crates_and_their_npm_packages_are_aligned` garde l'alignement de ces versions sur celles de `package.json`.

### src-tauri/tauri.conf.json

`build.frontendDist` sur `../dist/techno-tagger-ui/browser`, `bundle.externalBin` sur `binaries/tagger`, `bundle.resources` pour le dossier `_internal/`, `bundle.targets` sur `nsis`, `app.security.assetProtocol` avec `enable: true` et un `scope` restreint au dossier de cache, `app.security.csp` avec un `img-src` incluant `'self' asset: http://asset.localhost blob: data:`, `plugins.updater.pubkey` avec le **contenu** de la clé publique, et les dimensions de fenêtre (1280×800, min 1024×700).

### src-tauri/capabilities/default.json

Les permissions des plugins `shell`, `dialog`, `store`, `os`, `opener` et `updater` et les gestes `core:window` de la barre de titre, avec `shell:allow-spawn` restreinte au sidecar déclaré. Aucune permission `fs`. `single-instance` n'a aucune permission à déclarer.

### rust-toolchain.toml

Épingler la version en cours (1.99.1) avec les composants `clippy` et `rustfmt` et la cible `x86_64-pc-windows-msvc` dans un `rust-toolchain.toml`, qui devient alors la seule source de vérité : `rustup` en local comme `dtolnay/rust-toolchain@stable` en CI s'y conforment, et le gate cesse de bouger au gré des mises à jour d'image de runner.

### dependabot.yml

Cinq entrées `updates`, une par écosystème, déclarées explicitement : `npm` en `/` (`package.json`), `uv` en `/sidecar` (`sidecar/pyproject.toml` et `uv.lock`), `cargo` en `/src-tauri` (`src-tauri/Cargo.toml`), `github-actions` en `directories: ["/", "/.github/actions/*"]` (`.github/workflows/` et les actions composites locales), `docker` en `/demo` (`demo/Dockerfile`). Chaque bloc cible `develop`, cadence mensuelle, `groups.minor-patch` sur `update-types: [minor, patch]` pour grouper mineures et correctifs et laisser les majeures sortir isolées, `open-pull-requests-limit: 5` pour tenir le flux de PR d'uv et de Ruff.

Aucune app tierce à installer : Dependabot est intégré à GitHub. « Dependency graph » et « Dependabot alerts » restent à activer dans les réglages de sécurité, condition de fonctionnement du *dependency grapher* que Dependabot consomme.

## Post-Install / Setup

```bash
# 1. Prérequis Windows (une fois)
#    - Visual Studio Build Tools, workload "Desktop development with C++"
#    - WebView2 (préinstallé depuis Windows 10 build 1803)
rustup default stable-msvc

# 2. Sidecar Python
cd sidecar
uv python install 3.14
uv sync
uv run pytest

# 3. Webview Angular
#    Ne pas passer par corepack : il disparaît sur Node 25+
cd ..
npx get-pnpm              # installeur recommandé sous Windows ; devEngines télécharge ensuite la version épinglée
cmd //c "pnpm --version"  # Tauri passe par cmd.exe : pnpm.cmd doit s'y résoudre
pnpm install
pnpm exec ng build

# 4. Coquille Tauri (dev, sidecar déjà construit par just build-sidecar)
pnpm exec tauri dev

# 5. Build complet local : le sidecar puis l'installeur, sans signature de l'updater
#    (la clé privée ne vit que dans les secrets GitHub, cf. .claude/rules/tauri/config-bundle.md)
just build
```

## Checklist Validation Compatibilité

**Au bootstrap du sidecar**, avant de figer le contrat NDJSON ([étape 3 de l'ordre de développement](ARCHITECTURE.md#ordre-de-développement)) :

- [x] [ADR-003](adrs/003-primeng-community-license.md) rouvert et tranché à la lumière de l'archivage du dépôt PrimeNG (décision maintenue, la bascule des icônes est consignée dans ses Négatives)
- [x] Stratégie de mock d'`httpx2` arrêtée (`MockTransport` natif), première fixture écrite (`sidecar/tests/conftest.py`)
- [x] `uv sync` puis `uv run mypy --strict` passent sans `ignore_missing_imports` global (`[tool.mypy]` de `sidecar/pyproject.toml`, job `sidecar` de la CI, check requis)
- [x] `uv run ruff check` passe sur le `select` explicite figé du projet, pas sur le défaut 0.16.x ni un copier-coller d'un autre projet (job `sidecar` de la CI)
- [x] `banned-api` interdit bien `asyncio.get_event_loop` et `sqlite3.version` (sonde `ruff check` du 2026-10-23 : `TID251` signale les deux accès qualifiés)

**Au premier build PyInstaller** :

- [x] Le binaire figé lit et écrit une clé dans le Credential Manager (clé relue après relance de l'application installée, 2026-10-21, [PRODUCTION.md § Checklist Pré-MEP](PRODUCTION.md#checklist-pré-mep))
- [x] `sentry_sdk.init()` ne lève pas d'`ImportError` dans le binaire, et l'appel est protégé (`init_sentry`, self-test de l'application installée confirmé le 2026-10-19)
- [x] Pydantic valide une commande NDJSON dans le binaire figé : `pydantic-core` est la seconde extension native, après rapidfuzz (run complet de l'installeur 0.11.0, 2026-10-21)
- [x] `httpx2` établit une connexion TLS depuis le binaire, `truststore` fonctionne sous `ctypes` gelé (run complet de l'installeur 0.11.0, 2026-10-21)
- [x] Le dossier `_internal/` est complet et l'exe démarre depuis un autre répertoire (PRODUCTION.md § Checklist Pré-MEP, 2026-10-22)
- [x] PyInstaller empaquette correctement l'interpréteur installé par uv : aucune source officielle ne documente ce couple (sidecar de la 0.11.0 construit en CI après `uv sync --locked`, installé et fonctionnel, 2026-10-21)

Les faux positifs antivirus **ne se vérifient pas ici** : un binaire qui passe sur le poste qui l'a produit ne prouve rien. Cette mesure appartient à la Checklist Post-MEP de [PRODUCTION.md](PRODUCTION.md#checklist-post-mep), sur une machine tierce.

**Au premier `tauri build`** :

- [x] Le suffixe target-triple correspond exactement à `rustc --print host-tuple` (PRODUCTION.md § Checklist Pré-MEP, 2026-10-22)
- [x] `Command.sidecar()` spawn le binaire, écrit sur stdin et lit stdout (smoke test du livrable, run complet, 2026-10-21)
- [x] `capabilities/default.json` n'autorise le spawn que du sidecar (PRODUCTION.md § Checklist Pré-MEP, 2026-10-22)
- [ ] Une pochette du dossier de cache s'affiche dans la webview via `convertFileSrc()`
- [x] L'installeur NSIS s'installe (Release publiée, machine d'un utilisateur réel, 2026-10-21)
- [ ] L'installeur NSIS se désinstalle proprement
- [x] WebView2 est bien présent sur l'image du runner Windows, sa présence n'a pas pu être confirmée dans la documentation (l'application construite en CI s'ouvre, 2026-10-21)

**Au premier passage CI** :

- [x] Le flux `develop` → `main` de release-please est validé : premier run réel, tag `v0.1.0`
- [x] Le job de build est chaîné en `needs:` sur `release_created`, et **pas** sur `on: push: tags` : installeur publié sur la Release `v0.1.0`
- [x] `latest.json` est publié avec une signature valide, et un client sur la version antérieure détecte la mise à jour (2026-10-21, 0.10.0 → 0.11.0)
- [x] `pnpm/setup` est pinné sur le SHA de la v3.1.2, pas sur un tag flottant (`.github/actions/setup-pnpm`, relevé le 2026-10-27)
- [ ] Le cache pnpm fonctionne sur le runner Windows
- [x] Les workflows installent pnpm et Node par la seule action `pnpm/setup`, sans `corepack enable` ni `actions/setup-node` (relevé le 2026-10-23 dans `.github/workflows/` et `.github/actions/`)
- [ ] `pnpm install --frozen-lockfile` passe sur une PR Dependabot fraîche, sans `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`
- [ ] Le graphe de dépendances GitHub liste les dépendances d'`uv`, de `cargo` et de `github-actions` (npm : zéro attendu tant que dependabot-core#15904 est ouverte)

**Vérifications visuelles** :

- [x] Le variant `dark:` de Tailwind suit bien le `darkModeSelector` de PrimeNG (`.app-dark` dans `src/styles.css` et `src/app/app.config.ts`, aucune classe `dark:` utilisée, relevé le 2026-10-23)
- [ ] `tailwindcss-primeui` expose les tokens attendus sur `@primeuix/themes` 3.1.0
- [ ] La table à scroll virtuel tient 100 lignes sans dégradation à 1024×700
- [ ] À chaque montée de PrimeNG, un détail déplié dans la liste du run reste visible en défilant dans les deux sens, sans ligne vide découverte (cf. § PrimeNG, scroll virtuel de `p-table`)

## Montées Bloquées (état au 2026-10-29)

Mises à jour majeures écartées par une incompatibilité prouvée, ou identifiées et non tentées.

| Paquet | Actuel | Disponible | Blocage | Levée attendue |
|---|---|---|---|---|
| TypeScript | `6.0.3` | `7.0.2` | `@angular/compiler-cli` 22.2.3 et `typescript-eslint` 8.72.1 déclarent `typescript: <6.1`, et TS 7.0 n'a pas d'API programmatique (angular/angular#69704 fermée `not planned`, revérifié le 2026-10-29 : `@angular/compiler-cli` 22.2.3 et `typescript-eslint` 8.72.1 déclarent toujours `<6.1`) | TS 7.1 stable avec son API (beta publiée le 2026-10-20), puis Angular et typescript-eslint déclarant TS 7 dans leurs `peerDependencies` |
| Python | `3.14.10` | `3.15` | Aucun blocage technique identifié : décision du projet de rester en 3.14, `requires-python >=3.14,<3.15` (relevé le 2026-10-29) | À définir |

---

# Recommandation Finale

**Verdict : la stack est cohérente et production-ready.** Les trois écosystèmes s'alignent sans conflit de versions, tous les couples critiques sont vérifiés, et les points durs ont chacun une issue identifiée. Aucun sujet n'appelle une décision plutôt qu'une ligne de configuration : l'[ADR-007](adrs/007-client-http-httpx2.md) tient, le manque d'outillage de mock d'`httpx2` étant tranché par le `MockTransport` natif.

## Points Critiques

1. **L'écosystème PrimeNG est entièrement sous licence PrimeUI, icônes comprises.** L'[ADR-003](adrs/003-primeng-community-license.md) a instruit l'archivage du dépôt et la Community License pour les composants, mais pas le fait que `@primeicons/angular` suive la même bascule. La décision tient, sa section Négatives le consigne.
2. **`httpx2` n'a pas d'outillage de test tiers.** Ni `respx` ni `pytest-httpx` ne le supportent. Le `MockTransport` natif règle le problème pour quelques dizaines de lignes de fixtures (`sidecar/tests/helpers/scraper_responses.py`).
3. **`keyring` sous PyInstaller est le point de rupture le plus probable du build.** La découverte par entry points échoue dans un binaire figé, et l'erreur ne survient qu'au runtime chez l'utilisateur. Forçage explicite du backend, plus un test de fumée sur le binaire.
4. **TypeScript est verrouillé sur la ligne 6.0** par Angular 22. TS 7 casse le build et le lint simultanément : ce n'est pas un arbitrage de performance mais un blocage à respecter jusqu'à TS 7.1.
5. **Les alertes de sécurité npm de GitHub ne sont pas fiables sur ce dépôt** tant que dependabot-core#15904 est ouverte : le lockfile à deux documents, produit par le pin `devEngines.packageManager` retenu le 2026-10-15, n'est lu qu'en partie par le graphe de dépendances. La veille CVE npm passe par `just audit-ui` en CI, à lire à chaque release ([PRODUCTION.md § Dépendances](PRODUCTION.md#dépendances)).

## ROI / Avantages

1. **Le facteur limitant est extérieur au projet.** Le débit vient de techno-scraper, pas de la machine : aucune des versions retenues n'est choisie pour la performance, ce qui simplifie tous les arbitrages.
2. **Aucune dépendance ne manque de types.** Les six bibliothèques Python livrent un `py.typed`, le gate Mypy strict s'installe sans un seul `ignore_missing_imports` (seul mutagen, dont les frames et les méthodes de tags ne sont pas annotées, demande l'exclusion `untyped_calls_exclude`), et le contrat NDJSON est typable de bout en bout dès le premier jour.
3. **Le coût de packaging est en grande partie payé par les outils.** `sentry-sdk` et `pydantic` reçoivent leur hook de `pyinstaller-hooks-contrib`, mutagen n'en a pas besoin, `pywin32-ctypes` évite une extension compilée. Deux gestes explicites restent : le forçage du backend keyring et `collect_submodules("rapidfuzz")` dans `sidecar/tagger.spec`, aucun hook ne couvrant RapidFuzz.
4. **La chaîne CI/CD ne coûte rien.** Dépôt public, runners standard, GitHub Releases pour la distribution et l'updater : la contrainte de budget nul d'[ARCHITECTURE.md](ARCHITECTURE.md#enjeux--contraintes) est tenue sans compromis, y compris sur les runners Windows.
5. **Les trois zones sont indépendantes.** Un bump côté Angular ne touche pas le sidecar, un bump Python ne touche pas la webview, et les majeures isolées par Dependabot mettent d'office en quarantaine les mises à jour à risque.

---

# 🔗 Ressources

## Documentation Officielle

- [Angular : Releases et versions supportées](https://angular.dev/reference/versions)
- [Python : Calendrier des versions](https://devguide.python.org/versions/)
- [Tauri v2](https://v2.tauri.app/)
- [PrimeNG : Guide de migration v22](https://primeng.dev/migration/v22)
- [Tailwind CSS : Guide de mise à niveau v4](https://tailwindcss.com/docs/upgrade-guide)
- [PyInstaller : Changelog](https://pyinstaller.org/en/stable/CHANGES.html)
- [uv : Politique de versionnement](https://docs.astral.sh/uv/reference/policies/versioning/)
- [Ruff : Documentation](https://docs.astral.sh/ruff/)
- [Mypy : Changelog](https://mypy.readthedocs.io/en/stable/changelog.html)
- [Pydantic : Documentation](https://pydantic.dev/docs/validation/latest/)
- [Node.js : Versions précédentes et calendrier LTS](https://nodejs.org/en/about/previous-releases)
- [Rust : Notes de version](https://doc.rust-lang.org/releases.html)

## Ressources Complémentaires

- [Tauri v2 : Sidecar (binaires embarqués)](https://v2.tauri.app/develop/sidecar/)
- [Tauri v2 : Capabilities et permissions](https://v2.tauri.app/security/capabilities/)
- [Tauri v2 : Plugin updater](https://v2.tauri.app/plugin/updater/)
- [ngx-translate : Guide de migration](https://ngx-translate.org/getting-started/migration-guide/)
- [Sentry : Migration Python 1.x vers 2.x](https://docs.sentry.io/platforms/python/migration/1.x-to-2.x/)
- [Sentry : Données collectées par le SDK Python](https://docs.sentry.io/platforms/python/data-collected/)
- [GitHub Actions : Déclenchement d'un workflow (limite du GITHUB_TOKEN)](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
- [release-please : Configuration du manifeste](https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md)
- [pnpm 11 : Notes de version](https://pnpm.io/blog/releases/11.0)
- [pnpm 12 : Notes de version](https://pnpm.io/blog/releases/12.0)
- [pnpm 12 : Ce qui change](https://pnpm.io/blog/whats-different-in-pnpm-12)
- [pnpm : Format du fichier de lock (conditions du multi-document)](https://pnpm.io/lockfile)
- [pnpm : Intégration continue](https://pnpm.io/continuous-integration)
- [Dependabot : options de configuration](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference) : `package-ecosystem`, `directory`, `directories`, `groups`
- [Dependabot : écosystèmes et dépôts pris en charge](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories)
- [Dependabot : support de l'écosystème uv (disponibilité générale, 2025-03-13)](https://github.blog/changelog/2025-03-13-dependabot-version-updates-now-support-uv-in-general-availability/)
- [httpx2 : Documentation](https://httpx2.pydantic.dev/)
- [mutagen : Guide ID3](https://mutagen.readthedocs.io/en/latest/user/id3.html)
- [angular-eslint : Dépôt et configuration](https://github.com/angular-eslint/angular-eslint)
