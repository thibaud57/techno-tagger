---
title: "VERSIONS - Matrice de compatibilité (Fullstack)"
description: "Versions des dépendances du sidecar Python, de la webview Angular et de la coquille Tauri, compatibilité croisée, configuration et migration."
date: "2026-10-29"
keywords: ["versions", "dependencies", "compatibility", "setup", "migration", "fullstack", "tauri", "angular", "python"]
scope: ["docs", "config", "setup"]
technologies: ["Python", "Angular", "Tauri", "Rust"]
---

> **Périmètre : ce que le dépôt déclare.** Les versions installées sont lues dans les **lockfiles** (`sidecar/uv.lock`, `pnpm-lock.yaml`, `src-tauri/Cargo.lock`), jamais dans les plages des manifestes, et dans les fichiers qui épinglent des outils et des images : `rust-toolchain.toml`, `Justfile`, `.github/workflows/`, `.github/actions/`, `demo/Dockerfile`. Relevé le **2026-10-29**. Les dernières versions publiées (npm, PyPI, crates.io, GitHub, Docker Hub, endoflife.date) ont été recontrôlées le 2026-10-27 ; les constats gardent la date de leur relevé. Les technos Post-MVP (PydanticAI, WebdriverIO + `tauri-driver`) sont hors périmètre : elles seront documentées le jour où elles entrent dans un fichier de dépendances.

