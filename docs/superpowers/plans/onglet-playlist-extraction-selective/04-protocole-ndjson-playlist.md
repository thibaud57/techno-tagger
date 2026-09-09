# Protocole NDJSON de l'extraction par playlist — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Figer et exposer sur les flux standard le contrat NDJSON des commandes et événements de l'extraction par playlist.

**Architecture:** `protocol.py` déclare les modèles Pydantic et rien d'autre, `handlers.py` exécute une commande validée en appelant le métier, `__main__.py` porte le moteur asynchrone et le routage. La boucle lit `stdin` par `asyncio.to_thread`, la lecture asynchrone native étant impossible sous Windows, ce qui laisse les événements `progress` partir pendant qu'une commande bloquante est traitée.

**Tech Stack:** Python 3.14, pydantic 2.13, asyncio, pytest, Mypy strict, Ruff.

**Spec:** `docs/superpowers/specs/onglet-playlist-extraction-selective/04-protocole-ndjson-playlist-design.md`

## Global Constraints

- **Dépendances aux sub-projects 01 à 03** : `tagger/errors.py`, `tagger/playlists/`, `tagger/extraction.py` et `tagger/reports.py` existent déjà. Ne pas les recréer.
- **`__main__.py` est déjà écrit et testé** : `log_dir()`, `_force_utf8_streams()` et l'amorçage de `main()` sont conservés tels quels. Seule la boucle finale marquée `# TODO: implement` est remplacée.
- **Toujours `model_validate_json`, jamais `model_validate`** : en mode strict, une chaîne JSON est convertie en `Path` et en `StrEnum`, mais un `dict` Python ne l'est pas et échoue sur `is_instance_of`. Vérifié à l'exécution.
- **Commandes entrantes fermées** : `model_config = ConfigDict(extra="forbid", frozen=True, strict=True)`.
- **`stdout` ne porte que des événements**, une ligne chacun, sans `indent`. Diagnostics sur `stderr` et dans le log tournant. Le `line_buffering` posé par `_force_utf8_streams()` dispense de flusher.
- **Aucun message destiné à l'utilisateur ne sort du sidecar** : l'événement `error` porte un `code` stable et des `params`, l'interface traduit.
- **`asyncio.get_event_loop()` est banni** par la configuration Ruff du projet, la CI échoue dessus. Entrer par `asyncio.run`.
- **Tout appel bloquant passe par `asyncio.to_thread`** : lecture SQLite, parcours du dossier source, copie de fichiers, écriture du rapport (cf. `.claude/rules/python/asyncio.md`).
- **Gate qualité vert à chaque commit** : `just test` (couverture bloquante à 80 %), `just lint`, `just typecheck`.
- **Convention de commit** : `type(scope): description`, scope `sidecar`.
- **Typage complet** : Mypy strict, `Final` sur les constantes, imports d'annotation seule sous `if TYPE_CHECKING:`, lignes à 100 caractères maximum.
- **Codes d'erreur en `snake_case` plat**, sans préfixe de domaine : `vlc_schema_mismatch`, `playlist_not_found`, `malformed_command`, comme les exemples d'ARCHITECTURE.md § API et de `.claude/rules/python/gestion-erreurs.md`. C'est la clé que l'interface traduit sous `errors.<code>`.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `sidecar/src/tagger/protocol.py` | Modèles Pydantic des commandes et des événements, unions discriminées, parsing d'une ligne. Seule interface publique du sidecar, aucune logique. |
| `sidecar/src/tagger/handlers.py` | Une fonction par commande, du modèle validé au métier puis à l'événement. Testable sans lancer la boucle. |
| `sidecar/src/tagger/__main__.py` | Moteur asynchrone, lecture de `stdin`, routage vers les handlers, émission sur `stdout`. |
| `sidecar/tests/unit/test_protocol_models.py` | Validation des commandes, sérialisation des événements. |
| `sidecar/tests/integration/test_ndjson_loop.py` | Bout en bout par injection sur `stdin`. |

---

## Task 1: Modèles de commandes

**Files:**
- Modify: `sidecar/src/tagger/protocol.py` (remplace le stub)
- Test: `sidecar/tests/unit/test_protocol_models.py`

**Interfaces:**
- Consumes: `tagger.extraction.ExtractionMode` (sub-project 02)
- Produces:
  - `GetVersion`, `Shutdown`, `ListPlaylists(playlist_path: Path)`, `ExtractPlaylist(source_folder, destination_folder, playlist_path, playlist_name: str | None, mode: ExtractionMode)`
  - `AnyCommand` (union discriminée sur le champ `command`)
  - `parse_command(line: str) -> AnyCommand`

- [ ] **Step 1: Écrire les tests de validation**

Les types d'erreur attendus sont ceux que Pydantic produit réellement, relevés à l'exécution : `extra_forbidden`, `string_type`, `union_tag_invalid`, `json_invalid`, `enum`.

