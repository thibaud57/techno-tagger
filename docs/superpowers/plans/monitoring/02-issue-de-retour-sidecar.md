# Issue de retour de matching, côté sidecar : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire, depuis le rapport de re-tagging d'un run, l'URL d'une issue GitHub pré-remplie par l'Issue Form du dépôt et un export JSON nettoyé à y joindre, sans chemin absolu ni donnée hors liste fermée.

**Architecture:** Un module `sidecar/src/tagger/reports/feedback.py` porte trois fonctions pures ou presque : `feedback_issue_url` (URL de l'Issue Form, résumé borné à 2048 caractères encodés), `write_feedback_export` (export JSON par liste fermée de champs, nom horodaté) et `purge_feedback_exports` (rétention de 30 jours, appelée au démarrage). L'Issue Form `.github/ISSUE_TEMPLATE/matching-report.yml` pose le label `matching-report` et déclare les `id` que l'URL remplit.

**Tech Stack:** Python 3.14, pydantic 2.14, `urllib.parse`, pytest.

**Spec:** `docs/superpowers/specs/monitoring/02-issue-de-retour-sidecar-design.md`

## Global Constraints

- `MAX_URL_LENGTH = 2048` : borne sur l'URL entière, encodée
- Formulaire `matching-report.yml`, label `matching-report`, champs `version`, `summary`, `export`, `notes`
- Jamais de paramètre `labels` dans l'URL : GitHub rend une 404 à qui n'a pas le droit de poser un label
- Export dans `app_data_dir()/feedback/`, nom `stamped_name(report.generated_at, report.run_id, ".json")`, rétention `RETENTION` (30 jours) par `purge_stamped`
- Résumé, titre, formulaire et export en anglais (ADR-014)
- Ordre des lignes : non résolus, lien (`Resolution.URL`), arbitrage (`Resolution.ARBITRATION`), erreurs d'écriture, puis le reste par score croissant ; restaurés et non traités comptés, jamais listés
- Tests en anglais, AAA sans commentaire de section ; commentaires et docstrings en français, sans accents dans le code (convention du dépôt) ; Ruff `line-length = 100`, Mypy strict
- Aucune action sur le dépôt GitHub (création du label) sans confirmation explicite du propriétaire au moment de l'exécution

## Review Focus

- **Ligne trop longue pour le budget restant** : le remplissage s'arrête là, jamais une ligne plus courte casée après. Test en Task 3
- **Titre non ASCII sur un gros run** : la borne tient à la longueur encodée. Test en Task 3
- **Sous-dossier du run qui nomme autre chose qu'un morceau** (« Private Party/... ») : absent de l'URL comme de l'export. Tests en Task 2 et Task 3
- **Mention `@pseudo` ou référence `#12` dans un nom de fichier ou un titre** : rendue en code span dans le résumé de l'issue publique, backtick interne remplacé par une apostrophe. Test en Task 3
- **Ligne « more » et borne de 2048** : la place de la ligne finale est réservée à chaque ligne gardée, quelle que soit la longueur des lignes. Test paramétré en Task 3
- **Export d'un run de plus de 30 jours** : purgé au démarrage suivant, accepté le 2026-10-16 (le nom porte la date du run). Rien à tester de plus que la purge de Task 2
- **Rapport sans morceau listable** : la ligne de compteurs seule, aucune table vide. Test en Task 3
- **Export dans un dossier impossible à créer** : `FeedbackExportWriteError` qui nomme le fichier, rien d'autre. Test en Task 2

---

### Task 1 : Issue Form et identifiants de ses champs

**Files:**
- Create: `.github/ISSUE_TEMPLATE/matching-report.yml`
- Create: `sidecar/src/tagger/reports/feedback.py` (constantes seules à ce stade)
- Create: `sidecar/tests/unit/reports/test_feedback.py`

**Interfaces:**
- Produces : `ISSUE_TEMPLATE: Final = "matching-report.yml"`, `VERSION_FIELD: Final = "version"`, `SUMMARY_FIELD: Final = "summary"`, `EXPORT_FIELD: Final = "export"` dans `tagger.reports.feedback`

- [ ] **Step 1 : écrire le test qui échoue**

`sidecar/tests/unit/reports/test_feedback.py` :

```python
"""Issue de retour de matching : le depot est public, seul ce que la liste fermee laisse
passer en sort (ADR-014).
"""

import re
from pathlib import Path
from typing import Final

from tagger.reports.feedback import EXPORT_FIELD, ISSUE_TEMPLATE, SUMMARY_FIELD, VERSION_FIELD

TEMPLATE: Final = Path(__file__).resolve().parents[4] / ".github" / "ISSUE_TEMPLATE" / ISSUE_TEMPLATE


def test_the_issue_form_declares_every_field_the_url_fills() -> None:
    """Un `id` absent du formulaire est ignore par GitHub sans erreur : le champ arriverait
    vide et rien ne le signalerait.
    """
    declared = set(re.findall(r"^\s+id:\s*(\S+)\s*$", TEMPLATE.read_text(encoding="utf-8"), re.M))

    assert {VERSION_FIELD, SUMMARY_FIELD, EXPORT_FIELD} <= declared
```

- [ ] **Step 2 : lancer, il échoue**

Run : `cd sidecar && uv run pytest tests/unit/reports/test_feedback.py -x -q`
Expected : FAIL à l'import, `tagger.reports.feedback` introuvable

- [ ] **Step 3 : implémenter**

`sidecar/src/tagger/reports/feedback.py` :

```python
"""Issue de retour de matching (ADR-014) : URL de l'Issue Form du depot, pre-remplie d'un
resume du run borne a ce que Windows sait ouvrir, et export JSON nettoye a y joindre.

L'application ne pousse rien : l'utilisateur ouvre l'issue, relit, joint ou non l'export,
valide. Le depot est public : seul ce que les listes fermees du resume et de l'export laissent
passer en sort.
"""

from typing import Final

# Formulaire `.github/ISSUE_TEMPLATE/matching-report.yml` et `id` de ses champs, gardes par un
# test qui relit le formulaire. Le label vit dans le formulaire seul : un `labels` dans l'URL
# exige le droit de poser un label, sans lequel GitHub rend une 404.
ISSUE_TEMPLATE: Final = "matching-report.yml"
VERSION_FIELD: Final = "version"
SUMMARY_FIELD: Final = "summary"
EXPORT_FIELD: Final = "export"
```

`.github/ISSUE_TEMPLATE/matching-report.yml` :

```yaml
name: Matching report
description: Sent from the run summary of Techno Tagger, to improve how tracks are matched.
title: "Matching report"
labels: ["matching-report"]
body:
  - type: markdown
    attributes:
      value: |
        This issue is public. Review everything below before submitting, and remove any line or file you do not want to share.
  - type: input
    id: version
    attributes:
      label: Version
      description: Filled in by the app.
    validations:
      required: true
  - type: textarea
    id: summary
    attributes:
      label: Summary
      description: The tracks of the run that say the most about matching, filled in by the app.
    validations:
      required: true
  - type: textarea
    id: export
    attributes:
      label: Full run export
      description: The app opened the folder holding the export of the run. Drag the file into this field, or leave it out.
  - type: textarea
    id: notes
    attributes:
      label: Notes
      description: Anything the summary does not say, such as the right match for a track.
```

- [ ] **Step 4 : lancer, il passe**

Run : `cd sidecar && uv run pytest tests/unit/reports/test_feedback.py -x -q`
Expected : PASS

- [ ] **Step 5 : commit**

```bash
git add .github/ISSUE_TEMPLATE/matching-report.yml sidecar/src/tagger/reports/feedback.py sidecar/tests/unit/reports/test_feedback.py
git commit -m "feat(sidecar): issue form des retours de matching et identifiants de ses champs"
```

---

### Task 2 : export nettoyé, écriture et purge

**Files:**
- Modify: `sidecar/src/tagger/reports/feedback.py`
- Modify: `sidecar/src/tagger/__main__.py:498-531` (`main`, `_purge_old_feedback`)
- Modify: `public/i18n/fr.json`, `public/i18n/en.json` (`errors.feedback_export_write_failed`)
- Modify: `sidecar/tests/helpers/tagging_report_samples.py` (`report_track`, `report_of`, `COMMENT`, `HOME_FOLDER`)
- Test: `sidecar/tests/unit/reports/test_feedback.py`, `sidecar/tests/unit/test_main.py`

**Interfaces:**
- Consumes : `TaggingReport`, `TaggingReportTrack`, `ReportQuery`, `ReportScores`, `ReportTagValue`, `ReportThresholds`, `TaggingReportCounts` de `tagger.reports.tagging` ; `stamped_name`, `write_atomically`, `purge_stamped`, `PENDING_SUFFIX` de `tagger.core.run_files` ; `app_data_dir` de `tagger.core.paths`
- Produces :
  - `FeedbackTrack`, `FeedbackExport` (modèles pydantic, `frozen`, `extra="forbid"`)
  - `feedback_export(report: TaggingReport, release: str) -> FeedbackExport`
  - `feedback_dir() -> Path`
  - `export_path(folder: Path, report: TaggingReport) -> Path`
  - `write_feedback_export(folder: Path, report: TaggingReport, release: str) -> Path`
  - `purge_feedback_exports(folder: Path, now: datetime) -> None`
  - `FeedbackExportWriteError(path: Path)`, `code = "feedback_export_write_failed"`, `params = {"file": path.name}`
  - dans `tests/helpers/tagging_report_samples.py` : `report_track(...)`, `report_of(...)`, `COMMENT`, `HOME_FOLDER`, réutilisés en Task 3

- [ ] **Step 1 : écrire les tests qui échouent**

Les fabriques d'un morceau et d'un rapport vont dans le helper partagé `sidecar/tests/helpers/tagging_report_samples.py`, qui porte déjà `RUN`, `BEFORE` et `FOLDER` (`.claude/rules/pytest/tests.md` : chercher le helper avant d'en écrire un). Elles y restent à disposition de la Task 3 et du sub-project 03.

Dans ce helper, ajouter aux imports (`ARTWORK_URL` et `YOUR_MIND` se joignent à l'import existant de `scraper_responses`) :

```python
from collections import Counter

from scraper_responses import ARTWORK_URL, YOUR_MIND
from tagging_api import CREATED

from tagger.reports.tagging import (
    ReportQuery,
    ReportScores,
    ReportThresholds,
    TaggingReport,
    TaggingReportCounts,
    TaggingReportTrack,
    tag_rows,
)
from tagger.resolution.matching import QueryOrigin
```

et `TrackFailureReason`, `TrackState` à l'import existant de `tagger.run.models`. Puis poser `COMMENT` au-dessus de `BEFORE`, qui le lit à la place de sa valeur en dur :

```python
COMMENT: Final = "ripped from vinyl"
HOME_FOLDER: Final = Path(r"C:\Users\jane\Music\Private Party")
CANDIDATE_URL: Final = "https://www.beatport.com/track/your-mind/99000101"
# BEFORE = ShownTags(..., comment=COMMENT)
```

et ajouter à la fin du fichier :

```python
def report_track(
    name: str,
    state: TrackState | None = TrackState.WRITTEN,
    resolution: Resolution | None = Resolution.AUTO,
    *,
    failure_reason: TrackFailureReason | None = None,
    average: float = 95.0,
    title: str = "Your Mind (Extended Mix)",
) -> TaggingReportTrack:
    """Morceau du rapport ; un non resolu n'a ni candidat ni score."""
    unresolved = state is TrackState.UNRESOLVED
    scores = ReportScores(
        artist=average,
        title=average,
        average=average,
        version_mismatch=False,
        number_mismatch=False,
    )
    return TaggingReportTrack(
        track_id=name,
        file_before=name,
        file_after=None,
        truncated=False,
        query=ReportQuery(text=YOUR_MIND, origin=QueryOrigin.TAGS),
        source=None if unresolved else Source.BEATPORT,
        state=state,
        resolution=resolution,
        failure_reason=failure_reason,
        scores=None if unresolved else scores,
        artist=None if unresolved else "Adam Beyer",
        title=None if unresolved else title,
        url=None if unresolved else CANDIDATE_URL,
        artwork_url=None if unresolved else ARTWORK_URL,
        system=BEFORE.system,
        tags_before=tag_rows(BEFORE.fields, BEFORE.system),
        comment_before=BEFORE.comment,
        tags_after=None,
        fields_written=(),
        artwork_written=False,
    )


def report_of(*tracks: TaggingReportTrack, folder: Path = FOLDER) -> TaggingReport:
    states = Counter(track.state for track in tracks)
    return TaggingReport(
        generated_at=CREATED,
        run_id=RUN_ID,
        folder=folder,
        thresholds=ReportThresholds(floor=70, ceiling=90),
        counts=TaggingReportCounts(
            written=states[TrackState.WRITTEN],
            write_error=states[TrackState.WRITE_ERROR],
            unresolved=states[TrackState.UNRESOLVED],
            rolled_back=states[TrackState.ROLLED_BACK],
            not_processed=states[None],
        ),
        tracks=tracks,
    )
```

Puis, dans `test_feedback.py`, ces imports (en plus de ceux de la Task 1) :

```python
import json
from datetime import UTC, datetime, timedelta

import pytest
from tagging_report_samples import COMMENT, HOME_FOLDER, report_of, report_track

from tagger import RELEASE
from tagger.core.run_files import stamped_name
from tagger.reports.feedback import (
    FeedbackExportWriteError,
    export_path,
    purge_feedback_exports,
    write_feedback_export,
)
```

et les tests :

```python
TRACK_KEYS: Final = {
    "file_before",
    "file_after",
    "truncated",
    "query",
    "source",
    "state",
    "resolution",
    "failure_reason",
    "scores",
    "artist",
    "title",
    "url",
    "tags_before",
    "tags_after",
    "fields_written",
    "artwork_written",
}


def test_the_export_keeps_only_the_closed_list_of_fields(tmp_path: Path) -> None:
    report = report_of(report_track("a.mp3"))

    path = write_feedback_export(tmp_path, report, RELEASE)

    exported = json.loads(path.read_text(encoding="utf-8"))
    assert set(exported) == {"kind", "release", "generated_at", "thresholds", "counts", "tracks"}
    assert exported["release"] == RELEASE
    assert set(exported["tracks"][0]) == TRACK_KEYS


def test_the_export_leaves_out_the_run_folder_its_subfolders_and_the_comment(
    tmp_path: Path,
) -> None:
    report = report_of(report_track("Night Shift/a.mp3"), folder=HOME_FOLDER)

    path = write_feedback_export(tmp_path, report, RELEASE)

    content = path.read_text(encoding="utf-8")
    assert json.loads(content)["tracks"][0]["file_before"] == "a.mp3"
    assert not [part for part in ("jane", "Private Party", "Night Shift", COMMENT) if part in content]


def test_a_second_export_of_the_same_run_rewrites_the_same_file(tmp_path: Path) -> None:
    report = report_of(report_track("a.mp3"))
    first = write_feedback_export(tmp_path, report, RELEASE)

    second = write_feedback_export(tmp_path, report, RELEASE)

    assert second == first
    assert list(tmp_path.iterdir()) == [first]


def test_an_export_that_cannot_be_written_names_its_file(tmp_path: Path) -> None:
    blocker = tmp_path / "feedback"
    blocker.write_text("", encoding="utf-8")
    report = report_of(report_track("a.mp3"))

    with pytest.raises(FeedbackExportWriteError) as error:
        write_feedback_export(blocker, report, RELEASE)

    assert error.value.params == {"file": export_path(blocker, report).name}


def test_the_purge_removes_an_export_past_the_retention_and_keeps_a_recent_one(
    tmp_path: Path,
) -> None:
    now = datetime(2026, 10, 16, 9, 0, tzinfo=UTC)
    expired = tmp_path / stamped_name(now - timedelta(days=31), "a1b2c3", ".json")
    recent = tmp_path / stamped_name(now - timedelta(days=2), "d4e5f6", ".json")
    for path in (expired, recent):
        path.write_text("{}", encoding="utf-8")

    purge_feedback_exports(tmp_path, now)

    assert list(tmp_path.iterdir()) == [recent]
```

Dans `sidecar/tests/unit/test_main.py` :
- ajouter `from tagger.core.run_files import stamped_name` et `from tagger.reports.feedback import feedback_dir` et `import contextlib`
- dans `test_logging_and_sentry_are_armed_before_the_loop`, patcher et attacher `_purge_old_feedback` comme les deux autres et l'insérer dans l'ordre attendu après `"_purge_old_plans"`
- remplacer `test_a_failed_purge_never_stops_the_startup` par :

```python
# Fonction de purge du module de domaine, et garde de `__main__` qui l'appelle.
_PURGES: Final = {
    "purge_dumps": "_purge_old_dumps",
    "purge_plans": "_purge_old_plans",
    "purge_feedback_exports": "_purge_old_feedback",
}


@pytest.mark.parametrize(
    ("failing", "message"),
    [
        ("purge_dumps", "tag dump purge failed"),
        ("purge_plans", "run plan purge failed"),
        ("purge_feedback_exports", "feedback export purge failed"),
    ],
    ids=["dumps", "plans", "feedback"],
)
def test_a_failed_purge_never_stops_the_startup(
    startup: _Startup, caplog: pytest.LogCaptureFixture, failing: str, message: str
) -> None:
    with contextlib.ExitStack() as patches:
        patches.enter_context(
            patch.object(__main__, failing, autospec=True, side_effect=OSError(5, "denied"))
        )
        for purge, guard in _PURGES.items():
            if purge != failing:
                patches.enter_context(patch.object(__main__, guard, autospec=True))
        __main__.main()

    startup.run_loop.assert_called_once()
    assert message in caplog.messages
```

- ajouter :

```python
@pytest.mark.usefixtures("app_data")
def test_the_startup_purge_removes_the_feedback_exports_older_than_thirty_days() -> None:
    expired = feedback_dir() / stamped_name(datetime.now(UTC) - timedelta(days=31), "a1b2c3", ".json")
    expired.parent.mkdir(parents=True)
    expired.write_text("{}", encoding="utf-8")

    __main__._purge_old_feedback()

    assert not expired.exists()
```

- [ ] **Step 2 : lancer, ils échouent**

Run : `cd sidecar && uv run pytest tests/unit/reports/test_feedback.py tests/unit/test_main.py -x -q`
Expected : FAIL à l'import de `FeedbackExportWriteError`

- [ ] **Step 3 : implémenter l'export**
Compléter `feedback.py` (imports en tête, au-dessus des constantes de Task 1) :

```python
from pathlib import PurePosixPath
from typing import TYPE_CHECKING, ClassVar, Final, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict

from tagger.core.errors import TaggerError
from tagger.core.paths import app_data_dir
from tagger.core.run_files import PENDING_SUFFIX, purge_stamped, stamped_name, write_atomically
from tagger.reports.tagging import (
    ReportQuery,
    ReportScores,
    ReportTagValue,
    ReportThresholds,
    TaggingReport,
    TaggingReportCounts,
    TaggingReportTrack,
)
from tagger.resolution.scraper_client import Source
from tagger.run.models import Resolution, TrackFailureReason, TrackState
from tagger.tags.files import TagField

if TYPE_CHECKING:
    from datetime import datetime
    from pathlib import Path
```

Puis, après les constantes de Task 1 :

```python
EXPORT_KIND: Final = "matching-feedback"
_SUFFIX: Final = ".json"
# Un temporaire laisse par une ecriture coupee porte le meme contenu : meme retention.
_RETAINED_SUFFIXES: Final = (_SUFFIX, PENDING_SUFFIX)


class FeedbackExportWriteError(TaggerError):
    """Export non ecrit : la preparation echoue, rien ne s'ouvre."""

    code: ClassVar[str] = "feedback_export_write_failed"

    def __init__(self, path: Path) -> None:
        super().__init__(f"feedback export not written: {path.name}", file=path.name)


class _FeedbackModel(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class FeedbackTrack(_FeedbackModel):
    """Liste fermee : un champ ajoute a `TaggingReportTrack` n'en sort pas sans decision.

    Ecartes : `track_id` (chemin relatif, sous-dossiers compris), `artwork_url`, `system` et
    `comment_before`, texte libre de l'utilisateur.
    """

    file_before: str
    file_after: str | None
    truncated: bool
    query: ReportQuery | None
    source: Source | None
    state: TrackState | None
    resolution: Resolution | None
    failure_reason: TrackFailureReason | None
    scores: ReportScores | None
    artist: str | None
    title: str | None
    url: str | None
    tags_before: tuple[ReportTagValue, ...] | None
    tags_after: tuple[ReportTagValue, ...] | None
    fields_written: tuple[TagField, ...]
    artwork_written: bool


class FeedbackExport(_FeedbackModel):
    """Le run tel qu'il part dans une issue publique : ni `folder` (chemin absolu, compte de
    l'OS) ni `run_id`, que porte deja le nom du fichier. Jamais relu par l'application.
    """

    kind: Literal["matching-feedback"] = EXPORT_KIND
    release: str
    generated_at: AwareDatetime
    thresholds: ReportThresholds
    counts: TaggingReportCounts
    tracks: tuple[FeedbackTrack, ...]


def feedback_export(report: TaggingReport, release: str) -> FeedbackExport:
    return FeedbackExport(
        release=release,
        generated_at=report.generated_at,
        thresholds=report.thresholds,
        counts=report.counts,
        tracks=tuple(_export_track(track) for track in report.tracks),
    )


def feedback_dir() -> Path:
    return app_data_dir() / "feedback"


def export_path(folder: Path, report: TaggingReport) -> Path:
    """Meme nom pour le meme run : un nouveau clic reecrit l'export au lieu d'en ajouter un.

    Le nom porte la date du run : l'export d'un run de plus de 30 jours est purge au demarrage
    suivant, accepte le 2026-10-16 (il ne sert qu'au glisser-deposer qui suit le clic).
    """
    return folder / stamped_name(report.generated_at, report.run_id, _SUFFIX)


def write_feedback_export(folder: Path, report: TaggingReport, release: str) -> Path:
    """Ecrit l'export, lisible pour etre relu. Leve `FeedbackExportWriteError`."""
    path = export_path(folder, report)
    try:
        write_atomically(path, feedback_export(report, release).model_dump_json(indent=2))
    except OSError as error:
        raise FeedbackExportWriteError(path) from error
    return path


def purge_feedback_exports(folder: Path, now: datetime) -> None:
    """Supprime les exports passes la retention : ils ne servent qu'a etre joints a une issue."""
    purge_stamped(folder, _RETAINED_SUFFIXES, now, "feedback export not purged")


def file_name(relative: str) -> str:
    """Nom du fichier seul : un sous-dossier du run peut nommer autre chose qu'un morceau."""
    return PurePosixPath(relative).name


def _export_track(track: TaggingReportTrack) -> FeedbackTrack:
    return FeedbackTrack(
        file_before=file_name(track.file_before),
        file_after=None if track.file_after is None else file_name(track.file_after),
        truncated=track.truncated,
        query=track.query,
        source=track.source,
        state=track.state,
        resolution=track.resolution,
        failure_reason=track.failure_reason,
        scores=track.scores,
        artist=track.artist,
        title=track.title,
        url=track.url,
        tags_before=track.tags_before,
        tags_after=track.tags_after,
        fields_written=track.fields_written,
        artwork_written=track.artwork_written,
    )
```

`model_dump_json` n'échappe pas les caractères non ASCII : le fichier reste lisible tel quel.

- [ ] **Step 4 : brancher la purge au démarrage**

Dans `sidecar/src/tagger/__main__.py`, importer `from tagger.reports.feedback import feedback_dir, purge_feedback_exports`, appeler `_purge_old_feedback()` dans `main()` juste après `_purge_old_plans()` et ajouter après `_purge_old_plans` :

```python
def _purge_old_feedback() -> None:
    # Meme garde que les dumps : un export qui reste quelques jours de plus ne gene personne.
    try:
        purge_feedback_exports(feedback_dir(), datetime.now(UTC))
    except OSError:
        logger.exception("feedback export purge failed")
```

- [ ] **Step 5 : traduire le nouveau code d'erreur**

`test_every_error_code_has_a_translation` importe tous les modules du sidecar et exige une phrase pour chaque code de `TaggerError` : sans elle, il échoue dès que `feedback.py` existe. Ajouter dans la section `errors` de `public/i18n/fr.json`, à côté de `run_not_written` :

```json
    "feedback_export_write_failed": "L'export du run n'a pas pu être écrit dans le dossier de l'application.\nVérifiez l'espace disque, puis renvoyez le rapport.",
```

et dans `public/i18n/en.json` :

```json
    "feedback_export_write_failed": "The run export could not be written to the application folder.\nCheck the free disk space, then send the report again.",
```

Conventions : vouvoiement, une phrase par ligne, le geste qui répare (`.claude/rules/ngx-translate/i18n.md`). Le libellé du bouton (« envoyer ce rapport ») est posé au sub-project 04 : garder le même verbe.

- [ ] **Step 6 : lancer, tout passe, puis typage**

Run : `cd sidecar && uv run pytest tests/unit/reports/test_feedback.py tests/unit/reports/test_tagging.py tests/unit/test_main.py tests/unit/test_error_translations.py -x -q && uv run mypy src tests`
Expected : PASS, `Success: no issues found`

- [ ] **Step 7 : commit**

```bash
git add sidecar/src/tagger/reports/feedback.py sidecar/src/tagger/__main__.py sidecar/tests/unit/reports/test_feedback.py sidecar/tests/unit/test_main.py public/i18n/fr.json public/i18n/en.json
git commit -m "feat(sidecar): export nettoye d'un run a joindre a une issue, purge au demarrage"
```

---

### Task 3 : URL de l'issue, résumé borné

**Files:**
- Modify: `sidecar/src/tagger/__init__.py` (`REPOSITORY_URL`)
- Modify: `sidecar/src/tagger/reports/tagging.py:207,304` (`_score` devient `format_score`)
- Modify: `sidecar/src/tagger/reports/feedback.py`
- Test: `sidecar/tests/unit/reports/test_feedback.py`, `sidecar/tests/unit/test_main.py`

**Interfaces:**
- Consumes : `report_track`, `report_of`, `COMMENT`, `HOME_FOLDER` de `tests/helpers/tagging_report_samples.py` (Task 2), `file_name(relative: str) -> str` (Task 2), `table_row(*cells: object) -> str` de `tagger.reports.extraction`
- Produces :
  - `REPOSITORY_URL: Final = "https://github.com/thibaud57/techno-tagger"` dans `tagger`
  - `format_score(track: TaggingReportTrack) -> str` dans `tagger.reports.tagging`
  - `MAX_URL_LENGTH: Final = 2048`
  - `feedback_issue_url(report: TaggingReport, release: str, export_name: str) -> str`, consommé par `03-protocole-ndjson-retour`

- [ ] **Step 1 : écrire les tests qui échouent**

Ajouter aux imports de `test_feedback.py` : `from urllib.parse import parse_qs, unquote_plus, urlsplit`, `RUN_ID` depuis `tagging_records`, `from tagger import REPOSITORY_URL`, `MAX_URL_LENGTH` et `feedback_issue_url` depuis `tagger.reports.feedback`, `FileFailureReason` depuis `tagger.core.file_failures`, `FailureReason`, `Resolution` et `TrackState` depuis `tagger.run.models`.

```python
EXPORT_NAME: Final = f"20261006T211403Z-{RUN_ID}.json"
# Hauteur approximative d'une ligne de la table, en caracteres encodes : la derniere garde ne
# laisse jamais plus de place que cela, sans quoi le remplissage s'est arrete trop tot.
ROW_HEIGHT: Final = 200


def _query(url: str) -> dict[str, list[str]]:
    return parse_qs(urlsplit(url).query)


def _summary(url: str) -> str:
    return _query(url)[SUMMARY_FIELD][0]


def _rows(url: str) -> list[str]:
    """Lignes de la table, en-tete et separateur exclus : seul le fichier d'une ligne ouvre un
    code span.
    """
    return [line for line in _summary(url).splitlines() if line.startswith("| `")]


def _files_listed(url: str) -> list[str]:
    """Premiere cellule de chaque ligne, sans les backticks de son code span."""
    return [row.split(" | ")[0].removeprefix("| ").strip("`") for row in _rows(url)]


def test_the_url_opens_the_issue_form_of_the_repository_without_any_label() -> None:
    url = feedback_issue_url(report_of(report_track("a.mp3")), RELEASE, EXPORT_NAME)

    parts = urlsplit(url)
    query = _query(url)
    assert f"{parts.scheme}://{parts.netloc}{parts.path}" == f"{REPOSITORY_URL}/issues/new"
    assert query["template"] == [ISSUE_TEMPLATE]
    assert "labels" not in query
    assert query[VERSION_FIELD] == [RELEASE]
    assert query[EXPORT_FIELD] == [f"Drop {EXPORT_NAME} here"]


def test_the_title_carries_the_counts_and_the_release() -> None:
    report = report_of(
        report_track("a.mp3"),
        report_track("b.mp3", TrackState.UNRESOLVED, Resolution.NONE, failure_reason=FailureReason.NO_RESULT),
    )

    url = feedback_issue_url(report, RELEASE, EXPORT_NAME)

    assert _query(url)["title"] == [f"Matching report: 1 written, 1 unresolved ({RELEASE})"]


def test_the_tracks_that_say_the_most_about_matching_come_first() -> None:
    report = report_of(
        report_track("auto-high.mp3", average=97.0),
        report_track("auto-low.mp3", average=72.0),
        report_track(
            "locked.mp3",
            TrackState.WRITE_ERROR,
            failure_reason=FileFailureReason.FILE_LOCKED,
        ),
        report_track("arbitrated.mp3", resolution=Resolution.ARBITRATION),
        report_track("rescued.mp3", resolution=Resolution.URL),
        report_track("missing.mp3", TrackState.UNRESOLVED, Resolution.NONE, failure_reason=FailureReason.NO_RESULT),
    )

    url = feedback_issue_url(report, RELEASE, EXPORT_NAME)

    assert _files_listed(url) == [
        "missing.mp3",
        "rescued.mp3",
        "arbitrated.mp3",
        "locked.mp3",
        "auto-low.mp3",
        "auto-high.mp3",
    ]


def test_a_rolled_back_or_unprocessed_track_is_counted_but_never_listed() -> None:
    report = report_of(
        report_track("a.mp3"),
        report_track("restored.mp3", TrackState.ROLLED_BACK, None),
        report_track("waiting.mp3", None, None),
    )

    url = feedback_issue_url(report, RELEASE, EXPORT_NAME)

    assert _files_listed(url) == ["a.mp3"]
    assert "rolled back 1, not processed 1" in _summary(url)


def test_a_cell_holding_a_pipe_or_a_line_break_keeps_the_table_whole() -> None:
    report = report_of(report_track("a.mp3", title="Your | Mind\nRemix"))

    url = feedback_issue_url(report, RELEASE, EXPORT_NAME)

    assert "`Adam Beyer - Your \\| Mind Remix`" in _summary(url)
    assert _files_listed(url) == ["a.mp3"]


def test_free_cells_are_code_spans_so_a_mention_or_a_reference_stays_inert() -> None:
    report = report_of(report_track("@jane #12.mp3", title="Your `Mind`"))

    url = feedback_issue_url(report, RELEASE, EXPORT_NAME)

    row = _rows(url)[0]
    assert row.startswith("| `@jane #12.mp3` | `")
    assert row.endswith("| `Adam Beyer - Your 'Mind'` |")


def test_a_large_run_stays_within_the_url_budget_and_counts_what_it_leaves_out() -> None:
    tracks = tuple(
        report_track(f"track-{index:03}.mp3", average=70.0 + index % 30) for index in range(500)
    )

    url = feedback_issue_url(report_of(*tracks), RELEASE, EXPORT_NAME)

    listed = _files_listed(url)
    assert MAX_URL_LENGTH - ROW_HEIGHT < len(url) <= MAX_URL_LENGTH
    assert _summary(url).endswith(f"_{500 - len(listed)} more tracks in the attached export._")


@pytest.mark.parametrize("padding", range(0, 60, 3))
def test_the_line_about_omitted_tracks_counts_in_the_budget(padding: int) -> None:
    """Selon la longueur des lignes, la derniere garde laisse plus ou moins de place : sans la
    reserve de la ligne finale, certaines longueurs depasseraient la borne.
    """
    title = "Your Mind " + "x" * padding
    tracks = tuple(report_track(f"track-{index:03}.mp3", title=title) for index in range(500))

    url = feedback_issue_url(report_of(*tracks), RELEASE, EXPORT_NAME)

    assert len(url) <= MAX_URL_LENGTH


def test_a_run_that_fits_whole_has_no_line_about_omitted_tracks() -> None:
    report = report_of(report_track("a.mp3"), report_track("b.mp3"))

    url = feedback_issue_url(report, RELEASE, EXPORT_NAME)

    assert _files_listed(url) == ["a.mp3", "b.mp3"]
    assert "more tracks" not in _summary(url)


def test_non_ascii_titles_are_counted_at_their_encoded_length() -> None:
    tracks = tuple(report_track(f"{index:03}.mp3", title="Ñandú 夜明け Ünïcødé") for index in range(200))

    url = feedback_issue_url(report_of(*tracks), RELEASE, EXPORT_NAME)

    assert len(url) <= MAX_URL_LENGTH


def test_the_list_stops_at_the_first_row_that_no_longer_fits() -> None:
    """L'ordre de priorite n'est jamais inverse pour caser une ligne plus courte : la ligne
    rattrapee par lien, trop longue pour le budget restant, arrete la liste, et les quarante
    lignes courtes qui suivent ne passent pas devant elle.
    """
    unresolved = tuple(
        report_track(f"unresolved-{index}.mp3", TrackState.UNRESOLVED, Resolution.NONE)
        for index in range(8)
    )
    oversized = report_track("rescued.mp3", resolution=Resolution.URL, title="Extended " * 150)
    short = tuple(report_track(f"{index}.mp3") for index in range(40))

    url = feedback_issue_url(report_of(*unresolved, oversized, *short), RELEASE, EXPORT_NAME)

    assert _files_listed(url) == [track.file_before for track in unresolved]
    assert _summary(url).endswith("_41 more tracks in the attached export._")


def test_a_run_without_any_listable_track_keeps_the_counts_and_no_table() -> None:
    report = report_of(report_track("restored.mp3", TrackState.ROLLED_BACK, None))

    url = feedback_issue_url(report, RELEASE, EXPORT_NAME)

    assert _files_listed(url) == []
    assert "| File" not in _summary(url)
    assert "rolled back 1" in _summary(url)


def test_the_url_leaves_out_the_run_folder_its_subfolders_and_the_comment() -> None:
    report = report_of(report_track("Night Shift/a.mp3"), folder=HOME_FOLDER)

    url = unquote_plus(feedback_issue_url(report, RELEASE, EXPORT_NAME))

    parts = (str(HOME_FOLDER), "jane", "Private Party", "Night Shift", COMMENT)
    assert not [part for part in parts if part in url]
```

Budget de `test_the_list_stops_at_the_first_row_that_no_longer_fits`, mesuré le 2026-10-16 avec la release `techno-tagger@0.7.0` : la partie fixe de l'URL fait 247 caractères, il reste 1801 au résumé. L'en-tête et les huit non résolus en prennent environ 990, la ligne « Extended » en pèse 1482 encodés (un backtick d'un code span coûte `%60`, soit trois caractères) et ne tient pas, alors que les lignes courtes de 155 caractères tiendraient. Une release plus longue réduit le budget sans changer le sens du test. Si le test échoue parce que la ligne longue tient encore, l'allonger plutôt que de toucher à l'assertion.

`ROW_HEIGHT` (200) borne par le haut la place qu'une dernière garde peut laisser avec des lignes de 155 caractères : un remplissage qui s'arrêterait une ligne trop tôt ferait échouer `test_a_large_run_stays_within_the_url_budget_and_counts_what_it_leaves_out`. Mutation vérifiée le 2026-10-16 : retirer `+ _encoded_length(_omitted(...))` de la boucle de `_summary` fait échouer six cas de `test_the_line_about_omitted_tracks_counts_in_the_budget`.

Dans `sidecar/tests/unit/test_main.py`, importer `REPOSITORY_URL` depuis `tagger` et ajouter :

```python
def test_the_repository_url_is_the_one_cargo_publishes() -> None:
    """Recopiee a la main : l'issue de retour de matching s'ouvrirait sur un autre depot."""
    cargo = tomllib.loads((REPO / "src-tauri/Cargo.toml").read_text(encoding="utf-8"))

    assert cargo["package"]["repository"] == REPOSITORY_URL
```

- [ ] **Step 2 : lancer, ils échouent**

Run : `cd sidecar && uv run pytest tests/unit/reports/test_feedback.py tests/unit/test_main.py -x -q`
Expected : FAIL à l'import de `REPOSITORY_URL`

- [ ] **Step 3 : implémenter**

`sidecar/src/tagger/__init__.py`, après `BUNDLE_IDENTIFIER` :

```python
# Recopiee de `repository` dans src-tauri/Cargo.toml, qu'aucun code du sidecar ne lit :
# l'issue de retour de matching s'ouvre sur ce depot (cf. reports/feedback.py).
REPOSITORY_URL: Final = "https://github.com/thibaud57/techno-tagger"
```

puis `__all__`, dans l'ordre que Ruff exige (RUF022, `"REPOSITORY_URL"` après `"RELEASE"`) :

```python
__all__ = ["APP_NAME", "BUNDLE_IDENTIFIER", "RELEASE", "REPOSITORY_URL", "__version__"]
```

`sidecar/src/tagger/reports/tagging.py` : renommer `_score` en `format_score` (définition et appel dans `render_tagging_markdown`), docstring inchangée.

`feedback.py`, imports à ajouter : `from urllib.parse import quote_plus, urlencode`, `from tagger import REPOSITORY_URL`, `from tagger.reports.extraction import table_row` et `format_score` depuis `tagger.reports.tagging`. Puis :

```python
# `tauri-plugin-opener` ouvre l'URL par la crate `open` 5 (`shellexecute-on-windows`), donc par
# `ShellExecuteExW` (chaine verifiee le 2026-10-16). INTERNET_MAX_URL_LENGTH vaut 2083 dans
# WinINET.h (blog IEInternals, Microsoft, « URL Length Limits ») et Raymond Chen ecrit « around
# 2048 » (The Old New Thing, 2003-12-10) : on garde 2048. GitHub rend 414 des 8192 octets
# (mesure publiee, date non confirmee) : c'est Windows qui borne. Mesure sur l'URL entiere.
MAX_URL_LENGTH: Final = 2048

_HEADER: Final = ("File", "Query", "Route", "Score", "Match")
# Ni decision ni candidat : comptes dans la ligne de tete, jamais listes.
_UNLISTED: Final = frozenset({None, TrackState.ROLLED_BACK})


def feedback_issue_url(report: TaggingReport, release: str, export_name: str) -> str:
    """URL de l'Issue Form pre-remplie, au plus `MAX_URL_LENGTH` caracteres une fois encodee.

    Encodage de formulaire (espaces en `+`), le plus court : un caractere sur trois du resume
    est une espace. Le resume vient en dernier, il prend le budget que le reste laisse.
    """
    counts = report.counts
    fixed = {
        "template": ISSUE_TEMPLATE,
        "title": (
            f"Matching report: {counts.written} written, {counts.unresolved} unresolved ({release})"
        ),
        VERSION_FIELD: release,
        EXPORT_FIELD: f"Drop {export_name} here",
    }
    base = f"{REPOSITORY_URL}/issues/new?{urlencode(fixed)}&{SUMMARY_FIELD}="
    return base + quote_plus(_summary(report, MAX_URL_LENGTH - len(base)))


def _summary(report: TaggingReport, budget: int) -> str:
    """Resume Markdown dont la forme encodee tient dans `budget` caracteres.

    La longueur encodee d'une concatenation est la somme des longueurs encodees : chaque ligne
    s'encode une fois, et le remplissage s'arrete a la premiere qui ne tient plus, sans jamais
    caser une ligne plus courte apres elle.
    """
    counts = _counts_line(report)
    rows = [_row(track) for track in sorted(_listed(report), key=_rank)]
    if not rows:
        return counts
    head = "\n".join(
        [counts, "", f"| {' | '.join(_HEADER)} |", f"| {' | '.join('---' for _ in _HEADER)} |"]
    )
    costs = [_encoded_length("\n" + row) for row in rows]
    used = _encoded_length(head)
    if used + sum(costs) <= budget:
        return head + "".join("\n" + row for row in rows)
    kept = 0
    for cost in costs:
        if used + cost + _encoded_length(_omitted(len(rows) - kept - 1)) > budget:
            break
        used += cost
        kept += 1
    return head + "".join("\n" + row for row in rows[:kept]) + _omitted(len(rows) - kept)


def _encoded_length(text: str) -> int:
    return len(quote_plus(text))


def _omitted(count: int) -> str:
    return f"\n\n_{count} more tracks in the attached export._"


def _counts_line(report: TaggingReport) -> str:
    counts, thresholds = report.counts, report.thresholds
    return (
        f"Written {counts.written}, write errors {counts.write_error}, "
        f"unresolved {counts.unresolved}, rolled back {counts.rolled_back}, "
        f"not processed {counts.not_processed}. "
        f"Thresholds: floor {thresholds.floor:g}, ceiling {thresholds.ceiling:g}."
    )


def _listed(report: TaggingReport) -> list[TaggingReportTrack]:
    return [track for track in report.tracks if track.state not in _UNLISTED]


def _rank(track: TaggingReportTrack) -> tuple[int, float]:
    """Ce qui apprend le plus sur le matching d'abord (ADR-014) : l'ecart entre un nom de
    fichier, sa requete et le candidat. Un morceau valide haut la main n'apprend presque rien.
    Le tri est stable : a rang egal, l'ordre du rapport.
    """
    if track.state is TrackState.UNRESOLVED:
        return (0, 0.0)
    if track.resolution is Resolution.URL:
        return (1, 0.0)
    if track.resolution is Resolution.ARBITRATION:
        return (2, 0.0)
    if track.state is TrackState.WRITE_ERROR:
        return (3, 0.0)
    return (4, 0.0 if track.scores is None else track.scores.average)


def _row(track: TaggingReportTrack) -> str:
    query = "" if track.query is None else f"{_code(track.query.text)} ({track.query.origin})"
    match = _code(" - ".join(part for part in (track.artist, track.title) if part))
    file = _code(file_name(track.file_before))
    return table_row(file, query, _route(track), format_score(track), match)


def _code(text: str) -> str:
    """Code span : dans une issue publique, `@pseudo` et `#12` y restent inertes.

    Un backtick interne fermerait le span, il devient une apostrophe. `table_row` echappe ensuite
    le `|` et aplatit les retours a la ligne, ce que GFM accepte dans un code span de tableau.
    """
    if not text:
        return ""
    return "`" + text.replace("`", "'") + "`"


def _route(track: TaggingReportTrack) -> str:
    """Voie de resolution puis motif d'echec : c'est lui qui dit pourquoi le morceau a coince."""
    parts = [
        str(part)
        for part in (track.resolution, track.failure_reason)
        if part is not None and part is not Resolution.NONE
    ]
    return ", ".join(parts)
```

- [ ] **Step 4 : lancer, tout passe, puis la suite du sidecar**

Run : `cd sidecar && uv run ruff format . && uv run ruff check . && uv run mypy src tests && uv run pytest -x -q`
Expected : PASS, couverture au-dessus de 80 %

- [ ] **Step 5 : commit**

```bash
git add sidecar/src/tagger/__init__.py sidecar/src/tagger/reports/tagging.py sidecar/src/tagger/reports/feedback.py sidecar/tests/unit/reports/test_feedback.py sidecar/tests/unit/test_main.py
git commit -m "feat(sidecar): url de l'issue de retour de matching, resume borne a ce que Windows ouvre"
```

---

### Task 4 : documentation et label du dépôt

**Files:**
- Modify: `docs/adrs/014-observabilite-sentry-et-rgpd.md`
- Modify: `docs/ARCHITECTURE.md:123`, `:474-476`, `:970`
- Modify: `docs/PRODUCTION.md:537`

- [ ] **Step 1 : ADR-014**

Ajouter après la dernière **Mise à jour** datée :

```markdown
**Mise à jour 2026-10-16** : la forme de l'envoi se précise. Le bouton ouvre l'Issue Form `matching-report.yml`, qui pose le label `matching-report` : un paramètre `labels` dans l'URL rendrait une 404 à qui n'a pas le droit de poser un label, donc à tout utilisateur non collaborateur. L'URL, ouverte par `ShellExecuteExW`, tient en 2048 caractères : elle pré-remplit un résumé des morceaux qui en disent le plus sur le matching (non résolus, rattrapés par lien, arbitrés d'abord). Le run entier passe par un export JSON écrit dans `appLocalDataDir()/feedback/`, construit par liste fermée de champs (ni dossier du run, ni sous-dossier, ni commentaire d'origine), que l'utilisateur glisse dans l'issue ou non. L'application ne pousse toujours rien elle-même. Source : `sidecar/src/tagger/reports/feedback.py`.
```

- [ ] **Step 2 : ARCHITECTURE.md**

- l.123 : commentaire de `reports/` → `# rapports d'extraction et de re-tagging, registre des runs passés, issue de retour de matching`
- table des modules, après la ligne `index.py` : `| | `feedback.py` | Issue de retour de matching : URL de l'Issue Form, résumé borné à 2048 caractères, export nettoyé du run |`
- § Alerts, à la fin du second paragraphe : « Le bouton ouvre l'Issue Form `matching-report.yml`, qui pose le label `matching-report`, pré-remplie d'un résumé borné à 2048 caractères ; l'export nettoyé du run, écrit dans `appLocalDataDir()/feedback/` et purgé au démarrage après 30 jours, se glisse dans l'issue ([ADR-014](adrs/014-observabilite-sentry-et-rgpd.md)). »

- [ ] **Step 3 : PRODUCTION.md l.537**

Compléter la citation : « Les retours arrivent en issues du dépôt sous le label `matching-report`, posé par l'Issue Form `matching-report.yml`. Le label doit exister dans le dépôt, sinon le formulaire ne le pose pas, sans erreur. »

- [ ] **Step 4 : créer le label, après confirmation**

Demander au propriétaire la confirmation explicite avant toute action sur le dépôt public, puis :

Run : `gh label create matching-report --description "Matching report sent from the app" --color 0e8a16`
Expected : `✓ Label "matching-report" created`. Sans confirmation : ne rien lancer, noter l'étape comme restante pour `05-recette-monitoring`

- [ ] **Step 5 : commit**

```bash
git add docs/adrs/014-observabilite-sentry-et-rgpd.md docs/ARCHITECTURE.md docs/PRODUCTION.md
git commit -m "docs(sidecar): issue form des retours de matching et export nettoye du run"
```

---

### Task 5 : gate qualité

- [ ] **Step 1 : lint, typage, tests des trois zones**

Run : `just lint && just typecheck && just test`
Expected : tout vert, couverture du sidecar au-dessus de 80 %

- [ ] **Step 2 : passer la spec en `implemented`**

Réservé à `/implement-subproject`, après la chaîne de revue.
