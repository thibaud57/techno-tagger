---
paths:
  - "sidecar/src/tagger/**/*.py"
  - "sidecar/tests/**/*.py"
---

# Python Type Hints — Règles

## À faire
- Annoter tous les paramètres et retours : `mypy` en mode strict plus `warn_unreachable` est un gate CI bloquant
- Utiliser les génériques natifs (`list[str]`, `dict[str, int]`, `tuple[int, ...]`) et `X | None`
- Déclarer les type parameters en syntaxe inline PEP 695 : `def first[T](...)`, `type Candidates = list[Candidate]`
- Valider toute charge JSON entrante par un `BaseModel` (cf. [pydantic/modeles.md](../pydantic/modeles.md)) ; `TypedDict` reste réservé à la forme d'un dict interne jamais instancié
- Fermer les `match` sur les champs d'état du protocole (`state`, `resolution`, `failure_reason`, cf. [python/modeles-donnees.md](modeles-donnees.md) pour leur type `StrEnum`) par `assert_never`
- Déclarer un `Protocol` pour un contrat consommé (client HTTP, backend de cache) plutôt qu'une classe de base à hériter
- Marquer `@override` sur toute redéfinition, `Final` sur les constantes, `ClassVar` sur les attributs de classe, et `Self` comme retour d'une méthode qui rend sa propre instance (`__aenter__`, constructeur alternatif)
- Lire les annotations d'un objet par `annotationlib.get_annotations()` ou `typing.get_type_hints()`, jamais par `__annotations__` brut

## À éviter
- `Any` : il se propage et éteint le contrôle en cascade (préférer `object` + narrowing, un `Protocol` ou un generic)
- `from __future__ import annotations` : inutile en 3.14, et force encore le mode STRING qui masque les vrais objets
- `typing.List` / `Dict` / `Tuple` / `Optional` / `Union` : dépréciés
- `# type: ignore` nu : toujours avec le code d'erreur entre crochets
- `cast()` pour faire taire le checker : il n'affirme rien au runtime

## Gotchas
- Mypy 2.0 : `--strict-bytes` par défaut, `bytearray` et `memoryview` ne sont plus assignables à `bytes` (concerne les blobs d'artwork et les transports mockés)
- Mypy 2.4 : le parser natif (basé sur celui de Ruff) devient le défaut ; `native_parser = false` rétablit l'ancien jusqu'à son retrait annoncé début 2027
- Mypy 2.4 : un commentaire de type `# type:` sur un `for` ou un `with` est ignoré sans erreur, le type est inféré : annoter la variable avant l'instruction
- Aucune dépendance du sidecar n'exige de stub externe : ni paquet `types-*`, ni `ignore_missing_imports` (cf. [VERSIONS.md § Mypy](../../../docs/VERSIONS.md#12-mypy))
- PEP 649 (3.14) : les annotations sont évaluées paresseusement, les forward refs fonctionnent sans guillemets

## Exemples
```python
# ✅
type FailureReason = Literal["empty_query", "no_result", "below_threshold"]

def best[T](candidates: list[T], key: Callable[[T], float]) -> T | None: ...

class SupportsSearch(Protocol):
    async def search(self, query: str) -> list[Candidate]: ...

# ❌
from __future__ import annotations

def best(candidates: List[Any], key) -> Optional[Any]:  # type: ignore
    ...
```
