# Protocole NDJSON du run de re-tagging : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exposer le run de re-tagging sur le protocole NDJSON, la boucle restant à l'écoute pendant qu'il tourne.

**Architecture:** `protocol.py` reçoit la commande `start_tagging` et les quatre événements du run. `handlers.py` lit la clé, ouvre les caches, construit le client et l'`ArtworkFetcher`, lance `run_tagging` et traduit chaque événement interne en événement du protocole. `__main__.py` passe sa boucle dans un `TaskGroup` : le run tourne en tâche de fond pendant que `stdin` continue d'être lu.

**Tech Stack:** Python 3.14 (`asyncio.TaskGroup`, `match`), pydantic 2.13, pytest + pytest-asyncio, httpx2 `MockTransport`. Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/onglet-scraping-pipeline-de-re-tagging/07-protocole-ndjson-tagging-design.md`

## Global Constraints

- **Dépend des sub-projects 02 à 06, implémentés avant** : `run_tagging`, `TaggingRun`, `TrackRecord`, `PendingArbitration`, `TrackState`, `Resolution`, `FailureReason`, événements internes `RunStarted`, `TrackResolved`, `ArbitrationRequired`, `RunProgress` (`tagger.tagging`) ; `read_api_key` (`tagger.api_key`) ; `DiskCache`, `ResponseCache`, `ArtworkFetcher` (`tagger.cache`) ; `app_data_dir` (`tagger.paths`) ; `TechnoScraperClient`, `Source` (`tagger.scraper_client`) ; `DEFAULT_THRESHOLDS`, `MatchingThresholds`, `ScoredCandidate` (`tagger.matching`) ; helpers `tagging_api`, `scraper_responses`, `audio_samples`, `memory_keyring`.
- **Code vérifié** : ces modules et ces tests ont tourné le 2026-09-20 sur un assemblage des plans 01 à 06 (175 tests verts, dont 20 pour ce sub-project). S'en écarter demande une raison.
- **Contrat** : `start_tagging` porte `folder` et `thresholds` optionnel (`floor`, `ceiling`, `0 <= floor <= ceiling <= 100`). Événements `run_started`, `progress` (phase `tagging`), `track_resolved`, `arbitration_required`, `run_finished` (phase `network`).
- **Codes d'erreur** : `api_key_missing`, `tagging_folder_unreadable`, `api_key_rejected`, `tagging_in_progress`, plus `malformed_command` existant.
- **Scores arrondis** en entiers dans le protocole, `artist` nul sans artiste. **Pochette en chemin**, jamais en base64.
- **`after`** vient de `full_title` et `credited_artists` de `matching.py`, rendues publiques par ce sub-project : une seule règle de titre pour le scoring, l'affichage et, plus tard, l'écriture (ADR-011).
- **La boucle ne bloque jamais sur un run** : tâche de fond dans un `TaskGroup`, `shutdown` l'annule, l'EOF l'attend.
- **Tests** : noms en anglais, AAA, API et CDN mockés par `tagging_transports()` remplacée, trousseau en mémoire, `LOCALAPPDATA` redirigé vers `tmp_path`.
- **Gate qualité vert à chaque commit** : `just test`, `just lint`, `just typecheck`. Commits `type(scope): description`, scope `sidecar`.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `sidecar/src/tagger/protocol.py` | `StartTagging`, `ThresholdsPayload`, `RunPhase`, `RunStarted`, `TrackResolved`, `ArbitrationRequired`, `RunFinished` et leurs charges. |
| `sidecar/src/tagger/handlers.py` | `handle_start_tagging`, `to_protocol_event`, `tagging_transports`. |
| `sidecar/src/tagger/__main__.py` | Boucle concurrente, `_Session`, `TaggingInProgressError`. |
| `sidecar/src/tagger/matching.py` | `full_title` et `credited_artists` publiques. |
| `sidecar/tests/unit/test_protocol_tagging.py` | Commandes, seuils, traduction. |
| `sidecar/tests/integration/test_ndjson_tagging.py` | Séquence d'un run sur la boucle. |
| `docs/ARCHITECTURE.md` | Table du contrat, phases, § Robustesse. |
| `public/i18n/fr.json`, `public/i18n/en.json` | Phrases des codes `api_key_missing` et `tagging_in_progress`, exigées par `test_error_translations.py`. |

---

## Task 1: Commande et événements du run

**Files:**
- Modify: `sidecar/src/tagger/protocol.py`
- Modify: `sidecar/src/tagger/matching.py` (deux fonctions rendues publiques)
- Modify: `sidecar/tests/unit/test_matching_scoring.py` (noms publics)
- Test: `sidecar/tests/unit/test_protocol_tagging.py`

**Interfaces:**
- Consumes: `TrackState`, `Resolution`, `FailureReason` (`tagger.tagging`), `Source` (`tagger.scraper_client`)
- Produces:
  - `ThresholdsPayload(floor: float, ceiling: float)`, `StartTagging(command, folder, thresholds=None)`
  - `RunPhase` (`network`, `write`), `TrackEntry`, `RunStarted`, `TrackNames`, `TrackScores`, `TrackResolved`, `CandidatePayload`, `ArbitrationRequired`, `RunFinished`
  - `matching.full_title(candidate) -> str`, `matching.credited_artists(candidate) -> str`

- [ ] **Step 1: Écrire les tests de commande**

Créer `sidecar/tests/unit/test_protocol_tagging.py` avec l'en-tête et les tests de commande :

```python
"""Tests des modeles du run et de la traduction des evenements du pipeline."""

