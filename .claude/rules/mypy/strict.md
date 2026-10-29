---
paths:
  - "sidecar/pyproject.toml"
---

# Mypy : mode strict

## À faire
- Fixer `python_version` sur la cible réelle du sidecar : Mypy applique les règles de la version déclarée, pas de celle qui l'exécute
- Annoter une fonction `async` par le type obtenu **après `await`**, jamais par sa coroutine
- Diagnostiquer un résultat suspect par `--no-incremental` : le format de cache a changé en 2.0 et le premier run après montée réanalyse tout

## À éviter
- Copier une configuration Mypy 1.x : plusieurs défauts ont changé en 2.0
- Compter sur les tests pour valider les types : ils ne couvrent que les chemins exécutés
- Désactiver `strict` pour un module « compliqué » sans le noter : la dette devient invisible
- Déclarer un paquet `types-*` : toutes les dépendances du projet livrent un `py.typed`, `--install-types` n'a pas d'usage ici

## Gotchas
- `strict` couvre déjà `disallow_untyped_*`, `warn_unused_ignores`, `warn_return_any`, `no_implicit_reexport`, `strict_equality` et `extra_checks` : ne pas les réactiver un par un
- 2.0 : `--local-partial-types` devient le défaut et change l'inférence des variables assignées dans des portées différentes
- 2.0 : `--strict-bytes` devient le défaut, un `bytearray` ou un `memoryview` ne passe plus pour `bytes` (code des pochettes)
- 2.4 : le parser natif (basé sur celui de Ruff) devient le défaut ; `native_parser = false` rétablit l'ancien jusqu'à son retrait annoncé début 2027
- Une coroutine non attendue est inférée `Coroutine[Any, Any, T]` : c'est ce type qui trahit un `await` oublié
