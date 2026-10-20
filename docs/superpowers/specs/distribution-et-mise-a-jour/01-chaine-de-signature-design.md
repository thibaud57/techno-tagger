---
feature: "Feature 8 : Distribution et mise à jour"
subproject: "chaine-de-signature"
goal: "Signer les bundles avec une paire de clés Tauri pour que chaque Release publie l'installeur, sa signature et le manifeste latest.json que l'updater lira"
status: "implemented"
complexity: "M"
tdd_scope: "partial"
depends_on: []
date: "2026-10-15"
---

# Chaîne de signature de l'updater

## Scope

Couvre la paire de clés minisign (générée par l'utilisateur, versée aux secrets GitHub, sauvegardée dans un gestionnaire de mots de passe), la configuration `plugins.updater` et `createUpdaterArtifacts` de `tauri.conf.json`, l'enregistrement du plugin et sa permission, le build local sans clé par `--no-sign`, un contrôle du job `build` qui fait échouer la release si `latest.json` ou la signature manquent ou sont incohérents, trois gardes de cohérence dans `test_main.py` et le réalignement des docs, rule et fiche qui décrivaient l'updater comme non câblé. Exclut tout code TypeScript (vérification, modale et rangée des Réglages : sub-projects 02 et 03) et la recette sur de vraies Releases (sub-project 04).

### État livré

À la fin de ce sub-project, on peut : lancer `just build` sans aucune clé et obtenir l'installeur, produire une fois en local, clé exportée dans le shell, l'installeur accompagné de son `.sig`, démarrer l'application avec le plugin updater enregistré et voir passer les gardes de `test_main.py` et `just lint-workflows`.

## Dependencies

Aucune : ce sub-project est autoporté.

## Files touched

- **À modifier** : `src-tauri/tauri.conf.json` (`bundle.createUpdaterArtifacts: true`, section `plugins.updater`)
- **À modifier** : `src-tauri/src/lib.rs` (enregistrement du plugin à la place du TODO)
- **À modifier** : `src-tauri/capabilities/default.json` (permission updater, description)
- **À modifier** : `Justfile` (recette `build` en `--no-sign`)
- **À modifier** : `.github/workflows/release-please.yml` (commentaire du TODO remplacé, étape de contrôle des artefacts après `tauri-action`)
- **À modifier** : `sidecar/tests/unit/test_main.py` (trois gardes de configuration de l'updater)
- **À modifier** : `docs/ARCHITECTURE.md` (arborescence l.136, table des plugins l.389)
- **À modifier** : `docs/PRODUCTION.md` (checklist Release l.121, endpoint l.146, Code Signing l.162, environnements l.214, case « Paire de clés updater générée » du Bootstrap technique)
- **À modifier** : `docs/VERSIONS.md` (paragraphe des capabilities l.1053)
- **À modifier** : `.claude/rules/tauri/config-bundle.md` (gotcha `createUpdaterArtifacts` remplacé, via le skill `rules-doc`)
- **À modifier** : `docs/knowledges/tauri.md` (§ Updater et artefacts signés, via le skill `knowledge-doc`)

## Architecture approach

- **Rituel des clés, joué par l'utilisateur** (CLI interactive, mot de passe demandé) dans cet ordre :
  1. `pnpm exec tauri signer generate -w ~/.tauri/techno-tagger.key`, jamais avec `--force` (`.claude/rules/tauri/config-bundle.md`)
  2. preuve locale unique d'un build signé (scénario 3)
  3. `gh secret set TAURI_SIGNING_PRIVATE_KEY` depuis le fichier de clé, puis `gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD` en saisie interactive
  4. sauvegarde dans le gestionnaire de mots de passe selon PRODUCTION.md § Backup & Recovery
  5. retrait du fichier de clé local, la clé ne vivant ensuite que dans ses deux emplacements prévus (PRODUCTION.md, anti-pattern l.256)
- **Configuration de l'updater** dans `tauri.conf.json` :
  - `pubkey` en contenu littéral du `.pub`
  - `endpoints` réduit à l'URL de PRODUCTION.md § Canaux (`/releases/latest/download/latest.json`)
  - `requireSignedVersion: true`
  - `windows.installMode: "passive"` explicite
  - aucun `allowDowngrades`
  - `.claude/rules/tauri/config-bundle.md`, ADR-001, ADR-021
- **Activation des artefacts dans la config, build local en `--no-sign`** (cf. Décision : activation des artefacts de l'updater). La recette `build` du `Justfile` passe `--no-sign`, qui saute la signature de l'updater. `tauri-action` construit sans ce flag et signe avec les secrets. Le flag existe depuis la CLI 2.9, ce que le plan vérifie par `tauri build --help`.
- **Enregistrement du plugin** par `tauri_plugin_updater::Builder::new().build()`, après `opener`, `single-instance` restant premier (`.claude/rules/tauri/capabilities.md`). La `pubkey` est posée dans le même changement, le plugin la lisant à son initialisation.
- **Permission** : `updater:default`, identifiant vérifié par `tauri permission ls` avant écriture (`.claude/rules/tauri/capabilities.md`).
- **Contrôle des artefacts dans le job `build`** : une étape `pwsh` après `tauri-action`.
  - Elle télécharge `latest.json` de la Release du tag par `gh release download` et lit la liste des assets.
  - Elle fait échouer le job si l'une des conditions tombe :
    - le manifeste est présent ;
    - sa `version` égale la version de release-please ;
    - `platforms.windows-x86_64.signature` est non vide ;
    - `platforms.windows-x86_64.url` pointe vers l'installeur de ce tag ;
    - un `.sig` est attaché.
  - Tag et version passent par `env`, jamais interpolés dans le script (`.claude/rules/github-actions/expressions-contexts.md`).
  - Le job garde `contents: write`, sans permission de plus (`.claude/rules/github-actions/security-permissions.md`).
  - Cf. Décision : contrôle des artefacts publiés.
- **Gardes de configuration** dans `test_main.py`, à côté des gardes d'identité existantes, par le helper `_at` (`.claude/rules/pytest/tests.md`) : elles ne gardent que ce dont la régression est muette (cf. Tests à écrire).
- Rules applicables : `.claude/rules/tauri/config-bundle.md`, `.claude/rules/tauri/capabilities.md`, `.claude/rules/github-actions/workflows.md`, `.claude/rules/github-actions/expressions-contexts.md`, `.claude/rules/github-actions/secrets-variables.md`, `.claude/rules/github-actions/security-permissions.md`, `.claude/rules/release-please/config.md`, `.claude/rules/pytest/tests.md`, `.claude/rules/python/type-hints.md`. ADRs : ADR-001, ADR-015, ADR-021.

## Acceptance criteria

### Scénario 1 : build local sans clé
**GIVEN** aucune variable `TAURI_SIGNING_PRIVATE_KEY` dans l'environnement
**WHEN** l'utilisateur lance `just build`
**THEN** l'installeur NSIS est produit sans erreur
**AND** le build signale seulement que la signature de l'updater est sautée

### Scénario 2 : build sans `--no-sign` et sans clé
**GIVEN** `createUpdaterArtifacts: true` et une `pubkey` dans `tauri.conf.json`, aucune clé privée dans l'environnement
**WHEN** un `tauri build` est lancé sans `--no-sign` (cas d'un secret GitHub absent)
**THEN** le build échoue avec « A public key has been found, but no private key »
**AND** le job `build` est rouge, aucun installeur n'est attaché sans son manifeste

### Scénario 3 : build signé local, preuve unique
**GIVEN** la paire générée, clé et mot de passe exportés dans le shell (jamais par un `.env`)
**WHEN** l'utilisateur lance `pnpm exec tauri build`
**THEN** `bundle/nsis/` contient l'installeur et son `.sig`

### Scénario 4 : application avec le plugin
**GIVEN** le plugin enregistré et la `pubkey` posée
**WHEN** l'application démarre par `just dev`
**THEN** elle s'ouvre sans panique à l'initialisation du plugin et le sidecar répond

### Scénario 5 : Release incomplète
**GIVEN** une release dont `latest.json` manque, annonce une autre version que le tag, porte une signature vide ou une `url` hors du tag, ou dont le `.sig` manque
**WHEN** le job `build` atteint l'étape de contrôle
**THEN** le job échoue en nommant la condition tombée

### Scénario 6 : configuration affaiblie
**GIVEN** une `pubkey` remplacée par un chemin, ou `requireSignedVersion` retiré, ou `allowDowngrades` ajouté, ou un endpoint qui ne vise pas le dépôt déclaré dans `Cargo.toml`
**WHEN** les tests du sidecar tournent
**THEN** la garde correspondante échoue

## Tests à écrire

### Unit
- `sidecar/tests/unit/test_main.py` :
  - la `pubkey` de `plugins.updater` est une clé minisign en clair : décodée en base64, elle commence par l'en-tête d'une clé publique minisign, ce qu'un chemin ne fait pas
  - `plugins.updater` exige une version signée (`requireSignedVersion` vrai) et ne déclare pas `allowDowngrades`
  - l'endpoint vise `/releases/latest/download/latest.json` du dépôt déclaré par `package.repository` de `Cargo.toml`, seule source de son adresse : une faute y est muette, la vérification échouant en silence

## Edge cases

- **Release publiée puis contrôle rouge** : la Release est publiée d'emblée (PRODUCTION.md § Canaux) et reste visible sans manifeste valide. Le job rouge déclenche la procédure de PRODUCTION.md § Rollback, qui commence par la dépublier.
- **Installations ≤ 0.7.0** : elles n'ont pas le plugin et ne verront jamais la mise à jour. La première version qui l'embarque s'installe à la main (sub-project 04).
- **`requireSignedVersion` et anciennes signatures** : il rejette toute signature antérieure au CLI 2.12. Aucune release n'a jamais publié d'artefact d'updater, donc aucune n'est concernée.
- **Secret présent mais clé désynchronisée de la `pubkey`** : rien ne le détecte au build, l'updater refuse la mise à jour chez l'utilisateur. Le smoke test N vers N+1 du sub-project 04 l'exerce, sur un installeur N issu de la CI.

## Architectural decisions

### Décision : activation des artefacts de l'updater

**Options envisagées :**
- **A. `createUpdaterArtifacts: true` dans `tauri.conf.json`, sans autre réglage** : un seul fichier, mais tout `tauri build` local exige la clé privée, qui sort alors de ses deux emplacements prévus.
- **B. `false` dans la config, `true` par un `tauri.release.conf.json` passé à `tauri-action` par `--config`** : build local intact, mais un fichier de plus et un test pour garder son passage dans le workflow.
- **C. `true` dans la config, `--no-sign` dans la recette `just build`** : la config dit ce qu'est une release, à un seul endroit, comme dans la doc Tauri. Le build local reste sans clé.

**Choix : C**

**Rationale :**
- `--no-sign` existe pour ce cas depuis la CLI 2.9 : un build local sans certificat ni clé. Le code de la CLI le confirme, `sign_updaters` retourne avant de lire les clés.
- Un secret absent en CI fait échouer le build au lieu de publier une Release sans `latest.json`. Un `--no-sign` oublié en local échoue aussi bruyamment : aucune divergence muette, donc aucun test à écrire.
- La clé privée ne quitte jamais les secrets GitHub et le gestionnaire de mots de passe, hors la preuve locale unique du rituel.

### Décision : contrôle des artefacts publiés

**Options envisagées :**
- **A. Présence seule** : `latest.json` et `.sig` attachés à la Release.
- **B. Présence et contenu** : en plus, version du manifeste égale au tag, signature non vide, `url` vers l'installeur du tag.

**Choix : B**

**Rationale :**
- `tauri-action` reste vert sans artefact d'updater (constaté sur la v0.1.0, PRODUCTION.md § Checklist Release) : le contrôle ne peut se déléguer à l'action.
- Tauri valide tout le manifeste avant de lire la version : une entrée mal formée l'invalide pour tous les clients, sans erreur visible.
- B automatise le contrôle manuel que PRODUCTION.md liste en post-release (`version`, `platforms.windows-x86_64.url` et `.signature` renseignés), pour le coût d'une étape `pwsh` sans outil à installer.
