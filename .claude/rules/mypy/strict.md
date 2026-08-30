---
paths:
  - "sidecar/pyproject.toml"
---

# Mypy — Mode strict

## À faire
- Configurer `strict = true` dans `pyproject.toml`, pas en flag de ligne de commande : `--strict` en CLI ferait doublon
- Ajouter `warn_unreachable` explicitement : il n'est pas couvert par `strict`
- Fixer `python_version` sur la cible réelle du sidecar : Mypy applique les règles de la version déclarée, pas de celle qui l'exécute
- Lancer Mypy par `uv run` pour garantir les mêmes versions qu'en CI
- Annoter une fonction `async` par le type obtenu **après `await`**, jamais par sa coroutine
- Cibler `ignore_missing_imports` par un `[[tool.mypy.overrides]]` si le cas se présente
- Charger `plugins = ["pydantic.mypy"]` : les modèles du protocole sont des `BaseModel` (cf. [pydantic/modeles.md](../pydantic/modeles.md)), et le plugin en améliore le typage
- Décomposer un `asyncio.gather` sur des types hétérogènes : il rend un `list[Any]`
- Diagnostiquer un résultat suspect par `--no-incremental` : le format de cache a changé en 2.0 et le premier run après montée réanalyse tout

## À éviter
- `ignore_missing_imports = true` en global : masquerait la disparition future des types d'une dépendance, qui est une information et non une nuisance
- Copier une configuration Mypy 1.x : plusieurs défauts ont changé en 2.0
- Ajouter des `# type: ignore` sans code d'erreur : `warn_unused_ignores` les signale, et un ignore trop large masque autre chose
- Compter sur les tests pour valider les types : ils ne couvrent que les chemins exécutés
- Désactiver `strict` pour un module « compliqué » sans le noter : la dette devient invisible
- Déclarer un paquet `types-*` : toutes les dépendances du projet livrent un `py.typed`, `--install-types` n'a pas d'usage ici

## Gotchas
- `strict` active `disallow_any_generics`, `disallow_subclassing_any`, `disallow_untyped_calls`, `disallow_untyped_defs`, `disallow_incomplete_defs`, `check_untyped_defs`, `disallow_untyped_decorators`, `warn_redundant_casts`, `warn_unused_ignores`, `warn_return_any`, `no_implicit_reexport`, `strict_equality` et `extra_checks` — savoir lesquels évite d'en réactiver un déjà couvert
- 2.0 : `--local-partial-types` devient le défaut, ce qui change l'inférence des variables assignées dans des portées différentes
- 2.0 : `--strict-bytes` devient le défaut (PEP 688) — passer un `bytearray` ou un `memoryview` là où `bytes` est attendu ne passe plus, ce qui concerne le code des pochettes
- 2.0 : `--allow-redefinition` prend le comportement de l'ancien `--allow-redefinition-new`, et `--python-version 3.9` est rejeté (cible minimale 3.10)
- Une coroutine non attendue est inférée `Coroutine[Any, Any, T]` : c'est le type qui trahit un `await` oublié, et `strict` le signale
- 2.0 introduit `--num-workers` pour paralléliser la vérification
- Mypy et Ruff ont des périmètres disjoints : style et bugs locaux d'un côté, cohérence de types de l'autre (cf. [ruff/lint-format.md](../ruff/lint-format.md))
