---
paths:
  - "renovate.json"
---

# Renovate — Configuration

## À faire
- Partir de `config:recommended` et n'ajouter que ce qui manque : tableau de bord, groupement des monorepos, remplacements connus et contournements y sont déjà
- Garder une seule configuration pour les quatre gestionnaires : la détection se fait sur `package.json`, `pyproject.toml`, `Cargo.toml` et `.github/workflows/*.yml`, sans rien déclarer
- Grouper par zone (`npm`, `pep621`, `cargo`, `github-actions`) pour que chaque PR reste relisible, isoler les majeures du reste, et fixer le `semanticCommitType` de chaque groupe : `fix` fait apparaître les dépendances de production au changelog, `chore` en sort l'outillage
- Étendre `helpers:pinGitHubActionDigests` : il épingle les actions par SHA en gardant le tag lisible en commentaire
- Activer `lockFileMaintenance` avec un créneau hors heures de travail, sinon les transitives ne bougent jamais tant qu'une directe ne les tire pas
- Borner le débit par `prConcurrentLimit` et `prHourlyLimit` : ce qui n'est pas ouvert attend, rien n'est perdu
- Aligner `minimumReleaseAge` sur celui de pnpm pour que les deux fenêtres coïncident, et garder `minimumReleaseAgeExclude` en parade ciblée
- Relire la fiche `docs/knowledges/` correspondante en même temps qu'une PR de montée majeure sur Angular, PrimeNG ou Tauri

## À éviter
- Automerger les majeures : un contrat documenté peut avoir changé
- `commitMessagePrefix` pour la conformité Conventional : c'est `semanticCommits` qui produit un vrai `type(scope):`, l'autre n'est qu'un préfixe libre
- Relever les limites de PR au lieu de consulter le tableau de bord
- Écrire une configuration par sous-dossier
- Épingler une action sur un SHA nu sans commentaire de version : elle ne sera plus mise à jour
- Laisser Dependabot ouvrir des PR en parallèle : deux robots se disputeraient les mêmes dépendances
- Désactiver `minimumReleaseAge` pour débloquer un `--frozen-lockfile` : c'est une protection supply-chain réelle

## Gotchas
- Le passage à Renovate est motivé par Dependabot, qui referme les alertes de sécurité en silence sur un lockfile pnpm 11 multi-document : ce n'est pas le bump qui casse, c'est le graphe de dépendances
- « Dependency graph » et « Dependabot alerts » restent activés côté GitHub : Renovate **lit** ces alertes, il ne les produit pas. Un graphe cassé le prive de sa source de veille CVE
- `minimumReleaseAge` à 24 h peut faire échouer `pnpm install --frozen-lockfile` quand un bot régénère un lockfile pointant une transitive publiée dans la fenêtre (cas documenté sur `caniuse-lite`)
- La régénération des lockfiles passe par les CLI (`pnpm install`, `uv lock`, `cargo update`) : Renovate ne réimplémente aucun format
- L'automerge n'a de sens que si la CI couvre réellement le risque : lint, typecheck et tests des trois zones
- Côté `pep621`, Renovate traite `tool.uv.index.name` comme requis alors qu'il est optionnel, et la régénération échoue sur des dépendances privées non résolubles : sans objet ici, tout venant de PyPI
- Le couple `semanticCommits` ↔ release-please n'est traité par aucune documentation officielle : vérifier le format des messages sur une PR de test avant d'automatiser (cf. [release-please/config.md](../release-please/config.md))
