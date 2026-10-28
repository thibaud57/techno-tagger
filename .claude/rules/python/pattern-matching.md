---
paths:
  - "sidecar/src/tagger/**/*.py"
---

# Python : pattern matching

## À faire
- Dispatcher les commandes reçues sur `stdin` par `match` sur le modèle déjà validé (union discriminée parsée par `TypeAdapter`, cf. [ADR-022](../../../docs/adrs/022-modeles-pydantic-du-protocole.md)), une clause class pattern par commande : `case GetVersion():`
- Fermer par `case _: assert_never(x)` tout `match` sur une union fermée (commande, variante d'issue) : l'oubli d'une clause devient une erreur de typage. Sur un parcours normalisant, un `case _` qui rend la valeur inchangée est correct
- Qualifier toute valeur comparée (`case Source.BEATPORT:`), sinon c'est une capture
- Regrouper les alternatives par OR pattern (`case ResumeRun() | DiscardRun():`)
- Poser les conditions non structurelles en guard `if` derrière le pattern
- Matcher les modèles par class patterns plutôt que par une chaîne de `isinstance`

## À éviter
- Un mapping pattern sur le `dict` brut d'une commande : la validation à la frontière est faite par Pydantic, le cœur ne reçoit que des modèles
- `case CONSTANTE:` avec un nom nu : c'est un capture pattern, il matche tout et écrase le nom
- Un sequence pattern pour matcher une chaîne : `str`, `bytes` et `bytearray` en sont exclus

## Gotchas
- Un pattern positionnel exige `__match_args__`, généré par `@dataclass` et `NamedTuple` mais pas par `BaseModel` : sur un modèle Pydantic, matcher par mot-clé (`case Progress(current=n):`)
- Seuls les builtins (`int`, `str`, `float`, `bool`…) acceptent un unique pattern positionnel sans `__match_args__` : `case int(n):` capture la valeur entière
- Les sous-patterns d'un OR doivent capturer exactement les mêmes noms

## Exemples
```python
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
