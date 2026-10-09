---
paths:
  - ".github/workflows/**/*.yml"
  - ".github/workflows/**/*.yaml"
---

# GitHub Actions — Expressions & contextes

## À faire
- Écrire les `if:` sans `${{ }}`, sauf si l'expression commence par `!` où ils deviennent obligatoires (`!` est un tag YAML réservé)
- Lire un résultat de job antérieur par `needs.<job>.outputs.<clé>`, disponible uniquement si le job est listé dans `needs:`
- Tester l'état d'un job dépendant par `needs.<job>.result` (`success` | `failure` | `cancelled` | `skipped`)
- Utiliser les fonctions de statut dans `if:` : `success()` implicite, `failure()` pour s'exécuter malgré un échec, `${{ !cancelled() }}` pour le nettoyage, `cancelled()` pour une annulation manuelle
- Réserver `always()` à un job qui doit rendre un verdict même sur annulation, comme l'agrégateur `ci` exigé par la protection : sauté, il compterait comme passé
- Choisir une valeur par `case(pred1, val1, ..., défaut)` plutôt que par le détournement `cond && a || b`, qui rend `b` dès que `a` est vide
- `hashFiles('<lockfile>')` comme composante de clé de cache, `fromJSON` pour typer un output ou construire une matrice dynamique
- Bracket notation (`steps['mon step'].outputs['clé.imbriquée']`) dès qu'un identifiant sort de `[A-Za-z_][A-Za-z0-9_-]*` : un tiret seul ne l'exige pas

## À éviter
- Comparer une valeur au résultat d'un secret dans un `if:` : le contexte `secrets` n'y est jamais disponible
- Des guillemets doubles à l'intérieur d'une expression : seules les chaînes en guillemets simples sont valides
- Supposer qu'une propriété absente lève une erreur : elle rend une chaîne vide, et la condition passe silencieusement

## Gotchas
- Chaque section a ses contextes : un `jobs.<id>.if:` ne voit que `github`, `needs`, `vars` et `inputs`, ni `env`, ni `steps`, ni `secrets`
- Un output de job est toujours une **chaîne** : `release_created` se compare à `'true'`, pas au booléen `true`
- Les comparaisons de chaînes sont insensibles à la casse, `contains` et `startsWith` compris
- `steps.<id>.outcome` est le résultat brut, `conclusion` le résultat après `continue-on-error` : les deux diffèrent dès qu'un step est toléré

## Exemples
```yaml
# ✅ ${{ }} obligatoires quand l'expression commence par !
if: ${{ !startsWith(github.ref, 'refs/tags/') }}

# ✅ sans ${{ }} le reste du temps, et comparaison à la chaîne 'true'
if: needs.release-please.outputs.release_created == 'true'

# ❌ jamais évalué : secrets est absent du contexte d'un if
if: secrets.SIGNING_KEY != ''
```
