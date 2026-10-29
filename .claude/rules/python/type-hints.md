---
paths:
  - "sidecar/src/tagger/**/*.py"
  - "sidecar/tests/**/*.py"
---

# Python : type hints et pattern matching

## À faire
- Valider toute charge JSON entrante par un `BaseModel` (cf. [pydantic/modeles.md](../pydantic/modeles.md)) ; `TypedDict` reste réservé à la forme d'un dict interne jamais instancié
- Dispatcher les commandes reçues sur `stdin` par `match` sur le modèle déjà validé (union discriminée parsée par `TypeAdapter`, cf. [ADR-022](../../../docs/adrs/022-modeles-pydantic-du-protocole.md)), une clause class pattern par commande : `case GetVersion():`
- Fermer par `case _: assert_never(x)` les `match` sur les champs d'état du protocole (`state`, `resolution`, `failure_reason`, cf. [modeles-donnees.md](modeles-donnees.md) pour leur type `StrEnum`) comme sur les unions de variantes (commande, issue d'un morceau, classement d'une source) : l'oubli d'une clause devient une erreur de typage. Sur un parcours normalisant, un `case _` qui rend la valeur inchangée est correct
- Marquer `@override` sur toute redéfinition, `Final` sur les constantes, `ClassVar` sur les attributs de classe et `Self` comme retour d'une méthode qui rend sa propre instance (`__aenter__`, constructeur alternatif)
- Lire les annotations d'un objet par `annotationlib.get_annotations()` ou `typing.get_type_hints()`, jamais par `__annotations__` brut
- Qualifier toute valeur comparée (`case Source.BEATPORT:`), sinon c'est une capture
- Regrouper les alternatives par OR pattern (`case ResumeRun() | DiscardRun():`)
- Poser les conditions non structurelles en guard `if` derrière le pattern
- Matcher les modèles par class patterns plutôt que par une chaîne de `isinstance`

## À éviter
- `from __future__ import annotations` : inutile en 3.14 et force encore le mode STRING qui masque les vrais objets
- `cast()` pour faire taire le checker : il n'affirme rien au runtime
- Un mapping pattern sur le `dict` brut d'une commande : la validation à la frontière est faite par Pydantic, le cœur ne reçoit que des modèles
- `case CONSTANTE:` avec un nom nu : c'est un capture pattern, il matche tout et écrase le nom
- Un sequence pattern pour matcher une chaîne : `str`, `bytes` et `bytearray` en sont exclus

## Gotchas
- Mypy 2.0 : `--strict-bytes` par défaut, `bytearray` et `memoryview` ne sont plus assignables à `bytes` (concerne les blobs d'artwork et les transports mockés)
- Mypy 2.4 : un commentaire de type `# type:` sur un `for` ou un `with` est ignoré sans erreur, le type est inféré : annoter la variable avant l'instruction
- PEP 649 (3.14) : les annotations sont évaluées paresseusement, les forward refs fonctionnent sans guillemets
- Un pattern positionnel exige `__match_args__`, généré par `@dataclass` et `NamedTuple` mais pas par `BaseModel` : sur un modèle Pydantic, matcher par mot-clé (`case Progress(current=n):`)
- Seuls les builtins (`int`, `str`, `float`, `bool`…) acceptent un unique pattern positionnel sans `__match_args__` : `case int(n):` capture la valeur entière
- Les sous-patterns d'un OR doivent capturer exactement les mêmes noms

## Exemples
```python
# ✅
type Pair[T] = tuple[T, T]

def best[T](candidates: list[T], key: Callable[[T], float]) -> T | None: ...

# ❌
from __future__ import annotations

def best(candidates: List[Any], key) -> Optional[Any]:  # type: ignore
    ...

# ✅ modèle validé, une clause par variante, exhaustivité au typage
match command:
    case ResolveByUrl(track_id=track_id, url=url):
        await resolve_by_url(track_id, url)
    case ResumeRun() | DiscardRun():
        await handle_plan(command)
    case _:
        assert_never(command)

# ❌ nom nu = capture qui matche tout et écrase RESOLVE_BY_URL
match command_name:
    case RESOLVE_BY_URL:
        ...
```