from dataclasses import replace
from pathlib import Path
from typing import TYPE_CHECKING

import pytest
from pydantic import ValidationError

from tagger import tagging
from tagger.handlers import to_protocol_event
from tagger.matching import ScoredCandidate
from tagger.protocol import (
    ArbitrationRequired,
    Progress,
    RunStarted,
    StartTagging,
    TrackNames,
    TrackResolved,
    parse_command,
)
from tagger.scraper_client import Credit, ReleaseInfo, Source, TrackCandidate
from tagger.tagging import (
    IdentityTags,
    PendingArbitration,
    Resolution,
    TrackRecord,
    TrackState,
)

if TYPE_CHECKING:
    from tagger.protocol import Event

FOLDER = Path("C:/Sets")


def _candidate(title: str = "Your Mind", mix_name: str | None = "Original Mix") -> TrackCandidate:
    return TrackCandidate(
        id="17492013",
        title=title,
        mix_name=mix_name,
        artists=(Credit(name="Adam Beyer"),),
        remixers=(Credit(name="Bart Skils"),),
        release=ReleaseInfo(artwork_url="https://cdn.example/cover.jpg"),
        source=Source.BEATPORT,
    )


def _record(**overrides: object) -> TrackRecord:
    base = TrackRecord(
        track_id="a.mp3",
        path=FOLDER / "a.mp3",
        identity=IdentityTags(artist="Adam Beyer", title="Your Mind"),
    )
    return replace(base, **overrides)  # type: ignore[arg-type]


def _scored(artist: float | None = 96.4, title: float = 91.6) -> ScoredCandidate:
    average = title if artist is None else (artist + title) / 2
    return ScoredCandidate(
        candidate=_candidate(),
        artist_score=artist,
        title_score=title,
        score=average,
        via_bare_title=False,
    )


def test_accepts_a_start_tagging_command_without_thresholds() -> None:
    command = parse_command('{"command":"start_tagging","folder":"C:/Sets"}')

    assert isinstance(command, StartTagging)
    assert command.thresholds is None


def test_accepts_thresholds_sent_by_the_settings() -> None:
    command = parse_command(
        '{"command":"start_tagging","folder":"C:/Sets","thresholds":{"floor":75,"ceiling":95}}'
    )

    assert isinstance(command, StartTagging)
    assert command.thresholds is not None
    assert (command.thresholds.floor, command.thresholds.ceiling) == (75, 95)


@pytest.mark.parametrize(
    "thresholds",
    ['{"floor":95,"ceiling":90}', '{"floor":-1,"ceiling":90}', '{"floor":70,"ceiling":101}'],
    ids=["inverted", "negative", "over"],
)
def test_rejects_thresholds_out_of_bounds(thresholds: str) -> None:
    line = '{"command":"start_tagging","folder":"C:/Sets","thresholds":' + thresholds + "}"

    with pytest.raises(ValidationError):
        parse_command(line)
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_protocol_tagging.py -x -q`
Expected: FAIL, `ImportError: cannot import name 'StartTagging' from 'tagger.protocol'`

- [ ] **Step 3: Rendre publiques les deux fonctions du matching**

Dans `sidecar/src/tagger/matching.py`, renommer `_candidate_title` en `full_title` et `_candidate_artists` en `credited_artists`, ainsi que leurs appels dans `_score` et `_passes_remix_guard`. Compléter leurs docstrings :

```python
def full_title(candidate: TrackCandidate) -> str:
    """Titre tel que la CLI le compare et que l'ADR-011 l'ecrit : titre et mix."""


def credited_artists(candidate: TrackCandidate) -> str:
    """Artistes joints comme dans la CLI, remixeurs exclus : ils vivent dans le mix."""
```

Dans `sidecar/tests/unit/test_matching_scoring.py`, rien à changer : ces fonctions n'y sont pas appelées directement.

- [ ] **Step 4: Déclarer la commande et les événements**

Dans `sidecar/src/tagger/protocol.py`, compléter les imports :

```python
from typing import TYPE_CHECKING, Annotated, Final, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError, model_validator

