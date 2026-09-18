# Rapport d'extraction (JSON et Markdown) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Écrire dans le dossier destination le rapport d'extraction qui rend vérifiable chaque décision automatique prise pendant l'extraction.

**Architecture:** Un module `tagger/reports.py` à responsabilité unique, exposant le modèle pydantic du rapport, deux rendus purs — JSON versionné et Markdown lisible — et une fonction qui les dépose sur le disque sous un nom horodaté. Séparer le rendu de l'écriture rend le contenu et son déterminisme vérifiables sans toucher au système de fichiers.

**Tech Stack:** Python 3.14 (`datetime`, `pathlib`), pydantic 2.13, pytest, Mypy strict, Ruff. Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/onglet-playlist-extraction-selective/03-rapport-extraction-design.md`

## Global Constraints

- **Dépendances aux sub-projects 01 et 02** : `tagger/errors.py` (`TaggerError`) et `tagger/extraction.py` (`ExtractionResult`, `DuplicateResolution`, `DiscardedCandidate`, `ExtractionFailure`, `ExtractionMode`, `DuplicateCriterion`, `ExtractionFailureReason`) existent déjà. Ne pas les recréer.
- **Gate qualité vert à chaque commit** : `just test` (couverture bloquante à 80 %), `just lint`, `just typecheck`.
- **Convention de commit** : `type(scope): description`, scope `plan` pour ce sub-project.
- **Le rapport est en anglais**, indépendamment de la langue de l'interface (ARCHITECTURE.md § Données).
- **Champ de version dès la première version** ([ADR-018](../../../adrs/018-versionnement-plan-de-run.md)), sans aucune fonction de migration : il n'y a rien à migrer.
- **Le nom de fichier n'emploie jamais `isoformat()`** : ses `:` sont interdits dans un nom de fichier Windows. Format compact `%Y%m%dT%H%M%SZ` pour le nom, ISO complet pour le contenu.
- **Sérialisation JSON par `model_dump_json(indent=2)`** : le rapport est un `BaseModel`, comme l'exige `.claude/rules/pydantic/modeles.md` pour tout ce qui franchit une frontière. Non-ASCII rendu tel quel, `Path` en chaîne, `datetime` UTC suffixé `Z`, ordre des champs celui de la déclaration donc déterministe. `encoding="utf-8"` explicite à l'écriture (cf. `.claude/rules/python/fichiers-io.md`).
- **Aucune écriture sur `stdout`** : le flux standard porte le protocole NDJSON.
- **Typage complet** : Mypy strict, `Final` sur les constantes, imports d'annotation seule sous `if TYPE_CHECKING:`, lignes à 100 caractères maximum, jamais `from __future__ import annotations`.
- **Tests en Arrange / Act / Assert séparés par une ligne vide**, sans commentaire de section, écriture dans `tmp_path` uniquement.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `sidecar/src/tagger/reports.py` | Constantes de schéma, contexte de rapport, rendu JSON, rendu Markdown, écriture sur disque. |
| `sidecar/tests/helpers/extraction_samples.py` | Constructeur d'un `ExtractionResult` couvrant les cinq catégories et du contexte associé. |
| `sidecar/tests/conftest.py` | Fixtures `extraction_result` et `report_context`. |
| `sidecar/tests/unit/test_reports_json.py` | Schéma, versionnement, contenu, déterminisme, nommage et écriture. |
| `sidecar/tests/unit/test_reports_markdown.py` | Rendu lisible. |

---

## Task 1: Contexte, constantes et rendu JSON

**Files:**
- Create: `sidecar/src/tagger/reports.py`
- Create: `sidecar/tests/helpers/extraction_samples.py`
- Create: `sidecar/tests/unit/test_reports_json.py`
- Modify: `sidecar/tests/conftest.py`

**Interfaces:**
- Consumes: `ExtractionResult`, `DuplicateResolution`, `DiscardedCandidate`, `ExtractionFailure`, `ExtractionMode`, `DuplicateCriterion`, `ExtractionFailureReason` (sub-project 02)
- Produces:
  - `SCHEMA_VERSION: Final = 1`, `REPORT_KIND: Final = "extraction"`, `FILE_STEM: Final = "extraction-report"`, `TIMESTAMP_FORMAT: Final = "%Y%m%dT%H%M%SZ"`
  - `ReportContext(source_folder: Path, destination_folder: Path, playlist_path: Path, playlist_name: str | None, mode: ExtractionMode, generated_at: datetime)`
  - `render_json(result: ExtractionResult, context: ReportContext) -> str`
  - helpers de test `sample_result() -> ExtractionResult`, `sample_context(source: Path, destination: Path) -> ReportContext`
  - fixtures pytest `extraction_result` et `report_context`

- [ ] **Step 1: Écrire le constructeur d'échantillon**

Un seul échantillon couvre les cinq catégories : chaque test porte alors sur un aspect du rendu, pas sur la construction de ses données. Le nom cyrillique est là pour exercer `ensure_ascii=False`.

Créer `sidecar/tests/helpers/extraction_samples.py` :

```python
"""Echantillon d'`ExtractionResult` couvrant les cinq categories du resultat.

Un seul jeu de donnees pour tous les tests de rapport : ce qui est verifie est le
rendu, jamais la construction de l'echantillon.
"""

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Final

