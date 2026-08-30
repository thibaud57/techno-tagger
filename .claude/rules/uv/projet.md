---
paths:
  - "sidecar/pyproject.toml"
  - "sidecar/uv.lock"
  - "sidecar/.python-version"
---

# uv — Projet & dépendances

## À faire
- Tenir toute la configuration dans `pyproject.toml` : `[project]`, `[tool.uv]`, `[dependency-groups]`, `[tool.*]`
- Déclarer les outils de développement dans `[dependency-groups]` (PEP 735), jamais dans `[project.optional-dependencies]` réservé aux extras publiés
- Séparer les groupes `dev` et `build` : un job de test n'a pas besoin de PyInstaller
- Poser `package = true` pour installer le projet en editable, ce qui rend le sidecar importable sans manipuler `PYTHONPATH`
- Passer par la CLI pour toute dépendance : `uv add`, `uv add --dev`, `uv add --group build`, `uv remove`
- Committer `uv.lock` dans le même commit que le `pyproject.toml` modifié
- En CI : épingler le patch exact d'uv (la compatibilité du lock n'est garantie qu'au sein d'une mineure), installer par `uv sync --frozen --all-groups`, et poser `uv lock --check` au pipeline pour détecter un `pyproject.toml` modifié sans re-lock
- Lancer tous les outils par `uv run`, PyInstaller compris : c'est ce qui garantit le venv verrouillé
- Fixer l'interpréteur par `uv python pin`, en gardant `.python-version` dans la plage de `requires-python`

## À éviter
- Éditer `uv.lock` à la main : il se régénère, il ne se corrige pas
- `uv sync` nu en CI : une re-résolution silencieuse rend le build non reproductible
- Épingler uv sur une plage ou sur `latest` : un bump mineur peut rejeter le lock commité
- Lancer un outil du projet hors de `uv run`, ou par `uvx` : il viendrait d'un autre environnement ou d'un environnement éphémère, dans les deux cas non verrouillé
- Confondre `.python-version` (préférence locale) et `requires-python` (contrat du projet)
- Créer un venv manuellement à côté de celui géré par uv, ou utiliser `pip`, `venv` ou `poetry` en parallèle

## Gotchas
- Le format d'`uv.lock` fait partie de l'API publique d'uv et ne peut être rejeté qu'entre versions mineures
- uv préfère les versions déjà verrouillées : une nouvelle version en amont ne périme pas le lockfile tant que les contraintes sont satisfaites, il n'y a pas d'upgrade implicite
- `--frozen` n'inspecte même pas la fraîcheur du lock (aucun accès réseau), là où `--locked` échoue explicitement en cas de dérive : choisir selon qu'on veut subir ou détecter
- 0.12 : `uv run` découvre le projet relativement au script passé, plus au répertoire courant
- `uv remove` retire aussi les transitives devenues orphelines : le lock rétrécit, c'est normal
- `uv sync` supprime les paquets absents du lock, sauf avec `--inexact`
- `uv build` produit sdist et wheel, pas le binaire du sidecar : c'est PyInstaller, lancé par `uv run` (cf. [pyinstaller/build.md](../pyinstaller/build.md))
- L'interpréteur installé par uv est celui qu'embarquera PyInstaller : sa version décide des wheels utilisées