from tagger.extraction import DuplicateCriterion, ExtractionFailureReason, ExtractionMode
from tagger.playlists import PlaylistFormat
from tagger.scraper_client import Source
from tagger.tagging import FailureReason, Resolution, TrackState
```

Ajouter avant `type AnyCommand` :

```python
class ThresholdsPayload(BaseModel):
    """Seuils envoyes par les Settings. Absents, le sidecar applique les siens."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    floor: float
    ceiling: float

    @model_validator(mode="after")
    def _within_bounds(self) -> Self:
        if not 0 <= self.floor <= self.ceiling <= 100:
            raise ValueError("thresholds out of bounds")
        return self


class StartTagging(Command):
    """Dossier a re-tagger, et seuils de matching quand les Settings en imposent."""

    command: Literal["start_tagging"]
    folder: Path
    thresholds: ThresholdsPayload | None = None
```

Ajouter `StartTagging` aux deux unions :

```python
type AnyCommand = Annotated[
    GetVersion | Shutdown | ListPlaylists | ExtractPlaylist | StartTagging,
    Field(discriminator="command"),
]
```

```python
type ExecutableCommand = GetVersion | ListPlaylists | ExtractPlaylist | StartTagging
```

Ajouter les événements du run avant `class Error(Event):` :

```python
@verify(UNIQUE)
class RunPhase(StrEnum):
    """Phase que `run_finished` cloture : la boucle reseau, puis l'ecriture."""

    NETWORK = auto()
    WRITE = auto()


class TrackEntry(BaseModel):
    """Un morceau du run tel que la liste l'affiche avant toute resolution."""

    model_config = ConfigDict(frozen=True)

    track_id: str
    file_name: str
    artist: str
    title: str


class RunStarted(Event):
    """Toutes les lignes de la liste, des le depart : sans lui, l'ecran reste vide
    jusqu'a la premiere resolution.
    """

    event: Literal["run_started"]
    run_id: str
    tracks: tuple[TrackEntry, ...]


class TrackNames(BaseModel):
    """Artiste et titre qu'une source ecrira, calcules cote sidecar (ADR-011)."""

    model_config = ConfigDict(frozen=True)

    artist: str
    title: str


class TrackScores(BaseModel):
    """Scores arrondis pour l'affichage. `artist` nul : la requete n'en avait pas."""

    model_config = ConfigDict(frozen=True)

    artist: int | None
    title: int
    average: int


class TrackResolved(Event):
    """Etat d'un morceau en trois champs, jamais en une valeur plate."""

    event: Literal["track_resolved"]
    track_id: str
    state: TrackState
    resolution: Resolution
    failure_reason: FailureReason | None = None
    source: Source | None = None
    after: TrackNames | None = None
    scores: TrackScores | None = None
    artwork_path: Path | None = None


class CandidatePayload(BaseModel):
    """Un candidat en zone grise, avec ses scores."""

    model_config = ConfigDict(frozen=True)

    artist: str
    title: str
    scores: TrackScores


class ArbitrationRequired(Event):
    """Morceau en attente d'une decision humaine. La Feature 3 etendra la charge."""

    event: Literal["arbitration_required"]
    track_id: str
    source: Source
    beatport_unavailable: bool
    candidates: tuple[CandidatePayload, ...]


class RunFinished(Event):
    """Fin d'une phase du run. Les rapports arriveront avec la Feature 6."""

    event: Literal["run_finished"]
    phase: RunPhase
    run_id: str
    resolved: int
    unresolved: int
    awaiting_arbitration: int
```

- [ ] **Step 5: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_protocol_tagging.py tests/unit/test_matching_scoring.py -x -q`
Expected: PASS, les 5 tests de commande et les tests de scoring inchangés

- [ ] **Step 6: Gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 7: Commit**

```bash
git add sidecar/src/tagger/protocol.py sidecar/src/tagger/matching.py sidecar/tests/unit/test_protocol_tagging.py
git commit -m "feat(sidecar): commande start_tagging et evenements du run"
```

---

## Task 2: Handler et traduction des événements

**Files:**
- Modify: `sidecar/src/tagger/handlers.py`
- Modify: `sidecar/src/tagger/api_key.py` (erreur `api_key_missing`)
- Modify: `public/i18n/fr.json`, `public/i18n/en.json` (`errors.api_key_missing`)
- Test: `sidecar/tests/unit/test_protocol_tagging.py`

**Interfaces:**
- Consumes: modèles de la Task 1, `run_tagging`, `read_api_key`, caches, client
- Produces:
  - `ApiKeyMissingError()` (code `api_key_missing`) dans `tagger.api_key`
  - `tagging_transports() -> tuple[httpx2.AsyncBaseTransport | None, httpx2.AsyncBaseTransport | None]`
  - `async handle_start_tagging(command: StartTagging, emit: Callable[[Event], None]) -> RunFinished`
  - `to_protocol_event(event: tagging.RunEvent) -> Event`

- [ ] **Step 1: Écrire les tests de traduction**

Ajouter à `sidecar/tests/unit/test_protocol_tagging.py` les imports et fabriques nécessaires, puis les tests :