from tagger.extraction import (
    DiscardedCandidate,
    DuplicateCriterion,
    DuplicateResolution,
    ExtractionFailure,
    ExtractionFailureReason,
    ExtractionMode,
    ExtractionResult,
)
from tagger.reports import ReportContext

if TYPE_CHECKING:
    from pathlib import Path

# Instant fige : le nom du fichier de rapport en depend, donc les tests aussi.
GENERATED_AT: Final = datetime(2026, 9, 8, 22, 15, 0, tzinfo=UTC)
EXPECTED_STAMP: Final = "20260908T221500Z"

CYRILLIC_TRACK: Final = "Artist Two - Дорога.mp3"


def sample_result(library: Path) -> ExtractionResult:
    """Resultat portant les cinq categories, dont un homonyme departage."""
    return ExtractionResult(
        extracted=("alpha.mp3", CYRILLIC_TRACK),
        already_present=("delta.mp3",),
        missing=("absent.mp3",),
        duplicates=(
            DuplicateResolution(
                file_name="beta.mp3",
                kept_path=library / "singles" / "beta.mp3",
                kept_size=12_000,
                discarded=(
                    DiscardedCandidate(path=library / "albums" / "beta.mp3", size=5_000),
                ),
                criterion=DuplicateCriterion.LARGEST_FILE,
            ),
        ),
        failures=(
            ExtractionFailure(
                file_name="locked.mp3", reason=ExtractionFailureReason.FILE_LOCKED
            ),
        ),
    )


def sample_context(library: Path, destination: Path) -> ReportContext:
    """Contexte d'un run d'extraction depuis un dump VLC."""
    return ReportContext(
        source_folder=library,
        destination_folder=destination,
        playlist_path=library / "vlc_media.db",
        playlist_name="test playlist",
        mode=ExtractionMode.COPY,
        generated_at=GENERATED_AT,
    )
```

- [ ] **Step 2: Ajouter les fixtures**

Dans `sidecar/tests/conftest.py`, ajouter après les fixtures existantes :

```python
@pytest.fixture
def extraction_result(tmp_path: Path) -> ExtractionResult:
    """Resultat d'extraction couvrant les cinq categories."""
    return sample_result(tmp_path / "library")


@pytest.fixture
def report_context(tmp_path: Path) -> ReportContext:
    """Contexte de rapport pointant sur la meme arborescence."""
    return sample_context(tmp_path / "library", tmp_path / "work")
```

Compléter les imports de `conftest.py` : `from extraction_samples import sample_context, sample_result`, et sous `if TYPE_CHECKING:` ajouter `from tagger.extraction import ExtractionResult` et `from tagger.reports import ReportContext`.

- [ ] **Step 3: Écrire les tests du rendu JSON**

Créer `sidecar/tests/unit/test_reports_json.py` :

```python
"""Tests du rendu JSON du rapport d'extraction."""

import json

from extraction_samples import CYRILLIC_TRACK

