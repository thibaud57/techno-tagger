---
paths:
  - "sidecar/src/tagger/**/*.py"
---

# Python : modèles de données

## À faire
- `@dataclass(frozen=True, slots=True)` pour les structures purement internes, jamais désérialisées depuis l'extérieur ; tout ce qui traverse une frontière (commandes et événements du protocole NDJSON, plan de run, rapports JSON) est un `BaseModel`, une dataclass ne validant rien à la construction (cf. [pydantic/modeles.md](../pydantic/modeles.md))
- `StrEnum` + `auto()` pour les champs à valeurs fermées (`state`, `resolution`, `failure_reason`), partagés par les deux familles de modèles
- Porter l'état interne d'un morceau par une union de variantes : la fiche garde son identité à plat et son issue (`outcome`) en variante, chaque variante déclare ses champs et ses projections (`state`, `resolution`, `failure_reason`…). Protocole, plan et rapport restent à plat : ce sont des projections, jamais une seconde source
- `kw_only=True` dès que plusieurs champs du même type se suivent
- `copy.replace(obj, champ=...)` (3.13) pour dériver une copie modifiée d'une dataclass frozen
- `__post_init__` pour la validation d'invariant et les champs dérivés déclarés `field(init=False)`
- `NamedTuple` pour un retour multiple nommé et déstructurable
- `@verify(UNIQUE)` sur les enums d'état, pour interdire un alias silencieux

## À éviter
- Aplatir l'état d'un morceau en une seule valeur : trois champs distincts et non interchangeables (cf. [ARCHITECTURE.md § API](../../../docs/ARCHITECTURE.md#api))

## Gotchas
- Un `StrEnum` se sérialise tel quel, par `json.dumps` comme par `model_dump_json()`
- `@dataclass(slots=True)` recrée la classe : une référence capturée avant le décorateur ne pointe pas sur la classe finale
- 3.14 : évaluer `NotImplemented` dans un contexte booléen lève `TypeError`, un `__eq__` maison le retourne sans jamais le tester
- `@dataclass` et `NamedTuple` génèrent `__match_args__`, dont dépendent les patterns positionnels (cf. [type-hints.md](type-hints.md))
- `copy.replace` garde le paramètre générique de la dataclass et ne se type pas sur une union de dataclasses : changer d'issue passe par un constructeur dédié (`with_outcome`), rétrécir une fiche par un garde `TypeIs` (`holds`) plutôt que par une copie

## Exemples
```python
# ✅ enum partagé, structure interne immuable
class State(StrEnum):
    RESOLVED = auto()
    WRITE_ERROR = auto()

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
