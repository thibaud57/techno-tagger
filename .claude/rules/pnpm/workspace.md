---
paths:
  - "package.json"
  - "pnpm-workspace.yaml"
  - "pnpm-lock.yaml"
  - ".github/actions/setup-pnpm/action.yml"
---

# pnpm — Workspace & dépendances

## À faire
- Créer un `pnpm-workspace.yaml` même sans monorepo : il accueille `allowBuilds` et les réglages que le `.npmrc` n'accepte plus depuis pnpm 11
- Déclarer la version de pnpm, et celle de Node, en inputs de `pnpm/setup` dans la seule action composite `.github/actions/setup-pnpm`, et **ni** `packageManager` **ni** `devEngines.packageManager` dans `package.json`
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
- Les scripts tournent sous `bash` (`scriptShell`) : utiliser `$npm_package_name` et `$npm_package_version` plutôt qu'une valeur recopiée
- `packageManager` et `devEngines.packageManager` déclenchent le lockfile multi-document, qui casse le graphe de dépendances GitHub et les alertes Dependabot : à l'inverse de la doc pnpm, ils restent absents
- Corepack est retiré des binaires Node depuis la 25.x
- Depuis la v10, les scripts de cycle de vie des dépendances ne tournent plus à l'installation : un paquet non approuvé se voit en module manquant **à l'exécution**
- `pnpm/setup` v3 exige pnpm 11 ou plus et détecte seul un `.node-version`, un `.nvmrc` ou un `.tool-versions` : l'input `runtime` explicite prime sur ces fichiers
- pnpm 12 : `--frozen-lockfile false` n'existe plus (`--no-frozen-lockfile`), et une clé inconnue de `pnpm-workspace.yaml` est signalée par un warning qui suggère la bonne orthographe
- `exec` lance ce qui est installé, `dlx` récupère depuis le registre à la volée : ce ne sont pas des synonymes
- `hoist=true` par défaut hoiste dans `node_modules/.pnpm/node_modules`, zone interne qui ne casse pas l'isolation de la racine