from tagger.extraction import ExtractionResult
from tagger.reports import REPORT_KIND, SCHEMA_VERSION, ReportContext, render_json


def test_carries_its_schema_version(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    payload = json.loads(render_json(extraction_result, report_context))

    assert payload["schema_version"] == SCHEMA_VERSION


def test_distinguishes_the_extraction_report_from_the_tagging_one(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    payload = json.loads(render_json(extraction_result, report_context))

    assert payload["kind"] == REPORT_KIND


def test_carries_the_five_categories(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    payload = json.loads(render_json(extraction_result, report_context))

    assert set(payload) >= {
        "extracted",
        "already_present",
        "missing",
        "duplicates",
        "failures",
    }


def test_counts_match_the_categories(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    payload = json.loads(render_json(extraction_result, report_context))

    assert payload["counts"] == {
        "extracted": 2,
        "already_present": 1,
        "missing": 1,
        "duplicates": 1,
        "failures": 1,
    }


def test_a_resolved_duplicate_is_verifiable(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    payload = json.loads(render_json(extraction_result, report_context))

    duplicate = payload["duplicates"][0]
    assert duplicate["kept_size"] == 12_000
    assert duplicate["criterion"] == "largest_file"
    assert len(duplicate["discarded"]) == 1
    assert duplicate["discarded"][0]["size"] == 5_000
    assert "albums" in duplicate["discarded"][0]["path"]


def test_writes_full_paths(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    payload = json.loads(render_json(extraction_result, report_context))

    assert payload["duplicates"][0]["kept_path"].endswith("beta.mp3")
    assert "singles" in payload["duplicates"][0]["kept_path"]


def test_keeps_non_ascii_readable(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    rendered = render_json(extraction_result, report_context)

    assert CYRILLIC_TRACK in rendered


def test_carries_the_generation_instant_in_full_iso(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    payload = json.loads(render_json(extraction_result, report_context))

    assert payload["generated_at"] == "2026-09-08T22:15:00Z"


def test_is_deterministic(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    first = render_json(extraction_result, report_context)
    second = render_json(extraction_result, report_context)

    assert first == second
```

- [ ] **Step 4: Lancer les tests pour les voir échouer**

Run: `cd sidecar && uv run pytest tests/unit/test_reports_json.py -x -q`
Expected: FAIL, `ModuleNotFoundError: No module named 'tagger.reports'`

- [ ] **Step 5: Écrire le contexte et le rendu JSON**

Créer `sidecar/src/tagger/reports.py` :

```python
"""Rapports de run, ecrits dans le dossier destination.

Deux rapports distincts existent dans le projet, celui de l'extraction et celui du
re-tagging, chacun en JSON et en Markdown, tous deux en anglais quelle que soit la
langue de l'interface (cf. ARCHITECTURE.md § Donnees).

Le JSON porte un champ de version des sa premiere version : l'ajouter apres coup
laisserait une generation de rapports non identifiables, precisement le cas que le
mecanisme doit eviter (ADR-018). Aucune migration n'est ecrite tant qu'il n'existe
qu'une version, une migration sans version d'origine n'etant ni exercable ni
testable. Le Markdown, lui, n'est pas versionne : c'est un rendu, jamais relu par
l'application, regenerable depuis le JSON.
"""

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, ClassVar, Final

from pydantic import BaseModel

from tagger.errors import TaggerError
from tagger.extraction import DuplicateCriterion, ExtractionFailureReason, ExtractionMode

if TYPE_CHECKING:
    from tagger.extraction import ExtractionResult

SCHEMA_VERSION: Final = 1
REPORT_KIND: Final = "extraction"


class ReportWriteFailed(TaggerError):
    """Le run a extrait ses fichiers mais son rapport n'a pas pu etre ecrit.

    Erreur metier et non `OSError` brute : la boucle NDJSON du sub-project 04
    n'intercepte que `TaggerError`, et un disque plein doit produire un evenement
    `error`, jamais un sidecar mort en silence.
    """

    code: ClassVar[str] = "report_write_failed"

    def __init__(self, path: Path, cause: OSError) -> None:
        super().__init__(f"cannot write report: {path.name}", filename=path.name)
        self.cause = cause


@dataclass(frozen=True, slots=True)
class ReportContext:
    """Ce qu'un rapport dit du run, en plus de son resultat.

    `playlist_name` vaut `None` pour un M3U8, qui ne contient qu'une playlist et
    n'en fait donc jamais choisir.
    """

    source_folder: Path
    destination_folder: Path
    playlist_path: Path
    playlist_name: str | None
    mode: ExtractionMode
    generated_at: datetime


class DiscardedEntry(BaseModel):
    """Homonyme ecarte, avec de quoi le retrouver a la main."""

    path: Path
    size: int


class DuplicateEntry(BaseModel):
    """Choix automatique entre homonymes, rendu verifiable (ADR-020)."""

    file_name: str
    kept_path: Path
    kept_size: int
    criterion: DuplicateCriterion
    discarded: tuple[DiscardedEntry, ...]


class FailureEntry(BaseModel):
    """Morceau trouve mais non transfere, et pourquoi."""

    file_name: str
    reason: ExtractionFailureReason


class ReportCounts(BaseModel):
    """Decomptes des cinq categories, lus sans parcourir les listes."""

    extracted: int
    already_present: int
    missing: int
    duplicates: int
    failures: int


class PlaylistRef(BaseModel):
    """Playlist du run. `name` vaut `None` pour un M3U8, qui n'en contient qu'une."""

    path: Path
    name: str | None


class ExtractionReport(BaseModel):
    """Rapport d'extraction, tel qu'il est ecrit sur le disque.

    `BaseModel` et non un `dict` serialise a la main : le rapport franchit une
    frontiere et il est permanent, donc relu par une version ulterieure de
    l'application. C'est ce modele qui portera la migration d'un `schema_version`
    anterieur, dans un `@model_validator(mode="before")` (ADR-018).
    """

    schema_version: int = SCHEMA_VERSION
    kind: str = REPORT_KIND
    generated_at: datetime
    source_folder: Path
    destination_folder: Path
    playlist: PlaylistRef
    mode: ExtractionMode
    counts: ReportCounts
    extracted: tuple[str, ...]
    already_present: tuple[str, ...]
    missing: tuple[str, ...]
    duplicates: tuple[DuplicateEntry, ...]
    failures: tuple[FailureEntry, ...]


def build_report(result: ExtractionResult, context: ReportContext) -> ExtractionReport:
    """Assemble le rapport depuis le resultat d'extraction et le contexte du run."""
    return ExtractionReport(
        generated_at=context.generated_at,
        source_folder=context.source_folder,
        destination_folder=context.destination_folder,
        playlist=PlaylistRef(path=context.playlist_path, name=context.playlist_name),
        mode=context.mode,
        counts=ReportCounts(
            extracted=len(result.extracted),
            already_present=len(result.already_present),
            missing=len(result.missing),
            duplicates=len(result.duplicates),
            failures=len(result.failures),
        ),
        extracted=result.extracted,
        already_present=result.already_present,
        missing=result.missing,
        duplicates=tuple(
            DuplicateEntry(
                file_name=duplicate.file_name,
                kept_path=duplicate.kept_path,
                kept_size=duplicate.kept_size,
                criterion=duplicate.criterion,
                discarded=tuple(
                    DiscardedEntry(path=candidate.path, size=candidate.size)
                    for candidate in duplicate.discarded
                ),
            )
            for duplicate in result.duplicates
        ),
        failures=tuple(
            FailureEntry(file_name=failure.file_name, reason=failure.reason)
            for failure in result.failures
        ),
    )


def render_json(result: ExtractionResult, context: ReportContext) -> str:
    """Rend le rapport JSON, destine a etre relu par l'application.

    `model_dump_json` garde les titres non-ASCII lisibles sans echappement, rend les
    `Path` en chaines et suit l'ordre de declaration des champs, ce qui rend deux
    rendus du meme resultat identiques. L'indentation est admise : la regle qui
    l'interdit vise le flux NDJSON, ou une ligne vaut un evenement.
    """
    return build_report(result, context).model_dump_json(indent=2)
```

- [ ] **Step 6: Lancer les tests pour les voir passer**

Run: `cd sidecar && uv run pytest tests/unit/test_reports_json.py -x -q`
Expected: PASS, 9 tests

- [ ] **Step 7: Vérifier le gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 8: Commit**

```bash
git add sidecar/src/tagger/reports.py sidecar/tests/helpers/extraction_samples.py sidecar/tests/conftest.py sidecar/tests/unit/test_reports_json.py
git commit -m "feat(plan): rendre le rapport d extraction en JSON versionne"
```

---

## Task 2: Rendu Markdown

**Files:**
- Modify: `sidecar/src/tagger/reports.py`
- Test: `sidecar/tests/unit/test_reports_markdown.py`

**Interfaces:**
- Consumes: `ReportContext` de la Task 1
- Produces: `render_markdown(result: ExtractionResult, context: ReportContext) -> str`

- [ ] **Step 1: Écrire les tests du rendu Markdown**

Créer `sidecar/tests/unit/test_reports_markdown.py` :

```python
"""Tests du rendu Markdown du rapport d'extraction."""

from dataclasses import replace

from extraction_samples import CYRILLIC_TRACK

from tagger.extraction import ExtractionResult
from tagger.reports import ReportContext, render_markdown


def test_headings_are_in_english(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    rendered = render_markdown(extraction_result, report_context)

    assert "# Extraction report" in rendered
    assert "## Summary" in rendered


def test_shows_every_category_that_has_content(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    rendered = render_markdown(extraction_result, report_context)

    for heading in ("Extracted", "Already present", "Missing", "Duplicates", "Failures"):
        assert heading in rendered


def test_a_resolved_duplicate_is_readable(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    rendered = render_markdown(extraction_result, report_context)

    assert "beta.mp3" in rendered
    assert "largest_file" in rendered
    assert "12000" in rendered


def test_omits_a_category_with_nothing_in_it(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    without_duplicates = replace(extraction_result, duplicates=())

    rendered = render_markdown(without_duplicates, report_context)

    assert "## Duplicates resolved" not in rendered


def test_keeps_non_ascii_intact(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    rendered = render_markdown(extraction_result, report_context)

    assert CYRILLIC_TRACK in rendered
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `cd sidecar && uv run pytest tests/unit/test_reports_markdown.py -x -q`
Expected: FAIL, `ImportError: cannot import name 'render_markdown'`

- [ ] **Step 3: Écrire le rendu Markdown**

Une section vide n'apporte rien à la lecture : les catégories sans contenu sont omises, seul le tableau de synthèse énumérant toujours les cinq.

Ajouter à `sidecar/src/tagger/reports.py` :

```python
def render_markdown(result: ExtractionResult, context: ReportContext) -> str:
    """Rend le rapport lisible, en anglais.

    Regenerable depuis le JSON et jamais relu par l'application, il n'est donc pas
    versionne (ADR-018 § Notes). Une categorie sans contenu est omise : une section
    vide n'apprend rien, le tableau de synthese portant deja les cinq decomptes.
    """
    playlist = context.playlist_name or context.playlist_path.name
    lines = [
        "# Extraction report",
        "",
        f"- Generated at: {context.generated_at.isoformat()}",
        f"- Source folder: {context.source_folder}",
        f"- Destination folder: {context.destination_folder}",
        f"- Playlist: {playlist}",
        f"- Mode: {context.mode}",
        "",
        "## Summary",
        "",
        "| Category | Count |",
        "| --- | --- |",
        f"| Extracted | {len(result.extracted)} |",
        f"| Already present | {len(result.already_present)} |",
        f"| Missing | {len(result.missing)} |",
        f"| Duplicates resolved | {len(result.duplicates)} |",
        f"| Failures | {len(result.failures)} |",
    ]

    lines += _bullet_section("Extracted", result.extracted)
    lines += _bullet_section("Already present", result.already_present)
    lines += _bullet_section("Missing", result.missing)

    if result.duplicates:
        lines += [
            "",
            "## Duplicates resolved",
            "",
            "| File | Kept | Size | Criterion | Discarded |",
            "| --- | --- | --- | --- | --- |",
        ]
        lines += [
            f"| {duplicate.file_name} | {duplicate.kept_path} | {duplicate.kept_size} "
            f"| {duplicate.criterion} "
            f"| {'; '.join(f'{item.path} ({item.size})' for item in duplicate.discarded)} |"
            for duplicate in result.duplicates
        ]

    if result.failures:
        lines += [
            "",
            "## Failures",
            "",
            "| File | Reason |",
            "| --- | --- |",
        ]
        lines += [f"| {failure.file_name} | {failure.reason} |" for failure in result.failures]

    return "\n".join(lines) + "\n"


def _bullet_section(title: str, entries: tuple[str, ...]) -> list[str]:
    """Rend une section a puces, ou rien du tout si la categorie est vide."""
    if not entries:
        return []

    return ["", f"## {title}", "", *(f"- {entry}" for entry in entries)]
```

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `cd sidecar && uv run pytest tests/unit/test_reports_markdown.py -x -q`
Expected: PASS, 5 tests

- [ ] **Step 5: Vérifier le gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 6: Commit**

```bash
git add sidecar/src/tagger/reports.py sidecar/tests/unit/test_reports_markdown.py
git commit -m "feat(plan): rendre le rapport d extraction en Markdown lisible"
```

---

## Task 3: Écriture des deux fichiers sur disque

**Files:**
- Modify: `sidecar/src/tagger/reports.py`
- Test: `sidecar/tests/unit/test_reports_json.py` (compléter)

**Interfaces:**
- Consumes: `render_json`, `render_markdown`, `ReportContext` des Tasks 1 et 2
- Produces: `ReportPaths(json_path: Path, markdown_path: Path)`, `write_extraction_report(result: ExtractionResult, context: ReportContext) -> ReportPaths`, `FILE_STEM: Final`, `TIMESTAMP_FORMAT: Final`

- [ ] **Step 1: Écrire les tests d'écriture**

Ajouter à `sidecar/tests/unit/test_reports_json.py` :

```python
def test_writes_both_files_in_the_destination(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    paths = write_extraction_report(extraction_result, report_context)

    assert paths.json_path.is_file()
    assert paths.markdown_path.is_file()


def test_file_names_carry_the_generation_stamp(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    paths = write_extraction_report(extraction_result, report_context)

    assert paths.json_path.name == f"extraction-report-{EXPECTED_STAMP}.json"
    assert paths.markdown_path.name == f"extraction-report-{EXPECTED_STAMP}.md"


def test_file_names_avoid_characters_windows_forbids(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    paths = write_extraction_report(extraction_result, report_context)

    forbidden = set('<>:"/\\|?*')
    assert not forbidden & set(paths.json_path.name)


def test_a_second_run_does_not_overwrite_the_first(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    first = write_extraction_report(extraction_result, report_context)
    later = replace(report_context, generated_at=GENERATED_AT + timedelta(minutes=1))

    second = write_extraction_report(extraction_result, later)

    assert first.json_path.is_file()
    assert second.json_path != first.json_path


def test_creates_the_destination_folder(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    assert not report_context.destination_folder.exists()

    write_extraction_report(extraction_result, report_context)

    assert report_context.destination_folder.is_dir()


def test_written_json_is_the_rendered_json(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    paths = write_extraction_report(extraction_result, report_context)

    assert paths.json_path.read_text(encoding="utf-8") == render_json(
        extraction_result, report_context
    )
```

Compléter les imports du fichier : `from dataclasses import replace`, `from datetime import timedelta`, `from extraction_samples import CYRILLIC_TRACK, EXPECTED_STAMP, GENERATED_AT`, et ajouter `write_extraction_report` à l'import de `tagger.reports`.

Ajouter, dans le même fichier :

```python
def test_a_refused_write_becomes_a_business_error(
    extraction_result: ExtractionResult,
    report_context: ReportContext,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def refuse(self: Path, data: str, encoding: str | None = None) -> int:
        raise PermissionError(13, "Permission denied")

    monkeypatch.setattr(Path, "write_text", refuse)

    with pytest.raises(ReportWriteFailed) as raised:
        write_extraction_report(extraction_result, report_context)

    assert raised.value.code == "report_write_failed"


def test_a_refused_write_names_the_report_and_never_its_folder(
    extraction_result: ExtractionResult,
    report_context: ReportContext,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def refuse(self: Path, data: str, encoding: str | None = None) -> int:
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(Path, "write_text", refuse)

    with pytest.raises(ReportWriteFailed) as raised:
        write_extraction_report(extraction_result, report_context)

    reported = str(raised.value.params["filename"])
    assert reported.endswith(".json")
    assert "/" not in reported
    assert "\\" not in reported
```

Compléter les imports du fichier : `import pytest`, `from pathlib import Path` et
`from tagger.reports import ReportWriteFailed, write_extraction_report`.

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `cd sidecar && uv run pytest tests/unit/test_reports_json.py -x -q`
Expected: FAIL, `ImportError: cannot import name 'write_extraction_report'`

- [ ] **Step 3: Écrire l'écriture sur disque**

Ajouter à `sidecar/src/tagger/reports.py`, les constantes près des autres en tête de module :

```python
FILE_STEM: Final = "extraction-report"
# Jamais `isoformat()` dans un nom de fichier : ses `:` sont interdits sous Windows.
TIMESTAMP_FORMAT: Final = "%Y%m%dT%H%M%SZ"
```

Puis, en fin de module :

```python
@dataclass(frozen=True, slots=True)
class ReportPaths:
    """Chemins des deux fichiers ecrits. Le JSON remonte a l'interface par
    l'evenement `extraction_finished`.
    """

    json_path: Path
    markdown_path: Path


def write_extraction_report(result: ExtractionResult, context: ReportContext) -> ReportPaths:
    """Depose le rapport dans le dossier destination et rend les deux chemins.

    Un couple de fichiers par run, horodate : le rapport est permanent et sert de
    base a la relecture d'un run passe (ADR-018), un nom fixe ecraserait donc
    exactement ce qu'il protege.

    Leve `ReportWriteFailed` si le disque refuse : les morceaux sont deja extraits,
    seul le rapport manque, et l'appelant doit pouvoir le dire.
    """
    stamp = context.generated_at.strftime(TIMESTAMP_FORMAT)
    json_path = context.destination_folder / f"{FILE_STEM}-{stamp}.json"
    markdown_path = context.destination_folder / f"{FILE_STEM}-{stamp}.md"

    try:
        context.destination_folder.mkdir(parents=True, exist_ok=True)
        json_path.write_text(render_json(result, context), encoding="utf-8")
        markdown_path.write_text(render_markdown(result, context), encoding="utf-8")
    except OSError as error:
        raise ReportWriteFailed(json_path, error) from error

    return ReportPaths(json_path=json_path, markdown_path=markdown_path)
```

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `cd sidecar && uv run pytest tests/unit/test_reports_json.py -x -q`
Expected: PASS, 17 tests

- [ ] **Step 5: Vérifier le gate qualité complet**

Run: `just test && just lint && just typecheck`
Expected: 22 tests de rapport verts, couverture au-dessus de 80 %, Ruff et Mypy sans erreur

- [ ] **Step 6: Commit**

```bash
git add sidecar/src/tagger/reports.py sidecar/tests/unit/test_reports_json.py
git commit -m "feat(plan): ecrire le rapport d extraction dans le dossier destination"
```

---

## Vérification de l'état livré

L'incrément est complet quand `just test && just lint && just typecheck` rend les trois gates verts et que les scénarios du spec sont couverts : deux fichiers horodatés déposés dans la destination et leurs chemins rendus (Task 3), champ de version et champ de nature du rapport (Task 1), cinq catégories et leurs décomptes (Task 1), homonyme départagé vérifiable avec chemins, tailles et critère (Tasks 1 et 2), rendu en anglais (Task 2), non-ASCII lisible (Tasks 1 et 2), rendu déterministe (Task 1).

Ce que ce sub-project ne fait pas : appeler l'extraction, exposer le chemin du rapport en NDJSON (sub-project 04), relire un rapport passé ni migrer un schéma antérieur, qui n'existe pas.
