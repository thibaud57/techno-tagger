---
paths:
  - ".github/workflows/**/*.yml"
  - ".github/workflows/**/*.yaml"
---

# GitHub Actions : secrets et variables

## À faire
- Stocker en secrets GitHub tout ce qui signe ou identifie : clé updater et son mot de passe, DSN et token Sentry, licence PrimeNG, `DOKPLOY_URL`, `DOKPLOY_TOKEN` et `DOKPLOY_COMPOSE_ID` du redéploiement de la démo (cf. [PRODUCTION.md § Variables d'Environnement](../../../docs/PRODUCTION.md#variables-denvironnement))
- Passer un secret par `env:` au niveau du step qui en a besoin et le lire en `$VAR` dans le shell
- Réserver `vars` (UI GitHub) aux valeurs non sensibles qui varient et `env:` YAML aux constantes du workflow
- Consommer le `GITHUB_TOKEN` fourni automatiquement pour publier la Release : aucun secret à créer pour cela
- Poser la GitHub App de release en variable `RELEASE_APP_CLIENT_ID` (non sensible, lue par `vars`) et secret `RELEASE_APP_PRIVATE_KEY` (clé complète, lignes `BEGIN` et `END` comprises) : le token d'installation est frappé à chaque run et valable 1 h, la clé n'expire pas et ne tourne que sur compromission (cf. [PRODUCTION.md § Rotation](../../../docs/PRODUCTION.md#rotation))
- Sauvegarder la clé de signature **hors de GitHub** : sa perte rend toute mise à jour impossible sur les installations déjà déployées

## À éviter
- Écrire une valeur sensible en clair dans le YAML : le dépôt est public et l'historique git est indélébile
- Faire transiter la clé de signature ailleurs que dans les secrets : ni dépôt, ni artefact de CI, ni log de build
- `echo` d'un secret pour déboguer : le masquage est automatique mais imparfait sur les valeurs courtes ou trop communes et il ne couvre pas une valeur dérivée (encodée, tronquée, transformée)
- Attendre des secrets dans un run déclenché par une PR de fork : ils n'y sont pas transmis
## Gotchas
- Les secrets Dependabot sont un stock distinct des secrets Actions, jamais partagés ; les PR de Dependabot passent le même gate qualité que les PR humaines
- Le contexte `secrets` n'est disponible ni dans un `if:` de job ni dans un `if:` de step : pour conditionner un step sur la présence d'un secret, l'exposer en `env:` du job puis tester `env.X` dans le `if:` du step
- Une valeur masquée ne peut plus être publiée comme output de job

## Exemples
```yaml
# ✅ le secret ne traverse jamais la ligne de commande
- run: ./sign.sh
  env:
    SIGNING_KEY: ${{ secrets.SIGNING_KEY }}

# ❌ interpolé dans le shell et lisible dans le log si la commande est tracée
- run: ./sign.sh --key "${{ secrets.SIGNING_KEY }}"
```
