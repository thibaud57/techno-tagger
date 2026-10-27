---
title: "pnpm — Gestionnaire de paquets du frontend"
version: "12.15.0"
description: "Référence technique pour pnpm : store et isolation des dépendances, devEngines, installation et shims sur le poste Windows, lockfile, scripts post-install bloqués et installation en CI."
date: "2026-10-16"
keywords: ["pnpm", "lockfile", "corepack", "packageManager", "hoisting", "ci", "windows", "shim", "self-update"]
scope: ["docs"]
technologies: ["Node.js", "Angular", "Tauri", "GitHub Actions", "Dependabot"]
---

# Description

Gestionnaire de paquets de la zone `src/` (frontend Angular et CLI Tauri). Il tient `package.json` et `pnpm-lock.yaml`.

Les zones `sidecar/` (uv) et `src-tauri/` (cargo) lui échappent : pnpm ne gère que le JavaScript et le TypeScript.

Son intérêt principal ici n'est pas la vitesse mais **l'isolation** : un paquet ne peut pas importer une dépendance qu'il n'a pas déclarée, ce qui évite les dépendances fantômes que le `node_modules` plat de npm rend possibles.

---

# Concepts Clés

## Store global et isolation

### Description

Les paquets vivent une fois dans un store adressé par contenu. `node_modules` n'est qu'un ensemble de liens : les dépendances directes à la racine, les transitives isolées sous `node_modules/.pnpm/`.

### Exemple

```yaml
# pnpm-workspace.yaml
public-hoist-pattern:
  - '*@tauri-apps/cli*'   # cible ce seul paquet plutôt que shamefully-hoist
```

### Points Importants

- **Un paquet ne peut pas `import` ce qu'il n'a pas déclaré** : c'est le comportement par défaut, et c'est ce qui distingue pnpm
- `nodeLinker` vaut `isolated` par défaut ; `hoisted` recrée un arbre plat façon npm et **perd cette protection**
- `hoist=true` par défaut hoiste dans `node_modules/.pnpm/node_modules`, zone interne qui ne casse pas l'isolation de la racine
- **`shamefully-hoist` réintroduit le problème** : si un outil l'exige, préférer un `public-hoist-pattern` ciblé sur ce seul paquet

---

## `devEngines.packageManager`

### Description

`devEngines.packageManager` de `package.json` fixe la version de pnpm pour tout le monde : avec `onFail: "download"`, un pnpm d'une autre version télécharge la bonne et la relance. C'est la seule déclaration de la version ; `pnpm/setup` la lit en CI sans input `version`. Le champ legacy `packageManager` (Corepack) n'est pas utilisé.

### Exemple

```json
{
  "devEngines": {
    "packageManager": { "name": "pnpm", "version": "12.11.2", "onFail": "download" }
  }
}
```

```yaml
# .github/actions/setup-pnpm/action.yml : la version de pnpm vient de package.json
- uses: pnpm/setup@<sha> # v3.x
  with:
    runtime: node@24
```

### Points Importants

- La version résolue s'écrit dans `pnpm-lock.yaml`, dans un premier document YAML (`packageManagerDependencies`) : le lockfile en compte deux, le graphe de dépendances GitHub ne lit que le premier (cf. VERSIONS.md § Dependabot)
- Corepack est distribué avec Node de la 14.19 jusqu'à la 25 exclue : le projet ne s'en sert pas, la bascule vers Node 26 ne coûte rien de ce côté
- `pnpm self-update <version>` dans le projet ne met à jour que ce champ et le premier document du lockfile ; hors projet, il met à jour l'installation globale
- La version épinglée tourne dans le projet, la globale partout ailleurs

---

## Installation sur le poste Windows

### Description

Sur le poste, pnpm vit dans `PNPM_HOME` (`%LOCALAPPDATA%\pnpm`) : le binaire natif sous `global/v11/<hash>/`, et dans `bin/` deux shims par commande, un script `sh` pour Git Bash et un `.cmd` pour `cmd.exe` et PowerShell. Tauri lance `beforeDevCommand` et `beforeBuildCommand` par `cmd.exe` : `just dev` et `just build` dépendent du `pnpm.cmd`.

### Exemple

```bash
# Ce que cmd.exe résout, puis ce que Git Bash résout
cmd //c "where pnpm"
which -a pnpm

# Réparer ou mettre à jour l'installation globale : depuis Git Bash, hors de tout projet épinglé
cd ~ && pnpm self-update
cmd //c "pnpm --version"
```

### Points Importants

