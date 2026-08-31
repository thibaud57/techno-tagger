---
paths:
  - "sidecar/src/tagger/**/*.py"
---

# Python Modèles de Données — Règles

## À faire
- `@dataclass(frozen=True, slots=True)` pour les structures purement internes, jamais désérialisées depuis l'extérieur ; tout ce qui traverse une frontière est un `BaseModel` (cf. [pydantic/modeles.md](../pydantic/modeles.md))
- `StrEnum` + `auto()` pour les champs à valeurs fermées (`state`, `resolution`, `failure_reason`), partagés par les deux familles de modèles
- `field(default_factory=...)` pour tout défaut mutable
- `__post_init__` pour la validation d'invariant et les champs dérivés déclarés `field(init=False)`
- `NamedTuple` pour un retour multiple nommé et déstructurable
- Définir `__repr__` sur tout objet métier écrit hors dataclass
- `@verify(UNIQUE)` sur les enums d'état, pour interdire un alias silencieux

## À éviter
- Aplatir l'état d'un morceau en une seule valeur : trois champs distincts et non interchangeables (cf. [ARCHITECTURE.md § API](../../../docs/ARCHITECTURE.md#api))
- Une dataclass pour un modèle du protocole : rien n'est validé à la construction, une charge malformée passe
- `TypedDict` pour une entrée externe : à l'exécution ce n'est qu'un `dict`, sans validation
- Un attribut de classe mutable — partagé par toutes les instances
- Définir `__eq__` sans redéfinir `__hash__` : l'objet devient non hashable

## Gotchas
- 3.11+ : `str()` et `format()` d'un `StrEnum` / `IntEnum` rendent la valeur primitive, plus `NomEnum.MEMBRE` — un test qui parsait l'ancien format casse
- Un `StrEnum` se sérialise tel quel, par `json.dumps` comme par `model_dump_json()`
- `@dataclass(slots=True)` recrée la classe : une référence capturée avant le décorateur ne pointe pas sur la classe finale
- `@dataclass` et `NamedTuple` génèrent `__match_args__`, dont dépendent les patterns positionnels (cf. [pattern-matching.md](pattern-matching.md))

## Exemples
```python
# ✅ enum partagé, structure interne immuable
class State(StrEnum):
    RESOLVED = auto()      # "resolved"
    WRITE_ERROR = auto()   # "write_error"

@dataclass(frozen=True, slots=True)
class ScoredCandidate:
    candidate: Candidate
    score: float

# ❌ défaut mutable, état plat, modèle de protocole sans validation
@dataclass
class TrackResolved:
    track_id: str
    status: str = "ok"
    candidates: list = []
```
