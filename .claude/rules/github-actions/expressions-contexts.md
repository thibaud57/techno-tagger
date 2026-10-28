---
paths:
  - ".github/workflows/**/*.yml"
  - ".github/workflows/**/*.yaml"
---

# GitHub Actions : expressions et contextes

## À faire
- Écrire les `if:` sans `${{ }}`, sauf si l'expression commence par `!` où ils deviennent obligatoires (`!` est un tag YAML réservé)
- Réserver `always()` à un job qui doit rendre un verdict même sur annulation, comme l'agrégateur `ci` exigé par la protection : sauté, il compterait comme passé
- Choisir une valeur par `case(pred1, val1, ..., défaut)` plutôt que par le détournement `cond && a || b`, qui rend `b` dès que `a` est vide

## À éviter
- Supposer qu'une propriété absente lève une erreur : elle rend une chaîne vide et la condition passe silencieusement

## Gotchas
- Un output de job est toujours une **chaîne** : `release_created` se compare à `'true'`, pas au booléen `true`
- Les comparaisons de chaînes sont insensibles à la casse, `contains` et `startsWith` compris

## Exemples
```yaml
# ✅ ${{ }} obligatoires quand l'expression commence par !
if: ${{ !startsWith(github.ref, 'refs/tags/') }}

# ✅ sans ${{ }} le reste du temps et comparaison à la chaîne 'true'
if: needs.release-please.outputs.release_created == 'true'

# ❌ jamais vrai : un output de job est une chaîne, jamais le booléen true
if: needs.release-please.outputs.release_created == true
```
