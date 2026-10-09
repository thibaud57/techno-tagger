---
paths:
  - "sidecar/pyproject.toml"
---

# Ruff — Lint & format

## À faire
- Déclarer `select` explicitement plutôt que d'hériter du jeu par défaut de la version installée
- En local, `ruff check --fix` puis `ruff format` (`just format-sidecar`) : le formateur ne trie pas les imports, et l'ordre inverse laisse du code mal formaté. La CI ne fait que vérifier, par `ruff check` et `ruff format --check`
- Utiliser `per-file-ignores` pour les tests (`S101`) et les `__init__.py` (`F401`) plutôt que de désactiver une règle globalement
- Bannir `asyncio.get_event_loop` et `sqlite3.version` dans `banned-api`, avec le remplaçant en message : Python 3.14 les rejette
- Épingler la version de Ruff par `uv.lock`, que la CI lance par `uv run`, et laisser Dependabot proposer la montée
- Cadrer une montée de version par `ruff check --statistics` avant de regarder le diff
- Produire des annotations natives en CI par `RUFF_OUTPUT_FORMAT=github`

## À éviter
- Reprendre un `[tool.ruff]` antérieur à 0.16 sans `select` : le jeu par défaut est passé de 59 à 413 règles, le premier `ruff check` produit un diff ingérable
- Confondre `select` (remplace entièrement le jeu actif) et `extend-select` (s'y ajoute)
- Laisser `COM812` actif : il casse `ruff format`, comme `W191`, `E111`, `E114`, `E117`, `Q000` à `Q004`, `ISC002`, `D203`, `D206` et `D300`
- `--fix` dans un job CI : elle vérifie, elle ne réécrit pas, sinon des régressions se committent silencieusement
- `--unsafe-fixes` sur un lot large sans relire le diff : par définition ces corrections peuvent changer le comportement
- Activer `preview` : les règles y changent sans préavis entre deux patchs
- Ajouter Black ou isort à côté : Ruff couvre les deux, et deux formatters se contredisent

## Gotchas
- Ne pas poser `target-version` : Ruff le dérive de `project.requires-python`
- La 0.16.0 retire aussi 18 règles du jeu par défaut (`E401`, `E402`, `E701`, `F403`, `F405`…) sans le documenter : une règle qui ne se déclenche plus après montée vient peut-être de là
- Codes de sortie : 0 rien à signaler, 1 violations, 2 erreur de configuration
