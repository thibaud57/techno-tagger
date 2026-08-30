---
paths:
  - "sidecar/src/tagger/protocol.py"
  - "sidecar/src/tagger/plan.py"
  - "sidecar/src/tagger/scraper_client.py"
---

# Pydantic — Modèles & validation

## À faire
- `BaseModel` pour tout ce qui traverse une frontière : commandes et événements du protocole NDJSON, plan de run, rapports JSON
- `model_config = ConfigDict(extra="forbid", frozen=True)` sur les commandes entrantes — un champ inconnu est une commande malformée, pas un détail à ignorer
- `model_validate_json(ligne)` pour parser et valider en une passe, `model_dump_json()` pour émettre
- Convertir toute `ValidationError` en événement `error` portant un `code` stable et des `params` tirés de `.errors()` (`loc`, `type`)
- `Annotated[type, Field(...)]` pour les contraintes, factorisées en alias réutilisables plutôt que répétées champ par champ
- `default_factory` pour tout défaut mutable, jamais `default=[]`
- `@field_validator(..., mode="before")` pour normaliser une entrée brute, `@model_validator(mode="after")` pour les règles cross-champs
- Verrouiller les champs à valeurs fermées par `Literal` ou `StrEnum` (cf. [modeles-donnees.md](../python/modeles-donnees.md))
- Router la migration d'un plan de run versionné dans un `@model_validator(mode="before")` (cf. [ADR-018](../../../docs/adrs/018-versionnement-plan-de-run.md))

## À éviter
- `@validator`, `class Config`, `.dict()`, `.json()` — API v1, supprimée en v2
- `populate_by_name` : déprécié, remplacé par `validate_by_name` combiné à `validate_by_alias`
- Laisser la coercion lax sur les seuils et compteurs reçus de l'interface : poser `strict=True` sur le modèle ou le champ
- `champ: int | None` sans valeur par défaut en croyant le rendre optionnel — il reste requis, seulement nullable
- Tester un `field_validator` qui ne porte aucune règle métier : c'est du plumbing de librairie
- Laisser un message Pydantic remonter jusqu'à l'écran : le sidecar n'émet jamais de phrase destinée à l'utilisateur, l'interface traduit un `code`

## Gotchas
- `pydantic-core` est une extension native Rust, seconde extension du sidecar après rapidfuzz : à valider sur le binaire PyInstaller figé, jamais sur les seules sources
- `extra="ignore"` est le défaut : sans `forbid`, une commande portant un champ en trop passe silencieusement
- `model_dump(by_alias=True)` n'émet un alias que si le champ déclare `alias` ou `serialization_alias` ; un `validation_alias` seul garde le nom Python en sortie
- `model_dump_json()` produit une seule ligne, ce qu'exige NDJSON — ne jamais y ajouter `indent`
- Les types TypeScript sont maintenus à la main en miroir de `protocol.py` : tout changement de champ se répercute des deux côtés (cf. [ADR-005](../../../docs/adrs/005-sidecar-python-protocole-ndjson.md))

## Exemples
```python
# ✅ commande entrante : fermée, immuable, validée à la construction
class ResolveByUrl(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    track_id: str
    url: Annotated[str, Field(min_length=1)]

try:
    command = ResolveByUrl.model_validate_json(line)
except ValidationError as e:
    emit_error("malformed_command", {"errors": e.errors()})

# ❌ ouvert par défaut, message brut renvoyé à l'interface, défaut mutable partagé
class ResolveByUrl(BaseModel):
    track_id: str
    candidates: list[str] = []
```
