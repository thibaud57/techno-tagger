---
title: "VERSIONS - Matrice de compatibilité (Fullstack)"
description: "Versions des dépendances du sidecar Python, de la webview Angular et de la coquille Tauri, compatibilité croisée, configuration et migration."
date: "2026-08-29"
keywords: ["versions", "dependencies", "compatibility", "setup", "migration", "fullstack", "tauri", "angular", "python"]
scope: ["docs", "config", "setup"]
technologies: ["Python", "Angular", "Tauri", "Rust"]
---

> **Trois écosystèmes, trois gestionnaires de paquets.** `sidecar/` en uv, `src/` en pnpm, `src-tauri/` en cargo. Aucun workspace transverse (cf. [ARCHITECTURE.md § Package Manager](ARCHITECTURE.md#package-manager)). La section « Partagé / Infrastructure » couvre la coquille Tauri et la chaîne CI/CD, qui traversent les trois zones.

> **Versions relevées le 2026-08-29.** Les technos Post-MVP (PydanticAI, WebdriverIO + `tauri-driver`) sont hors périmètre : elles seront documentées le jour où elles entrent réellement dans un fichier de dépendances.

> **Politique de version du projet : la dernière stable, toujours.** Une version antérieure ne se retient que sur une incompatibilité dure, documentée dans [Conflits Potentiels](#conflits-potentiels), et qu'aucune ligne de configuration ne contourne. Une rupture qui se règle par une règle de lint, un réglage ou une tournure de code à éviter n'est pas une raison de rester en arrière : elle se mécanise et on avance. Trois entrées seulement s'écartent de la dernière version publiée, et chacune s'en explique dans sa fiche : **TypeScript**, bloqué en 6.0.x par une incompatibilité qu'aucun réglage ne lève ; **pnpm**, retenu en 11.24.0 parce que c'est ce que pointe `latest`, la ligne 12 vivant sous un dist-tag de pré-adoption ; et **Node**, tenu en 24.x LTS jusqu'à ce que la 26 passe LTS en octobre, parce que c'est un outil de build et non une dépendance du produit.

---

# Vue d'ensemble

## Backend

Zone `sidecar/`, gestionnaire **uv**, fichier `sidecar/pyproject.toml` + `sidecar/uv.lock`.

| Technologie | Version Recommandée | Statut Production | Notes Critiques |
|-------------|-------------------|-----------------|----------------|
| Python | `3.14.7` | ✅ | Déclarée par toutes les dépendances, wheels `cp314` Windows pour rapidfuzz, supportée par PyInstaller depuis 6.15.0. Support jusqu'en 2030-10 |
| uv | `0.12.7` | ✅ | Format `uv.lock` couvert par la politique de versionnement, ne casse qu'en bump mineur. Épingler le patch en CI |
| Pydantic | `2.13.5` | ✅ | Porte les modèles du protocole NDJSON. `pydantic-core` est une extension native : wheels `cp314` Windows publiées, hook livré par `pyinstaller-hooks-contrib` |
| mutagen | `1.48.1` | ⚠️ | Projet peu actif (2 ans 9 mois entre 1.47.0 et 1.48.0). Piège `EasyID3` + `v2_version=3` sur TDRC/TYER |
| RapidFuzz | `3.14.5` | ⚠️ | MIT, wheels Windows précompilées. **Aucun hook PyInstaller ne le couvre**, ni le paquet ni `pyinstaller-hooks-contrib`. La 3.14.6 en préparation abandonne Python 3.10 |
| httpx2 | `2.12.0` | ⚠️ | Fork de `httpx` par Pydantic Services. Import `httpx2`, pas `httpx`. **Aucun mock (`respx`, `pytest-httpx`) ne le supporte encore** |
| keyring | `25.7.0` | ⚠️ | Backends chargés par entry points : casse sous PyInstaller sans forçage explicite du backend |
| sentry-sdk | `2.68.1` | ✅ | Intégrations chargées par `importlib` : le hook `pyinstaller-hooks-contrib` est indispensable |
| PyInstaller | `6.22.2` | ✅ | Supporte Python 3.8 à 3.15. Ne cross-compile pas, runner Windows obligatoire |
| pytest | `9.1.1` | ✅ | Les `PytestRemovedIn9Warning` sont des erreurs depuis la 9.0 |
| pytest-asyncio | `1.4.0` | ✅ | Fixture `event_loop` supprimée en 1.0, `event_loop_policy` dépréciée en 1.4 |
| pytest-cov | `7.1.0` | ✅ | Corrige un calcul de total qui faussait `--cov-fail-under` |
| Ruff | `0.16.5` | ⚠️ | La 0.16.0 fait passer le jeu par défaut de 59 à 413 règles. Une config copiée d'un projet antérieur produira un diff massif |
| Mypy | `2.3.1` | ✅ | Toutes les dépendances du projet livrent un `py.typed`, aucun paquet `types-*` requis |

## Frontend

Zone `src/`, gestionnaire **pnpm**, fichier `package.json` + `pnpm-lock.yaml`.

| Technologie | Version Recommandée | Statut Production | Notes Critiques |
|-------------|-------------------|-----------------|----------------|
| Angular | `22.1.4` | ✅ | OnPush par défaut, `fetch` remplace XHR, `provideRoutes()` supprimé. `@angular/cli` et `@angular/build` en `22.1.6`, cadence de patch distincte |
| TypeScript | `6.0.x` | ✅ | Contrainte dure d'Angular 22 : `>=6.0.0 <6.1.0`. **TS 7 (tsgo) casse `compiler-cli` et `typescript-eslint`** |
| Node.js | `24.x` (Active LTS) | ✅ | Bascule prévue sur 26.x quand elle passe LTS le 2026-10-28, une ligne de workflow. Installée par `pnpm/setup`, pas par `actions/setup-node` |
| pnpm | `11.24.0` | ✅ | Ce que pointe le dist-tag `latest`. pnpm 12 a trois jours et reste sous `next-12` |
| PrimeNG | `22.1.0` | ❌ | Dépôt archivé le 2026-06-28, licence PrimeUI avec clé obligatoire même en Community. Voir [Conflits Potentiels](#conflits-potentiels) |
| @primeuix/themes | `3.0.0` | ⚠️ | **Pas une dépendance transitive de PrimeNG**, à déclarer explicitement. Base rem passée de 14px à 16px |
| PrimeIcons | `@primeicons/angular 8.0.0` | ❌ | Dépendance directe de PrimeNG 22, **à déclarer quand même** : pnpm isole, une transitive n'est pas importable depuis `src/`. Le paquet CSS `primeicons` s'arrête à 7.0.0 pour le MIT, la 8.0.0 est sous licence PrimeUI |
| Angular CDK | `@angular/cdk 22.1.4` | ✅ | **peerDependency de PrimeNG 22**, donc jamais installée seule : son absence ne se voit qu'au premier composant qui en dépend |
| Tailwind CSS | `4.3.3` | ✅ | Config CSS-first, `tailwind.config.js` disparu, ne compile ni SCSS ni LESS |
| @tailwindcss/postcss | `4.3.3` | ✅ | Version alignée sur `tailwindcss` (même monorepo) |
| tailwindcss-primeui | `0.6.1` | ⚠️ | Aucune publication depuis mars 2025, donc antérieure à PrimeNG 22 et à Tailwind 4.3 |
| @fontsource-variable/inter | `5.3.0` | ✅ | SIL OFL, aucun CDN, importer `wght.css` |
| @ngx-translate/core | `18.0.0` | ✅ | `TranslateModule` supprimé, `defaultLang` renommé `fallbackLang`, `currentLang` devient un Signal |
| @ngx-translate/http-loader | `18.0.0` | ✅ | `provideTranslateHttpLoader({ prefix, suffix })` remplace le pattern `useFactory` |
| @tauri-apps/api | `2.11.1` | ✅ | Ne suit pas la cadence de patch de la crate `tauri` |
| @sentry/angular | `10.72.0` | ✅ | `peerDependency` : `@angular/core >= 14.x <= 22.x` |
| Vitest | `4.1.11` | ✅ | Runner par défaut du CLI Angular 22 |
| angular-eslint | `22.1.0` | ✅ | ESLint 9+ en flat config uniquement, `.eslintrc` supprimé |
| Prettier | `3.9.6` | ✅ | Parser Angular suivi jusqu'à `@angular/compiler` 22.1.x |
| prettier-plugin-tailwindcss | `0.8.1` | ✅ | Exige Prettier ≥ 3.7.x et l'option `tailwindStylesheet` en Tailwind v4 |

## Partagé / Infrastructure

Zone `src-tauri/` (cargo) et `.github/` (CI/CD).

| Technologie | Version Recommandée | Statut Production | Notes Critiques |
|-------------|-------------------|-----------------|----------------|
| tauri (crate) | `2.11.5` | ✅ | MSRV 1.77.2. Les quatre paquets Tauri ont chacun leur cadence de patch |
| tauri-build (crate) | `2.6.3` | ✅ | La branche edition 2024 monte le MSRV à 1.85 |
| @tauri-apps/cli | `2.11.4` | ✅ | Décalage de patch normal avec la crate |
| Plugins Tauri v2 | voir [§ Plugins](#2-plugins-officiels-tauri-v2) | ✅ | Versions crate et npm strictement alignées, plugin par plugin |
| Rust | `1.98.0` (stable) | ✅ | Préinstallé sur les runners Windows GitHub. Édition 2024 |
| GitHub Actions | voir [§ CI/CD](#4-github-actions) | ✅ | `windows-latest` pointe désormais sur Windows Server 2025 + Visual Studio 2026 |
| release-please-action | `5.0.0` | ⚠️ | Le tag créé avec `GITHUB_TOKEN` ne déclenche aucun workflow. Chaînage `needs:` obligatoire |
| Renovate | `44.51.0` | ✅ | **Remplace Dependabot.** Délègue la régénération du lockfile à la CLI pnpm, donc insensible à son format. Couvre `npm`, `pep621`/uv, `cargo` et `github-actions` en une seule config |
| pnpm/setup (action) | `2.1.0` | ✅ | Installe pnpm **et** Node en une étape. Exige pnpm 11+. Plancher 2.0.1 sur runner Windows |

---

# Détails par Technologie

## Backend

### 1. Python
**Version actuelle** : `3.14.7` (2026-08-05)
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
| PyInstaller 6.22.2 | `>=3.8,<3.16` | Support de 3.14 depuis 6.15.0 (2025-08-03), **un an de recul** |
| rapidfuzz 3.14.5 | classifiers 3.10 à 3.14 | **Wheels `cp314` publiées pour `win_amd64`**, une des deux dépendances à extension native |
| pydantic 2.13.5 | `>=3.9`, et `>=3.10` pour `pydantic-core` | Compatibilité 3.14 annoncée en 2.12, **wheels `cp314` et `cp314t` de `pydantic-core` pour `win_amd64`** |
| httpx2 2.12.0 | classifiers 3.10 à 3.15 | Explicite |
| sentry-sdk 2.68.1 | classifiers jusqu'à 3.14 | Explicite |
| mypy 2.3.1 | classifiers jusqu'à 3.15 | Wheels `cp314` |
| pytest 9.1.1 | `>=3.10` | Support de 3.14 depuis pytest 8.4.0 |
| Ruff 0.16.5 | `target-version = "py314"` | Valeur documentée |
| keyring 25.7.0 | `>=3.9` | `pywin32-ctypes` est pur Python, rien à compiler |
| mutagen 1.48.1 | `>=3.10,<4` | Classifiers non détaillés par version mineure, mais pur Python sans dépendance : risque structurellement nul |
| uv 0.12.7 | — | Livre le build 3.14.7 depuis 0.12.2 (2026-08-05) |

**Recommandation** : ✅ **3.14.7**. Le seul critère qui aurait pu bloquer, le support PyInstaller, est acquis depuis un an, et les deux extensions natives de la stack, rapidfuzz et `pydantic-core`, publient leurs wheels `cp314` Windows. Les cinq breaking changes de 3.14 ne touchent que des tournures qu'un sidecar neuf n'écrit pas. Le gain n'est pas cosmétique : le support court jusqu'en **2030-10** au lieu de 2029-10, ce qui repousse d'un an la procédure lourde de bump du runtime (rebuild PyInstaller plus retest des faux positifs antivirus, cf. [PRODUCTION.md § Composants applicatifs](PRODUCTION.md#composants-applicatifs)).

**Les deux règles de codage se mécanisent plutôt qu'elles ne se surveillent.** Bannir `asyncio.get_event_loop()` et `sqlite3.version` dans `[tool.ruff.lint.flake8-tidy-imports.banned-api]` transforme la vigilance en gate CI : le lint échoue si l'un des deux réapparaît, y compris dans du code copié depuis la CLI d'origine. Vérifier au premier `ruff check` que la règle `TID251` attrape bien l'accès qualifié, sinon un `grep` en CI fait le même travail pour trois lignes.

### 2. uv
**Version actuelle** : `0.12.7` (2026-08-27)
**Stabilité** : ✅

**Breaking Changes Majeurs** :
- **0.12.0** : `uv init` pose désormais un `build-system` par défaut (`uv_build`) et un layout `src/`
- **0.12.0** : le mode de résolution par défaut passe à `if-necessary`, les versions stables sont préférées avant tout repli sur une pré-release
- **0.12.0** : rejet des archives sdist hors `.tar.gz`, rejet des hashs MD5 seuls, `--require-hashes` désormais respecté dans `requirements.txt`
- **0.12.0** : `uv run` découvre le projet relativement au script passé, plus au répertoire courant
- **0.12.0** : `--reinstall` préserve la version patch de Python installée au lieu de l'upgrader implicitement

**Nouvelles Features Pertinentes** :
- Le build CPython 3.14.7 retenu par le projet est téléchargeable via `uv python install` depuis la 0.12.2
- `[dependency-groups]` (PEP 735) pour les dépendances de développement, préférable à `[project.optional-dependencies]` qui reste réservé aux extras publiés

**Compatibilité Écosystème** :
- Politique officielle : « the minor version number is bumped for breaking changes, and the patch version number is bumped for bug fixes ». Le format `uv.lock` fait partie de l'API publique et ne casse donc qu'en bump mineur
- Renovate couvre `pyproject.toml` et `uv.lock` via son manager `pep621`, avec extraction de `tool.uv.dev-dependencies` et `tool.uv.sources` (Dependabot supporte aussi l'écosystème `uv`, mais n'est plus l'outil retenu, cf. [§ Renovate](#6-renovate))
- CI : `astral-sh/setup-uv@v10.0.1`. La doc CI d'Astral montre encore un exemple pinné sur v9.0.0, elle est en retard sur le dépôt
- **PyInstaller + interpréteur géré par uv** : aucune source officielle ne documente ce couple. La doc `python-build-standalone` signale que les chemins absolus figés dans les métadonnées de build sont corrigés à l'installation par uv, donc le piège connu ne s'applique pas, mais **cela reste à valider empiriquement dès le premier build CI**

**Recommandation** : ✅ Épingler le patch exact en CI (`astral-sh/setup-uv` avec `version: 0.12.7`), la cadence de release étant très élevée (7 releases en un mois).

### 3. Pydantic
**Version actuelle** : `2.13.5` (2026-08-28), `pydantic-core 2.48.0` (2026-08-06)
**Stabilité** : ✅

**Breaking Changes Majeurs** :
- **2.11** : Python 3.8 abandonné, validation du core schema désactivée par défaut, et un champ `Final` porteur d'une valeur par défaut émet un warning de dépréciation
- **2.12** (2025-10-07) : première compatibilité Python 3.14. La page PyPI est explicite : « Pydantic V1 is not compatible with Python 3.14 and greater ». La borne basse du projet est donc 2.12, pas 2.0
- **2.12** : l'accès à `model_fields` et `model_computed_fields` depuis une instance est déprécié, il passe par la classe
- **v1 → v2** : `@validator`, `class Config`, `.dict()` et `.json()` ont disparu au profit de `@field_validator`, `model_config = ConfigDict(...)`, `model_dump()` et `model_dump_json()`. Aucun exemple antérieur à 2023 trouvé en ligne n'est transposable tel quel

**Nouvelles Features Pertinentes** :
- `computed_field(exclude_if=...)` (2.13) : exclut un champ calculé de la sortie sans post-traitement du dict, utile aux rapports JSON
- Syntaxe PEP 695 pour les génériques (2.11), alignée sur le reste du code du sidecar
- `model_validate_json()` parse et valide en une passe, c'est exactement ce que consomme une ligne NDJSON reçue sur `stdin`

**Compatibilité Écosystème** :
- **`pydantic-core` publie des wheels `cp314` et `cp314t` pour `win_amd64`** : c'est la seconde extension native de la stack après rapidfuzz, et la seule autre à devoir être vérifiée au build PyInstaller
- `pyinstaller-hooks-contrib` livre un hook `pydantic`, mis à jour pour la v2 (PR #611) : même mécanique que sentry-sdk, à valider sur le binaire figé
- Livre un `py.typed`, et distribue en plus un plugin Mypy (`plugins = ["pydantic.mypy"]`) : « Pydantic also ships with a mypy plugin that adds a number of important Pydantic-specific features that improve its ability to type-check your code ». Il génère la signature réelle d'`__init__` et vérifie les types de `default` et `default_factory`
- PydanticAI (Post-MVP, [ADR-008](adrs/008-matching-rapidfuzz-et-agent-ia.md)) repose sur la même définition de modèles : la dette est nulle le jour où le mode agent entre

**Recommandation** : ✅ **2.13.5**, borné `>=2.12,<3` (cf. [ADR-022](adrs/022-modeles-pydantic-du-protocole.md)). Le point à instruire n'est pas la bibliothèque, dont la v2 a trois ans de recul, mais son extension native dans le binaire figé, au même titre que rapidfuzz, avec le même geste de validation sur binaire gelé que keyring.

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
- **WAV** : seul le chunk ID3v2 est supporté, le chunk RIFF/INFO ne l'est pas. Le chunk est écrit en minuscules (`id3 `) là où d'autres implémentations attendent `ID3 `. La lecture côté mutagen est insensible à la casse, les autres logiciels pas forcément
- **ID3v2.3** : `save(v2_version=3)` repasse les frames texte d'UTF-8 en UTF-16 et joint les valeurs multiples avec `v23_sep` (défaut `/`). Le `v23_sep=None` est déconseillé par la doc, il produit des séparateurs nuls que « some implementations might get confused about »

**Recommandation** : ⚠️ Retenu, sans alternative crédible. Deux points à couvrir par des tests, tous deux dans le périmètre déjà prévu par [ARCHITECTURE.md § Stratégie de Tests](ARCHITECTURE.md#stratégie-de-tests) :
1. `EasyID3` combiné à `v2_version=3` a produit historiquement une frame `TDRC` v2.4 vide en plus du `TYER` v2.3 attendu (issue #188, fermée sans détail de correctif vérifiable). Écrire l'assertion sur le contenu réel du fichier, pas sur le retour de l'API
2. La casse du chunk WAV (`id3 ` vs `ID3 `) est une source d'incompatibilité avec d'autres outils, à documenter plutôt qu'à corriger

### 5. RapidFuzz
**Version actuelle** : `3.14.5` (2026-04-07)
**Stabilité** : ✅

**Breaking Changes Majeurs** :
- **3.0.0** : module `rapidfuzz.string_metric` supprimé, remplacé par `rapidfuzz.distance`
- **3.0.0** : `rapidfuzz.process` n'appelle plus les scorers avec `processor=None`, et les `**kwargs` vers le scorer sont supprimés
- **3.14.0** : Python 3.9 abandonné, wheels Linux 32 bits abandonnées, et correction de `WRatio` pour un ratio de longueur exactement égal à 8.0
- **3.14.6 (annoncée, non publiée au 2026-08-29)** : abandon de Python 3.10 et des wheels free-threaded 3.13

**Nouvelles Features Pertinentes** :
- SIMD sur `ratio`, `QRatio`, `Levenshtein`, `Indel`, `LCSseq` et `OSA`, gain réel sur les chaînes courtes en `cdist`
- `score_cutoff` court-circuite le calcul quand le score ne peut pas atteindre le seuil : à passer directement le plancher du projet pour économiser sur les candidats hors-jeu

**Compatibilité Écosystème** :
- Licence MIT, ce qui règle le problème de `fuzzywuzzy` / `python-Levenshtein` sous GPL
- Wheels `win_amd64` publiées pour cp310 à cp314, aucune compilation locale requise
- **Aucun hook PyInstaller ne couvre rapidfuzz**, contrairement à ce que laisse croire son entry point `pyinstaller40` : celui-ci s'appelle `tests` et pointe `rapidfuzz.__pyinstaller:get_PyInstaller_tests`, qui fournit des tests à PyInstaller et non un hook. Vérifié dans le venv du projet en 3.14.5 : `rapidfuzz/__pyinstaller/` ne contient que `__init__.py` et `test_rapidfuzz_packaging.py`, et `pyinstaller-hooks-contrib` n'expose pas de `hook-rapidfuzz.py`. L'extension native est collectée par l'analyse d'imports statiques, mais les cibles SIMD (`avx2`/`sse2`, issue #391) se chargent dynamiquement : le `.spec` déclare donc `collect_submodules("rapidfuzz")`, et le scoring se teste sur le binaire figé
- Livre un `py.typed`

**Recommandation** : ✅ Sur le choix de scorer, `WRatio` reste le défaut tout-usage pour du matching artiste/titre, mais `token_set_ratio` tolère mieux les mots surnuméraires (`Live`, `Remastered`, `feat.`) qui sont le cas courant sur Beatport. Le calibrage relève de l'implémentation, pas de la compatibilité.

### 6. httpx2
**Version actuelle** : `2.12.0` (2026-08-18)
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
- **PyInstaller** : aucun retour d'expérience documenté. Le passage à `truststore` supprime le besoin de bundler `certifi/cacert.pem` mais introduit des appels `ctypes` vers l'API Windows dans un binaire figé. À valider au premier build
- **Mocking** : voir [Conflits Potentiels](#conflits-potentiels), c'est le vrai point dur

**Recommandation** : ⚠️ Choix maintenu, mais la stratégie de test du client doit être tranchée avant l'[étape 3 du développement](ARCHITECTURE.md#ordre-de-développement), pas pendant.

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

**Recommandation** : ⚠️ Le risque n'est pas la version mais l'empaquetage : voir [Conflits Potentiels](#conflits-potentiels). Le test de sécurité déjà prévu (« la clé API n'apparaît ni dans les logs, ni dans les rapports, ni dans les payloads Sentry ») doit être doublé d'un **test de fumée sur le binaire figé**, pas seulement sur les sources.

### 8. sentry-sdk
**Version actuelle** : `2.68.1` (2026-08-24)
**Stabilité** : ✅

**Breaking Changes Majeurs** :
- **2.68.0** : `enable_logs` et `enable_metrics` deviennent des no-op, suppression à la prochaine majeure
- **Ce qui invalide les exemples en 1.x** : `with_locals` s'appelle désormais `include_local_variables`, et l'API Hub a cédé la place aux scopes. Pas de ligne 3.x à ce jour

**Compatibilité Écosystème** :
- Classifiers explicites pour Python 3.13 et 3.14
- `AsyncioIntegration` **n'est pas** dans les intégrations par défaut, elle s'ajoute à la main
- Livre un `py.typed`

**Les trois réglages de durcissement d'[ARCHITECTURE.md § Monitoring](ARCHITECTURE.md#monitoring) sont confirmés dans le code source du SDK** :

| Réglage | Défaut réel | Vérification |
|---|---|---|
| `include_local_variables` | `True` | `ClientConstructor.__init__` : `include_local_variables: Optional[bool] = True` |
| `server_name` | `None`, **mais** repli automatique sur le hostname | `client.py` : `if rv["server_name"] is None and hasattr(socket, "gethostname"): rv["server_name"] = socket.gethostname()` |
| `send_default_pii` | `None`, traité comme `False` | Ne pas activer |

- **`LoggingIntegration`** est active par défaut, avec `level=logging.INFO` pour les breadcrumbs et `event_level=logging.ERROR` pour les événements. Tout log INFO devient donc un breadcrumb attaché au prochain événement, y compris un chemin complet ou un titre de morceau. `level=None` coupe les breadcrumbs
- **Intégrations par défaut hors web** : `Argv`, `Atexit`, `Dedupe`, `Excepthook`, `Logging`, `Modules`, `Stdlib`, `Threading`. `ArgvIntegration` capture `sys.argv` et mérite d'être désactivée ici
- **Plan Developer gratuit** : 5 000 erreurs par mois, rétention 30 jours, un seul utilisateur. Doc officielle : « Events and attachments that exceed your quota will not be accepted »

**Recommandation** : ✅ Ajouter au périmètre de test : `include_local_variables=False` et `server_name` fixe se vérifient sur un événement construit, pas seulement par relecture de la config.

### 9. PyInstaller
**Version actuelle** : `6.22.2` (2026-08-17)
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

**Faux positifs antivirus** : la page wiki dédiée n'a pas pu être consultée (rendu JS cassé). **La signature de code n'est pas l'atténuation retenue ici** : elle suppose un certificat, écarté au vu du budget nul ([PRODUCTION.md § Code Signing](PRODUCTION.md#code-signing)). L'atténuation effective est le mode `--onedir`, qui évite l'extraction en dossier temporaire déclenchant les heuristiques. L'ampleur réelle se mesure après publication, sur une machine tierce, pas sur le poste de développement.

**Recommandation** : ✅

### 10. pytest et son écosystème
**Version actuelle** : `pytest 9.1.1` (2026-06-19), `pytest-asyncio 1.4.0`, `pytest-cov 7.1.0`, `anyio 4.14.2`
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
**Version actuelle** : `0.16.5` (2026-08-27)
**Stabilité** : ⚠️ (par le volume du changement de défauts, pas par la qualité de l'outil)

**Breaking Changes Majeurs** :
- **0.16.0** (2026-07-23) : « Ruff now enables a much larger set of rules by default (413, up from 59) ». Quelques règles sont au contraire retirées de ce jeu, dont E401, E402, la famille E7xx, F403, F405, F406 et F722
- **0.16.0** : `ruff format` formate désormais par défaut les blocs Python dans les fichiers Markdown
- **0.16.0** : les champs `filename`, `location` et `end_location` de la sortie JSON peuvent être `null`
- **0.16.0** : nouvelle syntaxe de suppression `# ruff: ignore` en fin de ligne, équivalente à `noqa`

**Compatibilité Écosystème** :
- `target-version = "py313"` et `"py314"` tous deux supportés
- **Le formateur ne trie pas les imports** : `ruff check --select I --fix` puis `ruff format`, dans cet ordre. La catégorie `I` reste hors du jeu par défaut même après l'expansion, tout comme `ANN`, `N` et `C90`
- **Règles incompatibles avec `ruff format`**, à exclure : `W191`, `E111`, `E114`, `E117`, `D203`, `D206`, `D300`, `Q000` à `Q004`, `COM812`, `COM819`, `ISC002`. `COM812` est le cas classique qui casse
- Doc officielle : « Ruff is a linter, not a type checker […] It's recommended that you use Ruff in conjunction with a type checker, like Mypy ». Aucun recouvrement avec le gate Mypy
- CI : `astral-sh/ruff-action@v4.1.0`, capable de lire la version cible depuis `uv.lock`

**Recommandation** : ⚠️ **Ne pas copier tel quel le `[tool.ruff]` de techno-scraper** si celui-ci est resté sur une version antérieure à 0.16 : le jeu de règles par défaut a changé d'un ordre de grandeur et le premier `ruff check` produira un diff ingérable. Partir de la config par défaut de 0.16.x, ajouter `I`, retirer `COM812`.

### 12. Mypy
**Version actuelle** : `2.3.1` (2026-08-15)
**Stabilité** : ✅

**Breaking Changes Majeurs** :
- **2.0** : `--local-partial-types` et `--strict-bytes` (PEP 688, `bytearray`/`memoryview` ne sont plus assignables à `bytes`) activés par défaut, `--allow-redefinition` adopte la sémantique de `--allow-redefinition-new`, Python 3.9 abandonné, narrowing plus agressif
- **2.2** : les types de retour explicites de `__new__()` sont désormais respectés, ce qui peut révéler des erreurs latentes. TypedDict fermés (PEP 728)
- **2.3** : parser natif expérimental derrière `--native-parser`. Les attributs d'instance déclarés `Final` deviennent read-only **à l'exécution**, c'est un changement de comportement runtime, pas seulement statique

**Compatibilité Écosystème** :
- **Aucune dépendance du projet n'exige de stub externe** : `mutagen`, `rapidfuzz`, `httpx2`, `keyring`, `pydantic` et `sentry-sdk` livrent tous un `py.typed`. Ni paquet `types-*`, ni `ignore_missing_imports` à écrire
- `strict = true` active 13 flags mais **pas** `warn_unreachable`, ni la famille `disallow_any_unimported` / `disallow_any_expr` / `disallow_any_decorated` / `disallow_any_explicit`
- Les alternatives récentes ne conviennent pas à un gate bloquant : `ty` (Astral) annonce des changements de diagnostics entre deux versions quelconques, et `pyrefly` (Meta) manque de recul d'usage vérifiable

**Recommandation** : ✅ Ajouter `warn_unreachable = true` au-delà de `strict`. Après le premier passage, tourner une fois avec `--warn-unused-ignores` pour repérer les `# type: ignore[code]` devenus obsolètes.

## Frontend

### 1. Angular
**Version actuelle** : runtime `@angular/*` en `22.1.4`, outillage `@angular/cli` et `@angular/build` en `22.1.6`
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

**Compatibilité Écosystème** :
- `engines` : Node `^22.22.3 || ^24.15.0 || ^26.0.0`, TypeScript `>=6.0.0 <6.1.0`, RxJS `^6.5.3 || ^7.4.0`
- `ng build` produit `dist/<app>/browser`, à pointer directement en `frontendDist` dans `tauri.conf.json`. Aucun serveur Node au runtime
- pnpm supporté nativement : `ng new --package-manager pnpm`, ou champ `cli.packageManager` d'`angular.json`
- Vitest promu stable en v21 : « we decided on Vitest as our new default test runner, and are promoting it to stable in Angular v21 »

**Recommandation** : ✅ Le passage d'OnPush en défaut est sans incidence, l'état passant entièrement par des signals et ngx-translate documentant la compatibilité OnPush de son pipe. Le point à surveiller est ailleurs : Angular 22 verrouille TypeScript sur la ligne 6.0.

### 2. TypeScript
**Version actuelle** : `6.0.x` (retenue) / `7.0.2` (dernière stable, **inutilisable ici**)
**Stabilité** : ✅ sur 6.0.x

**Breaking Changes Majeurs** :
- **6.0** : `strict` à `true` par défaut, `module=esnext`, `target=es2025`, `types=[]` (ne charge plus tous les `@types` automatiquement). Dépréciation de `target es5`, `moduleResolution node`, `baseUrl`. Suppression de `module amd/umd/systemjs`, `moduleResolution classic`, `outFile`. Flag `--ts6-migration` pour l'analyse statique
- **7.0 (Corsa, compilateur natif Go)** : rend ces ruptures définitives, et surtout **l'API programmatique du compilateur n'existe pas dans `tsgo`**, elle est annoncée pour 7.1

**Compatibilité Écosystème** :
- **Angular 22 exige `>=6.0.0 <6.1.0`**. La demande d'élargissement à TS 7 a été fermée en `not planned` (angular/angular#69704)
- `typescript-eslint` 8.x déclare `typescript: >=4.8.4 <6.1.0`, et son parseur crashe réellement sous TS 7, pas seulement un avertissement de peer dependency
- `@tauri-apps/api` 2.11.1 ne déclare aucune contrainte : TypeScript n'y apparaît qu'en `devDependency`

**Recommandation** : ✅ Rester sur **6.0.x**. TS 7 casse simultanément `@angular/compiler-cli` et `typescript-eslint`, soit le build et le lint. Ce n'est pas un arbitrage, c'est un blocage. Réévaluable quand TS 7.1 aura restauré l'API programmatique et qu'Angular aura élargi sa contrainte.

### 3. Node.js
**Version actuelle** : `24.x` (Krypton, Active LTS, minimum `24.15.0`) / `26.x` (Current depuis le 2026-05-05, Active LTS planifiée au 2026-10-28)
**Stabilité** : ✅

**Calendrier** :

| Ligne | Statut | Maintenance | EOL |
|---|---|---|---|
| 20.x (Iron) | ❌ EOL | — | 2026-04-30 |
| 22.x (Jod) | Maintenance LTS | depuis 2025-10-21 | 2027-04-30 |
| 24.x (Krypton) | **Active LTS** | à partir de 2026-10-20 | 2028-04-30 |
| 26.x | Current, **Active LTS le 2026-10-28** | 2027-10-20 | 2029-04-30 |

**Breaking Changes Majeurs** :
- **Corepack retiré de la distribution Node à partir de la 25.x** et absent de la 26.0.0 (vote du TSC, PR nodejs/node#57617). Le pattern `packageManager` + `corepack enable` fonctionne encore sur 22 et 24, mais **cassera silencieusement au passage sur Node 26**
- **22.20.0** : OpenSSL bundlé passé de 3.0.x à 3.5.2, OpenSSL 3.0.x sortant de support en septembre 2026. Tout pin sur 22.x doit être ≥ 22.20.0

**Compatibilité Écosystème** :
- Angular 22 : `^22.22.3 || ^24.15.0 || ^26.0.0`
- pnpm 11.x exige Node `>=22.13`, pnpm 10.x exige `>=18.12`
- Vitest 4.1.x : `^20.0.0 || ^22.0.0 || >=24.0.0`
- `@tauri-apps/cli` : `>= 10`, sans contrainte réelle (le binaire Tauri est en Rust)

**Recommandation** : ✅ **24.x maintenant, 26.x à partir du 2026-10-28.**

C'est la seule entrée de ce document où la dernière version n'est pas retenue sans qu'une incompatibilité soit en cause, et le motif mérite d'être explicite. Node 26 est sorti depuis mai 2026 et fonctionnerait très bien : Angular 22 la déclare dans ses `engines`, pnpm 11 exige `>=22.13`, Vitest 4.1 accepte `>=24`. Mais **Node n'est pas une dépendance du produit, c'est un outil de build** : il n'est jamais embarqué dans le binaire distribué, contrairement à l'interpréteur Python que PyInstaller empaquette. Aucune fonctionnalité de la 26 n'est exploitée par la chaîne de build, donc la prendre avant son passage LTS achèterait le flux de breaking changes d'une ligne Current sans rien gagner en échange.

La bascule d'octobre coûte une ligne (`runtime: node@24` devient `runtime: node@26` dans `pnpm/setup`) plus le champ `engines`. À déclencher sur la confirmation du passage LTS, pas sur la date annoncée : le calendrier Node a déjà glissé par le passé.

Le corollaire n'est pas optionnel : sur la ligne 26, **Corepack n'existe plus**, donc `corepack enable` échouera. Ce n'est pas un problème puisque le projet ne l'utilise pas, mais c'est la raison pour laquelle la chaîne d'installation doit être posée correctement **dès maintenant**. La version de Node est posée par `pnpm/setup` via son input `runtime: node@24`, qui remplace `actions/setup-node` : ne jamais s'en remettre au Node préinstallé sur l'image du runner, qui change au fil de ses mises à jour.

### 4. pnpm
**Version actuelle** : `11.24.0` (dist-tag `latest`) / `12.1.0` (réécriture Rust, dist-tag `next-12`)
**Stabilité** : ✅

**Breaking Changes Majeurs** :
- **11.0.0** (2026-04-28) : Node `>=22.13` requis, distribution ESM pure. `onlyBuiltDependencies` et ses variantes remplacées par un unique `allowBuilds`. `.npmrc` restreint à l'auth et au registry, le reste migre vers `pnpm-workspace.yaml`. Variables `npm_config_*` renommées `pnpm_config_*`. `minimumReleaseAge` passe à 1440 minutes et `blockExoticSubdeps` à `true`
- **12.0.0** (2026-08-26) : réécriture en Rust, **format de lockfile inchangé**. Le blog officiel prévient : « pnpm 12 is stable » mais « is deliberately not a migration »

**Ce que la migration 10 → 11 coûte réellement sur ce projet** : moins de dix lignes. `allowBuilds: { esbuild: true }` remplace `onlyBuiltDependencies: [esbuild]` (esbuild étant tiré par `@angular/build`), et les réglages non-auth du `.npmrc` déménagent dans un `pnpm-workspace.yaml`, à créer même sans monorepo. Le renommage `npm_config_*` n'a d'effet que si la CI pilote pnpm par variables d'environnement, ce qui n'est pas le cas ici.

**Le lockfile multi-document est conditionnel, pas systématique.** C'est le point le plus mal compris de cette version. Doc officielle : « `pnpm-lock.yaml` is a YAML file, but it is not always a **single** YAML document. Depending on what the project uses, pnpm writes either one document or two ». Trois déclencheurs seulement :

| Déclencheur | Présent ici ? |
|---|---|
| `configDependencies` dans `pnpm-workspace.yaml` | Non |
| `devEngines.packageManager` dans `package.json` | **Écrit par défaut par `pnpm init` sous pnpm 11+** |
| Champ legacy `packageManager` | Selon la doc, seulement en pinnant pnpm 12+, mais un cas réel en 11.0.3 le déclenche aussi |

Autrement dit, **le projet scaffoldé par défaut tombe dans le cas cassant**, et c'est bien ce qui arriverait ici sans le retrait explicite prescrit en [Configuration Recommandée](#packagejson). Ce n'est pas pnpm 11 en soi qui casse le graphe de dépendances, c'est le champ que `pnpm init` écrit. `lockfileVersion` reste `'9.0'` dans les deux documents, et en pnpm 12 également.

**Compatibilité Écosystème** :
- **Angular CLI tourne déjà sur pnpm 11 en interne** : le dépôt `angular/angular-cli` bump sa propre version de pnpm de 11.20.0 à 11.24.0 sur `main` et sur la branche 22.1.x, sans régression documentée
- Aucun `node-linker=hoisted` n'est nécessaire, le résolveur strict par défaut convient
- **Dependabot ne suit pas.** Voir la fiche [Renovate](#6-renovate), qui est la réponse retenue
- CI : `pnpm/setup@v2.1.0`, qui **exige pnpm 11 ou plus récent**. `pnpm/action-setup` reste l'action des versions ≤ 10, et son README pointe lui-même vers son successeur

**Recommandation** : ✅ **11.24.0**, ce que pointe `latest`. pnpm 12 a trois jours d'existence, vit sous un dist-tag de pré-adoption, et son propre blog le présente comme un changement à instruire et non comme une montée de version : le prendre serait dépasser « la dernière stable », pas l'appliquer. À réévaluer dès que `latest` basculera sur la ligne 12.

> ⚠️ **Piège de CI à désamorcer avant le premier build.** `minimumReleaseAge` à 24 h combiné à `pnpm install --frozen-lockfile` fait échouer la CI quand un bot vient de regénérer un lockfile pointant une dépendance transitive publiée dans les dernières 24 heures. Le cas est documenté sur Angular avec `caniuse-lite`, via la chaîne browserslist, et se solde par `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`. `--frozen-lockfile` ne fait que vérifier, sans repli possible. Deux parades : aligner le `minimumReleaseAge` de Renovate sur celui de pnpm pour que les deux fenêtres coïncident, et garder `minimumReleaseAgeExclude` pour les paquets qui se republient trop souvent.

### 5. PrimeNG
**Version actuelle** : `22.1.0`
**Stabilité** : ❌ (sur le modèle de licence, pas sur la qualité technique)

**Breaking Changes Majeurs** :
- **v22 supprime toutes les API dépréciées en v20 et v21** : « In v22, the APIs that were deprecated in v20 and v21 are now removed ». Disparaissent notamment `TabMenu`, `TabView`, `Chips`, `Steps`, `InlineMessage`, `Messages`, `AccordionTab`, `pDefer`, `Calendar`, `Dropdown`, `InputSwitch`, `OverlayPanel`, `Sidebar`
- **v22** : directive `pTemplate` supprimée (`ng-template` + variable de référence), `styleClass` supprimé sur les composants host-enabled (utiliser `class`), sélecteurs camelCase supprimés (kebab-case obligatoire)
- **v22** : la base rem passe de 14px à 16px, avec un variant `-compat` par preset maintenu jusqu'en juin 2027
- **v22** : le système d'icônes bascule sur `@primeicons/angular ^8.0.0`, des composants Angular standalone rendant du SVG inline
- `MultiSelect`, `PanelMenu`, `Password`, `Galleria` et `ColorPicker` sont dépréciés mais **pas encore supprimés**, suppression annoncée en v24

**Compatibilité Écosystème** :
- `peerDependencies` de 22.1.0 : `@angular/core`, `common`, `forms`, `router`, `platform-browser` et `cdk` en `^22.1.0`. **La contrainte est `^22.1.0`, pas `22.x`** : un projet resté sur Angular 22.0.0 déclencherait un avertissement de peer dependency. `@angular/cdk` n'étant tiré par aucun autre paquet, il est à déclarer explicitement
- Dépendances directes : `@primeuix/utils`, `@primeuix/motion`, `@primeuix/styled`, `@primeuix/styles ^3.0.0`, `@primeicons/angular ^8.0.0`, `@primeui/license-manager`
- **Tabs et router** : aucune suppression formelle d'un « mode router » dans le guide de migration, mais plusieurs issues ouvertes (#17563, #17505, #11999) décrivent l'état actif d'onglet non synchronisé avec `routerLink`. La dizaine de lignes de dérivation depuis l'URL prévue par [ARCHITECTURE.md § Navigation](ARCHITECTURE.md#navigation) reste donc la bonne approche

**Recommandation** : ⚠️ **Retenu, l'[ADR-003](adrs/003-primeng-community-license.md) ayant déjà instruit l'archivage du dépôt et la Community License.** Un seul point lui échappe, à ajouter à ses Négatives : le paquet d'icônes bascule sous la même licence, ce qui étend la dépendance à PrimeTek au-delà des composants (cf. [Conflits Potentiels](#conflits-potentiels)).

### 6. @primeuix/themes
**Version actuelle** : `3.0.0`
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
**Version actuelle** : `@primeicons/angular 8.0.0` (tiré par PrimeNG) / `primeicons 8.0.0` (CSS, sous licence) / `primeicons 7.0.0` (dernière MIT, 2024-03-29)
**Stabilité** : ❌

**Breaking Changes Majeurs** :
- **8.0.0** (2026-07-15) : passage sous « PrimeUI License ». Verbatim du `LICENSE.md` du paquet : « A valid license key is required to use this software. License verification is performed offline, with no telemetry and no remote connection »
- Le dépôt `primefaces/primeicons` a été archivé le 2026-06-28
- **v22 de PrimeNG** retire son ancien paquet `primeng/icons` au profit de `@primeicons/angular`, des composants SVG standalone

**Compatibilité Écosystème** :
- `primeng@22.1.0` déclare `@primeicons/angular ^8.0.0` en dépendance directe. Le paquet CSS `primeicons` (classes `pi pi-*`) **n'est pas** dans ses dépendances : il faut le déclarer soi-même pour l'utiliser
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
- **Aucune publication depuis mars 2025**, soit avant PrimeNG 22 (base 16px, icônes SVG) et avant Tailwind 4.2/4.3. Le dépôt reste public et non archivé, contrairement à celui de PrimeNG

**Recommandation** : ⚠️ Retenu, avec une vérification visuelle dès la première page composée : le plugin ne consomme que des variables CSS générées par PrimeNG, ce qui rend une rupture peu probable, mais rien ne l'atteste depuis 17 mois. Repli sans coût si besoin : consommer directement les variables CSS de PrimeNG dans `@theme`.

### 10. @fontsource-variable/inter
**Version actuelle** : `5.3.0` (2026-07-19)
**Stabilité** : ✅

**Breaking Changes Majeurs** :
- Aucun depuis 5.2.8. La dernière rupture structurelle est la migration v4 → v5 : scission des polices variables sous le scope `@fontsource-variable/*` et correction du nom de famille (`InterVariable` devient `Inter Variable`, avec l'espace)

**Compatibilité Écosystème** :
- Import unique dans `main.ts` : `import '@fontsource-variable/inter/wght.css';`, qui couvre l'axe `wght` de 100 à 900 en romain. Ajouter `wght-italic.css` seulement si de l'italique est réellement utilisé
- **Aucune entrée `angular.json` requise** : les `url()` du CSS sont résolus par esbuild comme n'importe quel asset, et les `.woff2` sortent en fichiers hashés
- Poser `font-family: 'Inter Variable', sans-serif;` sur `:root`, le preset Aura n'en déclarant aucune
- Licence SIL OFL 1.1 : redistribution libre dans un installeur Windows, à condition de conserver le fichier de licence

**Recommandation** : ✅

### 11. ngx-translate
**Version actuelle** : `@ngx-translate/core 18.0.0` et `@ngx-translate/http-loader 18.0.0`
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
- **Chargement des traductions dans Tauri** : la webview sert le `frontendDist` en same-origin (`tauri://localhost`), donc un `HttpClient.get()` relatif fonctionne sans passer par le protocole `asset:` ni le plugin `fs`
- **Piège de chemin** : la doc ngx-translate signale que « In newer versions of Angular, the assets folder is no longer used. Instead, translations are stored in the public folder ». Vérifier le `prefix` contre la configuration réelle d'`angular.json`

**Recommandation** : ✅ L'[ADR-004](adrs/004-i18n-ngx-translate.md) tient. Le projet démarrant de zéro, écrire directement l'API v18 (providers standalone, `fallbackLang`), sans jamais recopier un exemple à base de `TranslateModule.forRoot()`.

### 12. @tauri-apps/api et plugins JS
**Version actuelle** : `@tauri-apps/api 2.11.1`
**Stabilité** : ✅

| Paquet npm | Version | Publication |
|---|---|---|
| `@tauri-apps/plugin-shell` | `2.3.5` | 2026-02-03 |
| `@tauri-apps/plugin-dialog` | `2.7.2` | 2026-07-18 |
| `@tauri-apps/plugin-fs` | `2.5.1` | 2026-05-02 |
| `@tauri-apps/plugin-store` | `2.4.4` | 2026-07-18 |
| `@tauri-apps/plugin-os` | `2.3.2` | 2025-10-27 |
| `@tauri-apps/plugin-opener` | `2.5.4` | 2026-05-02 |
| `@tauri-apps/plugin-updater` | `2.10.1` | 2026-04-04 |
| `@tauri-apps/plugin-single-instance` | **n'existe pas** | — |

**Breaking Changes Majeurs** :
- `@tauri-apps/api/shell` supprimé au profit de `@tauri-apps/plugin-shell`. Idem pour `dialog`, `fs`, `os` et `updater`
- L'`allowlist` de `tauri.conf.json` est remplacée par les capabilities
- Renommages `fs` : `createDir` → `mkdir`, `readBinaryFile` → `readFile`, `removeFile` → `remove`
- Updater : « The built-in dialog with an automatic update check was removed », la vérification et l'interface sont désormais à écrire

**Compatibilité Écosystème** :
- **Les versions npm et crate sont strictement identiques plugin par plugin** (même monorepo, release simultanée). En revanche `@tauri-apps/api` 2.11.1 et la crate `tauri` 2.11.5 ne suivent pas la même cadence de patch, ce qui est normal
- **`single-instance` n'a aucune API JS** : « this Plugin currently does not have JavaScript APIs, you do not have to configure capabilities to use it ». Rien à installer côté pnpm, seulement la crate côté cargo
- `Command.sidecar(program, args?, options?)` retourne un `Command`. `spawn()` donne un `Child` réutilisable pour `child.write()` sur stdin et `child.kill()`. Les événements sont `command.stdout.on('data')`, `command.stderr.on('data')`, `command.on('close')` et `command.on('error')`
- **`spawn()` et non `execute()`** : `execute()` attend la fin du process et collecte la sortie, ce qui est incompatible avec un sidecar long. C'est cohérent avec le choix de `shell:allow-spawn` d'[ARCHITECTURE.md § Capacités Natives](ARCHITECTURE.md#capacités-natives)

**Issues à connaître** :
- `plugins-workspace#2418` : « program not allowed on the configured shell scope » malgré une capability correcte en apparence, dû à un décalage entre le `name` déclaré et celui utilisé côté JS
- `plugins-workspace#687` : les arguments passés dynamiquement depuis le JS peuvent être ignorés au profit de ceux figés dans la configuration. Statut de correction non vérifié sur la 2.3.5

**Recommandation** : ✅

### 13. @sentry/angular
**Version actuelle** : `10.72.0` (2026-08-28)
**Stabilité** : ✅

**Breaking Changes Majeurs** :
- **v8** : `@sentry/angular-ivy` supprimé, fusionné dans `@sentry/angular`. Les intégrations deviennent des fonctions `xxxIntegration()` au lieu de classes `Integrations.XXX`
- **v9** : `getCurrentHub()`, `Hub`, `enableTracing` et `autoSessionTracking` supprimés au profit des scopes. ES2020 et TypeScript ≥ 5.0.4 requis
- **v10** : la capture de l'IP est entièrement pilotée par `sendDefaultPii`. Renommages `BaseClient` → `Client`, `logger` → `debug`

**Compatibilité Écosystème** :
- `peerDependencies` : `@angular/core >= 14.x <= 22.x`. Angular 22 est dans la fenêtre
- **Intégrations actives par défaut** : `breadcrumbs`, `browserApiErrors`, `browserSession`, `dedupe`, `functionToString`, `globalHandlers`, `httpContext`, `inboundFilters`, `linkedErrors`. `browserTracing` et `replay` sont **opt-in** : ne pas les ajouter suffit à ce qu'aucun tracing ni replay ne parte
- `httpContextIntegration` envoie toujours l'URL complète de la requête, soit ici `tauri://localhost/...`. Pas de donnée personnelle, mais la route interne est exposée. `beforeSend` la retire si besoin
- **Zoneless** : aucune déclaration officielle de Sentry sur le comportement en Angular zoneless. L'`ErrorHandler` ne dépend pas de Zone.js, donc le cas d'usage retenu ici n'est pas concerné. L'issue `sentry-javascript#8983` (le `finalTimeout` du tracing bloque la stabilisation de `NgZone`) ne s'applique qu'avec `browserTracingIntegration`, non utilisée
- Aucune documentation Sentry ne couvre Tauri : le SDK fonctionne comme dans n'importe quelle webview, sans enrichissement du contexte machine côté Rust

**Recommandation** : ✅ Ne pas activer `browserTracing`, ne pas activer `sendDefaultPii`. Les deux défauts sont déjà les bons.

### 14. Vitest
**Version actuelle** : `4.1.11` (2026-08-18)
**Stabilité** : ✅

**Breaking Changes Majeurs** :
- **4.0** : browser mode réécrit sur une architecture de providers, `instances` remplace `browser.name`. `workspace` renommé `projects`. Suppression d'API dépréciées dont `poolMatchGlobs`. Les défauts du sérialiseur de snapshots changent (régénérer avec `vitest run -u`)

**Compatibilité Écosystème** :
- **Runner par défaut du CLI Angular 22** via `@angular/build:unit-test` : « This guide covers the default testing setup for new Angular CLI projects, which uses Vitest ». Stable pour un nouveau projet, ce qui est le cas ici
- `@analogjs/vitest-angular` n'est plus nécessaire, le builder natif suffit
- DOM : jsdom par défaut, happy-dom détecté automatiquement s'il est installé. Aucune préférence tranchée par Angular
- Angular 22 ajoute les flags `--quiet` et `--isolate`, et le support de `fakeAsync`/`flush`/`waitForAsync` sous Vitest

**Point de vigilance** : la limitation « configuration Vitest personnalisée non supportée », documentée pour Angular 20, n'a pas pu être reconfirmée pour la 22. À vérifier si les tests du flux NDJSON exigent une configuration particulière.

**Recommandation** : ✅

### 15. angular-eslint
**Version actuelle** : `22.1.0` (2026-07-12)
**Stabilité** : ✅

**Breaking Changes Majeurs** :
- **22.0.0** : Angular 22 et TypeScript 6 requis, Node 20 abandonné
- **ESLint 8 et le format `.eslintrc` sont totalement supprimés** : `eslint: ^9.0.0 || ^10.0.0` en peer dependency, flat config `eslint.config.js` obligatoire
- Règle `no-conflicting-lifecycle` supprimée
- `prefer-on-push-component-change-detection` change de sens : OnPush étant le défaut en Angular 22, la règle ne signale plus que les opt-out explicites. Elle a rejoint le preset `recommended`, donc de nouveaux avertissements peuvent apparaître
- **22.1.0** : nouvelles règles `prefer-service-decorator`, `inject-at-top`, `require-switch-default`, `no-outerhtml`

**Compatibilité Écosystème** :
- Le paquet suit la majeure d'Angular : `@angular/cli >= 22.0.0 < 23.0.0`
- `typescript-eslint ^8.0.0` (dernière 8.68.0), qui contraint TypeScript à `>=4.8.4 <6.1.0`
- **Les règles d'accessibilité ne sont pas dans `recommended`** : il faut étendre explicitement les deux presets, `angular.configs.templateRecommended` **et** `angular.configs.templateAccessibility`. C'est ce dernier qui apporte `alt-text`, `click-events-have-key-events`, `interactive-supports-focus`, `label-has-associated-control`, `role-has-required-aria`, `valid-aria`
- `eslint-config-prettier` reste nécessaire : angular-eslint ne désactive pas ses règles stylistiques

**Recommandation** : ✅ Installation par `ng add angular-eslint` (le paquet umbrella), pas par les paquets `@angular-eslint/*` séparés.

### 16. Prettier et prettier-plugin-tailwindcss
**Version actuelle** : `prettier 3.9.6` (2026-07-21), `prettier-plugin-tailwindcss 0.8.1` (2026-07-15)
**Stabilité** : ✅

**Breaking Changes Majeurs** :
- Prettier reste en ligne 3.x, aucune 4.0 stable (seulement des alphas sous le tag `next`)
- **plugin 0.8.0** : « Require at least Prettier 3.7.x »
- **plugin 0.7.0** : Tailwind v4 devient le comportement de repli par défaut au lieu de v3
- **prettier 3.9.4** : le parser Angular reformate `@content(name)` en `@content (name)`

**Compatibilité Écosystème** :
- **Tailwind v4 sans `tailwind.config.js`** : « When using Tailwind CSS v4 you must specify your CSS file entry point […] use the `tailwindStylesheet` option in your Prettier configuration. Note that paths are resolved relative to the Prettier configuration file »
- Le tri des classes couvre nativement `class`, `className`, `:class` et `[ngClass]`
- Le dépôt Prettier suit activement `@angular/compiler` 22.1.x, signe d'un support à jour du parser Angular

**Recommandation** : ✅

## Partagé / Infrastructure

### 1. Tauri v2
**Version actuelle** : crate `tauri 2.11.5` (2026-07-01), `tauri-build 2.6.3` (2026-06-17), `@tauri-apps/cli 2.11.4` (2026-06-28)
**Stabilité** : ✅

**Les quatre paquets ne partagent pas le même numéro.** Chaque crate et chaque paquet npm du monorepo a son propre cycle de patch, seule la compatibilité semver (`^2`) compte. Combo stable confirmé : `tauri 2.11.5` + `tauri-build 2.6.3` + `@tauri-apps/cli 2.11.4` + `@tauri-apps/api 2.11.1`.

**Breaking Changes Majeurs** (dans la ligne v2) :
- **2.3.0** : `Manager::unmanage` déprécié pour corriger un use-after-free
- **2.6.0** : le code de manipulation HTML de `tauri-utils` passe derrière un feature flag
- **2.11.4** : `time` avait été épinglé à `<0.3.52`, dépinglé en 2.11.5. Un lockfile figé sur 2.11.4 peut en hériter

**Compatibilité Écosystème** :
- **MSRV** : 1.77.2 pour la crate `tauri`, 1.85 pour la branche edition 2024 de `tauri-build`. Rust 1.98 satisfait les deux
- **Windows** : « Tauri uses Microsoft Edge WebView2 to render content on Windows », préinstallé depuis Windows 10 build 1803. Build Tools C++ (workload « Desktop development with C++ ») et toolchain MSVC requis
- **Sidecar** : la doc cite explicitement « Python CLI apps or API servers bundled with PyInstaller » comme cas d'usage d'`externalBin`. Le suffixe target-triple s'obtient par `rustc --print host-tuple` (flag disponible depuis Rust 1.84.0). **`externalBin` ne gère qu'un exécutable** : le dossier `_internal/` d'un build `--onedir` passe par `bundle.resources`, **en forme objet** (`{ "binaries/_internal": "_internal" }`), seule forme qui le pose à côté de l'exécutable. `resolveResource()` n'y sert à rien : le bootloader `--onedir` cherche son dossier de contenu relativement à l'exe, sans passer par l'API Tauri
- **`assetProtocol`** : `{ "enable": true, "scope": ["$APPCACHE/covers/*"] }`, plus une CSP dont `img-src` doit inclure `'self' asset: http://asset.localhost blob: data:`. Côté webview, `convertFileSrc(filePath)` produit l'URL à poser dans le `src`
- **Updater** : le `latest.json` minimal ne requiert que `version`, `platforms.[target].url` et `platforms.[target].signature`. La signature vient de `TAURI_SIGNING_PRIVATE_KEY` (chemin ou contenu, **jamais un `.env`**) et la `pubkey` de `tauri.conf.json` doit être le contenu de la clé publique, pas un chemin
- **NSIS et MSI sont tous deux compatibles avec l'updater** : « MSI and NSIS installers receive signatures and can be used with the updater ». NSIS a deux avantages : le mode `downloadBootstrapper` pour WebView2, et la cross-compilation possible, là où le MSI (WiX) « can only be created on Windows »

**Recommandation** : ✅ Retenir **NSIS** comme format de bundle. La cross-compilation n'a pas d'usage immédiat (Windows seul au MVP, cf. [ADR-015](adrs/015-cibles-distribution-windows.md)) mais le bootstrapper WebView2 est un filet de sécurité gratuit chez un utilisateur dont l'installation Windows serait incomplète.

### 2. Plugins officiels Tauri v2
**Version actuelle** : une par crate, voir le tableau ci-dessous
**Stabilité** : ✅

| Crate | Version | Publication | Exige `tauri` |
|---|---|---|---|
| `tauri-plugin-shell` | `2.3.5` | 2026-02-03 | `>=2.10.0, <3.0.0` |
| `tauri-plugin-dialog` | `2.7.2` | 2026-07-18 | `>=2.10.0, <3.0.0` |
| `tauri-plugin-fs` | `2.5.1` | 2026-05-02 | `>=2.10.0, <3.0.0` |
| `tauri-plugin-store` | `2.4.4` | 2026-07-18 | `>=2.10.0, <3.0.0` |
| `tauri-plugin-os` | `2.3.2` | 2025-10-27 | `>=2.8.2, <3.0.0` |
| `tauri-plugin-opener` | `2.5.4` | 2026-05-02 | `>=2.10.0, <3.0.0` |
| `tauri-plugin-single-instance` | `2.4.3` | 2026-07-13 | `>=2.10.0, <3.0.0` |
| `tauri-plugin-updater` | `2.10.1` | 2026-04-04 | `>=2.10.0, <3.0.0` |

**Breaking Changes Majeurs** :
- **`updater` 2.5.0** : `UpdaterBuilder::new` supprimé au profit de `UpdaterExt::updater_builder`. Concerne l'usage Rust bas niveau, pas l'API JS
- **`fs` et `store` 2.0.0-beta.5** : les chemins renvoyés au frontend sur Windows ne portent plus le préfixe UNC `\\?\`

**Compatibilité Écosystème** :
- Toutes les crates exigent `tauri` en `>=2.10.0, <3.0.0`, sauf `os` en `>=2.8.2`. La 2.11.5 retenue satisfait les deux bornes
- **Les versions crate et npm sont strictement identiques plugin par plugin**, release simultanée du même monorepo
- MSRV 1.77.2 pour toutes, très en deçà de la toolchain retenue

**Points structurants** :
- **`single-instance` doit être enregistré en premier**, verbatim : « The Single Instance plugin must be the first one to be registered to work well. This assures that it runs before other plugins can interfere ». Le `lib.rs` de cinq lignes doit donc respecter cet ordre
- **`fs`** : « permissions alone do not grant a scope ». Activer `fs:allow-read` sans déclarer de chemin produit une erreur runtime `forbidden path`. Les variables `$HOME`, `$APPDATA`, `$TEMP` sont disponibles, et `deny` prime sur `allow`
- **`updater` sur Windows** : signatures obligatoires et non désactivables, et l'application se ferme automatiquement à l'installation (limitation des installeurs Windows). Un hook `on_before_exit` permet de nettoyer avant. Trois modes : `passive` (défaut), `basicUi`, `quiet`
- **`opener`** : `opener:allow-reveal-item-in-dir` pour le bouton « ouvrir le dossier de logs », `opener:allow-open-url` avec un scope glob pour le lien vers la fiche source
- **`store`** : fichier JSON, chemin défini par l'appelant au `load()`, résolu dans le répertoire app data. API asynchrone en v2, `LazyStore` pour l'initialisation différée

**Recommandation** : ✅ Deux zones grises restent à lever à l'implémentation, aucune n'est bloquante :
1. La syntaxe exacte de `shell:allow-spawn` restreinte à un sidecar (`"sidecar": true`) n'a pas été confirmée verbatim : seul l'exemple analogue sur `shell:allow-execute` l'est. À vérifier dans les exemples officiels du dépôt avant d'écrire la capability
2. Le format retourné par `locale()` du plugin `os` n'est documenté que par renvoi vers la référence JavaScript. Le format BCP-47 attendu par [ARCHITECTURE.md § i18n](ARCHITECTURE.md#i18n) est à confirmer au premier lancement, la règle « commence par `fr` » étant de toute façon tolérante

### 3. Rust
**Version actuelle** : `1.98.0` (2026-08-20), canal stable
**Stabilité** : ✅

**Breaking Changes Majeurs** :
- Édition 2024 stabilisée en 1.85.0 et générée par défaut par `cargo new`
- Clippy déplace régulièrement des lints entre catégories : **le même code peut passer ou échouer selon la toolchain du runner**

**Compatibilité Écosystème** :
- MSRV Tauri : 1.77.2 pour le core, 1.85 pour `tauri-build` en édition 2024. Large marge
- Rust 1.98.0 est **préinstallé sur les images Windows des runners GitHub**
- Cache CI : `Swatinem/rust-cache@v2.9.2`, d'autant plus rentable ici que le rapport dépendances / code propre est extrême
- Renovate met à jour `Cargo.toml` et `Cargo.lock` en déléguant à cargo

**Recommandation** : ✅ Poser un `rust-toolchain.toml` épinglant la stable utilisée. Le code Rust étant une zone morte de cinq lignes, la seule chose que la CI peut casser est un lint Clippy nouvellement promu, et Clippy déplace régulièrement des lints entre catégories. L'épinglage rend ce risque explicite au lieu de le laisser survenir au gré des mises à jour d'image de runner.

### 4. GitHub Actions
**Version actuelle** : voir le tableau des actions ci-dessous, relevé au 2026-08-29
**Stabilité** : ✅

| Action | Version | Notes |
|---|---|---|
| `actions/checkout` | `v7.0.1` (2026-07-17) | v7 : migration ESM, blocage du checkout de PR de fork sur `pull_request_target` |
| `actions/setup-node` | `v7.0.0` (2026-07-14) | **Non utilisé** : `pnpm/setup` installe aussi le runtime Node |
| `actions/setup-python` | `v7.0.0` (2026-07-20) | Non utilisé si uv gère l'interpréteur |
| `pnpm/setup` | `v2.1.0` (2026-08-28) | Installe pnpm et Node en une étape. **Exige pnpm 11+.** Pin explicite : le tag flottant `@v2` traîne sur la v2.0.2, et le correctif de chemin de cache Windows date de la v2.0.1 |
| `astral-sh/setup-uv` | `v10.0.1` | La doc CI d'Astral montre encore la v9, elle est en retard |
| `dtolnay/rust-toolchain` | `@stable` | Pas de semver : la révision **est** la sélection. Le `rust-toolchain.toml` du dépôt prime ensuite sur ce choix |
| `Swatinem/rust-cache` | `v2.9.2` (2026-08-06) | Supporte le layout de build Cargo V2 |
| `tauri-apps/tauri-action` | `v1.0.0` (2026-06-29) | v1 abandonne Tauri v1, supprime `includeRelease`/`includeDebug`, renomme `assetNamePattern` en `releaseAssetNamePattern` |
| `googleapis/release-please-action` | `v5.0.0` (2026-04-22) | v5 : passage au runtime Node 24 |

**Breaking Changes Majeurs** :
- `actions/upload-artifact@v3` dépréciée depuis le 2024-11-30, à ne jamais reprendre d'un exemple ancien
- **`windows-latest` ne pointe plus sur Windows Server 2022** mais sur Windows Server 2025 avec Visual Studio 2026

**Compatibilité Écosystème** :
- **Runners Windows** : Rust 1.98.0, Node 22.23.2 (24.19.0 en cache), Python 3.12.10 (3.13.15 et 3.14.7 en cache), MSVC 14.51 et le SDK Windows sont préinstallés. La présence de WebView2 n'a pas pu être confirmée
- **Coût nul** : « GitHub Actions usage is free […] for public repositories that use standard GitHub-hosted runners », runners Windows compris
- **`tauri-action` et le sidecar** : l'action « will build the app, create a GitHub release itself, and upload the app bundles to the newly created release », et gère le `latest.json` via `uploadUpdaterJson` (`true` par défaut). Mais elle ne fait qu'appeler `tauri build` : **aucun hook pour construire un sidecar avant**. Le binaire PyInstaller doit être en place dans `src-tauri/binaries/` à son invocation, posé par une étape antérieure du même job

**Recommandation** : ✅ Pinner `pnpm/setup` sur la v2.1.0 plutôt que sur le tag flottant `@v2`, qui traîne sur la v2.0.2 alors que le correctif de chemin de cache Windows date de la v2.0.1.

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

**Le piège n'est pas la propagation mais les lockfiles** : `uv.lock` et `Cargo.lock` portent la version du paquet local dans un tableau `[[package]]`, que l'updater TOML générique ne sait pas cibler. Il rend `No entries modified` **sans échouer** ([release-please#2455](https://github.com/googleapis/release-please/issues/2455)), et `uv sync --frozen` fait ensuite échouer le build de release.

**Comportement `chore:`** confirmé verbatim : « A releasable unit is a commit to the branch with one of the following prefixes: 'feat', 'fix', and 'deps'. (A 'chore' or 'build' commit is not a releasable unit.) ». L'échappatoire l'est aussi : « When a commit to the main branch has `Release-As: x.x.x` (case insensitive) in the commit body, Release Please will open a new pull request for the specified version ».

**Recommandation** : ⚠️ Le flux `develop` → `main` **n'est documenté nulle part**. release-please raisonne sur une branche de vérité unique (« A config file must exist at the tip of the default/configured branch ») pilotée par `target-branch`. Rien n'indique que ce soit cassé, rien ne l'atteste non plus : **à valider par un run à blanc sur un dépôt de test avant la première release**, pas au moment de publier.

### 6. Renovate
**Version actuelle** : `44.51.0` (2026-08-29)
**Stabilité** : ✅

**Ce qui a changé par rapport au choix initial de Dependabot.** Dependabot supporte bien les quatre écosystèmes du projet (`uv`, `npm`, `cargo`, `github-actions`), mais il **parse le `pnpm-lock.yaml` lui-même**, et sa doc officielle plafonne encore à pnpm v10. Sur un lockfile pnpm 11 multi-document, la conséquence n'est pas celle qu'on croit : les PR de bump continuent de fonctionner, c'est le *dependency grapher* qui lit le mauvais document et **referme silencieusement les alertes de sécurité**, comme si le dépôt n'avait aucune dépendance. Verbatim de la PR de correction, ouverte le 2026-08-19 et non mergée : « the native JS helper already extracts the project document since the pnpm 11 beta support change, so update PRs kept working while the graph path stayed broken ». Un échec silencieux sur les alertes de sécurité est pire qu'un échec bruyant sur les PR.

**Renovate ne rencontre pas ce problème par construction** : il ne parse pas le lockfile, il le fait régénérer par la CLI du gestionnaire. Doc officielle : « Lock file maintenance is delegated to the underlying package manager, which Renovate runs as an external command ». Le format du fichier lui est donc indifférent, aujourd'hui comme au prochain changement.

**Nouvelles Features Pertinentes** :
- `packageRules` groupe et filtre par manager, par type semver et par calendrier, là où les `groups` de Dependabot restent sommaires
- Automerge natif, sans règle de branch protection ni workflow tiers à monter
- `minimumReleaseAge` par type de bump, à aligner sur le réglage homonyme de pnpm 11

**Compatibilité Écosystème** :
- **Une seule configuration couvre les quatre zones** : manager `npm` (Angular), `pep621` pour uv, dont la doc précise « This manager supports lockFileMaintenance for the following file(s): pdm.lock, uv.lock », `cargo` avec mise à jour de `Cargo.lock`, et `github-actions` avec pin par SHA
- **Gratuit sur dépôt public**, via l'app GitHub hébergée. Une variante auto-hébergée existe en GitHub Action si le contrôle du cache ou de la cadence devient nécessaire
- **Les alertes de sécurité GitHub restent en place** : Renovate ne remplace pas le scanner, il consomme l'API Dependabot alerts en lecture. Activer « Dependency graph » et « Dependabot alerts » dans les réglages du dépôt reste nécessaire, indépendamment des version updates

**Issue à surveiller** : la discussion renovatebot#43161 (2026-05-07) rapporte que la régénération d'un lockfile pnpm 11 retire les blocs `overrides:` et `patchedDependencies:`. Le projet n'en déclare aucun, et l'issue formelle correspondante a été fermée en `not_planned` sans explication récupérable.

**Recommandation** : ✅ Avec la cadence de release d'uv (sept versions en un mois) et de Ruff, grouper minor et patch par écosystème et isoler les majeures reste indispensable, sans quoi le flux de PR devient ingérable. C'est exactement ce que `packageRules` exprime mieux que `groups`.

> Les procédures opérationnelles correspondantes vivent dans [PRODUCTION.md § Dépendances](PRODUCTION.md#dépendances) et [§ Composants applicatifs](PRODUCTION.md#composants-applicatifs).

---

# Matrice de Compatibilité Croisée

| Dépendance A | Dépendance B | Compatibilité | Notes |
|--------------|--------------|---------------|-------|
| Angular 22.1.4 | TypeScript 6.0.x | ✅ | Contrainte dure `>=6.0.0 <6.1.0` |
| Angular 22.1.4 | TypeScript 7.0.x | ❌ | `compiler-cli` ne compile pas, élargissement refusé en `not planned` |
| Angular 22.1.4 | Node 24.x et 26.x | ✅ | `engines` : `^22.22.3 \|\| ^24.15.0 \|\| ^26.0.0` |
| Angular 22.1.4 | PrimeNG 22.1.0 | ✅ | `peerDependency` en `^22.1.0`, pas `22.x` |
| Angular 22.1.4 | Vitest 4.1.11 | ✅ | Runner par défaut du CLI depuis la v21 |
| Angular 22.1.4 | ngx-translate 18.0.0 | ✅ | « Tested against Angular 18, 19, 20, 21, and 22 » |
| Angular 22.1.4 | @sentry/angular 10.72.0 | ✅ | `>= 14.x <= 22.x` |
| Angular 22.1.4 | angular-eslint 22.1.0 | ✅ | Alignement de majeure, `@angular/cli >= 22.0.0 < 23.0.0` |
| Angular 22.1.4 | Tauri 2.11.5 | ✅ | `ng build` → `dist/<app>/browser` en `frontendDist`, aucun SSR |
| Angular 22.1.4 | Tailwind 4.3.3 | ✅ | Via `@tailwindcss/postcss` et `.postcssrc.json`, voie recommandée par les deux docs |
| ngx-translate 18.0.0 | Tauri 2.11.5 | ✅ | Les JSON de traduction sont servis en same-origin depuis `frontendDist`, sans `asset:` ni plugin `fs` |
| TypeScript 6.0.x | typescript-eslint 8.68.0 | ✅ | `>=4.8.4 <6.1.0` |
| PrimeNG 22.1.0 | @primeuix/themes 3.0.0 | ✅ | À installer explicitement, pas de dépendance transitive |
| PrimeNG 22.1.0 | @primeicons/angular 8.0.0 | ⚠️ | Dépendance directe, sous licence PrimeUI |
| PrimeNG 22.1.0 | tailwindcss-primeui 0.6.1 | ⚠️ | Plugin figé depuis mars 2025, antérieur à la v22 |
| PrimeNG 22.1.0 | Tailwind 4.3.3 | ✅ | Layer `primeng` à placer après `theme` et `base`, avant `utilities` |
| Tailwind 4.3.3 | @tailwindcss/postcss 4.3.3 | ✅ | Versions synchronisées, même monorepo |
| Tailwind 4.3.3 | prettier-plugin-tailwindcss 0.8.1 | ✅ | Option `tailwindStylesheet` obligatoire |
| Tailwind 4.3.3 | SCSS / LESS | ❌ | Non supporté par conception, d'où le CSS pur |
| Tailwind 4.3.3 | WebView2 | ✅ | Plancher navigateur de la v4 très en deçà du Chromium de WebView2 |
| pnpm 11.24.0 | Angular CLI 22 | ✅ | `angular/angular-cli` bump sa propre version de pnpm en 11.24.0, sans régression |
| pnpm 11.24.0 | Renovate 44.51.0 | ✅ | Renovate ne parse pas le lockfile, il le fait régénérer par la CLI pnpm |
| Renovate 44.51.0 | uv, cargo, github-actions | ✅ | Managers `pep621` (dont `uv.lock`), `cargo` et `github-actions` dans une seule config |
| pnpm 11.24.0 | Dependabot | ⚠️ | PR de bump fonctionnelles, mais le graphe de dépendances referme les alertes de sécurité en silence |
| pnpm 11.24.0 | `pnpm/setup` v2.1.0 | ✅ | L'action exige pnpm 11+, les deux choix se tiennent |
| pnpm 11.24.0 | `pnpm/action-setup` v6 | ❌ | Action réservée à pnpm 10 et antérieur |
| pnpm 11.24.0 | `--frozen-lockfile` en CI | ⚠️ | `minimumReleaseAge` à 24 h fait échouer l'install sur une transitive trop fraîche |
| Node 24.x | `pnpm/setup` v2.1.0 | ✅ | `runtime: node@24`, sans Corepack ni `actions/setup-node` |
| Node 25.x et au-delà | Corepack | ❌ | Retiré des binaires officiels, d'où la bascule d'octobre à préparer |
| Python 3.14.7 | PyInstaller 6.22.2 | ✅ | Plage `>=3.8,<3.16`, support de 3.14 depuis 6.15.0 (2025-08-03) |
| Python 3.14.7 | rapidfuzz 3.14.5 | ✅ | **Wheels `cp314` pour `win_amd64`**, une des deux extensions natives de la stack |
| Python 3.14.7 | pydantic 2.13.5 | ✅ | Wheels `cp314` et `cp314t` de `pydantic-core` pour `win_amd64`, compatibilité 3.14 annoncée depuis pydantic 2.12 |
| Python 3.14.7 | httpx2 2.12.0 | ✅ | Classifiers 3.10 à 3.15, et zstd natif à partir de 3.14 |
| Python 3.14.7 | sentry-sdk 2.68.1 | ✅ | Classifier 3.14 explicite |
| Python 3.14.7 | mypy 2.3.1 / pytest 9.1.1 | ✅ | Wheels `cp314` pour mypy, support pytest depuis 8.4.0 |
| Python 3.14.7 | mutagen 1.48.1 | ✅ | `>=3.10,<4`. Classifiers non détaillés, mais pur Python sans dépendance |
| Python 3.14.7 | `asyncio.get_event_loop()` | ❌ | Lève `RuntimeError` hors loop. À bannir par le lint, `asyncio.run()` à la place |
| Python 3.14.7 | `sqlite3.version` | ❌ | Supprimé. Utiliser `sqlite3.sqlite_version` (moteur), `connect()` non concerné |
| httpx2 2.12.0 | respx 0.23.1 | ❌ | Dépend de `httpx>=0.25.0`, PR #317 ouverte non mergée |
| httpx2 2.12.0 | pytest-httpx 0.36.2 | ❌ | Dépend de `httpx==0.28.*`, PR #239 ouverte non mergée |
| httpx2 2.12.0 | truststore + PyInstaller | ⚠️ | Appels `ctypes` vers l'API OS dans un binaire figé, non documenté |
| keyring 25.7.0 | PyInstaller 6.22.2 | ⚠️ | Backends par entry points, aucun hook contrib. Forçage explicite requis |
| sentry-sdk 2.68.1 | PyInstaller 6.22.2 | ✅ | `hook-sentry_sdk.py` fourni par `pyinstaller-hooks-contrib` |
| rapidfuzz 3.14.5 | PyInstaller 6.22.2 | ⚠️ | **Aucun hook**, ni du paquet ni de `hooks-contrib` : son entry point `pyinstaller40` est `tests`, pas `hook-dirs`. Couvrir par `collect_submodules("rapidfuzz")` à cause des cibles SIMD |
| pydantic 2.13.5 | PyInstaller 6.22.2 | ⚠️ | Hook `pydantic` livré par `pyinstaller-hooks-contrib`, mais le couple `pydantic-core` + interpréteur géré par uv reste à vérifier au premier build |
| mutagen 1.48.1 | PyInstaller 6.22.2 | ✅ | Pur Python, aucun hook nécessaire |
| Mypy 2.3.1 strict | toutes les deps Python | ✅ | Toutes livrent un `py.typed` |
| Ruff 0.16.5 lint | Ruff 0.16.5 format | ⚠️ | Exclure `COM812`, `ISC002`, `Q000`-`Q004`, `E111`, `E114`, `E117`, `W191`, `D203`, `D206`, `D300` |
| Ruff 0.16.5 | Mypy 2.3.1 | ✅ | Périmètres disjoints, aucun recouvrement |
| Rust 1.98.0 | tauri 2.11.5 | ✅ | MSRV 1.77.2 |
| Rust 1.98.0 | tauri-build 2.6.3 | ✅ | MSRV 1.85 sur la branche edition 2024 |
| tauri 2.11.5 | plugins v2 (8 crates) | ✅ | Bornes `>=2.10.0`, sauf `os` en `>=2.8.2`, toutes `<3.0.0` |
| Crates plugins | Paquets npm plugins | ✅ | Numéros strictement identiques plugin par plugin |
| tauri 2.11.5 | @tauri-apps/api 2.11.1 | ✅ | Cadences de patch distinctes, sans incidence |
| PyInstaller `--onedir` | Tauri `externalBin` | ⚠️ | `externalBin` ne prend qu'un exécutable, `_internal/` passe par `bundle.resources` |
| release-please + `GITHUB_TOKEN` | `on: push: tags` | ❌ | Aucun workflow déclenché, confirmé par la doc GitHub |
| release-please | flux `develop` → `main` | ⚠️ | Non documenté, à valider sur un dépôt de test |
| tauri-action v1.0.0 | build sidecar préalable | ⚠️ | Aucun hook : le binaire doit être en place avant l'invocation |
| NSIS | plugin updater | ✅ | « MSI and NSIS installers receive signatures and can be used with the updater » |

---

# Conflits Potentiels

| Conflit | Risque | Solution |
|---------|--------|---------|
| **La bascule sous licence PrimeUI s'étend au paquet d'icônes**, que l'[ADR-003](adrs/003-primeng-community-license.md) n'avait pas couvert : PrimeNG 22 tire `@primeicons/angular ^8.0.0`, sous la même licence, la dernière version MIT du paquet d'icônes étant `primeicons` 7.0.0 | 🟡 | Compléter les Négatives de l'ADR-003 : la dépendance à PrimeTek dépasse la seule bibliothèque de composants. Préciser aussi la porte de sortie Optimus UI côté icônes. **La décision elle-même tient** : l'ADR a instruit l'archivage du dépôt et la Community License, et rien de nouveau ne la remet en cause |
| **Aucun mock HTTP ne supporte `httpx2`.** `respx` dépend de `httpx>=0.25.0`, `pytest-httpx` de `httpx==0.28.*`. Les PR de support (respx#317, pytest-httpx#239) sont ouvertes, non mergées | 🔴 | Le « client techno-scraper mocké » d'[ARCHITECTURE.md § Stratégie de Tests](ARCHITECTURE.md#stratégie-de-tests) doit reposer sur le `MockTransport` natif d'`httpx2`, injecté dans le client via son paramètre `transport`. C'est quelques dizaines de lignes de fixture, sans dépendance externe, et le pattern survit à l'arrivée d'un vrai `respx` compatible. **Trancher avant d'écrire le premier test réseau**, pas après |
| **`keyring` ne trouve pas son backend dans le binaire PyInstaller.** Les backends sont découverts par entry points depuis la 12.0.0, l'analyse statique ne les voit pas, et l'échec est `RuntimeError: No recommended backend was available` au runtime | 🔴 | Ne pas compter sur l'auto-détection : forcer `PYTHON_KEYRING_BACKEND=keyring.backends.Windows.WinVaultKeyring` ou appeler `keyring.set_keyring(WinVaultKeyring())` en code, plus `--collect-metadata keyring` et `--hidden-import win32ctypes.pywin32.win32cred,win32ctypes.pywin32.pywintypes` à la commande PyInstaller. **Tester sur le binaire figé, jamais seulement sur les sources** |
| **`sentry_sdk.init()` peut planter dans le binaire figé.** Les intégrations sont importées par `importlib.import_module`, et le code n'intercepte que `DidNotEnable` et `SyntaxError`, pas `ImportError` : un module manquant fait tomber l'initialisation au lieu de désactiver silencieusement l'intégration | 🟡 | `hook-sentry_sdk.py` de `pyinstaller-hooks-contrib` couvre le cas nominal en interrogeant `_AUTO_ENABLING_INTEGRATIONS` au build. Vérifier sa présence, et couvrir l'appel à `init()` d'un `try/except` : une remontée d'erreurs cassée ne doit jamais empêcher l'application de démarrer |
| **Dependabot referme les alertes de sécurité en silence sur un lockfile pnpm 11 multi-document.** Ce ne sont pas les PR de bump qui cassent, c'est le graphe de dépendances, qui rapporte zéro dépendance (dependabot-core#14794 ouverte, PR de correction #15968 non mergée) | 🔴 | **Passer à Renovate**, qui délègue le lockfile à la CLI pnpm et n'est donc pas exposé au format. Le contournement consistant à figer pnpm 10 échange un échec silencieux contre une dette de version, et enferme au passage sur `pnpm/action-setup`, l'action que son propre README donne pour dépassée |
| **`minimumReleaseAge` à 24 h fait échouer `pnpm install --frozen-lockfile`** quand un bot vient de regénérer un lockfile pointant une transitive publiée dans la fenêtre. Cas documenté sur Angular via `caniuse-lite` | 🟡 | Aligner le `minimumReleaseAge` de Renovate sur celui de pnpm pour que les deux fenêtres coïncident, et garder `minimumReleaseAgeExclude` en parade ciblée. Ne pas désactiver le réglage, c'est une protection supply-chain réelle |
| **Corepack disparaît sous les pieds de la CI.** Retiré des binaires officiels Node depuis la 25.x, absent de la 26.0.0 | 🟢 | `pnpm/setup@v2.1.0` installe pnpm et Node en une étape, sans Corepack. pnpm le déconseille de toute façon en CI, même là où il existe encore : « Corepack installs a JavaScript shim in place of pnpm, so every `pnpm` call starts Node.js to run the shim before pnpm itself starts » |
| **`devEngines.packageManager`, écrit par défaut par `pnpm init`, déclenche le lockfile multi-document** et donc la panne du graphe de dépendances GitHub, alors même que sans Corepack ce champ n'a plus aucun effet d'enforcement | 🔴 | **Le retirer de `package.json`** et passer la version de pnpm en input `version` de `pnpm/setup`. Passer à Renovate ne suffit pas à s'en dispenser : Renovate lit les alertes de sécurité GitHub, il ne les produit pas, donc un graphe cassé le prive de sa source. C'est le seul geste qui rend l'item « le graphe liste bien les dépendances » atteignable |
| **`tailwindcss-primeui` n'a pas bougé depuis mars 2025**, soit avant la base 16px et le nouveau système d'icônes de PrimeNG 22 | 🟡 | Vérification visuelle dès la première page composée. Le plugin ne consommant que des variables CSS générées par PrimeNG, une rupture est peu probable, et le repli consiste à déclarer les tokens directement dans `@theme` |
| **Deux tournures interdites par Python 3.14** : `asyncio.get_event_loop()` hors loop lève `RuntimeError`, et `sqlite3.version` est supprimé | 🟢 | Aucune des deux n'a de raison d'exister dans du code neuf. Les bannir dans `[tool.ruff.lint.flake8-tidy-imports.banned-api]` fait porter la garantie par la CI plutôt que par la mémoire, y compris sur du code repris de la CLI d'origine |
| **`pydantic-core` est une seconde extension native à empaqueter.** Le hook `pydantic` de `pyinstaller-hooks-contrib` couvre le cas nominal, mais aucune source ne documente le couple `pydantic-core` + interpréteur géré par uv sous PyInstaller | 🟡 | Même traitement que rapidfuzz et keyring : valider au premier build CI qu'un `model_validate_json()` fonctionne dans le binaire figé, pas seulement sur les sources. L'échec serait un `ImportError` au démarrage, immédiat et explicite |
| **La config Ruff de techno-scraper n'est pas transposable** si elle date d'avant la 0.16.0 : le jeu par défaut est passé de 59 à 413 règles | 🟡 | Partir de la config par défaut de 0.16.x, ajouter la catégorie `I`, retirer `COM812`. Ne pas copier-coller |
| **`externalBin` ne prend qu'un exécutable**, or PyInstaller `--onedir` produit un exe plus un dossier `_internal/` | 🟡 | Déclarer l'exe suffixé en `bundle.externalBin` et le dossier en `bundle.resources` **sous forme objet** (`{ "binaries/_internal": "_internal" }`). La forme tableau le range sous `binaries/_internal/` et le sidecar meurt sur `Failed to load Python DLL`, invisible en `tauri dev`. Vérifié sur artefact, pas seulement au build |
| **release-please n'est pas documenté sur un flux `develop` → `main`.** L'outil raisonne sur une branche de vérité unique pilotée par `target-branch` | 🟡 | Valider sur un dépôt de test avant la première release réelle. Le chaînage `needs:` est indépendant de ce point et reste correct dans tous les cas |
| **`tauri-action` n'offre aucun hook pour construire un sidecar** avant `tauri build` | 🟢 | Construire le binaire PyInstaller et le copier dans `src-tauri/binaries/` dans une étape antérieure du même job. Contrainte connue, sans contournement à inventer |
| **La syntaxe `shell:allow-spawn` avec `"sidecar": true`** n'est pas confirmée verbatim par la documentation, seul l'exemple équivalent sur `allow-execute` l'est | 🟢 | Vérifier dans les exemples du dépôt `plugins-workspace` au moment d'écrire `capabilities/default.json`. Un échec est immédiat et explicite (`program not allowed on the configured shell scope`), pas silencieux |
| **PyInstaller et les faux positifs antivirus** : ampleur non mesurable depuis la documentation | 🟡 | Le mode `--onedir` est la seule atténuation retenue, la signature de code supposant un certificat écarté par le budget nul. La mesure appartient à la Checklist Post-MEP de [PRODUCTION.md](PRODUCTION.md#checklist-post-mep) : un build qui passe en local ne prouve rien |

---

# Configuration Recommandée

## Backend

### sidecar/pyproject.toml

Métadonnées : nom `tagger`, `requires-python = ">=3.14,<3.15"`, version pilotée par release-please via `extra-files`. La borne haute existe pour que PyInstaller empaquette exactement l'interpréteur testé, pas pour exclure 3.15. Un `.python-version` à côté fige la version qu'`uv` installe et que la CI reprend, et c'est le fichier que vise la procédure de bump de [PRODUCTION.md § Composants applicatifs](PRODUCTION.md#composants-applicatifs).

**Dépendances d'exécution** : `pydantic>=2.13.5,<3`, `mutagen>=1.48.1,<2`, `rapidfuzz>=3.14.5,<4`, `httpx2>=2.12.0,<3`, `keyring>=25.7.0,<26`, `sentry-sdk>=2.68.1,<3`.

**Groupe `dev`** (via `[dependency-groups]`, PEP 735) : `pytest>=9.1.1`, `pytest-asyncio>=1.4.0`, `pytest-cov>=7.1.0`, `ruff>=0.16.5`, `mypy>=2.3.1`.

**Groupe `build`** : `pyinstaller>=6.22.2`, `pyinstaller-hooks-contrib>=2026.1`.

**`[tool.ruff]`** : `target-version = "py314"`. Sous `[tool.ruff.lint]`, partir du jeu par défaut de la 0.16.x, ajouter `I`, et poser en `ignore` les règles incompatibles avec le formateur (`COM812` en premier lieu). Sous `[tool.ruff.lint.flake8-tidy-imports.banned-api]`, interdire `asyncio.get_event_loop` et `sqlite3.version` avec un message renvoyant à leur remplaçant.

**`[tool.mypy]`** : `strict = true` et `warn_unreachable = true`. Aucune section `[[tool.mypy.overrides]]` n'est nécessaire, toutes les dépendances livrent un `py.typed`. Ajouter `plugins = ["pydantic.mypy"]`, qui donne au checker la signature réelle des `__init__` générés.

**`[tool.pytest.ini_options]`** : `asyncio_mode = "strict"`, `addopts` portant `--cov=tagger`.

Le seuil `--cov-fail-under=80` vit dans la recette `just test` et non dans `addopts` : il mesure la couverture globale, donc dans `addopts` il ferait échouer toute exécution ciblée sur un seul fichier.

### sidecar/build.py

Commande PyInstaller en `--onedir`, avec au minimum le forçage du backend keyring (`--collect-metadata keyring`, `--hidden-import win32ctypes.pywin32.win32cred`, `--hidden-import win32ctypes.pywin32.pywintypes`) et le nommage de sortie aligné sur le target-triple attendu par Tauri.

## Frontend

### package.json

`engines.node` sur `^24.15.0 || ^26.0.0` : un `>=` laisserait passer Node 25.x, hors de la plage supportée par Angular 22. Un `pnpm-workspace.yaml` est à créer même sans monorepo, pour accueillir `allowBuilds: { esbuild: true }` et les réglages que le `.npmrc` n'accepte plus depuis pnpm 11.

> 🔴 **Retirer le `devEngines.packageManager` que `pnpm init` écrit par défaut, et ne pas déclarer `packageManager` non plus.** C'est contre-intuitif, mais ces deux champs sont les seuls déclencheurs du lockfile multi-document sur ce projet, et ce format casse le graphe de dépendances GitHub, donc les alertes de sécurité. Renovate **lit** ces alertes, il ne les produit pas : les perdre reviendrait à n'avoir aucune veille CVE tout en croyant le contraire. La version de pnpm se déclare à la place en input `version` de `pnpm/setup`, ce qui la place dans le workflow plutôt que dans `package.json`. C'est l'inverse de ce que recommande la doc pnpm, et c'est assumé : le graphe de dépendances vaut plus cher ici que la centralisation de la version.

**Dépendances** : les paquets runtime `@angular/*` en `22.1.4` (`@angular/cli` et `@angular/build`, qui sont des devDependencies, en `22.1.6`), `primeng` en `22.1.0`, `@primeuix/themes` en `3.0.0` (**déclaration explicite obligatoire**), `@ngx-translate/core` et `@ngx-translate/http-loader` en `18.0.0`, `@fontsource-variable/inter` en `5.3.0`, `@sentry/angular` en `10.72.0`, `@tauri-apps/api` en `2.11.1`, plus les sept paquets `@tauri-apps/plugin-*` aux versions du tableau (pas de paquet pour `single-instance`).

**devDependencies** : `typescript` en `~6.0.0` (tilde, pour rester sous 6.1), `tailwindcss` et `@tailwindcss/postcss` en `4.3.3`, `tailwindcss-primeui` en `0.6.1`, `vitest` en `4.1.11`, `angular-eslint` en `22.1.0`, `eslint` en `^10`, `typescript-eslint` en `^8`, `eslint-config-prettier`, `prettier` en `3.9.6`, `prettier-plugin-tailwindcss` en `0.8.1`, `@tauri-apps/cli` en `2.11.4`.

> `eslint` en `^10` : la ligne 9 est marquée dépréciée sur npm, et `angular-eslint` 22.1.0 accepte `^9.0.0 || ^10.0.0`. `ng add angular-eslint` ajoute aussi `@angular-eslint/builder` et `@eslint/js`.

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

`tauri` en `2.11.5`, `tauri-build` en `2.6.3` (build-dependency), et les huit crates de plugins aux versions du tableau. Édition 2024.

### src-tauri/tauri.conf.json

`build.frontendDist` sur `../dist/techno-tagger-ui/browser`, `bundle.externalBin` sur `binaries/tagger`, `bundle.resources` pour le dossier `_internal/`, `bundle.targets` sur `nsis`, `app.security.assetProtocol` avec `enable: true` et un `scope` restreint au dossier de cache, `app.security.csp` avec un `img-src` incluant `'self' asset: http://asset.localhost blob: data:`, `plugins.updater.pubkey` avec le **contenu** de la clé publique, et les dimensions de fenêtre (1280×800, min 1024×700).

### src-tauri/capabilities/default.json

Les permissions de sept plugins, `shell`, `dialog`, `fs`, `store`, `os`, `opener` et `updater`, avec `shell:allow-spawn` restreinte au sidecar déclaré et un scope `fs` limité aux chemins nécessaires. Le huitième, `single-instance`, n'a aucune permission à déclarer.

### rust-toolchain.toml

Épingler la version en cours (1.98.0) et le composant `clippy` dans un `rust-toolchain.toml`, qui devient alors la seule source de vérité : `rustup` en local comme `dtolnay/rust-toolchain@stable` en CI s'y conforment, et le gate cesse de bouger au gré des mises à jour d'image de runner.

### renovate.json

Une seule configuration pour les quatre managers, auto-détectés par les fichiers présents : `npm` (`package.json`), `pep621` (`sidecar/pyproject.toml` et `uv.lock`), `cargo` (`src-tauri/Cargo.toml`), `github-actions` (`.github/workflows/`). Base `config:recommended`, PR ciblant `develop`, `packageRules` groupant minor et patch par manager et isolant les majeures, `minimumReleaseAge` aligné sur celui de pnpm, et `prConcurrentLimit` pour tenir le flux de PR d'uv et de Ruff.

L'app GitHub Renovate est à installer sur le dépôt, et « Dependency graph » plus « Dependabot alerts » restent activés dans les réglages de sécurité : Renovate lit ces alertes, il ne les produit pas.

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
npm install -g pnpm@11.24.0
pnpm install
pnpm exec ng build

# 4. Coquille Tauri (dev, sidecar lancé depuis les sources)
pnpm exec tauri dev

# 5. Build complet local (ordre imposé : le sidecar avant tauri build)
cd sidecar && uv run python build.py && cd ..
pnpm exec tauri build
```

## Checklist Validation Compatibilité

**Au bootstrap du sidecar**, avant de figer le contrat NDJSON ([étape 3 de l'ordre de développement](ARCHITECTURE.md#ordre-de-développement)) :

- [ ] [ADR-003](adrs/003-primeng-community-license.md) rouvert et tranché à la lumière de l'archivage du dépôt PrimeNG
- [ ] Stratégie de mock d'`httpx2` arrêtée (`MockTransport` natif), première fixture écrite
- [ ] `uv sync` puis `uv run mypy --strict` passent sans `ignore_missing_imports`
- [ ] `uv run ruff check` sur une config partie du défaut 0.16.x, pas d'un copier-coller
- [ ] `banned-api` interdit bien `asyncio.get_event_loop` et `sqlite3.version` : écrire volontairement l'un des deux et vérifier que la CI échoue

**Au premier build PyInstaller** :

- [ ] Le binaire figé lit et écrit une clé dans le Credential Manager (pas seulement les sources)
- [ ] `sentry_sdk.init()` ne lève pas d'`ImportError` dans le binaire, et l'appel est protégé
- [ ] Un `model_validate_json()` sur une commande passe dans le binaire figé : `pydantic-core` est la seconde extension native, après rapidfuzz
- [ ] `httpx2` établit une connexion TLS depuis le binaire (`truststore` fonctionne sous `ctypes` gelé)
- [ ] Le dossier `_internal/` est complet et l'exe démarre depuis un autre répertoire
- [ ] PyInstaller empaquette correctement l'interpréteur installé par `uv python install` : aucune source officielle ne documente ce couple

Les faux positifs antivirus **ne se vérifient pas ici** : un binaire qui passe sur le poste qui l'a produit ne prouve rien. Cette mesure appartient à la Checklist Post-MEP de [PRODUCTION.md](PRODUCTION.md#checklist-post-mep), sur une machine tierce.

**Au premier `tauri build`** :

- [ ] Le suffixe target-triple correspond exactement à `rustc --print host-tuple`
- [ ] `Command.sidecar()` spawn le binaire, écrit sur stdin et lit stdout
- [ ] `capabilities/default.json` autorise le spawn du sidecar et rien d'autre
- [ ] Une pochette du dossier de cache s'affiche dans la webview via `convertFileSrc()`
- [ ] L'installeur NSIS s'installe et se désinstalle proprement
- [ ] WebView2 est bien présent sur l'image du runner Windows, sa présence n'a pas pu être confirmée dans la documentation

**Au premier passage CI** :

- [ ] Un run à blanc de release-please sur un dépôt de test valide le flux `develop` → `main`
- [ ] Le job de build est chaîné en `needs:` sur `release_created`, et **pas** sur `on: push: tags`
- [ ] `latest.json` est publié avec une signature valide, et un client sur la version antérieure détecte la mise à jour
- [ ] `pnpm/setup` est pinné sur la v2.1.0, pas sur le tag flottant `@v2`, et le cache pnpm fonctionne sur le runner Windows
- [ ] Les workflows installent pnpm et Node par la seule action `pnpm/setup`, sans `corepack enable` ni `actions/setup-node`
- [ ] `pnpm install --frozen-lockfile` passe sur une PR Renovate fraîche, sans `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`
- [ ] Le graphe de dépendances GitHub liste bien les dépendances des quatre écosystèmes, et pas zéro

**Vérifications visuelles** :

- [ ] Le variant `dark:` de Tailwind suit bien le `darkModeSelector` de PrimeNG
- [ ] `tailwindcss-primeui` expose les tokens attendus sur `@primeuix/themes` 3.0.0
- [ ] La table à scroll virtuel tient 100 lignes sans dégradation à 1024×700

---

# Recommandation Finale

**Verdict : la stack est cohérente et production-ready.** Les trois écosystèmes s'alignent sans conflit de versions, tous les couples critiques sont vérifiés, et les points durs ont chacun une issue identifiée. Un seul sujet appelle une décision plutôt qu'une ligne de configuration : l'[ADR-007](adrs/007-client-http-httpx2.md), dont l'argument central (« l'API étant strictement identique, le choix se réduit à un critère de maintenance ») ne tient plus, `httpx` conservant seul l'outillage de mock.

## Points Critiques

1. **L'écosystème PrimeNG est entièrement sous licence PrimeUI, icônes comprises.** L'[ADR-003](adrs/003-primeng-community-license.md) a instruit l'archivage du dépôt et la Community License pour les composants, mais pas le fait que `@primeicons/angular` suive la même bascule. La décision tient, sa section Négatives est à compléter.
2. **`httpx2` n'a pas encore d'outillage de test.** Ni `respx` ni `pytest-httpx` ne le supportent. Le `MockTransport` natif règle le problème pour quelques dizaines de lignes, mais le choix doit précéder le premier test réseau, pas le suivre.
3. **`keyring` sous PyInstaller est le point de rupture le plus probable du build.** La découverte par entry points échoue dans un binaire figé, et l'erreur ne survient qu'au runtime chez l'utilisateur. Forçage explicite du backend, plus un test de fumée sur le binaire.
4. **TypeScript est verrouillé sur la ligne 6.0** par Angular 22. TS 7 casse le build et le lint simultanément : ce n'est pas un arbitrage de performance mais un blocage à respecter jusqu'à TS 7.1.
5. **Le passage de Dependabot à Renovate n'est pas un détail d'outillage.** Il conditionne la possibilité de suivre la ligne pnpm, et le motif n'est pas une préférence d'outil mais un mode de panne : sur un lockfile pnpm 11, Dependabot referme les alertes de sécurité **sans rien signaler**. [PRODUCTION.md](PRODUCTION.md#dépendances) est aligné en conséquence.

## ROI / Avantages

1. **Le facteur limitant est extérieur au projet.** Le débit vient de techno-scraper, pas de la machine : aucune des versions retenues n'est choisie pour la performance, ce qui simplifie tous les arbitrages.
2. **Aucune dépendance ne manque de types.** Les six bibliothèques Python livrent un `py.typed`, le gate Mypy strict s'installe sans un seul `ignore_missing_imports`, et le contrat NDJSON est typable de bout en bout dès le premier jour.
3. **Le coût de packaging est déjà payé par les outils.** RapidFuzz et sentry-sdk livrent leurs hooks PyInstaller, `pydantic` reçoit le sien de `pyinstaller-hooks-contrib`, mutagen n'en a pas besoin, `pywin32-ctypes` évite une extension compilée. Seul keyring demande un geste explicite.
4. **La chaîne CI/CD ne coûte rien.** Dépôt public, runners standard, GitHub Releases pour la distribution et l'updater : la contrainte de budget nul d'[ARCHITECTURE.md](ARCHITECTURE.md#enjeux--contraintes) est tenue sans compromis, y compris sur les runners Windows.
5. **Les trois zones sont indépendantes.** Un bump côté Angular ne touche pas le sidecar, un bump Python ne touche pas la webview, et les majeures isolées par Renovate mettent d'office en quarantaine les mises à jour à risque.

---

# 🔗 Ressources

## Documentation Officielle

- [Angular — Releases et versions supportées](https://angular.dev/reference/versions)
- [Python — Calendrier des versions](https://devguide.python.org/versions/)
- [Tauri v2](https://v2.tauri.app/)
- [PrimeNG — Guide de migration v22](https://primeng.dev/migration/v22)
- [Tailwind CSS — Guide de mise à niveau v4](https://tailwindcss.com/docs/upgrade-guide)
- [PyInstaller — Changelog](https://pyinstaller.org/en/stable/CHANGES.html)
- [uv — Politique de versionnement](https://docs.astral.sh/uv/reference/policies/versioning/)
- [Ruff — Documentation](https://docs.astral.sh/ruff/)
- [Mypy — Changelog](https://mypy.readthedocs.io/en/stable/changelog.html)
- [Pydantic — Documentation](https://pydantic.dev/docs/validation/latest/)
- [Node.js — Versions précédentes et calendrier LTS](https://nodejs.org/en/about/previous-releases)
- [Rust — Notes de version](https://doc.rust-lang.org/releases.html)

## Ressources Complémentaires

- [Tauri v2 — Sidecar (binaires embarqués)](https://v2.tauri.app/develop/sidecar/)
- [Tauri v2 — Capabilities et permissions](https://v2.tauri.app/security/capabilities/)
- [Tauri v2 — Plugin updater](https://v2.tauri.app/plugin/updater/)
- [ngx-translate — Guide de migration](https://ngx-translate.org/getting-started/migration-guide/)
- [Sentry — Migration Python 1.x vers 2.x](https://docs.sentry.io/platforms/python/migration/1.x-to-2.x/)
- [Sentry — Données collectées par le SDK Python](https://docs.sentry.io/platforms/python/data-collected/)
- [GitHub Actions — Déclenchement d'un workflow (limite du GITHUB_TOKEN)](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
- [release-please — Configuration du manifeste](https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md)
- [pnpm 11 — Notes de version](https://pnpm.io/blog/releases/11.0)
- [pnpm — Format du fichier de lock (conditions du multi-document)](https://pnpm.io/lockfile)
- [pnpm — Intégration continue](https://pnpm.io/continuous-integration)
- [Renovate — Options de configuration](https://docs.renovatebot.com/configuration-options/)
- [Renovate — Manager pep621 (uv)](https://docs.renovatebot.com/modules/manager/pep621/)
- [httpx2 — Documentation](https://httpx2.pydantic.dev/)
- [mutagen — Guide ID3](https://mutagen.readthedocs.io/en/latest/user/id3.html)
- [angular-eslint — Dépôt et configuration](https://github.com/angular-eslint/angular-eslint)