Créer `sidecar/tests/unit/test_protocol_models.py` :

```python
"""Tests des modeles du protocole NDJSON."""

import pytest
from pydantic import ValidationError

from tagger.extraction import ExtractionMode
from tagger.protocol import ExtractPlaylist, ListPlaylists, parse_command


def test_routes_a_line_to_its_command_model() -> None:
    command = parse_command('{"command":"list_playlists","playlist_path":"C:/x/vlc_media.db"}')

    assert isinstance(command, ListPlaylists)


def test_converts_a_json_string_into_a_path() -> None:
    command = parse_command('{"command":"list_playlists","playlist_path":"C:/x/vlc_media.db"}')

    assert isinstance(command, ListPlaylists)
    assert command.playlist_path.name == "vlc_media.db"


def test_defaults_the_mode_to_copy() -> None:
    command = parse_command(
        '{"command":"extract_playlist","source_folder":"C:/lib",'
        '"destination_folder":"C:/work","playlist_path":"C:/x.m3u8"}'
    )

    assert isinstance(command, ExtractPlaylist)
    assert command.mode is ExtractionMode.COPY


def test_rejects_an_undeclared_field() -> None:
    with pytest.raises(ValidationError) as excinfo:
        parse_command('{"command":"list_playlists","playlist_path":"C:/x","extra":1}')

    assert excinfo.value.errors()[0]["type"] == "extra_forbidden"


def test_rejects_a_missing_required_field() -> None:
    with pytest.raises(ValidationError) as excinfo:
        parse_command('{"command":"list_playlists"}')

    assert excinfo.value.errors()[0]["type"] == "missing"


def test_does_not_silently_coerce_a_wrong_type() -> None:
    with pytest.raises(ValidationError) as excinfo:
        parse_command('{"command":"list_playlists","playlist_path":42}')

    assert excinfo.value.errors()[0]["type"] == "string_type"


def test_rejects_an_unknown_command() -> None:
    with pytest.raises(ValidationError) as excinfo:
        parse_command('{"command":"unheard_of"}')

    assert excinfo.value.errors()[0]["type"] == "union_tag_invalid"


def test_rejects_a_line_that_is_not_json() -> None:
    with pytest.raises(ValidationError) as excinfo:
        parse_command("pas du json")

    assert excinfo.value.errors()[0]["type"] == "json_invalid"


def test_rejects_a_mode_outside_the_enum() -> None:
    with pytest.raises(ValidationError) as excinfo:
        parse_command(
            '{"command":"extract_playlist","source_folder":"C:/lib",'
            '"destination_folder":"C:/work","playlist_path":"C:/x.m3u8","mode":"teleport"}'
        )

    assert excinfo.value.errors()[0]["type"] == "enum"


def test_commands_are_frozen() -> None:
    command = parse_command('{"command":"list_playlists","playlist_path":"C:/x"}')

    with pytest.raises(ValidationError):
        command.playlist_path = "C:/y"  # type: ignore[assignment]
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `cd sidecar && uv run pytest tests/unit/test_protocol_models.py -x -q`
Expected: FAIL, `ImportError: cannot import name 'parse_command'`

- [ ] **Step 3: Écrire les modèles de commandes**

Remplacer intégralement `sidecar/src/tagger/protocol.py` :

```python
"""Modeles Pydantic des commandes et des evenements du protocole NDJSON.

Seule interface publique du sidecar : tout le reste est appele depuis la boucle
de `__main__.py`. Les types TypeScript de `src/app/core/models/` sont maintenus
a la main en miroir de ce fichier.

Les commandes entrantes sont fermees (`extra="forbid"`) et strictes : un champ
inconnu ou mal type est une commande malformee, pas un detail a ignorer
(cf. ADR-022).
"""

from pathlib import Path
from typing import Annotated, Final, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from tagger.extraction import ExtractionMode


class Command(BaseModel):
    """Base des commandes recues sur `stdin`.

    `strict=True` interdit la coercion lax sur ce qui vient de l'interface. En
    contrepartie, ces modeles ne se valident **que** depuis du JSON : en mode
    Python, une chaine n'est plus convertie en `Path` et la validation echoue sur
    `is_instance_of`. Toujours passer par `parse_command`, jamais par
    `model_validate` sur un dict.
    """

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class GetVersion(Command):
    """Emise au demarrage, avant toute autre commande."""

    command: Literal["get_version"]


class Shutdown(Command):
    """Emise a la fermeture de la fenetre. L'EOF sur `stdin` reste le filet si
    l'application est tuee.
    """

    command: Literal["shutdown"]


class ListPlaylists(Command):
    """Sans objet pour un M3U8, qui ne contient qu'une playlist."""

    command: Literal["list_playlists"]
    playlist_path: Path


