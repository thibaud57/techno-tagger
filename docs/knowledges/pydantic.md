---
title: "Pydantic — Modèles & validation du protocole"
version: "2.13.5"
description: "Référence technique pour Pydantic v2 dans le sidecar : modèles du protocole NDJSON, validation des commandes reçues sur stdin, migration du plan de run, frontière avec techno-scraper et empaquetage de pydantic-core."
date: "2026-08-30"
keywords: ["pydantic", "validation", "ndjson", "protocole", "pydantic-core", "mypy"]
scope: ["docs"]
technologies: ["Python", "PyInstaller", "Mypy", "pytest"]
---

# Description

Bibliothèque de validation de données par annotations de type, dont le cœur (`pydantic-core`) est écrit en Rust. Le sidecar l'utilise pour trois frontières, et seulement pour elles : les **commandes reçues sur `stdin`**, le **plan de run et les rapports** relus depuis le disque, et les **réponses de techno-scraper**.

Le point commun de ces trois frontières est qu'aucune donnée n'y est produite par le sidecar lui-même : elle vient de l'interface Angular, d'un fichier écrit par une version antérieure de l'application, ou d'une API qui n'est figée par aucun lockfile. C'est le périmètre où une validation runtime a une valeur, et ce qui la distingue des structures internes, qui restent des `dataclass` (cf. [ARCHITECTURE.md § Structure du Code](../ARCHITECTURE.md#-backend)).

**La v1 n'existe plus.** `@validator`, `class Config`, `.dict()` et `.json()` ont été remplacés en v2, et Pydantic V1 est incompatible avec Python 3.14 : tout exemple antérieur à 2023 trouvé en ligne est à retraduire avant usage.

---

# Concepts Clés

## Modèle fermé et immuable pour une commande entrante

### Description

Une commande arrive d'un process externe, elle est donc traitée comme non fiable. `extra="forbid"` rejette tout champ non déclaré au lieu de l'ignorer silencieusement, `frozen=True` interdit qu'un handler modifie la commande en cours de traitement, et `strict=True` coupe la coercition laxiste, qui accepterait `"3"` pour un seuil entier.

### Exemple

```python
# tagger/protocol.py
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field

class Command(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

class StartTagging(Command):
    type: Literal["start_tagging"]
    folder: str
    floor: Annotated[int, Field(ge=0, le=100)]
    ceiling: Annotated[int, Field(ge=0, le=100)]
```

### Points Importants

- `extra="ignore"` est le **défaut** : sans `forbid`, une commande portant un champ en trop passe sans un mot
- `frozen=True` rend aussi le modèle hashable, ce qui permet de l'utiliser en clé de cache
- `strict=True` se pose au niveau modèle, au niveau champ (`Field(strict=True)`) ou à l'appel (`model_validate(data, strict=True)`)
- Un champ `int | None` **sans valeur par défaut** reste requis, il est seulement nullable : c'est le piège le plus fréquent

---

## Valider une ligne NDJSON et traduire l'échec

### Description

`model_validate_json()` parse et valide en une seule passe, plus vite que `json.loads()` suivi d'une construction. L'échec lève une `ValidationError` dont `.errors()` rend une liste structurée (`loc`, `type`, `msg`, `input`) : c'est cette structure qui alimente les `params` de l'événement `error`, jamais le message rendu par Pydantic, qui n'est ni traduit ni traduisible côté interface.

### Exemple

```python
# tagger/__main__.py
from pydantic import TypeAdapter, ValidationError

COMMANDS = TypeAdapter(StartTagging | ResolveByUrl | CommitRun)  # union discriminée par `type`

for line in sys.stdin:
    try:
        command = COMMANDS.validate_json(line)
    except ValidationError as exc:
        emit_error("malformed_command", {"errors": exc.errors(include_url=False)})
        continue
    await dispatch(command)
```

### Points Importants

- Une commande malformée produit un événement `error` et **rien d'autre** : aucun effet de bord partiel
- `include_url=False` retire l'URL de documentation que Pydantic ajoute à chaque erreur, inutile dans un log
- Le champ `message` de l'événement reste technique et part dans `tagger.log`, l'interface affichant à partir du `code`
- Un `TypeAdapter` sur une union discriminée par `type` évite d'écrire le dispatch de parsing à la main

---

## Contraintes réutilisables par Annotated

### Description

`Annotated[type, Field(...)]` sépare le type de ses contraintes, ce qui rend le couple réutilisable et lisible par Mypy. Les contraintes métier récurrentes du sidecar (un score, un seuil, un identifiant non vide) se déclarent une fois et se réemploient, au lieu d'être réécrites champ par champ.

### Exemple

```python
# tagger/protocol.py
type Score = Annotated[float, Field(ge=0, le=100)]
type NonEmptyStr = Annotated[str, Field(min_length=1)]

class Candidate(BaseModel):
    track_id: NonEmptyStr
    artist_score: Score
    title_score: Score
    remixers: list[str] = Field(default_factory=list)
```

### Points Importants

- `default_factory` pour tout défaut mutable : un `default=[]` partagerait la liste entre toutes les instances
- Depuis 2.10, `default_factory` accepte un paramètre `data` et peut calculer un défaut à partir des champs déjà validés
- La syntaxe `type X = ...` (PEP 695) fonctionne et garde l'alias paresseux
- Les contraintes numériques (`gt`, `ge`, `lt`, `le`) et de chaîne (`min_length`, `pattern`) sont vérifiées dans le cœur Rust, pas en Python

---

## Validateurs de champ et de modèle

### Description

`@field_validator(..., mode="before")` reçoit la donnée brute et sert à normaliser avant coercition. `@model_validator(mode="after")` reçoit l'instance déjà construite et typée : c'est le point sûr pour les règles qui portent sur plusieurs champs à la fois, là où un validateur de champ dépendrait de l'ordre de déclaration.

### Exemple

```python
from typing import Self
from pydantic import field_validator, model_validator

class Thresholds(BaseModel):
    floor: Score
    ceiling: Score

    @field_validator("floor", "ceiling", mode="before")
    @classmethod
    def _accept_percent_string(cls, value: object) -> object:
        return value.rstrip("%") if isinstance(value, str) else value

    @model_validator(mode="after")
    def _floor_below_ceiling(self) -> Self:
        if self.floor > self.ceiling:
            raise ValueError("floor must not exceed ceiling")
        return self
```

### Points Importants

- Lever `ValueError`, jamais une exception applicative : Pydantic l'agrège dans la `ValidationError` avec la position du champ
- Un validateur `mode="after"` retourne toujours `self`, un validateur de champ retourne toujours la valeur
- `@field_validator` va systématiquement avec `@classmethod`, dans cet ordre
- Un validateur qui ne porte aucune règle métier du projet ne se teste pas : c'est du plumbing de librairie

---

## Sérialisation : une ligne par événement

### Description

`model_dump_json()` sérialise directement en chaîne JSON depuis le cœur Rust, sans dict intermédiaire. Le protocole NDJSON impose une ligne par événement, donc jamais d'`indent`. Les rapports écrits sur disque, eux, sont relus par des humains et acceptent une mise en forme.

### Exemple

```python
# flux NDJSON : compact, une ligne, flush explicite
sys.stdout.write(event.model_dump_json() + "\n")
sys.stdout.flush()

# rapport sur disque : lisible et déterministe
report_path.write_text(
    report.model_dump_json(indent=2, exclude_none=True),
    encoding="utf-8",
)
```

### Points Importants

- `exclude_none=True` allège un rapport, `exclude_unset=True` ne rend que ce qui a été explicitement fourni
- `model_dump(mode="json")` rend un dict aux types JSON-compatibles (`datetime` en ISO), contrairement au défaut `mode="python"`
- `@computed_field` expose une propriété calculée dans la sortie, et `exclude_if` (2.13) l'en retire selon un prédicat, sans post-traitement du dict
- Un `StrEnum` se sérialise en sa valeur primitive, ce qui rend les états du protocole lisibles côté TypeScript sans conversion

---

## Migration d'un plan de run versionné

### Description

Un plan de run écrit par une version antérieure de l'application doit rester relisible : c'est la contrainte de l'[ADR-018](../adrs/018-versionnement-plan-de-run.md), et c'est ce que sert la commande `load_run`. Un `@model_validator(mode="before")` est le point où la charge brute est remise à la forme courante, avant toute construction.

### Exemple

```python
class RunPlan(BaseModel):
    schema_version: int
    run_id: str
    tracks: list[PlannedTrack]

    @model_validator(mode="before")
    @classmethod
    def _migrate(cls, data: dict) -> dict:
        if data.get("schema_version", 1) < 2:
            data = {**data, "tracks": [rename_legacy_fields(t) for t in data["tracks"]]}
            data["schema_version"] = 2
        return data
```

### Points Importants

- Le `mode="before"` reçoit le dict brut : c'est le seul endroit où une charge d'une version antérieure existe encore
- Un plan illisible se rejette explicitement plutôt que de se réparer au jugé, un rattrapage partiel étant pire qu'un refus clair
- La migration est du code de production, donc testée : une régression y perd des runs interrompus

---

## Frontière avec techno-scraper

### Description

Les réponses de l'API sont validées à l'entrée puis mappées vers les modèles internes du sidecar. L'API n'étant figée par aucun lockfile, elle peut évoluer entre deux runs sans qu'aucune dépendance ne bouge : la validation protège de l'API elle-même, et le mapping empêche sa forme de fuir dans le code métier.

### Exemple

```python
# tagger/scraper_client.py
class ApiTrack(BaseModel):
    model_config = ConfigDict(extra="ignore")      # un champ ajouté en amont ne casse rien

    id: str
    name: str
    artists: list[ApiArtist]
    bpm: int | None = None

    def to_candidate(self) -> Candidate:
        return Candidate(track_id=self.id, title=self.name, ...)
```

### Points Importants

- `extra="ignore"` ici, `extra="forbid"` sur les commandes : la charge externe non maîtrisée s'étend, la charge interne doit rester fermée
- Un champ nul reste « champ non écrit » et jamais « champ à vider » : Bandcamp ne rend ni `bpm`, ni `key`, ni `genre`, ni `label`
- Le refetch par id avant écriture reste nécessaire, les objets rendus par `search` étant parfois abrégés

---

## Intégration à l'outillage

### Description

Pydantic se glisse dans deux gates du projet. Côté typage, il distribue un plugin Mypy qui apprend au checker à lire les modèles. Côté packaging, `pydantic-core` est une extension native, la seconde de la stack après rapidfuzz, donc un candidat au bug qui n'apparaît que dans le binaire figé.

### Exemple

```toml
# sidecar/pyproject.toml
[tool.mypy]
strict = true
warn_unreachable = true
plugins = ["pydantic.mypy"]
```

### Points Importants

- Le plugin génère la signature réelle d'`__init__`, produit un `model_construct` typé, vérifie les types de `default` et `default_factory`, et signale les champs non annotés
- `pydantic-core` publie des wheels `cp314` et `cp314t` pour `win_amd64` : rien à compiler sur le runner Windows
- `pyinstaller-hooks-contrib` livre un hook `pydantic` mis à jour pour la v2 : le cas nominal est couvert, la collecte se constate à l'exécution du binaire
- Pydantic livre un `py.typed`, aucun paquet `types-*` n'est requis (cf. [VERSIONS.md § Pydantic](../VERSIONS.md#3-pydantic))

---

# Bonnes Pratiques

## ✅ Recommandations

- Réserver `BaseModel` aux trois frontières (commandes, plan et rapports, réponses API) et laisser les structures internes en `dataclass(frozen=True, slots=True)`
- Fermer les commandes entrantes par `extra="forbid"` et laisser les réponses de l'API en `extra="ignore"`
- Verrouiller les champs d'état (`state`, `resolution`, `failure_reason`) par `Literal` ou `StrEnum`, jamais par un `str` libre
- Traduire toute `ValidationError` en événement `error` porteur d'un `code` stable, l'interface se chargeant du libellé
- Router les migrations de schéma dans un `@model_validator(mode="before")`, à un seul endroit par modèle versionné
- Tenir les types TypeScript de `core/models/` en miroir de `protocol.py` à chaque changement de champ, la génération de code ayant été écartée
- Valider un `model_validate_json()` sur le binaire PyInstaller, pas seulement sur les sources

## ❌ Anti-Patterns

- Reprendre du code v1 (`@validator`, `class Config`, `.dict()`, `.json()`) : il ne tourne pas, et il ne tournerait de toute façon pas sous Python 3.14
- Laisser un message d'erreur Pydantic atteindre l'écran : le sidecar n'émet jamais de phrase destinée à l'utilisateur
- `indent` sur un événement NDJSON : une ligne pretty-printée casse le protocole
- Écrire `champ: int | None` sans défaut en croyant rendre le champ optionnel
- Poser un `BaseModel` sur une structure purement interne : la validation à chaque construction se paie sans rien protéger
- Tester un validateur qui ne porte aucune règle métier : il casserait à une montée de version, pas à une régression du projet
- Compter sur la coercition laxiste pour absorber un seuil envoyé en chaîne par l'interface : c'est le contrat NDJSON qu'il faut corriger

---

# 🔗 Ressources

## Documentation Officielle

- [Pydantic — Documentation](https://pydantic.dev/docs/validation/latest/)
- [Pydantic — Changelog](https://pydantic.dev/docs/validation/latest/get-started/changelog/)
- [Pydantic — Plugin Mypy](https://pydantic.dev/docs/validation/latest/integrations/dev-tools/mypy/)
- [Pydantic — Alias (validate_by_name / validate_by_alias)](https://pydantic.dev/docs/validation/latest/concepts/alias/)

## Ressources Complémentaires

- [pydantic sur PyPI](https://pypi.org/project/pydantic/)
- [pydantic-core sur PyPI](https://pypi.org/project/pydantic-core/)
- [pyinstaller-hooks-contrib — hook pydantic v2 (PR #611)](https://github.com/pyinstaller/pyinstaller-hooks-contrib/pull/611)
