---
paths:
  - ".github/workflows/**/*.yml"
  - ".github/workflows/**/*.yaml"
  - ".github/actions/**/action.yml"
  - ".github/dependabot.yml"
---

# GitHub Actions : cache, outputs et artifacts

## À faire
- Construire une clé de cache avec `runner.os` et `hashFiles` sur le lockfile de la zone concernée, plus des `restore-keys` en repli
- Laisser les actions de setup gérer leur propre cache (`pnpm/setup` avec `cache: true`, désactivé par défaut ; `astral-sh/setup-uv` ; `Swatinem/rust-cache`) plutôt que câbler un `actions/cache` par-dessus
- Publier une valeur entre jobs par `echo "clé=valeur" >> $GITHUB_OUTPUT` sur un step porteur d'un `id:`, remontée dans `outputs:` du job et lue en `needs.<job>.outputs.<clé>`

## À éviter
- Mettre `src-tauri/target/release/` en cache : Tauri y copie le sidecar sans invalider la copie, un cache périmé embarquerait un ancien binaire dans l'installeur distribué
- Confondre `$GITHUB_OUTPUT` (valeur partagée entre jobs via `needs:`) et `$GITHUB_ENV` (variable d'environnement des steps suivants du même job)
- Une clé de cache figée sans `hashFiles` : le cache ne s'invalide jamais et sert des dépendances périmées
- `actions/upload-artifact@v3`, dépréciée depuis le 2024-11-30, à ne jamais reprendre d'un exemple ancien

## Gotchas
- Deux uploads d'artifact du même nom échouent (`upload-artifact@v7`), sauf avec `overwrite: true`
- Le cache est plafonné à 10 Go par dépôt, toutes branches et workflows confondus et une entrée non lue depuis 7 jours est supprimée : le build de release, mensuel au mieux, part à froid
- Un run ne restaure que les caches de sa branche, de la branche par défaut ou, pour une PR, de sa base : un cache créé par une PR ne sert qu'à ses re-runs
- `cache-mode` (`read`, `write`, `none`…) restreint l'accès au cache par workflow ou par job ; sans lui, les défauts sécurisés de GitHub s'appliquent
- La rétention par défaut d'un artifact est de 90 jours ; l'installeur distribué vit sur la Release, pas dans un artifact

## Exemples
```yaml
# ✅ output d'un job consommé par le suivant
jobs:
  prepare:
    outputs:
      version: ${{ steps.read.outputs.version }}
    steps:
      - id: read
        run: echo "version=$(cat VERSION)" >> $GITHUB_OUTPUT
  build:
    needs: prepare
    steps:
      - run: echo "build ${{ needs.prepare.outputs.version }}"

# ❌ $GITHUB_ENV ne traverse pas les jobs
      - run: echo "version=1.2.3" >> $GITHUB_ENV
```