class ExtractPlaylist(Command):
    """`playlist_name` n'est requis que pour un dump VLC, qui porte toute la
    mediatheque et fait donc choisir.
    """

    command: Literal["extract_playlist"]
    source_folder: Path
    destination_folder: Path
    playlist_path: Path
    playlist_name: str | None = None
    mode: ExtractionMode = ExtractionMode.COPY


type AnyCommand = Annotated[
    GetVersion | Shutdown | ListPlaylists | ExtractPlaylist,
    Field(discriminator="command"),
]

# `shutdown` sort de la boucle sans rien executer : l'exclure ici permet au `match`
# du dispatch de se fermer par `assert_never` sans laisser de cas non couvert.
type ExecutableCommand = GetVersion | ListPlaylists | ExtractPlaylist

_COMMAND_ADAPTER: Final = TypeAdapter[AnyCommand](AnyCommand)


def parse_command(line: str) -> AnyCommand:
    """Valide une ligne de `stdin` et rend la commande correspondante.

    Leve `ValidationError`, que la boucle convertit en evenement `error` : un
    message Pydantic ne remonte jamais jusqu'a l'ecran.
    """
    return _COMMAND_ADAPTER.validate_json(line)
```

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `cd sidecar && uv run pytest tests/unit/test_protocol_models.py -x -q`
Expected: PASS, 10 tests

- [ ] **Step 5: Vérifier le gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 6: Commit**

```bash
git add sidecar/src/tagger/protocol.py sidecar/tests/unit/test_protocol_models.py
git commit -m "feat(sidecar): modeles des commandes du protocole NDJSON"
```

---

## Task 2: Modèles d'événements et conversion des erreurs

**Files:**
- Modify: `sidecar/src/tagger/protocol.py`
- Modify: `docs/ARCHITECTURE.md` (étendre `extraction_finished` aux cinq catégories)
- Test: `sidecar/tests/unit/test_protocol_models.py` (compléter)

**Interfaces:**
- Consumes: `parse_command` de la Task 1, `TaggerError` (sub-project 01), les modèles de `tagger.extraction` (sub-project 02)
- Produces:
  - `Version(version: str, api_key_configured: bool)`, `PlaylistsListed(playlists: tuple[PlaylistEntry, ...])`, `Progress(phase: Phase, processed: int, total: int)`, `ExtractionFinished(...)`, `Error(code: str, params: dict[str, object], message: str)`
  - `PlaylistEntry(playlist_id: int, name: str, track_count: int)`
  - `Phase` : `EXTRACTION`, `TAGGING`, `URL_RECOVERY`, `WRITE`
  - `error_from_validation(exc: ValidationError) -> Error`, `error_from_business(exc: TaggerError) -> Error`
  - `emit(event: Event) -> str` — rend la ligne NDJSON à écrire

- [ ] **Step 1: Écrire les tests des événements**

Ajouter à `sidecar/tests/unit/test_protocol_models.py` :

```python
def test_an_event_serialises_on_a_single_line() -> None:
    line = emit(Version(event="version", version="1.2.3", api_key_configured=True))

    assert "\n" not in line
    assert json.loads(line)["version"] == "1.2.3"


def test_progress_matches_the_shape_protocol_ts_mirrors() -> None:
    line = emit(Progress(event="progress", phase=Phase.EXTRACTION, processed=1, total=3))

    assert json.loads(line) == {
        "event": "progress",
        "phase": "extraction",
        "processed": 1,
        "total": 3,
    }


def test_extraction_finished_carries_the_five_categories_and_its_report() -> None:
    line = emit(
        ExtractionFinished(
            event="extraction_finished",
            extracted=("a.mp3",),
            already_present=("b.mp3",),
            missing=("c.mp3",),
            duplicates=(),
            failures=(),
            report_path=Path("C:/work/extraction-report-20260908T221500Z.json"),
        )
    )

    payload = json.loads(line)
    assert set(payload) == {
        "event",
        "extracted",
        "already_present",
        "missing",
        "duplicates",
        "failures",
        "report_path",
    }
    assert payload["report_path"].endswith(".json")


def test_a_validation_error_becomes_a_structured_event() -> None:
    with pytest.raises(ValidationError) as excinfo:
        parse_command('{"command":"list_playlists","playlist_path":"C:/x","extra":1}')

    event = error_from_validation(excinfo.value)

    assert event.code == "malformed_command"
    assert event.params["errors"][0]["type"] == "extra_forbidden"


def test_a_business_error_keeps_its_code_and_params() -> None:
    class Boom(TaggerError):
        code = "playlist_not_found"

    event = error_from_business(Boom("playlist not found: x", playlist_name="x"))

    assert event.code == "playlist_not_found"
    assert event.params == {"playlist_name": "x"}
