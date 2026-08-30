---
title: "Mypy — Vérification statique de types du sidecar"
version: "2.3.1"
description: "Référence technique pour Mypy : mode strict et ce qu'il active réellement, nouveaux défauts de la 2.0, typage asyncio, py.typed et exécution en CI."
date: "2026-08-29"
keywords: ["mypy", "typing", "strict", "asyncio", "py-typed", "ci"]
scope: ["docs"]
technologies: ["Python", "uv", "Ruff", "httpx2"]
---

# Description

Vérificateur de types du sidecar, en mode strict. Il couvre ce que Ruff ne regarde pas : la cohérence des types **à travers le projet**, là où le linter raisonne fichier par fichier.

Point confortable de ce projet : **toutes les dépendances livrent un `py.typed`**, aucun paquet `types-*` n'est requis.

---

# Concepts Clés

## Ce que `strict` active réellement

### Description

`strict = true` n'est pas une option mais un raccourci vers un jeu de flags précis. Savoir lesquels évite d'en réactiver un déjà couvert.

### Exemple

```toml
[tool.mypy]
strict = true
python_version = "3.14"
warn_unreachable = true   # NON inclus par strict
```

### Points Importants

- **`strict` active** : `disallow_any_generics`, `disallow_subclassing_any`, `disallow_untyped_calls`, `disallow_untyped_defs`, `disallow_incomplete_defs`, `check_untyped_defs`, `disallow_untyped_decorators`, `warn_redundant_casts`, `warn_unused_ignores`, `warn_return_any`, `no_implicit_reexport`, `strict_equality`, `extra_checks`
- **`warn_unreachable` n'en fait pas partie** : à ajouter séparément si voulu
- `python_version` doit correspondre à la cible réelle : Mypy applique les règles de la version déclarée, pas de celle qui l'exécute
- Sur un projet neuf, activer `strict` d'emblée coûte peu ; sur un projet existant, procéder par `[[tool.mypy.overrides]]` module par module

---

## Nouveaux défauts de Mypy 2.0

### Description

La ligne 2.x change plusieurs comportements par défaut. Un projet monté depuis la 1.x voit apparaître des erreurs sur du code inchangé.

### Points Importants

- **`--local-partial-types` est devenu le défaut** : l'inférence change pour les variables assignées dans des portées différentes
- **`--strict-bytes` est devenu le défaut** (conforme PEP 688) : passer un `bytearray` ou un `memoryview` là où `bytes` est attendu ne passe plus. Concerne le code qui manipule des pochettes
- `--allow-redefinition` a pris le comportement de l'ancien `--allow-redefinition-new` ; `--allow-redefinition-old` restaure l'ancien
- **`--python-version 3.9` est rejeté** : la cible minimale est 3.10
- Le format du cache a changé : le premier run après montée de version réanalyse tout

---

## Typage du code asyncio

### Description

Une fonction `async def` s'annote par le type obtenu **après `await`**, pas par la coroutine.

### Exemple

```python
async def fetch_track(client: httpx2.AsyncClient, track_id: str) -> Track:
    response = await client.get(f"/beatport/tracks/{track_id}")
    response.raise_for_status()
    return Track.model_validate(response.json())

# Sans await, l'expression est une Coroutine[Any, Any, Track]
```

### Points Importants

- **Une coroutine non attendue est inférée `Coroutine[Any, Any, Track]`** : c'est le type qui trahit un `await` oublié, et strict le signale
- `asyncio.Semaphore` et `asyncio.gather` sont typés : un `gather` sur des types hétérogènes rend un `list[Any]` qu'il vaut mieux décomposer
- Les callbacks passés à asyncio doivent être annotés comme les autres fonctions sous `disallow_untyped_defs`

---

## `py.typed` et dépendances

### Description

Un paquet qui livre un marqueur `py.typed` expose ses annotations. Toutes celles du projet le font.

### Points Importants

- **Aucun paquet `types-*` n'est nécessaire** : `--install-types` n'a pas d'usage ici
- **`ignore_missing_imports` ne doit pas être global** : mettre l'option en global masquerait la disparition future des types d'une dépendance. La réserver à un `[[tool.mypy.overrides]]` ciblé si le cas se présente
- Si une dépendance perd son `py.typed` à une montée de version, l'erreur doit être visible : c'est une information, pas une nuisance
- Pydantic fournit un plugin (`plugins = ["pydantic.mypy"]`) qui améliore le typage des modèles : pertinent si les modèles du protocole sont en Pydantic

---

# Commandes Clés

## Vérification

### Description

En local et en CI, toujours lancé par `uv run` pour rester dans le venv verrouillé.

### Syntaxe

```bash
uv run mypy src
uv run mypy --strict src
uv run mypy --no-incremental src           # ignore le cache, run reproductible
uv run mypy --cache-dir=.mypy_cache src    # emplacement explicite du cache
```

### Points Importants

- **`--strict` en ligne de commande fait doublon** avec `strict = true` dans `pyproject.toml` : choisir un seul endroit, de préférence la configuration
- `--no-incremental` sert à diagnostiquer un résultat suspect qui viendrait du cache
- **Un job CI éphémère peut mettre en cache `.mypy_cache`** entre runs pour gagner du temps, ou l'ignorer pour la reproductibilité : les deux se défendent
- Mypy 2.0 introduit `--num-workers` pour paralléliser la vérification

---

# Bonnes Pratiques

## ✅ Recommandations

- **Configurer `strict = true` dans `pyproject.toml`**, pas en flag de ligne de commande
- **Ajouter `warn_unreachable` explicitement**, il n'est pas couvert par `strict`
- **Fixer `python_version` sur la cible réelle** du sidecar
- **Laisser `ignore_missing_imports` désactivé** globalement, et le cibler par override si un cas apparaît
- **Lancer Mypy par `uv run`** pour garantir les mêmes versions qu'en CI
- **Traiter Ruff et Mypy comme complémentaires** : style et bugs locaux d'un côté, cohérence de types de l'autre

## ❌ Anti-Patterns

- **`ignore_missing_imports = true` en global** : masque la perte de types d'une dépendance
- **Copier une configuration Mypy 1.x** : plusieurs défauts ont changé en 2.0
- **Ajouter des `# type: ignore` sans code d'erreur** : `warn_unused_ignores` les signale, et un ignore trop large masque autre chose
- **Compter sur les tests pour valider les types** : ils ne couvrent que les chemins exécutés
- **Désactiver `strict` pour un module « compliqué »** sans le noter : la dette devient invisible
- **Annoter une fonction `async` par son type de coroutine** : c'est le type après `await` qui s'écrit

---

# 🔗 Ressources

## Documentation Officielle

- [Mypy](https://mypy.readthedocs.io/en/stable/)
- [Fichier de configuration](https://mypy.readthedocs.io/en/stable/config_file.html) · [Ligne de commande](https://mypy.readthedocs.io/en/stable/command_line.html)
- [Changelog](https://mypy.readthedocs.io/en/stable/changelog.html)
- [Paquets typés (PEP 561)](https://mypy.readthedocs.io/en/stable/installed_packages.html)

## Ressources Complémentaires

- [Plugin Mypy de Pydantic](https://docs.pydantic.dev/latest/integrations/mypy/)
- [ruff.md](ruff.md) — répartition des responsabilités
