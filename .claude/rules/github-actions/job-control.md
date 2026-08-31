---
paths:
  - ".github/workflows/**/*.yml"
  - ".github/workflows/**/*.yaml"
---

# GitHub Actions — Contrôle d'exécution

## À faire
- Poser `concurrency` au niveau workflow sur le gate qualité, avec `cancel-in-progress` **conditionné à l'event** : `${{ github.event_name == 'pull_request' }}`. Un nouveau push sur une PR rend le run précédent inutile ; sur `main` et `develop` chaque commit garde son propre verdict, celui de `main` étant le dernier état vert connu avant le tag
- Poser `cancel-in-progress: false` sur le job de release : un build interrompu en cours de signature laisse une Release incomplète
- Déclarer `needs:` sur tout job conditionné par `failure()`, sans quoi il démarre en parallèle avant que les autres aient pu échouer
- Utiliser une matrice pour couvrir plusieurs versions de Python ou de Node sur le même job de qualité, si un jour plusieurs versions sont réellement supportées : ce projet épingle une version unique par job (`ci.yml`), sans matrice de versions
- `fail-fast: false` quand on veut le rapport complet d'une matrice, et pas seulement la première combinaison rouge
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
# ✅ annule les runs superseded d'une PR, garde le verdict de chaque commit de main
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

# ✅ outcome, pas conclusion, après un step toléré
- id: tests
  run: pnpm test
  continue-on-error: true
- if: steps.tests.outcome == 'failure'
  run: echo "::warning::tests rouges"
```
