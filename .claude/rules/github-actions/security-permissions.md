---
paths:
  - ".github/workflows/**/*.yml"
  - ".github/workflows/**/*.yaml"
  - ".github/actions/**/action.yml"
  - ".github/dependabot.yml"
---

# GitHub Actions : sécurité, permissions et secrets

## À faire
- Déclarer `permissions:` explicitement : `contents: read` sur le workflow, tout scope supplémentaire, en lecture (`pull-requests: read`) comme en écriture, sur le seul job qui en a l'usage
- Laisser `permissions: contents: read` sur le job `release-please` : ses droits d'écriture viennent du token de la GitHub App, borné par les inputs `permission-*` (cf. [app-token.md](app-token.md))
- Épingler chaque action tierce, actions composites locales comprises, sur le SHA de son tag avec la version en commentaire, jamais sur un tag flottant : un tag peut être réaffecté ou traîner avant un correctif et seul le SHA laisse Dependabot proposer la montée
- Tenir les réglages Actions du dépôt public : token par défaut `restricted`, Actions non autorisées à créer et approuver une PR (release-please ouvre la sienne avec le token de la GitHub App de release), policy de SHA pinning, approbation de tous les contributeurs externes pour les PR de fork et `dependabot[bot]` dans les actor rules s'il y en a (état relevé dans [PRODUCTION.md § Réglages Actions du dépôt](../../../docs/PRODUCTION.md#réglages-actions-du-dépôt))
- Laisser Dependabot (écosystème `github-actions`) faire remonter les bumps d'actions en PR mensuelle, gate qualité compris
- Passer toute valeur contrôlée par un tiers (titre de PR, corps d'issue, `client_payload`) par `env:` avant de la lire dans un `run:`
- Laisser « Dependency graph » et « Dependabot alerts » actifs côté dépôt : les mises à jour de sécurité de Dependabot s'appuient dessus
- Stocker en secrets GitHub tout ce qui signe ou identifie : clé updater et son mot de passe, DSN et token Sentry, licence PrimeNG, `DOKPLOY_URL`, `DOKPLOY_TOKEN` et `DOKPLOY_COMPOSE_ID` du redéploiement de la démo (cf. [PRODUCTION.md § Variables d'Environnement](../../../docs/PRODUCTION.md#variables-denvironnement))
- Passer un secret par `env:` au niveau du step qui en a besoin et le lire en `$VAR` dans le shell
- Réserver `vars` (UI GitHub) aux valeurs non sensibles qui varient et `env:` YAML aux constantes du workflow
- Consommer le `GITHUB_TOKEN` fourni automatiquement pour publier la Release : aucun secret à créer pour cela
- Poser la GitHub App de release en variable `RELEASE_APP_CLIENT_ID` (non sensible, lue par `vars`) et secret `RELEASE_APP_PRIVATE_KEY` (clé complète, lignes `BEGIN` et `END` comprises) : le token d'installation est frappé à chaque run et valable 1 h, la clé n'expire pas et ne tourne que sur compromission (cf. [PRODUCTION.md § Rotation](../../../docs/PRODUCTION.md#rotation))
- Sauvegarder la clé de signature **hors de GitHub** : sa perte rend toute mise à jour impossible sur les installations déjà déployées

## À éviter
- `permissions: write-all`, ou l'absence de bloc `permissions:` qui laisse hériter le réglage du dépôt
- Écrire une valeur sensible en clair dans le YAML : le dépôt est public et l'historique git est indélébile
- Faire transiter la clé de signature ailleurs que dans les secrets : ni dépôt, ni artefact de CI, ni log de build
- `echo` d'un secret pour déboguer : le masquage est automatique mais imparfait sur les valeurs courtes ou trop communes et il ne couvre pas une valeur dérivée (encodée, tronquée, transformée)
- Attendre des secrets dans un run déclenché par une PR de fork : ils n'y sont pas transmis

## Gotchas
- Un bloc `permissions:` de job remplace celui du workflow, il ne s'y ajoute pas : dès qu'un scope est déclaré, tous les autres passent à `none`, donc `contents: read` se redéclare. `{}` vaut aucune permission, un bloc omis hérite
- Le `GITHUB_TOKEN` est régénéré par run et expire à la fin du job : rien à faire tourner
- Les secrets Dependabot sont un stock distinct des secrets Actions, jamais partagés ; les PR de Dependabot passent le même gate qualité que les PR humaines
- Le contexte `secrets` n'est disponible ni dans un `if:` de job ni dans un `if:` de step : pour conditionner un step sur la présence d'un secret, l'exposer en `env:` du job puis tester `env.X` dans le `if:` du step
- Une valeur masquée ne peut plus être publiée comme output de job

## Exemples
```yaml
# ✅ valeur tierce passée en variable d'environnement, jamais interpolée
- run: |
    if [[ "$PR_TITLE" == *"WIP"* ]]; then exit 1; fi
  env:
    PR_TITLE: ${{ github.event.pull_request.title }}

# ❌ injection de script : le titre est substitué dans le shell
- run: |
    if [[ "${{ github.event.pull_request.title }}" == *"WIP"* ]]; then exit 1; fi

# ✅ action tierce épinglée sur un SHA
- uses: actions/checkout@<sha>  # vX.Y.Z
```

```yaml
# ✅ le secret ne traverse jamais la ligne de commande
- run: ./sign.sh
  env:
    SIGNING_KEY: ${{ secrets.SIGNING_KEY }}

# ❌ interpolé dans le shell et lisible dans le log si la commande est tracée
- run: ./sign.sh --key "${{ secrets.SIGNING_KEY }}"
```