```

Compléter les imports du fichier : `import json`, `from pathlib import Path`, `from tagger.errors import TaggerError`, et ajouter aux imports de `tagger.protocol` : `ExtractionFinished, Phase, Progress, Version, emit, error_from_business, error_from_validation`.

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `cd sidecar && uv run pytest tests/unit/test_protocol_models.py -x -q`
Expected: FAIL, `ImportError: cannot import name 'emit'`

- [ ] **Step 3: Écrire les modèles d'événements**

Ajouter à `sidecar/src/tagger/protocol.py` :

```python
@verify(UNIQUE)
class Phase(StrEnum):
    """Les quatre phases longues que couvre l'evenement `progress`."""

    EXTRACTION = auto()  # "extraction"
    TAGGING = auto()  # "tagging"
    URL_RECOVERY = auto()  # "url_recovery"
    WRITE = auto()  # "write"


class Event(BaseModel):
    """Base des evenements emis sur `stdout`.

    Ni `strict` ni `forbid` : ces modeles sont construits par le sidecar lui-meme,
    pas recus d'un tiers. Ce qui compte ici est la sortie, pas la validation.
    """

    model_config = ConfigDict(frozen=True)


class Version(Event):
    """`api_key_configured` parce que seul le sidecar lit le trousseau : c'est ici
    que l'interface apprend qu'une cle existe, avant tout run (ADR-012).
    """

    event: Literal["version"]
    version: str
    api_key_configured: bool


class PlaylistEntry(BaseModel):
    """Une playlist du dump, telle que le selecteur l'affiche."""

    model_config = ConfigDict(frozen=True)

    playlist_id: int
    name: str
    track_count: int


class PlaylistsListed(Event):
    """Porte le format reconnu autant que les playlists.

    L'interface doit savoir s'il faut proposer un selecteur, et reconnaitre un
    format cote TypeScript serait une regle metier au mauvais endroit. Un M3U8
    rend donc une liste vide et son format, jamais une erreur.
    """

    event: Literal["playlists_listed"]
    playlist_format: PlaylistFormat
    playlists: tuple[PlaylistEntry, ...]


class Progress(Event):
    event: Literal["progress"]
    phase: Phase
    processed: int
    total: int


class DiscardedCandidatePayload(BaseModel):
    model_config = ConfigDict(frozen=True)

    path: Path
    size: int


class DuplicatePayload(BaseModel):
    model_config = ConfigDict(frozen=True)

    file_name: str
    kept_path: Path
    kept_size: int
    criterion: DuplicateCriterion
    discarded: tuple[DiscardedCandidatePayload, ...]


class FailurePayload(BaseModel):
    model_config = ConfigDict(frozen=True)

    file_name: str
    reason: ExtractionFailureReason


class ExtractionFinished(Event):
    """Cinq categories, la ou ARCHITECTURE.md n'en decrivait que trois : un
    transfert peut echouer sans que le morceau soit introuvable, et un fichier
    deja present n'a pas ete extrait.
    """

    event: Literal["extraction_finished"]
    extracted: tuple[str, ...]
    already_present: tuple[str, ...]
    missing: tuple[str, ...]
    duplicates: tuple[DuplicatePayload, ...]
    failures: tuple[FailurePayload, ...]
    report_path: Path


class Error(Event):
    """Reserve a ce qui ne se rattache a aucun morceau. Le `message` est technique,
    destine aux logs ; l'interface traduit le `code`.
    """

    event: Literal["error"] = "error"
    code: str
    params: dict[str, object]
    message: str


MALFORMED_COMMAND: Final = "malformed_command"


def error_from_validation(exc: ValidationError) -> Error:
    """Convertit un refus de validation en evenement structure.

    Seuls `loc` et `type` sont retenus : ils suffisent a situer le champ fautif
    dans les logs, et le message de Pydantic n'a pas vocation a etre lu par
    l'utilisateur.
    """
    details = [
        {"loc": list(error["loc"]), "type": error["type"]} for error in exc.errors()
    ]

    return Error(
        code=MALFORMED_COMMAND,
        params={"errors": details},
        message="command rejected by validation",
    )


def error_from_business(exc: TaggerError) -> Error:
    """Convertit une erreur metier en evenement, en gardant son code et ses params."""
    return Error(code=exc.code, params=dict(exc.params), message=str(exc))


def emit(event: Event) -> str:
    """Rend la ligne NDJSON d'un evenement.

    `model_dump_json()` produit une seule ligne, ce qu'exige le protocole : ne
    jamais y ajouter d'`indent`.
    """
    return event.model_dump_json()