```python
def test_lists_every_track_of_a_started_run() -> None:
    event = to_protocol_event(tagging.RunStarted("a3f9c1", (_record(),)))

    assert isinstance(event, RunStarted)
    assert event.tracks[0].track_id == "a.mp3"
    assert event.tracks[0].artist == "Adam Beyer"


def test_rounds_the_scores_of_a_resolved_track() -> None:
    record = _record(
        state=TrackState.RESOLVED,
        resolution=Resolution.AUTO,
        source=Source.BEATPORT,
        candidate=_candidate(),
        scored=_scored(),
    )

    event = to_protocol_event(tagging.TrackResolved(record))

    assert isinstance(event, TrackResolved)
    assert event.scores is not None
    assert (event.scores.artist, event.scores.title, event.scores.average) == (96, 92, 94)


@pytest.mark.parametrize(
    ("title", "mix_name", "expected"),
    [
        ("Your Mind", "Original Mix", "Your Mind (Original Mix)"),
        ("Your Mind", None, "Your Mind"),
        ("Your Mind (Extended Mix)", "Extended Mix", "Your Mind (Extended Mix)"),
    ],
    ids=["with-mix", "without-mix", "mix-already-in-title"],
)
def test_renders_the_artist_and_the_title_a_source_will_write(
    title: str, mix_name: str | None, expected: str
) -> None:
    record = _record(
        state=TrackState.RESOLVED,
        resolution=Resolution.AUTO,
        source=Source.BEATPORT,
        candidate=_candidate(title, mix_name),
        scored=_scored(),
    )

    event = to_protocol_event(tagging.TrackResolved(record))

    assert isinstance(event, TrackResolved)
    assert event.after is not None
    assert event.after == TrackNames(artist="Adam Beyer", title=expected)


def test_reports_no_artist_score_for_a_query_without_artist() -> None:
    record = _record(
        state=TrackState.RESOLVED,
        resolution=Resolution.AUTO,
        source=Source.BANDCAMP,
        candidate=_candidate(),
        scored=_scored(artist=None, title=100),
    )

    event = to_protocol_event(tagging.TrackResolved(record))

    assert isinstance(event, TrackResolved)
    assert event.scores is not None
    assert event.scores.artist is None


def test_carries_the_grey_zone_candidates_of_an_arbitration() -> None:
    record = _record(
        arbitration=PendingArbitration(Source.BANDCAMP, (_scored(),), beatport_unavailable=True)
    )

    event = to_protocol_event(tagging.ArbitrationRequired(record))

    assert isinstance(event, ArbitrationRequired)
    assert event.beatport_unavailable is True
    assert event.candidates[0].title == "Your Mind (Original Mix)"


def test_maps_the_pipeline_progress_to_the_tagging_phase() -> None:
    event = to_protocol_event(tagging.RunProgress(2, 3))

    assert isinstance(event, Progress)
    assert event.phase == "tagging"
```

Les imports à compléter en tête du fichier :

```python
from dataclasses import replace

from tagger import tagging
from tagger.handlers import to_protocol_event
from tagger.matching import ScoredCandidate
from tagger.protocol import ArbitrationRequired, Progress, RunStarted, TrackNames, TrackResolved
from tagger.scraper_client import Credit, ReleaseInfo, TrackCandidate
from tagger.tagging import IdentityTags, PendingArbitration, Resolution, TrackRecord, TrackState
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_protocol_tagging.py -x -q`
Expected: FAIL, `ImportError: cannot import name 'to_protocol_event' from 'tagger.handlers'`

- [ ] **Step 3: Ajouter l'erreur de clé absente**

Dans `sidecar/src/tagger/api_key.py`, après `KeyringUnavailableError` :

```python
class ApiKeyMissingError(ApiKeyError):
    """Aucune cle enregistree : rien ne peut etre demande a l'API."""

    code: ClassVar[str] = "api_key_missing"

    def __init__(self) -> None:
        super().__init__("no api key configured")
```

- [ ] **Step 4: Implémenter le handler et la traduction**

Dans `sidecar/src/tagger/handlers.py`, remplacer le bloc d'imports par :

```python
import asyncio
import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING, assert_never

from tagger import __version__, tagging
from tagger.api_key import ApiKeyMissingError, read_api_key
from tagger.cache import ArtworkFetcher, DiskCache, ResponseCache
from tagger.extraction import extract
from tagger.matching import DEFAULT_THRESHOLDS, MatchingThresholds, credited_artists, full_title
from tagger.paths import app_data_dir
from tagger.playlists import list_playlists, read_playlist
from tagger.protocol import (
    ArbitrationRequired,
    CandidatePayload,
    DuplicatePayload,
    ExtractionFinished,
    ExtractPlaylist,
    FailurePayload,
    ListPlaylists,
    Phase,
    PlaylistEntry,
    PlaylistsListed,
    Progress,
    RunFinished,
    RunPhase,
    RunStarted,
    StartTagging,
    TrackEntry,
    TrackNames,
    TrackResolved,
    TrackScores,
    Version,
)
from tagger.reports import ReportContext, write_extraction_report
from tagger.scraper_client import TechnoScraperClient
from tagger.tagging import run_tagging

if TYPE_CHECKING:
    from collections.abc import Callable

    import httpx2

    from tagger.protocol import Event
    from tagger.matching import ScoredCandidate
    from tagger.scraper_client import TrackCandidate
    from tagger.tagging import TaggingRun, TrackRecord
```

