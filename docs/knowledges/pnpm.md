---
title: "pnpm — Gestionnaire de paquets du frontend"
version: "11.24.0"
description: "Référence technique pour pnpm : store et isolation des dépendances, packageManager et Corepack, lockfile, scripts post-install bloqués et installation en CI."
date: "2026-08-29"
keywords: ["pnpm", "lockfile", "corepack", "packageManager", "hoisting", "ci"]
scope: ["docs"]
technologies: ["Node.js", "Angular", "Tauri", "GitHub Actions", "Renovate"]
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

### Points Importants

- **Un paquet ne peut pas `import` ce qu'il n'a pas déclaré** : c'est le comportement par défaut, et c'est ce qui distingue pnpm
- `nodeLinker` vaut `isolated` par défaut ; `hoisted` recrée un arbre plat façon npm et **perd cette protection**
- `hoist=true` par défaut hoiste dans `node_modules/.pnpm/node_modules`, zone interne qui ne casse pas l'isolation de la racine
- **`shamefully-hoist` réintroduit le problème** : si un outil l'exige, préférer un `public-hoist-pattern` ciblé sur ce seul paquet

---

## `packageManager` et Corepack

### Description

Le champ `packageManager` fixe la version exacte pour tout le monde, mais **ce projet ne le déclare pas** : avec `devEngines.packageManager`, c'est l'un des deux déclencheurs du lockfile multi-document, qui casse le graphe de dépendances GitHub. La version passe par l'input `version` de `pnpm/setup`.

### Exemple

```yaml
- uses: pnpm/setup@v2.1.0
  with:
    version: 11.24.0
    runtime: node@24
```

### Points Importants

- **Corepack lit ce champ**, télécharge la version correspondante et exécute le bon binaire : plus d'écart entre deux machines
- Corepack est distribué avec Node de la 14.19 jusqu'à la 25 exclue : présent sur le Node 24 du projet, **à réévaluer avant une montée au-delà**
- Ajouter le hash d'intégrité au champ renforce la validation
- `pnpm self-update <version>` dans un projet épinglé ne met à jour que ce champ, le binaire se téléchargeant ensuite tout seul

---

## Lockfile

### Description

`pnpm-lock.yaml` fige la résolution. Il se commite et se relit comme du code.

### Points Importants

- **Un conflit git sur le lockfile ne se résout pas à la main** : relancer `pnpm install` et relire le diff avant de committer
- Le format du lockfile est indifférent à Renovate, qui délègue sa régénération à la CLI pnpm elle-même (cf. [renovate.md](renovate.md))
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

Une seule action installe pnpm et Node, la version étant passée en input.

### Exemple

```yaml
- uses: pnpm/setup@v2.1.0
  with:
    runtime: node@24

- run: pnpm install --frozen-lockfile
- run: pnpm run build
```

### Points Importants

- **`pnpm/setup` installe pnpm ET le runtime en une étape** : il remplace la paire `actions/setup-node` + `pnpm/action-setup`
- **L'action v2 exige pnpm 11 ou plus** et rejette explicitement les versions antérieures
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

---

# Bonnes Pratiques

## ✅ Recommandations

- **Épingler la version en input `version` de `pnpm/setup`**, sans `packageManager` ni Corepack
- **Utiliser `pnpm install --frozen-lockfile` en CI**, explicitement
- **Committer `pnpm-lock.yaml` et `allowBuilds`** dans le même commit que le changement de dépendance
- **Résoudre un conflit de lockfile par un `pnpm install`**, jamais à la main
- **Vérifier `pnpm ignored-builds`** quand une dépendance native se comporte mal
- **Cibler `public-hoist-pattern` sur le paquet qui l'exige** plutôt que d'activer `shamefully-hoist`

## ❌ Anti-Patterns

- **`shamefully-hoist=true`** : annule l'isolation, donc l'intérêt principal de pnpm
- **Mélanger `npm install` et `pnpm install`** sur le même dépôt
- **Éditer `pnpm-lock.yaml` à la main**, y compris pour résoudre un conflit
- **Approuver tous les builds sans regarder** ce que les scripts font
- **Utiliser `actions/setup-node` en plus de `pnpm/setup`** : la seconde installe déjà le runtime
- **Placer les options après `exec`** : elles partent à la commande exécutée, sans erreur visible

---

# 🔗 Ressources

## Documentation Officielle

- [pnpm — installation](https://pnpm.io/installation)
- [pnpm install](https://pnpm.io/cli/install) · [pnpm add](https://pnpm.io/cli/add) · [pnpm exec](https://pnpm.io/cli/exec) · [pnpm dlx](https://pnpm.io/cli/dlx)
- [Réglages node-modules et hoisting](https://pnpm.io/settings/node-modules)
- [pnpm approve-builds](https://pnpm.io/cli/approve-builds)
- [pnpm/setup](https://github.com/pnpm/setup)

## Ressources Complémentaires

- [Corepack](https://github.com/nodejs/corepack#readme)
- [renovate.md](renovate.md) — mise à jour du lockfile
- [VERSIONS.md](../VERSIONS.md) — versions épinglées du projet
