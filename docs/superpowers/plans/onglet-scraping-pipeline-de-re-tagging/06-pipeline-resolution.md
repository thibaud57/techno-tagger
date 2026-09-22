# Pipeline de résolution d'un run de re-tagging : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Résoudre tous les morceaux d'un dossier en parallèle borné, de la lecture des tags au candidat retenu, sans jamais bloquer sur une décision humaine.

**Architecture:** Un module `tagger/tagging.py`, pendant d'`extraction.py`. `run_tagging` lit l'identité de tous les fichiers, émet `RunStarted`, puis lance une tâche par morceau dans un `TaskGroup`. Chaque tâche enchaîne requête, Beatport, classement, Bandcamp sur vide ou sur panne, refetch et pochette. Elle aboutit à un `TrackRecord` résolu, non résolu ou en attente d'arbitrage. Une garde partagée arrête le run au troisième 403 consécutif. Le module ignore le protocole : ses événements sortent par un rappel.

**Tech Stack:** Python 3.14 (`asyncio.TaskGroup`, `except*`, dataclasses), sentry-sdk, pytest + pytest-asyncio (mode strict), httpx2 `MockTransport`. Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/onglet-scraping-pipeline-de-re-tagging/06-pipeline-resolution-design.md`

## Global Constraints

- **Dépend des sub-projects 01 à 04, implémentés avant** : `list_audio_files`, `read_identity`, `IdentityTags`, `TagsUnreadableError`, `TaggingFolderUnreadableError` (`tagger.files`) ; `build_query`, `classify(..., allow_auto=...)`, `MatchingThresholds`, `DEFAULT_THRESHOLDS`, `Outcome`, `ScoredCandidate`, `TrackQuery` (`tagger.matching`) ; `TechnoScraperClient`, `TrackCandidate`, `Source`, `ApiKeyRejectedError`, `SourceUnavailableError` (attributs `status`, `reason`, `request_id`), `TrackNotFoundError`, `ApiContractError` (`tagger.scraper_client`) ; `ArtworkFetcher`, `ArtworkUnavailableError`, `DiskCache` (`tagger.cache`) ; helpers de test `audio_samples` (`tag`, `write_blank_mp3`) et `scraper_responses` (`make_client`, `page_payload`, `track_payload`).
- **Code vérifié** : ce module et ses tests ont tourné le 2026-09-19 sur un assemblage des plans 01 à 04 (17 tests verts). S'en écarter demande une raison.
- **`track_id`** : chemin relatif au dossier, séparateurs `/`.
- **Valeurs d'état** (ARCHITECTURE.md § API) : `TrackState` `resolved`, `unresolved` ; `Resolution` `auto`, `arbitration`, `url`, `none` ; `FailureReason` `empty_query`, `no_result`, `below_threshold`, `user_refused`, `source_unavailable`.
- **Beatport injoignable** (`SourceUnavailableError` ou `ApiContractError`) : Bandcamp est interrogé avec `allow_auto=False`, et l'attente d'arbitrage porte `beatport_unavailable=True`.
- **`below_threshold`** si l'une des deux sources a rendu au moins un candidat, `no_result` sinon.
- **Garde des 403** : trois consécutifs arrêtent le run (`ApiKeyRejectedRunError`, code `api_key_rejected`, sans `params`). Toute autre réponse de l'API remet le compteur à zéro, une erreur réseau sans statut ne le fait pas.
- **Aucun échec de refetch ni de pochette ne fait échouer un morceau.**
- **Logs** : une ligne INFO par décision (`run`, `track` = position, `source`, `score`, `status`), `reason` pour un motif, `request_id` pour un échec de l'API. Aucun titre vers Sentry.
- **Tests** : noms en anglais, AAA, API et CDN mockés par `FakeApi` et `FakeCdn`, jamais de réseau réel.
- **Taille de page de la recherche** : `10`, décision du propriétaire du 2026-09-21. Portée par la `3.2.0` de techno-scraper, déployée le 2026-09-22 : la Task 4 garde sa vérification de précondition et se saute sans dommage si elle échoue.
- **Gate qualité vert à chaque commit** : `just test`, `just lint`, `just typecheck`. Commits `type(scope): description`, scope `tagging`.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `sidecar/src/tagger/tagging.py` | Enums d'état, `TrackRecord`, `PendingArbitration`, `TaggingRun`, événements, `run_tagging`, garde des 403. |
| `sidecar/tests/helpers/tagging_api.py` | `FakeApi`, `FakeCdn`, fichiers tagués, lancement d'un run simulé. |
| `sidecar/tests/unit/test_tagging_outcomes.py` | Issues d'un morceau. |
| `sidecar/tests/unit/test_tagging_run.py` | Événements, progression, garde des 403, Sentry. |
| `docs/ARCHITECTURE.md`, `docs/adrs/009-enchainement-sources-et-arbitrage.md` | Beatport injoignable vers Bandcamp sans auto, prose et diagramme. |
| `sidecar/src/tagger/scraper_client.py`, `sidecar/tests/unit/test_scraper_client_requests.py` | Taille de page de la recherche (Task 4, sous précondition de déploiement de la gateway). |
| `docs/ARCHITECTURE.md`, `docs/adrs/010-ecriture-batch-et-plan-de-run.md` | État du run en mémoire jusqu'à la Feature 6 ; `tagging.py` dans l'arborescence. |

---

## Task 1: Pipeline et issues d'un morceau

**Files:**
- Create: `sidecar/src/tagger/tagging.py`
- Create: `sidecar/tests/helpers/tagging_api.py`
- Test: `sidecar/tests/unit/test_tagging_outcomes.py`, `sidecar/tests/unit/test_tagging_run.py`

**Interfaces:**
- Consumes: voir Global Constraints.
- Produces:
  - `TrackState`, `Resolution`, `FailureReason` (`StrEnum`)
  - `PendingArbitration(source: Source, candidates: tuple[ScoredCandidate, ...], beatport_unavailable: bool)`
  - `TrackRecord(track_id, path, identity, query=None, state=None, resolution=None, failure_reason=None, source=None, candidate=None, scored=None, artwork=None, arbitration=None)`, propriété `file_name`
  - `TaggingRun(run_id: str, folder: Path, tracks: tuple[TrackRecord, ...])`
  - événements `RunStarted(run_id, tracks)`, `TrackResolved(record)`, `ArbitrationRequired(record)`, `RunProgress(processed, total)`, alias `RunEvent`
  - `async run_tagging(folder, *, client, artworks, on_event, thresholds=DEFAULT_THRESHOLDS) -> TaggingRun`
  - helpers de test `FakeApi` (`on(path, key, reply)`, `paths()`, `requests`, `handler`), `FakeCdn` (`refused`, `handler`), `ok`, `found`, `failing`, `tagged_mp3`, `run`

- [ ] **Step 1: Écrire le helper de test**

Créer `sidecar/tests/helpers/tagging_api.py` :

```python
"""API techno-scraper et CDN de pochettes simules pour les tests du pipeline.

Chaque route repond selon la requete recue. Une recherche sans reponse enregistree
rend une page vide, un refetch sans reponse rend 404 : le pipeline garde alors
l'objet de recherche, ce qui est le comportement documente.
"""