> **La plateforme d'hébergement est hors périmètre.** Le VPS, Docker Engine et Dokploy, qui hébergent la démo web, ne sont déclarés par aucun fichier versionné : voir [PRODUCTION.md § Plateforme d'hébergement](PRODUCTION.md#plateforme-dhébergement), [§ Liste Environnements](PRODUCTION.md#liste-environnements) et [§ Mise en place de la démo](PRODUCTION.md#mise-en-place-de-la-démo).

> **Trois écosystèmes, trois gestionnaires de paquets.** `sidecar/` en uv, `src/` en pnpm, `src-tauri/` en cargo, sans workspace transverse (cf. [ARCHITECTURE.md § Package Manager](ARCHITECTURE.md#package-manager)). « Partagé / Infrastructure » couvre la coquille Tauri et la chaîne CI/CD.

> **Politique de version : la dernière stable, toujours.** Une version antérieure ne se retient que sur une incompatibilité dure, documentée dans [Conflits Potentiels](#conflits-potentiels) ou [Montées Bloquées](#montées-bloquées-état-au-2026-10-29), qu'aucune ligne de configuration ne contourne. Une rupture qui se règle par une règle de lint, un réglage ou une tournure à éviter se mécanise et on avance. Deux écarts par choix, expliqués dans leur fiche : **TypeScript**, bloqué en 6.0.x par Angular 22, et **Python**, tenu en 3.14.x malgré la 3.15 (décision du projet, `requires-python >=3.14,<3.15`). Node suit la ligne LTS.

---

# Vue d'ensemble

## Backend

Zone `sidecar/`, gestionnaire **uv**, fichiers `sidecar/pyproject.toml` + `sidecar/uv.lock`.

| Technologie | Version Recommandée | Statut Production | Notes Critiques |
|-------------|-------------------|-----------------|----------------|
| Python | `3.14.10` | ✅ | Publiée le 2026-10-25, épinglée par `sidecar/.python-version`. Wheels `cp314` Windows pour rapidfuzz et `pydantic-core`, supportée par PyInstaller depuis 6.15.0. Support jusqu'en 2030-10 |
| uv | `0.13.6` | ✅ | Minor figé par `required-version` de `sidecar/pyproject.toml`, que `setup-uv` lit en CI (patch flottant dans le minor) |
| Pydantic | `2.14.1` | ✅ | Modèles du protocole NDJSON. `pydantic-core` est une extension native : hook livré par `pyinstaller-hooks-contrib` |
| mutagen | `1.48.1` | ⚠️ | Projet peu actif (2 ans 9 mois entre 1.47.0 et 1.48.0). Piège `EasyID3` + `v2_version=3` sur TDRC/TYER |
| RapidFuzz | `3.14.6` | ⚠️ | **Aucun hook PyInstaller ne le couvre**, ni le paquet ni `pyinstaller-hooks-contrib` |
| httpx2 | `2.16.0` | ⚠️ | Fork de `httpx` par Pydantic Services. Import `httpx2`, pas `httpx`. **Aucun mock (`respx`, `pytest-httpx`) ne le supporte encore** |
| keyring | `25.7.0` | ⚠️ | Backends chargés par entry points : casse sous PyInstaller sans forçage explicite du backend |
| sentry-sdk | `2.73.0` | ✅ | Intégrations chargées par `importlib` : le hook `pyinstaller-hooks-contrib` est indispensable |
| PyInstaller | `6.22.3` | ✅ | Ne cross-compile pas, runner Windows obligatoire |
| pyinstaller-hooks-contrib | `2026.9` | ✅ | Hooks `sentry_sdk` et `pydantic` |
| pytest | `9.2.0` | ✅ | `filterwarnings = error` appliqué dès `pytest_configure` : `asyncio_default_fixture_loop_scope` posé explicitement (relevé le 2026-10-29) |
| pytest-asyncio | `1.4.1` | ✅ | Fixture `event_loop` supprimée en 1.0, `event_loop_policy` dépréciée en 1.4 |
| pytest-cov | `7.1.0` | ✅ | Corrige un calcul de total qui faussait `--cov-fail-under` |
| Ruff | `0.17.3` | ⚠️ | La 0.16.0 fait passer le jeu par défaut de 59 à 413 règles : une config copiée d'un projet antérieur produira un diff massif. Voir § Ruff et Mypy |
| Mypy | `2.4.1` | ✅ | Toutes les dépendances livrent un `py.typed`, aucun paquet `types-*` requis (cf. § Ruff et Mypy) |

## Frontend

Zone `src/`, gestionnaire **pnpm**, fichiers `package.json` + `pnpm-lock.yaml`.

| Technologie | Version Recommandée | Statut Production | Notes Critiques |
|-------------|-------------------|-----------------|----------------|
| Angular | `22.2.3` | ✅ | `@angular/cli` et `@angular/build` suivent leur propre cadence de patch, en `22.2.5` au relevé du 2026-10-29 |
| TypeScript | `6.0.3` | ✅ | Contrainte dure d'Angular 22 : `>=6.0.0 <6.1.0`. **TS 7 (tsgo) casse `compiler-cli` et `typescript-eslint`**. `noUncheckedIndexedAccess` activé le 2026-09-06 : zéro erreur sur la base existante |
| Node.js | `26.13.0` (Active LTS depuis le 2026-10-28) | ✅ | Épinglé par `devEngines.runtime` (`onFail: download`), lu par pnpm en local et par `pnpm/setup` en CI. Montée manuelle : Dependabot ne la propose pas (dependabot-core#13722, relevé le 2026-10-29) |
| pnpm | `12.15.0` | ✅ | Réécriture Rust, sous le dist-tag `latest` depuis le 2026-10-21. Épinglé par `devEngines.packageManager` (`onFail: download`), lockfile à deux documents depuis le 2026-10-15, cf. § Dependabot |
| PrimeNG | `22.1.4` | ❌ | Licence PrimeUI avec clé obligatoire même en Community. Le dépôt public ne porte plus que la lignée MIT 21.x. Voir [Conflits Potentiels](#conflits-potentiels) |
| @primeuix/themes | `3.1.0` | ⚠️ | **Pas une dépendance transitive de PrimeNG**, à déclarer explicitement. Base rem passée de 14px à 16px |
| PrimeIcons | `@primeicons/angular 8.0.2` | ❌ | Dépendance directe de PrimeNG 22, **à déclarer quand même** : pnpm isole, une transitive n'est pas importable depuis `src/`. Le paquet CSS `primeicons` s'arrête à 7.0.0 pour le MIT, la 8.0.0 est sous licence PrimeUI. Voir § PrimeNG et PrimeIcons |
| Angular CDK | `@angular/cdk 22.2.4` | ✅ | **peerDependency de PrimeNG 22**, jamais installée seule : son absence ne se voit qu'au premier composant qui en dépend |
| Tailwind CSS | `4.3.3` | ✅ | Config CSS-first, ne compile ni SCSS ni LESS. `@tailwindcss/postcss` aligné (même monorepo) |
| tailwindcss-primeui | `0.6.1` | ⚠️ | Aucune publication depuis mars 2025, donc antérieure à PrimeNG 22 et à Tailwind 4.3 |
| @fontsource-variable/inter | `5.3.0` | ✅ | SIL OFL, aucun CDN, `@import "@fontsource-variable/inter/wght.css"` en tête de `src/styles.css`, aucune entrée `angular.json` |
| @ngx-translate/core, http-loader | `18.1.0` | ✅ | Publiées le 2026-10-27 (additives, aucune rupture dans les notes de version), adoptées le 2026-10-29 |
| @tauri-apps/api | `2.12.4` | ✅ | Même mineure que la crate `tauri` : `tauri build` et `test_main.py` contrôlent l'accord des paquets npm et des crates |
| @sentry/angular | `11.9.0` | ⚠️ | `dataCollection` absent collecte tout, IP comprise : chaque catégorie est fermée explicitement |
| @sentry/cli | `3.8.2` | ✅ | Script `sourcemaps` de `package.json` : upload des source maps `hidden` puis suppression de `dist/` |
| rxjs | `7.8.2` | ✅ | Réservé aux flux dans le temps (événements NDJSON, navigation), exposés aux composants en signals par `toSignal()` |
| tslib | `2.8.1` | ✅ | Requis par Angular (peer `^2.3.0` d'`@angular/build`), version lue dans `pnpm-lock.yaml` (relevé le 2026-10-29) |
| jsdom | `30.1.3` | ✅ | Environnement par défaut de Vitest sous `@angular/build:unit-test`. Plancher Node `^24.15.0 \|\| >=26.0.0` depuis la 30.0.0 |
| Vitest | `5.0.5` | ✅ | Runner par défaut du CLI Angular 22, accepté en 5.x par `@angular/build` depuis 22.2.0. `clearMocks` à `true` par défaut |
| angular-eslint | `22.6.0` | ✅ | ESLint 9+ en flat config uniquement. Règles d'accessibilité hors du preset `recommended`. `@eslint/js` `10.0.1` (peer `eslint ^10.0.0`, relevé le 2026-10-29) ajouté par `ng add angular-eslint` |
| Prettier | `3.9.10` | ✅ | Parser Angular embarqué : `@angular/compiler` 22.0.6 (lu dans `node_modules/prettier/plugins/angular.js`, relevé le 2026-10-29), contre 22.2.3 pour le build. `semi: false` depuis le 2026-09-06, aligné sur le portfolio |
| prettier-plugin-tailwindcss | `0.8.1` | ✅ | Exige Prettier ≥ 3.7.x et l'option `tailwindStylesheet` en Tailwind v4 |

## Partagé / Infrastructure

Zone `src-tauri/` (cargo) et `.github/` (CI/CD).

| Technologie | Version Recommandée | Statut Production | Notes Critiques |
|-------------|-------------------|-----------------|----------------|
| tauri (crate) | `2.12.5` | ✅ | MSRV 1.90 depuis la 2.12, comme toutes les crates Tauri. Même mineure que `@tauri-apps/api` |
| tauri-build (crate) | `2.7.4` | ✅ | MSRV 1.90, reporté dans le `rust-version` de `src-tauri/Cargo.toml` |
| @tauri-apps/cli | `2.12.4` | ✅ | Refuse au build un paquet npm et une crate de mineures différentes |
| Plugins Tauri v2 | voir [§ Plugins](#2-plugins-officiels-tauri-v2) | ✅ | Versions crate et npm strictement alignées plugin par plugin, gardées en CI par `test_the_tauri_crates_and_their_npm_packages_are_aligned` (`sidecar/tests/unit/test_main.py`) |
| Rust | `1.99.1` (stable) | ✅ | Édition 2024. Les images Windows Server 2025 du 2026-10-21 (`win25/20261021.299`, `win25-vs2026/20261021.278`) livrent la 1.99.1 ; `rustup` installe de toute façon la 1.99.1 épinglée |
| just | `1.58.0` (plancher) | ✅ | Plancher `set minimum-version := "1.58.0"` du `Justfile`, lu par `extractions/setup-just` : la CI installe ce plancher. Le poste est en 1.59.0 (`just --version`, relevé le 2026-10-29) |
| GitHub Actions | voir [§ CI/CD](#4-github-actions) | ✅ | Images figées `windows-2025` (Visual Studio 2026) et `ubuntu-24.04`, jamais de label `-latest` |
| release-please-action | `5.0.0` | ⚠️ | Le tag créé avec `GITHUB_TOKEN` ne déclenche aucun workflow. Chaînage `needs:` obligatoire |
| Dependabot | app GitHub intégrée, version non épinglée par le dépôt | ✅ | PR de mise à jour fonctionnelles ; alertes de sécurité npm non fiables sur le lockfile à deux documents, `just audit-ui` en CI prend le relais (cf. [§ Dependabot](#6-dependabot)) |
| pnpm/setup (action) | `3.1.2` | ✅ | Installe pnpm **et** Node en une étape. Exige pnpm 11+. La v3 lit `devEngines.runtime` pour Node, sans input `runtime` |
| nginx/nginx-unprivileged (image) | `1.31.8-alpine` | ✅ | Image de service de la démo web (`demo/Dockerfile`), non-root (UID 101), écoute sur 8080 (cf. [§ Images Docker de la démo](#7-images-docker-de-la-démo)) |
| node (image) | `26.13.0-slim` | ✅ | Étape de build de l'image de la démo. Version égale à `devEngines.runtime`, gardée par `test_demo_image_coherence.py` |

---

---

# Détails par Technologie

Seules les technologies avec un piège, un arbitrage ou une montée à surveiller ont une section : les autres tiennent dans leur ligne de tableau.

## Backend

### 1. Python
**Version actuelle** : `3.14.10` (2026-10-25, endoflife.date, relevé le 2026-10-27)
**Stabilité** : ✅

**Breaking Changes Majeurs** (les deux premiers sont bannis par le lint) :
- `asyncio.get_event_loop()` lève `RuntimeError` hors loop : `asyncio.run(main())` en point d'entrée, `asyncio.get_running_loop()` sinon
- `sqlite3.version` et `sqlite3.version_info` supprimés : `sqlite3.sqlite_version` pour journaliser le moteur, utile au diagnostic d'un dump VLC (cf. [ADR-019](adrs/019-resilience-schema-vlc-media-db.md))
- Placeholders nommés avec une séquence de paramètres : `ProgrammingError`. `?` avec un tuple, ou `:nom` avec un dict, jamais mêlés (couvert par les tests de parsing VLC)

**Pièges** : uv livre le CPython 3.14.10 depuis 0.13.5, mais fait de la 3.15 son défaut sans pin : neutralisé par `sidecar/.python-version` et `requires-python`.

**Recommandation** : ✅ **3.14.10**, support jusqu'en **2030-10** : la procédure lourde de bump du runtime (rebuild PyInstaller plus retest des faux positifs antivirus, cf. [PRODUCTION.md § Composants applicatifs](PRODUCTION.md#composants-applicatifs)) recule d'un an. La 3.15 attend la maturité de l'écosystème (décision du projet : vers la 3.15.2), cf. [Montées Bloquées](#montées-bloquées-état-au-2026-10-29). `asyncio.get_event_loop` et `sqlite3.version` sont en `banned-api` (`TID251`, sonde du 2026-10-23), y compris pour du code copié de la CLI d'origine.

### 2. uv
**Version actuelle** : `0.13.6` (2026-10-27). Le dépôt ne fige que le minor, le patch flotte
**Stabilité** : ✅

**Breaking Changes Majeurs** :
- **0.12.16** : le backend `uv_build` embarqué ne sert que si sa version satisfait les pins actifs. Un uv plus ancien que le plancher de `[build-system]` retélécharge le backend à chaque build, ce que produisait la plage `>=0.12.19` face à l'uv `0.12.16` de la CI (corrigé le 2026-10-09 en alignant les deux sur `0.12.24`)
- **0.13.0** : Python 3.15 devient le défaut sans configuration (cf. § Python), et le plancher `uv_build` doit inclure 0.13

**Compatibilité Écosystème** : le minor porte les breaking changes et le format `uv.lock` fait partie de l'API publique, donc figer le minor suffit. **PyInstaller + interpréteur géré par uv** : ✅ validé sur le binaire du bootstrap puis par le build CI de la 0.11.0 après `uv sync --locked` ([PRODUCTION.md § Checklist Distribution](PRODUCTION.md#checklist-distribution), 2026-10-21), aucune source officielle ne documente ce couple.

**Recommandation** : ✅ `sidecar/pyproject.toml` est la seule source de la version d'uv (`setup-uv` sans `version`, `version-file: sidecar/pyproject.toml`). Au minor suivant, monter `required-version` et `uv_build` ensemble, `test_main.py` garde leur alignement. Même schéma que pnpm.

### 3. Pydantic
**Version actuelle** : `2.14.1` (2026-10-11), `pydantic-core 2.50.1`
**Stabilité** : ✅

**Breaking Changes Majeurs** :
- **2.12** : première compatibilité Python 3.14 (« Pydantic V1 is not compatible with Python 3.14 and greater »), d'où la borne basse du projet
- **2.14** : `model_config` n'est plus muté après la définition de la classe (#13825), `ser_json_timedelta` ne s'applique plus aux autres types date (#13892). Validé le 2026-10-09 par la suite du sidecar

**Pièges** : `pydantic-core` est la seconde extension native après rapidfuzz, donc à vérifier au build PyInstaller. Le hook `pydantic` de `pyinstaller-hooks-contrib` existe (PR #611), mais le couple avec l'interpréteur géré par uv n'est documenté nulle part : validé sur le binaire figé de la 0.11.0 (2026-10-21). Un échec serait un `ImportError` immédiat au démarrage.

**Recommandation** : ✅ borné `>=2.14.1,<3` (cf. [ADR-022](adrs/022-modeles-pydantic-du-protocole.md)). PydanticAI (Post-MVP, [ADR-008](adrs/008-matching-rapidfuzz-et-agent-ia.md)) repose sur la même définition de modèles.

### 4. mutagen
**Version actuelle** : `1.48.1` (2026-06-25)
**Stabilité** : ⚠️

**Breaking Changes Majeurs** :
- **1.48.0** : attribut `salt` sur `APIC`, qui change la `HashKey` des frames en `APIC:<desc><salt>`
- **1.48.1** : annule une régression de 1.48.0 qui dupliquait les frames `COMM` écrites depuis `EasyID3`

**Pièges** :
- Pur Python, sans hook PyInstaller ni besoin d'en avoir : c'est l'argument de l'[ADR-011](adrs/011-politique-ecriture-tags.md) contre pytaglib
- **WAV** : seul le chunk ID3v2 est supporté, écrit en minuscules (`id3 `, la lecture mutagen est insensible à la casse). Rekordbox l'ignore quelle que soit sa casse et ne lit que le RIFF INFO, que mutagen n'écrit pas (relevé le 2026-10-23, [knowledges/rekordbox.md](knowledges/rekordbox.md)) : ce volet est à la charge du projet (Post-MVP « Compatibilité des tags avec les logiciels DJ » du BRAINSTORM)
- **ID3v2.3** : `save(v2_version=3)` ne convertit ni `TDRC` ni `TDOR` : sans `update_to_v23()` préalable ils restent sur le disque sous un en-tête v2.3 (constaté le 2026-10-06 sur 1.48.1). Le projet écrit une seule chaîne par champ (`v23_sep` inutile) et aucun `TDOR` : seul un `TDOR` déjà présent est converti en `TORY`
- `EasyID3` combiné à `v2_version=3` a produit une frame `TDRC` v2.4 vide en plus du `TYER` v2.3 attendu (issue #188, fermée sans correctif vérifiable) : asserter sur le contenu réel du fichier, pas sur le retour de l'API ([ARCHITECTURE.md § Stratégie de Tests](ARCHITECTURE.md#stratégie-de-tests))

### 5. RapidFuzz
**Version actuelle** : `3.14.6` (2026-08-30)
**Stabilité** : ✅

**Pièges** : **aucun hook PyInstaller ne couvre rapidfuzz**, contrairement à ce que laisse croire son entry point `pyinstaller40` : celui-ci s'appelle `tests` et pointe `get_PyInstaller_tests`, qui fournit des tests à PyInstaller et non un hook. Vérifié dans le venv du projet en 3.14.5 (`rapidfuzz/__pyinstaller/` ne contient que `__init__.py` et un test, pas de `hook-rapidfuzz.py` dans `pyinstaller-hooks-contrib`). Les cibles SIMD (`avx2`/`sse2`, issue #391) se chargent dynamiquement : le `.spec` déclare `collect_submodules("rapidfuzz")` et le scoring se teste sur le binaire figé.

**Recommandation** : ✅ `WRatio` reste le défaut tout-usage, mais `token_set_ratio` tolère mieux les mots surnuméraires (`Live`, `Remastered`, `feat.`) courants sur Beatport. `score_cutoff` court-circuite le calcul : y passer le plancher du projet.

### 6. httpx2
**Version actuelle** : `2.16.0` (2026-10-21)
**Stabilité** : ⚠️

Fork de `httpx` piloté par **Pydantic Services Inc.**, documenté sur `httpx2.pydantic.dev` ; l'[ADR-007](adrs/007-client-http-httpx2.md) tient. `httpx` d'origine n'a plus publié depuis `0.28.1` (2024-12-06), son mainteneur a fermé issues et discussions le 2026-02-27.

**Breaking Changes Majeurs** (par rapport à `httpx`) :
- **Import renommé** : `import httpx2`, pas un drop-in silencieux malgré une API identique
- **SSL** : `truststore` (trust store natif de l'OS) par défaut au lieu de `certifi`

**Pièges** :
- `Limits(max_connections=...)` et `Timeout(..., connect=...)` ont la signature de `httpx` : le pool borné à 3/2 et le timeout client de l'[ADR-017](adrs/017-taille-pool-concurrence.md), fixé **au-dessus** du budget de 90 secondes de l'API pour recevoir son `504` structuré, se transposent tels quels. Deux sources aux sémaphores distincts imposent **deux instances de client**
- **PyInstaller** : `truststore` évite de bundler `certifi/cacert.pem` mais introduit des appels `ctypes` vers l'API Windows dans un binaire figé. Validé par le run complet de l'installeur de la 0.11.0, qui interroge l'API en TLS (2026-10-21)
- **Mocking** : voir [Conflits Potentiels](#conflits-potentiels)

### 7. keyring
**Version actuelle** : `25.7.0` (2025-11-16)
**Stabilité** : ⚠️

**Pièges** :
- Les backends sont découverts exclusivement par entry points depuis la 12.0.0, cause racine des problèmes d'empaquetage : voir [Conflits Potentiels](#conflits-potentiels)
- `WinVaultKeyring` reste le backend Windows par défaut. La dépendance est **`pywin32-ctypes>=0.2.0`**, pas `pywin32` : pur Python via `ctypes`, sans extension compilée, un avantage net pour PyInstaller
- `CRED_MAX_CREDENTIAL_BLOB_SIZE` vaut 2560 octets : un `X-API-Key` de `secrets.token_urlsafe(32)` en est très loin, mais dépasser produit l'erreur cryptique `CredWrite ... (1783, "The stub received bad data")`

**Recommandation** : ⚠️ Le risque est l'empaquetage, pas la version. Le test de sécurité (« la clé API n'apparaît ni dans les logs, ni dans les rapports, ni dans les payloads Sentry ») est doublé d'un **test de fumée sur le binaire figé**, fait le 2026-10-21 (clé relue après relance de l'application installée).

### 8. sentry-sdk
**Version actuelle** : `2.73.0` (2026-10-22)
**Stabilité** : ✅

**Breaking Changes Majeurs** :
- **2.70.0** : `data_collection` promue en option de premier niveau, successeur annoncé de `send_default_pii`. Dès qu'elle est posée, `include_local_variables` et `include_source_context` ne sont plus lus et une catégorie omise est collectée (lu dans `data_collection.py` et `utils.py` de 2.71.0 le 2026-10-15). Une catégorie `mcp` est en préparation (getsentry/sentry-python#7750, ouverte au 2026-10-15)
- **2.70.0** : `data_collection` posée, le SDK n'installe plus son `EventScrubber` par défaut (`client.py`, lu en 2.71.0 le 2026-10-16) : le denylist (`api_key`, `secret`, `token`, `password`...) ne s'applique plus aux champs libres. Aucune donnée sensible dans `set_extra`, `set_context` ni `set_tag`, et pas de rappel manuel de `EventScrubber` dans `_scrub`
- **2.71.0** : les notes annoncent « Keep event if processor raises », mais `before_send` se comporte comme en 2.70.0 : s'il lève, l'événement est jeté (lu dans `_Client._prepare_event` des deux versions le 2026-10-02). Le `_scrub` du sidecar reste un filet fermé

**Pièges** (réglages de durcissement d'[ARCHITECTURE.md § Monitoring](ARCHITECTURE.md#monitoring), vérifiés dans le code du SDK) :
- `data_collection` : posée, toute catégorie omise vaut collecte, `stack_frame_variables` compris (`_resolve_explicit` : `d.get("stack_frame_variables", True)`)
- `server_name` : `None`, **mais** repli automatique sur le hostname (`client.py`)
- `LoggingIntegration` est active par défaut (`level=INFO`) : tout log INFO devient un breadcrumb attaché au prochain événement, chemin complet ou titre de morceau compris. `level=None` coupe les breadcrumbs
- `ArgvIntegration` (défaut hors web) capture `sys.argv` et est à désactiver. `AsyncioIntegration` n'est **pas** dans les défauts
- Plan Developer gratuit : 5 000 erreurs par mois, rétention 30 jours, un seul utilisateur ; au-delà du quota, les événements sont refusés

**Recommandation** : ✅ Tester sur l'enveloppe réellement construite : variables de frame absentes, `server_name` fixe, `data_collection` résolu entièrement fermé (`sidecar/tests/unit/core/test_sentry_payload.py`).

### 9. PyInstaller
**Version actuelle** : `6.22.3` (2026-09-12)
**Stabilité** : ✅

**Pièges** :
- « It is not a cross-compiler; to make a Windows app you run PyInstaller on Windows »
- **Hooks livrés par `pyinstaller-hooks-contrib`** : `hook-sentry_sdk.py`, `pydantic` (PR #611), `hook-certifi.py`. Aucun hook pour mutagen ou httpx ; keyring est couvert par `hook-keyring.py` de PyInstaller ; RapidFuzz ne l'est par aucun
- **Licence** : GPL 2.0+ avec exception explicite sur le bootloader (« unlimited permission to link or embed compiled bootloader […] and to distribute those combinations without any restriction ») : le binaire distribué peut rester sous la licence du projet
- **`--onedir` plutôt que `--onefile`** ([ARCHITECTURE.md](ARCHITECTURE.md#arborescence)) : démarre plus vite, et évite le dossier `_MEI_xxxxxx_` qui n'est pas supprimé si le programme plante, soit des dossiers temporaires qui s'accumulent chez l'utilisateur à chaque crash du sidecar. `--contents-directory '.'` donne un layout plat si `_internal/` gêne
- **Faux positifs antivirus** : pas de signature de code (certificat écarté au vu du budget nul, [PRODUCTION.md § Code Signing](PRODUCTION.md#code-signing)). Atténuation retenue : `--onedir`, qui évite l'extraction en dossier temporaire déclenchant les heuristiques. Un build qui passe en local ne prouve rien ; mesuré le 2026-10-21 : aucun blocage ni quarantaine chez un utilisateur réel ([PRODUCTION.md § Checklist Post-MEP](PRODUCTION.md#checklist-post-mep))

### 10. Ruff et Mypy
**Version actuelle** : `ruff 0.17.3` (2026-10-27), `mypy 2.4.1` (relevé le 2026-10-29)
**Stabilité** : ⚠️ pour Ruff (par le volume du changement de défauts), ✅ pour Mypy

**Breaking Changes Majeurs** :
- **Ruff 0.16.0** (2026-07-23) : le jeu de règles par défaut passe de 59 à 413. `ruff format` formate aussi les blocs Python des fichiers Markdown (d'où `extend-exclude = ["*.md"]`)
- **Ruff 0.17.0** : stabilise `RUF071`, qui s'applique ici (`RUF` sélectionné) sans violation sur la base
- **Mypy 2.4** : le parser natif devient le défaut ; `native_parser = false` rétablit l'ancien, dont le retrait est annoncé début 2027. Un commentaire `# type:` sur un `for` ou un `with` est ignoré sans erreur

**Pièges** :
- Le formateur ne trie pas les imports : `ruff check --select I --fix` puis `ruff format`, dans cet ordre
- Règles incompatibles avec `ruff format`, à exclure : `W191`, `E111`, `E114`, `E117`, `D203`, `D206`, `D300`, `Q000` à `Q004`, `COM812` (le cas classique qui casse), `COM819`, `ISC002`
- Mypy `strict = true` n'active pas `warn_unreachable`. Aucun paquet `types-*` ni `ignore_missing_imports` : toutes les dépendances livrent un `py.typed`

**Recommandation** : ⚠️ Figer un `select` explicite plutôt que d'hériter du défaut, une montée pouvant sinon ajouter une règle en silence, et ne pas déclarer `target-version` (cf. [`.claude/rules/ruff/lint-format.md`](../.claude/rules/ruff/lint-format.md)). Mypy reste le gate bloquant : `ty` (Astral) annonce des changements de diagnostics entre deux versions quelconques, `pyrefly` (Meta) manque de recul d'usage vérifiable. Après un premier passage, un run avec `--warn-unused-ignores` repère les `# type: ignore[code]` obsolètes.

## Frontend

### 1. Angular
**Version actuelle** : runtime `@angular/*` en `22.2.3` (2026-10-14), `@angular/cli` et `@angular/build` en `22.2.5` (relevé le 2026-10-29), `@angular/cdk` en `22.2.4` (2026-10-21)
**Stabilité** : ✅

Les deux numéros viennent de dépôts distincts et n'ont pas à converger : `@angular/build` déclare `@angular/core` en `^22.0.0`, les aligner bloquerait les correctifs du builder.

**Breaking Changes Majeurs** :
- **`ChangeDetectionStrategy.OnPush` devient le défaut** (sans incidence ici : état entièrement en signals)
- **22.2** : option `strictUnclaimedEventNames` (opt-in, activée ici) : erreur de compilation sur un `(output)` qu'aucune directive ne déclare
- **`@angular/build` 22.2.4 figeait `vite` en `8.3.0`** : `pnpm audit` y remontait six avis du serveur de dev (`launch-editor` en sévérité haute, `server.fs`), corrigés en `vite` 8.3.3. Un `overrides: vite: 8.3.5` le contournait ; la 22.2.5 épingle `vite` en `8.3.5` (`pnpm view @angular/build@22.2.5 dependencies.vite`, relevé le 2026-10-29) : l'override est retiré. Outil de dev, absent du bundle livré

**Pièges** : `ng build` produit `dist/<app>/browser`, à pointer directement en `frontendDist` dans `tauri.conf.json`. Angular 22 verrouille TypeScript sur la ligne 6.0 (cf. § TypeScript).

### 2. TypeScript
**Version actuelle** : `6.0.3` (retenue, dernière 6.0.x au 2026-10-27) / `7.0.2` (dernière stable, **inutilisable ici**)
**Stabilité** : ✅ sur 6.0.x

**Breaking Changes Majeurs** : **7.0 (Corsa, compilateur natif Go)** : l'API programmatique du compilateur n'existe pas dans `tsgo`, annoncée pour 7.1.

**Compatibilité Écosystème** :
- **Angular 22 exige `>=6.0.0 <6.1.0`**. La demande d'élargissement à TS 7 a été fermée en `not planned` le 2026-07-09 (angular/angular#69704) : « Supporting TS 7.0, requires a major refactoring of our compiler ». Angular 23 est attendu vers juin 2027
- **Aucune TS 6.1 ne sortira** (blog TypeScript, décembre 2025). La 7.1, qui doit rendre une API programmatique (microsoft/TypeScript#63703, ouverte au 2026-10-27), a publié `7.1.0-beta` le 2026-10-20 (dist-tag `beta`) ; la présence de l'API dans la beta n'a pas été vérifiée
- `typescript-eslint` 8.72.1 déclare `typescript: >=4.8.4 <6.1.0` et son parseur crashe réellement sous TS 7. Le support de TS 7.1 se prépare dans typescript-eslint#10940 (PR #12803), sans version annoncée
- `tsconfig.json` : `lib: ["es2024", "dom"]` depuis le 2026-10-12, que le schematic `ng new` ne pose pas : la cible est la WebView2 évergreen

**Recommandation** : ✅ Rester sur **6.0.x**. TS 7 casse à la fois `@angular/compiler-cli` et `typescript-eslint`, soit le build et le lint : un blocage, pas un arbitrage. Réévaluable quand TS 7.1 sera stable et qu'un `@angular/compiler-cli` puis un `typescript-eslint` l'accepteront dans leurs `peerDependencies`.

### 3. Node.js
**Version actuelle** : `26.13.0` (Lithium, Active LTS depuis le 2026-10-28 jusqu'au 2027-10-20, EOL 2029-04-30 ; installée en local et en CI le 2026-10-29, source : `https://nodejs.org/dist/index.json`, champ `lts`)
**Stabilité** : ✅

**Breaking Changes Majeurs** :
- **Corepack retiré de la distribution** à partir de la 25.x. Le projet ne l'utilise pas : `pnpm/setup` installe pnpm, `corepack enable` n'est appelé nulle part
- **26.0.0** : les addons natifs doivent publier un prebuild (`NODE_MODULE_VERSION` 147) : `just install`, le gate complet et `just build` sont verts sous 26.13.0 (2026-10-29)

**Recommandation** : ✅ **26.13.0, ligne LTS.** Node est un outil de build, jamais embarqué dans le binaire distribué. La bascule a été déclenchée sur la confirmation du passage LTS (issue #60), pas sur la date annoncée, et a porté `devEngines.runtime` et `demo/Dockerfile` (`node:26.13.0-slim`), que garde `test_demo_image_coherence.py`. Dependabot ne montant pas `devEngines.runtime` (dependabot-core#13722), la montée est manuelle. Prochaine bascule : Node 28 (calendrier nodejs/Release, relevé le 2026-10-09). Ne jamais s'en remettre au Node préinstallé sur l'image du runner.

### 4. pnpm
**Version actuelle** : `12.15.0` (2026-10-21), épinglée par `devEngines.packageManager` et égale au dist-tag `latest` au 2026-10-27. Dernière 11.x : `11.28.8`, maintenue jusqu'au 2027-04-30 (`SECURITY.md` de pnpm, relevé le 2026-10-16)
**Stabilité** : ✅

**Breaking Changes Majeurs** :
- **11.0.0** : `onlyBuiltDependencies` remplacé par un unique `allowBuilds`. `.npmrc` restreint à l'auth et au registry, le reste migre vers `pnpm-workspace.yaml`. `minimumReleaseAge` passe à 1440 minutes et `blockExoticSubdeps` à `true`. Coût réel : moins de dix lignes (`allowBuilds: { esbuild: true }`, esbuild étant tiré par `@angular/build`, et un `pnpm-workspace.yaml` à créer même sans monorepo)
- **12.11.0** ajoute un réglage `permissions`, qui primerait sur `allowBuilds` s'il était posé (absent ici)

**Le lockfile multi-document est conditionnel.** Doc officielle : « `pnpm-lock.yaml` is a YAML file, but it is not always a **single** YAML document ». Déclencheurs : `configDependencies` (absent ici), le champ legacy `packageManager` (absent), et `devEngines.packageManager` (**présent depuis le 2026-10-15**). Le second document (`packageManagerDependencies`) porte la résolution de pnpm lui-même. Voir [§ Dependabot](#6-dependabot).

**Compatibilité Écosystème** : `pnpm/action-setup` v6 annonce pnpm 12 depuis la v6.1.0 mais `pnpm.cmd` n'est pas reconnu sous PowerShell Windows (action-setup#291, ouverte) : le projet reste sur `pnpm/setup@v3.1.2`, qui exige pnpm 11+ et télécharge le binaire natif.

**Recommandation** : ✅ `package.json` est la seule source de la version : `devEngines.packageManager` avec `onFail: download` fait télécharger la bonne version sur chaque poste, et `pnpm/setup` la lit en CI. Même schéma que uv.

> ⚠️ **Piège de CI.** `minimumReleaseAge` à 24 h combiné à `pnpm install --frozen-lockfile` fait échouer la CI (`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`) quand un bot vient de regénérer un lockfile pointant une transitive publiée dans les dernières 24 heures (cas documenté sur Angular avec `caniuse-lite`). `--frozen-lockfile` ne fait que vérifier, sans repli, et Dependabot appelle la CLI pnpm qui applique son propre `minimumReleaseAge` : rien à aligner côté bot. Seule parade : `minimumReleaseAgeExclude` pour les paquets qui se republient trop souvent (ne pas désactiver le réglage, protection supply-chain réelle).

### 5. PrimeNG et PrimeIcons
**Version actuelle** : `primeng 22.1.4` (2026-10-22), `@primeicons/angular 8.0.2` (2026-09-23), `primeicons 7.0.0` (dernière MIT, 2024-03-29)
**Stabilité** : ❌ (sur le modèle de licence, pas sur la qualité technique)

**Statut du dépôt, relevé le 2026-10-09** : `primefaces/primeng` a été archivé le 2026-06-28 puis désarchivé au plus tard le 2026-08-27, sans annonce. Il ne porte plus que la lignée MIT 21.x (« This repository is no longer under active development and receives security fixes only »), dernière release GitHub `21.1.10` (2026-09-09). Le code des 22.x vit dans `primefaces/primeng-nextchapter`, privé. `primefaces/primeicons` reste archivé.

**Breaking Changes Majeurs** :
- **v22** supprime les API dépréciées en v20 et v21, la directive `pTemplate` (`ng-template` + variable de référence), `styleClass` sur les composants host-enabled (utiliser `class`) et les sélecteurs camelCase (kebab-case obligatoire). Base rem de 14px à 16px (variant `-compat` par preset maintenu jusqu'en juin 2027)
- **v22** retire `primeng/icons` au profit de `@primeicons/angular ^8.0.0` (composants standalone SVG, aucune police à copier dans `angular.json`). Le paquet CSS `primeicons` s'arrête à 7.0.0 pour le MIT : la 8.0.0 (2026-07-15) passe sous « PrimeUI License » (« A valid license key is required to use this software »)
- **22.1.4** : `UniqueComponentId` (`primeng/utils`) déprécié au profit du service `UseId` (`primeng/useid`). Seul usage du projet, `PathPickerComponent` est passé à `UseId` le 2026-10-26, `@typescript-eslint/no-deprecated` refusant le lint

**Compatibilité Écosystème** :
- `peerDependencies` de 22.1.4 : `@angular/*` et `cdk` en `^22.1.0`. **La contrainte est `^22.1.0`, pas `22.x`** : Angular 22.0.0 déclencherait un avertissement. `@angular/cdk` n'étant tiré par aucun autre paquet, il est à déclarer explicitement
- `@primeicons/angular` est une dépendance directe de PrimeNG 22 mais pnpm isole : à déclarer quand même. Sur PrimeNG 22, s'en tenir aux composants SVG et ne pas ajouter le paquet CSS, pour éviter une seconde dépendance sous licence
- Les logos Beatport, Bandcamp, SoundCloud et VLC sont absents des 357 SVG du paquet : les quatre SVG Simple Icons (CC0-1.0) prévus dans `src/assets/icons/` restent nécessaires
- **La clé de licence ne couvre que les versions publiées avant son expiration.** `providePrimeNG` compare la date de sortie gravée dans la version (`RELEASE_DATE`, `2026-09-29` en 22.1.2) à l'échéance de la clé, et affiche le bandeau « Invalid PrimeUI License » au-delà comme en l'absence de clé : un build local sans `PRIMENG_LICENSE_KEY` l'affiche aussi (relevé le 2026-10-02). Community License : « valid for 12 months from the date of issue », renouvelable gratuitement, « A 30-day grace period is provided after expiration » (primeui.dev)
- **Scroll virtuel de `p-table`** : `virtualScrollItemSize` ne mesure aucune ligne et `#expandedrow` n'est pas supporté avec `[virtualScroll]`. Le détail déplié sous une ligne de la liste du run repose sur une marge non documentée du scroller : avec `virtualScrollOptions.numToleratedItems`, il rend toujours au moins cette valeur moins un de lignes au-dessus de la première visible (lu dans `primeng-scroller.mjs` 22.1.2 le 2026-10-10). À revérifier à chaque montée, cf. [knowledges/primeng.md § Détail déplié sous une ligne virtualisée](knowledges/primeng.md#détail-déplié-sous-une-ligne-virtualisée)
- **Tabs et router** : plusieurs issues ouvertes (#17563, #17505, #11999) décrivent l'état actif d'onglet non synchronisé avec `routerLink`. La dérivation depuis l'URL prévue par [ARCHITECTURE.md § Navigation](ARCHITECTURE.md#navigation) reste la bonne approche
- **Thème `@primeuix/themes`** : prendre `aura` (16px) et **jamais** `-compat` ([ARCHITECTURE.md](ARCHITECTURE.md#styling--ui) et [DESIGN.md](DESIGN.md) sont écrits sur cette base). Le chemin exact de la variante `-compat` n'a pas pu être confirmé sur une source officielle

**Recommandation** : ⚠️ **Retenu, l'[ADR-003](adrs/003-primeng-community-license.md) ayant déjà instruit la sortie du code du dépôt public et la Community License.** Le désarchivage ne change rien : le dépôt rouvert ne sert que la lignée 21.x. Le paquet d'icônes bascule sous la même licence, consigné dans les Négatives de l'ADR (cf. [Conflits Potentiels](#conflits-potentiels)).

### 6. Tailwind CSS et tailwindcss-primeui
**Version actuelle** : `tailwindcss 4.3.3` (2026-07-16), `tailwindcss-primeui 0.6.1` (2025-03-26)
**Stabilité** : ✅ pour Tailwind, ⚠️ pour le plugin

**Pièges** :
- **Aucun préprocesseur** : « Tailwind CSS v4.0 is not designed to be used with CSS preprocessors like Sass, Less, or Stylus » (d'où le CSS pur du projet)
- `@tailwindcss/postcss` via `.postcssrc.json` est la voie recommandée par les docs Angular et Tailwind, pas de bascule vers le plugin Vite
- **`tailwindcss-primeui` n'aligne pas le `dark:` sur PrimeNG** (il ne lit pas la config PrimeNG) : `@custom-variant dark (&:where(.app-dark, .app-dark *));` avec le même sélecteur que le `darkModeSelector` de `providePrimeNG()`
- `tailwindcss-primeui` : aucune publication depuis mars 2025, avant PrimeNG 22 et Tailwind 4.2/4.3 ; dépôt public, MIT, non archivé au 2026-10-09. Il ne consomme que des variables CSS générées par PrimeNG, d'où une rupture peu probable, mais rien ne l'atteste depuis 17 mois. Repli sans coût : consommer directement les variables de PrimeNG dans `@theme`

### 7. ngx-translate
**Version actuelle** : `@ngx-translate/core` et `http-loader` en `18.1.0` (publiées le 2026-10-27, adoptées le 2026-10-29). Notes de version lues le 2026-10-27 : additives, aucune rupture
**Stabilité** : ✅

**Breaking Changes Majeurs** (le projet écrit directement l'API v18, jamais d'exemple à base de `TranslateModule.forRoot()`) :
- **`TranslateModule` supprimé**, remplacé par `provideTranslateService()` et `provideChildTranslateService()`. Sens de la correspondance : « Do not invert the mapping: `{ extend: true }` maps to `provideChildTranslateService()`. `{ isolate: true }` maps to `provideTranslateService()` »
- **`defaultLang` renommé `fallbackLang`** partout (`setDefaultLang()` devient `setFallbackLang()`). `currentLang` est un `Signal<Language | null>`
- `http-loader` : `provideTranslateHttpLoader({ prefix, suffix })` remplace `useFactory` + `HttpLoaderFactory`

**Pièges** :
- **Chemin** : « In newer versions of Angular, the assets folder is no longer used. Instead, translations are stored in the public folder ». Vérifier le `prefix` contre `angular.json`
- **Tauri** : la webview sert le `frontendDist` en same-origin (`tauri://localhost`), donc un `HttpClient.get()` relatif fonctionne sans passer par `asset:`

### 8. @tauri-apps/api et plugins JS
**Version actuelle** : `@tauri-apps/api 2.12.4` (2026-10-14). Versions des plugins : [§ Plugins officiels Tauri v2](#2-plugins-officiels-tauri-v2)
**Stabilité** : ✅

**Breaking Changes Majeurs** : `@tauri-apps/api/shell` (idem `dialog`, `os`, `updater`) supprimé au profit de `@tauri-apps/plugin-*`. Updater : « The built-in dialog with an automatic update check was removed », la vérification et l'interface sont à écrire.

**Pièges** :
- **`tauri build` refuse un écart de mineure entre un paquet npm et sa crate**, et la CI des PR ne lance jamais `tauri build` : un groupe Dependabot npm qui montait les plugins sans le groupe cargo a cassé le build de release (relevé le 2026-10-02). `test_the_tauri_crates_and_their_npm_packages_are_aligned` (`sidecar/tests/unit/test_main.py`) garde désormais en CI l'égalité crate ↔ paquet npm de chaque plugin, et la mineure de `tauri` égale à celle de `@tauri-apps/api` et de `@tauri-apps/cli`
- **`single-instance` n'a aucune API JS** : rien à installer côté pnpm
- `Command.sidecar(program, args?, options?)` : **`spawn()` et non `execute()`**, qui attend la fin du process, incompatible avec un sidecar long (cohérent avec `shell:allow-spawn`, [ARCHITECTURE.md § Capacités Natives](ARCHITECTURE.md#capacités-natives))
- `plugin-shell` 2.4.1 corrige un `close` (`Terminated`) émis avant la fin de `stdout` quand le process sort vite, ce qui concerne la lecture du flux NDJSON du sidecar

**Issues à connaître** :
- `plugins-workspace#2418` : « program not allowed on the configured shell scope » malgré une capability correcte, dû à un décalage entre le `name` déclaré et celui utilisé côté JS
- `plugins-workspace#687` : les arguments passés dynamiquement depuis le JS peuvent être ignorés au profit de ceux figés dans la configuration. Statut de correction non vérifié sur la 2.3.5

### 9. @sentry/angular
**Version actuelle** : `11.9.0` (2026-10-23)
**Stabilité** : ✅ (⚠️ en tableau : les défauts v11 collectent tout)

**Breaking Changes Majeurs** :
- **11.9.0** : nouvelle catégorie `mcp` (`inputs`, `outputs`) dans `dataCollection`. Le typage `satisfies ClosedDataCollection` a cassé le build comme prévu, la catégorie est fermée depuis le 2026-10-26
- **v11** : `sendDefaultPii` remplacé par `dataCollection`, **dont l'absence collecte tout** : `userInfo` (IP inférée par `infer_ip: auto`), cookies, en-têtes, corps HTTP, paramètres d'URL. Les breadcrumbs de console passent par une intégration `Console` distincte de `Breadcrumbs`

**Pièges** :
- `browserTracing` et `replay` sont **opt-in** : ne pas les ajouter suffit à ce qu'aucun tracing ni replay ne parte (défauts relevés le 2026-10-03 par `getDefaultIntegrations` en 11.1.0)
- `httpContextIntegration` envoie toujours l'URL complète de la requête, ici `tauri://localhost/...` : la route interne est exposée, `beforeSend` la retire si besoin
- **Zoneless** : aucune déclaration officielle de Sentry. L'`ErrorHandler` ne dépend pas de Zone.js. L'issue `sentry-javascript#8983` (le `finalTimeout` du tracing bloque la stabilisation de `NgZone`) ne s'applique qu'avec `browserTracingIntegration`, non utilisée

**Recommandation** : ⚠️ Ne pas activer `browserTracing`, fermer explicitement chaque catégorie de `dataCollection` et retirer `Breadcrumbs`, `Console`, `Replay` et `CultureContext`. La config vit dans `core/observability/sentry-options.ts`, dont le test lit l'événement réellement envoyé.

## Partagé / Infrastructure

### 1. Tauri v2
**Version actuelle** : crate `tauri 2.12.5` (2026-10-21), `tauri-build 2.7.4`, `@tauri-apps/cli 2.12.4`
**Stabilité** : ✅

**La mineure se partage** entre `tauri` et `@tauri-apps/api`, comme entre chaque plugin et son paquet npm (garde : cf. § @tauri-apps/api et plugins JS). Combo validé le 2026-10-02 par un `tauri build` de release : `tauri 2.12.1` + `tauri-build 2.7.1` + `@tauri-apps/cli 2.12.1` + `@tauri-apps/api 2.12.1`.

**Breaking Changes Majeurs** : **2.11.4** avait épinglé `time` à `<0.3.52`, dépinglé en 2.11.5 : un lockfile figé sur 2.11.4 peut en hériter.

**Pièges** :
- **MSRV** : 1.90 pour `tauri`, `tauri-build` et tous les plugins depuis la 2.12. Sous un `rust-version` plus bas, cargo résout en silence les dernières versions compatibles et garde Tauri en 2.11
- **Windows** : WebView2 préinstallé depuis Windows 10 build 1803 ; Build Tools C++ (workload « Desktop development with C++ ») et toolchain MSVC requis
- **Sidecar** : le suffixe target-triple s'obtient par `rustc --print host-tuple` (Rust ≥ 1.84.0). **`externalBin` ne gère qu'un exécutable** : le dossier `_internal/` d'un build `--onedir` passe par `bundle.resources`, **en forme objet** (`{ "binaries/_internal": "_internal" }`), seule forme qui le pose à côté de l'exécutable. `resolveResource()` n'y sert à rien : le bootloader `--onedir` cherche son dossier de contenu relativement à l'exe
- **`assetProtocol`** : `{ "enable": true, "scope": ["$APPLOCALDATA/cache/artworks/**"] }`, plus une CSP dont `img-src` inclut `'self' asset: http://asset.localhost blob: data:`. Côté webview, `convertFileSrc(filePath)` produit l'URL du `src`
- **Updater** : la signature vient de `TAURI_SIGNING_PRIVATE_KEY` (chemin ou contenu, **jamais un `.env`**) et la `pubkey` de `tauri.conf.json` doit être le contenu de la clé publique, pas un chemin. Le `latest.json` minimal ne requiert que `version`, `platforms.[target].url` et `.signature`

**Recommandation** : ✅ Retenir **NSIS** (« MSI and NSIS installers receive signatures and can be used with the updater »). La cross-compilation n'a pas d'usage immédiat (Windows seul au MVP, cf. [ADR-015](adrs/015-cibles-distribution-windows.md)) mais le mode `downloadBootstrapper` pour WebView2 est un filet de sécurité gratuit chez un utilisateur dont l'installation Windows serait incomplète, là où le MSI (WiX) « can only be created on Windows ».

### 2. Plugins officiels Tauri v2
**Version actuelle** : une par crate `tauri-plugin-*` (le paquet npm de même nom court porte le même numéro, sauf `single-instance`)
**Stabilité** : ✅

Toutes exigent `tauri` en `^2.12`. Relevé le 2026-10-29 : `shell` `2.6.0`, `dialog` `2.8.4`, `single-instance` `2.5.5`, `updater` `2.14.1`. Publiés avant : `store` `2.5.0` (2026-09-26), `os` `2.4.0` (2026-09-26), `opener` `2.7.2` (2026-10-14).

**Breaking Changes Majeurs** :
- **`updater` 2.12** : `plugins.updater.requireSignedVersion` (défaut `false`, posé à `true` par `tauri add updater`) rejette une réponse d'endpoint dont la version diffère de celle inscrite dans la signature. Les releases signées avant le CLI 2.12 ne portent aucune version et sont rejetées. Sans conséquence ici : la paire de clés updater date du 2026-10-20 et la mise à jour 0.10.0 → 0.11.0 est vérifiée depuis le 2026-10-21 ([PRODUCTION.md § Checklist Post-MEP](PRODUCTION.md#checklist-post-mep))
- **`updater` 2.11.0** : `downloadAndInstall` gagne `restartAfterInstall`, vraie par défaut : l'installeur relance l'application, sans plugin `process` (vérifié dans le crate 2.14.0, `updater.rs`, le 2026-10-21)

**Pièges** :
- `tauri-plugin-fs` et `@tauri-apps/plugin-fs` ne sont plus déclarés (la webview n'importe aucun des deux) ; la crate reste dans `Cargo.lock` comme transitive de `tauri-plugin-dialog`. `single-instance` et `prevent-default` (sans paquet npm) sont exclus du test d'alignement crate ↔ npm
- **`single-instance` doit être enregistré en premier** : « The Single Instance plugin must be the first one to be registered to work well. This assures that it runs before other plugins can interfere ». Le `lib.rs` doit respecter cet ordre
- **`updater` sur Windows** : signatures obligatoires et non désactivables, l'application se ferme automatiquement à l'installation (hook `on_before_exit` pour nettoyer avant)
- **`tauri-plugin-prevent-default` `6.0.1`** (plugin tiers, 2026-10-05) : ni paquet npm ni permission. Seuls `Flags::RELOAD | Flags::CONTEXT_MENU | Flags::OPEN | Flags::SOURCE` en release (`src-tauri/src/lib.rs`) : le jeu par défaut coupe aussi `FOCUS_MOVE` (`Shift+Tab`), et l'option Windows `browser_accelerator_keys(false)` coupe aussi le zoom clavier

**Recommandation** : ✅ Zone grise non bloquante : le format retourné par `locale()` du plugin `os` n'est documenté que par renvoi vers la référence JavaScript. Le format BCP-47 attendu par [ARCHITECTURE.md § i18n](ARCHITECTURE.md#i18n) n'est attesté ni par le dépôt ni par PRODUCTION.md, la règle « commence par `fr` » (`src/app/core/i18n/language.ts`) étant de toute façon tolérante. Levée côté spawn : `shell:allow-spawn` restreinte au sidecar (`"sidecar": true`), portée par `src-tauri/capabilities/default.json`, fonctionne sur l'installeur de la 0.11.0 (2026-10-21).

### 3. Rust
**Version actuelle** : `1.99.1` (2026-10-16), canal stable. Prochaine, `1.100.0`, attendue le 2026-11-12
**Stabilité** : ✅

**Breaking Changes Majeurs** :
- **1.99.1** corrige une miscompilation des valeurs `bool` de retour FFI sur x86_64 (la 1.98.1 une autre, dans les vtables) : raison de ne pas rester épinglé sur la version précédente
- **1.99.0** : trois lints Clippy entrent dans les groupes par défaut, `cargo clippy -- -D warnings` passe sans changement (relevé le 2026-10-27 en 1.99.1)

**Pièges** : Clippy déplace régulièrement des lints entre catégories : **le même code peut passer ou échouer selon la toolchain du runner**, d'où `rust-toolchain.toml` (l'image `windows-2025` préinstalle la 1.99.1 depuis le 2026-10-21, `rustup` installe de toute façon la toolchain épinglée).

### 4. GitHub Actions
**Version actuelle** : voir le tableau, confronté aux workflows et aux actions composites le 2026-10-29 (dates : publication)
**Stabilité** : ✅

| Action | Version | Notes |
|---|---|---|
| `actions/checkout` | `v7.0.1` (2026-07-17) | |
| `pnpm/setup` | `v3.1.2` (2026-10-25) | Installe pnpm et Node, à la place d'`actions/setup-node`. **Exige pnpm 11+** |
| `astral-sh/setup-uv` | `v10.3.3` | Runtime `node24` |
| `dorny/paths-filter` | `v4.0.3` (2026-08-05) | Job `changes` : saute les trois zones sur une PR de markdown seul |
| `dtolnay/rust-toolchain` | `@stable` | Pas de semver : la révision **est** la sélection. Le `rust-toolchain.toml` prime ensuite |
| `tauri-apps/tauri-action` | `v1.0.0` (2026-06-29) | Écrit dans `latest.json` l'URL d'API de l'asset (tauri-action#1315), limitée à 60 appels par heure et par IP sans token : le workflow la remplace par le lien sous le tag (constaté sur la v0.10.0) |
| `googleapis/release-please-action` | `v5.0.0` (2026-04-22) | Runtime Node 24 |
| `extractions/setup-just` | `v4.0.0` | Lit la version dans `minimum-version` du `Justfile` |
| `getsentry/action-release` | `v3.7.2` (2026-10-21) | `set_commits: auto` d'où le `fetch-depth: 0` |
| `Swatinem/rust-cache` | `v2.9.3` (2026-10-20) | |
| `docker/*` (démo) | `setup-buildx-action` `v4.4.1`, `build-push-action` `v7.4.0`, `login-action` `v4.7.0`, `metadata-action` `v6.2.0` | Jobs `demo-image` et `demo` |
| `rhysd/actionlint` | `1.7.12` (2026-03-30) | Script et binaire épinglés dans le job `ui`. Le support du label `ubuntu-26.04` n'est pas confirmé dans ses notes |

**Breaking Changes Majeurs** :
- **`windows-latest` ne pointe plus sur Windows Server 2022** mais sur Windows Server 2025 avec Visual Studio 2026 : c'est ce genre de bascule silencieuse que l'épinglage `windows-2025` / `ubuntu-24.04` évite. Dependabot ne suit pas les images, leur montée est manuelle
- **Node 20 est retiré des runners le 2026-09-23** : une action en `runs.using: node20` échoue. Celles du projet sont en `node24` ou composites (relevé le 2026-10-09)
- `tauri-action` v1 renomme `assetNamePattern` en `releaseAssetNamePattern` et supprime `includeRelease`/`includeDebug`

**Pièges** : la présence de WebView2 sur l'image du runner n'a pas pu être confirmée dans la documentation ; l'application construite en CI s'ouvre (2026-10-21).

**Recommandation** : ✅ Pinner chaque action sur le SHA de son tag : Dependabot propose chaque montée par une PR. Une version d'outil partagée entre jobs vit dans une action composite locale (`.github/actions/setup-uv`, `setup-pnpm`, `setup-just`), jamais recopiée.

### 5. release-please
**Version actuelle** : action `5.0.0` (2026-04-22), CLI npm `17.11.2` (2026-08-24). L'action embarque release-please 17.6.0, en retard sur le CLI
**Stabilité** : ⚠️

**Le point critique d'[ARCHITECTURE.md § CI/CD](ARCHITECTURE.md#cicd) est confirmé par la doc GitHub** : « events triggered by the `GITHUB_TOKEN` will not create a new workflow run », donc le tag créé ne déclenche aucun workflow. Contournements par ordre de préférence : (1) **chaînage `needs:` dans le même workflow** sur les outputs `release_created` et `tag_name`, sans token supplémentaire (choix du projet) ; (2) Personal Access Token ; (3) token de GitHub App.

**Propagation d'une version dans trois langages** : [PRODUCTION.md § Propagation de la version](PRODUCTION.md#propagation-de-la-version).

**Le piège n'est pas la propagation mais les lockfiles** : `uv.lock` et `Cargo.lock` portent la version du paquet local, et `uv sync --locked` refuse un lock désaccordé, ce qui ferait échouer le build de release. Depuis le 2026-10-28, les deux sont suivis par `extra-files` avec un filtre `@.name.value`, recette vérifiée ce jour-là sur release-please 17.6.0. Syntaxe, piège du `No entries modified` silencieux et support natif à venir : [knowledges/release-please.md § Mode manifest et `extra-files`](knowledges/release-please.md#mode-manifest-et-extra-files).

**Comportement `chore:`** : « A releasable unit is a commit to the branch with one of the following prefixes: 'feat', 'fix', and 'deps'. (A 'chore' or 'build' commit is not a releasable unit.) ». Échappatoire : `Release-As: x.x.x` dans le corps d'un commit de `main`.

**Recommandation** : ✅ Le flux `develop` → `main` **n'est documenté nulle part** (release-please raisonne sur une branche de vérité unique, pilotée par `target-branch`). Il marche pourtant sans réglage : le squash-merge de la PR `develop → main` est un commit ordinaire de `main`. **Confirmé au premier run**, tag `v0.1.0` et `CHANGELOG.md` à l'appui.

### 6. Dependabot
**Version actuelle** : app GitHub intégrée, aucune version épinglée par le dépôt : la CLI qui régénère chaque lockfile est celle installée par le job (pnpm, uv, cargo)
**Stabilité** : ✅

**Mode de panne assumé depuis le 2026-10-15.** Sur un `pnpm-lock.yaml` à deux documents (écrit dès que `devEngines.packageManager` est déclaré), le graphe de dépendances GitHub ne lit que le premier document et rapporte zéro dépendance : **les alertes de sécurité npm se referment sans rien afficher**, les PR de bump continuent de fonctionner ([dependabot-core#15904](https://github.com/dependabot/dependabot-core/issues/15904), ouverte, derniers constats du 2026-09-23). Le pin a été retenu pour le même schéma qu'uv et que les autres projets du poste ; la veille CVE npm repose sur `just audit-ui` en CI, non bloquant, lu à chaque release ([PRODUCTION.md § Dépendances](PRODUCTION.md#dépendances)). La clôture de #15904 rend les alertes à nouveau fiables, sans rien changer au dépôt.

**Pièges** :
- `groups` avec `update-types: [minor, patch]` groupe par écosystème, laissant les majeures sortir isolées. Une entrée `updates` par écosystème, déclarée explicitement
- **Dependabot appelle la CLI du gestionnaire** (`pnpm install`, `uv lock`, `cargo update`) : le `minimumReleaseAge: 1440` de `pnpm-workspace.yaml` s'applique à une PR Dependabot comme à une installation locale

### 7. Images Docker de la démo
**Version actuelle** : `nginx/nginx-unprivileged:1.31.8-alpine` et `node:26.13.0-slim`, relevées le 2026-10-29 (Docker Hub)
**Stabilité** : ✅

**Pièges** :
- **`nginx-unprivileged`** : UID 101, port 8080, PID dans `/tmp/nginx.pid`, `/usr/bin/wget` (busybox) présent pour le healthcheck. `nginxinc/nginx-unprivileged`, l'ancien nom, n'est plus maintenu (relevé le 2026-10-26)
- **`node:26.13.0-slim`** : Debian, `bash` présent. L'alpine n'en a pas, or `scriptShell: bash` de `pnpm-workspace.yaml` l'exige pour `pnpm build:demo`

Le tag de Node suit `devEngines.runtime` : la montée de l'un sans l'autre fait échouer le test de cohérence. Dependabot (écosystème `docker` sur `/demo`) propose chaque montée.

---

# Matrice de Compatibilité Croisée

Les couples ⚠️ et ❌ sont détaillés dans [Conflits Potentiels](#conflits-potentiels).

| Dépendance A | Dépendance B | Compatibilité | Notes |
|--------------|--------------|---------------|-------|
| Angular 22.2.3 | TypeScript 6.0.x | ✅ | Contrainte dure `>=6.0.0 <6.1.0` |
| Angular 22.2.3 | TypeScript 7.0.x | ❌ | `compiler-cli` ne compile pas, élargissement refusé en `not planned` (cf. [Montées Bloquées](#montées-bloquées-état-au-2026-10-29)) |
| Angular 22.2.3 | PrimeNG 22.1.4 | ✅ | `peerDependency` en `^22.1.0`, pas `22.x` |
| PrimeNG 22.1.4 | Tailwind 4.3.3 | ✅ | Layer `primeng` à placer après `theme` et `base`, avant `utilities` |
| Tailwind 4.3.3 | prettier-plugin-tailwindcss 0.8.1 | ✅ | Option `tailwindStylesheet` obligatoire |
| tauri 2.12.5 | plugins v2, `@tauri-apps/api` 2.12.4 | ✅ | Mineure partagée, patchs libres, gardée par `test_main.py` et par `tauri build` |
| PrimeNG 22.1.4 | @primeicons/angular 8.0.2, tailwindcss-primeui 0.6.1 | ⚠️ | Licence PrimeUI ; plugin figé depuis mars 2025 |
| httpx2 2.16.0 | respx / pytest-httpx | ❌ | Dépendent de `httpx` |
| keyring, rapidfuzz | PyInstaller 6.22.3 | ⚠️ | Backends par entry points / aucun hook |
| release-please + `GITHUB_TOKEN` | `on: push: tags` | ❌ | Aucun workflow déclenché |
| pnpm 12.15.0 | Dependabot | ⚠️ | Lockfile à deux documents, alertes npm non fiables |

---

# Conflits Potentiels

| Conflit | Risque | Solution |
|---------|--------|---------|
| **La bascule sous licence PrimeUI s'étend au paquet d'icônes**, que l'[ADR-003](adrs/003-primeng-community-license.md) n'avait pas couvert : PrimeNG 22 tire `@primeicons/angular ^8.0.0`, la dernière version MIT étant `primeicons` 7.0.0 | 🟡 | Consigné dans les Négatives de l'ADR-003 (porte de sortie Optimus UI côté icônes comprise). **La décision tient** |
| **Aucun mock HTTP ne supporte `httpx2`.** `respx` dépend de `httpx>=0.25.0`, `pytest-httpx` de `httpx==0.28.*`. Les PR de support (respx#317, pytest-httpx#239) sont ouvertes | 🟢 | Le « client techno-scraper mocké » d'[ARCHITECTURE.md § Stratégie de Tests](ARCHITECTURE.md#stratégie-de-tests) repose sur le `MockTransport` natif d'`httpx2`, injecté par le paramètre `transport`. **Tranché** : fixtures dans `sidecar/tests/conftest.py` et `sidecar/tests/helpers/scraper_responses.py` |
| **`keyring` ne trouve pas son backend dans le binaire PyInstaller** : `RuntimeError: No recommended backend was available` au runtime, l'analyse statique ne voyant pas les entry points | 🔴 | Forcer `PYTHON_KEYRING_BACKEND=keyring.backends.Windows.WinVaultKeyring` ou `keyring.set_keyring(WinVaultKeyring())`, plus `--collect-metadata keyring` et `--hidden-import win32ctypes.pywin32.win32cred,win32ctypes.pywin32.pywintypes`. **Tester sur le binaire figé, jamais seulement sur les sources** (validé sur l'application installée le 2026-10-21) |
| **`sentry_sdk.init()` peut planter dans le binaire figé** : les intégrations sont importées par `importlib.import_module` et le code n'intercepte que `DidNotEnable` et `SyntaxError`, pas `ImportError` | 🟡 | `hook-sentry_sdk.py` couvre le cas nominal. `init_sentry` (`sidecar/src/tagger/core/observability.py`) protège l'import et l'appel : une remontée d'erreurs cassée ne doit jamais empêcher l'application de démarrer (self-test de l'application installée confirmé le 2026-10-19) |
| **Le `pnpm-lock.yaml` à deux documents referme les alertes de sécurité npm en silence** (dependabot-core#15904) | 🟡 | `just audit-ui` en CI, cf. [§ Dependabot](#6-dependabot) |
| **`externalBin` ne prend qu'un exécutable**, or PyInstaller `--onedir` produit un exe plus un dossier `_internal/` | 🟡 | Exe suffixé en `bundle.externalBin`, dossier en `bundle.resources` **sous forme objet**. La forme tableau le range sous `binaries/_internal/` et le sidecar meurt sur `Failed to load Python DLL`, invisible en `tauri dev`. Vérifié sur artefact, pas seulement au build |
| **`tauri-action` n'offre aucun hook pour construire un sidecar** avant `tauri build` | 🟢 | Construire le binaire PyInstaller et le copier dans `src-tauri/binaries/` dans une étape antérieure du même job |

---

# Configuration Recommandée

Les versions vivent dans les tableaux ci-dessus et dans les lockfiles : cette section ne garde que ce que les fichiers ne disent pas.

## Backend

### sidecar/pyproject.toml

- **Python** : `requires-python = ">=3.14,<3.15"`. La borne haute existe pour que PyInstaller empaquette exactement l'interpréteur testé, pas pour exclure 3.15. Un `.python-version` fige la version qu'`uv` installe et que la CI reprend, c'est le fichier que vise la procédure de bump de [PRODUCTION.md § Composants applicatifs](PRODUCTION.md#composants-applicatifs)
- **uv** : `[build-system] requires = ["uv_build>=0.13.5,<0.14"]` et `[tool.uv] required-version = ">=0.13,<0.14"`. `test_uv_build_follows_the_required_uv_minor` garde les deux plages sur le même minor
- **`[tool.mypy]`** : `untyped_calls_exclude = ["mutagen"]` : son `py.typed` n'annote ni ses frames ni les méthodes de ses tags, chaque appel demanderait sinon un `# type: ignore[no-untyped-call]`. Override ciblé sur `tagger._build_info` (`ignore_missing_imports = true`) : module gravé par `build.py` au packaging, absent d'un arbre propre ; ciblé plutôt que global, pour que la disparition des types d'une vraie dépendance reste une erreur. `explicit_package_bases = true` et un `mypy_path` ancré sur `$MYPY_CONFIG_FILE_DIR` : les tests ne sont pas des packages (pytest en `importlib`), et sans bases explicites deux `conftest.py` donnent le même module `conftest`, ce qui arrête Mypy
- **`[tool.pytest.ini_options]`** : le seuil `--cov-fail-under=80` vit dans la recette `just test` et non dans `addopts` : il mesure la couverture globale, donc dans `addopts` il ferait échouer toute exécution ciblée sur un seul fichier

### sidecar/build.py

`--onedir` avec le forçage du backend keyring (cf. [Conflits Potentiels](#conflits-potentiels)), sortie nommée selon le target-triple attendu par Tauri.

## Frontend

### package.json, pnpm-workspace.yaml

- **`devEngines.runtime`** : seule source de Node, lue par pnpm en local et par `pnpm/setup` en CI (`test_the_ci_reads_node_from_dev_engines` interdit un `runtime:` en dur dans `setup-pnpm`). Pas d'`engines.node` : l'app n'est pas publiée
- **`devEngines.packageManager`** : seule source de pnpm, `onFail: download`. Pas de champ `packageManager` (legacy, Corepack). Le lockfile à deux documents est assumé, cf. [§ Dependabot](#6-dependabot)
- **`pnpm-workspace.yaml`** à créer même sans monorepo, pour `allowBuilds: { esbuild: true }` et les réglages que le `.npmrc` n'accepte plus depuis pnpm 11. **`overrides`** : aucun depuis le 2026-10-29 (cf. § Angular)
- **Plages** : `typescript` en `~6.0.0` (tilde, pour rester sous 6.1), `eslint` en `^10.13.0` (la ligne 9 est dépréciée sur npm ; `angular-eslint` 22.6.0 accepte `^9.0.0 || ^10.0.0`, peer lue dans `pnpm-lock.yaml`, relevé le 2026-10-29).

### src/styles.css, .prettierrc, eslint.config.js

- **`src/styles.css`** : `@import "tailwindcss";`, puis `@plugin "tailwindcss-primeui";`, puis le `@custom-variant dark` aligné sur PrimeNG, puis `@theme` pour la `font-family` Inter. Le layer `primeng` se place après `theme` et `base`, avant `utilities`. Police `@fontsource-variable/inter` importée en tête (SIL OFL, aucun CDN, aucune entrée `angular.json`)
- **`.prettierrc`** : `tailwindStylesheet` sur `./src/styles.css`, résolu **relativement au fichier de config Prettier** (« When using Tailwind CSS v4 you must specify your CSS file entry point »)
- **`eslint.config.js`** : flat config uniquement. Étendre `angular.configs.tsRecommended`, `templateRecommended` **et** `templateAccessibility` (les règles d'accessibilité ne sont pas dans `recommended`), puis `eslint-config-prettier` en dernier (angular-eslint ne désactive pas ses règles stylistiques)

## Partagé / Infrastructure

### src-tauri

- **`Cargo.toml`** : `rust-version = "1.90"` (en dessous, cargo écarte en silence les crates Tauri 2.12). `serde_json` en `1.0.154` : `tauri::generate_context!` le référence dès que `tauri.conf.json` porte une section `plugins`
- **`tauri.conf.json`** : `bundle.externalBin` et `bundle.resources` pour `_internal/` (cf. § Tauri v2), `plugins.updater.pubkey` avec le **contenu** de la clé publique
- **`capabilities/default.json`** : `shell:allow-spawn` restreinte au sidecar, aucune permission `fs`, aucune pour `single-instance`

### rust-toolchain.toml

Épingler la stable avec `clippy`, `rustfmt` et la cible `x86_64-pc-windows-msvc` : seule source de vérité, `rustup` en local comme `dtolnay/rust-toolchain@stable` en CI s'y conforment.

### dependabot.yml

Cinq entrées `updates` (`npm` en `/`, `uv` en `/sidecar`, `cargo` en `/src-tauri`, `github-actions`, `docker` en `/demo`). Pour `github-actions`, `directories: ["/", "/.github/actions/*"]` : le premier ne couvre que `.github/workflows`, le second les actions composites locales. `open-pull-requests-limit: 5` pour tenir le flux de PR d'uv et de Ruff.

## Post-Install / Setup

```bash
# 1. Prérequis Windows (une fois) : Visual Studio Build Tools, workload "Desktop development with C++"
rustup default stable-msvc

# 2. Sidecar Python
cd sidecar && uv python install 3.14 && uv sync && uv run pytest

# 3. Webview Angular (pas de corepack : il disparaît sur Node 25+)
cd ..
npx get-pnpm              # devEngines télécharge ensuite la version épinglée
cmd //c "pnpm --version"  # Tauri passe par cmd.exe : pnpm.cmd doit s'y résoudre
pnpm install && pnpm exec ng build

# 4. Coquille Tauri (dev, sidecar déjà construit par just build-sidecar)
pnpm exec tauri dev

# 5. Build complet local, sans signature de l'updater
#    (la clé privée ne vit que dans les secrets GitHub, cf. .claude/rules/tauri/config-bundle.md)
just build
```

## Checklist Validation Compatibilité

**Au bootstrap et au premier build PyInstaller** (sidecar puis installeur de la 0.11.0, 2026-10-21 à 2026-10-23, [PRODUCTION.md § Checklist Pré-MEP](PRODUCTION.md#checklist-pré-mep)) :

- [x] [ADR-003](adrs/003-primeng-community-license.md) rouvert et tranché (décision maintenue), stratégie de mock d'`httpx2` arrêtée (`MockTransport` natif)
- [x] `mypy --strict` et `ruff check` passent sans `ignore_missing_imports` global, `banned-api` interdit `asyncio.get_event_loop` et `sqlite3.version` (sonde du 2026-10-23)
- [x] Le binaire figé lit et écrit une clé dans le Credential Manager, `sentry_sdk.init()` ne lève pas d'`ImportError` (self-test du 2026-10-19), Pydantic valide une commande NDJSON, `httpx2` établit une connexion TLS
- [x] `_internal/` est complet, l'exe démarre depuis un autre répertoire et PyInstaller empaquette correctement l'interpréteur installé par uv

Les faux positifs antivirus **ne se vérifient pas ici** : mesure dans la Checklist Post-MEP de [PRODUCTION.md](PRODUCTION.md#checklist-post-mep), sur une machine tierce.

**Au premier `tauri build`** :

- [x] Le suffixe target-triple correspond à `rustc --print host-tuple`, `Command.sidecar()` spawn le binaire (stdin/stdout), `capabilities/default.json` n'autorise que le spawn du sidecar (PRODUCTION.md § Checklist Pré-MEP, 2026-10-21 et 2026-10-22)
- [ ] Une pochette du dossier de cache s'affiche dans la webview via `convertFileSrc()`
- [x] L'installeur NSIS s'installe (Release publiée, machine d'un utilisateur réel, 2026-10-21)
- [ ] L'installeur NSIS se désinstalle proprement

**Au premier passage CI** :

- [x] Le flux `develop` → `main` de release-please est validé (tag `v0.1.0`), le job de build est chaîné en `needs:` sur `release_created` et **pas** sur `on: push: tags`
- [x] `latest.json` est publié avec une signature valide, et un client sur la version antérieure détecte la mise à jour (2026-10-21, 0.10.0 → 0.11.0)
- [x] `pnpm/setup` est pinné sur le SHA de la v3.1.2 et les workflows n'appellent ni `corepack enable` ni `actions/setup-node` (relevé les 2026-10-23 et 2026-10-27)
- [ ] Le cache pnpm fonctionne sur le runner Windows
- [ ] `pnpm install --frozen-lockfile` passe sur une PR Dependabot fraîche, sans `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`
- [ ] Le graphe de dépendances GitHub liste les dépendances d'`uv`, de `cargo` et de `github-actions` (npm : zéro attendu tant que dependabot-core#15904 est ouverte)

**Vérifications visuelles** :

- [x] Le variant `dark:` de Tailwind suit le `darkModeSelector` de PrimeNG (`.app-dark`, aucune classe `dark:` utilisée, relevé le 2026-10-23)
- [ ] `tailwindcss-primeui` expose les tokens attendus sur `@primeuix/themes` 3.1.0
- [ ] La table à scroll virtuel tient 100 lignes sans dégradation à 1024×700
- [ ] À chaque montée de PrimeNG, un détail déplié dans la liste du run reste visible en défilant dans les deux sens (cf. § PrimeNG et PrimeIcons, scroll virtuel de `p-table`)

## Montées Bloquées (état au 2026-10-29)

Mises à jour majeures écartées par une incompatibilité prouvée, ou identifiées et non tentées.

| Paquet | Actuel | Disponible | Blocage | Levée attendue |
|---|---|---|---|---|
| TypeScript | `6.0.3` | `7.0.2` | `@angular/compiler-cli` 22.2.3 et `typescript-eslint` 8.72.1 déclarent `typescript: <6.1`, et TS 7.0 n'a pas d'API programmatique (angular/angular#69704 fermée `not planned`, revérifié le 2026-10-29) | TS 7.1 stable avec son API (beta publiée le 2026-10-20), puis Angular et typescript-eslint déclarant TS 7 dans leurs `peerDependencies` |
| Python | `3.14.10` | `3.15` | Aucun blocage technique identifié : décision du projet de rester en 3.14 tant que l'écosystème 3.15 n'est pas mûr (relevé le 2026-10-29) | Écosystème 3.15 mûr, vers la 3.15.2 |

---

# Recommandation Finale

**Verdict : la stack est cohérente et production-ready**, les points durs ont chacun une issue dans [Conflits Potentiels](#conflits-potentiels). Points critiques : PrimeNG entièrement sous licence PrimeUI, icônes comprises ([ADR-003](adrs/003-primeng-community-license.md)) ; `keyring` sous PyInstaller, point de rupture le plus probable du build ; TypeScript verrouillé sur 6.0 par Angular 22 jusqu'à TS 7.1 ; alertes de sécurité npm de GitHub non fiables tant que dependabot-core#15904 est ouverte (`just audit-ui`, [PRODUCTION.md § Dépendances](PRODUCTION.md#dépendances)).

---

# 🔗 Ressources

## Documentation Officielle

- [Angular : Releases et versions supportées](https://angular.dev/reference/versions)
- [Python : Calendrier des versions](https://devguide.python.org/versions/)
- [Tauri v2](https://v2.tauri.app/)
- [PrimeNG : Guide de migration v22](https://primeng.dev/migration/v22)
- [Node.js : Versions précédentes et calendrier LTS](https://nodejs.org/en/about/previous-releases)
- [uv : Politique de versionnement](https://docs.astral.sh/uv/reference/policies/versioning/)

## Ressources Complémentaires

- [Tauri v2 : Sidecar](https://v2.tauri.app/develop/sidecar/), [Capabilities](https://v2.tauri.app/security/capabilities/), [Plugin updater](https://v2.tauri.app/plugin/updater/)
- [ngx-translate : Guide de migration](https://ngx-translate.org/getting-started/migration-guide/)
- [Sentry : Données collectées par le SDK Python](https://docs.sentry.io/platforms/python/data-collected/)
- [GitHub Actions : limite du GITHUB_TOKEN](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
- [release-please : Configuration du manifeste](https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md)
- [pnpm : Format du fichier de lock](https://pnpm.io/lockfile)
- [httpx2 : Documentation](https://httpx2.pydantic.dev/)
