---
paths:
  - "package.json"
  - "pnpm-workspace.yaml"
  - "pnpm-lock.yaml"
  - ".npmrc"
---

# pnpm — Workspace & dépendances

## À faire
- Créer un `pnpm-workspace.yaml` même sans monorepo : il accueille `allowBuilds` et les réglages que le `.npmrc` n'accepte plus depuis pnpm 11
- Déclarer la version de pnpm en input `version` de `pnpm/setup` dans le workflow, et **ni** `packageManager` **ni** `devEngines.packageManager` dans `package.json`
- Passer par la CLI pour toute modification de dépendance (`pnpm add`, `pnpm add -D`, `pnpm remove`), et `-E` pour figer une version exacte
- Committer `pnpm-lock.yaml` et `allowBuilds` dans le même commit que le changement de dépendance
- Résoudre un conflit de lockfile en relançant `pnpm install` puis en relisant le diff
- Écrire `--frozen-lockfile` explicitement en CI : pnpm l'active seul en environnement CI, mais l'écrire rend l'échec clair et le comportement portable
- Vérifier `pnpm ignored-builds` quand une dépendance native se comporte mal, et n'approuver un build qu'après avoir regardé ce que son script fait
- Cibler `public-hoist-pattern` sur le seul paquet qui l'exige quand un outil réclame du hoisting
- Placer les options **avant** `exec` : `pnpm -r exec jest`, sinon le flag part à la commande exécutée sans erreur visible

## À éviter
- `shamefully-hoist=true` ou `nodeLinker: hoisted` : ils annulent l'isolation, donc l'intérêt principal de pnpm
- Mélanger `npm install` et `pnpm install` sur le même dépôt : deux lockfiles cohabiteraient sans se voir
- Éditer `pnpm-lock.yaml` à la main, y compris pour résoudre un conflit
- `actions/setup-node` en plus de `pnpm/setup` : la seconde installe déjà le runtime
- Passer par Corepack, y compris là où il existe encore : il installe un shim JavaScript à la place de pnpm, donc chaque appel démarre Node avant pnpm

## Gotchas
- `packageManager` et `devEngines.packageManager` sont les deux seuls déclencheurs du lockfile multi-document sur ce projet, format qui casse le graphe de dépendances GitHub et donc les alertes de sécurité que Renovate consomme. C'est l'inverse de ce que recommande la doc pnpm, et c'est assumé (cf. [VERSIONS.md § Conflits Potentiels](../../../docs/VERSIONS.md#conflits-potentiels))
- Corepack est retiré des binaires officiels Node depuis la 25.x et absent de la 26.0.0
- Depuis la v10, les scripts de cycle de vie des dépendances ne s'exécutent plus à l'installation : le symptôme d'un paquet non approuvé est un module manquant **à l'exécution**, pas une erreur d'installation
- `pnpm/setup` v2 exige pnpm 11 ou plus et rejette explicitement les versions antérieures ; la 2.0.1 corrige la normalisation des chemins du store sous Windows, et le tag flottant `@v2` peut rester en deçà (cf. [github-actions/security-permissions.md](../github-actions/security-permissions.md))
- `exec` lance ce qui est installé, `dlx` récupère depuis le registre à la volée : ce ne sont pas des synonymes
- `hoist=true` par défaut hoiste dans `node_modules/.pnpm/node_modules`, zone interne qui ne casse pas l'isolation de la racine