from typing import TYPE_CHECKING

import httpx2
from audio_samples import tag, write_blank_mp3
from scraper_responses import make_client, page_payload

from tagger.cache import ArtworkFetcher, DiskCache
from tagger.tagging import run_tagging

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

    from tagger.tagging import RunEvent, TaggingRun

type Reply = Callable[[], httpx2.Response]

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64


def ok(body: dict[str, object]) -> Reply:
    return lambda: httpx2.Response(200, json=body)


def found(*items: dict[str, object]) -> Reply:
    return ok(page_payload(*items))


def failing(status: int, api_code: str = "") -> Reply:
    return lambda: httpx2.Response(status, json={"code": api_code} if api_code else {})


class FakeApi:
    """Reponses par route et par requete, et journal des requetes recues."""

    def __init__(self) -> None:
        self.requests: list[httpx2.Request] = []
        self._replies: dict[tuple[str, str], Reply] = {}

    def on(self, path: str, key: str, reply: Reply) -> None:
        """`key` : la requete `q`, l'URL d'un refetch Bandcamp, ou `*` pour toute requete."""
        self._replies[(path, key)] = reply

    def paths(self) -> list[str]:
        return [request.url.path for request in self.requests]

    def handler(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        path = request.url.path
        key = request.url.params.get("q") or request.url.params.get("url") or ""
        reply = self._replies.get((path, key)) or self._replies.get((path, "*"))
        if reply is not None:
            return reply()
        if path.endswith("/search"):
            return httpx2.Response(200, json=page_payload())
        return httpx2.Response(404, json={"code": "not_found"})


class FakeCdn:
    """Rend une image JPEG pour toute URL, sauf celles declarees refusees."""

    def __init__(self) -> None:
        self.refused: set[str] = set()

    def handler(self, request: httpx2.Request) -> httpx2.Response:
        if str(request.url) in self.refused:
            return httpx2.Response(404)
        return httpx2.Response(200, content=JPEG, headers={"Content-Type": "image/jpeg"})


def tagged_mp3(folder: Path, name: str, artist: str, title: str) -> Path:
    """Fichier MP3 vierge tague, dans le dossier du run."""
    folder.mkdir(parents=True, exist_ok=True)
    path = write_blank_mp3(folder / name)
    tag(path, artist=[artist], title=[title])
    return path


async def run(
    folder: Path,
    api: FakeApi,
    *,
    cdn: FakeCdn | None = None,
    events: list[RunEvent] | None = None,
) -> TaggingRun:
    """Lance un run complet sur l'API et le CDN simules."""
    cdn = cdn or FakeCdn()
    sink: list[RunEvent] = events if events is not None else []
    artworks_cache = DiskCache(folder.parent / "artworks")
    async with (
        make_client(api.handler) as client,
        ArtworkFetcher(artworks_cache, transport=httpx2.MockTransport(cdn.handler)) as artworks,
    ):
        return await run_tagging(folder, client=client, artworks=artworks, on_event=sink.append)
```

- [ ] **Step 2: Écrire les tests des issues**

Créer `sidecar/tests/unit/test_tagging_outcomes.py` :

```python
"""Tests des issues d'un morceau dans le pipeline de resolution."""

from typing import TYPE_CHECKING

import pytest
from scraper_responses import track_payload
from tagging_api import FakeApi, FakeCdn, failing, found, ok, run, tagged_mp3

from tagger.scraper_client import Source
from tagger.tagging import FailureReason, Resolution, TrackState

if TYPE_CHECKING:
    from pathlib import Path

pytestmark = pytest.mark.asyncio

QUERY = "Adam Beyer Your Mind"
ORIGINAL = track_payload(mix_name="Original Mix")
BANDCAMP_URL = "https://adambeyer.bandcamp.com/track/your-mind"
ON_BANDCAMP = track_payload(
    id="42", source="bandcamp", mix_name=None, url=BANDCAMP_URL
)


def _music(tmp_path: Path) -> Path:
    folder = tmp_path / "music"
    tagged_mp3(folder, "your mind.mp3", "Adam Beyer", "Your Mind")
    return folder


async def test_validates_automatically_on_beatport_without_calling_bandcamp(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    api.on("/beatport/search", QUERY, found(ORIGINAL))
    api.on("/beatport/tracks/17492013", "*", ok(track_payload(mix_name="Original Mix", isrc="REFETCHED")))

    result = await run(_music(tmp_path), api)

    record = result.tracks[0]
    assert (record.state, record.resolution, record.source) == (
        TrackState.RESOLVED,
        Resolution.AUTO,
        Source.BEATPORT,
    )
    assert record.candidate is not None
    assert record.candidate.isrc == "REFETCHED"
    assert record.artwork is not None
    assert not any(path.startswith("/bandcamp") for path in api.paths())


async def test_validates_automatically_on_bandcamp_after_an_empty_beatport_search(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    api.on("/bandcamp/search", QUERY, found(ON_BANDCAMP))

    result = await run(_music(tmp_path), api)

    record = result.tracks[0]
    assert (record.state, record.resolution, record.source) == (
        TrackState.RESOLVED,
        Resolution.AUTO,
        Source.BANDCAMP,
    )


async def test_puts_a_grey_zone_track_on_hold_without_resolving_it(tmp_path: Path) -> None:
    api = FakeApi()
    extended = track_payload(id="1", mix_name="Extended Mix")
    radio = track_payload(id="2", mix_name="Radio Edit")
    api.on("/beatport/search", QUERY, found(extended, radio))

    result = await run(_music(tmp_path), api)

    record = result.tracks[0]
    assert record.state is None
    assert record.arbitration is not None
    assert record.arbitration.source is Source.BEATPORT
    assert [entry.candidate.id for entry in record.arbitration.candidates] == ["1", "2"]


async def test_sends_bandcamp_candidates_to_arbitration_when_beatport_is_unavailable(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    api.on("/beatport/search", "*", failing(503, "source_unavailable"))
    api.on("/bandcamp/search", QUERY, found(ON_BANDCAMP))

    result = await run(_music(tmp_path), api)

    record = result.tracks[0]
    assert record.state is None
    assert record.arbitration is not None
    assert record.arbitration.source is Source.BANDCAMP
    assert record.arbitration.beatport_unavailable is True


async def test_marks_a_track_unknown_to_both_sources_as_no_result(tmp_path: Path) -> None:
    api = FakeApi()

    result = await run(_music(tmp_path), api)

    record = result.tracks[0]
    assert (record.state, record.resolution, record.failure_reason) == (
        TrackState.UNRESOLVED,
        Resolution.NONE,
        FailureReason.NO_RESULT,
    )


async def test_marks_a_track_whose_candidates_are_below_the_floor_as_below_threshold(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    stranger = track_payload(artists=[{"name": "Amelie Lens"}], title="Basiel")
    api.on("/beatport/search", QUERY, found(stranger))

    result = await run(_music(tmp_path), api)

    assert result.tracks[0].failure_reason is FailureReason.BELOW_THRESHOLD


async def test_marks_a_file_name_reduced_to_noise_as_empty_query_without_any_request(
    tmp_path: Path,
) -> None:
    from audio_samples import write_blank_mp3

    folder = tmp_path / "music"
    folder.mkdir()
    write_blank_mp3(folder / "01 - [FREE DL].mp3")
    api = FakeApi()

    result = await run(folder, api)

    assert result.tracks[0].failure_reason is FailureReason.EMPTY_QUERY
    assert api.requests == []


async def test_marks_a_track_as_source_unavailable_when_both_sources_fail(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    api.on("/beatport/search", "*", failing(503, "source_unavailable"))
    api.on("/bandcamp/search", "*", failing(504, "request_timeout"))

    result = await run(_music(tmp_path), api)

    assert result.tracks[0].failure_reason is FailureReason.SOURCE_UNAVAILABLE


async def test_keeps_the_search_candidate_when_the_refetch_fails(tmp_path: Path) -> None:
    api = FakeApi()
    api.on("/beatport/search", QUERY, found(ORIGINAL))
    api.on("/beatport/tracks/17492013", "*", failing(503, "source_unavailable"))

    result = await run(_music(tmp_path), api)

    record = result.tracks[0]
    assert record.state is TrackState.RESOLVED
    assert record.candidate is not None
    assert record.candidate.isrc == ORIGINAL["isrc"]


async def test_resolves_a_track_without_artwork_when_the_cdn_refuses_it(tmp_path: Path) -> None:
    api = FakeApi()
    api.on("/beatport/search", QUERY, found(ORIGINAL))
    cdn = FakeCdn()
    release = ORIGINAL["release"]
    assert isinstance(release, dict)
    cdn.refused.add(str(release["artwork_url"]))

    result = await run(_music(tmp_path), api, cdn=cdn)

    record = result.tracks[0]
    assert record.state is TrackState.RESOLVED
    assert record.artwork is None


async def test_falls_back_on_the_file_name_when_the_tags_are_unreadable(tmp_path: Path) -> None:
    folder = tmp_path / "music"
    folder.mkdir()
    (folder / "Adam Beyer - Your Mind.mp3").write_bytes(b"not an audio file" * 16)
    api = FakeApi()
    api.on("/beatport/search", QUERY, found(ORIGINAL))

    result = await run(folder, api)

    record = result.tracks[0]
    assert record.state is TrackState.RESOLVED
    assert record.query is not None
    assert record.query.text == QUERY
```

- [ ] **Step 3: Écrire les tests d'événements**

Créer `sidecar/tests/unit/test_tagging_run.py` :

```python
"""Tests du run : evenements, progression, garde des 403, incidents."""

from typing import TYPE_CHECKING

import pytest
from scraper_responses import track_payload
from tagging_api import FakeApi, found, run, tagged_mp3

from tagger.files import TaggingFolderUnreadableError
from tagger.tagging import ArbitrationRequired, RunProgress, RunStarted, TrackResolved

if TYPE_CHECKING:
    from pathlib import Path

    from tagger.tagging import RunEvent

pytestmark = pytest.mark.asyncio


def _three_tracks(tmp_path: Path) -> Path:
    folder = tmp_path / "music"
    tagged_mp3(folder, "a.mp3", "Adam Beyer", "Your Mind")
    tagged_mp3(folder, "b.mp3", "Amelie Lens", "Basiel")
    tagged_mp3(folder, "c.mp3", "Sara Landry", "The Void")
    return folder


async def test_emits_run_started_first_with_every_track_and_its_identity(tmp_path: Path) -> None:
    events: list[RunEvent] = []

    await run(_three_tracks(tmp_path), FakeApi(), events=events)

    first = events[0]
    assert isinstance(first, RunStarted)
    assert [record.track_id for record in first.tracks] == ["a.mp3", "b.mp3", "c.mp3"]
    assert first.tracks[1].identity.artist == "Amelie Lens"


async def test_counts_a_track_as_processed_once_resolved_unresolved_or_on_hold(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    api.on("/beatport/search", "Adam Beyer Your Mind", found(track_payload(mix_name="Original Mix")))
    api.on(
        "/beatport/search",
        "Amelie Lens Basiel",
        found(track_payload(artists=[{"name": "Amelie Lens"}], title="Basiel", mix_name="Extended Mix")),
    )
    events: list[RunEvent] = []

    await run(_three_tracks(tmp_path), api, events=events)

    progress = [event for event in events if isinstance(event, RunProgress)]
    assert [(event.processed, event.total) for event in progress] == [(1, 3), (2, 3), (3, 3)]
    assert sum(isinstance(event, TrackResolved) for event in events) == 2
    assert sum(isinstance(event, ArbitrationRequired) for event in events) == 1


async def test_raises_a_tagging_folder_error_for_an_unreadable_folder_before_any_event(
    tmp_path: Path,
) -> None:
    events: list[RunEvent] = []

    with pytest.raises(TaggingFolderUnreadableError):
        await run(tmp_path / "missing", FakeApi(), events=events)

    assert events == []
```

- [ ] **Step 4: Vérifier que les tests échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_tagging_outcomes.py tests/unit/test_tagging_run.py -x -q`
Expected: FAIL, `ModuleNotFoundError: No module named 'tagger.tagging'`

- [ ] **Step 5: Implémenter le pipeline**

Créer `sidecar/src/tagger/tagging.py` :

```python
"""Pipeline de resolution d'un run de re-tagging (use-case 2).

Orchestre `files`, `matching`, `scraper_client` et `cache` sans rien reimplementer,
et ignore le protocole NDJSON : les evenements sortent par un rappel, que le handler
traduit. Aucun fichier musical n'est ecrit ici (ADR-010).
"""

import asyncio
import logging
import secrets
from dataclasses import dataclass, replace
from enum import UNIQUE, StrEnum, auto, verify
from typing import TYPE_CHECKING

from tagger.cache import ArtworkUnavailableError
from tagger.files import IdentityTags, TagsUnreadableError, list_audio_files, read_identity
from tagger.matching import (
    DEFAULT_THRESHOLDS,
    MatchingThresholds,
    Outcome,
    ScoredCandidate,
    TrackQuery,
    build_query,
    classify,
)
from tagger.scraper_client import (
    ApiContractError,
    ApiKeyRejectedError,
    Source,
    SourceUnavailableError,
    TrackNotFoundError,
)

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable
    from pathlib import Path

    from tagger.cache import ArtworkFetcher
    from tagger.scraper_client import TechnoScraperClient, TrackCandidate

logger = logging.getLogger(__name__)

@verify(UNIQUE)
class TrackState(StrEnum):
    """Etat d'un morceau apres la phase reseau. La Feature 5 ajoutera l'ecriture."""

    RESOLVED = auto()
    UNRESOLVED = auto()


@verify(UNIQUE)
class Resolution(StrEnum):
    """Par quel chemin un morceau a ete resolu, `none` pour un non resolu."""

    AUTO = auto()
    ARBITRATION = auto()
    URL = auto()
    NONE = auto()


@verify(UNIQUE)
class FailureReason(StrEnum):
    """Motif d'un non resolu : la correction a apporter n'est pas la meme."""

    EMPTY_QUERY = auto()
    NO_RESULT = auto()
    BELOW_THRESHOLD = auto()
    USER_REFUSED = auto()
    SOURCE_UNAVAILABLE = auto()


@dataclass(frozen=True, slots=True)
class PendingArbitration:
    """Candidats en zone grise d'une source, en attente d'une decision humaine."""

    source: Source
    candidates: tuple[ScoredCandidate, ...]
    beatport_unavailable: bool


@dataclass(frozen=True, slots=True)
class TrackRecord:
    """Tout ce que le run sait d'un morceau. `state` vide : en attente d'arbitrage ou en cours."""

    track_id: str
    path: Path
    identity: IdentityTags
    query: TrackQuery | None = None
    state: TrackState | None = None
    resolution: Resolution | None = None
    failure_reason: FailureReason | None = None
    source: Source | None = None
    candidate: TrackCandidate | None = None
    scored: ScoredCandidate | None = None
    artwork: Path | None = None
    arbitration: PendingArbitration | None = None

    @property
    def file_name(self) -> str:
        """Nom du fichier, sous-texte de la colonne Avant."""
        return self.path.name


@dataclass(frozen=True, slots=True)
class TaggingRun:
    """Etat complet d'un run en fin de phase reseau, que la Feature 6 persistera."""

    run_id: str
    folder: Path
    tracks: tuple[TrackRecord, ...]


@dataclass(frozen=True, slots=True)
class RunStarted:
    """Tous les morceaux du run avec leur identite lue, avant le premier appel reseau."""

    run_id: str
    tracks: tuple[TrackRecord, ...]


@dataclass(frozen=True, slots=True)
class TrackResolved:
    """Un morceau resolu ou non resolu."""

    record: TrackRecord


@dataclass(frozen=True, slots=True)
class ArbitrationRequired:
    """Un morceau mis en attente d'une decision humaine."""

    record: TrackRecord


@dataclass(frozen=True, slots=True)
class RunProgress:
    """Morceaux traites : resolus, non resolus ou en attente d'arbitrage."""

    processed: int
    total: int


type RunEvent = RunStarted | TrackResolved | ArbitrationRequired | RunProgress


async def run_tagging(
    folder: Path,
    *,
    client: TechnoScraperClient,
    artworks: ArtworkFetcher,
    on_event: Callable[[RunEvent], None],
    thresholds: MatchingThresholds = DEFAULT_THRESHOLDS,
) -> TaggingRun:
    """Resout tous les morceaux du dossier et rend l'etat du run.

    Le pipeline ne s'arrete jamais sur un morceau : une zone grise est mise en
    attente, un incident devient un motif d'echec. Seuls trois 403 consecutifs
    arretent le run, par `ApiKeyRejectedRunError`.
    """
    paths = await asyncio.to_thread(list_audio_files, folder)
    run_id = secrets.token_hex(3)
    records = await asyncio.to_thread(_read_identities, run_id, folder, paths)
    on_event(RunStarted(run_id, tuple(records)))

    runner = _Runner(run_id, records, client, artworks, thresholds, on_event)
    async with asyncio.TaskGroup() as group:
        for position, record in enumerate(records, start=1):
            group.create_task(runner.process(position, record), name=f"track:{position}")

    return TaggingRun(run_id, folder, tuple(runner.records))


def _read_identities(run_id: str, folder: Path, paths: tuple[Path, ...]) -> list[TrackRecord]:
    """Identites lues avant tout appel reseau : la liste s'affiche entiere des le depart."""
    records: list[TrackRecord] = []
    for position, path in enumerate(paths, start=1):
        try:
            identity = read_identity(path)
        except TagsUnreadableError as exc:
            logger.warning(
                "tags unreadable, file name used run=%s track=%d reason=%s",
                run_id,
                position,
                exc.reason,
            )
            identity = IdentityTags(artist="", title="")
        track_id = path.relative_to(folder).as_posix()
        records.append(TrackRecord(track_id=track_id, path=path, identity=identity))
    return records


class _Runner:
    """Etat partage par les taches d'un run : compteur, garde, enregistrements."""

    def __init__(
        self,
        run_id: str,
        records: list[TrackRecord],
        client: TechnoScraperClient,
        artworks: ArtworkFetcher,
        thresholds: MatchingThresholds,
        on_event: Callable[[RunEvent], None],
    ) -> None:
        self.records = records
        self._run_id = run_id
        self._client = client
        self._artworks = artworks
        self._thresholds = thresholds
        self._on_event = on_event
        self._processed = 0

    async def process(self, position: int, record: TrackRecord) -> None:
        # Ecart assume a `rules/python/asyncio.md` (resultats relus apres le
        # TaskGroup) : chaque tache range son enregistrement des qu'il est
        # tranche pour emettre l'evenement en flux. Pas de course, la boucle est
        # cooperative et rien n'attend entre la lecture et l'ecriture de l'index.
        done = await self._resolve(position, record)
        self.records[position - 1] = done
        event = ArbitrationRequired(done) if done.arbitration else TrackResolved(done)
        self._on_event(event)
        self._processed += 1
        self._on_event(RunProgress(self._processed, len(self.records)))

    async def _resolve(self, position: int, record: TrackRecord) -> TrackRecord:
        identity = record.identity
        query = build_query(identity.artist, identity.title, record.file_name)
        if query is None:
            return self._unresolved(position, record, FailureReason.EMPTY_QUERY)
        record = replace(record, query=query)

        beatport_unavailable = False
        had_candidates = False
        try:
            found = await self._call(self._client.search(Source.BEATPORT, query.text))
        except ApiKeyRejectedError:
            return self._unresolved(position, record, FailureReason.SOURCE_UNAVAILABLE)
        except (SourceUnavailableError, ApiContractError) as exc:
            self._log_source_failure(position, Source.BEATPORT, exc)
            beatport_unavailable = True
        else:
            had_candidates = bool(found)
            classification = classify(query, found, self._thresholds)
            match classification.outcome:
                case Outcome.AUTO:
                    return await self._accept(position, record, Source.BEATPORT, classification.retained[0])
                case Outcome.GREY_ZONE:
                    return self._hold(position, record, Source.BEATPORT, classification.retained, beatport_unavailable=False)
                case Outcome.EMPTY:
                    pass

        try:
            found = await self._call(self._client.search(Source.BANDCAMP, query.text))
        except ApiKeyRejectedError:
            return self._unresolved(position, record, FailureReason.SOURCE_UNAVAILABLE)
        except (SourceUnavailableError, ApiContractError) as exc:
            self._log_source_failure(position, Source.BANDCAMP, exc)
            return self._unresolved(position, record, FailureReason.SOURCE_UNAVAILABLE)
        had_candidates = had_candidates or bool(found)
        # Beatport injoignable : Bandcamp ne valide jamais seul (decision du 2026-09-19).
        classification = classify(query, found, self._thresholds, allow_auto=not beatport_unavailable)
        match classification.outcome:
            case Outcome.AUTO:
                return await self._accept(position, record, Source.BANDCAMP, classification.retained[0])
            case Outcome.GREY_ZONE:
                return self._hold(position, record, Source.BANDCAMP, classification.retained, beatport_unavailable=beatport_unavailable)
            case Outcome.EMPTY:
                reason = FailureReason.BELOW_THRESHOLD if had_candidates else FailureReason.NO_RESULT
                return self._unresolved(position, record, reason)

    async def _accept(self, position: int, record: TrackRecord, source: Source, chosen: ScoredCandidate) -> TrackRecord:
        candidate = await self._refetch(position, source, chosen.candidate)
        artwork = await self._artwork(position, candidate)
        logger.info(
            "candidate retained run=%s track=%d source=%s score=%.0f status=resolved",
            self._run_id,
            position,
            source,
            chosen.score,
        )
        return replace(
            record,
            state=TrackState.RESOLVED,
            resolution=Resolution.AUTO,
            source=source,
            candidate=candidate,
            scored=chosen,
            artwork=artwork,
        )

    def _hold(
        self,
        position: int,
        record: TrackRecord,
        source: Source,
        candidates: tuple[ScoredCandidate, ...],
        *,
        beatport_unavailable: bool,
    ) -> TrackRecord:
        logger.info(
            "arbitration required run=%s track=%d source=%s score=%.0f status=grey_zone",
            self._run_id,
            position,
            source,
            candidates[0].score,
        )
        return replace(record, arbitration=PendingArbitration(source, candidates, beatport_unavailable))

    def _unresolved(self, position: int, record: TrackRecord, reason: FailureReason) -> TrackRecord:
        logger.info(
            "track unresolved run=%s track=%d status=unresolved reason=%s",
            self._run_id,
            position,
            reason,
        )
        return replace(
            record,
            state=TrackState.UNRESOLVED,
            resolution=Resolution.NONE,
            failure_reason=reason,
        )

    async def _refetch(self, position: int, source: Source, candidate: TrackCandidate) -> TrackCandidate:
        """Metadonnees completes ; l'objet de recherche est garde si le refetch echoue."""
        try:
            match source:
                case Source.BEATPORT if candidate.id:
                    return await self._call(self._client.fetch_beatport_track(candidate.id))
                case Source.BANDCAMP if candidate.url:
                    return await self._call(self._client.fetch_bandcamp_track(candidate.url))
                case _:
                    return candidate
        except (ApiKeyRejectedError, SourceUnavailableError, TrackNotFoundError, ApiContractError) as exc:
            logger.warning(
                "refetch failed, search candidate kept run=%s track=%d source=%s reason=%s",
                self._run_id,
                position,
                source,
                exc.code,
            )
            return candidate

    async def _artwork(self, position: int, candidate: TrackCandidate) -> Path | None:
        url = candidate.release.artwork_url if candidate.release else None
        if url is None:
            return None
        try:
            return await self._artworks.fetch(url)
        except ArtworkUnavailableError as exc:
            logger.warning(
                "artwork unavailable run=%s track=%d reason=%s",
                self._run_id,
                position,
                exc.reason,
            )
            return None

    async def _call[T](self, request: Awaitable[T]) -> T:
        """Point de passage de chaque appel a l'API : la garde des 403 s'y branche."""
        return await request

    def _log_source_failure(self, position: int, source: Source, exc: SourceUnavailableError | ApiContractError) -> None:
        if isinstance(exc, SourceUnavailableError):
            logger.warning(
                "source unavailable run=%s track=%d source=%s status=%s reason=%s request_id=%s",
                self._run_id,
                position,
                source,
                exc.status,
                exc.reason,
                exc.request_id,
            )
```

`_call` ne fait encore que relayer l'appel : la Task 2 y branche la garde des 403 et la remontée des contrats cassés à Sentry. Un `ApiContractError` n'est donc pas encore logué à cette étape, ce que la Task 2 corrige.

- [ ] **Step 6: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_tagging_outcomes.py tests/unit/test_tagging_run.py -x -q`
Expected: PASS, 14 tests

- [ ] **Step 7: Gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert. Les lignes de plus de 100 caractères du module sont à replier par `ruff format`, sans changer le code.

- [ ] **Step 8: Commit**

```bash
git add sidecar/src/tagger/tagging.py sidecar/tests/helpers/tagging_api.py sidecar/tests/unit/test_tagging_outcomes.py sidecar/tests/unit/test_tagging_run.py
git commit -m "feat(tagging): resoudre les morceaux d'un dossier sur Beatport puis Bandcamp"
```

---

## Task 2: Garde des 403 et contrats cassés

**Files:**
- Modify: `sidecar/src/tagger/tagging.py`
- Test: `sidecar/tests/unit/test_tagging_run.py`

**Interfaces:**
- Consumes: `_Runner._call`, `run_tagging` (Task 1)
- Produces: `API_KEY_REJECTION_LIMIT: Final = 3`, `ApiKeyRejectedRunError()` (code `api_key_rejected`), `_RejectionGuard` (`rejected()`, `answered()`)

- [ ] **Step 1: Écrire les tests**

Dans `sidecar/tests/unit/test_tagging_run.py`, ajouter `from unittest.mock import patch`, `failing` à l'import de `tagging_api`, et `ApiKeyRejectedRunError`, `TrackState`, `_RejectionGuard` à l'import de `tagger.tagging`, puis :

```python
async def test_stops_the_run_after_three_consecutive_rejections_of_the_key(
    tmp_path: Path,
) -> None:
    folder = tmp_path / "music"
    for index in range(5):
        tagged_mp3(folder, f"{index}.mp3", "Adam Beyer", f"Track {index}")
    api = FakeApi()
    api.on("/beatport/search", "*", failing(403))
    events: list[RunEvent] = []

    with pytest.raises(ApiKeyRejectedRunError):
        await run(folder, api, events=events)

    resolved = [event for event in events if isinstance(event, TrackResolved)]
    assert all(event.record.state is not TrackState.RESOLVED for event in resolved)


async def test_resets_the_rejection_count_on_any_other_answer() -> None:
    guard = _RejectionGuard()
    guard.rejected()
    guard.rejected()
    guard.answered()

    guard.rejected()
    guard.rejected()

    with pytest.raises(ApiKeyRejectedRunError):
        guard.rejected()


async def test_reports_an_api_contract_error_to_sentry(tmp_path: Path) -> None:
    folder = tmp_path / "music"
    tagged_mp3(folder, "a.mp3", "Adam Beyer", "Your Mind")
    broken = track_payload()
    del broken["title"]
    api = FakeApi()
    api.on("/beatport/search", "*", found(broken))

    with patch("tagger.tagging.sentry_sdk.capture_exception", autospec=True) as capture:
        await run(folder, api)

    capture.assert_called_once()
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_tagging_run.py -x -q`
Expected: FAIL, `ImportError: cannot import name 'ApiKeyRejectedRunError' from 'tagger.tagging'`

- [ ] **Step 3: Implémenter la garde**

Dans `sidecar/src/tagger/tagging.py`, ajouter `import sentry_sdk` aux imports tiers, `from tagger.errors import TaggerError` aux imports du projet, `ClassVar` et `Final` à l'import `typing`, puis après `logger` :

```python
# Trois 403 consecutifs arretent le run (ARCHITECTURE.md § Cle API invalide ou revoquee).
API_KEY_REJECTION_LIMIT: Final = 3
```

Après la définition de `RunEvent` :

```python
class ApiKeyRejectedRunError(TaggerError):
    """Run arrete apres trois 403 consecutifs : la cle est a corriger dans les Settings."""

    code: ClassVar[str] = "api_key_rejected"

    def __init__(self) -> None:
        super().__init__("run stopped after repeated api key rejections")
```

Avant `class _Runner` :

```python
class _RejectionGuard:
    """Compte les 403 consecutifs, remis a zero par toute autre reponse de l'API."""

    def __init__(self) -> None:
        self._consecutive = 0

    def rejected(self) -> None:
        """Un 403 de plus ; au troisieme d'affilee, le run s'arrete."""
        self._consecutive += 1
        if self._consecutive >= API_KEY_REJECTION_LIMIT:
            raise ApiKeyRejectedRunError()

    def answered(self) -> None:
        """Toute reponse de l'API qui n'est pas un 403 prouve que la cle est acceptee."""
        self._consecutive = 0
```

Dans `_Runner.__init__`, après `self._on_event = on_event` : `self._guard = _RejectionGuard()`.

Remplacer `_Runner._call` :

```python
    async def _call[T](self, request: Awaitable[T]) -> T:
        """Passe chaque appel par la garde des 403 et remonte un contrat casse a Sentry."""
        try:
            result = await request
        except ApiKeyRejectedError:
            self._guard.rejected()
            raise
        except ApiContractError as exc:
            self._guard.answered()
            logger.exception("api contract broken run=%s request_id=%s", self._run_id, exc.request_id)
            sentry_sdk.capture_exception(exc)
            raise
        except SourceUnavailableError as exc:
            # Une erreur reseau n'est pas une reponse : elle ne remet pas la garde a zero.
            if exc.status is not None:
                self._guard.answered()
            raise
        except TrackNotFoundError:
            self._guard.answered()
            raise
        self._guard.answered()
        return result
```

Dans `run_tagging`, envelopper le `TaskGroup` :

```python
    try:
        async with asyncio.TaskGroup() as group:
            for position, record in enumerate(records, start=1):
                group.create_task(runner.process(position, record), name=f"track:{position}")
    except* ApiKeyRejectedRunError:
        raise ApiKeyRejectedRunError from None
```

Le `TaskGroup` annule les autres morceaux dès qu'une tâche lève l'erreur de run, et la rend dans un `ExceptionGroup` : `except*` la relève seule, pour que le handler du sub-project 07 la traite comme toute erreur métier.

- [ ] **Step 4: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_tagging_run.py tests/unit/test_tagging_outcomes.py -x -q`
Expected: PASS, 17 tests

- [ ] **Step 5: Gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 6: Commit**

```bash
git add sidecar/src/tagger/tagging.py sidecar/tests/unit/test_tagging_run.py
git commit -m "feat(tagging): arreter le run apres trois refus de la cle API"
```

---

## Task 3: Documentation de la panne Beatport

**Files:**
- Modify: `docs/ARCHITECTURE.md` (§ Chaîne de résolution d'un morceau, § Flux d'un run, arborescence)
- Modify: `docs/adrs/009-enchainement-sources-et-arbitrage.md` (§ Notes complémentaires)
- Modify: `docs/adrs/010-ecriture-batch-et-plan-de-run.md` (§ Notes complémentaires)

- [ ] **Step 1: ARCHITECTURE.md**

Sous le paragraphe qui suit le diagramme de la chaîne de résolution (« Trois états après interrogation d'une source… »), ajouter :

```markdown
**Beatport injoignable** (décision du 2026-09-19) : une fois les nouvelles tentatives du client épuisées, ou sur une réponse hors contrat, Bandcamp est interrogé, mais tout ce qu'il trouve part en zone grise, jamais en validation automatique. L'utilisateur confirme en sachant que la source la plus riche n'a pas répondu. Si Bandcamp échoue aussi, le morceau part en `unresolved` / `source_unavailable`.
```

Dans le diagramme mermaid de la même section, ajouter la branche de panne à côté du vide, pour que le contrat visuel dise la même chose que la prose :

```mermaid
    bp -->|"injoignable"| bcp["Bandcamp, sans validation automatique"]
    bcp -->|"candidats"| m3
    bcp -->|"vide ou en panne"| kos["unresolved<br/>failure_reason = source_unavailable"]
    kos --> url
    style kos fill:#4a2d2d,color:#fff
```

Dans le diagramme de séquence § Flux d'un run, remplacer la ligne `S->>S: écriture de la décision dans le plan JSON` par `S->>S: décision gardée en mémoire (plan JSON : Feature 6)`.

Dans l'arborescence § Organisation du Code, ajouter sous `cache.py` :

```text
│   │   ├── tagging.py                    # pipeline de résolution d'un run, état en mémoire
```

- [ ] **Step 2: ADR-009**

À la fin des Notes complémentaires, ajouter :

```markdown
**Panne Beatport** (2026-09-19) : l'ADR ne déclenche Bandcamp que sur un vide ou un refus. Une panne Beatport n'est ni l'un ni l'autre, et l'appel n'a rien de spéculatif puisque Beatport n'a rien pu dire : Bandcamp est donc interrogé, mais sans validation automatique, chaque candidat passant par l'arbitrage. Une panne touche en général tout le run : sans repli, tout le run resterait en échec ; avec un repli automatique, il serait écrit en silence avec la source la moins riche.
```

- [ ] **Step 3: ADR-010**

À la fin des Notes complémentaires, ajouter :

```markdown
**État du run en mémoire jusqu'à la Feature 6** (2026-09-19) : le pipeline de la Feature 2 tient ses décisions dans des dataclasses gelées, sans écrire de plan JSON. La règle de l'ADR tient, aucun fichier musical n'est touché avant la confirmation globale ; seule l'écriture du plan au fil de l'eau recule jusqu'à la feature qui en a les lecteurs, la reprise et le rapport. Le versionnement d'[ADR-018](018-versionnement-plan-de-run.md) s'applique à ce moment-là.
```

- [ ] **Step 4: Commit**

```bash
git add docs/ARCHITECTURE.md docs/adrs/009-enchainement-sources-et-arbitrage.md docs/adrs/010-ecriture-batch-et-plan-de-run.md
git commit -m "docs: repli sur Bandcamp sans validation automatique quand Beatport est injoignable"
```

---

## Task 4: Taille de page de la recherche

Décision du propriétaire du 2026-09-21 (spec § À trancher) : la recherche demande `10` candidats par page. Le scoring ne retient que les premiers rangs, et une page de 100 transférait 77 Ko par recherche pour n'en lire qu'une poignée.

**Files:**
- Modify: `sidecar/src/tagger/scraper_client.py` (`search`)
- Modify: `sidecar/tests/unit/test_scraper_client_requests.py`

- [ ] **Step 0: Précondition, à vérifier avant d'écrire une ligne**

Le paramètre `limit` existe depuis la `3.2.0` de techno-scraper, déployée le 2026-09-22. Une prod antérieure (`3.1.4`, `extra="forbid"`) rejette tout paramètre inconnu : `limit` y rend `422` sur **chaque** recherche, donc un run entier sans aucun candidat. Vérifier avant d'écrire une ligne :

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "X-API-Key: <clé>" \
  "https://techno-scraper.empiricmind.fr/beatport/search?q=test&limit=10"
```

`200` : la tâche peut commencer. `422` : la gateway n'est pas déployée, **laisser cette tâche non cochée et ne rien implémenter**. Les tâches 1 à 3 tiennent sans elle, le défaut de la gateway s'appliquant.

- [ ] **Step 1: Write the failing test**

Dans `sidecar/tests/unit/test_scraper_client_requests.py`, le test paramétré existant vérifie déjà les paramètres envoyés aux deux routes : y ajouter `limit` plutôt qu'écrire un second test qui ferait doublon. Le renommer pour qu'il dise ce qu'il vérifie :

```python
async def test_sends_a_search_to_its_source_route_with_the_query_type_and_page_size(
    requests: list[httpx2.Request], source: SearchSource, query: str, route: str
) -> None:
    """La route porte la source, et l'en-tete de cle part sur chacune des deux."""
    async with make_client(_recording(requests, page_payload())) as client:
        await client.search(source, query)

    assert requests[0].url.host == "techno-scraper.empiricmind.fr"
    assert requests[0].url.path == route
    assert dict(requests[0].url.params) == {"q": query, "type": "tracks", "limit": "10"}
    assert requests[0].headers["X-API-Key"] == TEST_API_KEY
```

- [ ] **Step 2: Run test to verify it fails**

Run: `just test`
Expected: FAIL sur les deux cas `beatport` et `bandcamp`, le dict reçu n'ayant pas la clé `limit`.

- [ ] **Step 3: Write minimal implementation**

Dans `sidecar/src/tagger/scraper_client.py`, à côté de `QUERY_MAX_LENGTH` :

```python
# Valeur de l'énumération fermée de la gateway (5/10/25/50/100), défaut 25. Le scoring ne retient
# que les premiers rangs (mesuré le 2026-09-20 : candidat retenu aux rangs 1 à 3 sur dix recherches).
SEARCH_PAGE_SIZE: Final = 10
```

Et dans `search` :

```python
        params = {
            "q": query[:QUERY_MAX_LENGTH],
            "type": "tracks",
            "limit": str(SEARCH_PAGE_SIZE),
        }
```

`limit` reste le même à chaque appel et le client ne lit que la première page, sans jamais renvoyer de curseur : il ne peut donc déclencher ni `cursor_limit_mismatch` ni `cursor_scope_mismatch` (`.claude/rules/techno-scraper/contrat.md`).

Les entrées du cache disque sont indexées par route et paramètres (`cache.response_key`) : celles d'avant ce changement ne seront plus relues et expireront seules, le cache étant jetable (ADR-013).

- [ ] **Step 4: Run test to verify it passes**

Run: `just test && just lint && just typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sidecar/src/tagger/scraper_client.py sidecar/tests/unit/test_scraper_client_requests.py
git commit -m "feat(tagging): demander dix candidats par recherche"
```