Ajouter à la fin du fichier :

```python
def tagging_transports() -> tuple[httpx2.AsyncBaseTransport | None, httpx2.AsyncBaseTransport | None]:
    """Transports du client et du CDN. `None` en production : les tests les remplacent."""
    return (None, None)


async def handle_start_tagging(command: StartTagging, emit: Callable[[Event], None]) -> RunFinished:
    """Ouvre les caches, construit le client, lance le run et traduit ses evenements."""
    api_key = await asyncio.to_thread(read_api_key)
    if api_key is None:
        raise ApiKeyMissingError

    cache_root = app_data_dir() / "cache"
    responses = ResponseCache(await asyncio.to_thread(DiskCache, cache_root / "responses"))
    artwork_cache = await asyncio.to_thread(DiskCache, cache_root / "artworks")
    api_transport, cdn_transport = tagging_transports()

    async with (
        TechnoScraperClient(api_key, transport=api_transport, cache=responses) as client,
        ArtworkFetcher(artwork_cache, transport=cdn_transport) as artworks,
    ):
        run = await run_tagging(
            command.folder,
            client=client,
            artworks=artworks,
            thresholds=_thresholds(command),
            on_event=lambda event: emit(to_protocol_event(event)),
        )

    return _run_finished(run)


def _thresholds(command: StartTagging) -> MatchingThresholds:
    """Sans seuils dans la commande, ceux du sidecar : une valeur, une source."""
    sent = command.thresholds
    if sent is None:
        return DEFAULT_THRESHOLDS
    return MatchingThresholds(floor=sent.floor, ceiling=sent.ceiling)


def to_protocol_event(event: tagging.RunEvent) -> Event:
    """Traduit un evenement du pipeline. Un cas oublie est une erreur de typage."""
    match event:
        case tagging.RunStarted():
            return RunStarted(
                event="run_started",
                run_id=event.run_id,
                tracks=tuple(_entry(record) for record in event.tracks),
            )
        case tagging.TrackResolved():
            return _resolved(event.record)
        case tagging.ArbitrationRequired():
            return _arbitration(event.record)
        case tagging.RunProgress():
            return Progress(
                event="progress",
                phase=Phase.TAGGING,
                processed=event.processed,
                total=event.total,
            )
        case _:
            assert_never(event)


def _entry(record: TrackRecord) -> TrackEntry:
    return TrackEntry(
        track_id=record.track_id,
        file_name=record.file_name,
        artist=record.identity.artist,
        title=record.identity.title,
    )


def _resolved(record: TrackRecord) -> TrackResolved:
    candidate = record.candidate
    return TrackResolved(
        event="track_resolved",
        track_id=record.track_id,
        state=record.state or tagging.TrackState.UNRESOLVED,
        resolution=record.resolution or tagging.Resolution.NONE,
        failure_reason=record.failure_reason,
        source=record.source,
        after=None if candidate is None else _names(candidate),
        scores=None if record.scored is None else _scores(record.scored),
        artwork_path=record.artwork,
    )


def _arbitration(record: TrackRecord) -> ArbitrationRequired:
    arbitration = record.arbitration
    if arbitration is None:
        message = f"track without arbitration: {record.track_id}"
        raise ValueError(message)
    return ArbitrationRequired(
        event="arbitration_required",
        track_id=record.track_id,
        source=arbitration.source,
        beatport_unavailable=arbitration.beatport_unavailable,
        candidates=tuple(
            CandidatePayload(
                artist=credited_artists(scored.candidate),
                title=full_title(scored.candidate),
                scores=_scores(scored),
            )
            for scored in arbitration.candidates
        ),
    )


def _names(candidate: TrackCandidate) -> TrackNames:
    """Ce que la source ecrira : regle de titre et d'artistes de l'ADR-011."""
    return TrackNames(artist=credited_artists(candidate), title=full_title(candidate))


def _scores(scored: ScoredCandidate) -> TrackScores:
    """Arrondis : l'ecran affiche « A 96 · T 92 »."""
    return TrackScores(
        artist=None if scored.artist_score is None else round(scored.artist_score),
        title=round(scored.title_score),
        average=round(scored.score),
    )


def _run_finished(run: TaggingRun) -> RunFinished:
    states = [record.state for record in run.tracks]
    return RunFinished(
        event="run_finished",
        phase=RunPhase.NETWORK,
        run_id=run.run_id,
        resolved=states.count(tagging.TrackState.RESOLVED),
        unresolved=states.count(tagging.TrackState.UNRESOLVED),
        awaiting_arbitration=states.count(None),
    )
```

