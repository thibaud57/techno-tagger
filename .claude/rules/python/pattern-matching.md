---
paths:
  - "sidecar/src/tagger/__main__.py"
---

# Python Pattern Matching — Règles

## À faire
- Dispatcher les commandes reçues sur `stdin` par `match` / `case` sur des mapping patterns, une clause par commande
- Terminer par un `case _:` qui produit une erreur explicite, jamais un passage silencieux, tout `match` qui **dispatche une entrée externe** (commande NDJSON, événement). Sur un parcours normalisant au contraire, un `case _` qui rend la valeur inchangée est le comportement correct : c'est le cas de `_mask_deep`, dont le SDK Sentry a déjà réduit l'entrée à des scalaires
- Qualifier toute valeur comparée (`case Source.BEATPORT:`), sinon c'est une capture
- Regrouper les alternatives par OR pattern (`case "resume_run" | "discard_run":`)
- Poser les conditions non structurelles en guard `if` derrière le pattern
- Matcher les dataclasses du protocole par class patterns plutôt que par une chaîne de `isinstance`

## À éviter
- `case CONSTANTE:` avec un nom nu : c'est un capture pattern, il matche tout et écrase le nom
- Un `match` sans cas par défaut sur une entrée externe — il tombe sans lever
- Un sequence pattern pour matcher une chaîne : `str`, `bytes` et `bytearray` en sont exclus

## Gotchas
- Un mapping pattern matche par présence de clés, les clés en trop sont ignorées : `case {}:` matche n'importe quel dict, y compris non vide
- Un pattern positionnel exige `__match_args__`, généré par `@dataclass` et `NamedTuple`, sinon `TypeError`
- Les sous-patterns d'un OR doivent capturer exactement les mêmes noms

## Exemples
```python
# ✅
match command:
    case {"type": "resolve_by_url", "track_id": track_id, "url": url}:
        await resolve_by_url(track_id, url)
    case {"type": "resume_run" | "discard_run" as action, "plan_id": plan_id}:
        await handle_plan(action, plan_id)
    case _:
        emit_error("unknown_command", {"payload": command})

# ❌ nom nu = capture qui matche tout et écrase RESOLVE_BY_URL
match command["type"]:
    case RESOLVE_BY_URL:
        ...
```
