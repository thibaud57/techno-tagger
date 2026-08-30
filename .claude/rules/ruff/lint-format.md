---
paths:
  - "sidecar/pyproject.toml"
---

# Ruff — Lint & format

## À faire
- Déclarer `select` explicitement plutôt que d'hériter du jeu par défaut de la version installée
- Aligner `target-version` sur le `requires-python` du projet, sinon Ruff propose des réécritures incompatibles
- Enchaîner `ruff check --select I --fix` puis `ruff format` : le formateur ne trie pas les imports, et l'ordre inverse laisse du code corrigé mais mal formaté
- Utiliser `per-file-ignores` pour les tests (`S101`) et les `__init__.py` (`F401`) plutôt que de désactiver une règle globalement
- Bannir `asyncio.get_event_loop` et `sqlite3.version` dans `[tool.ruff.lint.flake8-tidy-imports.banned-api]`, avec un message renvoyant au remplaçant : Python 3.14 les rejette, et la garantie passe par la CI plutôt que par la mémoire
- Épingler la version de Ruff en CI comme en pre-commit, et laisser Renovate proposer la montée
- Cadrer une montée de version par `ruff check --statistics` avant de regarder le diff
- Produire des annotations natives en CI par `--output-format github`, et interdire le `--fix` implicite par `--exit-non-zero-on-fix`

## À éviter
- Reprendre un `[tool.ruff]` antérieur à 0.16 sans `select` : le jeu par défaut est passé de 59 à 413 règles, le premier `ruff check` produit un diff ingérable
- Confondre `select` (remplace entièrement le jeu actif) et `extend-select` (s'y ajoute)
- Laisser `COM812` actif : il casse `ruff format`, comme `W191`, `E111`, `E114`, `E117`, `Q000` à `Q004`, `ISC002`, `D203`, `D206` et `D300`
- `--fix` dans un job CI : elle vérifie, elle ne réécrit pas, sinon des régressions se committent silencieusement
- `--unsafe-fixes` sur un lot large sans relire le diff : par définition ces corrections peuvent changer le comportement
- Activer `preview` : les règles y changent sans préavis entre deux patchs
- Ajouter Black ou isort à côté : Ruff couvre les deux, et deux formatters se contredisent

## Gotchas
- La 0.16.0 retire aussi 18 règles du jeu par défaut (`E401`, `E402`, `E701`, `F403`, `F405`…) sans les déprécier ni le documenter dans les notes de rupture : une règle qui « ne se déclenche plus » après montée de version vient peut-être de là
- Codes de sortie : 0 rien à signaler, 1 violations restantes, 2 erreur de configuration. Distinguer les deux derniers en CI
- `ruff format` est compatible Black à plus de 99,9 % sur du code déjà formaté : la migration ne produit pas de diff significatif
- Ruff n'est pas un type checker : aucun recouvrement avec le gate Mypy, les deux sont nécessaires (cf. [mypy/strict.md](../mypy/strict.md))
- La configuration Ruff de techno-scraper n'est pas transposable si elle date d'avant la 0.16.0 : partir du défaut de la 0.16.x, ajouter `I`, retirer `COM812`, ne pas copier-coller
