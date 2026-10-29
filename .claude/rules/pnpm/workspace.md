---
paths:
  - "package.json"
  - "pnpm-workspace.yaml"
  - "pnpm-lock.yaml"
  - ".github/actions/setup-pnpm/action.yml"
---

# pnpm : workspace et dépendances

## À faire
- Créer un `pnpm-workspace.yaml` même sans monorepo : il accueille `allowBuilds` et les réglages que le `.npmrc` n'accepte plus depuis pnpm 11
- Déclarer la version de pnpm par `devEngines.packageManager` (`name: "pnpm"`, version exacte, `onFail: "download"`) dans `package.json`, seule source : `pnpm/setup` la lit sans input `version`. L'action composite `.github/actions/setup-pnpm` ne porte que la version de Node (`runtime`)
- Figer une version exacte par `pnpm add -E`
- Committer `pnpm-lock.yaml` et `allowBuilds` dans le même commit que le changement de dépendance
- Résoudre un conflit de lockfile en relançant `pnpm install` puis en relisant le diff
- Écrire `--frozen-lockfile` explicitement en CI : pnpm l'active seul en environnement CI, mais l'écrire rend l'échec clair et le comportement portable
- Vérifier `pnpm ignored-builds` quand une dépendance native se comporte mal et n'approuver un build qu'après avoir regardé ce que son script fait
- Cibler `public-hoist-pattern` sur le seul paquet qui l'exige quand un outil réclame du hoisting
- Placer les options **avant** `exec` : `pnpm -r exec jest`, sinon le flag part à la commande exécutée sans erreur visible

## À éviter
- Mélanger `npm install` et `pnpm install` sur le même dépôt : deux lockfiles cohabiteraient sans se voir
- Éditer `pnpm-lock.yaml` à la main, y compris pour résoudre un conflit
- `actions/setup-node` en plus de `pnpm/setup` : la seconde installe déjà le runtime
## Gotchas
- Les scripts tournent sous `bash` (`scriptShell`) : utiliser `$npm_package_name` et `$npm_package_version` plutôt qu'une valeur recopiée
- `devEngines.packageManager` ajoute un premier document (`packageManagerDependencies`) à `pnpm-lock.yaml` : le graphe de dépendances GitHub ne lit que lui, les alertes de sécurité npm ne sont pas fiables tant que dependabot-core#15904 est ouverte (ouverte au 2026-10-28) (veille par `just audit-ui`, cf. VERSIONS.md § Dependabot). Ne jamais ajouter le champ legacy `packageManager` en plus
- Depuis la v10, les scripts de cycle de vie des dépendances ne tournent plus à l'installation : un paquet non approuvé se voit en module manquant **à l'exécution**
- `pnpm/setup` v3 exige pnpm 11 ou plus et détecte seul un `.node-version`, un `.nvmrc` ou un `.tool-versions` : l'input `runtime` explicite prime sur ces fichiers
- pnpm 12 : `--frozen-lockfile false` n'existe plus (`--no-frozen-lockfile`) et une clé inconnue de `pnpm-workspace.yaml` est signalée par un warning qui suggère la bonne orthographe
- Un correctif de sécurité sur une transitive épinglée en exact par son parent passe par `overrides` dans `pnpm-workspace.yaml` : commenter le pourquoi et la condition de retrait, retirer l'entrée dès que le parent relève son épingle
- Un outil qui résout le lockfile sans passer par la CLI pnpm ignore `minimumReleaseAge` : `pnpm install --frozen-lockfile` échoue alors sur une transitive trop fraîche
- `exec` lance ce qui est installé, `dlx` récupère depuis le registre à la volée : ce ne sont pas des synonymes
- `hoist=true` par défaut hoiste dans `node_modules/.pnpm/node_modules`, zone interne qui ne casse pas l'isolation de la racine