```

Compléter les imports du module : `from enum import UNIQUE, StrEnum, auto, verify`, `from pydantic import ValidationError`, `from tagger.errors import TaggerError`, et `from tagger.extraction import DuplicateCriterion, ExtractionFailureReason, ExtractionMode` et `from tagger.playlists import PlaylistFormat`, par la façade du package et non par son module interne.

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `cd sidecar && uv run pytest tests/unit/test_protocol_models.py -x -q`
Expected: PASS, 15 tests

- [ ] **Step 5: Corriger la description du contrat dans ARCHITECTURE.md**

Dans la table des événements de `docs/ARCHITECTURE.md` § Backend > API, remplacer les lignes `playlists_listed` et `extraction_finished` par :

```markdown
| `playlists_listed` | format reconnu du fichier, et playlists du dump VLC : identifiant, nom, nombre de morceaux |
| `extraction_finished` | morceaux extraits, fichiers déjà présents en destination, titres introuvables, doublons résolus avec leurs candidats écartés, transferts en échec avec leur motif, chemin du rapport d'extraction |
```

La ligne `playlists_listed` est corrigée en même temps : c'est le sidecar qui annonce le format, l'interface n'ayant pas le droit de le déduire d'une extension.

- [ ] **Step 6: Vérifier le gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 7: Commit**

```bash
git add sidecar/src/tagger/protocol.py sidecar/tests/unit/test_protocol_models.py docs/ARCHITECTURE.md
git commit -m "feat(sidecar): evenements du protocole et conversion des erreurs"
```

---

## Task 3: Handlers des commandes

**Files:**
- Create: `sidecar/src/tagger/handlers.py`
- Test: `sidecar/tests/unit/test_handlers.py`

**Interfaces:**
- Consumes: les modèles de la Task 2, `tagger.playlists.list_playlists`, `tagger.playlists.read_playlist`, `tagger.extraction.extract`, `tagger.reports.write_extraction_report`
- Produces:
  - `handle_get_version() -> Version`
  - `handle_list_playlists(command: ListPlaylists) -> PlaylistsListed`
  - `handle_extract_playlist(command: ExtractPlaylist, on_progress: Callable[[Progress], None]) -> ExtractionFinished`

- [ ] **Step 1: Écrire les tests des handlers**

Créer `sidecar/tests/unit/test_handlers.py` :

```python
"""Tests de l'execution des commandes, sans passer par la boucle."""

from pathlib import Path

from tagger.handlers import handle_extract_playlist, handle_get_version, handle_list_playlists
from tagger.protocol import ExtractPlaylist, ListPlaylists, Phase, Progress


def test_reports_the_sidecar_version() -> None:
    event = handle_get_version()

    assert event.version
    assert isinstance(event.api_key_configured, bool)


def test_lists_the_playlists_of_a_dump(vlc_dump: Path) -> None:
    event = handle_list_playlists(
        ListPlaylists(command="list_playlists", playlist_path=vlc_dump)
    )

    assert [entry.name for entry in event.playlists]
    assert all(entry.track_count >= 0 for entry in event.playlists)


def test_extracts_and_writes_a_report(
    vlc_dump: Path, music_library: Path, tmp_path: Path
) -> None:
    destination = tmp_path / "work"
    command = ExtractPlaylist(
        command="extract_playlist",
        source_folder=music_library,
        destination_folder=destination,
        playlist_path=vlc_dump,
        playlist_name="test playlist",
    )

    event = handle_extract_playlist(command, lambda _: None)

    assert event.report_path.is_file()


def test_emits_progress_for_every_track(
    vlc_dump: Path, music_library: Path, tmp_path: Path
) -> None:
    seen: list[Progress] = []
    command = ExtractPlaylist(
        command="extract_playlist",
        source_folder=music_library,
        destination_folder=tmp_path / "work",
        playlist_path=vlc_dump,
        playlist_name="test playlist",
    )

    handle_extract_playlist(command, seen.append)

    assert seen
    assert all(event.phase is Phase.EXTRACTION for event in seen)
    assert seen[-1].processed == seen[-1].total


def test_carries_the_five_categories(
    vlc_dump: Path, music_library: Path, tmp_path: Path
) -> None:
    command = ExtractPlaylist(
        command="extract_playlist",
        source_folder=music_library,
        destination_folder=tmp_path / "work",
        playlist_path=vlc_dump,
        playlist_name="test playlist",
    )

    event = handle_extract_playlist(command, lambda _: None)

    assert isinstance(event.extracted, tuple)
    assert isinstance(event.already_present, tuple)
    assert isinstance(event.missing, tuple)
    assert isinstance(event.duplicates, tuple)
    assert isinstance(event.failures, tuple)
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `cd sidecar && uv run pytest tests/unit/test_handlers.py -x -q`
Expected: FAIL, `ModuleNotFoundError: No module named 'tagger.handlers'`

- [ ] **Step 3: Écrire les handlers**

Créer `sidecar/src/tagger/handlers.py` :

