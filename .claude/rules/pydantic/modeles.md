---
paths:
  - "sidecar/src/tagger/__main__.py"
  - "sidecar/src/tagger/protocol.py"
  - "sidecar/src/tagger/handlers.py"
  - "sidecar/src/tagger/translation.py"
  - "sidecar/src/tagger/core/models.py"
  - "sidecar/src/tagger/core/run_files.py"
  - "sidecar/src/tagger/playlists/models.py"
  - "sidecar/src/tagger/reports/*.py"
  - "sidecar/src/tagger/resolution/scraper_client.py"
  - "sidecar/src/tagger/run/plan.py"
  - "sidecar/src/tagger/tags/tag_dump.py"
---

# Pydantic : modèles et validation

## À faire
- `BaseModel` pour tout ce qui traverse une frontière : commandes et événements du protocole NDJSON, plan de run, rapports JSON
- `model_config = ConfigDict(extra="forbid", frozen=True)` sur les commandes entrantes : un champ inconnu est une commande malformée, pas un détail à ignorer
- Laisser `extra="ignore"` (le défaut) sur les réponses de techno-scraper : un champ ajouté côté API ne doit pas casser un run (cf. [ADR-022](../../../docs/adrs/022-modeles-pydantic-du-protocole.md))
- `model_validate_json(ligne)` pour parser et valider en une passe, `model_dump_json()` pour émettre
- Convertir toute `ValidationError` en événement `error` portant un `code` stable et des `params` réduits à `loc` et `type` de chaque `.errors()` : `input` renverrait le payload (chemins, titres) et `ctx` peut porter un objet non sérialisable
- Poser `frozen=True` aussi sur les événements émis : un événement construit ne change plus
- Construire un modèle depuis un objet à attributs (dataclass interne) par `model_validate(obj, from_attributes=True)` et un document dont la racine n'est pas un objet (liste de l'API) par `RootModel[T]`
- `Annotated[type, Field(...)]` pour les contraintes, factorisées en alias réutilisables plutôt que répétées champ par champ
- `default_factory` pour tout défaut mutable : Pydantic copie un `default=[]` à chaque instance, mais la même écriture partage la liste dans une dataclass, un seul style évite de confondre les deux
- `@field_validator(..., mode="before")` pour normaliser une entrée brute, `@model_validator(mode="after")` pour les règles cross-champs, qui retourne `self`
- Verrouiller les champs à valeurs fermées par `Literal` ou `StrEnum`
- Router la migration d'un rapport versionné dans un `@model_validator(mode="before")` ; un plan de run d'une version inconnue est refusé, jamais migré (cf. [ADR-018](../../../docs/adrs/018-versionnement-plan-de-run.md))

## À éviter
- `@validator`, `class Config`, `.dict()`, `.json()` : API v1, dépréciée en v2
- Laisser la coercion lax sur les seuils et compteurs reçus de l'interface : poser `strict=True` sur le modèle ou le champ
- `champ: int | None` sans valeur par défaut en croyant le rendre optionnel : il reste requis, seulement nullable
- Laisser un message Pydantic remonter jusqu'à l'écran : le sidecar n'émet jamais de phrase destinée à l'utilisateur, l'interface traduit un `code`

## Gotchas
- `pydantic-core` est une extension native Rust, seconde extension du sidecar après rapidfuzz : à valider sur le binaire PyInstaller figé, jamais sur les seules sources
- `extra="ignore"` est le défaut : sans `forbid`, une commande portant un champ en trop passe silencieusement
- `model_dump_json()` produit une seule ligne, ce qu'exige NDJSON : jamais d'`indent` sur le flux, seulement dans un rapport déposé en fichier
- Les types TypeScript sont maintenus à la main en miroir de `protocol.py` : tout changement de nom de champ, de valeur d'énumération ou de code d'erreur interprété se répercute des deux côtés, sinon `test_protocol_mirror.py` échoue (types et optionalité non comparés)
- `strict=True` garde quelques coercions sûres : un `int` reste accepté pour un champ `float`
- 2.14 : `model_config` n'est plus muté après la définition de la classe et `ser_json_timedelta` ne s'applique plus aux autres types date en sérialisation inférée

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
    errors = [{"loc": list(err["loc"]), "type": err["type"]} for err in e.errors()]
    emit_error("malformed_command", {"errors": errors})

# ❌ ouvert par défaut : un champ inconnu passe silencieusement
class ResolveByUrl(BaseModel):
    track_id: str
```
