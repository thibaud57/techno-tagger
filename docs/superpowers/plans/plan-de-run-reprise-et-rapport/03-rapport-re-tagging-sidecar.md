# Rapport de re-tagging : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Écrire à la fin de chaque phase d'écriture un rapport de re-tagging JSON et Markdown dans le dossier du run, l'inscrire dans un registre local et savoir le relire.

**Architecture:**
- `tagging_report.py` porte le modèle versionné `TaggingReport`, construit par une fonction pure à partir de l'instantané du run. Il porte aussi le rendu Markdown, l'écriture atomique (via les briques de `reports.py`, rendues publiques) et la relecture. Ses projections de lignes de tags servent aussi à `handlers.py`, pour `run_started` et `track_resolved`.
- `report_index.py` tient le registre `appLocalDataDir()/reports.json`.
- `handlers.py` écrit le rapport à la fin de `commit_run` et de chaque `retry_write`, garde les noms choisis et les chemins écrits sur le `CurrentRun` et inscrit le rapport au registre. Un échec de rapport est loggué, sans jamais casser la phase.

**Tech Stack:** Python 3.14, pydantic 2, pytest + pytest-asyncio. Helpers `tagging_api`, `scraper_responses`, `tagging_records`, `ndjson_loop`, `stubs`.

**Spec:** `docs/superpowers/specs/plan-de-run-reprise-et-rapport/03-rapport-re-tagging-sidecar-design.md`

## Global Constraints

