# Chaîne de signature de l'updater : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signer les bundles avec une paire de clés Tauri pour que chaque Release publie l'installeur, sa signature et le manifeste `latest.json` que l'updater lira.

**Architecture:** Quatre tâches :
- la paire de clés minisign, générée par l'utilisateur ;
- la configuration de l'updater (`pubkey`, endpoint, `requireSignedVersion`, `createUpdaterArtifacts: true`), le plugin enregistré, sa permission, `just build` en `--no-sign`, trois gardes dans `test_main.py` et le réalignement des docs, de la rule et de la fiche ;
- les secrets GitHub, l'archive chiffrée et le retrait de la clé locale, joués par l'utilisateur ;
- une étape `pwsh` du job `build` qui fait échouer la release sur un `latest.json` absent ou incohérent.

Aucun code TypeScript : la vérification au démarrage relève du sub-project 02.

**Tech Stack:** Tauri v2 (CLI, `tauri-plugin-updater` 2.13.2 déjà déclaré dans `Cargo.toml` et `package.json`), GitHub Actions (`tauri-action` v1.0.0, `gh`, `pwsh`), pytest, just.

**Spec:** `docs/superpowers/specs/distribution-et-mise-a-jour/01-chaine-de-signature-design.md`

## Global Constraints

- **La clé privée ne vit que dans les secrets GitHub et l'archive chiffrée** (PRODUCTION.md, anti-pattern l.256), jamais dans un `.env`, un commit ou un log. Seule exception : la preuve locale unique de la Task 2, clé exportée dans le shell puis retirée à la Task 3.
- **Jamais `tauri signer generate --force`** : une clé écrasée rend non-updatables toutes les installations distribuées.
- **Gestes interactifs** (génération de la paire, `gh secret set` du mot de passe) : c'est l'utilisateur qui les lance (règle CLI-first). L'agent lui donne la commande et attend sa confirmation.
- **Toute commande Tauri exige le binaire du sidecar** dans `src-tauri/binaries/`, `cargo check` compris : `just build-sidecar` d'abord.
- **Commentaires de code sans accents**, le pourquoi seulement (règle des fichiers existants : `lib.rs`, `Justfile`, workflows, `test_main.py`).
- **Tests** : noms en anglais au présent, AAA, aucun test du plugin lui-même (no-lib-test).
- **Gate vert à chaque commit** : `just lint-sidecar && just typecheck-sidecar && just test-sidecar && just lint-tauri && just lint-workflows`. Commits `type(scope): description`, scope `tauri` ou `ci`.
- **Docs gouvernées par un skill** : charger `Skill[rules-doc]` avant `.claude/rules/tauri/config-bundle.md`, `Skill[knowledge-doc]` avant `docs/knowledges/tauri.md`, `Skill[architecture-doc]` avant `docs/ARCHITECTURE.md`, `Skill[production-doc]` avant `docs/PRODUCTION.md`, `Skill[versions-doc]` avant `docs/VERSIONS.md`.
- **Numéros de ligne des docs** : relevés le 2026-10-15. Chercher le texte cité, pas la ligne.

## Review Focus

