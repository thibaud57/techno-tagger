---
title: "PRODUCTION — techno-tagger"
description: "Documentation opérationnelle de techno-tagger : release, distribution Windows signée, secrets, observabilité, incidents et sauvegarde des actifs critiques."
date: "2026-08-29"
keywords: ["production", "release", "tauri", "updater", "pyinstaller", "sentry", "github-releases"]
scope: ["docs", "ops"]
technologies: ["Tauri", "Angular", "Python", "PyInstaller", "GitHub Actions", "Sentry"]
---

# 🚀 Release Strategy

## Versioning

**Schéma** : SemVer (`MAJOR.MINOR.PATCH`). Version courante et historique : `CHANGELOG.md`, tenu par **release-please** depuis les commits Conventional. Aucun numéro n'est figé dans cette doc, il dériverait à chaque release.

Ce qui distingue ce projet d'une API : **il n'y a pas de consommateur de contrat à protéger**, l'interface et le sidecar voyageant dans le même installeur ([ADR-018](adrs/018-versionnement-plan-de-run.md)). Ils peuvent malgré tout se désaccorder après une mise à jour ratée, cas traité par un contrôle de version au démarrage plutôt que par un versionnement du protocole (cf. § Remplacement du sidecar à la mise à jour). Le `MAJOR` ne porte donc pas un contrat réseau mais **l'incompatibilité d'un artefact qui vit chez l'utilisateur** :

| Bump | Ce qui le déclenche |
|---|---|
| `MAJOR` | Schéma du **rapport JSON** cassé au-delà de ce que sa migration absorbe, ou schéma du **plan de run** incompatible (l'utilisateur perd ses arbitrages en cours, cf. [ADR-018](adrs/018-versionnement-plan-de-run.md)) |
| `MINOR` | Nouvelle feature visible : source supplémentaire, format de playlist, écran, réglage |
| `PATCH` | Correctif : parsing, scoring, écriture de tags, interface |

> **Exemple** : `0.5.0` → `0.6.0` (rattrapage par URL) → `0.6.1` (fix du nettoyage de requête).

> **Milestone `1.0.0`** : premier installeur **distribué à un tiers** et mis à jour avec succès par l'updater depuis une version antérieure (étape 9 de l'ordre de développement). Tant que la chaîne complète build → Release → updater n'a pas tourné en réel chez quelqu'un d'autre que l'auteur, le projet reste en `0.x`, où un `MAJOR` de plan de run ne coûte rien à personne.

## Workflow Release

### Flow
```
feature/* → develop → main → tag vX.Y.Z → build + GitHub Release → updater   (flux normal)
hotfix/*  → main → tag vX.Y.Z → build + GitHub Release → updater             (flux hotfix)
```

`main` = branche d'intégration de production : ce qui y est mergé est **candidat**, mais **c'est le tag qui construit et publie**. `develop` = branche d'intégration où s'accumulent les features.

### Flux Release

| Étape | Branch | Environnement | Déclencheur |
|-------|--------|---------------|-------------|
| Développement | `feature/*` | Local (`tauri dev`, sidecar depuis les sources) | Manuel |
| Validation qualité | `feature/*` → PR | CI (GitHub Actions) | Push / PR : Ruff + Mypy + pytest, lint + typecheck + Vitest, `cargo check` + `cargo clippy` |
| Intégration | `develop` | Local | Merge `feature/*` → `develop` |
| Intégration prod | `main` | — (aucune publication) | Merge `develop` → `main` (lot de features prêt) |
| PR release (CHANGELOG + bump) | `release-please--branches--main--*` | — | Auto à chaque push sur `main` (release-please) |
| Tag + **build + publication** | — | Distribution (GitHub Releases) | Merge de la PR release-please → tag `vX.Y.Z` → job de build **chaîné** (cf. § Pipelines) |
| Resync develop | `develop` | Local | Back-merge `main` → `develop` après tag |

### Flux Hotfix

| Étape | Branch | Environnement | Déclencheur |
|-------|--------|---------------|-------------|
| Correctif | `hotfix/*` depuis `main` | Local | Manuel |
| Intégration prod | `main` | — | Merge `hotfix/*` → `main` (PR titrée `fix:`) |
| Tag + **build + publication** | — | Distribution | Merge de la PR release-please (bump PATCH) → tag → build chaîné |
| Resync develop | `develop` | Local | Back-merge `main` → `develop` après tag |

> ⚠️ **Un hotfix n'atteint l'utilisateur qu'au prochain lancement de son application.** L'updater vérifie au démarrage : quelqu'un qui laisse l'app ouverte, ou qui ne la rouvre pas de la semaine, reste sur la version cassée. Il n'existe aucun canal pour forcer une mise à jour, ni pour savoir qui l'a prise. C'est la différence structurelle avec une API, où un déploiement corrige tout le monde d'un coup.

## Convention Commits

**Format** : `<type>(<scope optionnel>): <description>`

Scope conseillé = la zone ou le module concerné : `sidecar`, `ui`, `tauri`, ou plus fin (`matching`, `playlists`, `files`, `plan`, `cache`, `settings`).

| Type | Usage | release-please |
|------|-------|----------------|
| `feat` | Nouvelle feature visible (`feat(playlists): support M3U8 étendu`) | **MINOR bump** |
| `feat!` | Schéma de rapport ou de plan de run incompatible (footer `BREAKING CHANGE:` accepté aussi) | **MAJOR bump** |
| `fix` | Correction (parsing, scoring, écriture de tags, interface) | **PATCH bump** |
| `docs` | Documentation uniquement (docs/, ADRs, README) | skip |
| `refactor` | Refactoring sans changement de comportement | skip |
| `test` | Ajout / modification de tests ou de fixtures | skip |
| `chore` | Outillage, dépendances (`pnpm-lock.yaml`, `uv.lock`, `Cargo.lock`), CI, config Tauri | skip |

> ⚠️ **PR `develop → main`** : le squash-merge crée 1 commit sur `main` portant le **titre de la PR** comme message. Titre obligatoirement `feat:` / `fix:` / `feat!:`, sinon release-please skip → pas de PR de release → pas de tag → **pas de build, donc aucune mise à jour distribuée**. Footer `Release-As: X.Y.Z` dans le body de la PR pour forcer une version précise.

> 🐛 **Merger cette PR avec un corps explicite** : `gh pr merge <n> --squash --body "<une ligne>"`. Le corps auto-généré par GitHub liste **tous** les commits de la PR ; en GitFlow, chaque squash précédent ayant créé un SHA neuf sur `main`, les commits d'origine de `develop` y restent « absents » et sont re-listés à chaque release. release-please relit alors des `BREAKING CHANGE:` déjà publiés et bump en MAJOR à tort. Piège constaté et documenté sur techno-scraper (deux MAJOR indus). Rattrapage a posteriori : commit vide portant `Release-As: X.Y.Z` sur `main`.

## Propagation de la version

Quatre fichiers portent un numéro de version, pour une seule vérité :

| Fichier | Qui le bump | Comment |
|---|---|---|
| `package.json` | release-please | `release-type: node`, source de vérité |
| `src-tauri/tauri.conf.json` | personne | `"version": "../package.json"` : Tauri accepte un chemin vers un `package.json` au lieu d'un littéral, ce qui supprime le fichier du problème |
| `src-tauri/Cargo.toml` | release-please | `extra-files` (updater TOML générique sur `package.version`) |
| `sidecar/pyproject.toml` | release-please | `extra-files` (updater TOML générique sur `project.version`) |