- [ ] **Step 5: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_protocol_tagging.py -x -q`
Expected: PASS, 13 tests

- [ ] **Step 6: Gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 7: Traduire les nouveaux codes d'erreur**

`sidecar/tests/unit/test_error_translations.py` parcourt toutes les sous-classes de `TaggerError`, bases abstraites comprises, et exige une entrée `errors.<code>` dans les deux langues. Dans le bloc `errors` de `public/i18n/fr.json`, ajouter :

```json
    "api_key_missing": "Aucune clé API enregistrée. Enregistrez-la dans les Réglages.",
```

et dans `public/i18n/en.json`, au même endroit :

```json
    "api_key_missing": "No API key saved. Save it in the settings.",
```

- [ ] **Step 8: Commit**

```bash
git add sidecar/src/tagger/handlers.py sidecar/src/tagger/api_key.py sidecar/tests/unit/test_protocol_tagging.py public/i18n/fr.json public/i18n/en.json
git commit -m "feat(sidecar): lancer un run de re-tagging et traduire ses evenements"
```

---

## Task 3: Boucle concurrente

**Files:**
- Modify: `sidecar/src/tagger/__main__.py`
- Test: `sidecar/tests/integration/test_ndjson_tagging.py`
- Modify: `docs/ARCHITECTURE.md` (§ API, § Robustesse)
- Modify: `public/i18n/fr.json`, `public/i18n/en.json` (`errors.tagging_in_progress`)

**Interfaces:**
- Consumes: `handle_start_tagging` (Task 2), `StartTagging` (Task 1)
- Produces: `TaggingInProgressError()` (code `tagging_in_progress`), `_Session` (`start_tagging`, `cancel_run`)

- [ ] **Step 1: Écrire les tests d'intégration**

Créer `sidecar/tests/integration/test_ndjson_tagging.py` :

```python
"""Protocole NDJSON d'un run de re-tagging, de bout en bout sur la boucle."""

import asyncio
import io
import json
from typing import TYPE_CHECKING

import httpx2
import pytest
from scraper_responses import track_payload
from tagging_api import FakeApi, FakeCdn, failing, found, tagged_mp3

from tagger import handlers
from tagger.__main__ import run_loop
from tagger.api_key import SERVICE, USERNAME

if TYPE_CHECKING:
    from pathlib import Path

    from memory_keyring import MemoryKeyring

QUERY = "Adam Beyer Your Mind"
ORIGINAL = track_payload(mix_name="Original Mix")


def drive(commands: str) -> list[dict[str, object]]:
    """Injecte des commandes et rend les evenements emis, un par ligne."""
    stdout = io.StringIO()
    asyncio.run(run_loop(io.StringIO(commands), stdout))

    return [json.loads(line) for line in stdout.getvalue().splitlines() if line]


def start_tagging(folder: Path, **payload: object) -> str:
    return json.dumps({"command": "start_tagging", "folder": str(folder), **payload}) + "\n"


@pytest.fixture
def run_folder(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Trois morceaux, et un dossier de donnees d'application isole."""
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "appdata"))
    folder = tmp_path / "music"
    tagged_mp3(folder, "a.mp3", "Adam Beyer", "Your Mind")
    tagged_mp3(folder, "b.mp3", "Amelie Lens", "Basiel")
    tagged_mp3(folder, "c.mp3", "Sara Landry", "The Void")
    return folder


@pytest.fixture
def api(monkeypatch: pytest.MonkeyPatch) -> FakeApi:
    """API et CDN simules, poses a la place des transports de production."""
    fake = FakeApi()
    cdn = FakeCdn()
    monkeypatch.setattr(
        handlers,
        "tagging_transports",
        lambda: (httpx2.MockTransport(fake.handler), httpx2.MockTransport(cdn.handler)),
    )
    return fake


@pytest.fixture
def _key(memory_keyring: MemoryKeyring) -> None:
    memory_keyring.secrets[(SERVICE, USERNAME)] = "k3y-t0k3n"


@pytest.mark.usefixtures("_key")
def test_emits_the_whole_sequence_of_a_tagging_run(run_folder: Path, api: FakeApi) -> None:
    api.on("/beatport/search", QUERY, found(ORIGINAL))
    api.on("/beatport/tracks/17492013", "*", found(ORIGINAL))
    api.on(
        "/beatport/search",
        "Amelie Lens Basiel",
        found(track_payload(artists=[{"name": "Amelie Lens"}], title="Basiel", mix_name="Club Mix")),
    )

    events = drive(start_tagging(run_folder))

    assert events[0]["event"] == "run_started"
    assert [track["track_id"] for track in events[0]["tracks"]] == ["a.mp3", "b.mp3", "c.mp3"]
    assert {event["event"] for event in events[1:-1]} <= {
        "track_resolved",
        "arbitration_required",
        "progress",
    }
    assert events[-1] == {
        "event": "run_finished",
        "phase": "network",
        "run_id": events[0]["run_id"],
        "resolved": 1,
        "unresolved": 1,
        "awaiting_arbitration": 1,
    }


