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
- Restreindre les champs d'état du protocole (`state`, `resolution`, `failure_reason`) par `Literal`, et fermer les `match` correspondants par `assert_never`
- Déclarer un `Protocol` pour un contrat consommé (client HTTP, backend de cache) plutôt qu'une classe de base à hériter
- Marquer `@override` sur toute redéfinition, `Final` sur les constantes, `ClassVar` sur les attributs de classe

## À éviter
- `Any` : il se propage et éteint le contrôle en cascade — préférer `object` + narrowing, un `Protocol` ou un generic
- `from __future__ import annotations` — inutile en 3.14, et force encore le mode STRING qui masque les vrais objets
- `typing.List` / `Dict` / `Tuple` / `Optional` / `Union` — dépréciés
- `# type: ignore` nu : toujours avec le code d'erreur entre crochets
- `cast()` pour faire taire le checker — il n'affirme rien au runtime

## Gotchas
- Mypy 2.0 : `--strict-bytes` par défaut, `bytearray` et `memoryview` ne sont plus assignables à `bytes` (concerne les blobs d'artwork et les transports mockés)
- Mypy 2.3 : un attribut d'instance déclaré `Final` devient read-only **à l'exécution**, pas seulement statiquement
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
