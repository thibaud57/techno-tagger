---
paths:
  - ".github/workflows/**/*.yml"
  - ".github/workflows/**/*.yaml"
---

# GitHub Actions — Cache, outputs & artifacts

## À faire
- Construire une clé de cache avec `runner.os` et `hashFiles` sur le lockfile de la zone concernée, plus des `restore-keys` en repli
- Laisser les actions de setup gérer leur propre cache (`pnpm/setup`, `astral-sh/setup-uv`, `Swatinem/rust-cache`) plutôt que câbler un `actions/cache` par-dessus
- Publier une valeur entre jobs par `echo "clé=valeur" >> $GITHUB_OUTPUT` sur un step porteur d'un `id:`, remontée dans `outputs:` du job et lue en `needs.<job>.outputs.<clé>`
- Écrire dans `$GITHUB_STEP_SUMMARY` ce qu'on veut relire après coup sans dérouler les logs : récapitulatif de tests, coverage du sidecar
- Annoter avec `::error file=…,line=…::` ce qui doit remonter dans la PR plutôt que se perdre dans la sortie du step

## À éviter
- Mettre `src-tauri/target/release/` en cache : Tauri y copie le sidecar sans invalider la copie, un cache périmé embarquerait un ancien binaire dans l'installeur distribué
- Confondre `$GITHUB_OUTPUT` (valeur partagée entre jobs via `needs:`) et `$GITHUB_ENV` (variable d'environnement des steps suivants du même job)
- Faire transiter un secret ou une clé de signature par un artifact
- Une clé de cache figée sans `hashFiles` : le cache ne s'invalide jamais et sert des dépendances périmées
- `actions/upload-artifact@v3`, en fin de vie depuis janvier 2025, à ne jamais reprendre d'un exemple ancien

## Gotchas
- Deux uploads d'artifact du même nom échouent avec `upload-artifact@v4`
- Le cache est plafonné à 10 Go par dépôt, toutes branches et workflows confondus
- `::add-mask::` masque une valeur calculée à l'exécution, ce que le masquage des secrets statiques ne couvre pas
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
