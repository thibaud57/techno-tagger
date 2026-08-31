---
paths:
  - "sidecar/src/tagger/**/*.py"
---

# Python Imports & Modules — Règles

## À faire
- Imports absolus depuis `tagger.` par défaut, relatifs (`from .cache import ...`) seulement à l'intérieur d'un sous-package
- Garder `protocol.py` comme seule interface publique du sidecar, tout le reste étant appelé depuis la boucle de `__main__.py`
- Déclarer la surface publique d'un package par `__all__` dans son `__init__.py`
- Lancer le sidecar par `python -m tagger`, jamais par chemin de fichier : le mode fichier casse les imports relatifs
- Casser un cycle d'imports en extrayant le code partagé dans un troisième module
- Importer sous `if TYPE_CHECKING:` ce qui ne sert qu'aux annotations

## À éviter
- `import *` hors REPL
- Manipuler `sys.path` à la main : le package est installé et résolu par `uv sync`
- Oublier un `__init__.py` — le dossier devient un namespace package (PEP 420) et masque des erreurs d'import
- Un import différé posé pour contourner un cycle sans corriger le découpage

## Gotchas
- `ImportError: cannot import name X from partially initialized module` désigne un import circulaire, pas un symbole manquant
- Le code top-level d'un module ne s'exécute qu'une fois, au premier import : y placer un effet de bord vaut singleton implicite
- PyInstaller n'analyse que les imports statiques : tout import dynamique se déclare en `--hidden-import` (cf. [build.md](../pyinstaller/build.md))

## Exemples
```python
# ✅ façade : le sous-package expose ce qui est stable, pas son découpage interne
# tagger/playlists/__init__.py
from .m3u8 import parse_m3u8
from .vlc import list_playlists, extract_playlist

__all__ = ["parse_m3u8", "list_playlists", "extract_playlist"]

# ✅ import différé : le cycle est cassé à l'appel, le module est alors complet
def build_report(run):
    from .plan import load_plan
    return render(load_plan(run.id))

# ❌ chemin absolu reconstruit à la main
sys.path.insert(0, str(Path(__file__).parent.parent))
from tagger.protocol import Command
```
