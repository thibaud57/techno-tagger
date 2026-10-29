---
paths:
  - "sidecar/pyproject.toml"
  - "sidecar/uv.lock"
  - "sidecar/.python-version"
---

# uv : projet et dépendances

## À faire
- Tenir toute la configuration dans `pyproject.toml` : `[project]`, `[tool.uv]`, `[dependency-groups]`, `[tool.*]`
- Déclarer les outils de développement dans `[dependency-groups]` (PEP 735), jamais dans `[project.optional-dependencies]` réservé aux extras publiés
- Séparer les groupes `dev` et `build` : un job de test n'a pas besoin de PyInstaller
- Poser `required-version` sous `[tool.uv]` sur la mineure d'uv : seule source de la version, uv refuse de tourner hors plage sur le poste et `setup-uv` la lit en CI. À monter avec `uv_build`
- Poser `package = true` pour installer le projet en editable, ce qui rend le sidecar importable sans manipuler `PYTHONPATH`
- Ajouter un outil de développement par `uv add --dev` et une dépendance de packaging par `uv add --group build`
- Borner `uv_build` dans `[build-system]` sur la même mineure que `required-version` : `test_main.py` le garde
- Fixer l'interpréteur par `uv python pin`, en gardant `.python-version` dans la plage de `requires-python`

## À éviter
- Laisser uv sans `required-version` ou sur `latest` : un bump mineur peut rejeter le lock commité. Un `version` sur `setup-uv` dupliquerait le pyproject et divergerait à la montée suivante
- Confondre `.python-version` (préférence locale) et `requires-python` (contrat du projet)
- Créer un venv manuellement à côté de celui géré par uv, ou utiliser `pip`, `venv` ou `poetry` en parallèle

## Gotchas
- Depuis 0.12.16, le backend `uv_build` embarqué ne sert que si sa version satisfait la plage de `[build-system]` : un uv plus ancien que le plancher retélécharge le backend depuis l'index à chaque build
- `uv build` produit sdist et wheel, pas le binaire du sidecar : c'est PyInstaller, lancé par `uv run` (cf. [pyinstaller/build.md](../pyinstaller/build.md))
- L'interpréteur installé par uv est celui qu'embarquera PyInstaller : sa version décide des wheels utilisées
