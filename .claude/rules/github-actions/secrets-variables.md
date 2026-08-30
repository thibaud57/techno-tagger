---
paths:
  - ".github/workflows/**/*.yml"
  - ".github/workflows/**/*.yaml"
---

# GitHub Actions — Secrets & variables

## À faire
- Stocker en secrets GitHub tout ce qui signe ou identifie : clé privée de l'updater et son mot de passe, DSN Sentry, clé de licence PrimeNG, token Sentry (liste, usage et conséquence de perte : [PRODUCTION.md](../../../docs/PRODUCTION.md) § Variables d'Environnement)
- Passer un secret par `env:` au niveau du step qui en a besoin, et le lire en `$VAR` dans le shell
- Réserver `vars` (UI GitHub) aux valeurs non sensibles qui varient, et `env:` YAML aux constantes du workflow
- Consommer le `GITHUB_TOKEN` fourni automatiquement pour publier la Release : aucun secret à créer pour cela
- Sauvegarder la clé de signature **hors de GitHub** : sa perte rend toute mise à jour impossible sur les installations déjà déployées

## À éviter
- Écrire une valeur sensible en clair dans le YAML : le dépôt est public et l'historique git est indélébile
- Faire transiter la clé de signature ailleurs que dans les secrets : ni dépôt, ni artefact de CI, ni log de build
- `echo` d'un secret pour déboguer : le masquage est automatique mais imparfait sur les valeurs courtes ou trop communes
- Attendre des secrets dans un run déclenché par une PR de fork : ils n'y sont pas transmis
- Monter un `environment:` avec règles de protection : le projet n'a que deux états d'application et aucun déploiement serveur (cf. [PRODUCTION.md](../../../docs/PRODUCTION.md) § Environnements)

## Gotchas
- Les secrets Dependabot sont un stock distinct des secrets Actions, jamais partagés ; le projet utilise Renovate, dont les PR passent le même gate qualité que les PR humaines
- Un secret d'environment écrase le secret repo de même nom pour le job qui le cible
- Le contexte `secrets` n'est disponible ni dans un `if:` de job ni dans un `if:` de step : impossible de conditionner l'exécution sur la présence d'une valeur

## Exemples
```yaml
# ✅ le secret ne traverse jamais la ligne de commande
- run: ./sign.sh
  env:
    SIGNING_KEY: ${{ secrets.SIGNING_KEY }}

# ❌ interpolé dans le shell, et lisible dans le log si la commande est tracée
- run: ./sign.sh --key "${{ secrets.SIGNING_KEY }}"
```