```python
"""Execution d'une commande validee : du modele du protocole au metier, puis a
l'evenement.

Separe de `__main__.py` pour que le point d'entree reste le moteur et le routage :
le contrat compte quatre commandes ici et une quinzaine a terme.
"""

import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from tagger import RELEASE
from tagger.extraction import extract
from tagger.playlists import detect_format, list_playlists, read_playlist
from tagger.protocol import (
    DiscardedCandidatePayload,
    DuplicatePayload,
    ExtractionFinished,
    ExtractPlaylist,
    FailurePayload,
    ListPlaylists,
    Phase,
    PlaylistEntry,
    PlaylistsListed,
    Progress,
    Version,
)
from tagger.reports import ReportContext, write_extraction_report

if TYPE_CHECKING:
    from collections.abc import Callable

logger = logging.getLogger(__name__)


def handle_get_version() -> Version:
    """Rend la version du sidecar, comparee a celle de l'interface avant tout run.

    `api_key_configured` reste faux tant que la lecture du trousseau n'est pas
    implementee : elle appartient au sub-project des Settings, et l'extraction par
    playlist n'appelle aucune API.
    """
    return Version(event="version", version=RELEASE, api_key_configured=False)


def handle_list_playlists(command: ListPlaylists) -> PlaylistsListed:
    """Liste les playlists d'un dump VLC pour alimenter le selecteur."""
    summaries = list_playlists(command.playlist_path)

    return PlaylistsListed(
        event="playlists_listed",
        playlist_format=detect_format(command.playlist_path),
        playlists=tuple(
            PlaylistEntry(
                playlist_id=summary.playlist_id,
                name=summary.name,
                track_count=summary.track_count,
            )
            for summary in summaries
        ),
    )


def handle_extract_playlist(
    command: ExtractPlaylist, on_progress: Callable[[Progress], None]
) -> ExtractionFinished:
    """Lit la playlist, extrait ses morceaux, ecrit le rapport.

    Le module d'extraction ignore le protocole : il recoit un rappel `(traites,
    total)` que ce handler traduit en evenement.
    """
    file_names = read_playlist(command.playlist_path, command.playlist_name)

    def report_progress(processed: int, total: int) -> None:
        on_progress(
            Progress(
                event="progress", phase=Phase.EXTRACTION, processed=processed, total=total
            )
        )

    result = extract(
        file_names,
        command.source_folder,
        command.destination_folder,
        mode=command.mode,
        on_progress=report_progress,
    )

    paths = write_extraction_report(
        result,
        ReportContext(
            source_folder=command.source_folder,
            destination_folder=command.destination_folder,
            playlist_path=command.playlist_path,
            playlist_name=command.playlist_name,
            mode=command.mode,
            generated_at=datetime.now(UTC),
        ),
    )
    logger.info(
        "extraction finished extracted=%d missing=%d",
        len(result.extracted),
        len(result.missing),
    )

    return ExtractionFinished(
        event="extraction_finished",
        extracted=result.extracted,
        already_present=result.already_present,
        missing=result.missing,
        duplicates=tuple(
            DuplicatePayload(
                file_name=duplicate.file_name,
                kept_path=duplicate.kept_path,
                kept_size=duplicate.kept_size,
                criterion=duplicate.criterion,
                discarded=tuple(
                    DiscardedCandidatePayload(path=candidate.path, size=candidate.size)
                    for candidate in duplicate.discarded
                ),
            )
            for duplicate in result.duplicates
        ),
        failures=tuple(
            FailurePayload(file_name=failure.file_name, reason=failure.reason)
            for failure in result.failures
        ),
        report_path=paths.json_path,
    )
```

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `cd sidecar && uv run pytest tests/unit/test_handlers.py -x -q`
Expected: PASS, 5 tests

- [ ] **Step 5: Vérifier le gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 6: Commit**

```bash
git add sidecar/src/tagger/handlers.py sidecar/tests/unit/test_handlers.py
git commit -m "feat(sidecar): handlers des commandes de l extraction"
```

---

## Task 4: Moteur asynchrone et boucle de dispatch

**Files:**
- Modify: `sidecar/src/tagger/__main__.py` (remplace la boucle `# TODO: implement`)
- Test: `sidecar/tests/integration/test_ndjson_loop.py`

**Interfaces:**
- Consumes: `parse_command`, `emit`, `error_from_validation`, `error_from_business` (Tasks 1 et 2), les handlers (Task 3)
- Produces: `run_loop(stdin: TextIO, stdout: TextIO) -> None` (coroutine), `main() -> None` inchangé dans son amorçage

- [ ] **Step 1: Écrire les tests d'intégration**

Les flux sont substitués plutôt que le processus lancé : `_force_utf8_streams()` ignore déjà un flux qui n'est pas un `TextIOWrapper`, ce que son docstring prévoit explicitement pour les captures de test.

Créer `sidecar/tests/integration/test_ndjson_loop.py` :