@pytest.mark.usefixtures("_key")
def test_describes_a_resolved_track_with_its_source_its_scores_and_its_artwork(
    run_folder: Path, api: FakeApi
) -> None:
    api.on("/beatport/search", QUERY, found(ORIGINAL))
    api.on("/beatport/tracks/17492013", "*", found(ORIGINAL))

    events = drive(start_tagging(run_folder))

    resolved = next(
        event
        for event in events
        if event["event"] == "track_resolved" and event["track_id"] == "a.mp3"
    )
    assert resolved["state"] == "resolved"
    assert resolved["resolution"] == "auto"
    assert resolved["failure_reason"] is None
    assert resolved["source"] == "beatport"
    assert resolved["after"] == {"artist": "Adam Beyer", "title": "Your Mind (Original Mix)"}
    assert resolved["scores"] == {"artist": 100, "title": 100, "average": 100}
    assert str(resolved["artwork_path"]).endswith(".jpg")


@pytest.mark.usefixtures("_key")
def test_answers_a_version_request_while_a_run_is_in_progress(
    run_folder: Path, api: FakeApi
) -> None:
    events = drive(start_tagging(run_folder) + '{"command":"get_version"}\n')

    names = [event["event"] for event in events]
    assert names.index("version") < names.index("run_finished")


@pytest.mark.usefixtures("_key")
def test_refuses_a_second_tagging_run_while_one_is_in_progress(
    run_folder: Path, api: FakeApi
) -> None:
    events = drive(start_tagging(run_folder) * 2)

    errors = [event for event in events if event["event"] == "error"]
    assert [error["code"] for error in errors] == ["tagging_in_progress"]
    assert events[-1]["event"] == "run_finished"


def test_reports_a_missing_api_key_without_calling_the_api(
    run_folder: Path, api: FakeApi
) -> None:
    events = drive(start_tagging(run_folder))

    assert [event["event"] for event in events] == ["error"]
    assert events[0]["code"] == "api_key_missing"
    assert api.requests == []


@pytest.mark.usefixtures("_key")
def test_reports_a_rejected_api_key_and_never_finishes_the_run(
    run_folder: Path, api: FakeApi
) -> None:
    api.on("/beatport/search", "*", failing(403))

    events = drive(start_tagging(run_folder))

    assert events[-1]["event"] == "error"
    assert events[-1]["code"] == "api_key_rejected"
    assert all(event["event"] != "run_finished" for event in events)


@pytest.mark.usefixtures("_key")
def test_refuses_thresholds_out_of_bounds(run_folder: Path, api: FakeApi) -> None:
    command = start_tagging(run_folder, thresholds={"floor": 95, "ceiling": 90})

    events = drive(command)

    assert [event["event"] for event in events] == ["error"]
    assert events[0]["code"] == "malformed_command"
    assert "95" not in json.dumps(events[0]["params"])
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `cd sidecar && uv run pytest tests/integration/test_ndjson_tagging.py -x -q`
Expected: FAIL, `AssertionError` levée par `assert_never` dans `_dispatch` (`StartTagging` est déjà dans les unions depuis la Task 1, la commande passe la validation et tombe dans `case _`), ou `ImportError` sur `_Session`

- [ ] **Step 3: Passer la boucle en concurrent**

Dans `sidecar/src/tagger/__main__.py`, compléter les imports : `ClassVar` depuis `typing`, `handle_start_tagging` depuis `tagger.handlers`, `Event` et `StartTagging` depuis `tagger.protocol`.

Ajouter avant `run_loop` :

```python
class TaggingInProgressError(TaggerError):
    """Un run tourne deja : le lancer deux fois ecrirait deux fois les memes fichiers."""

    code: ClassVar[str] = "tagging_in_progress"

    def __init__(self) -> None:
        super().__init__("a tagging run is already in progress")


class _Session:
    """Etat de la session : le run de re-tagging tourne pendant que stdin est lu."""

    def __init__(self, group: asyncio.TaskGroup, stdout: TextIO) -> None:
        self._group = group
        self._stdout = stdout
        self._run: asyncio.Task[None] | None = None

    def start_tagging(self, command: StartTagging) -> None:
        """Lance le run en tache de fond : la boucle repart lire la commande suivante."""
        if self._run is not None and not self._run.done():
            raise TaggingInProgressError
        self._run = self._group.create_task(self._tag(command), name="tagging")

    def cancel_run(self) -> None:
        """`shutdown` n'attend pas la fin d'un run, il l'annule."""
        if self._run is not None and not self._run.done():
            self._run.cancel()

    async def _tag(self, command: StartTagging) -> None:
        try:
            finished = await handle_start_tagging(command, self._emit)
        except TaggerError as error:
            logger.exception("tagging run failed reason=%s", error.code)
            self._emit(error_from_business(error))
            return
        self._emit(finished)

    def _emit(self, event: Event) -> None:
        _write(self._stdout, emit(event))
```