- **Dépend du sub-project 01, implémenté avant** : `run_files.write_atomically`, `plan.PlanScores` et `handle_commit_run` qui confirme le plan avant `writer.write()`.
- **Fichiers** : `tagging-report-<YYYYMMDDTHHMMSSZ>.json` et `.md` dans le dossier du run. Suffixe `-2`, `-3`… si le couple existe, choisi au premier passage puis gardé, même quand cette première écriture échoue. `kind` vaut `"tagging"` et `schema_version` 1.
- **Moments d'écriture** : à la fin de `commit_run`, puis à la fin de chaque `retry_write`, toujours dans les mêmes fichiers. Jamais après un rollback : un `retry_write` qui suit un rollback partiel réécrit le rapport, le morceau restauré y figure en `rolled_back`.
- **Écriture atomique** : JSON et Markdown passent par `run_files.write_atomically`, l'`OSError` devient une `ReportWriteError`.
- **Rapport impossible à écrire** : log ERROR `tagging report not written run=<run_id> reason=report_write_failed errno=<errno>`, sans trace (celle d'un `OSError` porte le chemin complet sous le profil Windows). Jamais d'exception et la phase se termine normalement. Le registre n'est pas touché.
- **Relecture** : la migration se posera dans un `@model_validator(mode="before")`, aucune n'est écrite. Une version supérieure, un JSON illisible ou un modèle invalide lèvent `TaggingReportUnreadableError`, code `tagging_report_unreadable`, `params` = `file`, `found`, `expected`.
- **Registre** : `app_data_dir() / "reports.json"`, `schema_version` 1, entrées `run_id`, `written_at`, `folder`, `report_path`. Une entrée par `run_id`, la dernière remplace. Il se liste du plus récent au plus ancien, sans les rapports disparus. Absent, il se lit vide. Corrompu ou d'une version inconnue, il se lit vide avec un log ERROR et repart de zéro. S'il ne se lit pas (`OSError`), l'inscription est sautée avec un log WARNING et le fichier n'est pas réécrit. Il n'est jamais purgé.
- **Contenu** : scores du candidat retenu seul, valeurs brutes. Jamais de clé API ni de chemin de cache.
- **Rapport en anglais** : JSON et Markdown, pas de traduction.
- **Code Python sans accents**, docstrings et commentaires en français, le pourquoi seulement.
- **Tests** : noms en anglais, AAA (l'Act est l'appel testé), `tmp_path`, `@pytest.mark.asyncio` sur les tests async.
- **Gate vert à chaque commit** : `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar`, plus `just lint-ui` quand un JSON de langue change. Commits `type(scope): description`, scope `sidecar`.

## Review Focus

- **Run confirmé avec un arbitrage resté en attente** : le morceau compte en `not_processed` et apparaît dans la section « Not processed » (Task 1 `test_counts_each_outcome_on_its_state`, Task 2 `test_renders_each_track_in_the_section_of_its_outcome`).
- **Valeur qui casse un tableau Markdown** (titre contenant `|` ou un retour ligne) : elle est échappée et la table reste valide (Task 2, `test_escapes_a_value_that_would_break_a_table`).
- **Rollback partiel puis `retry_write`** : le morceau restauré est rapporté en `rolled_back`, sans source ni score et compté (Task 4, `test_reports_a_restored_track_after_a_partial_rollback`).
- **Registre corrompu, ou que le système refuse de lire** : un JSON tronqué se lit vide et l'inscription suivante le réécrit, une erreur de lecture saute l'inscription sans écraser l'historique (Task 3, `test_starts_over_from_an_unreadable_index` et `test_leaves_an_index_it_cannot_read_untouched`).
- **Rapport impossible à écrire, y compris Markdown seul refusé après le JSON** : `run_finished` arrive, le registre n'est pas touché et la relance réécrit le même couple sans créer de `-2` (Task 4, `test_finishes_the_write_phase_when_the_report_cannot_be_written` et `test_keeps_one_pair_of_files_when_the_markdown_was_refused_once`).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `sidecar/src/tagger/reports.py` | Briques communes rendues publiques : `unused_report_paths(folder, file_stem, stamp)`, `escape_markdown`, `table_section`, `table_row`, `format_instant` |
| `sidecar/src/tagger/tagging_report.py` | Modèle, projections de lignes de tags, construction, rendu Markdown, noms, écriture, relecture, erreur |
| `sidecar/src/tagger/report_index.py` | Registre `reports.json` |
| `sidecar/src/tagger/handlers.py` | Écriture du rapport en fin de phase, noms et chemins sur `CurrentRun`, inscription au registre, lignes de tags déléguées à `tagging_report` |
| `public/i18n/{fr,en}.json` | `errors.tagging_report_unreadable` |
| `sidecar/tests/helpers/tagging_report_samples.py` | Run couvrant toutes les issues |
| `sidecar/tests/unit/test_tagging_report.py` | Modèle, compteurs, relecture, Markdown, écriture |
| `sidecar/tests/unit/test_report_index.py` | Registre |
| `sidecar/tests/integration/test_ndjson_write.py` | Rapport et registre de bout en bout |
| `docs/ARCHITECTURE.md` | Arborescence, § Données |

---

### Task 1: Modèle du rapport, construction et relecture

**Files:**
- Create: `sidecar/src/tagger/tagging_report.py`
- Create: `sidecar/tests/helpers/tagging_report_samples.py`
- Modify: `sidecar/src/tagger/handlers.py` (`_tags_before`, `_tags_after`, `_payload_rows`, imports)
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`
- Test: `sidecar/tests/unit/test_tagging_report.py`

**Interfaces:**
- Consumes :
  - `tagging.TaggingRun`, `TrackRecord`, `TrackState`, `Resolution`, `FailureReason` ;
  - `file_failures.FileFailureReason` ;
  - `files.TagField`, `TagSystem`, `project_tags`, `after_tags`, `shown_key`, `tag_system_of` ;
  - `matching.MatchingThresholds`, `QueryOrigin`, `credited_artists`, `full_title` ;
  - `plan.PlanScores` (sub-project 01) ;
  - `scraper_client.Source`.
- Produces :
  - `tagging_report.SCHEMA_VERSION = 1`, `REPORT_KIND = "tagging"`, `FILE_STEM = "tagging-report"` ;
  - les modèles `ReportQuery`, `ReportTagValue`, `ReportThresholds`, `TaggingReportCounts`, `TaggingReportTrack` (dont `system: TagSystem | None`), `TaggingReport` ;
  - `build_tagging_report(run: TaggingRun, thresholds: MatchingThresholds, generated_at: datetime) -> TaggingReport` ;
  - `tag_rows(values: Mapping[TagField, str | None], system: TagSystem) -> tuple[ReportTagValue, ...]` ;
  - `after_rows(record: TrackRecord, candidate: TrackCandidate) -> tuple[ReportTagValue, ...]` ;
  - `load_tagging_report(path: Path) -> TaggingReport` ;
  - `TaggingReportUnreadableError(path: Path, found: object = None)`.

- [ ] **Step 1: Écrire le run d'exemple**

`sidecar/tests/helpers/tagging_report_samples.py` :

```python
"""Run couvrant chaque issue, partage par les tests du rapport de re-tagging."""

from dataclasses import replace
from pathlib import Path
from typing import Final

from scraper_responses import payload_candidate
from tagging_records import RECORD, scored_candidate

from tagger.file_failures import FileFailureReason
from tagger.files import ShownTags, TagField, TagSystem, WrittenTags
from tagger.matching import QueryOrigin, TrackQuery
from tagger.scraper_client import Source
from tagger.tagging import (
    FailureReason,
    PendingArbitration,
    Resolution,
    TaggingRun,
    TrackRecord,
    WriteOutcome,
)

FOLDER: Final = Path("music")
QUERY: Final = TrackQuery("Adam Beyer", "Your Mind", QueryOrigin.TAGS)
# Toute la table, absente comprise : `after_tags` lit chaque champ d'origine.
BEFORE: Final = ShownTags(
    system=TagSystem.ID3,
    fields=dict.fromkeys(TagField) | {TagField.ARTIST: "adam beyer", TagField.TITLE: "your mind"},
    comment="ripped from vinyl",
)
CANDIDATE: Final = payload_candidate()
WRITTEN_AS: Final = "Adam Beyer - Your Mind (Extended Mix).mp3"


def _record(name: str) -> TrackRecord:
    return replace(RECORD, track_id=name, path=FOLDER / name, query=QUERY, tags_before=BEFORE)


def _resolved(name: str, resolution: Resolution, source: Source) -> TrackRecord:
    return _record(name).resolved(
        resolution, source, CANDIDATE, scored_candidate(candidate=CANDIDATE), None
    )


WRITTEN: Final = _resolved("a.mp3", Resolution.AUTO, Source.BEATPORT).written_to(
    FOLDER / WRITTEN_AS,
    WriteOutcome(WrittenTags((TagField.ARTIST, TagField.TITLE), artwork=True), truncated=True),
)
FAILED: Final = _resolved("b.mp3", Resolution.ARBITRATION, Source.BANDCAMP).write_failed(
    FileFailureReason.FILE_LOCKED, restorable=False
)
UNRESOLVED: Final = _record("c.mp3").unresolved(FailureReason.NO_RESULT)
WAITING: Final = _record("d.mp3")
HELD: Final = replace(
    _record("e.mp3"),
    arbitration=PendingArbitration(
        Source.BEATPORT, (scored_candidate(),), beatport_unavailable=False
    ),
)
# Ecrit puis restaure : `rolled_back` efface la source et le candidat, la resolution reste.
ROLLED_BACK: Final = (
    _resolved("f.mp3", Resolution.AUTO, Source.BEATPORT)
    .written_to(
        FOLDER / "f - renamed.mp3",
        WriteOutcome(WrittenTags((TagField.ARTIST,), artwork=False), truncated=False),
    )
    .rolled_back(FOLDER / "f.mp3")
)
RUN: Final = TaggingRun("a3f9c1", FOLDER, (WRITTEN, FAILED, UNRESOLVED, WAITING, HELD, ROLLED_BACK))
```

- [ ] **Step 2: Écrire les tests du modèle et de la relecture**

`sidecar/tests/unit/test_tagging_report.py` :

```python
"""Tests du rapport de re-tagging : modele, compteurs, relecture, rendu, ecriture."""

import json
from dataclasses import replace
from typing import TYPE_CHECKING

import pytest
from tagging_api import CREATED
from tagging_report_samples import CANDIDATE, RUN, WRITTEN, WRITTEN_AS

from tagger.file_failures import FileFailureReason
from tagger.files import TagField, TagSystem
from tagger.matching import DEFAULT_THRESHOLDS
from tagger.scraper_client import Source
from tagger.tagging import Resolution, TaggingRun, TrackState
from tagger.tagging_report import (
    TaggingReportCounts,
    TaggingReportUnreadableError,
    build_tagging_report,
    load_tagging_report,
)

if TYPE_CHECKING:
    from pathlib import Path


def test_records_what_was_written_for_each_track() -> None:
    report = build_tagging_report(RUN, DEFAULT_THRESHOLDS, CREATED)

    written = report.tracks[0]
    assert (written.file_before, written.file_after, written.truncated) == (
        "a.mp3",
        WRITTEN_AS,
        True,
    )
    assert written.query is not None
    assert written.query.text == "Adam Beyer Your Mind"
    assert (written.source, written.state, written.resolution) == (
        Source.BEATPORT,
        TrackState.WRITTEN,
        Resolution.AUTO,
    )
    assert written.scores is not None
    assert (written.scores.artist, written.scores.title) == (96.4, 91.6)
    assert written.url == CANDIDATE.url
    assert written.fields_written == (TagField.ARTIST, TagField.TITLE)
    assert written.artwork_written
    assert (written.system, written.comment_before) == (TagSystem.ID3, "ripped from vinyl")
    assert written.tags_before is not None
    assert written.tags_after is not None


def test_keeps_the_reason_of_a_failed_write_and_leaves_the_file_name() -> None:
    report = build_tagging_report(RUN, DEFAULT_THRESHOLDS, CREATED)

    failed = report.tracks[1]
    assert (failed.state, failed.failure_reason, failed.file_after) == (
        TrackState.WRITE_ERROR,
        FileFailureReason.FILE_LOCKED,
        None,
    )


def test_reports_a_restored_track_without_its_decision() -> None:
    report = build_tagging_report(RUN, DEFAULT_THRESHOLDS, CREATED)

    restored = report.tracks[5]
    assert (restored.state, restored.file_before, restored.file_after) == (
        TrackState.ROLLED_BACK,
        "f.mp3",
        None,
    )
    assert restored.tags_before is not None
    assert restored.system is TagSystem.ID3
    assert (
        restored.resolution,
        restored.source,
        restored.query,
        restored.scores,
        restored.url,
        restored.tags_after,
    ) == (None, None, None, None, None, None)
    assert restored.fields_written == ()


def test_leaves_the_system_empty_when_the_origin_was_unreadable() -> None:
    unreadable = replace(WRITTEN, tags_before=None)
    run = TaggingRun(RUN.run_id, RUN.folder, (unreadable,))

    report = build_tagging_report(run, DEFAULT_THRESHOLDS, CREATED)

    track = report.tracks[0]
    assert (track.system, track.tags_before, track.comment_before) == (None, None, None)
    assert track.tags_after is not None
    assert {row.key for row in track.tags_after} >= {"TPE1", "TIT2"}


def test_counts_each_outcome_on_its_state() -> None:
    report = build_tagging_report(RUN, DEFAULT_THRESHOLDS, CREATED)

    assert report.counts == TaggingReportCounts(
        written=1, write_error=1, unresolved=1, rolled_back=1, not_processed=2
    )


def test_reloads_the_report_it_wrote(tmp_path: Path) -> None:
    report = build_tagging_report(RUN, DEFAULT_THRESHOLDS, CREATED)
    path = tmp_path / "tagging-report.json"
    path.write_text(report.model_dump_json(indent=2), encoding="utf-8")

    reloaded = load_tagging_report(path)

    assert reloaded == report


def test_refuses_a_report_of_a_future_version(tmp_path: Path) -> None:
    path = tmp_path / "tagging-report.json"
    path.write_text(json.dumps({"schema_version": 2}), encoding="utf-8")

    with pytest.raises(TaggingReportUnreadableError) as refused:
        load_tagging_report(path)

    assert (refused.value.code, refused.value.params) == (
        "tagging_report_unreadable",
        {"file": path.name, "found": 2, "expected": 1},
    )


@pytest.mark.parametrize(
    "content",
    ["{not json", "[]", json.dumps({"schema_version": 1, "kind": "tagging"})],
    ids=["corrupt", "not-an-object", "invalid-model"],
)
def test_refuses_an_unreadable_report(tmp_path: Path, content: str) -> None:
    path = tmp_path / "tagging-report.json"
    path.write_text(content, encoding="utf-8")

    with pytest.raises(TaggingReportUnreadableError):
        load_tagging_report(path)
```

- [ ] **Step 3: Lancer les tests, ils échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_tagging_report.py --no-cov -q`
Expected: FAIL, `ModuleNotFoundError: No module named 'tagger.tagging_report'`

- [ ] **Step 4: Écrire le modèle, la construction et la relecture**

`sidecar/src/tagger/tagging_report.py` :

```python
"""Rapport de re-tagging d'un run (ADR-014) : JSON source de verite, relu par l'app pour
rouvrir un run passe et Markdown lisible hors application. En anglais, comme les logs.

Le rapport est permanent et se migre (ADR-018 option B) : la migration se posera dans un
`@model_validator(mode="before")` de `TaggingReport`, qui n'existe pas tant que la version 1
est la seule. Le plan de run, jetable, refuse au contraire une version inconnue.
"""

import json
from collections import Counter
from dataclasses import replace
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, ClassVar, Final, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, ValidationError

from tagger.errors import TaggerError
from tagger.file_failures import FileFailureReason
from tagger.files import TagField, TagSystem, after_tags, project_tags, shown_key, tag_system_of
from tagger.matching import QueryOrigin, credited_artists, full_title
from tagger.plan import PlanScores
from tagger.scraper_client import Source
from tagger.tagging import FailureReason, Resolution, TrackState

if TYPE_CHECKING:
    from collections.abc import Mapping
    from datetime import datetime

    from tagger.matching import MatchingThresholds
    from tagger.scraper_client import TrackCandidate
    from tagger.tagging import TaggingRun, TrackRecord

SCHEMA_VERSION: Final = 1
REPORT_KIND: Final = "tagging"
FILE_STEM: Final = "tagging-report"


class _ReportModel(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class ReportQuery(_ReportModel):
    text: str
    origin: QueryOrigin


class ReportTagValue(_ReportModel):
    field: TagField
    key: str
    value: str | None


class ReportThresholds(_ReportModel):
    floor: float
    ceiling: float


class TaggingReportCounts(_ReportModel):
    written: int
    write_error: int
    unresolved: int
    rolled_back: int
    # Jamais atteint, ou laisse en arbitrage a la confirmation : aucun `state`.
    not_processed: int


class TaggingReportTrack(_ReportModel):
    """Ce que le run a fait d'un morceau : de quoi rouvrir son recapitulatif sans rien relire.

    Un morceau restaure par rollback n'a plus de decision : seuls son fichier et ses tags
    d'origine restent.
    """

    track_id: str
    file_before: str
    file_after: str | None
    truncated: bool
    query: ReportQuery | None
    source: Source | None
    state: TrackState | None
    resolution: Resolution | None
    failure_reason: FailureReason | FileFailureReason | None
    # Forme du plan de run : un changement de `PlanScores` change aussi ce rapport.
    scores: PlanScores | None
    artist: str | None
    title: str | None
    url: str | None
    artwork_url: str | None
    # Systeme des tags d'origine, nul s'ils etaient illisibles : l'interface l'y lit.
    system: TagSystem | None
    tags_before: tuple[ReportTagValue, ...] | None
    comment_before: str | None
    tags_after: tuple[ReportTagValue, ...] | None
    fields_written: tuple[TagField, ...]
    artwork_written: bool


class TaggingReport(_ReportModel):
    schema_version: int = SCHEMA_VERSION
    kind: Literal["tagging"] = REPORT_KIND
    generated_at: AwareDatetime
    run_id: str
    folder: Path
    thresholds: ReportThresholds
    counts: TaggingReportCounts
    tracks: tuple[TaggingReportTrack, ...]


class TaggingReportUnreadableError(TaggerError):
    """Rapport illisible ou d'une version future ; une version passee se migre, jamais refusee."""

    code: ClassVar[str] = "tagging_report_unreadable"

    def __init__(self, path: Path, found: object = None) -> None:
        super().__init__(
            f"unreadable tagging report: {path.name}",
            file=path.name,
            found=found,
            expected=SCHEMA_VERSION,
        )


def build_tagging_report(
    run: TaggingRun, thresholds: MatchingThresholds, generated_at: datetime
) -> TaggingReport:
    # Chaque compteur se lit sur son `state`, jamais sur l'absence d'un autre (cf. `_run_finished`).
    # Aucun `resolved` apres la confirmation : l'ecriture le fait passer en written ou write_error.
    states = Counter(record.state for record in run.tracks)
    return TaggingReport(
        generated_at=generated_at,
        run_id=run.run_id,
        folder=run.folder,
        thresholds=ReportThresholds(floor=thresholds.floor, ceiling=thresholds.ceiling),
        counts=TaggingReportCounts(
            written=states[TrackState.WRITTEN],
            write_error=states[TrackState.WRITE_ERROR],
            unresolved=states[TrackState.UNRESOLVED],
            rolled_back=states[TrackState.ROLLED_BACK],
            not_processed=states[None],
        ),
        tracks=tuple(_track(record) for record in run.tracks),
    )


def load_tagging_report(path: Path) -> TaggingReport:
    """Relit un rapport ; une version future est refusee, un rapport plus ancien se migre ici."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise TaggingReportUnreadableError(path) from exc

    found = raw.get("schema_version") if isinstance(raw, dict) else None
    if not isinstance(found, int) or found > SCHEMA_VERSION:
        raise TaggingReportUnreadableError(path, found)
    try:
        return TaggingReport.model_validate(raw)
    except ValidationError as exc:
        raise TaggingReportUnreadableError(path, found) from exc


def tag_rows(
    values: Mapping[TagField, str | None], system: TagSystem
) -> tuple[ReportTagValue, ...]:
    """Lignes du detail dans l'ordre de la table, avec la cle du fichier ecrit."""
    return tuple(
        ReportTagValue(field=field, key=shown_key(field, system), value=value)
        for field, value in values.items()
    )


def after_rows(record: TrackRecord, candidate: TrackCandidate) -> tuple[ReportTagValue, ...]:
    """Colonne Apres : sans origine lisible, le systeme se deduit de l'extension."""
    before = record.tags_before
    system = tag_system_of(record.path) if before is None else before.system
    return tag_rows(after_tags(project_tags(candidate), before), system)


def _track(record: TrackRecord) -> TaggingReportTrack:
    if record.state is TrackState.ROLLED_BACK:
        # La restauration efface source, candidat et pochette du run vivant mais garde la voie et
        # la requete, que l'ecran masque : le rapport ne les garde pas non plus.
        record = replace(record, resolution=None, query=None)
    candidate, written, query, before = (
        record.candidate,
        record.written,
        record.query,
        record.tags_before,
    )
    release = None if candidate is None else candidate.release
    return TaggingReportTrack(
        track_id=record.track_id,
        file_before=record.track_id,
        # Le renommage garde le dossier : seul le nom change, `path` peut porter le prefixe `\\?\`.
        file_after=None
        if written is None
        else (PurePosixPath(record.track_id).parent / record.path.name).as_posix(),
        truncated=written is not None and written.truncated,
        query=None if query is None else ReportQuery(text=query.text, origin=query.origin),
        source=record.source,
        state=record.state,
        resolution=record.resolution,
        failure_reason=record.failure_reason,
        scores=None if record.scored is None else PlanScores.of(record.scored),
        artist=None if candidate is None else credited_artists(candidate),
        title=None if candidate is None else full_title(candidate),
        url=None if candidate is None else candidate.url,
        artwork_url=None if release is None else release.artwork_url,
        system=None if before is None else before.system,
        tags_before=None if before is None else tag_rows(before.fields, before.system),
        comment_before=None if before is None else before.comment,
        tags_after=None if candidate is None else after_rows(record, candidate),
        fields_written=() if written is None else written.written.fields,
        artwork_written=written is not None and written.written.artwork,
    )
```

- [ ] **Step 5: Faire déléguer `handlers.py` à ces projections**

Les lignes de tags de `run_started` et `track_resolved` et celles du rapport ne doivent avoir qu'une seule projection. Dans `sidecar/src/tagger/handlers.py` :

1. Supprimer la ligne `from tagger.files import after_tags, project_tags, shown_key, tag_system_of`.
2. Ajouter, après `from tagger.tagging import open_run, resolve_run` :

```python
from tagger.tagging_report import after_rows, tag_rows
```

3. Dans le bloc `TYPE_CHECKING`, remplacer `from collections.abc import Callable, Mapping` par `from collections.abc import Callable, Iterable`, remplacer `from tagger.files import ShownTags, TagField, TagSystem` par `from tagger.files import ShownTags` et ajouter :

```python
    from tagger.tagging_report import ReportTagValue
```

4. Remplacer `_tags_before`, `_tags_after` et `_rows` par :

```python
def _tags_before(shown: ShownTags) -> TagsBeforePayload:
    return TagsBeforePayload(
        system=shown.system,
        comment=shown.comment,
        fields=_payload_rows(tag_rows(shown.fields, shown.system)),
    )


def _tags_after(record: TrackRecord, candidate: TrackCandidate) -> tuple[TagValuePayload, ...]:
    return _payload_rows(after_rows(record, candidate))


def _payload_rows(rows: Iterable[ReportTagValue]) -> tuple[TagValuePayload, ...]:
    """Une seule projection des lignes pour l'ecran et le rapport, ici seulement convertie."""
    return tuple(TagValuePayload(field=row.field, key=row.key, value=row.value) for row in rows)
```

- [ ] **Step 6: Ajouter la traduction du code**

Dans `public/i18n/fr.json`, section `errors`, après `"tag_dump_unreadable"` :

```json
    "tagging_report_unreadable": "Ce rapport de run est illisible, ou vient d'une version plus récente de l'application.\nMettez l'application à jour, puis rouvrez-le.",
```

Dans `public/i18n/en.json`, au même emplacement :

```json
    "tagging_report_unreadable": "This run report is unreadable, or comes from a newer version of the application.\nUpdate the application, then open it again.",
```

- [ ] **Step 7: Lancer les tests, ils passent**

Run: `cd sidecar && uv run pytest tests/unit/test_tagging_report.py tests/unit/test_error_translations.py tests/unit/test_protocol_tagging.py tests/integration/test_ndjson_tagging.py --no-cov -q`
Expected: PASS. Les tests de traduction du protocole existants gardent la projection déléguée.

- [ ] **Step 8: Gate et commit**

Run: `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar && just lint-ui`
Expected: tout vert

```bash
git add sidecar/src/tagger/tagging_report.py sidecar/src/tagger/handlers.py sidecar/tests/helpers/tagging_report_samples.py sidecar/tests/unit/test_tagging_report.py public/i18n/fr.json public/i18n/en.json
git commit -m "feat(sidecar): modele versionne du rapport de re-tagging et relecture"
```

---

### Task 2: Rendu Markdown et écriture des fichiers

**Files:**
- Modify: `sidecar/src/tagger/reports.py` (briques publiques, `unused_report_paths` prend le préfixe)
- Modify: `sidecar/src/tagger/tagging_report.py`
- Test: `sidecar/tests/unit/test_tagging_report.py`

**Interfaces:**
- Consumes: `TaggingReport`, `build_tagging_report`, `FILE_STEM` (Task 1) ; `run_files.write_atomically` (sub-project 01).
- Produces :
  - `reports.unused_report_paths(folder: Path, file_stem: str, stamp: str) -> ReportPaths` ;
  - `reports.escape_markdown`, `reports.table_section`, `reports.table_row`, `reports.format_instant` ;
  - `tagging_report.render_tagging_markdown(report: TaggingReport) -> str` ;
  - `tagging_report.report_paths(folder: Path, generated_at: datetime) -> ReportPaths` ;
  - `tagging_report.write_tagging_report(run: TaggingRun, thresholds: MatchingThresholds, generated_at: datetime, paths: ReportPaths) -> None`, qui lève `ReportWriteError`.

- [ ] **Step 1: Écrire les tests**

Dans `sidecar/tests/unit/test_tagging_report.py`, fusionner les imports suivants avec ceux de la Task 1, en gardant l'ordre alphabétique des modules (`tagger.reports` précède `tagger.scraper_client`) :

```python
from tagging_report_samples import CANDIDATE, RUN, WRITTEN, WRITTEN_AS

from tagger import tagging_report
from tagger.files import TagField, TagSystem, WrittenTags
from tagger.reports import ReportWriteError
from tagger.run_files import write_atomically
from tagger.tagging import Resolution, TaggingRun, TrackState, WriteOutcome
from tagger.tagging_report import (
    TaggingReportCounts,
    TaggingReportUnreadableError,
    build_tagging_report,
    load_tagging_report,
    render_tagging_markdown,
    report_paths,
    write_tagging_report,
)
```

Puis ajouter :

```python
def _section(markdown: str, title: str) -> str:
    """Texte d'une section `## <title>`, jusqu'a la suivante."""
    _, _, tail = markdown.partition(f"## {title}\n")
    return tail.split("\n## ", 1)[0]


def test_renders_each_track_in_the_section_of_its_outcome() -> None:
    markdown = render_tagging_markdown(build_tagging_report(RUN, DEFAULT_THRESHOLDS, CREATED))

    assert WRITTEN_AS in _section(markdown, "Written")
    assert "b.mp3" in _section(markdown, "Write errors")
    assert "c.mp3" in _section(markdown, "Unresolved")
    assert "f.mp3" in _section(markdown, "Rolled back")
    not_processed = _section(markdown, "Not processed")
    assert "d.mp3" in not_processed
    assert "e.mp3" in not_processed


def test_leaves_out_an_empty_section() -> None:
    run = TaggingRun(RUN.run_id, RUN.folder, (WRITTEN,))

    markdown = render_tagging_markdown(build_tagging_report(run, DEFAULT_THRESHOLDS, CREATED))

    assert "## Unresolved" not in markdown
    assert "## Write errors" not in markdown
    assert "## Rolled back" not in markdown


def test_flags_the_route_the_cover_and_the_truncation_of_a_written_track() -> None:
    markdown = render_tagging_markdown(build_tagging_report(RUN, DEFAULT_THRESHOLDS, CREATED))

    written = _section(markdown, "Written")
    assert "| auto |" in written
    assert "| written |" in written
    assert "| yes |" in written


def test_flags_a_cover_the_source_offered_but_that_was_not_written() -> None:
    without_cover = replace(
        WRITTEN,
        written=WriteOutcome(WrittenTags((TagField.ARTIST,), artwork=False), truncated=False),
    )
    run = TaggingRun(RUN.run_id, RUN.folder, (without_cover,))

    markdown = render_tagging_markdown(build_tagging_report(run, DEFAULT_THRESHOLDS, CREATED))

    written = _section(markdown, "Written")
    assert "| missing |" in written
    assert "| yes |" not in written


def test_escapes_a_value_that_would_break_a_table() -> None:
    piped = replace(WRITTEN, track_id="a | b\nc.mp3")
    run = TaggingRun(RUN.run_id, RUN.folder, (piped,))

    markdown = render_tagging_markdown(build_tagging_report(run, DEFAULT_THRESHOLDS, CREATED))

    assert "a \\| b c.mp3" in markdown


def test_warns_about_wav_files_once_one_is_written() -> None:
    wav = replace(WRITTEN, path=RUN.folder / "Adam Beyer - Your Mind.wav")
    run = TaggingRun(RUN.run_id, RUN.folder, (wav,))

    markdown = render_tagging_markdown(build_tagging_report(run, DEFAULT_THRESHOLDS, CREATED))

    assert "## WAV files" in markdown


def test_writes_the_json_and_markdown_reports_in_the_folder(tmp_path: Path) -> None:
    run = TaggingRun(RUN.run_id, tmp_path, RUN.tracks)
    paths = report_paths(tmp_path, CREATED)

    write_tagging_report(run, DEFAULT_THRESHOLDS, CREATED, paths)

    assert paths.json_path == tmp_path / "tagging-report-20261006T211403Z.json"
    assert paths.markdown_path.read_text(encoding="utf-8").startswith("# Tagging report")
    assert load_tagging_report(paths.json_path).run_id == RUN.run_id


def test_rewrites_the_same_pair_of_files(tmp_path: Path) -> None:
    run = TaggingRun(RUN.run_id, tmp_path, RUN.tracks)
    paths = report_paths(tmp_path, CREATED)
    write_tagging_report(run, DEFAULT_THRESHOLDS, CREATED, paths)

    write_tagging_report(run, DEFAULT_THRESHOLDS, CREATED, paths)

    assert sorted(path.name for path in tmp_path.iterdir()) == [
        "tagging-report-20261006T211403Z.json",
        "tagging-report-20261006T211403Z.md",
    ]


def test_names_the_next_free_pair_when_one_already_exists(tmp_path: Path) -> None:
    (tmp_path / "tagging-report-20261006T211403Z.json").write_text("{}", encoding="utf-8")

    paths = report_paths(tmp_path, CREATED)

    assert paths.json_path.name == "tagging-report-20261006T211403Z-2.json"
    assert paths.markdown_path.name == "tagging-report-20261006T211403Z-2.md"


def test_logs_a_json_left_without_its_markdown(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    def refuse_markdown(path: Path, text: str) -> None:
        if path.suffix == ".md":
            raise OSError(28, "No space left on device")
        write_atomically(path, text)

    monkeypatch.setattr(tagging_report, "write_atomically", refuse_markdown)
    run = TaggingRun(RUN.run_id, tmp_path, RUN.tracks)
    paths = report_paths(tmp_path, CREATED)

    with pytest.raises(ReportWriteError):
        write_tagging_report(run, DEFAULT_THRESHOLDS, CREATED, paths)

    assert paths.json_path.is_file()
    assert "json report orphaned by a failed markdown write run=a3f9c1" in caplog.messages
```

- [ ] **Step 2: Lancer les tests, ils échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_tagging_report.py --no-cov -q`
Expected: FAIL, `ImportError: cannot import name 'render_tagging_markdown'`

- [ ] **Step 3: Rendre publiques les briques de `reports.py`**

Dans `sidecar/src/tagger/reports.py` :

1. Renommer `_format_instant`, `_escape_markdown`, `_table_section` et `_table_row` en `format_instant`, `escape_markdown`, `table_section` et `table_row` :

```bash
sed -i -E 's/\b_(format_instant|escape_markdown|table_section|table_row)\b/\1/g' sidecar/src/tagger/reports.py
```

2. Remplacer `_unused_report_paths` par la version ci-dessous :

```python
def unused_report_paths(folder: Path, file_stem: str, stamp: str) -> ReportPaths:
    """Suffixe `-2`, `-3`... si ce couple horodate existe deja.

    L'horodatage est a la seconde. Un run qui ne trouve que des fichiers deja presents
    se termine en quelques millisecondes : relance aussitot, il ecraserait le rapport
    du premier.
    """
    stem, attempt = f"{file_stem}-{stamp}", 1
    while (folder / f"{stem}.json").exists() or (folder / f"{stem}.md").exists():
        attempt += 1
        stem = f"{file_stem}-{stamp}-{attempt}"

    return ReportPaths(json_path=folder / f"{stem}.json", markdown_path=folder / f"{stem}.md")
```

3. Dans `write_extraction_report`, remplacer l'appel à `_unused_report_paths` par :

```python
    json_path, markdown_path = unused_report_paths(
        context.destination_folder, FILE_STEM, context.generated_at.strftime(TIMESTAMP_FORMAT)
    )
```

Run: `grep -rn "_format_instant\|_escape_markdown\|_table_section\|_table_row\|_unused_report_paths" sidecar/src sidecar/tests`
Expected: aucune ligne.

- [ ] **Step 4: Écrire le rendu, les noms et l'écriture**

Dans `sidecar/src/tagger/tagging_report.py`, remplacer le bloc d'imports par :

```python
import json
import logging
from collections import Counter
from dataclasses import replace
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, ClassVar, Final, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, ValidationError

from tagger.errors import TaggerError
from tagger.file_failures import FileFailureReason
from tagger.files import TagField, TagSystem, after_tags, project_tags, shown_key, tag_system_of
from tagger.matching import QueryOrigin, credited_artists, full_title
from tagger.plan import PlanScores
from tagger.reports import (
    TIMESTAMP_FORMAT,
    ReportWriteError,
    escape_markdown,
    format_instant,
    table_row,
    table_section,
    unused_report_paths,
)
from tagger.run_files import write_atomically
from tagger.scraper_client import Source
from tagger.tagging import FailureReason, Resolution, TrackState

if TYPE_CHECKING:
    from collections.abc import Mapping
    from datetime import datetime

    from tagger.matching import MatchingThresholds
    from tagger.reports import ReportPaths
    from tagger.scraper_client import TrackCandidate
    from tagger.tagging import TaggingRun, TrackRecord

logger = logging.getLogger(__name__)
```

Puis ajouter, après `load_tagging_report` :

```python
_WAV_NOTE: Final = (
    "WAV tags are written as an ID3 chunk, which some DJ software does not read: "
    "check them in yours before relying on them."
)


def render_tagging_markdown(report: TaggingReport) -> str:
    """Rendu du JSON, jamais relu : une section par issue, une section vide est omise."""
    counts = report.counts
    by_state = _by_state(report.tracks)
    lines = [
        f"# Tagging report {escape_markdown(report.run_id)}",
        "",
        f"- Folder: {escape_markdown(report.folder)}",
        f"- Generated: {format_instant(report.generated_at)}",
        f"- Thresholds: floor {report.thresholds.floor:g}, ceiling {report.thresholds.ceiling:g}",
        f"- Written: {counts.written}, write errors: {counts.write_error}, "
        f"unresolved: {counts.unresolved}, rolled back: {counts.rolled_back}, "
        f"not processed: {counts.not_processed}",
        *table_section(
            "Written",
            ("Before", "After", "Source", "Route", "Score", "Fields", "Cover", "Truncated", "Page"),
            [
                table_row(
                    track.file_before,
                    track.file_after,
                    track.source,
                    track.resolution,
                    _score(track),
                    len(track.fields_written),
                    _cover(track),
                    "yes" if track.truncated else "",
                    track.url or "",
                )
                for track in by_state[TrackState.WRITTEN]
            ],
        ),
        *table_section(
            "Write errors",
            ("File", "Source", "Reason"),
            [
                table_row(track.file_before, track.source, track.failure_reason)
                for track in by_state[TrackState.WRITE_ERROR]
            ],
        ),
        *table_section(
            "Unresolved",
            ("File", "Query", "Reason"),
            [
                table_row(
                    track.file_before,
                    "" if track.query is None else track.query.text,
                    track.failure_reason,
                )
                for track in by_state[TrackState.UNRESOLVED]
            ],
        ),
        *table_section(
            "Rolled back",
            ("File",),
            [table_row(track.file_before) for track in by_state[TrackState.ROLLED_BACK]],
        ),
        *table_section(
            "Not processed",
            ("File",),
            [table_row(track.file_before) for track in by_state[None]],
        ),
    ]
    if any(
        (track.file_after or "").lower().endswith(".wav") for track in by_state[TrackState.WRITTEN]
    ):
        lines += ["", "## WAV files", "", _WAV_NOTE]
    return "\n".join(lines) + "\n"


def report_paths(folder: Path, generated_at: datetime) -> ReportPaths:
    """Couple de noms du rapport d'un run, a choisir une seule fois : toute relance reecrit le meme.

    `generated_at` est en UTC, comme pour le rapport d'extraction.
    """
    return unused_report_paths(folder, FILE_STEM, generated_at.strftime(TIMESTAMP_FORMAT))


def write_tagging_report(
    run: TaggingRun,
    thresholds: MatchingThresholds,
    generated_at: datetime,
    paths: ReportPaths,
) -> None:
    """Ecrit le couple JSON et Markdown aux noms deja choisis, ecrasant celui d'une relance.

    Leve `ReportWriteError` en nommant le fichier refuse.
    """
    report = build_tagging_report(run, thresholds, generated_at)
    _write(paths.json_path, report.model_dump_json(indent=2))
    try:
        _write(paths.markdown_path, render_tagging_markdown(report))
    except ReportWriteError:
        # Le JSON est deja sur le disque : la relance le reecrit, sous le meme nom.
        logger.warning("json report orphaned by a failed markdown write run=%s", run.run_id)
        raise


def _write(path: Path, content: str) -> None:
    try:
        write_atomically(path, content)
    except OSError as error:
        raise ReportWriteError(path) from error


def _by_state(
    tracks: tuple[TaggingReportTrack, ...],
) -> dict[TrackState | None, list[TaggingReportTrack]]:
    grouped: dict[TrackState | None, list[TaggingReportTrack]] = {
        TrackState.WRITTEN: [],
        TrackState.WRITE_ERROR: [],
        TrackState.UNRESOLVED: [],
        TrackState.ROLLED_BACK: [],
        None: [],
    }
    for track in tracks:
        grouped.setdefault(track.state, []).append(track)
    return grouped


def _score(track: TaggingReportTrack) -> str:
    """« 94 (A 96 · T 92) » comme a l'ecran ; vide pour une URL collee, jamais scoree."""
    scores = track.scores
    if scores is None:
        return ""
    artist = "-" if scores.artist is None else f"{scores.artist:.0f}"
    return f"{scores.average:.0f} (A {artist} · T {scores.title:.0f})"


def _cover(track: TaggingReportTrack) -> str:
    """`missing` : la source proposait une pochette que l'ecriture n'a pas posee."""
    if track.artwork_written:
        return "written"
    return "none" if track.artwork_url is None else "missing"
```

- [ ] **Step 5: Lancer les tests, ils passent**

Run: `cd sidecar && uv run pytest tests/unit/test_tagging_report.py tests/unit/test_reports_json.py tests/unit/test_reports_markdown.py --no-cov -q`
Expected: PASS

- [ ] **Step 6: Gate et commit**

Run: `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar`
Expected: tout vert

```bash
git add sidecar/src/tagger/reports.py sidecar/src/tagger/tagging_report.py sidecar/tests/unit/test_tagging_report.py
git commit -m "feat(sidecar): rendu Markdown et ecriture du rapport de re-tagging"
```

---

### Task 3: Registre des rapports

**Files:**
- Create: `sidecar/src/tagger/report_index.py`
- Test: `sidecar/tests/unit/test_report_index.py`

**Interfaces:**
- Consumes: `run_files.write_atomically` (sub-project 01) ; `paths.app_data_dir`.
- Produces :
  - `report_index.IndexEntry(run_id: str, written_at: datetime, folder: Path, report_path: Path)` ;
  - `report_index.ReportIndex` ;
  - `report_index.index_path() -> Path` ;
  - `report_index.record_report(index: Path, entry: IndexEntry) -> None`, qui logue et ne lève pas ;
  - `report_index.list_reports(index: Path) -> tuple[IndexEntry, ...]`.

- [ ] **Step 1: Écrire les tests**

`sidecar/tests/unit/test_report_index.py` :

```python
"""Tests du registre des rapports de re-tagging."""

import json
from datetime import timedelta
from typing import TYPE_CHECKING

import pytest
from stubs import raising
from tagging_api import CREATED

from tagger import report_index
from tagger.report_index import IndexEntry, list_reports, record_report

if TYPE_CHECKING:
    from pathlib import Path


def _entry(tmp_path: Path, run_id: str, *, days_ago: int = 0) -> IndexEntry:
    report = tmp_path / "music" / f"tagging-report-{run_id}.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text("{}", encoding="utf-8")
    return IndexEntry(
        run_id=run_id,
        written_at=CREATED - timedelta(days=days_ago),
        folder=report.parent,
        report_path=report,
    )


def test_lists_the_reports_from_newest_to_oldest(tmp_path: Path) -> None:
    index = tmp_path / "reports.json"
    older, newer = _entry(tmp_path, "1b2c3d", days_ago=3), _entry(tmp_path, "a3f9c1")
    record_report(index, older)
    record_report(index, newer)

    listed = list_reports(index)

    assert listed == (newer, older)


def test_replaces_the_entry_of_a_run_written_again(tmp_path: Path) -> None:
    index = tmp_path / "reports.json"
    record_report(index, _entry(tmp_path, "a3f9c1", days_ago=1))
    again = _entry(tmp_path, "a3f9c1")

    record_report(index, again)

    assert list_reports(index) == (again,)


def test_leaves_out_a_report_that_no_longer_exists(tmp_path: Path) -> None:
    index = tmp_path / "reports.json"
    gone, kept = _entry(tmp_path, "1b2c3d", days_ago=3), _entry(tmp_path, "a3f9c1")
    record_report(index, gone)
    record_report(index, kept)
    gone.report_path.unlink()

    listed = list_reports(index)

    assert listed == (kept,)


def test_lists_nothing_without_an_index(tmp_path: Path) -> None:
    listed = list_reports(tmp_path / "reports.json")

    assert listed == ()


@pytest.mark.parametrize(
    "content",
    ["{not json", json.dumps({"schema_version": 2, "entries": []})],
    ids=["corrupt", "unknown-version"],
)
def test_starts_over_from_an_unreadable_index(
    tmp_path: Path, content: str, caplog: pytest.LogCaptureFixture
) -> None:
    index = tmp_path / "reports.json"
    index.write_text(content, encoding="utf-8")
    entry = _entry(tmp_path, "a3f9c1")

    record_report(index, entry)

    assert list_reports(index) == (entry,)
    assert "report index unreadable reason=unreadable" in caplog.messages


def test_logs_an_index_it_cannot_write_without_the_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    refusal = OSError(28, "No space left", "C:/private/profile/reports.json")
    monkeypatch.setattr(report_index, "write_atomically", raising(refusal))
    entry = _entry(tmp_path, "a3f9c1")

    record_report(tmp_path / "reports.json", entry)

    assert "report index not written run=a3f9c1 reason=write_failed errno=28" in caplog.messages
    assert "C:/private" not in caplog.text


def test_leaves_an_index_it_cannot_read_untouched(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    index = tmp_path / "reports.json"
    index.mkdir()
    entry = _entry(tmp_path, "a3f9c1")

    record_report(index, entry)

    assert index.is_dir()
    assert "report index not read reason=read_failed" in caplog.messages
```

- [ ] **Step 2: Lancer les tests, ils échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_report_index.py --no-cov -q`
Expected: FAIL, `ModuleNotFoundError: No module named 'tagger.report_index'`

- [ ] **Step 3: Écrire le registre**

`sidecar/src/tagger/report_index.py` :

```python
"""Registre local des rapports de re-tagging : les rapports vivent dans les dossiers de musique,
seul ce fichier dit ou les retrouver pour rouvrir un run passe.

Jamais purge : il suit des livrables permanents. Absent, corrompu ou d'une autre version, il se
lit vide et repart de zero, les rapports restant dans leurs dossiers. Un fichier que le systeme
refuse de lire n'est en revanche jamais reecrit : son contenu n'est pas en cause.
"""

import logging
from pathlib import Path
from typing import Final

from pydantic import AwareDatetime, BaseModel, ConfigDict, ValidationError

from tagger.paths import app_data_dir
from tagger.run_files import write_atomically

logger = logging.getLogger(__name__)

SCHEMA_VERSION: Final = 1


class IndexEntry(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    run_id: str
    written_at: AwareDatetime
    folder: Path
    report_path: Path


class ReportIndex(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    schema_version: int = SCHEMA_VERSION
    entries: tuple[IndexEntry, ...] = ()


def index_path() -> Path:
    return app_data_dir() / "reports.json"


def record_report(index: Path, entry: IndexEntry) -> None:
    """Inscrit le rapport d'un run ; une reecriture du meme run remplace son entree.

    Un registre qui n'a pas pu etre lu n'est pas reecrit : l'ecraser par une seule entree
    perdrait un historique intact.
    """
    known = _read(index)
    if known is None:
        return
    kept = tuple(item for item in known.entries if item.run_id != entry.run_id)
    updated = ReportIndex(entries=(*kept, entry))
    try:
        write_atomically(index, updated.model_dump_json(indent=2))
    except OSError as error:
        logger.error(  # noqa: TRY400  (une trace porterait le chemin complet)
            "report index not written run=%s reason=write_failed errno=%s",
            entry.run_id,
            error.errno,
        )


def list_reports(index: Path) -> tuple[IndexEntry, ...]:
    """Du plus recent au plus ancien ; un rapport deplace ou supprime n'est plus propose."""
    known = _read(index)
    if known is None:
        return ()
    entries = (entry for entry in known.entries if entry.report_path.is_file())
    return tuple(sorted(entries, key=lambda entry: entry.written_at, reverse=True))


def _read(index: Path) -> ReportIndex | None:
    """`None` : le systeme refuse de lire le fichier, sans que son contenu soit en cause."""
    try:
        content = index.read_bytes()
    except FileNotFoundError:
        return ReportIndex()
    except OSError:
        logger.warning("report index not read reason=read_failed")
        return None
    try:
        parsed = ReportIndex.model_validate_json(content)
    except ValidationError:
        parsed = None
    if parsed is None or parsed.schema_version != SCHEMA_VERSION:
        logger.error("report index unreadable reason=unreadable")
        return ReportIndex()
    return parsed
```

- [ ] **Step 4: Lancer les tests, ils passent**

Run: `cd sidecar && uv run pytest tests/unit/test_report_index.py --no-cov -q`
Expected: PASS

- [ ] **Step 5: Gate et commit**

Run: `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar`
Expected: tout vert

```bash
git add sidecar/src/tagger/report_index.py sidecar/tests/unit/test_report_index.py
git commit -m "feat(sidecar): registre local des rapports de re-tagging"
```

---

### Task 4: Rapport écrit en fin de phase d'écriture

**Files:**
- Modify: `sidecar/src/tagger/handlers.py` (`CurrentRun`, `handle_commit_run`, `handle_retry_write`, `_write_report`)
- Modify: `sidecar/tests/integration/test_ndjson_write.py`
- Modify: `docs/ARCHITECTURE.md`

**Interfaces:**
- Consumes :
  - `report_paths`, `write_tagging_report`, `ReportWriteError` (Tasks 1 et 2) ;
  - `record_report`, `index_path`, `IndexEntry`, `list_reports` (Task 3) ;
  - `handle_commit_run`, `CurrentRun.plan` du sub-project 01.
- Produces :
  - `CurrentRun.report_names: ReportPaths | None`, le couple choisi à la première écriture ;
  - `CurrentRun.report: ReportPaths | None`, le dernier couple écrit avec succès, que le sub-project 04 lit pour porter le chemin dans `run_finished`.

- [ ] **Step 1: Écrire les tests d'intégration**

Dans `sidecar/tests/integration/test_ndjson_write.py`, fusionner ces imports avec ceux du module :

```python
from tagger import BUNDLE_IDENTIFIER, files, handlers, tag_dump, tagging_report, writing
from tagger.api_key import SERVICE, USERNAME
from tagger.files import TagSystem, TagsUnreadableError, TagsWriteError
from tagger.report_index import index_path, list_reports
from tagger.run_files import write_atomically
from tagger.tagging import TrackState
from tagger.tagging_report import load_tagging_report
```

et sous `if TYPE_CHECKING:`, `from memory_keyring import MemoryKeyring` et `from tagger.tagging_report import TaggingReport`. `raising` vient de `stubs` (déjà importé). Puis ajouter, en reprenant `_locked_until_lifted` déjà défini dans le module :

```python
def _reports(folder: Path) -> list[Path]:
    """Fichiers du rapport dans le dossier du run, JSON avant Markdown."""
    return sorted(folder.glob("tagging-report-*"))


def _only_report(folder: Path) -> tuple[Path, TaggingReport]:
    """Le JSON unique du dossier et le rapport relu."""
    (json_path,) = folder.glob("tagging-report-*.json")
    return json_path, load_tagging_report(json_path)


def _report_texts(folder: Path) -> str:
    return "".join(path.read_text(encoding="utf-8") for path in _reports(folder))


async def test_leaves_the_tagging_report_in_the_folder(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="commit_run", run_id=run_id)
        await talk.expect("run_finished", phase="write")

    json_path, report = _only_report(folder)
    assert _reports(folder) == [json_path, json_path.with_suffix(".md")]
    assert (report.run_id, report.counts.written) == (run_id, 1)
    assert [entry.report_path for entry in list_reports(index_path())] == [json_path]


async def test_keeps_the_api_key_and_the_data_folder_out_of_the_report(
    folder: Path, memory_keyring: MemoryKeyring
) -> None:
    api_key = memory_keyring.secrets[(SERVICE, USERNAME)]

    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="commit_run", run_id=run_id)
        await talk.expect("run_finished", phase="write")

    reports = _report_texts(folder)
    assert api_key not in reports
    assert BUNDLE_IDENTIFIER not in reports


async def test_rewrites_the_same_report_after_a_retry(
    folder: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    lift = _locked_until_lifted(monkeypatch)

    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="commit_run", run_id=run_id)
        await talk.expect("run_finished", phase="write")
        json_path, first = _only_report(folder)
        lift()
        talk.send(command="retry_write", run_id=run_id)
        await talk.expect("run_finished", phase="write")

    assert (first.counts.write_error, first.counts.written) == (1, 0)
    assert load_tagging_report(json_path).counts.written == 1
    assert _reports(folder) == [json_path, json_path.with_suffix(".md")]


async def test_reports_a_restored_track_after_a_partial_rollback(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="commit_run", run_id=run_id)
        await talk.expect("run_finished", phase="write")
        talk.send(command="rollback", run_id=run_id, track_id=ONE_TRACK)
        await talk.expect("rollback_finished")
        talk.send(command="retry_write", run_id=run_id)
        await talk.expect("run_finished", phase="write")

    _, report = _only_report(folder)
    (restored,) = report.tracks
    assert (report.counts.rolled_back, report.counts.written) == (1, 0)
    assert (restored.state, restored.source, restored.scores, restored.url) == (
        TrackState.ROLLED_BACK,
        None,
        None,
        None,
    )
    assert restored.tags_before is not None
    assert restored.system is TagSystem.ID3


async def test_finishes_the_write_phase_when_the_report_cannot_be_written(
    folder: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    refusal = OSError(28, "No space left", "C:/private/profile/Music/x.json")
    monkeypatch.setattr(tagging_report, "write_atomically", raising(refusal))

    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="commit_run", run_id=run_id)
        finished = await talk.expect("run_finished", phase="write")

    assert finished["written"] == 1
    assert _reports(folder) == []
    assert list_reports(index_path()) == ()
    assert "tagging report not written run=" in caplog.text
    assert "reason=report_write_failed errno=28" in caplog.text
    assert "C:/private" not in caplog.text


async def test_keeps_one_pair_of_files_when_the_markdown_was_refused_once(
    folder: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    refusing = True

    def write(path: Path, text: str) -> None:
        if refusing and path.suffix == ".md":
            raise OSError(28, "No space left on device")
        write_atomically(path, text)

    monkeypatch.setattr(tagging_report, "write_atomically", write)

    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="commit_run", run_id=run_id)
        await talk.expect("run_finished", phase="write")
        refusing = False
        talk.send(command="retry_write", run_id=run_id)
        await talk.expect("run_finished", phase="write")

    assert [path.suffix for path in _reports(folder)] == [".json", ".md"]
    assert len(list_reports(index_path())) == 1
```

Le patch vise `tagging_report`, qui importe `write_atomically` par son nom : un symbole se patche là où il est utilisé (`.claude/rules/pytest/tests.md`).

- [ ] **Step 2: Lancer les tests, ils échouent**

Run: `cd sidecar && uv run pytest tests/integration/test_ndjson_write.py --no-cov -q`
Expected: FAIL, aucun `tagging-report-*.json` dans le dossier.

- [ ] **Step 3: Écrire le rapport en fin de phase**

Dans `sidecar/src/tagger/handlers.py` :

1. Imports. Compléter la ligne ajoutée par la Task 1 et ajouter les deux autres :

```python
from tagger.report_index import IndexEntry, index_path, record_report
from tagger.reports import ReportContext, ReportWriteError, write_extraction_report
from tagger.tagging_report import after_rows, report_paths, tag_rows, write_tagging_report
```

(la deuxième remplace l'import existant de `tagger.reports`) et dans le bloc `TYPE_CHECKING` :

```python
    from tagger.reports import ReportPaths
```

2. Dans `CurrentRun.__init__`, juste après `self.writer: RunWriter | None = None` :

```python
        # Noms du rapport, choisis a la premiere ecriture et gardes meme si elle echoue : une
        # relance reecrit le meme couple, jamais un `-2`.
        self.report_names: ReportPaths | None = None
        # Dernier rapport ecrit avec succes, celui que `run_finished` annonce.
        self.report: ReportPaths | None = None
```

3. Remplacer `handle_commit_run` et `handle_retry_write` par les versions ci-dessous et ajouter `_write_report` juste après :

```python
async def handle_commit_run(current: CurrentRun, writer: RunWriter) -> Event:
    """Le plan est confirme sur le disque avant le premier fichier (write-ahead).

    Un dump qui ne s'enregistre pas n'a touche aucun fichier : le run et son plan redeviennent
    confirmables.
    """
    if current.plan is not None:
        await current.plan.commit()
    try:
        await writer.write()
    except TagDumpError:
        current.writer = None
        if current.plan is not None:
            await current.plan.reopen()
        raise
    await _write_report(current)
    return _run_finished(current.live.snapshot(), RunPhase.WRITE)


async def handle_retry_write(current: CurrentRun, writer: RunWriter) -> Event:
    await writer.retry()
    await _write_report(current)
    return _run_finished(current.live.snapshot(), RunPhase.WRITE)


async def _write_report(current: CurrentRun) -> None:
    """Rapport du run apres chaque phase d'ecriture, puis son inscription au registre.

    Les fichiers musicaux sont deja ecrits : un rapport refuse se logue, il ne casse pas la phase.
    """
    run = current.live.snapshot()
    written_at = datetime.now(UTC)
    names = current.report_names
    if names is None:
        names = await asyncio.to_thread(report_paths, run.folder, written_at)
        current.report_names = names
    try:
        await asyncio.to_thread(
            write_tagging_report, run, current.sources.thresholds, written_at, names
        )
    except ReportWriteError as error:
        cause = error.__cause__
        logger.error(  # noqa: TRY400  (une trace porterait le chemin complet)
            "tagging report not written run=%s reason=report_write_failed errno=%s",
            run.run_id,
            cause.errno if isinstance(cause, OSError) else None,
        )
        return
    current.report = names
    entry = IndexEntry(
        run_id=run.run_id, written_at=written_at, folder=run.folder, report_path=names.json_path
    )
    await asyncio.to_thread(record_report, index_path(), entry)
```

- [ ] **Step 4: Lancer les tests, ils passent**

Run: `cd sidecar && uv run pytest tests/integration/ --no-cov -q`
Expected: PASS

- [ ] **Step 5: Mettre à jour `docs/ARCHITECTURE.md`**

Relire les passages avant de les éditer : leurs numéros de ligne ne sont pas garantis.

1. Arborescence, sous `sidecar/src/tagger/`, juste après la ligne `reports.py`, ajouter les deux lignes suivantes au même alignement que leurs voisines :
   - `tagging_report.py` avec le commentaire `# rapport de re-tagging d'un run, JSON et Markdown, relecture migrable` ;
   - `report_index.py` avec le commentaire `# registre des rapports écrits, pour rouvrir un run passé`.
2. § Données, tableau : remplacer la ligne `| Rapport de run, JSON + Markdown | Dossier destination | Permanente, livrable | Traçabilité, relecture par l'app, envoi de feedback |` par les deux lignes suivantes :

```markdown
| Rapport de run, JSON + Markdown (`tagging-report-<horodatage>`) | Dossier du run, celui de `start_tagging` et non le dossier destination | Permanente, livrable. Réécrit sous les mêmes noms à la fin de chaque relance de l'écriture, jamais après un rollback | Traçabilité, relecture par l'app, envoi de feedback |
| Registre des rapports | `appLocalDataDir()/reports.json` | Permanente, une entrée par run écrit, rapports disparus écartés à la lecture | Liste des runs passés |
```

3. § Données, paragraphe qui suit le tableau : remplacer « Deux rapports distincts sont produits, l'un par l'extraction et l'autre par le re-tagging, chacun dans le dossier destination et chacun en JSON plus Markdown. » par « Deux rapports distincts sont produits, l'un par l'extraction dans le dossier destination et l'autre par le re-tagging dans le dossier du run, chacun en JSON plus Markdown. ».

- [ ] **Step 6: Gate et commit**

Run: `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar`
Expected: tout vert, couverture du sidecar au-dessus du seuil

```bash
git add sidecar/src/tagger/handlers.py sidecar/tests/integration/test_ndjson_write.py docs/ARCHITECTURE.md
git commit -m "feat(sidecar): rapport de re-tagging ecrit a la fin de chaque phase d'ecriture"
```