```python
"""Protocole NDJSON de bout en bout, par injection de commandes sur `stdin`.

Aucune interface n'est lancee : le contrat se teste en ligne de commande, ce qui
est sa raison d'etre (ADR-005).
"""

import asyncio
import io
import json
from pathlib import Path

from tagger.__main__ import run_loop


def drive(commands: str) -> list[dict[str, object]]:
    """Injecte des commandes et rend les evenements emis, un par ligne."""
    stdout = io.StringIO()
    asyncio.run(run_loop(io.StringIO(commands), stdout))

    return [json.loads(line) for line in stdout.getvalue().splitlines() if line]


def test_answers_a_version_request() -> None:
    events = drive('{"command":"get_version"}\n')

    assert events[0]["event"] == "version"
    assert "api_key_configured" in events[0]


def test_lists_the_playlists_of_a_dump(vlc_dump: Path) -> None:
    events = drive(
        json.dumps({"command": "list_playlists", "playlist_path": str(vlc_dump)}) + "\n"
    )

    assert events[0]["event"] == "playlists_listed"
    assert events[0]["playlists"]


def test_runs_a_full_extraction(vlc_dump: Path, music_library: Path, tmp_path: Path) -> None:
    command = json.dumps(
        {
            "command": "extract_playlist",
            "source_folder": str(music_library),
            "destination_folder": str(tmp_path / "work"),
            "playlist_path": str(vlc_dump),
            "playlist_name": "test playlist",
        }
    )

    events = drive(command + "\n")

    assert [event["event"] for event in events][-1] == "extraction_finished"
    assert any(event["event"] == "progress" for event in events)


def test_the_announced_report_exists(
    vlc_dump: Path, music_library: Path, tmp_path: Path
) -> None:
    command = json.dumps(
        {
            "command": "extract_playlist",
            "source_folder": str(music_library),
            "destination_folder": str(tmp_path / "work"),
            "playlist_path": str(vlc_dump),
            "playlist_name": "test playlist",
        }
    )

    events = drive(command + "\n")

    finished = events[-1]
    assert Path(str(finished["report_path"])).is_file()


def test_a_malformed_command_does_not_stop_the_loop() -> None:
    events = drive('{"command":"list_playlists","playlist_path":"C:/x","extra":1}\n{"command":"get_version"}\n')

    assert events[0]["event"] == "error"
    assert events[0]["code"] == "malformed_command"
    assert events[1]["event"] == "version"


def test_a_non_json_line_does_not_stop_the_loop() -> None:
    events = drive('pas du json\n{"command":"get_version"}\n')

    assert events[0]["event"] == "error"
    assert events[1]["event"] == "version"


def test_an_empty_line_produces_nothing() -> None:
    events = drive('\n{"command":"get_version"}\n')

    assert len(events) == 1


def test_a_business_error_becomes_an_error_event(
    vlc_dump: Path, music_library: Path, tmp_path: Path
) -> None:
    command = json.dumps(
        {
            "command": "extract_playlist",
            "source_folder": str(music_library),
            "destination_folder": str(tmp_path / "work"),
            "playlist_path": str(vlc_dump),
            "playlist_name": "aucune playlist de ce nom",
        }
    )

    events = drive(command + "
")

    assert events[0]["event"] == "error"
    assert events[0]["code"] == "playlist_not_found"


def test_listing_an_unreadable_file_announces_m3u8_rather_than_failing(tmp_path: Path) -> None:
    not_a_dump = tmp_path / "cover.jpg"
    not_a_dump.write_bytes(b"ÿØÿà")

    events = drive(
        json.dumps({"command": "list_playlists", "playlist_path": str(not_a_dump)}) + "
"
    )

    assert events[0]["event"] == "playlists_listed"
    assert events[0]["playlist_format"] == "m3u8"
    assert events[0]["playlists"] == []


def test_shutdown_ends_the_loop() -> None:
    events = drive('{"command":"shutdown"}\n{"command":"get_version"}\n')

    assert events == []


def test_end_of_stream_ends_the_loop() -> None:
    events = drive("")

    assert events == []


def test_every_line_parses_on_its_own(vlc_dump: Path) -> None:
    stdout = io.StringIO()
    command = json.dumps({"command": "list_playlists", "playlist_path": str(vlc_dump)})
    asyncio.run(run_loop(io.StringIO(command + "\n"), stdout))

    for line in stdout.getvalue().splitlines():
        assert json.loads(line)
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `cd sidecar && uv run pytest tests/integration/test_ndjson_loop.py -x -q`
Expected: FAIL, `ImportError: cannot import name 'run_loop'`

- [ ] **Step 3: Écrire la boucle**

Dans `sidecar/src/tagger/__main__.py`, remplacer la boucle finale de `main()` :

```python
    for _line in sys.stdin:
        # TODO: implement, valider la commande contre son modele Pydantic
        # (protocol.py), la dispatcher, puis emettre les evenements produits.
        pass
```

par :

```python
    asyncio.run(run_loop(sys.stdin, sys.stdout))
