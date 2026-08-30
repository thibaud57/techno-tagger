---
paths:
  - ".github/workflows/**/*.yml"
  - ".github/workflows/**/*.yaml"
---

# GitHub Actions — Contrôle d'exécution

## À faire
- Poser `concurrency` au niveau workflow avec `cancel-in-progress: true` sur le gate qualité : un nouveau push sur une PR rend le run précédent inutile
- Poser `cancel-in-progress: false` sur le job de release : un build interrompu en cours de signature laisse une Release incomplète
- Déclarer `needs:` sur tout job conditionné par `failure()`, sans quoi il démarre en parallèle avant que les autres aient pu échouer
- Utiliser une matrice pour couvrir plusieurs versions de Python ou de Node sur le même job de qualité
- `fail-fast: false` quand on veut le rapport complet de la matrice, et pas seulement la première combinaison rouge
- `timeout-minutes` sur les jobs de build : le défaut est de 6 heures, un job bloqué les consomme entièrement

## À éviter
- `continue-on-error: true` sur un step du gate qualité : il masque l'échec au lieu de le conditionner, et rend le job vert alors que le lint ou les tests ont échoué
- Tester `conclusion` après un `continue-on-error` pour détecter l'échec : c'est `outcome` qui porte le résultat brut, `conclusion` valant `success`
- Compter sur `[skip ci]` pour éviter un run : cela ne s'applique qu'aux events `push` et `pull_request`, et prive la PR de son gate
- Un `max-parallel` sur les runners GitHub-hosted d'un dépôt public, gratuits et illimités : rien à ménager

## Gotchas
- Un job qui échoue annule les jobs qui en dépendent par `needs:`, mais pas les jobs parallèles déjà démarrés
- Le seuil de coverage de 80 % sur `sidecar/` est un gate bloquant : il doit faire échouer le job, jamais être toléré par `continue-on-error`

## Exemples
```yaml
# ✅ annule les runs superseded sur la même branche
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

# ✅ outcome, pas conclusion, après un step toléré
- id: tests
  run: pnpm test
  continue-on-error: true
- if: steps.tests.outcome == 'failure'
  run: echo "::warning::tests rouges"
```