- **Un `where pnpm` sans `.cmd` signale un shim manquant** : `cmd.exe` n'exécute pas le script `sh`, d'où `'pnpm' n'est pas reconnu` sous `just dev` alors que Git Bash marche. Relevé le 2026-10-15, cause non établie
- **`pnpm self-update` hors du projet réinstalle la version globale et réécrit les shims** (shim régénéré ainsi le 2026-10-16)
- **Le lancer depuis Git Bash** : sous `cmd.exe`, il réécrit le `pnpm.cmd` qu'il exécute ([pnpm#16573](https://github.com/pnpm/pnpm/issues/16573))
- Les shims de `pnpm shim add` sont des `.exe` depuis 12.3, ceux de pnpm restent `sh` + `.cmd` (relevé sur 12.15.0)
- Installation neuve : `npx get-pnpm`, recommandé par la doc sous Windows (`install.ps1` est parfois bloqué par Defender)
- `pnpm setup` sert à la première installation (crée `PNPM_HOME`, l'ajoute au `PATH`), pas à la réparation

---

## Lockfile

### Description

`pnpm-lock.yaml` fige la résolution. Il se commite et se relit comme du code.

### Exemple

```bash
# résoudre un conflit git sur pnpm-lock.yaml
git checkout --ours pnpm-lock.yaml   # peu importe le côté choisi ici
pnpm install                          # régénère le lock depuis package.json résolu
git add pnpm-lock.yaml
```

### Points Importants

- **Un conflit git sur le lockfile ne se résout pas à la main** : relancer `pnpm install` et relire le diff avant de committer
- Le format du lockfile est indifférent à Dependabot, qui délègue sa régénération à la CLI pnpm elle-même
- Ne jamais mélanger `npm install` et `pnpm install` sur le même dépôt : deux lockfiles cohabiteraient sans se voir

---

## Scripts post-install bloqués par défaut

### Description

Depuis la v10, les scripts de cycle de vie des dépendances **ne s'exécutent plus à l'installation**. C'est une mitigation de compromission de chaîne d'approvisionnement, héritée en v11.

### Exemple

```bash
pnpm ignored-builds     # liste les paquets dont les scripts sont bloqués
pnpm approve-builds     # prompt interactif, écrit allowBuilds
```

### Points Importants

- **Un paquet qui compile un binaire natif au post-install ne fonctionnera pas** tant qu'il n'est pas approuvé : le symptôme est un module manquant à l'exécution, pas une erreur d'installation
- L'approbation est écrite dans `pnpm-workspace.yaml` sous `allowBuilds` et **doit être commitée**, sinon la CI ne l'a pas
- `pnpm ignored-builds` est le premier réflexe quand une dépendance native ne se comporte pas comme attendu
- N'approuver qu'après avoir regardé ce que le script fait

---

## Installation en CI

### Description

Une seule action installe pnpm et Node, appelée par l'action composite locale qui porte leurs deux versions.

### Exemple

```yaml
- uses: actions/checkout@<sha>
- uses: ./.github/actions/setup-pnpm   # pnpm lu dans package.json, Node 24 écrit une seule fois

- run: pnpm install --frozen-lockfile
- run: pnpm run build
```

### Points Importants

- **`pnpm/setup` installe pnpm ET le runtime en une étape** : il remplace la paire `actions/setup-node` + `pnpm/action-setup`
- **L'action exige pnpm 11 ou plus** depuis sa v2 et rejette explicitement les versions antérieures. La v3 détecte en plus un `.node-version`, un `.nvmrc` ou un `.tool-versions`, que l'input `runtime` explicite écrase
- **pnpm 12 est un binaire natif** (réécriture Rust, `latest` depuis début septembre 2026) : l'action le télécharge sans passer par npm, et Node n'est plus requis pour faire tourner pnpm lui-même
- Elle vérifie l'intégrité du binaire téléchargé en comparant la version obtenue à celle demandée
- **`--frozen-lockfile` explicite en CI** : pnpm l'active automatiquement quand il détecte un environnement CI, mais l'écrire rend l'échec clair et le comportement portable
- La 2.0.1 corrige la normalisation des chemins du store sous Windows, ce qui la rend souhaitable sur le runner du projet

---

# Commandes Clés

## Dépendances

### Description

Ajout, retrait, installation. Toute modification passe par la CLI.

### Syntaxe

```bash
pnpm install                        # local
pnpm install --frozen-lockfile      # CI
pnpm add @tauri-apps/api
pnpm add -D vitest                  # devDependency
pnpm add -E primeng                 # version exacte, sans plage semver
pnpm remove <paquet>
pnpm update --latest                # franchit les majeures, à réserver au manuel
```

### Points Importants

- **`--frozen-lockfile` échoue si le lock diverge du manifeste** : c'est exactement le comportement voulu en CI
- `-E` fige la version exacte : utile pour les paquets dont un patch a déjà cassé le build
- `pnpm install --lockfile-only` met à jour le lock sans toucher `node_modules`

## Exécution

### Description

Lancer un binaire de dépendance ou un outil ponctuel.

### Syntaxe

```bash
pnpm exec ng build              # binaire des dépendances installées
pnpm dlx <paquet>               # outil ponctuel, sans l'installer
pnpm run <script>
pnpm tauri dev                  # raccourci vers le binaire @tauri-apps/cli
```

### Points Importants

- **`exec` et `dlx` ne font pas la même chose** : `exec` lance ce qui est installé, `dlx` récupère depuis le registre à la volée
- **Les options se placent avant `exec`** : `pnpm -r exec jest` et non `pnpm exec jest -r`, sinon le flag part à la commande
- `pnpm dlx` respecte les politiques de sécurité du projet depuis la v11

## Installation et mise à jour de pnpm

### Description

Mettre pnpm à jour sur le poste, monter l'épinglage du projet, diagnostiquer les shims.

### Syntaxe

```bash
pnpm self-update              # hors projet : installation globale et shims de PNPM_HOME/bin
pnpm self-update <version>    # dans le projet : devEngines.packageManager et lockfile seulement
pnpm bin -g                   # dossier des shims globaux
pnpm with current install     # une commande avec le pnpm global, en ignorant l'épinglage
```

### Points Importants

- **Deux gestes distincts selon le dossier courant** : la même commande met à jour la machine hors projet, l'épinglage dans le projet
- Une version plus jeune que `minimumReleaseAge` demande confirmation en interactif et échoue en non-interactif
- Après toute mise à jour sur le poste, `cmd //c "pnpm --version"` vérifie le chemin qu'emprunte Tauri

---

# Bonnes Pratiques

## ✅ Recommandations

- **Épingler la version par `devEngines.packageManager`** (`onFail: download`), sans `packageManager` ni Corepack, et laisser `pnpm/setup` la lire (pas d'input `version`)
- **Utiliser `pnpm install --frozen-lockfile` en CI**, explicitement
- **Committer `pnpm-lock.yaml` et `allowBuilds`** dans le même commit que le changement de dépendance
- **Résoudre un conflit de lockfile par un `pnpm install`**, jamais à la main
- **Vérifier `pnpm ignored-builds`** quand une dépendance native se comporte mal
- **Cibler `public-hoist-pattern` sur le paquet qui l'exige** plutôt que d'activer `shamefully-hoist`
- **Réserver `overrides` (dans `pnpm-workspace.yaml`) aux correctifs de sécurité d'une transitive que son parent épingle en exact**, avec en commentaire le pourquoi et la condition de retrait : le projet force ainsi vite 8.3.5 au 2026-10-27, `@angular/build` épinglant une 8.3.0 touchée par des advisories corrigés en 8.3.3
- **Mettre pnpm à jour sur le poste par `pnpm self-update` hors du projet, depuis Git Bash**, puis vérifier `cmd //c "pnpm --version"`

## ❌ Anti-Patterns

- **`shamefully-hoist=true`** : annule l'isolation, donc l'intérêt principal de pnpm
- **Mélanger `npm install` et `pnpm install`** sur le même dépôt
- **Éditer `pnpm-lock.yaml` à la main**, y compris pour résoudre un conflit
- **Approuver tous les builds sans regarder** ce que les scripts font
- **Utiliser `actions/setup-node` en plus de `pnpm/setup`** : la seconde installe déjà le runtime
- **Placer les options après `exec`** : elles partent à la commande exécutée, sans erreur visible
- **Écrire un `pnpm.cmd` à la main, ou ajouter un dossier de shims au `PATH`**, pour contourner un shim manquant : `pnpm self-update` hors projet le régénère
- **Lancer `pnpm self-update` depuis `cmd.exe`** : il réécrit le shim qui l'exécute

---

# 🔗 Ressources

## Documentation Officielle

- [pnpm : installation](https://pnpm.io/installation)
- [pnpm install](https://pnpm.io/cli/install) · [pnpm add](https://pnpm.io/cli/add) · [pnpm exec](https://pnpm.io/cli/exec) · [pnpm dlx](https://pnpm.io/cli/dlx)
- [Réglages node-modules et hoisting](https://pnpm.io/settings/node-modules)
- [pnpm approve-builds](https://pnpm.io/cli/approve-builds)
- [pnpm self-update](https://pnpm.io/cli/self-update) · [pnpm setup](https://pnpm.io/cli/setup) · [pnpm with](https://pnpm.io/cli/with) · [pnpm shim](https://pnpm.io/cli/shim)
- [Package managers épinglés](https://pnpm.io/package-managers) · [Paquets globaux](https://pnpm.io/global-packages)
- [pnpm/setup](https://github.com/pnpm/setup)

## Ressources Complémentaires

- [Corepack](https://github.com/nodejs/corepack#readme)
- [VERSIONS.md](../VERSIONS.md) : versions épinglées du projet