- **`--no-sign` absent de la CLI installée** : `just build` échouerait sur un flag inconnu (Task 2, Step 1 : `tauri build --help` le liste).
- **Secret GitHub manquant** : le build doit échouer bruyamment au lieu de publier sans manifeste (Task 2, Step 11 : `tauri build` sans clé ni `--no-sign` rend « A public key has been found, but no private key »).
- **Clé publique collée avec un saut de ligne ou des espaces** : `b64decode(validate=True)` la refuse (Task 2, garde `test_the_updater_public_key_is_inlined_not_a_path`).
- **Release sans `latest.json`** : le contrôle échoue en le nommant (Task 4, Step 2, rejoué contre la Release v0.7.0 qui n'en a pas).
- **Contrôle de contenu (version, signature, `url`)** : non exerçable avant la première Release signée. Le sub-project 04 l'observe au premier vrai run.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `src-tauri/tauri.conf.json` | `createUpdaterArtifacts: true`, section `plugins.updater` |
| `src-tauri/src/lib.rs` | Enregistrement du plugin updater |
| `src-tauri/capabilities/default.json` | Permission `updater:default` |
| `Justfile` | `build` en `--no-sign` |
| `sidecar/tests/unit/test_main.py` | Gardes de la `pubkey` et des versions signées |
| `.github/workflows/release-please.yml` | Contrôle des artefacts de l'updater dans le job `build` |
| `docs/ARCHITECTURE.md`, `docs/PRODUCTION.md`, `docs/VERSIONS.md` | Updater décrit comme câblé |
| `.claude/rules/tauri/config-bundle.md`, `docs/knowledges/tauri.md` | Gotcha et exemple de `createUpdaterArtifacts` |

---

### Task 1: Paire de clés de l'updater (geste utilisateur)

**Files:** aucun fichier du dépôt.

**Interfaces:**
- Produces : `~/.tauri/techno-tagger.key` (clé privée chiffrée), `~/.tauri/techno-tagger.key.pub` (clé publique, une ligne base64), le mot de passe connu de l'utilisateur seul.

- [ ] **Step 1: Vérifier qu'aucune clé n'existe déjà**

Run: `ls ~/.tauri/ 2>/dev/null || echo "aucun dossier"`
Expected: `aucun dossier`, ou un dossier sans `techno-tagger.key`. Si la clé existe : s'arrêter et demander à l'utilisateur, ne jamais la régénérer.

- [ ] **Step 2: Demander à l'utilisateur de générer la paire**

Message à l'utilisateur, puis attendre sa confirmation :

```
Lance dans ton terminal (Git Bash, à la racine du dépôt) :
  pnpm exec tauri signer generate -w ~/.tauri/techno-tagger.key
Choisis un mot de passe solide quand il est demandé et note-le hors ligne.
Dis-moi quand c'est fait.
```

- [ ] **Step 3: Vérifier les deux fichiers**

Run: `ls ~/.tauri/ && cat ~/.tauri/techno-tagger.key.pub`
Expected: `techno-tagger.key` et `techno-tagger.key.pub` présents. Le `.pub` tient sur une ligne base64 qui commence par `dW50cnVzdGVkIGNvbW1lbnQ6` (« untrusted comment: » encodé). Ne jamais afficher `techno-tagger.key`.

---

### Task 2: Configuration de l'updater, plugin et build local sans clé

**Files:**
- Modify: `sidecar/tests/unit/test_main.py` (import `base64`, helper `_updater`, trois tests après `test_the_sidecar_process_is_killed_under_its_real_name`)
- Modify: `src-tauri/tauri.conf.json` (`bundle.createUpdaterArtifacts`, section `plugins`)
- Modify: `src-tauri/src/lib.rs:26-27` (TODO remplacé)
- Modify: `src-tauri/capabilities/default.json`
- Modify: `Justfile:66-68` (recette `build`)
- Modify: `docs/ARCHITECTURE.md` (l.136, l.389), `docs/VERSIONS.md` (l.1053), `docs/PRODUCTION.md` (l.146, l.162, l.214)
- Modify: `.claude/rules/tauri/config-bundle.md` (gotcha l.36), `docs/knowledges/tauri.md` (§ Updater et artefacts signés)

**Interfaces:**
- Consumes : `~/.tauri/techno-tagger.key.pub` (Task 1).
- Produces : `plugins.updater` dans `tauri.conf.json`, lu par le plugin à son initialisation et par l'appel `check()` du sub-project 02. Permission `updater:default`, requise par ce même appel.

- [ ] **Step 1: Vérifier `--no-sign` et l'identifiant de permission**

Run: `pnpm exec tauri build --help | grep -- --no-sign && pnpm exec tauri permission ls updater | grep default`
Expected: une ligne `--no-sign` et une ligne `updater:default`. Si l'un manque : s'arrêter et le signaler, la spec repose sur les deux.

- [ ] **Step 2: Écrire les gardes qui échouent**

Dans `sidecar/tests/unit/test_main.py`, ajouter `import base64` en tête du bloc stdlib (avant `import io`), puis après `test_the_sidecar_process_is_killed_under_its_real_name` :

```python
def _updater() -> dict[str, object]:
    updater = _at("src-tauri/tauri.conf.json", "plugins", "updater")
    assert isinstance(updater, dict)
    return updater


def test_the_updater_public_key_is_inlined_not_a_path() -> None:
    """Tauri attend le contenu du `.pub`, pas son chemin : un chemin passe le build
    et `tauri dev`, puis l'updater refuse toute mise a jour chez l'utilisateur.
    `validate=True` refuse aussi un saut de ligne colle avec la cle.
    """
    pubkey = _updater()["pubkey"]
    assert isinstance(pubkey, str)

    decoded = base64.b64decode(pubkey, validate=True)

    assert decoded.startswith(b"untrusted comment: minisign public key")


def test_the_updater_only_accepts_newer_signed_versions() -> None:
    """La reponse de l'endpoint n'est pas signee : sans `requireSignedVersion`, elle
    peut associer un numero gonfle a une ancienne release authentique, et
    `allowDowngrades` retirerait la seule garde contre sa reinstallation. Les deux
    regressions sont muettes.
    """
    updater = _updater()

    assert updater.get("requireSignedVersion") is True
    assert "allowDowngrades" not in updater


def test_the_updater_endpoint_targets_the_latest_release_of_this_repository() -> None:
    """L'URL du depot est recopiee dans l'endpoint : une faute y est muette, la
    verification echouant en silence chez l'utilisateur. `package.repository` de
    Cargo.toml est la source.
    """
    cargo = tomllib.loads((REPO / "src-tauri/Cargo.toml").read_text(encoding="utf-8"))

    endpoints = _updater()["endpoints"]

    assert endpoints == [f"{cargo['package']['repository']}/releases/latest/download/latest.json"]
```

- [ ] **Step 3: Vérifier qu'elles échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_main.py -k updater -x -q`
Expected: FAIL avec `KeyError: 'plugins'`.

- [ ] **Step 4: Configurer l'updater**

Dans `src-tauri/tauri.conf.json`, passer `"createUpdaterArtifacts": false` à `true`, puis ajouter après le bloc `bundle` (virgule après sa `}` fermante) :

```json
  "plugins": {
    "updater": {
      "pubkey": "<coller ici le contenu exact de ~/.tauri/techno-tagger.key.pub, une seule ligne>",
      "endpoints": ["https://github.com/thibaud57/techno-tagger/releases/latest/download/latest.json"],
      "requireSignedVersion": true,
      "windows": { "installMode": "passive" }
    }
  }
```

La `pubkey` se remplit par la sortie de `cat ~/.tauri/techno-tagger.key.pub`, sans retour à la ligne final : c'est une valeur réelle et non un gabarit, la laisser telle quelle ferait échouer la garde du Step 2.

- [ ] **Step 5: Vérifier que les gardes passent**

Run: `cd sidecar && uv run pytest tests/unit/test_main.py -k updater -x -q`
Expected: `3 passed`.

- [ ] **Step 6: Enregistrer le plugin**

Dans `src-tauri/src/lib.rs`, remplacer les deux lignes du TODO (`// TODO: updater a l'etape 9...` et sa suite) par :

```rust
        .plugin(tauri_plugin_updater::Builder::new().build())
```

L'appel reste après `.plugin(tauri_plugin_opener::init())`, `single-instance` restant le premier plugin.

- [ ] **Step 7: Déclarer la permission**

Dans `src-tauri/capabilities/default.json`, ajouter `"updater:default"` après `"opener:allow-default-urls"` et compléter la description :

```json
  "description": "Permissions de la fenetre principale : lancement du sidecar, selection de chemins, preferences, locale, ouverture de dossiers, verification et installation des mises a jour et fermeture de la fenetre apres confirmation.",
```

- [ ] **Step 8: Passer le build local en `--no-sign`**

Dans le `Justfile`, recette `build` :

```just
build: build-sidecar
    # Ordre impose : sans le binaire du sidecar, tauri build echoue sur externalBin.
    # --no-sign : la cle privee de l'updater ne vit que dans les secrets GitHub, la
    # release signe en CI ; sans le flag, le build exigerait la cle ici.
    pnpm exec tauri build --no-sign
```

- [ ] **Step 9: Build local sans clé (scénario 1)**

Run: `unset TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD; just build`
Expected: build vert, ligne `Updater signing is skipped due to --no-sign flag`, `src-tauri/target/release/bundle/nsis/techno-tagger_<version>_x64-setup.exe` présent, sans `.sig`.

- [ ] **Step 10: L'application démarre avec le plugin (scénario 4)**

Run: `just dev` (via le skill `dev-server`), attendre l'ouverture de la fenêtre puis `just stop`.
Expected: fenêtre ouverte, aucune panique `tauri_plugin_updater` dans la sortie, sidecar prêt (onglet Playlist chargé).

- [ ] **Step 11: Build sans clé ni `--no-sign` (scénario 2)**

Run: `unset TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD; pnpm exec tauri build 2>&1 | tail -5`
Expected: échec avec `A public key has been found, but no private key`. C'est le comportement d'un secret absent en CI.

- [ ] **Step 12: Build signé local, preuve unique (scénario 3, geste utilisateur)**

Message à l'utilisateur, puis attendre sa confirmation :

```
Dans ton terminal Git Bash, à la racine du dépôt :
  export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/techno-tagger.key)"
  read -rs TAURI_SIGNING_PRIVATE_KEY_PASSWORD && export TAURI_SIGNING_PRIVATE_KEY_PASSWORD
  pnpm exec tauri build
  unset TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD
Dis-moi quand c'est fini.
```

Puis Run: `ls src-tauri/target/release/bundle/nsis/`
Expected: l'installeur et `techno-tagger_<version>_x64-setup.exe.sig`.

- [ ] **Step 13: Réaligner ARCHITECTURE.md, VERSIONS.md et PRODUCTION.md**

- `docs/ARCHITECTURE.md` l.136, commentaire de `capabilities/default.json` : `# permissions : shell(sidecar), dialog, fs, store, os, opener, updater`
- `docs/ARCHITECTURE.md` l.389, ligne `updater` de la table des plugins :
  ```
  | `updater` | Vérification du manifeste de la Release au démarrage, téléchargement et installation signés (`updater:default`). Clé publique dans `tauri.conf.json`, artefacts signés en CI seule, le build local passant `--no-sign` (cf. [PRODUCTION.md § Code Signing](PRODUCTION.md#code-signing)) |
  ```
- `docs/VERSIONS.md` l.767, puce `updater` 2.11.0 : remplacer « `plugins.updater` gagne `restartAfterInstall`, opt-in. Sans effet tant que l'updater n'est pas branché » par « `downloadAndInstall` gagne l'option `restartAfterInstall`, vraie par défaut : l'installeur relance l'application, sans plugin `process` » (vérifié dans le crate 2.13.2, `updater.rs`, le 2026-10-15)
- `docs/VERSIONS.md` l.1053 : `Les permissions des plugins `shell`, `dialog`, `fs`, `store`, `os`, `opener` et `updater`, avec `shell:allow-spawn` restreinte au sidecar déclaré et un scope `fs` limité aux chemins nécessaires. `single-instance` n'a aucune permission à déclarer.`
- `docs/PRODUCTION.md` l.146 : remplacer `**Endpoint updater, cible de l'étape 9, non câblé** (`createUpdaterArtifacts: false`, plugin non enregistré) :` par `**Endpoint updater** (`plugins.updater.endpoints`) :`, le reste de la phrase inchangé.
- `docs/PRODUCTION.md` l.162, ligne `.sig` du tableau Code Signing :
  ```
  | Bundle de mise à jour (`.sig`) | ✅ Oui, obligatoire | minisign, `TAURI_SIGNING_PRIVATE_KEY` (+ password) injectés au build de la CI. Le build local passe `--no-sign` | Sans signature valide, l'updater **refuse** la mise à jour |
  ```
- `docs/PRODUCTION.md` l.214, ligne Distribution : `signature de l'updater à l'étape 9` devient `signature de l'updater en CI`.

- [ ] **Step 14: Réaligner la rule et la fiche Tauri**

Charger `Skill[rules-doc]`, puis dans `.claude/rules/tauri/config-bundle.md` remplacer le gotcha « `bundle.createUpdaterArtifacts` reste à `false` tant que… » par :

```markdown
- `bundle.createUpdaterArtifacts: true` avec une `pubkey` fait échouer tout `tauri build` sans `TAURI_SIGNING_PRIVATE_KEY` (« A public key has been found, but no private key ») : `just build` passe `--no-sign`, seule la CI signe
```

Charger `Skill[knowledge-doc]`, puis dans `docs/knowledges/tauri.md` § Updater et artefacts signés : l'exemple passe à `"bundle": { "createUpdaterArtifacts": true },` sans commentaire, puis ajouter aux Points Importants :

```markdown
- **Build local en `--no-sign`** (CLI 2.9+) : avec `createUpdaterArtifacts: true` et une `pubkey`, `tauri build` exige la clé privée. `just build` saute la signature de l'updater, la CI signe avec les secrets
```

- [ ] **Step 15: Gate**

Run: `just lint-sidecar && just typecheck-sidecar && just test-sidecar && just lint-tauri`
Expected: tout vert, couverture ≥ 80 %.

- [ ] **Step 16: Commit**

```bash
git add sidecar/tests/unit/test_main.py src-tauri/tauri.conf.json src-tauri/src/lib.rs src-tauri/capabilities/default.json Justfile docs/ARCHITECTURE.md docs/VERSIONS.md docs/PRODUCTION.md .claude/rules/tauri/config-bundle.md docs/knowledges/tauri.md
git commit -m "feat(tauri): updater configure et signe, build local sans cle"
```

---

### Task 3: Secrets GitHub, sauvegarde et retrait de la clé locale (geste utilisateur)

**Files:**
- Modify: `docs/PRODUCTION.md` (case « Paire de clés updater générée » du Bootstrap technique)

**Interfaces:**
- Consumes : `~/.tauri/techno-tagger.key` et son mot de passe (Task 1).
- Produces : secrets `TAURI_SIGNING_PRIVATE_KEY` et `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, déjà lus par le job `build` de `release-please.yml`.

- [ ] **Step 1: Demander à l'utilisateur de créer les secrets**

Message à l'utilisateur, puis attendre sa confirmation :

```
Dans ton terminal Git Bash, à la racine du dépôt :
  gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/techno-tagger.key
  gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
(la seconde commande demande la valeur : colle le mot de passe de la clé)
Dis-moi quand c'est fait.
```

- [ ] **Step 2: Vérifier les secrets**

Run: `gh secret list`
Expected: `TAURI_SIGNING_PRIVATE_KEY` et `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` listés, à côté des quatre existants.

- [ ] **Step 3: Demander l'archive chiffrée**

Message à l'utilisateur, puis attendre sa confirmation :

```
Sauvegarde selon PRODUCTION.md § Backup & Recovery :
- ajoute ~/.tauri/techno-tagger.key, ~/.tauri/techno-tagger.key.pub et le mot de passe de la clé
  (dans un fichier texte) à l'archive 7-Zip chiffrée AES-256 qui tient déjà les autres secrets ;
- déposée sur Google Drive ET sur une clé USB ;
- le mot de passe de l'archive ne va pas dans l'archive (papier ou mémoire) ;
- ouvre l'archive une fois depuis chaque emplacement pour vérifier qu'elle se déchiffre.
Dis-moi quand c'est fait.
```

- [ ] **Step 4: Demander le retrait de la clé locale**

Message à l'utilisateur, puis attendre sa confirmation (geste destructif, jamais joué par l'agent) :

```
Une fois l'archive vérifiée depuis ses deux emplacements, retire la clé du poste :
  rm ~/.tauri/techno-tagger.key ~/.tauri/techno-tagger.key.pub
La clé ne vit plus que dans les secrets GitHub et l'archive (PRODUCTION.md l.256).
```

- [ ] **Step 5: Cocher la case du Bootstrap technique**

Dans `docs/PRODUCTION.md` § Bootstrap technique, passer `- [ ] **Paire de clés updater générée**` à `- [x]`, le texte inchangé suivi de la date du jour, `(2026-MM-JJ)`.

- [ ] **Step 6: Commit**

```bash
git add docs/PRODUCTION.md
git commit -m "docs(tauri): paire de cles updater generee et sauvegardee"
```

---

### Task 4: Contrôle des artefacts de l'updater dans le job de release

**Files:**
- Modify: `.github/workflows/release-please.yml` (env de `tauri-action`, nouvelle étape après lui)
- Modify: `docs/PRODUCTION.md` (checklist Release, ligne « Release GitHub porte bien l'installeur ET `latest.json` », l.121)

**Interfaces:**
- Consumes : `needs.release-please.outputs.tag_name` (`vX.Y.Z`) et `needs.release-please.outputs.version` (`X.Y.Z`), déjà employés par le workflow ; les assets publiés par `tauri-action` (`*-setup.exe`, `*-setup.exe.sig`, `latest.json`).
- Produces : un job `build` rouge sur toute Release dont l'updater ne verrait pas la mise à jour.

- [ ] **Step 1: Écrire le contrôle**

Dans `.github/workflows/release-please.yml`, job `build` :
- remplacer les deux lignes de commentaire `# TODO: paire de cles updater a l'etape 9...` au-dessus de `TAURI_SIGNING_PRIVATE_KEY` par :
  ```yaml
          # Absents, le build echoue (« public key found, but no private key ») au
          # lieu de publier une Release sans latest.json.
  ```
- ajouter après l'étape `tauri-apps/tauri-action` :

```yaml
      # tauri-action reste vert sans artefact d'updater (constate sur la v0.1.0), et
      # Tauri valide tout latest.json avant d'en lire la version : sans ce controle,
      # une Release que l'updater ne verrait pas passerait inapercue.
      - name: Verifier les artefacts de l'updater
        shell: pwsh
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAG: ${{ needs.release-please.outputs.tag_name }}
          VERSION: ${{ needs.release-please.outputs.version }}
        run: |
          $ErrorActionPreference = 'Stop'
          $PSNativeCommandUseErrorActionPreference = $true
          $assets = @(gh release view $env:TAG --json assets --jq '.assets[].name')
          if ($assets -notcontains 'latest.json') { throw "latest.json absent de la Release $env:TAG" }
          if (-not ($assets | Where-Object { $_ -like '*-setup.exe.sig' })) { throw "Signature .sig absente de la Release $env:TAG" }
          gh release download $env:TAG --pattern latest.json --dir $env:RUNNER_TEMP --clobber
          $manifest = Get-Content (Join-Path $env:RUNNER_TEMP 'latest.json') -Raw | ConvertFrom-Json
          if ($manifest.version -ne $env:VERSION) { throw "latest.json annonce $($manifest.version), attendu $env:VERSION" }
          $windows = $manifest.platforms.'windows-x86_64'
          if (-not $windows.signature) { throw "Signature windows-x86_64 vide dans latest.json" }
          $expected = "/releases/download/$([regex]::Escape($env:TAG))/[^/]+-setup\.exe$"
          if ($windows.url -notmatch $expected) { throw "url windows-x86_64 hors du tag $env:TAG : $($windows.url)" }
          Write-Output "latest.json $($manifest.version) et sa signature publies sur $env:TAG"
```

- [ ] **Step 2: Rejouer le contrôle contre la v0.7.0 (Release sans manifeste)**

Copier le bloc `run:` dans le scratchpad sous `verify-updater-assets.ps1`, puis :

Run: `GH_TOKEN="$(gh auth token)" TAG=v0.7.0 VERSION=0.7.0 RUNNER_TEMP="<scratchpad>" pwsh -NoProfile -File "<scratchpad>/verify-updater-assets.ps1"` (`powershell` si `pwsh` est absent)
Expected: échec `latest.json absent de la Release v0.7.0`.

- [ ] **Step 3: Lint des workflows**

Run: `just lint-workflows`
Expected: actionlint vert.

- [ ] **Step 4: Réaligner la checklist Release**

Dans `docs/PRODUCTION.md` § Checklist Release, remplacer la ligne « Release GitHub porte bien **l'installeur ET `latest.json`**… » par :

```markdown
- [ ] Étape **« Verifier les artefacts de l'updater »** du job de build **verte** : elle échoue si `latest.json` ou le `.sig` manquent, si le manifeste annonce une autre version que le tag, ou si son entrée `windows-x86_64` est incomplète. `tauri-action` seul reste vert sans artefact d'updater, `uploadUpdaterJson` fût-il à `true` (constaté sur la v0.1.0, publiée avec le seul installeur)
```

- [ ] **Step 5: Gate**

Run: `just lint-workflows && just test-sidecar`
Expected: vert (`test_main.py` lit `release-please.yml`).

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/release-please.yml docs/PRODUCTION.md
git commit -m "ci: release en echec sans latest.json signe et coherent"
```
