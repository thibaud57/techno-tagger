---
paths:
  - "sidecar/pyproject.toml"
  - "sidecar/uv.lock"
  - ".github/actions/setup-uv/action.yml"
---

# uv : lockfile et synchronisation

## À faire
- Committer `uv.lock` dans le même commit que le `pyproject.toml` modifié
- En CI : `setup-uv` sans `version` dans l'action composite `.github/actions/setup-uv` (`version-file: sidecar/pyproject.toml`, le pyproject n'est pas à la racine), installer par `uv sync --locked --all-groups`

## À éviter
- Éditer `uv.lock` à la main : il se régénère, il ne se corrige pas
- `uv sync` nu en CI : une re-résolution silencieuse rend le build non reproductible
- Lancer un outil du projet hors de `uv run`, ou par `uvx` : il viendrait d'un autre environnement ou d'un environnement éphémère, dans les deux cas non verrouillé

## Gotchas
- Le format d'`uv.lock` fait partie de l'API publique d'uv et ne peut être rejeté qu'entre versions mineures
- uv préfère les versions déjà verrouillées : une nouvelle version en amont ne périme pas le lockfile tant que les contraintes sont satisfaites, il n'y a pas d'upgrade implicite
- `--frozen` n'inspecte même pas la fraîcheur du lock (aucun accès réseau), là où `--locked` échoue explicitement en cas de dérive : choisir selon qu'on veut subir ou détecter
- `uv remove` retire aussi les transitives devenues orphelines : le lock rétrécit, c'est normal
- `uv sync` supprime les paquets absents du lock, sauf avec `--inexact`