```

Puis ajouter avant `main()` :

```python
async def run_loop(stdin: TextIO, stdout: TextIO) -> None:
    """Lit les commandes ligne a ligne et emet les evenements produits.

    `stdin` est lu par `asyncio.to_thread` : sous Windows, `connect_read_pipe` sur
    stdin echoue en `OSError: [WinError 6]`, la lecture asynchrone native est donc
    hors jeu. La delegation en thread laisse la boucle libre, ce qui permet aux
    evenements `progress` de partir pendant qu'une commande bloquante est traitee.

    Aucune commande ne peut interrompre le processus autrement que `shutdown` ou
    l'EOF : une ligne rejetee produit un evenement `error` et la boucle continue.
    """
    while True:
        line = await asyncio.to_thread(stdin.readline)
        if not line:
            return

        stripped = line.strip()
        if not stripped:
            continue

        try:
            command = parse_command(stripped)
        except ValidationError as error:
            _write(stdout, emit(error_from_validation(error)))
            continue

        if isinstance(command, Shutdown):
            return
        # Mypy retire `Shutdown` de l'union a partir d'ici, ce dont `_dispatch` depend.

        try:
            await _dispatch(command, stdout)
        except TaggerError as error:
            logger.exception("command failed command=%s", type(command).__name__)
            _write(stdout, emit(error_from_business(error)))


async def _dispatch(command: ExecutableCommand, stdout: TextIO) -> None:
    """Route une commande validee vers son handler.

    `Shutdown` est traite par la boucle et n'arrive jamais ici, ce que le type dit :
    le `match` couvre alors toutes les variantes et `assert_never` verrouille
    l'ajout d'une commande sans handler.

    Les handlers sont bloquants — SQLite, parcours du dossier source, copie de
    fichiers — et passent donc par `to_thread`, sans quoi la boucle gelerait.
    """
    match command:
        case GetVersion():
            _write(stdout, emit(handle_get_version()))
        case ListPlaylists():
            event = await asyncio.to_thread(handle_list_playlists, command)
            _write(stdout, emit(event))
        case ExtractPlaylist():
            def on_progress(progress: Progress) -> None:
                _write(stdout, emit(progress))

            finished = await asyncio.to_thread(handle_extract_playlist, command, on_progress)
            _write(stdout, emit(finished))
        case _:
            assert_never(command)


def _write(stdout: TextIO, line: str) -> None:
    """Une ligne, un evenement. Le `line_buffering` pose par `_force_utf8_streams`
    dispense de flusher ; un flux substitue en test n'en a pas besoin.
    """
    stdout.write(line + "\n")
```

Compléter les imports du module : `import asyncio`, `import logging`, `from typing import TYPE_CHECKING, assert_never`, `from pydantic import ValidationError`, `from tagger.errors import TaggerError`, `from tagger.handlers import handle_extract_playlist, handle_get_version, handle_list_playlists`, `from tagger.protocol import ExecutableCommand, ExtractPlaylist, GetVersion, ListPlaylists, Progress, Shutdown, emit, error_from_business, error_from_validation`, et sous `if TYPE_CHECKING:` ajouter `from typing import TextIO`. Ajouter `logger = logging.getLogger(__name__)` après les imports.

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `cd sidecar && uv run pytest tests/integration/test_ndjson_loop.py -x -q`
Expected: PASS, 12 tests

- [ ] **Step 5: Vérifier que les tests existants passent toujours**

Run: `cd sidecar && uv run pytest tests/unit/test_main.py -q`
Expected: PASS — la cohérence des versions entre manifestes n'est pas touchée

- [ ] **Step 6: Vérifier le gate qualité complet**

Run: `just test && just lint && just typecheck`
Expected: tout vert, couverture au-dessus de 80 %

- [ ] **Step 7: Commit**

```bash
git add sidecar/src/tagger/__main__.py sidecar/tests/integration/test_ndjson_loop.py
git commit -m "feat(sidecar): boucle asyncio de dispatch du protocole NDJSON"
```

---

## Vérification de l'état livré

L'incrément est complet quand `just test && just lint && just typecheck` rend les trois gates verts, et que le contrat se pilote en ligne de commande sans interface :

```bash
cd sidecar
printf '{"command":"get_version"}\n' | uv run python -m tagger
```

doit écrire une ligne `{"event":"version",...}` sur la sortie standard.

Les scénarios du spec sont couverts : version au démarrage (Tasks 2 et 3), listage (Task 3), extraction avec progression et rapport (Tasks 3 et 4), commande malformée, ligne illisible, commande inconnue et erreur métier converties en `error` sans interrompre la boucle (Tasks 1, 2 et 4), `shutdown` et EOF (Task 4), une ligne par événement (Tasks 2 et 4).

Ce que ce sub-project ne fait pas : les commandes de tagging, d'arbitrage, d'écriture, de reprise et d'administration, qui se brancheront sur la même boucle. La lecture du trousseau reste à faire : `api_key_configured` vaut faux tant que le sub-project des Settings ne l'a pas renseignée.
