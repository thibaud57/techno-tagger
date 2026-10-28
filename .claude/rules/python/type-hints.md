---
paths:
  - "sidecar/src/tagger/**/*.py"
  - "sidecar/tests/**/*.py"
---

# Python : type hints

## À faire
- Valider toute charge JSON entrante par un `BaseModel` (cf. [pydantic/modeles.md](../pydantic/modeles.md)) ; `TypedDict` reste réservé à la forme d'un dict interne jamais instancié
- Fermer par `assert_never` les `match` sur les champs d'état du protocole (`state`, `resolution`, `failure_reason`, cf. [modeles-donnees.md](modeles-donnees.md) pour leur type `StrEnum`) comme sur les unions de variantes (issue d'un morceau, classement d'une source)
- Déclarer un `Protocol` pour un contrat consommé (client HTTP, backend de cache) plutôt qu'une classe de base à hériter
- Marquer `@override` sur toute redéfinition, `Final` sur les constantes, `ClassVar` sur les attributs de classe et `Self` comme retour d'une méthode qui rend sa propre instance (`__aenter__`, constructeur alternatif)
- Lire les annotations d'un objet par `annotationlib.get_annotations()` ou `typing.get_type_hints()`, jamais par `__annotations__` brut

## À éviter
- `from __future__ import annotations` : inutile en 3.14 et force encore le mode STRING qui masque les vrais objets
- `cast()` pour faire taire le checker : il n'affirme rien au runtime

## Gotchas
- Mypy 2.0 : `--strict-bytes` par défaut, `bytearray` et `memoryview` ne sont plus assignables à `bytes` (concerne les blobs d'artwork et les transports mockés)
- Mypy 2.4 : un commentaire de type `# type:` sur un `for` ou un `with` est ignoré sans erreur, le type est inféré : annoter la variable avant l'instruction
- PEP 649 (3.14) : les annotations sont évaluées paresseusement, les forward refs fonctionnent sans guillemets

## Exemples
```python
# ✅
type Pair[T] = tuple[T, T]

def best[T](candidates: list[T], key: Callable[[T], float]) -> T | None: ...

class SupportsSearch(Protocol):
    async def search(self, query: str) -> list[Candidate]: ...

# ❌
from __future__ import annotations

def best(candidates: List[Any], key) -> Optional[Any]:  # type: ignore
    ...
```