Remplacer le corps de `run_loop` (la boucle `while True`) par :

```python
    async with asyncio.TaskGroup() as group:
        session = _Session(group, stdout)
        while True:
            line = await asyncio.to_thread(stdin.readline)
            if not line:
                # EOF : on sort du groupe, qui attend la fin d'un run en cours.
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
                session.cancel_run()
                return
            # Mypy retire `Shutdown` de l'union a partir d'ici, ce dont `_dispatch` depend.

            try:
                await _dispatch(command, stdout, session)
            except TaggerError as error:
                logger.exception("command failed reason=%s", error.code)
                _write(stdout, emit(error_from_business(error)))
```

Compléter la docstring de `run_loop` : la boucle ne traite plus une commande à la fois quand un run de re-tagging est lancé, il tourne en tâche de fond ; `shutdown` l'annule, l'EOF l'attend.

Dans `_dispatch`, ajouter le paramètre `session: _Session` et la branche :

```python
        case StartTagging():
            session.start_tagging(command)
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/integration -x -q`
Expected: PASS, 7 tests de tagging plus les tests d'extraction existants

- [ ] **Step 5: Mettre ARCHITECTURE.md à jour**

Dans la table des commandes, remplacer la ligne `start_tagging` par :

```markdown
| `start_tagging` | dossier cible, et seuils de matching optionnels : absents, le sidecar applique les siens (une valeur, une source) |
```

Dans la ligne `shutdown`, remplacer la phrase « et une commande émise en plein run ne serait lue qu'à sa fin, la boucle traitant une commande à la fois » par « et un run de re-tagging tourne en tâche de fond : la boucle continue de lire les commandes pendant qu'il tourne, `shutdown` l'annule et l'EOF l'attend ».

Dans la table des événements, remplacer la ligne `arbitration_required` par :

```markdown
| `arbitration_required` | morceau, candidats en zone grise avec leur score, source interrogée, et `beatport_unavailable` quand Bandcamp n'a été interrogé que parce que Beatport était en panne (§ Chaîne de résolution) |
```

Sous la table des événements, ajouter :

```markdown
Deux axes de phase, deux enums : `Phase` (`extraction`, `tagging`, `url_recovery`, `write`) qualifie un `progress`, l'étape que la barre affiche ; `RunPhase` (`network`, `write`) qualifie un `run_finished`, la moitié du run qui vient de se clore. Elles partagent la valeur `write` sans être le même type, mypy refuse de les mélanger.
```

Dans § API, paragraphe « Le sidecar n'émet jamais de phrase destinée à l'écran », remplacer l'exemple `invalid_api_key` par `api_key_rejected`.

Dans § Robustesse, « Clé API invalide ou révoquée », remplacer le second paragraphe (« Un run avorté **se termine proprement sur le flux** […] au lieu de repartir de zéro. ») par :

```markdown
Un run avorté **se termine par l'erreur elle-même** : un `error` de code `api_key_rejected`, sans `params`, et aucun `run_finished`, ce dernier étant réservé à une fin normale pour que le signal de fin de phase ne se déclenche jamais sur un échec (décision du 2026-09-20). L'interface arrête le run sur cette branche. Les morceaux non traités restent en « en attente » côté écran, aucun `track_resolved` ne les ayant tranchés. La reprise d'un run avorté, une fois la clé corrigée, arrive avec le plan de run de la Feature 6 (`resume_run`).
```

Dans la table des événements, ajouter avant `track_resolved` :

```markdown
| `run_started` | identifiant du run et tous ses morceaux : identifiant, nom de fichier, artiste et titre lus. Sans lui, la liste resterait vide jusqu'à la première résolution |
```

et remplacer la ligne `run_finished` par :

```markdown
| `run_finished` | `phase` (`network` après la boucle de résolution, `write` après `commit_run` ou `retry_write`), identifiant du run, compteurs résolus, non résolus et en attente d'arbitrage, et chemin des rapports une fois la Feature 6 livrée |
```

- [ ] **Step 6: Gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 7: Traduire les nouveaux codes d'erreur**

`sidecar/tests/unit/test_error_translations.py` parcourt toutes les sous-classes de `TaggerError`, bases abstraites comprises, et exige une entrée `errors.<code>` dans les deux langues. Dans le bloc `errors` de `public/i18n/fr.json`, ajouter :

```json
    "tagging_in_progress": "Un run est déjà en cours. Attendez sa fin avant d'en lancer un autre.",
```

et dans `public/i18n/en.json`, au même endroit :

```json
    "tagging_in_progress": "A run is already in progress. Wait for it to finish before starting another one.",
```

- [ ] **Step 8: Commit**

```bash
git add sidecar/src/tagger/__main__.py sidecar/tests/integration/test_ndjson_tagging.py docs/ARCHITECTURE.md public/i18n/fr.json public/i18n/en.json
git commit -m "feat(sidecar): lire stdin pendant qu'un run de re-tagging tourne"
```
