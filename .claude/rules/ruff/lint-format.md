---
paths:
  - "sidecar/pyproject.toml"
---

# Ruff : lint et format

## À faire
- Laisser `target-version` non posé : Ruff le dérive de `project.requires-python`
- En local, `ruff check --fix` puis `ruff format` (`just format-sidecar`) : le formateur ne trie pas les imports et l'ordre inverse laisse du code mal formaté. La CI ne fait que vérifier, par `ruff check` et `ruff format --check`
- Épingler la version de Ruff par `uv.lock`, que la CI lance par `uv run` et laisser Dependabot proposer la montée
- Cadrer une montée de version par `ruff check --statistics` avant de regarder le diff
- Produire des annotations natives en CI par `RUFF_OUTPUT_FORMAT=github`

## À éviter
- Confondre `select` (remplace entièrement le jeu actif) et `extend-select` (s'y ajoute)
- `--fix` dans un job CI : elle vérifie, elle ne réécrit pas, sinon des régressions se committent silencieusement
- `--unsafe-fixes` sur un lot large sans relire le diff : par définition ces corrections peuvent changer le comportement
- Activer `preview` : les règles y changent sans préavis entre deux patchs
- Ajouter Black ou isort à côté : Ruff couvre les deux et deux formatters se contredisent

## Gotchas
- La 0.16.0 retire aussi 18 règles du jeu par défaut (`E401`, `E402`, `E701`, `F403`, `F405`…) sans le documenter : une règle qui ne se déclenche plus après montée vient peut-être de là
- Codes de sortie : 0 rien à signaler, 1 violations, 2 erreur de configuration
- 0.17 : les pragmas de fin de ligne ne comptent plus dans la largeur (`E501`, `I001`, `W505`, formateur) et `DTZ` quitte le défaut : le `select` explicite le garde