> 🔴 **Les lockfiles ne peuvent PAS être bumpés par `extra-files`, et l'un d'eux casse le build de release.** `uv.lock` et `Cargo.lock` portent la version du package local dans un tableau (`[[package]]`), ce qui exige un filtre JSONPath du type `$.package[?(@.name=="tagger")].version` que l'updater TOML générique **ne sait pas résoudre** : il rend `No entries modified` et n'échoue pas ([release-please#2455](https://github.com/googleapis/release-please/issues/2455), ouverte depuis décembre 2024, sur ce cas exact d'un `uv.lock`).

Conséquences par lock, très inégales :

| Lock | Symptôme si non réaligné | Gravité |
|---|---|---|
| `uv.lock` | `uv sync --frozen` refuse un lock désaccordé de `pyproject.toml` → **le build PyInstaller de la release échoue** | 🔴 bloquant |
| `Cargo.lock` | `cargo build` sans `--locked` le réécrit en silence (diff parasite) ; avec `--locked`, échec | 🟡 bruit |
| `pnpm-lock.yaml` | Ne porte pas la version du projet racine | ✅ non concerné |

> **Traitement retenu** : un job du workflow release-please rejoue `uv lock` et `cargo update --workspace` sur la branche de la PR de release, et pousse les lockfiles réalignés dans cette même PR. Le commit de release reste cohérent et le build d'après tag part d'un arbre où `--frozen` passe. À défaut, retirer `--frozen` du build de release revient à abandonner la reproductibilité au moment précis où elle compte le plus.

> La version compte au-delà du CHANGELOG : c'est elle que le sidecar passe en `release=` à Sentry (`techno-tagger@X.Y.Z`), et c'est elle que l'updater compare pour décider d'une mise à jour. Un bump manuel oublié quelque part rend le tri Sentry faux ou une mise à jour invisible.

## Checklist Release

**Automatisé (vérifier le statut avant de merger) :**
- [ ] CI verte : Ruff + Mypy strict + pytest sur `sidecar/`, lint + typecheck + Vitest sur `src/`, `cargo check` + `cargo clippy`
- [ ] Seuil de coverage 80 % tenu sur `sidecar/`. **Aucun seuil chiffré sur `src/`** : c'est le périmètre des lignes « Unitaires (UI) » qui doit être couvert, et son absence se voit en review, pas dans un pourcentage (cf. [ARCHITECTURE.md § Coverage](ARCHITECTURE.md#coverage))
- [ ] Lock files à jour et commités (`pnpm-lock.yaml`, `uv.lock`, `Cargo.lock`)

**Manuel :**
- [ ] **Sauvegarde de la clé privée updater revérifiée** : archive chiffrée accessible et déchiffrable. Sa perte est le seul incident sans procédure de retour (cf. § Backup & Recovery)
- [ ] Merge validé (`develop → main` pour un lot de features, ou `hotfix/* → main` pour un correctif urgent)
- [ ] PR release-please relue : CHANGELOG lisible et bump cohérent avec la grille de la § Versioning
- [ ] Job `sync-lockfiles` **vert**, et commit `chore: realigner les lockfiles` présent en tête de la PR de release. C'est l'unique garde-fou du mode de panne 🔴 de la § Propagation de la version, et les runs de CI de cette PR restent **en attente d'approbation** tant que personne ne clique « Approve workflows to run »
- [ ] Merge de la PR → tag `vX.Y.Z` auto-créé, job de build **vert** (PyInstaller + `tauri build` + signature)
- [ ] **Source maps rattachées à la bonne release Sentry** : les jobs `sentry-release` et `build` tournent en parallèle, volontairement (coupler la distribution à l'observabilité ferait perdre l'installeur sur un incident Sentry). `sentry-cli sourcemaps upload --release` crée la release si elle manque, ce qui rend l'ordre indifférent — à confirmer au premier run. Symptôme si c'est faux : une release Sentry sans artefact, et toute stack Angular minifiée. Correctif alors : `sentry-cli releases new` en tête du script `sourcemaps`, côté build
- [ ] Release GitHub porte bien **l'installeur ET `latest.json`** (sans le second, aucun client ne verra la mise à jour)
- [ ] **Smoke test d'installation** sur une machine ou une VM propre : l'installeur passe, l'application démarre, le sidecar répond
- [ ] **Smoke test de mise à jour** : depuis une installation en version N-1, l'updater propose, télécharge, installe et relance, **et le sidecar a bien changé de version** (cf. § Remplacement du sidecar à la mise à jour)
- [ ] Un run réel de bout en bout : playlist → arbitrage → écriture → rapport
- [ ] Back-merge `main → develop` (fait redescendre le bump de version + le CHANGELOG)

> **Politique de tagging** : les tags sont créés par release-please au merge de la PR de release, jamais à la main, et **le tag est ce qui construit et publie**. Les merges `feature/* → develop` et `develop → main` ne produisent aucun artefact.

> ⚠️ Le tag **précède** la validation. Il atteste qu'une version est *publiée*, pas qu'elle est *bonne*. Smoke test rouge → `hotfix/*` puis nouveau tag `PATCH`, jamais de suppression du tag fautif (cf. § Rollback).

> **Garder l'installeur N-1 sous la main.** Le smoke test de mise à jour est le seul qui exerce la chaîne signature + `latest.json` + updater, et il exige une installation en version antérieure. Sans installeur précédent conservé, ce test devient impossible à rejouer.

---

# 📱 Distribution Desktop

## Canaux

Aucun store. Windows seul au MVP ([ADR-015](adrs/015-cibles-distribution-windows.md)), distribué depuis un **dépôt public** ([ADR-021](adrs/021-visibilite-du-depot.md)).

| Cible | Canal | Test | Production |
|---|---|---|---|
| Windows x86_64 | GitHub Releases (dépôt public) | Aucun canal séparé au MVP : machine ou VM propre en local | Release publiée + `latest.json` |
| macOS / Linux | — | — | Post-MVP ([ADR-015](adrs/015-cibles-distribution-windows.md)) |

**Endpoint updater** : `https://github.com/thibaud57/techno-tagger/releases/latest/download/latest.json`. Aucun token n'est nécessaire côté client, c'est exactement la raison du dépôt public : des utilisateurs sans compte GitHub téléchargent et se mettent à jour sans rien manipuler.

> ⚠️ **L'updater ignore les releases en brouillon.** Une Release laissée en draft n'apparaît pas derrière `/releases/latest/`, et l'application ne trouve alors aucune mise à jour, **sans erreur visible**.
>
> **La Release est donc publiée directement, jamais en draft.** Le montage inverse (draft → vérification des assets → publication à la main) paraît plus prudent mais coûte deux régressions : une release GitHub en brouillon **ne crée pas le tag Git**, celui-ci n'étant matérialisé qu'à la publication, et `draft: true` côté release-please l'empêche de retrouver la release précédente, donc de calculer le bump ([release-please#1650](https://github.com/googleapis/release-please/issues/1650)). Le tag et la détection de version passent avant le point de contrôle.
>
> Contrepartie assumée : pendant les quelques minutes du build, la Release existe sans ses assets et `latest.json` rend 404. Un utilisateur qui lance l'application exactement dans cette fenêtre ne voit pas la mise à jour et la verra au lancement suivant. Si le build échoue, la Release reste vide : la dépublier à la main (`gh release edit <tag> --draft=true`) est la première étape du § Rollback.

> **`tauri-action` sait attacher ses artefacts à une Release déjà créée par release-please** : lui passer `tagName` suffit, il retrouve la release existante au lieu d'en créer une. `releaseName` n'est requis que s'il doit en créer une, et `releaseDraft: true` ne servirait qu'à retrouver une release en brouillon, cas écarté ci-dessus.

> **Canal beta** : pré-release sur un manifeste updater distinct, listé en Post-MVP. Rien à mettre en place tant que la distribution ne s'élargit pas.

## Code Signing

| Élément | Signé | Mécanisme | Conséquence |
|---|---|---|---|
| Bundle de mise à jour (`.sig`) | ✅ Oui, obligatoire | minisign, `TAURI_SIGNING_PRIVATE_KEY` (+ password) injectés au build | Sans signature valide, l'updater **refuse** la mise à jour |
| Installeur Windows | ❌ Non | — | SmartScreen avertit au premier lancement, contournable en deux clics dans la fenêtre |
| Sidecar `tagger-*.exe` | ❌ Non | — | Faux positifs Defender possibles, que le mode PyInstaller retenu peut atténuer (cf. § Performance) |

Signer l'installeur ne changerait pas grand-chose : depuis mars 2024, les certificats EV n'ont plus de contournement SmartScreen instantané, la réputation se construisant par volume de téléchargements qu'une application distribuée à quelques amis n'atteindra jamais. L'option la moins chère accessible à un individu, Azure Trusted Signing (~120 $/an), est écartée au vu du budget nul ; son bénéfice réel serait la réduction des faux positifs antivirus, que le mode `--onedir` retenu atténue sans rien dépenser ([ADR-015](adrs/015-cibles-distribution-windows.md)).

> 🔴 **La clé privée de signature est l'actif le plus critique du projet.** Sa perte n'est pas récupérable : « if you lose this key you will NOT be able to publish new updates to the users that have the app already installed » ([Tauri — Updater](https://v2.tauri.app/plugin/updater/)). La rotation elle-même exige l'ancienne clé, la release qui introduit la nouvelle `pubkey` devant être **signée avec l'ancienne** pour que les installations existantes l'acceptent. Sauvegarde obligatoire hors GitHub, cf. § Backup & Recovery.

## Remplacement du sidecar à la mise à jour

Le sidecar porte tout le métier, mais il voyage comme **binaire externe**, pas comme code de l'application. Trois comportements documentés de la chaîne Tauri + NSIS s'y appliquent, dont deux mordent ici ([tauri#15134](https://github.com/tauri-apps/tauri/issues/15134), ouverte, Tauri v2 sur Windows 11) :

| Comportement | Effet ici |
|---|---|
| Tauri copie le sidecar dans `target/release/` **sans invalider la copie** | Un build qui réutilise ce répertoire peut embarquer un **sidecar périmé** sous une interface à jour. Ne pas mettre `target/release/` en cache CI, ou le purger avant le build de release |
| Réinstaller la **même version** ne remplace pas le sidecar déjà installé | Le réflexe « réinstalle par-dessus » **ne répare pas** un sidecar mis en quarantaine par l'antivirus. Il faut désinstaller d'abord, ou restaurer le fichier depuis la quarantaine |
| La CSP bloque les appels cross-origin du sidecar en production | Sans objet : le protocole passe par stdin/stdout en NDJSON, sans port ni requête HTTP locale ([ADR-005](adrs/005-sidecar-python-protocole-ndjson.md)) |

> ⚠️ **`externalBin` résout relativement à `src-tauri/`, pas à `src-tauri/binaries/`.** Le binaire étant rangé dans `binaries/`, la valeur correcte est `"externalBin": ["binaries/tagger"]`, Tauri ajoutant lui-même le suffixe target-triple. Écrire `["tagger"]` le ferait chercher `src-tauri/tagger-x86_64-pc-windows-msvc.exe`. Le point n'est pas documenté côté Tauri.

> 🔴 **Ce piège fissure une hypothèse de l'[ADR-018](adrs/018-versionnement-plan-de-run.md)**, qui écarte le versionnement du protocole NDJSON au motif que « l'interface et le sidecar sont empaquetés dans le même installeur et ne peuvent pas diverger en version ». C'est vrai du régime nominal, faux en présence de ce bug ou d'une quarantaine antivirus. L'hypothèse n'a pas à être abandonnée, mais elle demande un filet : **l'interface interroge la version du sidecar au démarrage et refuse de lancer un run si elle diffère de la sienne**, plutôt que de découvrir la divergence sur un champ de protocole absent, en plein run.

> **Conséquence sur le smoke test de mise à jour** : vérifier que le sidecar a bien changé de version après une mise à jour, pas seulement que l'application démarre. Une interface à jour parlant à un sidecar périmé est un mode de panne silencieux.

## Build Numbers

Un seul numéro, le SemVer de la § Versioning, propagé aux quatre fichiers. Pas de `versionCode` auto-incrémenté : aucun store n'impose de monotonie ici, et l'updater compare le SemVer.

Le binaire du sidecar porte en revanche un **suffixe target-triple obligatoire** imposé par Tauri : `tagger-x86_64-pc-windows-msvc.exe` dans `src-tauri/binaries/`. Codé pour une cible unique au MVP, il devra devenir une matrice le jour où macOS ou Linux arrive.

## Checklist Distribution

À dérouler à chaque release qui part chez un tiers (complète la Checklist Release ci-dessus) :

- [ ] Installeur téléchargé **depuis la Release publiée**, pas depuis l'artefact de CI
- [ ] Installation sur une machine ou VM propre, sans toolchain de développement
- [ ] Avertissement SmartScreen constaté et documenté dans le message envoyé aux utilisateurs
- [ ] Aucun faux positif Defender bloquant sur le sidecar (sinon : marche à suivre d'exclusion + signalement du faux positif à Microsoft)
- [ ] Premier lancement sans clé API : l'écran de Settings explique clairement quoi saisir
- [ ] Sidecar absent ou mis en quarantaine : l'écran bloquant nomme le fichier attendu et son emplacement, pas une interface vide

---

# 🌍 Environnements

## Liste Environnements

Deux états de l'application, pas des branches ni des serveurs. **Aucun hébergement** : tout tourne sur la machine de l'utilisateur, la seule dépendance distante étant techno-scraper, hors périmètre de ce projet.

| Env | Accès | Branch | Sidecar | Auto-publication |
|-----|-------|--------|---------|------------------|
| Développement | `tauri dev` en local | `develop`, `feature/*` | Lancé depuis les sources Python, sans PyInstaller | Non |
| Distribution | Installeur GitHub Releases | `main` (tags uniquement) | Binaire PyInstaller empaqueté et signé | Oui, au tag (cf. § Pipelines) |

Pas de staging : sans serveur ni base, il n'y a rien à déployer entre les deux. Le rôle du staging est tenu par la **VM propre** du smoke test d'installation.

> ⚠️ **Trois pièges connus n'existent qu'en Distribution** et sont strictement invisibles en `tauri dev` : le sidecar non remplacé à la mise à jour, le backend keyring introuvable et la sortie NDJSON bufferisée (cf. § Bootstrap technique). À partir de l'étape 4, un run complet rejoué **sur le bundle** est donc la seule validation qui compte, le mode développement ne prouvant rien sur ces trois points.

## Variables d'Environnement

Deux mondes distincts, à ne pas confondre.

**Au build (CI)** : secrets GitHub Actions, injectés au moment du `tauri build`, jamais commités.

```bash
# Secrets GitHub Actions (Settings → Secrets and variables → Actions)
TAURI_SIGNING_PRIVATE_KEY=<clé privée minisign de l'updater, contenu ou chemin>
TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<mot de passe de la clé ci-dessus>
SENTRY_DSN_SIDECAR=<DSN du projet Sentry Python `techno-tagger-sidecar`, région EU ; compilé dans le binaire du sidecar>
SENTRY_DSN_UI=<DSN du projet Sentry JavaScript `techno-tagger-ui`, région EU ; compilé dans le bundle Angular>
PRIMENG_LICENSE_KEY=<clé Community License, providePrimeNG({ license })>
SENTRY_AUTH_TOKEN=<Organization Auth Token, scope org:ci non modifiable, upload des source maps de la webview et création de la release Sentry au tag>
GITHUB_TOKEN=<fourni par Actions, publication de la Release>
```

**Au runtime (machine utilisateur)** : **aucune variable d'environnement**. C'est la différence de fond avec une application 12-factor : il n'y a ni conteneur ni panneau d'administration où poser une valeur. La configuration vit à deux endroits, tous deux locaux :

| Réglage | Emplacement | Pourquoi |
|---|---|---|
| Clé API techno-scraper | Trousseau de l'OS via keyring (Credential Manager Windows) | Chiffré par l'OS, jamais exposé au JavaScript de la webview ([ADR-012](adrs/012-securite-cle-api-keyring.md)) |
| URL de l'API, langue, seuils, mode copie / déplacement, signal sonore | Store Tauri (fichier local) | Réglages non sensibles, l'URL étant publique et déjà présente en clair dans le binaire |

En développement, le sidecar lit un `.env` local (jamais commité) pour un DSN **vide**, ce qui rend le SDK inerte et évite de polluer le projet Sentry pendant le développement ([ADR-014](adrs/014-observabilite-sentry-et-rgpd.md)).

### Règles
- ✅ **Aucun secret exploitable dans le binaire distribué** : ni clé API, ni token d'accès. Un `strings` sur un exécutable PyInstaller suffirait à l'extraire, et le dépôt est public. Les DSN Sentry font exception assumée : ils sont compilés par nécessité, et n'autorisent que l'**envoi** d'événements, jamais la lecture. Leur fuite permettrait au pire de polluer le quota, d'où leur présence dans le tableau de rotation.
- ✅ **`.env` git-ignoré**, `.env.example` commité listant les clés sans valeurs.
- ✅ **La clé API transite une seule fois** de l'interface vers le sidecar (commande `set_api_key`), puis vit exclusivement côté Python. Elle n'est jamais relue vers la webview, même masquée.
- ✅ **Clé API en ASCII imprimable sans espace** (ce que produit `secrets.token_urlsafe()`) : les en-têtes HTTP sont décodés en latin-1 côté API, une clé non-ASCII ne matcherait jamais.
- ✅ **DSN vide = SDK inerte**, seul moyen de désactiver la remontée en développement, des deux côtés.

### Anti-Patterns
- ❌ **Committer une clé, même de test, même une minute** : le dépôt est public, l'historique git est indélébile, la rotation devient obligatoire et immédiate.
- ❌ **Compiler une clé API partagée dans le binaire** : extractible, et sa révocation obligerait à rediffuser l'application à tout le monde ([ADR-012](adrs/012-securite-cle-api-keyring.md)).
- ❌ **Faire transiter la clé de signature updater hors de ses deux emplacements prévus** (secrets GitHub Actions et sauvegarde chiffrée hors ligne, cf. § Backup & Recovery) : ni dans le dépôt, ni dans un artefact de CI, ni dans un log de build.
- ❌ **Renvoyer la clé API à la webview** pour l'afficher dans les Settings : afficher un état (« une clé est enregistrée ») suffit, la valeur ne remonte jamais.

---

# 🔄 CI/CD

**GitHub Actions de bout en bout** : contrôle qualité, release-please, build des binaires, signature et publication. Pas de serveur, donc pas de déploiement au sens habituel : l'équivalent est la **publication d'une Release**, et le vrai « déploiement » se fait chez l'utilisateur, au démarrage suivant de son application.

## Pipelines

| Trigger | Étapes | Cible |
|---------|--------|-------|
| Push / PR (`main`, `develop`) | Ruff + Mypy strict + pytest (`sidecar/`), ESLint + typecheck + Vitest (`src/`), `cargo check` + `cargo clippy` (`src-tauri/`), seuil de coverage sur `sidecar/` | — (gate qualité) |
| Push `main` | release-please ouvre / met à jour la PR de release (CHANGELOG + bump), puis **un job rejoue `uv lock` et `cargo update --workspace` et pousse les lockfiles réalignés dans cette même PR** (cf. § Propagation de la version). **Aucun build.** | — |
| Merge PR release-please | Tag `vX.Y.Z`, puis **dans le même workflow** : build PyInstaller Windows → copie du binaire en `src-tauri/binaries/` avec son suffixe target-triple → `tauri build` → signature du bundle → publication de l'installeur et de `latest.json` sur la Release | GitHub Releases |

> 🔴 **Le job de build ne doit PAS être posé sur `on: push: tags`.** « Events triggered by the `GITHUB_TOKEN` will not create a new workflow run, with the following exceptions » ([doc GitHub](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)) : les exceptions sont `workflow_dispatch`, `repository_dispatch` et les `pull_request` `opened` / `synchronize` / `reopened`, un push de tag n'en fait pas partie. Le tag créé par release-please ne déclenche donc aucun workflow. Un workflow séparé sur `on: push: tags: v*` ne partirait **jamais, et sans erreur** — la Release resterait vide, l'updater ne verrait rien, et rien dans l'interface de GitHub ne signalerait le problème. Le build doit être **chaîné en `needs:`** dans le workflow release-please, conditionné à sa sortie `release_created`. Piège déjà rencontré sur techno-scraper.
>
> Alternative si un fichier séparé devenait nécessaire : donner un PAT ou un token de GitHub App à release-please, au prix d'un secret de plus à faire tourner.

> Pas de hooks pre-commit : la CI joue le même trio sur chaque PR, un `.pre-commit-config.yaml` ferait doublon.

> **Runners gratuits et illimités** grâce au dépôt public, y compris macOS le jour où cette cible reviendra ([ADR-021](adrs/021-visibilite-du-depot.md)).

## Rollback

**Déclencheur** : release publiée qui ne s'installe pas, application qui ne démarre pas, régression fonctionnelle grave (écriture de tags fausse, corruption de fichiers).

Il n'y a **rien à faire redescendre** : aucun serveur ne sert cette application. Le retour arrière est un roll-*forward*.

**Procédure** :
1. **Dépublier la Release fautive** (la repasser en draft) pour que `latest.json` cesse d'être servi. Les installations non encore mises à jour arrêtent immédiatement de la voir ; celles qui l'ont déjà prise ne reviennent pas en arrière pour autant. Le tag Git, lui, reste : matérialisé au merge de la PR de release, avec la Release publiée d'emblée, il ne disparaît pas quand celle-ci repasse en brouillon.
2. `hotfix/*` depuis `main` → PR titrée `fix:` → merge → PR release-please → **nouveau tag `PATCH`**. Jamais de suppression du tag fautif, qui fausserait le CHANGELOG sans rien corriger chez personne.
3. Vérifier la nouvelle Release : installeur + `latest.json` présents, smoke test d'installation et de mise à jour.
4. **Prévenir les utilisateurs à la main** si la version fautive a pu être installée. C'est le seul canal disponible : aucun mécanisme ne permet de forcer une mise à jour ni de savoir qui tourne sur quelle version.

> ⚠️ **Une régression qui a déjà écrit des tags n'est pas rattrapée par un rollback applicatif.** Le retour arrière des données passe par le **dump des tags d'origine** conservé avec le plan de run, via le bouton de rollback de l'application ([ADR-010](adrs/010-ecriture-batch-et-plan-de-run.md)). Le message aux utilisateurs doit le dire explicitement, sinon un rollback de version leur laisse croire que leurs fichiers sont revenus à l'état antérieur.

> **Cas particulier, le sidecar en quarantaine après mise à jour** : un binaire recompilé change d'empreinte et peut redevenir un faux positif alors que le précédent était exclu. Ce n'est pas une régression de code et un roll-forward n'y changerait rien, il faut refaire l'exclusion antivirus.

## Checklist Pré-MEP

Items à valider avant le tout premier merge sur `main` déclenchant la première publication.

### Bootstrap technique

- [ ] **PyInstaller en `--onedir`** — exécutable dans `externalBin`, dépendances (`_internal/`) dans `bundle.resources`, répertoire de travail du sidecar fixé explicitement. Mode retenu sur mesure, 335 ms contre 2282 ms au démarrage (cf. § Performance et [ADR-015](adrs/015-cibles-distribution-windows.md))
- [ ] **Paire de clés updater générée** — `tauri signer generate -w ~/.tauri/techno-tagger.key`, clé publique dans `tauri.conf.json` (contenu littéral, **pas un chemin**), clé privée + mot de passe dans les secrets GitHub **et** sauvegardés hors GitHub (cf. § Backup & Recovery)
- [ ] **`tauri.conf.json` pointe `"version": "../package.json"`** — supprime un fichier de version à synchroniser
- [ ] **Suffixe target-triple du sidecar** — `tagger-x86_64-pc-windows-msvc.exe`, sans quoi Tauri ne trouve pas le binaire externe, avec `"externalBin": ["binaries/tagger"]` (chemin relatif à `src-tauri/`, suffixe ajouté par Tauri)
- [ ] **`target/release/` hors cache CI** — Tauri y copie le sidecar sans invalider la copie, un cache de ce répertoire peut donc embarquer un binaire périmé dans l'installeur
- [ ] **Contrôle de version UI ↔ sidecar au démarrage** — refuser de lancer un run si les deux versions diffèrent, filet contre le sidecar non remplacé
- [ ] **Flush explicite après chaque ligne NDJSON** — `flush=True` à chaque événement émis, un binaire PyInstaller derrière un pipe ne respectant ni `-u` ni `PYTHONUNBUFFERED` : sans lui, l'interface paraît figée pendant tout le run (cf. [ADR-005](adrs/005-sidecar-python-protocole-ndjson.md))
- [ ] **Backend keyring forcé explicitement** — le hidden import seul ne suffit pas : les backends sont découverts par *entry points*, donc `--collect-metadata keyring` est requis, avec `--hidden-import win32ctypes.pywin32.win32cred` et `pywintypes`. Le plus sûr reste de court-circuiter la découverte par `keyring.set_keyring(WinVaultKeyring())`, et non par `PYTHON_KEYRING_BACKEND` : l'environnement du sidecar est hérité du process parent, hors de portée de son propre code. Sans cela le bundle lève `No recommended backend was available`, **au runtime chez l'utilisateur** (cf. [ADR-012](adrs/012-securite-cle-api-keyring.md)).
  ⚠️ **Non vérifiable avant l'étape 5** : au bootstrap, aucun module n'importe `keyring`, il n'entre donc pas dans le graphe analysé et `hook-keyring.py` ne se déclenche jamais. Constaté sur le binaire du bootstrap, qui ne contient ni `keyring.backends` ni `WinVaultKeyring`, seulement les métadonnées posées par le `copy_metadata` explicite du `.spec`. Cocher cet item sur un binaire antérieur à l'étape 5 ne prouve rien
- [ ] **`target-branch: main` valide sur le flux `develop → main`** — release-please raisonne sur une branche de vérité unique, et ce flux n'est documenté nulle part de son côté (cf. [VERSIONS.md](VERSIONS.md) § release-please). À éprouver sur un dépôt de test avant la première release, pas sur la première release
- [ ] **`extra-files` a bumpé les deux manifestes TOML** — après la première release, `src-tauri/Cargo.toml` et `sidecar/pyproject.toml` portent la même version que `package.json`. Un `jsonpath` qui ne matche rien **n'échoue pas**, il ne fait rien : `sidecar/tests/unit/test_main.py` le rattrape au commit suivant, pas au moment du tag
- [ ] **WebView2 présent sur le runner `windows-latest`** — sa présence sur l'image n'est pas confirmée (cf. [VERSIONS.md](VERSIONS.md) § GitHub Actions). Son absence casse `tauri build`, ou pire produit un installeur dont l'application ne s'ouvre pas
- [ ] **Releases Sentry créées dans les deux projets** — job `sentry-release` de `release-please.yml`, matrice sur `techno-tagger-ui` et `techno-tagger-sidecar`, `set_commits: auto` (d'où le `fetch-depth: 0`). Sans la release des deux côtés, une erreur de webview et une erreur de sidecar ne se croisent sur aucune livraison
- [ ] **Source maps de la webview uploadées puis purgées** — `sourceMap: { hidden: true }` en configuration `production`, upload par `sentry-cli` dans le script npm `sourcemaps`, que `pnpm build` enchaine, suppression des `.map` avant que `tauri build` n'embarque `frontendDist`. `tauri-codegen` n'écarte aucune extension : une map oubliée met tout le TypeScript d'origine dans l'installeur. Sentry résout par les Debug IDs qu'`@angular/build` injecte, pas par le chemin des fichiers
- [ ] **`pnpm-workspace.yaml` créé** — même sans monorepo : depuis pnpm 11, `.npmrc` n'accepte plus que l'auth et le registry, et `allowBuilds: { esbuild: true }` doit y vivre
- [ ] **Ruff interdit `asyncio.get_event_loop` et `sqlite3.version`** — via `banned-api`, les deux étant supprimés ou durcis en Python 3.14. Fait porter la garantie par la CI plutôt que par la vigilance
- [ ] **Actions CI pinnées** — `pnpm/setup` sur la v2.1.0 et non sur le tag flottant `@v2`, qui traîne sur une version antérieure au correctif de chemin de cache Windows
- [ ] **Renovate installé et `renovate.json` commité** — l'app GitHub activée sur le dépôt, et « Dependency graph » plus « Dependabot alerts » laissés actifs dans les réglages de sécurité
- [ ] **Permissions minimales dans `capabilities/default.json`** — `shell` restreint au seul sidecar, plus `dialog`, `fs`, `store`, `os`, `opener`, `updater`. Aucune permission large « au cas où ». `opener` est requis par le bouton « ouvrir le dossier de logs » et le lien vers la fiche source : en Tauri v2, l'ouverture d'un chemin ou d'une URL ne relève plus de `shell`
- [ ] **Instance unique activée** — plugin `single-instance` : deux fenêtres signifieraient deux sidecars écrivant le même plan de run
- [ ] **Préfixe `\\?\` sur les chemins Windows** du sidecar — la limite de 260 caractères est franchie par une bibliothèque profonde plus un renommage, et `LongPathsEnabled` ne suffit pas à un interpréteur Python non manifesté
- [ ] **Durcissement Sentry en place et testé** — `include_local_variables=False`, `server_name` fixe, `send_default_pii` au défaut, scrubbing des chemins. Trois réglages qui sont **la seule protection** ([ADR-014](adrs/014-observabilite-sentry-et-rgpd.md))
- [ ] **Icônes et branding** — jeu d'icônes Tauri généré, nom de produit et éditeur cohérents dans l'installeur

> Items techniques et de bootstrap, à valider empiriquement. Pas d'ADR : aucune décision architecturale structurelle, celles-ci vivent dans `adrs/`.

### Revue globale de l'app

- [ ] **`/simplify`** — passe qualité sur toute la branche. Seul écrivain de la chaîne, donc seul et en premier
- [ ] **`/code-review`** + **`Agent(code-reviewer)`** — correctness et conformité aux `.claude/rules/**`, en parallèle
- [ ] **Appliquer les findings retenus** — dernière écriture avant le gel du code
- [ ] **`/security-review`** — seul et en dernier, sur l'état gelé

> Points de vigilance connus, sans que la revue s'y limite : clé API dans les logs et les rapports, chemins et titres de morceaux dans les payloads Sentry.

### Cohérence documentaire

- [ ] **BRAINSTORM.md** — auditer le doc dans son ensemble et identifier les écarts entre la vision / les features et l'implémentation livrée
- [ ] **ARCHITECTURE.md** — auditer le doc dans son ensemble (ADRs compris) et identifier les écarts avec le code, dont le mécanisme de déclenchement du build signalé en § Pipelines
- [ ] **DESIGN.md** — auditer le doc dans son ensemble et identifier les écarts entre le design system et l'interface livrée
- [ ] **VERSIONS.md** — confronter les versions documentées à celles réellement installées (`pyproject.toml`, `package.json`, `Cargo.toml`), et vérifier que les incertitudes de sa checklist ont toutes été levées par le premier build
- [ ] **PRODUCTION.md** — auditer le doc dans son ensemble et vérifier que toutes les procédures documentées sont effectivement en place (secrets, sauvegarde de la clé, alertes, rotation)
- [ ] **README.md** — présentation, stack, getting started, liens docs, complété une fois les autres docs stabilisées. Rester factuel : « récupère des métadonnées via une API », pas « scrape Beatport » ([ADR-021](adrs/021-visibilite-du-depot.md))

> **Pas de sous-section conformité légale / RGPD.** Outil personnel non commercialisé, sans compte, sans analytics et sans cookie ; le durcissement du SDK garantit qu'aucune donnée personnelle ne quitte la machine, et c'est un **test** qui tient cette garantie, pas une page de mentions ([ADR-014](adrs/014-observabilite-sentry-et-rgpd.md)). Si la distribution s'élargissait au-delà du cercle amical, cette section serait à ouvrir, en commençant par informer que les plantages remontent.

### Validation technique finale

- [ ] **`uv run ruff check sidecar/ && uv run ruff format --check sidecar/`** — lint + format Python
- [ ] **`uv run mypy sidecar/src/`** — typecheck strict
- [ ] **`uv run pytest`** — tests du sidecar, techno-scraper et Sentry mockés
- [ ] **`pnpm lint && pnpm typecheck`** — ESLint (+ règles de templates et d'accessibilité) et types Angular
- [ ] **`pnpm test`** — Vitest vert, et les règles métier portées par un composant effectivement couvertes (pas de seuil chiffré sur `src/`)
- [ ] **`cargo check && cargo clippy`** — la coquille compile proprement
- [ ] **`pnpm tauri build`** — installeur produit sans erreur, sidecar bien empaqueté
- [ ] **Smoke test du livrable** — installer le bundle produit sur une machine ou VM propre, lancer, saisir une clé, faire un run complet sur quelques morceaux
- [ ] **Test de sécurité vert** — la clé API n'apparaît ni dans les logs, ni dans les rapports, ni dans les payloads Sentry ; aucun chemin ni titre de morceau dans les payloads Sentry

## Checklist Post-MEP

Items one-shot après la première Release publiée, nécessitant qu'elle soit accessible publiquement.

- [ ] **`latest.json` accessible sans authentification** — `curl -L https://github.com/thibaud57/techno-tagger/releases/latest/download/latest.json` rend le manifeste, avec `version`, `platforms.windows-x86_64.url` et `.signature` renseignés
- [ ] **Chaîne de mise à jour vérifiée en réel** — machine en version N-1, l'updater détecte, télécharge, **vérifie la signature**, installe et relance
- [ ] **Installation depuis zéro sur une machine tierce** — celle d'un des utilisateurs réels, pas une VM : SmartScreen, antivirus et trousseau s'y comportent différemment
- [ ] **Faux positif antivirus mesuré** — soumission de l'installeur et du sidecar à VirusTotal pour connaître l'ampleur réelle, et signalement aux éditeurs concernés si le blocage est bloquant
- [ ] **Chaîne d'alerte Sentry** — provoquer une erreur de test côté sidecar et côté webview, vérifier la réception de l'issue **et** de l'email
- [ ] **Payload Sentry inspecté en vrai** — ouvrir un event réel dans l'interface Sentry et confirmer l'absence de variables locales, de nom de machine, de chemin utilisateur et de titre de morceau
- [ ] **Clé API révoquée testée** — avec une clé invalide, le run s'arrête après trois `403` consécutifs avec un message nommant la clé, pas 100 échecs indiscernables d'une panne réseau
- [ ] **Release Sentry créée au tag** — la version publiée existe côté Sentry avant tout incident, sans quoi elle naîtra du premier crash, sans commits ni deploy

> **Déjà vérifié sur build local au bootstrap**, ce qui ne coche aucun item ci-dessus — ils exigent une Release publiée — mais évite de tout reprendre à l'aveugle. Sur un event réel des deux projets : arrivée de l'issue, `release` identique de part et d'autre (`techno-tagger@0.0.0`, parsée en semver), `environment: production`, `server_name` fixe et non le nom de machine, aucune breadcrumb, aucune variable locale dans les frames, et chemin utilisateur masqué en `<user>` par les deux scrubbers. Restent à couvrir en post-MEP : la réception de l'**email**, la présence d'un **titre de morceau** dans un payload (aucun n'existe au bootstrap), et le comportement depuis une application **installée**.

---

# 🔧 Mises à jour

## Composants applicatifs

| Composant | Fréquence | Procédure |
|-----------|-----------|-----------|
| Dépendances Python (uv) | Mensuelle / sur CVE | PR Renovate (manager `pep621`, lit `uv.lock`) → CI verte → merge |
| Dépendances Node (pnpm) | Mensuelle / sur CVE | PR Renovate (manager `npm`) → CI verte → merge |
| Crates Rust (cargo) | Mensuelle / sur CVE | PR Renovate (manager `cargo`) → `cargo check` + build → merge |
| Actions GitHub | Mensuelle | PR Renovate (manager `github-actions`) |
| Tauri (majeure) | Sur release majeure | PR dédiée, guide de migration, **build + smoke test d'installation obligatoires** avant merge |
| Angular / PrimeNG (majeures) | Sur release majeure | PR dédiée, `ng update`, vérification visuelle des écrans |
| Runtime Python du sidecar | Sur fin de support | Bump dans `pyproject.toml` et `.python-version`, rebuild PyInstaller, **retester les faux positifs antivirus** |
| Runtime Node du build | Au passage LTS de la ligne suivante | Bump de `runtime:` dans `pnpm/setup` et d'`engines.node`. Prochaine échéance : Node 26, LTS planifiée au 2026-10-28 |
| Licence PrimeNG Community | Annuelle | Renouvellement gratuit, mise à jour du secret `PRIMENG_LICENSE_KEY`. **Conditionné à l'issue de l'[ADR-003](adrs/003-primeng-community-license.md)**, rouvert depuis l'archivage du dépôt PrimeNG (cf. [VERSIONS.md § Conflits](VERSIONS.md#conflits-potentiels)) : cette ligne et les entrées `PRIMENG_LICENSE_KEY` des tableaux de secrets tombent si la bibliothèque change |

**Renovate** : managers `npm`, `pep621`, `cargo` et `github-actions` auto-détectés, cadence mensuelle, PRs ciblant `develop`, `prConcurrentLimit` pour tenir le flux. Grouper minor et patch par manager via `packageRules` ; laisser les **majeures sortir isolées**, une par dépendance, ce qui met d'office en quarantaine les mises à jour à risque.

> 🔴 **Dependabot ne convient pas à ce projet, et son mode de panne est silencieux.** Sur un `pnpm-lock.yaml` multi-document, celui que produit pnpm 11 dès que `devEngines.packageManager` est déclaré, les PR de bump continuent de fonctionner mais le *dependency grapher* lit le mauvais document et rapporte zéro dépendance : **les alertes de sécurité se referment d'elles-mêmes**, sans rien afficher. Correctif en attente ([dependabot-core#14794](https://github.com/dependabot/dependabot-core/issues/14794) ouverte, PR #15968 non mergée). Renovate n'est pas exposé : il ne parse pas le lockfile, il le fait régénérer par la CLI du gestionnaire. Détail dans [VERSIONS.md § Renovate](VERSIONS.md#6-renovate).

> ⚠️ **Une PR de mise à jour peut faire échouer `pnpm install --frozen-lockfile`** si le lockfile régénéré pointe une transitive publiée dans les dernières 24 heures, `minimumReleaseAge` de pnpm 11 la rejetant (`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`). Aligner le `minimumReleaseAge` de Renovate sur celui de pnpm, et garder `minimumReleaseAgeExclude` pour les paquets qui se republient sans cesse.

> ✅ **Toute mise à jour touchant le packaging se valide par un build complet**, pas par une CI verte : c'est `tauri build` et l'installeur qui cassent, pas les tests unitaires.
> ❌ **Ne jamais bumper Tauri et le runtime Python dans la même PR** : les deux touchent l'empaquetage, un échec de build ne dirait plus lequel accuser.
> ⚠️ **Un lot purement `chore:` ne publie rien** : `chore` n'est pas une unité releasable, donc pas de tag et pas de build. Titrer la PR `develop → main` en `fix:` quand le lot corrige une CVE ou une régression, ou forcer via `Release-As: X.Y.Z`.

---

# 🔐 Sécurité & Configuration

Surface d'attaque volontairement minimale : **aucun port en écoute, aucun compte, aucune donnée stockée à distance**. Les sections Security Headers, CORS et Rate Limiting du canevas d'ops sont donc sans objet ici, il n'y a pas de serveur à protéger. Les deux risques réels sont l'exfiltration de la clé API et la corruption de fichiers musicaux, traités respectivement par le trousseau de l'OS et par l'écriture différée avec dump préalable.

## Secrets & Configuration

### Gestion des Secrets

| Secret | Stockage | Accès | Conséquence en cas de perte |
|--------|----------|-------|------------------------------|
| `TAURI_SIGNING_PRIVATE_KEY` (+ password) | Secrets GitHub Actions **et** sauvegarde chiffrée hors GitHub | Injecté au build, jamais logué | 🔴 **Plus aucune mise à jour possible sur les installations existantes** |
| `SENTRY_DSN_SIDECAR` / `SENTRY_DSN_UI` | Secrets GitHub Actions | Compilés au build, init des deux SDK (deux projets Sentry, cf. § Observabilité) | Régénérables depuis Sentry |
| `PRIMENG_LICENSE_KEY` | Secrets GitHub Actions | `providePrimeNG({ license })`, gravée dans le bundle par `--define` | Bandeau de licence chez les utilisateurs, renouvellement gratuit (échéance au § Rotation) |
| `SENTRY_AUTH_TOKEN` | Secrets GitHub Actions | Upload des source maps de la webview par `pnpm build` et création de la release Sentry au tag, **Organization Auth Token**, scope `org:ci` imposé et non modifiable, jamais le token du CLI local | Régénérable côté Sentry, sans impact sur les binaires déjà distribués |
| Clé API techno-scraper (utilisateur) | Trousseau de l'OS via keyring, machine de l'utilisateur | Header `X-API-Key` posé par le sidecar | L'utilisateur en ressaisit une, révocation individuelle côté API |
| Jeu `API_KEYS` (`user-N` → clé) | Variables d'environnement côté techno-scraper (Dokploy) + sauvegarde chiffrée | Garde fail-closed de l'API | La correspondance vers les personnes est perdue, plus moyen de savoir qui révoquer |

La clé publique de l'updater est compilée dans `tauri.conf.json` et publiée avec le dépôt, c'est son rôle. La clé privée ne quitte jamais les secrets GitHub et la sauvegarde.

### Gestion des clés utilisateurs

Une clé distincte par personne, jamais compilée dans le binaire ([ADR-012](adrs/012-securite-cle-api-keyring.md), [ADR-016](adrs/016-multi-cles-techno-scraper.md)).

| Opération | Procédure |
|---|---|
| **Générer** | `python -c "import secrets; print(secrets.token_urlsafe(32))"` — ASCII imprimable sans espace, contrainte imposée par le décodage latin-1 des en-têtes HTTP côté API |
| **Enregistrer** | Ajouter `user-N:<clé>` au jeu `API_KEYS` côté techno-scraper, redéployer l'API. **Identifiant non nominatif** : un prénom finirait chez Sentry via la `LoggingIntegration`, seule donnée nominative de la chaîne |
| **Transmettre** | Canal privé direct (messagerie), jamais par email en clair, jamais dans une issue ou un commit |
| **Suivre** | Tenir la table `user-N` → personne → clé dans la sauvegarde chiffrée, seul endroit où la correspondance existe. Sans elle, un `user-3` qui sature l'API reste anonyme |
| **Révoquer** | Retirer l'entrée du jeu `API_KEYS`, redéployer. L'utilisateur concerné reçoit alors des `403` et le run s'arrête après trois consécutifs, avec un message nommant la clé |

> 🔴 **Cette procédure décrit une capacité que techno-scraper n'a pas encore.** Vérifié dans son code le 2026-08-27, release `3.1.2` : `core/security.py` compare en temps constant contre `settings.api_key`, et `core/config.py` ne déclare que ce champ. L'API n'accepte donc **qu'une seule clé** ; le jeu de clés nommées `API_KEYS` est un chantier de son backlog, suivi dans [techno-scraper#73](https://github.com/thibaud57/techno-scraper/issues/73) et décidé en [ADR-016](adrs/016-multi-cles-techno-scraper.md).
>
> **Rien ne bloque côté techno-tagger** : l'application envoie en header ce qu'on lui donne, indifférente à la façon dont l'API le vérifie. Ce qui est bloqué, c'est **l'opérationnel de la distribution** : tant que `API_KEYS` n'est pas livré, tout le monde partage la même clé, donc aucune révocation individuelle, aucune attribution de consommation. Livrer côté API **avant l'étape 9**, sinon la première distribution à des tiers se fait avec le modèle que l'[ADR-012](adrs/012-securite-cle-api-keyring.md) rejette.
>
> `api_key` reste accepté en repli le temps d'une version mineure côté API, ce qui permet de migrer sans fenêtre d'indisponibilité.

> Volume attendu : **une dizaine d'utilisateurs**, cinq runs simultanés au plus. Aucune automatisation ne se justifie à cette échelle, mais **la liste doit exister** : sans elle, une clé qui fuite ne peut être ni attribuée ni révoquée sans couper tout le monde.

### Rotation

| Secret | Fréquence | Procédure |
|--------|-----------|-----------|
| Clé API d'un utilisateur | Sur suspicion de fuite, ou au départ de la personne | Générer, remplacer l'entrée dans `API_KEYS`, redéployer l'API, transmettre la nouvelle clé, la personne la ressaisit dans les Settings |
| `SENTRY_DSN_SIDECAR` / `SENTRY_DSN_UI` | Sur suspicion de fuite | Régénérer côté Sentry, mettre à jour le secret GitHub, **publier une nouvelle version** : le DSN est compilé, les installations existantes gardent l'ancien jusqu'à leur mise à jour |
| `PRIMENG_LICENSE_KEY` | Annuelle, **valide jusqu'au 2027-08-30** | Émise le 2026-08-30, tier Community, 4 sièges. Grâce de 30 jours au-delà, soit jusqu'au 2027-09-29. Renouvellement gratuit par reconfirmation d'éligibilité sur [primeui.dev/licenses/community](https://primeui.dev/licenses/community), puis mise à jour du secret. **Effectif à la prochaine release seulement** : une version déjà distribuée garde la clé expirée et affiche la notice |
| `SENTRY_AUTH_TOKEN` | Sur suspicion de fuite | Régénérer côté Sentry, mettre à jour le secret. Effet immédiat, ce token n'est jamais compilé dans un binaire |
| **Clé de signature updater** | ❌ **Non rotative en pratique** | La release qui introduit la nouvelle `pubkey` doit être **signée avec l'ancienne clé** pour que les installations existantes l'acceptent. Sans l'ancienne clé, il n'y a pas de transition possible, seulement une réinstallation manuelle chez chaque utilisateur |

> ⚠️ **Une rotation de clé de signature se prépare, elle ne s'improvise pas.** Si elle devient nécessaire (fuite avérée), la séquence est : générer la paire B, publier une version signée avec A portant la `pubkey` de B, attendre que **tout le monde** l'ait installée, puis seulement signer avec B. Tant qu'un utilisateur n'a pas pris la version de transition, il est définitivement bloqué sur A.

## Dépendances

| Outil | Scope | Fréquence | Config |
|-------|-------|-----------|--------|
| Renovate | `npm`, `pep621` (uv), `cargo`, `github-actions` | Mensuelle | `renovate.json` sur `config:recommended`, PRs vers `develop`, minor+patch groupés par manager, majeures isolées |
| CI | Toutes les PRs Renovate | À chaque PR | Même gate qualité que les PRs humaines |
| Alertes de sécurité GitHub | Dépôt public | Continu | **« Dependency graph » et « Dependabot alerts » à laisser activés** : Renovate les lit via l'API, il ne les produit pas |

> L'app GitHub Renovate est gratuite sur dépôt public. Les alertes de sécurité restent produites par GitHub et non par l'outil de mise à jour : les désactiver en croyant qu'elles font doublon avec Renovate priverait le projet de sa seule veille CVE.

---

# 📊 Observabilité

## Stack Monitoring

Minimal et gratuit, pour un dev solo et quelques utilisateurs : **Sentry (plan Developer) + logs locaux + rapport de run**.

| Outil | Usage | Accès |
|-------|-------|-------|
| Sentry (`sentry-sdk` Python) | Crashs du sidecar, API injoignable, parsing cassé | Dashboard Sentry, région EU, fixée à la création de l'organisation et jamais modifiable ensuite |
| Sentry (`@sentry/angular`) | Erreurs de la webview | Projet Sentry **distinct** de celui du sidecar |
| Fichier de log local | Débogage à distance chez un utilisateur | Bouton « ouvrir le dossier de logs » dans les Settings |
| Rapport de run (JSON + Markdown) | Qualité du matching, cas d'arbitrage, échecs | Dossier destination, envoi par geste explicite |

**Deux projets Sentry**, un pour le sidecar Python, un pour la webview. Un projet unique accepterait techniquement les deux, mais JavaScript est bruyant : mélangé au Python, il noierait les crashs du sidecar, seuls à porter du métier. Le **quota se compte au niveau de l'organisation**, pas du projet : découper ne double pas les 5 000 events du plan gratuit, cela ne fait que les rendre triables. La version publiée doit exister comme release dans **les deux** projets.

Les deux projets vivent dans l'organisation `tg-ws`, sous les slugs `techno-tagger-ui` et `techno-tagger-sidecar`, écrits en dur dans `release-please.yml` : ni l'un ni l'autre n'est un secret, et une `var` GitHub les rendrait invisibles depuis le dépôt. Le slug `techno-tagger-ui` désigne aussi le package Angular, ce sont deux objets distincts.

**Release tracking** : `sentry_sdk.init(release="techno-tagger@X.Y.Z")`, la version étant lue du package installé, donc bumpée par release-please et jamais à la main. Le nom, lui, est **fixé en dur et identique dans les deux projets** : le package Python s'appelle `tagger`, laisser le SDK dériver le nom donnerait deux chaînes de release différentes de part et d'autre, incomparables. Le préfixe `nom@` conditionne le classement en versioning sémantique côté Sentry, et avec lui la détection de régression et le tri `release:latest`. La détection automatique du SDK ne peut pas suppléer : elle retomberait sur un SHA git absent du binaire distribué.

> ⚠️ **Tagger les events ne crée pas la release côté Sentry** : elle n'est matérialisée qu'au premier event qui la porte, donc au premier crash. Créer la release au tag, dans le même workflow que le build (job conditionné à `release_created`, secret `SENTRY_AUTH_TOKEN` portant un **Organization Auth Token**, jamais le token du CLI local qui est nominatif et à durée de vie courte).

> `project:releases` existe toujours, mais c'est un scope de **Personal Token** : il n'est pas proposé à la création d'un token d'organisation.

> **Ce que le monitoring ne voit pas, et ne verra jamais** : combien d'utilisateurs tournent, sur quelle version, et si la mise à jour est passée. Aucun événement métier n'est envoyé, aucun ping de version n'existe. C'est délibéré ([ADR-014](adrs/014-observabilite-sentry-et-rgpd.md)) et cela conditionne toute la gestion d'incident : le parc est invisible, la seule information disponible est un crash spontané ou un ami qui écrit.

## Métriques Clés

Pas de métrique serveur à surveiller. Les signaux utiles se lisent dans Sentry et dans les rapports de run.

| Métrique | Seuil Warning | Seuil Critical |
|----------|---------------|----------------|
| Quota Sentry consommé (plan Developer, 5 000 events/mois **partagés avec techno-scraper**, même organisation) | > 2 500 / mois | > 4 000 : marge avant le plafond de 5 000, au-delà duquel les events sont **jetés silencieusement** |
| Morceaux non résolus **faute de requête exploitable** (nettoyage vide, tags absents, nom de fichier réduit à du bruit) | — | — : jamais une alerte, c'est la qualité de la bibliothèque source |
| Morceaux en échec **par erreur de source** (5xx épuisés, parsing, réponse hors schéma) | ≥ 3 sur un run | ≥ 10 % du run : la source a changé, pas la bibliothèque |
| `403` consécutifs sur techno-scraper | 1 | 3 : le run s'arrête de lui-même, clé invalide ou révoquée |
| `504` sur techno-scraper dans un run | quelques-uns | rafale : pool client désaligné des sémaphores de l'API ([ADR-017](adrs/017-taille-pool-concurrence.md)) |
| Échecs de démarrage du sidecar | 1 remontée | plusieurs utilisateurs : faux positif antivirus généralisé sur le build courant |
| Taille du dossier de cache | > 400 Mo | > 500 Mo : l'éviction LRU ne tient pas sa promesse ([ADR-013](adrs/013-cache-disque-jetable.md)) |
| Taille du dossier de logs | — | > 20 Mo : la rotation ne fonctionne pas (5 Mo × 4 fichiers est le maximum théorique) |

> **Pas de seuil sur le total de morceaux non résolus, délibérément.** Un pourcentage global mélange deux causes que plus rien ne sépare ensuite : une bibliothèque de téléchargements sauvages mal nommés en produit légitimement beaucoup, une source cassée aussi, et le même chiffre appellerait deux corrections opposées. Le rapport distinguant déjà ces motifs, le seuil se pose **sur le motif**, jamais sur le total. Le « ≥ 3 erreurs de source » reste indicatif et se recalera aux premiers runs ; les autres lignes sont adossées à des valeurs dures (quota du plan Sentry, garde des trois `403`, plafonds de cache et de logs).

## Alertes

Canal unique : **email**, envoyé nativement par Sentry. Un projet à quelques utilisateurs n'a pas de volume justifiant une astreinte ni un routage plus fin.

| Alerte | Condition | Canal |
|--------|-----------|-------|
| Crash du sidecar | Exception non gérée remontée | Email (Sentry) |
| API injoignable | `SourceUnavailableError` / erreur réseau épuisée côté sidecar | Email (Sentry) |
| Parsing cassé | Réponse de techno-scraper non conforme au schéma attendu | Email (Sentry) |
| Erreur de la webview | Exception Angular non gérée | Email (Sentry) |
| Quota Sentry proche | Notification native du plan Developer | Email (Sentry) |

> **Le canal d'amélioration du matching n'est pas Sentry** mais le bouton « envoyer ce rapport » de l'écran final : geste explicite de l'utilisateur, seul endroit où des titres de morceaux quittent la machine, et qui ne consomme pas le quota d'erreurs.

> **Pas d'alerte sur un run raté.** Un run avec beaucoup de non-résolus est un cas fonctionnel, pas un incident technique : il se lit dans le rapport, pas dans Sentry. Y envoyer un event par échec brûlerait le quota gratuit et noierait les vrais crashs.

---

# 📝 Logging

## Format

### Structure

Fichier local unique, une ligne par événement, au format **logfmt** : un préfixe lisible (horodatage, niveau, logger, message) suivi des champs structurés en `clé=valeur`.

```
2026-08-27 21:14:03 INFO    tagger.matching  candidat retenu     run=a3f9c1 track=42 score=91 source=beatport
2026-08-27 21:14:04 WARNING tagger.files     fichier verrouillé  run=a3f9c1 track=43 reason=locked
2026-08-27 21:14:09 ERROR   tagger.scraper   arrêt du run        run=a3f9c1 status=403 consecutive=3
```

Le choix se lit depuis le lecteur final : ce fichier a un seul destinataire, l'auteur, quand un utilisateur clique sur « ouvrir le dossier de logs » et envoie le fichier par message. Rien ne l'agrège, rien ne le corrèle à Sentry, et **l'artefact machine du projet existe déjà**, c'est le rapport de run JSON relu par l'application. Du JSON par ligne coûterait donc la lisibilité sans acheter ce qui le justifie côté API, où les logs sont relus et filtrés dans une console Docker.

logfmt garde les deux propriétés : la ligne se lit d'un coup d'œil, et `grep 'status=403' tagger.log` fonctionne sans outil chez quelqu'un qui n'a pas `jq`.

`run` est présent sur **chaque** ligne. La rotation se déclenchant sur la taille et jamais sur le run, un fichier ne correspond à rien de fonctionnel et un run peut être à cheval sur deux fichiers : sans cette clé, un log tronqué à la rotation devient illisible.

`stderr` reste relayé à la console de développement par Tauri, mais n'est **jamais la seule sortie** : une application empaquetée chez un tiers n'a pas de console.

## Niveaux

| Level | Usage |
|-------|-------|
| `DEBUG` | Détail de développement (requêtes construites, payloads bruts, scores intermédiaires). Jamais actif dans un build distribué |
| `INFO` | Démarrage / arrêt du sidecar, début et fin de run, décisions de matching, phase d'écriture |
| `WARNING` | Retry réseau, fichier verrouillé, chemin tronqué, requête vide après nettoyage, cache évincé |
| `ERROR` | Sidecar qui tombe, API injoignable après retries, `403` répétés, échec d'écriture, plan de run illisible |

## Rétention

| Env | Rétention | Gestion |
|-----|-----------|---------|
| Distribution (logs) | 20 Mo au maximum sur le disque | `RotatingFileHandler` sur `tagger.log` dans `appLocalDataDir()` : rotation à 5 Mo, 3 sauvegardes, aucune purge à écrire |
| Distribution (erreurs) | 30 jours | Sentry, plan Developer gratuit |
| Distribution (rapports de run) | Permanente | Dossier destination de l'utilisateur, c'est un livrable |
| Développement | Session | Console + fichier local |

À quelques dizaines de kilooctets par run, ces 20 Mo couvrent plusieurs centaines de runs.

## Règles Logging

### Règles
- ✅ **Jeu de clés logfmt fixe** : `run`, `track`, `source`, `score`, `status`, `reason`. C'est le seul coût du format : une clé inventée au fil des commits (`track_id` à côté de `track`) rend un `grep` faux sans que rien ne casse ni ne se voie.
- ✅ **Le fichier local peut contenir des chemins complets**, c'est la machine de l'utilisateur et c'est ce qui rend un dépannage à distance possible. **Sentry non** : les chemins y sont scrubbés parce qu'ils portent le nom d'utilisateur de l'OS.
- ✅ **Une ligne par décision de matching** : score, source, état retenu. C'est la trace qui permet de comprendre après coup pourquoi un morceau est parti en arbitrage.
- ✅ **Distinguer les motifs d'échec** : « aucune source n'a répondu » et « on n'avait rien à demander après nettoyage » sont deux lignes différentes, elles n'appellent pas la même correction.
- ✅ **Erreur loguée une seule fois**, au point où elle est traitée, jamais aussi au point de levée : sinon un incident produit deux lignes et deux events Sentry.

### Anti-Patterns
- ❌ **Logger la clé API**, en clair ou tronquée, dans le fichier local comme dans un payload Sentry. Couvert par un test de sécurité dédié.
- ❌ **Logger les réponses brutes complètes** de techno-scraper en dehors de `DEBUG` : volume inutile dans un fichier plafonné à 5 Mo.
- ❌ **Écrire les logs ailleurs que dans `appLocalDataDir()`** : ni à côté des fichiers musicaux (ce n'est pas un livrable), ni dans le dossier d'installation (droits insuffisants).
- ❌ **Compter sur `stderr`** pour diagnostiquer chez un utilisateur : il n'y a pas de console dans une application empaquetée.
- ❌ **Envoyer un titre de morceau à Sentry**, par un message d'erreur formaté ou une variable locale. C'est exactement ce que `include_local_variables=False` empêche, et ce qu'un message construit à la main pourrait réintroduire.

---

# 🚨 Incident Response

## Sévérités

| Sévérité | Définition | Response Time | Escalation |
|----------|------------|---------------|------------|
| 🔴 Critique | Chaîne de mise à jour cassée (`latest.json` absent ou invalide, signature refusée), application qui ne démarre pas, écriture de tags fausse ou destructrice | Dès constat | Dépublier la Release, roll-forward `PATCH`, prévenir les utilisateurs à la main |
| 🟡 Moyen | Un utilisateur bloqué (sidecar en quarantaine, clé révoquée), matching dégradé sur une source, techno-scraper indisponible | < 48 h | Marche à suivre antivirus, nouvelle clé, ou attendre le rétablissement de l'API |
| 🟢 Faible | Erreurs sporadiques, faux positifs de scoring, cache mal calibré, chemins tronqués | Best-effort | Correctif planifié dans le prochain lot |

> **La détection est le point faible assumé de ce dispositif.** Aucun healthcheck ne surveille une application installée chez quelqu'un d'autre : un incident 🔴 peut rester invisible tant que personne ne relance l'application ou n'écrit. Les crashs remontent seuls par Sentry, mais une mise à jour qui n'arrive jamais ne produit aucun crash, donc aucun signal. C'est le smoke test de mise à jour de la Checklist Release qui tient ce risque, pas le monitoring.

## Post-mortem Template

Pour tout incident 🔴 Critique.

```markdown
## Incident: <titre>
**Date**: <date>
**Durée**: <durée, de la publication fautive au correctif diffusé>
**Sévérité**: <🔴/🟡/🟢>
**Version(s) affectée(s)**: <vX.Y.Z>

### Timeline
- HH:MM - <événement>
- HH:MM - <événement>

### Root Cause
<description : build, signature, mise à jour, écriture de tags, dépendance, faux positif antivirus…>

### Impact
<combien d'utilisateurs ont pu installer la version fautive, fichiers musicaux touchés ou non, rollback de run nécessaire ou non>

### Actions
- [ ] <action corrective (roll-forward, message aux utilisateurs, rollback des tags…)>
- [ ] <action préventive (test, item de checklist, garde-fou…)>
```

---

# 💾 Backup & Recovery

Aucune base de données, et le code est déjà sauvegardé par GitHub. Trois actifs **ne sont pas dans le dépôt** et disparaîtraient avec le poste de développement.

## Stratégie Backup

| Ressource | Fréquence | Rétention | Localisation |
|-----------|-----------|-----------|--------------|
| **Clé privée updater + son mot de passe** | À la génération, revérifié avant chaque release | Permanente | Archive **7-Zip chiffrée AES-256** déposée sur Google Drive **et** sur une clé USB |
| **Jeu `API_KEYS` (`user-N` → clé)** | À chaque ajout ou révocation d'utilisateur | Permanente | Même archive chiffrée |
| Secrets GitHub Actions (DSN, licence PrimeNG) | Sur changement | Permanente | Même archive, régénérables par ailleurs |
| Code, historique, CHANGELOG | Continu | Permanente | GitHub (dépôt public) |
| Installeurs publiés + `latest.json` | Au tag | Permanente | GitHub Releases |
| Plan de run, dump des tags, cache (machine utilisateur) | Au fil de l'eau pendant le run | 30 jours si interrompu, purgé si terminé | `appLocalDataDir()`, **aucune sauvegarde** et c'est voulu |

> **Le mot de passe de l'archive ne va pas dans l'archive.** Il s'écrit sur papier, ou se mémorise. C'est le seul maillon qui n'a pas de copie numérique, par construction.

> **Deux emplacements, pas un.** Drive seul tombe avec le compte Google, la clé USB seule tombe avec le tiroir. Le chiffrement AES-256 en amont est ce qui rend le dépôt sur Drive acceptable : sans lui, un compte Google compromis donnerait à quelqu'un la capacité de **signer une fausse mise à jour** que les installations existantes accepteraient et installeraient automatiquement.

> **Rien à sauvegarder côté utilisateur, délibérément** : le cache est jetable par définition ([ADR-013](adrs/013-cache-disque-jetable.md)), le plan de run est un état de session reconstructible en relançant, et le dump des tags d'origine vit avec le plan qu'il sert à annuler.

## Recovery

| Scénario | RTO | RPO | Procédure |
|----------|-----|-----|-----------|
| Poste de développement perdu | ~2 h | 0 | Cloner le dépôt, restaurer l'archive chiffrée, réinstaller les toolchains (pnpm, uv, Rust), reconstituer les secrets GitHub |
| **Clé de signature perdue** | ♾️ **irrécupérable** | — | Aucune procédure de retour. Générer une nouvelle paire, publier un installeur avec la nouvelle `pubkey`, et **le faire installer à la main par chaque utilisateur** : les installations existantes n'accepteront plus jamais aucune mise à jour automatique |
| Clé de signature compromise (fuite, pas perte) | ~1 release | — | Séquence de transition de la § Rotation : version signée avec l'ancienne clé portant la nouvelle `pubkey`, attendre que tout le monde l'ait prise, puis basculer |
| Release cassée en ligne | ~30 min | — | Dépublier, roll-forward `PATCH` (cf. § Rollback) |
| Liste `API_KEYS` perdue | ~1 h | — | Regénérer une clé par utilisateur connu, redéployer l'API, retransmettre. Coût réel : recontacter tout le monde |
| Run interrompu (côté utilisateur) | Immédiat | 0 fichier touché | Reprise depuis le plan de run persisté au fil de l'eau, aucun fichier musical n'ayant été modifié avant confirmation globale |
| Tags écrits par erreur (côté utilisateur) | Quelques minutes | 0 | Rollback par run ou par morceau depuis le dump des tags d'origine, tant que le plan n'a pas été purgé (30 jours) |

> **RTO** = Recovery Time Objective (temps max pour restaurer)
> **RPO** = Recovery Point Objective (perte de données max acceptable)

> ⚠️ **La ligne « clé de signature perdue » est la seule de ce document sans procédure de retour.** C'est ce qui justifie que sa sauvegarde soit vérifiée avant chaque release, et pas seulement le jour de sa génération.

---

# ⚡ Performance

Pas de test de non-régression de performance au MVP : le facteur limitant est la latence de techno-scraper, pas la machine locale, et mesurer ça en CI ne testerait rien du code de ce projet. Les repères ci-dessous sont des **baselines opérationnelles** à établir au premier build (étape 4), dont la première tranche une question ouverte d'architecture.

## Benchmarks

| Repère | Cible | Mesuré |
|--------|-------|--------|
| Démarrage du sidecar, `--onefile` | — | **2282 ms** (médiane, 5 runs) |
| Démarrage du sidecar, `--onedir` | — | **335 ms** (médiane, 5 runs) |
| Taille produite, `--onefile` | — | **16 Mo**, 1 fichier |
| Taille produite, `--onedir` | — | **32 Mo**, 65 fichiers (exe : 6,9 Mo) |
| Détections antivirus, `--onefile` vs `--onedir` | Comparaison sur Defender | à mesurer chez un utilisateur (cf. note ci-dessous) |
| Run de 100 morceaux, cache froid | À établir, borné par le pool de concurrence (3 Beatport, 2 Bandcamp, cf. [ADR-017](adrs/017-taille-pool-concurrence.md)) | à mesurer |
| Run de 100 morceaux, cache chaud | Réseau quasi nul, seul le local compte | à mesurer |
| Phase d'écriture, 100 morceaux | Quelques secondes, pochettes déjà en cache | à mesurer |
| Taille de l'installeur | Baseline pour détecter une inflation ultérieure | à mesurer |

> **Protocole de la mesure de démarrage** (2026-08-27) : prototype embarquant les dépendances réelles du sidecar (mutagen, rapidfuzz, httpx2, keyring, sentry-sdk), lancé par un process parent **via un pipe**, comme le fera Tauri. Le chiffre est le délai entre le lancement et l'arrivée de la première ligne NDJSON, médiane sur 5 exécutions. Un hello-world aurait mesuré zéro : le coût d'extraction de `--onefile` est proportionnel au poids des dépendances embarquées.

> ⚠️ **La mesure est antérieure à l'entrée de `pydantic`** dans les dépendances du sidecar (cf. [VERSIONS.md § Pydantic](VERSIONS.md#3-pydantic)). `pydantic-core` étant une extension native, c'est du poids embarqué en plus : les deux chiffres de démarrage et les deux tailles produites sont à refaire au premier build réel avant de servir de baseline. Le verdict `--onedir` n'est pas en jeu, l'écart entre les deux modes étant d'un ordre de grandeur.

> ⚠️ **Les détections antivirus ne se mesurent pas sur le poste de développement.** Si celui-ci tourne sous un antivirus tiers, c'est cet antivirus qui est testé, pas **Defender**, celui que rencontreront des utilisateurs Windows ordinaires. Un build qui passe en local ne prouve donc rien sur le mode de panne le plus probable du projet. Cette validation appartient à la Checklist Post-MEP, sur une machine tierce.

## Optimisations

- [x] Mode PyInstaller choisi sur mesure, pas sur intuition : `--onedir` (cf. § Benchmarks)
- [ ] Pool de concurrence aligné sur les sémaphores de l'API, tout dépassement se transformant en `504` ([ADR-017](adrs/017-taille-pool-concurrence.md))
- [ ] Timeout client supérieur au `request_timeout` de l'API (~100 s), sinon un `504` structuré passe pour une panne réseau locale
- [ ] Cache vérifié sur un re-run réel : le second passage sur le même dossier doit être quasi instantané côté réseau
- [ ] Éviction LRU vérifiée sous plafond : le dossier de cache ne doit jamais dépasser 500 Mo

---

# 🔗 Ressources

## Documentation Officielle
- [Tauri v2 — Updater](https://v2.tauri.app/plugin/updater/) : génération des clés, `pubkey`, format de `latest.json`
- [Tauri v2 — Sidecar](https://v2.tauri.app/develop/sidecar/) : `externalBin`, suffixe target-triple
- [Tauri v2 — Distribution GitHub](https://v2.tauri.app/distribute/pipelines/github/)
- [tauri-action](https://github.com/tauri-apps/tauri-action) : `tagName`, `releaseDraft`, `uploadUpdaterJson`
- [release-please — customizing](https://github.com/googleapis/release-please/blob/main/docs/customizing.md) : `extra-files`, updaters TOML et JSON génériques
- [GitHub Actions — déclencheurs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow) : un tag créé par `GITHUB_TOKEN` ne déclenche aucun workflow
- [Sentry — Options Python](https://docs.sentry.io/platforms/python/configuration/options/) : `include_local_variables`, `server_name`, `send_default_pii`
- [PyInstaller](https://pyinstaller.org) : modes `--onefile` et `--onedir`
- [Renovate — options de configuration](https://docs.renovatebot.com/configuration-options/) : `packageRules`, `minimumReleaseAge`, automerge
- [pnpm — intégration continue](https://pnpm.io/continuous-integration) : `pnpm/setup`, et pourquoi Corepack n'est plus recommandé

## Ressources Complémentaires
- [ARCHITECTURE.md](ARCHITECTURE.md) : infrastructure, sécurité et observabilité à haut niveau, modes de panne
- [VERSIONS.md](VERSIONS.md) : versions retenues, matrice de compatibilité croisée et conflits connus, dont le mode de panne de Dependabot sur pnpm 11
- ADRs opérationnels : [012 clé API et keyring](adrs/012-securite-cle-api-keyring.md), [013 cache jetable](adrs/013-cache-disque-jetable.md), [014 observabilité et vie privée](adrs/014-observabilite-sentry-et-rgpd.md), [015 cibles de distribution](adrs/015-cibles-distribution-windows.md), [016 multi-clés](adrs/016-multi-cles-techno-scraper.md), [018 versionnement des artefacts](adrs/018-versionnement-plan-de-run.md), [021 visibilité du dépôt](adrs/021-visibilite-du-depot.md)
- [techno-scraper — PRODUCTION.md](https://github.com/thibaud57/techno-scraper/blob/HEAD/docs/PRODUCTION.md) : chaîne release-please et pièges de squash-merge, dont ce projet hérite
- [PythonGUIs — antivirus et PyInstaller](https://www.pythonguis.com/faq/problems-with-antivirus-software-and-pyinstaller/) : pourquoi `--onefile` déclenche les heuristiques
- [The Twelve-Factor App](https://12factor.net/) : référence dont ce projet s'écarte volontairement, faute de serveur et de variables d'environnement au runtime
