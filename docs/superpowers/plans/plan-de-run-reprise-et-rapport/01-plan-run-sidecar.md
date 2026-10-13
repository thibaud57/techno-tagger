# Plan de run persisté : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persister au fil de l'eau, dans `appLocalDataDir()/plans`, un plan JSON versionné qui consigne chaque décision d'un run de tagging et purger au démarrage les plans qui ne servent plus.

**Architecture:** Un nouveau module `run_files.py` reprend de `tag_dump.py` le nom horodaté `<horodatage>-<run_id>`, l'écriture atomique, la relecture versionnée, la suppression gardée, le tri du plus récent au plus ancien et la durée de rétention. `plan.py` porte les modèles Pydantic du plan, sa relecture (refus d'une version inconnue), le `PlanRecorder` et la purge. Le `PlanRecorder` réécrit le plan hors de la boucle, par une tâche de vidage unique qui fusionne les rafales. `LiveRun.update` appelle un observateur, branché sur le recorder par `handlers.open_tagging`. `commit_run` marque le plan confirmé avant toute écriture de fichier. Un run remplacé supprime son plan, un `shutdown` ou un `cancel_run` le garde.

**Tech Stack:** Python 3.14, pydantic 2, pytest + pytest-asyncio. Fixtures `app_data`, `api`, `folder` ; helpers `ndjson_loop`, `tagging_api`, `tagging_records`, `scraper_responses`, `stubs`, `run_plans` (créé ici). Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/plan-de-run-reprise-et-rapport/01-plan-run-sidecar-design.md`

## Global Constraints

- **Lecture des blocs de code** : un bloc `diff` donne les lignes à supprimer (`-`) et à ajouter (`+`) autour de lignes de contexte, sans numéro de ligne. Un bloc précédé de « Ajouter à la fin du fichier » donne du code à poser tel quel. Un fichier à créer est donné en entier.
- **Emplacement** : `app_data_dir() / "plans" / "<YYYYMMDDTHHMMSSZ>-<run_id>.json"`, horodaté par `started_at` en UTC, au format `reports.TIMESTAMP_FORMAT`. `schema_version` = 1.
- **Version inconnue, JSON illisible, modèle invalide ou seuils incohérents** : `RunPlanUnreadableError`, code `run_plan_unreadable`, `params` = `file`, `found`, `expected`. Jamais de migration (ADR-018 option A, à l'inverse du rapport).
- **Frontière** : un plan est terminé dès `commit_run`. Un plan `committed` n'enregistre plus rien et la purge le supprime.
- **Un morceau traité** : `TrackRecord.decided`, règle unique (progression du plan, reprise, pipeline sélectif). Un morceau `unresolved` pour `source_unavailable` n'est pas traité : il repart sur le réseau à la reprise.
- **Hors du plan** : la pochette (chemin du cache), `identity`, `tags_before`, `written`, `restorable`, la clé API.
- **Écriture du plan en échec** : log ERROR `run plan not written run=<run_id> reason=write_failed errno=<errno>`, sans trace (celle d'un `OSError` porte le chemin complet, sous le profil Windows). Le run continue et le vidage suivant retente. Jamais d'exception levée vers le run.
- **Run remplacé** par un nouveau `start_tagging` : son plan non confirmé est supprimé sans être vidé d'abord. `shutdown`, EOF, `cancel_run` et crash gardent le plan.
- **Dossier sans fichier audio** : aucun plan.
- **Purge au démarrage**, après celle des dumps :
  - supprimés : `.tmp` horodaté, plan de plus de 30 jours selon le nom, plan `committed` ;
  - gardés : plan ouvert, plan illisible récent ;
  - ignoré : nom non horodaté.
  - Une erreur est loguée, jamais fatale.
- **Rétention** : `run_files.RETENTION` (30 jours), seule définition, importée par `tag_dump` et `plan`. Elle se compte depuis le `started_at` du plan, même repris.
- **Toute I/O fichier depuis du code async** passe par `asyncio.to_thread`. Toute tâche est nommée et gardée par référence forte.
- **Code Python sans accents**, docstrings et commentaires en français, le pourquoi seulement.
- **Tests** : noms en anglais, AAA séparé par des lignes vides (l'Act est l'appel testé), écriture dans `tmp_path`, `@pytest.mark.asyncio` sur les tests async. Pas de `iterdir()` direct dans un test async (ASYNC240) : passer par un helper synchrone.
- **Gate vert à chaque commit** : `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar` (le typage porte sur `src` et `tests`), plus `just lint-ui` quand un JSON de langue change. Commits `type(scope): description`, scope `plan`, `sidecar` ou `files`.

## Review Focus

- **Dossier sans fichier audio** : `start_tagging` se termine aussitôt et ne laisse aucun plan (Task 5, `test_leaves_no_plan_for_a_folder_without_audio`).
- **Plan impossible à écrire au moment de la confirmation** : `commit()` ne lève pas et l'écriture des fichiers part quand même (Task 3, `test_confirms_without_raising_when_the_plan_cannot_be_written`).
- **Décision arrivée pendant qu'une écriture du plan est en vol** : le disque finit sur cette décision, pas sur l'état d'avant (Task 3, `test_writes_a_change_that_arrives_while_a_write_is_in_flight`).
- **Chemin privé dans les logs** : un `OSError` d'écriture dont le nom de fichier est un chemin du profil n'en laisse rien dans le log (Task 3, `test_logs_a_plan_it_cannot_write_without_raising_or_leaking_the_path`).
- **Fichier étranger dans `plans/`** (`notes.json`, `notes.tmp`) : ignoré par la purge, jamais supprimé. **Plan illisible ou de version inconnue de moins de 30 jours** : gardé, pour que le sub-project 02 puisse dire pourquoi il ne reprend pas (Task 4, `test_purges_the_plans_that_will_never_be_resumed`).
- **Run arrêté par `cancel_run`** : son plan reste, les morceaux non atteints en attente (Task 5, `test_keeps_the_plan_of_a_run_stopped_by_cancel_run`).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `sidecar/src/tagger/run_files.py` | Nom horodaté d'un fichier de run, relecture de sa date et de son `run_id`, tri du plus récent au plus ancien, écriture atomique, relecture versionnée, suppression gardée, `RETENTION` |
| `sidecar/src/tagger/tag_dump.py` | Délègue à `run_files` sans changer de comportement |
| `sidecar/src/tagger/plan.py` | Modèles du plan, `plan_dir`, `plan_path`, `load_plan`, `RunPlanUnreadableError`, `PlanRecorder`, `discard_plan`, `purge_plans` |
| `sidecar/src/tagger/tagging.py` | `is_decided`, `TrackRecord.decided`, `LiveRun.observe` : observateur appelé à chaque `update` |
| `sidecar/src/tagger/handlers.py` | Création du recorder à l'ouverture, vidage à la fermeture, abandon, confirmation avant écriture |
| `sidecar/src/tagger/__main__.py` | Abandon du run remplacé, purge des plans au démarrage |
| `public/i18n/{fr,en}.json` | `errors.run_plan_unreadable` |
| `sidecar/tests/unit/test_run_files.py` | Nom horodaté, tri et écriture atomique |
| `sidecar/tests/unit/test_plan.py` | Modèle, relecture, recorder, abandon, purge |
| `sidecar/tests/unit/test_tagging_rules.py` | `TrackRecord.decided` et `LiveRun.observe` |
| `sidecar/tests/unit/test_main.py` | Ordre de démarrage, purge des plans en échec |
| `sidecar/tests/helpers/run_plans.py` | Fabriques de plans en mémoire et sur le disque, partagées avec le sub-project 02 |
| `sidecar/tests/integration/test_ndjson_plan.py` | Cycle de vie du plan piloté par `stdin` |
| `sidecar/tests/integration/test_ndjson_write.py` | La présence du dump se vérifie dans `dumps/`, plus par un glob qui matche aussi le plan |
| `docs/ARCHITECTURE.md` | Arborescence, § Données, diagramme de séquence, mode de panne en cours de run |

---

### Task 1: Fichiers horodatés d'un run

**Files:**
- Create: `sidecar/src/tagger/run_files.py`
- Modify: `sidecar/src/tagger/tag_dump.py`
- Test: `sidecar/tests/unit/test_run_files.py`

**Interfaces:**
- Consumes: `tagger.reports.TIMESTAMP_FORMAT` (`"%Y%m%dT%H%M%SZ"`).
- Produces :
  - `run_files.PENDING_SUFFIX: Final = ".tmp"` et `run_files.RETENTION: Final = timedelta(days=30)` ;
  - `run_files.stamped_name(created_at: datetime, run_id: str, suffix: str) -> str` ;
  - `run_files.created_at_of(path: Path) -> datetime | None` ;
  - `run_files.run_id_of(path: Path) -> str` ;
  - `run_files.newest_first(folder: Path, suffix: str) -> list[Path]` ;
  - `run_files.write_atomically(path: Path, text: str) -> None`, qui lève `OSError` ;
  - `run_files.read_versioned(path: Path, model: type[Model], version: int, unreadable: Unreadable) -> Model` ;
  - `run_files.unlink_logged(path: Path, label: str) -> None` ;
  - `run_files.Unreadable`, le `Protocol` d'une erreur `(path, found=None)`.

- [ ] **Step 1: Écrire les tests**

`sidecar/tests/unit/test_run_files.py` :

```python
"""Tests des fichiers horodates d'un run, partages par les dumps et les plans."""

from datetime import timedelta
from pathlib import Path

import pytest
from tagging_api import CREATED

from tagger.run_files import (
    created_at_of,
    newest_first,
    run_id_of,
    stamped_name,
    write_atomically,
)


def test_reads_back_the_time_of_a_stamped_name(tmp_path: Path) -> None:
    path = tmp_path / stamped_name(CREATED, "a3f9c1", ".json")

    created = created_at_of(path)

    assert created == CREATED


@pytest.mark.parametrize("suffix", [".json", ".tmp", ".renames.ndjson"])
def test_reads_back_the_run_of_a_stamped_name_whatever_its_suffix(
    tmp_path: Path, suffix: str
) -> None:
    path = tmp_path / stamped_name(CREATED, "a3f9c1", suffix)

    run_id = run_id_of(path)

    assert run_id == "a3f9c1"


def test_reads_no_time_on_a_name_that_is_not_stamped(tmp_path: Path) -> None:
    created = created_at_of(tmp_path / "notes.json")

    assert created is None


def test_lists_the_newest_files_first_and_skips_the_other_names(tmp_path: Path) -> None:
    oldest = tmp_path / stamped_name(CREATED - timedelta(days=2), "1b2c3d", ".json")
    newest = tmp_path / stamped_name(CREATED, "4d5e6f", ".json")
    for path in (
        oldest,
        newest,
        tmp_path / "notes.json",
        tmp_path / stamped_name(CREATED, "x", ".tmp"),
    ):
        path.write_text("{}", encoding="utf-8")

    listed = newest_first(tmp_path, ".json")

    assert listed == [newest, oldest]


def test_lists_nothing_in_a_missing_folder(tmp_path: Path) -> None:
    listed = newest_first(tmp_path / "absent", ".json")

    assert listed == []


def test_leaves_no_partial_file_when_the_replacement_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target = tmp_path / stamped_name(CREATED, "a3f9c1", ".json")

    def full_disk(_self: Path, _target: Path) -> Path:
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(Path, "replace", full_disk)

    with pytest.raises(OSError, match="No space left"):
        write_atomically(target, "{}")

    assert not any(tmp_path.iterdir())
```

- [ ] **Step 2: Lancer les tests, ils échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_run_files.py --no-cov -q`
Expected: FAIL, `ModuleNotFoundError: No module named 'tagger.run_files'`

- [ ] **Step 3: Créer `run_files.py`**

`sidecar/src/tagger/run_files.py` :

```python
"""Fichiers horodates d'un run sous `appLocalDataDir()`, partages par les dumps et les plans.

Le nom s'ouvre sur l'horodatage de creation : age et ordre se lisent sans ouvrir le fichier.
"""

import contextlib
import json
import logging
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Final, Protocol

from pydantic import BaseModel, ValidationError

from tagger.reports import TIMESTAMP_FORMAT

if TYPE_CHECKING:
    from pathlib import Path

logger = logging.getLogger(__name__)

PENDING_SUFFIX: Final = ".tmp"
# Une seule duree pour les dumps et les plans : un run reste annulable aussi longtemps que repris.
RETENTION: Final = timedelta(days=30)


class Unreadable(Protocol):
    """Erreur d'un fichier de run illisible : `found` porte la version de schema trouvee."""

    def __call__(self, path: Path, found: object = None, /) -> Exception: ...


def stamped_name(created_at: datetime, run_id: str, suffix: str) -> str:
    """`<horodatage UTC>-<run_id><suffix>`, quel que soit le decalage de `created_at`."""
    stamp = created_at.astimezone(UTC).strftime(TIMESTAMP_FORMAT)
    return f"{stamp}-{run_id}{suffix}"


def created_at_of(path: Path) -> datetime | None:
    """Horodatage lu sur le nom, `None` pour un nom qui n'en porte pas."""
    stamp, _, _ = path.stem.partition("-")
    try:
        return datetime.strptime(stamp, TIMESTAMP_FORMAT).replace(tzinfo=UTC)
    except ValueError:
        return None


def run_id_of(path: Path) -> str:
    """Identifiant du run, quel que soit le suffixe du fichier (`.json`, `.tmp`, journal)."""
    _, _, run_id = path.name.partition("-")
    return run_id.partition(".")[0]


def newest_first(folder: Path, suffix: str) -> list[Path]:
    """Fichiers en `suffix` du plus recent au plus ancien ; tout nom non horodate est ecarte."""
    if not folder.is_dir():
        return []
    stamped = (path for path in folder.glob(f"*{suffix}") if created_at_of(path) is not None)
    return sorted(stamped, reverse=True)


def write_atomically(path: Path, text: str) -> None:
    """Temporaire voisin puis remplacement : une coupure ne laisse jamais un fichier tronque.

    Leve `OSError`, que l'appelant traduit dans son domaine.
    """
    pending = path.with_suffix(PENDING_SUFFIX)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        pending.write_text(text, encoding="utf-8")
        pending.replace(path)
    except OSError:
        with contextlib.suppress(OSError):
            pending.unlink(missing_ok=True)
        raise


def read_versioned[Model: BaseModel](
    path: Path, model: type[Model], version: int, unreadable: Unreadable
) -> Model:
    """Relit un fichier de run ; une version inconnue est refusee, jamais migree (ADR-018)."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise unreadable(path) from exc

    found = raw.get("schema_version") if isinstance(raw, dict) else None
    if found != version:
        raise unreadable(path, found)
    try:
        return model.model_validate(raw)
    except ValidationError as exc:
        raise unreadable(path, found) from exc


def unlink_logged(path: Path, label: str) -> None:
    """Un fichier verrouille (editeur, antivirus) ne doit pas bloquer les suivants : on logue."""
    try:
        path.unlink(missing_ok=True)
    except OSError:
        logger.warning("%s run=%s reason=unlink_failed", label, run_id_of(path))
```

- [ ] **Step 4: Faire déléguer `tag_dump.py`**

`tag_dump.py` garde `import contextlib` (le journal des renommages s'en sert encore) et ses propres erreurs. `dumps_newest_first` reste en place, `rollback.py` et les tests l'appellent. Dans `sidecar/src/tagger/tag_dump.py` :

```diff
@@ qu'une fois par phase.
 
 import contextlib
-import json
 import logging
 import os
-from datetime import UTC, datetime, timedelta
 from pathlib import Path
 from types import MappingProxyType
```

```diff
@@ from tagger.errors import TaggerError
 from tagger.files import OriginalTags, TagField, TagSystem
 from tagger.paths import app_data_dir
-from tagger.reports import TIMESTAMP_FORMAT
+from tagger.run_files import (
+    PENDING_SUFFIX,
+    RETENTION,
+    created_at_of,
+    newest_first,
+    read_versioned,
+    run_id_of,
+    stamped_name,
+    unlink_logged,
+    write_atomically,
+)
 
 if TYPE_CHECKING:
     from collections.abc import Collection, Mapping
+    from datetime import datetime
 
 logger = logging.getLogger(__name__)
 
 SCHEMA_VERSION: Final = 1
-RETENTION: Final = timedelta(days=30)
 _SUFFIX: Final = ".json"
-_PENDING_SUFFIX: Final = ".tmp"
 _JOURNAL_SUFFIX: Final = ".renames.ndjson"
 # Les trois sortes de fichiers qu'un run laisse, et que la retention emporte ensemble.
-_RETAINED_SUFFIXES: Final = (_SUFFIX, _PENDING_SUFFIX, ".ndjson")
+_RETAINED_SUFFIXES: Final = (_SUFFIX, PENDING_SUFFIX, ".ndjson")
```

```diff
@@ def dump_dir() -> Path:
 def dump_path(folder: Path, dump: TagDump) -> Path:
     """Nom horodate : le dernier run et l'age d'un dump se lisent sans l'ouvrir."""
-    stamp = dump.created_at.astimezone(UTC).strftime(TIMESTAMP_FORMAT)
-    return folder / f"{stamp}-{dump.run_id}{_SUFFIX}"
+    return folder / stamped_name(dump.created_at, dump.run_id, _SUFFIX)
```

```diff
@@ def journal_path(dump_file: Path) -> Path:
 def find_dump(folder: Path, run_id: str) -> Path | None:
     """Dump d'un run, `None` s'il n'existe pas ; compare, jamais glob : un `*` designerait tout."""
-    return next((path for path in dumps_newest_first(folder) if _run_id_of(path) == run_id), None)
+    return next((path for path in dumps_newest_first(folder) if run_id_of(path) == run_id), None)
 
 
 def dumps_newest_first(folder: Path) -> list[Path]:
-    """Dumps du plus recent au plus ancien ; l'horodatage ouvre le nom, tout autre est ecarte."""
-    if not folder.is_dir():
-        return []
-    named_like_a_dump = (
-        path for path in folder.glob(f"*{_SUFFIX}") if _created_at(path) is not None
-    )
-    return sorted(named_like_a_dump, reverse=True)
+    """Dumps du plus recent au plus ancien."""
+    return newest_first(folder, _SUFFIX)
```

```diff
@@ def load_dump(path: Path) -> TagDump:
 
 def _read_dump(path: Path) -> TagDump:
-    try:
-        raw = json.loads(path.read_text(encoding="utf-8"))
-    except (OSError, ValueError) as exc:
-        raise TagDumpUnreadableError(path) from exc
-
-    found = raw.get("schema_version") if isinstance(raw, dict) else None
-    if found != SCHEMA_VERSION:
-        raise TagDumpUnreadableError(path, found)
-    try:
-        return TagDump.model_validate(raw)
-    except ValidationError as exc:
-        raise TagDumpUnreadableError(path, found) from exc
+    return read_versioned(path, TagDump, SCHEMA_VERSION, TagDumpUnreadableError)
```

```diff
@@ def purge_dumps(folder: Path, now: datetime) -> None:
         if path.suffix not in _RETAINED_SUFFIXES:
             continue
-        created = _created_at(path)
+        created = created_at_of(path)
         if created is None or now - created <= RETENTION:
             continue
-        # Un dump verrouille (editeur, antivirus) ne doit pas bloquer la purge des suivants.
-        try:
-            path.unlink(missing_ok=True)
-        except OSError:
-            logger.warning("tag dump not purged run=%s reason=unlink_failed", _run_id_of(path))
-
-
-def _created_at(path: Path) -> datetime | None:
-    stamp, _, _ = path.stem.partition("-")
-    try:
-        return datetime.strptime(stamp, TIMESTAMP_FORMAT).replace(tzinfo=UTC)
-    except ValueError:
-        return None
-
-
-def _run_id_of(path: Path) -> str:
-    """Identifiant du run, que le fichier soit un dump, son temporaire ou son journal."""
-    _, _, run_id = path.name.partition("-")
-    return run_id.partition(".")[0]
+        unlink_logged(path, "tag dump not purged")
```

```diff
@@ def _write(path: Path, dump: TagDump) -> None:
     Ecrit le dump complet, journal compris : celui-ci n'a plus rien a dire et part ensuite.
     """
-    pending = path.with_suffix(_PENDING_SUFFIX)
     try:
-        path.parent.mkdir(parents=True, exist_ok=True)
-        pending.write_text(dump.model_dump_json(indent=2), encoding="utf-8")
-        pending.replace(path)
+        write_atomically(path, dump.model_dump_json(indent=2))
     except OSError as exc:
-        with contextlib.suppress(OSError):
-            pending.unlink(missing_ok=True)
         raise TagDumpWriteError(path) from exc
     _drop_journal(path, dump)
```

- [ ] **Step 5: Lancer les tests, ils passent, dump compris et sans modification**

Run: `cd sidecar && uv run pytest tests/unit/test_run_files.py tests/unit/test_tag_dump.py tests/unit/test_rollback.py tests/unit/test_writing.py --no-cov -q`
Expected: PASS

- [ ] **Step 6: Gate et commit**

Run: `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar`
Expected: tout vert

```bash
git add sidecar/src/tagger/run_files.py sidecar/src/tagger/tag_dump.py sidecar/tests/unit/test_run_files.py
git commit -m "refactor(sidecar): fichiers horodates d'un run partages par dumps et plans"
```

---

### Task 2: Modèle du plan et relecture

**Files:**
- Modify: `sidecar/src/tagger/plan.py` (remplace le stub)
- Modify: `sidecar/src/tagger/tagging.py` (`is_decided`, `TrackRecord.decided`)
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`
- Create: `sidecar/tests/helpers/run_plans.py`
- Test: `sidecar/tests/unit/test_plan.py`, `sidecar/tests/unit/test_tagging_rules.py`

**Interfaces:**
- Consumes :
  - `run_files.stamped_name`, `read_versioned` (Task 1) ;
  - `tagging.TrackRecord`, `LiveRun`, `TrackState`, `Resolution`, `FailureReason`, `PendingArbitration`, `SourceList` ;
  - `matching.TrackQuery`, `QueryOrigin`, `ScoredCandidate`, `MatchingThresholds`, `check_thresholds` ;
  - `scraper_client.Source`, `TrackCandidate`.
- Produces :
  - `tagging.is_decided(state: TrackState | None, failure_reason: TrackFailureReason | None, *, on_hold: bool) -> bool` et la propriété `TrackRecord.decided: bool` ;
  - `plan.SCHEMA_VERSION = 1` ;
  - les modèles gelés `PlanQuery`, `PlanScores`, `PlanScored`, `PlanSourceList`, `PlanArbitration`, `PlanThresholds` (qui refuse des seuils incohérents), `PlanTrack` (`processed: bool`, `PlanTrack.of(record) -> PlanTrack`) ;
  - `RunPlan` :
    - champs : `schema_version`, `run_id`, `folder`, `started_at`, `thresholds`, `committed`, `tracks: dict[str, PlanTrack]` ;
    - `RunPlan.opened(live: LiveRun, thresholds: MatchingThresholds, started_at: datetime) -> RunPlan` ;
    - `with_track(record: TrackRecord) -> RunPlan` ;
    - `processed_count() -> int` ;
  - `plan_dir() -> Path`, `plan_path(folder: Path, plan: RunPlan) -> Path`, `load_plan(path: Path) -> RunPlan` ;
  - `RunPlanUnreadableError(path: Path, found: object = None)` ;
  - helpers de test `run_plans.RUN_ID`, `music(folder, count)`, `plan_of(folder, records, *, run_id, started_at, committed)`, `save_plan(plans, plan)`, `plan_files()` et `only_plan()`, que le sub-project 02 réutilise sans les redéfinir.

- [ ] **Step 1: Écrire le helper des plans de test**

`sidecar/tests/helpers/run_plans.py` :

```python
"""Plans de run : fabriques en memoire, puis lecture sur le disque du dossier de donnees
isole par la fixture `app_data`.
"""

from typing import TYPE_CHECKING, Final

from tagging_api import CREATED, tagged_mp3

from tagger.files import IdentityTags
from tagger.matching import DEFAULT_THRESHOLDS
from tagger.plan import RunPlan, load_plan, plan_dir, plan_path
from tagger.tagging import LiveRun, TrackRecord

if TYPE_CHECKING:
    from collections.abc import Sequence
    from datetime import datetime
    from pathlib import Path

RUN_ID: Final = "a3f9c1"


def _letters(number: int) -> str:
    """Deux lettres par morceau : un chiffre dans le titre changerait la requete nettoyee."""
    return chr(97 + number // 26) + chr(97 + number % 26)


def music(folder: Path, count: int) -> list[TrackRecord]:
    """Morceaux de Adam Beyer, « Mind aa »..., sur `count` MP3 tagues `t000.mp3`..."""
    records: list[TrackRecord] = []
    for number in range(count):
        name, title = f"t{number:03d}.mp3", f"Mind {_letters(number)}"
        path = tagged_mp3(folder, name, "Adam Beyer", title)
        identity = IdentityTags(artist="Adam Beyer", title=title)
        records.append(TrackRecord(track_id=name, path=path, identity=identity))
    return records


def plan_of(
    folder: Path,
    records: Sequence[TrackRecord],
    *,
    run_id: str = RUN_ID,
    started_at: datetime = CREATED,
    committed: bool = False,
) -> RunPlan:
    plan = RunPlan.opened(LiveRun(run_id, folder, records), DEFAULT_THRESHOLDS, started_at)
    return plan.model_copy(update={"committed": committed})


def save_plan(plans: Path, plan: RunPlan) -> Path:
    """Ecrit le plan sous son nom horodate, dossier cree au besoin."""
    path = plan_path(plans, plan)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(plan.model_dump_json(), encoding="utf-8")
    return path


def plan_files() -> list[Path]:
    """Plans du dossier de donnees, temporaires exclus."""
    folder = plan_dir()
    return sorted(folder.glob("*.json")) if folder.is_dir() else []


def only_plan() -> RunPlan:
    """Le plan unique du dossier de donnees ; echoue s'il y en a zero ou plusieurs."""
    files = plan_files()
    assert len(files) == 1, files
    return load_plan(files[0])
```

- [ ] **Step 2: Écrire les tests du modèle et de la relecture**

`sidecar/tests/unit/test_tagging_rules.py` :

```python
"""Regles du morceau et du run vivant qui ne demandent aucun reseau."""

from dataclasses import replace

import pytest
from tagging_records import RECORD, scored_candidate

from tagger.scraper_client import Source
from tagger.tagging import FailureReason, PendingArbitration, TrackRecord

HELD = replace(
    RECORD,
    arbitration=PendingArbitration(
        Source.BEATPORT, (scored_candidate(),), beatport_unavailable=False
    ),
)


@pytest.mark.parametrize(
    ("record", "decided"),
    [
        (RECORD, False),
        (HELD, True),
        (RECORD.unresolved(FailureReason.NO_RESULT), True),
        (RECORD.unresolved(FailureReason.USER_REFUSED), True),
        (RECORD.unresolved(FailureReason.SOURCE_UNAVAILABLE), False),
    ],
    ids=["waiting", "on-hold", "no-result", "refused", "source-unavailable"],
)
def test_tells_a_decided_track_from_one_to_send_back_to_the_network(
    record: TrackRecord, decided: bool
) -> None:
    result = record.decided

    assert result is decided
```

`sidecar/tests/unit/test_plan.py` :

```python
"""Tests du plan de run : modele, relecture, enregistrement, purge."""

import json
from dataclasses import replace
from pathlib import Path
from typing import Final

import pytest
from run_plans import plan_of
from scraper_responses import track_candidate
from tagging_records import RECORD, scored_candidate

from tagger.matching import QueryOrigin, TrackQuery
from tagger.plan import (
    PlanScores,
    PlanTrack,
    RunPlanUnreadableError,
    load_plan,
    plan_path,
)
from tagger.scraper_client import Source
from tagger.tagging import (
    FailureReason,
    PendingArbitration,
    Resolution,
    SourceList,
    TrackState,
)

QUERY: Final = TrackQuery("Adam Beyer", "Your Mind", QueryOrigin.TAGS)
WAITING: Final = replace(RECORD, track_id="e.mp3", path=Path("music/e.mp3"))
AUTO: Final = replace(RECORD, query=QUERY).resolved(
    Resolution.AUTO,
    Source.BEATPORT,
    track_candidate(),
    scored_candidate(artist=96.0, title=92.0),
    Path("cache/artworks/cover.jpg"),
)
HELD: Final = replace(
    RECORD,
    track_id="b.mp3",
    path=Path("music/b.mp3"),
    query=QUERY,
    arbitration=PendingArbitration(
        Source.BANDCAMP,
        (scored_candidate(),),
        beatport_unavailable=False,
        other=SourceList(Source.BEATPORT, (scored_candidate(artist=80.0, title=75.0),)),
    ),
)
BY_URL: Final = replace(RECORD, track_id="c.mp3", path=Path("music/c.mp3")).resolved(
    Resolution.URL, Source.BANDCAMP, track_candidate(track_id="42"), None, None
)
UNRESOLVED: Final = replace(
    RECORD, track_id="d.mp3", path=Path("music/d.mp3"), query=QUERY
).unresolved(FailureReason.NO_RESULT)
UNAVAILABLE: Final = replace(
    RECORD, track_id="f.mp3", path=Path("music/f.mp3"), query=QUERY
).unresolved(FailureReason.SOURCE_UNAVAILABLE)
MUSIC: Final = Path("music")


def test_records_an_automatic_validation_with_its_candidate_and_scores() -> None:
    track = PlanTrack.of(AUTO)

    assert (track.state, track.resolution, track.source) == (
        TrackState.RESOLVED,
        Resolution.AUTO,
        Source.BEATPORT,
    )
    assert track.candidate == track_candidate()
    assert track.scores == PlanScores(
        artist=96.0, title=92.0, average=94.0, version_mismatch=False, number_mismatch=False
    )


def test_records_an_arbitration_with_the_list_set_aside() -> None:
    track = PlanTrack.of(HELD)

    assert track.arbitration is not None
    assert track.arbitration.source is Source.BANDCAMP
    assert track.arbitration.other is not None
    assert track.arbitration.other.source is Source.BEATPORT


def test_records_a_recovery_by_url_without_scores() -> None:
    track = PlanTrack.of(BY_URL)

    assert (track.resolution, track.scores) == (Resolution.URL, None)


def test_records_the_reason_of_an_unresolved_track() -> None:
    track = PlanTrack.of(UNRESOLVED)

    assert (track.state, track.failure_reason) == (TrackState.UNRESOLVED, FailureReason.NO_RESULT)


def test_records_a_waiting_track_without_any_decision() -> None:
    track = PlanTrack.of(WAITING)

    assert (track.state, track.arbitration) == (None, None)


def test_keeps_the_tracks_in_the_order_of_the_folder() -> None:
    plan = plan_of(MUSIC, [WAITING, AUTO, HELD])

    assert list(plan.tracks) == ["e.mp3", "a.mp3", "b.mp3"]


def test_counts_as_processed_the_decided_tracks_and_those_awaiting_arbitration() -> None:
    plan = plan_of(MUSIC, [AUTO, HELD, BY_URL, UNRESOLVED, WAITING, UNAVAILABLE])

    processed = plan.processed_count()

    assert processed == 4


def test_names_the_plan_after_its_start_and_run(tmp_path: Path) -> None:
    plan = plan_of(MUSIC, [WAITING])

    path = plan_path(tmp_path, plan)

    assert path == tmp_path / "20261006T211403Z-a3f9c1.json"


def test_reloads_the_plan_it_wrote(tmp_path: Path) -> None:
    plan = plan_of(MUSIC, [AUTO, HELD, BY_URL, UNRESOLVED, WAITING])
    path = plan_path(tmp_path, plan)
    path.write_text(plan.model_dump_json(indent=2), encoding="utf-8")

    reloaded = load_plan(path)

    assert reloaded == plan


def test_refuses_a_plan_of_an_unknown_version(tmp_path: Path) -> None:
    path = tmp_path / "20261006T211403Z-a3f9c1.json"
    path.write_text(json.dumps({"schema_version": 2}), encoding="utf-8")

    with pytest.raises(RunPlanUnreadableError) as refused:
        load_plan(path)

    assert (refused.value.code, refused.value.params) == (
        "run_plan_unreadable",
        {"file": path.name, "found": 2, "expected": 1},
    )


@pytest.mark.parametrize(
    "content",
    ["{not json", "[]", json.dumps({"schema_version": 1, "run_id": "a3f9c1"})],
    ids=["corrupt", "not-an-object", "invalid-model"],
)
def test_refuses_an_unreadable_plan(tmp_path: Path, content: str) -> None:
    path = tmp_path / "20261006T211403Z-a3f9c1.json"
    path.write_text(content, encoding="utf-8")

    with pytest.raises(RunPlanUnreadableError):
        load_plan(path)


def test_refuses_a_plan_with_inconsistent_thresholds(tmp_path: Path) -> None:
    plan = plan_of(MUSIC, [WAITING])
    path = plan_path(tmp_path, plan)
    inconsistent = plan.model_dump(mode="json") | {"thresholds": {"floor": 95, "ceiling": 80}}
    path.write_text(json.dumps(inconsistent), encoding="utf-8")

    with pytest.raises(RunPlanUnreadableError):
        load_plan(path)
```

- [ ] **Step 3: Lancer les tests, ils échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_plan.py tests/unit/test_tagging_rules.py --no-cov -q`
Expected: FAIL, `ImportError: cannot import name 'PlanTrack' from 'tagger.plan'`

- [ ] **Step 4: Ajouter la règle « traité » au morceau**

Dans `sidecar/src/tagger/tagging.py` :

```diff
@@ type TrackFailureReason = FailureReason | FileFailureReason
 
 
+def is_decided(
+    state: TrackState | None, failure_reason: TrackFailureReason | None, *, on_hold: bool
+) -> bool:
+    """Tranche, ou en attente d'une decision humaine.
+
+    Une source qui n'a pas repondu (`source_unavailable`) n'est pas une decision : le morceau
+    repart sur le reseau a la reprise, une fois la panne ou la cle corrigee.
+    """
+    if on_hold:
+        return True
+    unavailable = (
+        state is TrackState.UNRESOLVED and failure_reason is FailureReason.SOURCE_UNAVAILABLE
+    )
+    return state is not None and not unavailable
+
+
 @dataclass(frozen=True, slots=True)
 class SourceList:
```

```diff
@@ class TrackRecord:
         return self.path.name
 
+    @property
+    def decided(self) -> bool:
+        """Regle unique du « deja traite » : progression, reprise et pipeline selectif."""
+        return is_decided(self.state, self.failure_reason, on_hold=self.arbitration is not None)
+
     def resolved(
         self,
```

- [ ] **Step 5: Écrire le modèle et la relecture**

Remplacer tout `sidecar/src/tagger/plan.py` par :

```python
"""Plan de run : chaque decision d'un run, persistee au fil de l'eau avant tout fichier
ecrit (ADR-010), relue pour la reprise et purgee au demarrage.

Deux politiques de version voisines, a ne pas aligner (ADR-018) : le plan, jetable sous
30 jours, refuse une version inconnue ; le rapport, permanent, se migre.
"""

from pathlib import Path
from typing import TYPE_CHECKING, ClassVar, Final, Self

from pydantic import AwareDatetime, BaseModel, ConfigDict, model_validator

from tagger.errors import TaggerError
from tagger.matching import QueryOrigin, check_thresholds
from tagger.paths import app_data_dir
from tagger.run_files import read_versioned, stamped_name
from tagger.scraper_client import Source, TrackCandidate
from tagger.tagging import FailureReason, Resolution, TrackState, is_decided

if TYPE_CHECKING:
    from datetime import datetime

    from tagger.matching import MatchingThresholds, ScoredCandidate, TrackQuery
    from tagger.tagging import (
        LiveRun,
        PendingArbitration,
        SourceList,
        TrackFailureReason,
        TrackRecord,
    )

SCHEMA_VERSION: Final = 1
_SUFFIX: Final = ".json"


class _PlanModel(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class PlanQuery(_PlanModel):
    artist: str
    title: str
    origin: QueryOrigin

    @classmethod
    def of(cls, query: TrackQuery) -> Self:
        return cls(artist=query.artist, title=query.title, origin=query.origin)


class PlanScores(_PlanModel):
    """Scores bruts, non arrondis : la reprise les rend tels que le scoring les a calcules."""

    artist: float | None
    title: float
    average: float
    version_mismatch: bool
    number_mismatch: bool

    @classmethod
    def of(cls, scored: ScoredCandidate) -> Self:
        return cls(
            artist=scored.artist_score,
            title=scored.title_score,
            average=scored.score,
            version_mismatch=scored.version_mismatch,
            number_mismatch=scored.number_mismatch,
        )


class PlanScored(_PlanModel):
    candidate: TrackCandidate
    scores: PlanScores

    @classmethod
    def of(cls, scored: ScoredCandidate) -> Self:
        return cls(candidate=scored.candidate, scores=PlanScores.of(scored))


class PlanSourceList(_PlanModel):
    source: Source
    candidates: tuple[PlanScored, ...]
    empty_reason: FailureReason | None = None

    @classmethod
    def of(cls, kept: SourceList) -> Self:
        return cls(
            source=kept.source,
            candidates=tuple(PlanScored.of(scored) for scored in kept.candidates),
            empty_reason=kept.empty_reason,
        )


class PlanArbitration(_PlanModel):
    """Listes deja obtenues : la reprise repropose l'arbitrage sans rappeler l'API."""

    source: Source
    candidates: tuple[PlanScored, ...]
    beatport_unavailable: bool
    empty_reason: FailureReason | None = None
    other: PlanSourceList | None = None

    @classmethod
    def of(cls, pending: PendingArbitration) -> Self:
        return cls(
            source=pending.source,
            candidates=tuple(PlanScored.of(scored) for scored in pending.candidates),
            beatport_unavailable=pending.beatport_unavailable,
            empty_reason=pending.empty_reason,
            other=None if pending.other is None else PlanSourceList.of(pending.other),
        )


class PlanThresholds(_PlanModel):
    """Seuils du run : la reprise classe les morceaux restants comme les premiers."""

    floor: float
    ceiling: float

    @model_validator(mode="after")
    def _within_bounds(self) -> Self:
        # Un plan aux seuils incoherents est illisible des la relecture, pas en pleine reprise.
        check_thresholds(self.floor, self.ceiling)
        return self


class PlanTrack(_PlanModel):
    """Ce que le run a decide d'un morceau. Ni pochette (cache jetable, ADR-013), ni tags lus
    sur un fichier qui n'a pas bouge, ni rien de l'ecriture, que le plan ne suit plus."""

    state: TrackState | None = None
    resolution: Resolution | None = None
    failure_reason: FailureReason | None = None
    source: Source | None = None
    query: PlanQuery | None = None
    candidate: TrackCandidate | None = None
    scores: PlanScores | None = None
    arbitration: PlanArbitration | None = None

    @property
    def processed(self) -> bool:
        """Meme regle que `TrackRecord.decided`."""
        return is_decided(self.state, self.failure_reason, on_hold=self.arbitration is not None)

    @classmethod
    def of(cls, record: TrackRecord) -> Self:
        query, scored, pending = record.query, record.scored, record.arbitration
        return cls(
            state=record.state,
            resolution=record.resolution,
            failure_reason=_network_reason(record.failure_reason),
            source=record.source,
            query=None if query is None else PlanQuery.of(query),
            candidate=record.candidate,
            scores=None if scored is None else PlanScores.of(scored),
            arbitration=None if pending is None else PlanArbitration.of(pending),
        )


class RunPlan(_PlanModel):
    """Plan tel qu'il est ecrit sur le disque, morceaux par `track_id` dans l'ordre du dossier."""

    schema_version: int = SCHEMA_VERSION
    run_id: str
    folder: Path
    started_at: AwareDatetime
    thresholds: PlanThresholds
    # Frontiere de la reprise : un run confirme a pu toucher des fichiers, il ne se reprend pas.
    committed: bool = False
    tracks: dict[str, PlanTrack]

    @classmethod
    def opened(cls, live: LiveRun, thresholds: MatchingThresholds, started_at: datetime) -> Self:
        return cls(
            run_id=live.run_id,
            folder=live.folder,
            started_at=started_at,
            thresholds=PlanThresholds(floor=thresholds.floor, ceiling=thresholds.ceiling),
            tracks={record.track_id: PlanTrack.of(record) for record in live.snapshot().tracks},
        )

    def with_track(self, record: TrackRecord) -> Self:
        """Le morceau garde sa place : une cle existante ne change pas de rang dans un dict."""
        return self.model_copy(
            update={"tracks": {**self.tracks, record.track_id: PlanTrack.of(record)}}
        )

    def processed_count(self) -> int:
        """Calcule et non stocke : un compteur ecrit a cote des morceaux finirait par deriver."""
        return sum(1 for track in self.tracks.values() if track.processed)


class RunPlanUnreadableError(TaggerError):
    """Plan illisible ou d'une version de schema inconnue, jamais migre (ADR-018)."""

    code: ClassVar[str] = "run_plan_unreadable"

    def __init__(self, path: Path, found: object = None) -> None:
        super().__init__(
            f"unreadable run plan: {path.name}",
            file=path.name,
            found=found,
            expected=SCHEMA_VERSION,
        )


def plan_dir() -> Path:
    return app_data_dir() / "plans"


def plan_path(folder: Path, plan: RunPlan) -> Path:
    return folder / stamped_name(plan.started_at, plan.run_id, _SUFFIX)


def load_plan(path: Path) -> RunPlan:
    """Relit un plan ; une version inconnue est refusee, jamais migree."""
    return read_versioned(path, RunPlan, SCHEMA_VERSION, RunPlanUnreadableError)


def _network_reason(reason: TrackFailureReason | None) -> FailureReason | None:
    """Un motif de fichier n'apparait qu'apres la confirmation, que le plan ne suit plus."""
    return reason if isinstance(reason, FailureReason) else None
```

- [ ] **Step 6: Ajouter la traduction du code**

Dans `public/i18n/fr.json` et `public/i18n/en.json`, section `errors`, juste après `"tag_dump_unreadable"`. L'espace avant `:` du français est une espace insécable U+00A0, le même caractère que dans `tag_dump_write_failed` :

```diff
@@
     "tag_dump_write_failed": "Les tags d'origine n'ont pas pu être sauvegardés : aucun fichier n'a été modifié.\nLibérez de l'espace disque, puis relancez l'écriture.",
     "tag_dump_unreadable": "La sauvegarde des tags d'origine est illisible, ou vient d'une autre version de l'application.\nCes fichiers ne peuvent plus être restaurés : relancez un run pour les re-tagger.",
+    "run_plan_unreadable": "Le run interrompu ne peut pas être repris : il a été enregistré par une autre version de l'application, ou son enregistrement est illisible.\nRepartez de zéro pour relancer le run.",
     "scraper_error": "La recherche a échoué.\nRéessayez plus tard.",
     "api_key_rejected": "La clé API a été refusée.\nVérifiez-la dans les Réglages.",
```

```diff
@@
     "tag_dump_write_failed": "The original tags could not be saved: no file was changed.\nFree up disk space, then write again.",
     "tag_dump_unreadable": "The saved original tags are unreadable, or come from another version of the application.\nThese files can no longer be restored: start a new run to retag them.",
+    "run_plan_unreadable": "The interrupted run cannot be resumed: it was saved by another version of the application, or its record is unreadable.\nStart over to run it again.",
     "scraper_error": "The search failed.\nTry again later.",
     "api_key_rejected": "The API key was rejected.\nCheck it in the settings.",
```

- [ ] **Step 7: Lancer les tests, ils passent**

Run: `cd sidecar && uv run pytest tests/unit/test_plan.py tests/unit/test_tagging_rules.py tests/unit/test_error_translations.py --no-cov -q`
Expected: PASS

- [ ] **Step 8: Gate et commit**

Run: `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar && just lint-ui`
Expected: tout vert

```bash
git add sidecar/src/tagger/plan.py sidecar/src/tagger/tagging.py sidecar/tests/helpers/run_plans.py sidecar/tests/unit/test_plan.py sidecar/tests/unit/test_tagging_rules.py public/i18n/fr.json public/i18n/en.json
git commit -m "feat(plan): modele versionne du plan de run et relecture stricte"
```

---

### Task 3: Enregistrement du plan au fil de l'eau

**Files:**
- Modify: `sidecar/src/tagger/tagging.py` (`LiveRun`)
- Modify: `sidecar/src/tagger/plan.py` (ajout de `PlanRecorder` et `discard_plan`)
- Test: `sidecar/tests/unit/test_plan.py`, `sidecar/tests/unit/test_tagging_rules.py`

**Interfaces:**
- Consumes: `RunPlan`, `plan_path`, `load_plan` (Task 2) ; `run_files.write_atomically`, `unlink_logged` (Task 1) ; `run_plans.plan_of`, `save_plan`, `music` (Task 2).
- Produces :
  - `LiveRun.observe(observer: Callable[[TrackRecord], None]) -> None` ;
  - `plan.discard_plan(path: Path) -> None`, qui logue en WARNING `run plan not discarded run=<run_id> reason=unlink_failed` sans lever ;
  - `PlanRecorder(plan: RunPlan, folder: Path)`, qui expose :
    - la propriété `plan: RunPlan` ;
    - `record(record: TrackRecord) -> None` ;
    - `async flush() -> None` ;
    - `async commit() -> None` ;
    - `async reopen() -> None` ;
    - `async discard() -> None`.

- [ ] **Step 1: Écrire les tests du recorder**

Remplacer le bloc d'imports de `sidecar/tests/unit/test_plan.py`, puis ajouter les helpers et les tests à la fin du fichier :

```diff
@@
 """Tests du plan de run : modele, relecture, enregistrement, purge."""
 
+import asyncio
 import json
 from dataclasses import replace
```

```diff
@@ from typing import Final
 
 import pytest
-from run_plans import plan_of
+from ndjson_loop import held_call
+from run_plans import music, plan_of, save_plan
 from scraper_responses import track_candidate
+from stubs import raising
+from tagging_api import CREATED
 from tagging_records import RECORD, scored_candidate
 
-from tagger.matching import QueryOrigin, TrackQuery
+from tagger import plan as plan_module
+from tagger.file_failures import FileFailureReason
+from tagger.matching import DEFAULT_THRESHOLDS, QueryOrigin, TrackQuery
 from tagger.plan import (
+    PlanRecorder,
     PlanScores,
     PlanTrack,
+    RunPlan,
     RunPlanUnreadableError,
+    discard_plan,
     load_plan,
     plan_path,
 )
+from tagger.run_files import write_atomically
 from tagger.scraper_client import Source
 from tagger.tagging import (
     FailureReason,
+    LiveRun,
     PendingArbitration,
     Resolution,
     SourceList,
+    TrackRecord,
     TrackState,
 )
```

Ajouter à la fin du fichier :

```python
def _live(*records: TrackRecord) -> LiveRun:
    return LiveRun("a3f9c1", MUSIC, records)


def _recorder(folder: Path, live: LiveRun) -> PlanRecorder:
    recorder = PlanRecorder(RunPlan.opened(live, DEFAULT_THRESHOLDS, CREATED), folder)
    live.observe(recorder.record)
    return recorder


def _on_disk(folder: Path, recorder: PlanRecorder) -> RunPlan:
    return load_plan(plan_path(folder, recorder.plan))


def _files(folder: Path) -> list[Path]:
    return list(folder.iterdir())


@pytest.mark.asyncio
async def test_leaves_the_last_state_of_each_track_on_disk(tmp_path: Path) -> None:
    live = _live(replace(RECORD, query=QUERY), WAITING)
    recorder = _recorder(tmp_path, live)
    live.update(replace(HELD, track_id=RECORD.track_id, path=RECORD.path))
    live.update(AUTO)
    live.update(replace(WAITING, query=QUERY).unresolved(FailureReason.BELOW_THRESHOLD))

    await recorder.flush()

    on_disk = _on_disk(tmp_path, recorder)
    assert (on_disk.tracks["a.mp3"].resolution, on_disk.tracks["a.mp3"].arbitration) == (
        Resolution.AUTO,
        None,
    )
    assert on_disk.tracks["e.mp3"].failure_reason is FailureReason.BELOW_THRESHOLD
    assert on_disk.processed_count() == 2


@pytest.mark.asyncio
async def test_merges_a_burst_of_decisions_into_few_writes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    writes: list[Path] = []

    def counting(path: Path, text: str) -> None:
        writes.append(path)
        write_atomically(path, text)

    monkeypatch.setattr(plan_module, "write_atomically", counting)
    records = music(tmp_path / "music", 20)
    live = _live(*records)
    recorder = _recorder(tmp_path / "plans", live)
    for record in records:
        live.update(record.unresolved(FailureReason.NO_RESULT))

    await recorder.flush()

    assert len(writes) <= 2
    assert _on_disk(tmp_path / "plans", recorder).processed_count() == 20


@pytest.mark.asyncio
async def test_writes_a_change_that_arrives_while_a_write_is_in_flight(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    held = held_call(monkeypatch, plan_module, "write_atomically")
    live = _live(replace(RECORD, query=QUERY))
    recorder = _recorder(tmp_path, live)
    first = asyncio.create_task(recorder.flush(), name="first-flush")
    await held.wait_reached()
    live.update(AUTO)
    held.release.set()

    await first

    assert _on_disk(tmp_path, recorder).tracks["a.mp3"].resolution is Resolution.AUTO


@pytest.mark.asyncio
async def test_logs_a_plan_it_cannot_write_without_raising_or_leaking_the_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    full_disk = OSError(28, "No space left", "C:/private/profile/plans/x.json")
    monkeypatch.setattr(plan_module, "write_atomically", raising(full_disk))
    recorder = _recorder(tmp_path, _live(WAITING))

    await recorder.flush()

    assert _files(tmp_path) == []
    assert "run plan not written run=a3f9c1 reason=write_failed errno=28" in caplog.messages
    assert "private" not in caplog.text


@pytest.mark.asyncio
async def test_retries_a_failed_write_on_the_next_flush(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        plan_module, "write_atomically", raising(OSError(28, "No space left on device"))
    )
    recorder = _recorder(tmp_path, _live(WAITING))
    await recorder.flush()
    monkeypatch.setattr(plan_module, "write_atomically", write_atomically)

    await recorder.flush()

    assert _on_disk(tmp_path, recorder).run_id == "a3f9c1"


@pytest.mark.asyncio
async def test_confirms_the_plan_on_disk(tmp_path: Path) -> None:
    recorder = _recorder(tmp_path, _live(AUTO))

    await recorder.commit()

    assert _on_disk(tmp_path, recorder).committed


@pytest.mark.asyncio
async def test_confirms_without_raising_when_the_plan_cannot_be_written(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        plan_module, "write_atomically", raising(OSError(28, "No space left on device"))
    )
    recorder = _recorder(tmp_path, _live(AUTO))

    await recorder.commit()

    assert recorder.plan.committed


@pytest.mark.asyncio
async def test_stops_recording_once_committed(tmp_path: Path) -> None:
    live = _live(AUTO)
    recorder = _recorder(tmp_path, live)
    await recorder.commit()
    live.update(AUTO.write_failed(FileFailureReason.FILE_LOCKED, restorable=False))

    await recorder.flush()

    assert _on_disk(tmp_path, recorder).tracks["a.mp3"].state is TrackState.RESOLVED


@pytest.mark.asyncio
async def test_reopens_a_committed_plan(tmp_path: Path) -> None:
    recorder = _recorder(tmp_path, _live(AUTO))
    await recorder.commit()

    await recorder.reopen()

    assert not _on_disk(tmp_path, recorder).committed


@pytest.mark.asyncio
async def test_discarding_deletes_the_plan(tmp_path: Path) -> None:
    recorder = _recorder(tmp_path, _live(WAITING))
    await recorder.flush()

    await recorder.discard()

    assert _files(tmp_path) == []


@pytest.mark.asyncio
async def test_records_nothing_once_discarded(tmp_path: Path) -> None:
    live = _live(replace(RECORD, query=QUERY))
    recorder = _recorder(tmp_path, live)
    await recorder.discard()
    live.update(AUTO)

    await recorder.flush()

    assert _files(tmp_path) == []


@pytest.mark.asyncio
async def test_discarding_keeps_a_committed_plan(tmp_path: Path) -> None:
    recorder = _recorder(tmp_path, _live(AUTO))
    await recorder.commit()

    await recorder.discard()

    assert _on_disk(tmp_path, recorder).committed


def test_discards_a_plan_file(tmp_path: Path) -> None:
    path = save_plan(tmp_path, plan_of(MUSIC, [WAITING]))

    discard_plan(path)

    assert not path.exists()


def test_logs_a_plan_file_it_cannot_discard(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    path = save_plan(tmp_path, plan_of(MUSIC, [WAITING]))
    monkeypatch.setattr(Path, "unlink", raising(PermissionError(13, "Permission denied")))

    discard_plan(path)

    assert path.exists()
    assert "run plan not discarded run=a3f9c1 reason=unlink_failed" in caplog.messages
```

Ajouter le test de l'observateur à `sidecar/tests/unit/test_tagging_rules.py`, avec les imports qu'il demande :

```diff
@@
 
 from dataclasses import replace
+from pathlib import Path
 
 import pytest
```

```diff
@@ from tagging_records import RECORD, scored_candidate
 
 from tagger.scraper_client import Source
-from tagger.tagging import FailureReason, PendingArbitration, TrackRecord
+from tagger.tagging import FailureReason, LiveRun, PendingArbitration, TrackRecord
 
 HELD = replace(
```

Ajouter à la fin du fichier :

```python
def test_tells_the_observer_of_each_update() -> None:
    live = LiveRun("a3f9c1", Path("music"), [RECORD])
    seen: list[TrackRecord] = []
    live.observe(seen.append)
    updated = RECORD.unresolved(FailureReason.NO_RESULT)

    live.update(updated)

    assert seen == [updated]
```

- [ ] **Step 2: Lancer les tests, ils échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_plan.py tests/unit/test_tagging_rules.py --no-cov -q`
Expected: FAIL, `ImportError: cannot import name 'PlanRecorder' from 'tagger.plan'`

- [ ] **Step 3: Ajouter l'observateur à `LiveRun`**

Dans `sidecar/src/tagger/tagging.py`, classe `LiveRun` :

```diff
@@ class LiveRun:
             record.track_id: position for position, record in enumerate(records, start=1)
         }
+        self._observer: Callable[[TrackRecord], None] | None = None
 
     @override
```

```diff
@@ class LiveRun:
         return self._positions[track_id]
 
+    def observe(self, observer: Callable[[TrackRecord], None]) -> None:
+        """Appele a chaque `update` : le plan de run s'y branche sans que rien ne le sache."""
+        self._observer = observer
+
     def update(self, record: TrackRecord) -> None:
         self._records[record.track_id] = record
+        if self._observer is not None:
+            self._observer(record)
 
     def snapshot(self) -> TaggingRun:
```

- [ ] **Step 4: Écrire `PlanRecorder` et `discard_plan`**

Dans `sidecar/src/tagger/plan.py` :

```diff
@@ Deux politiques de version voisines, a ne pas aligner (ADR-018) : le plan, jetab
 """
 
+import asyncio
+import logging
 from pathlib import Path
-from typing import TYPE_CHECKING, ClassVar, Final, Self
+from typing import TYPE_CHECKING, ClassVar, Final, Self, override
 
 from pydantic import AwareDatetime, BaseModel, ConfigDict, model_validator
```

```diff
@@ from tagger.errors import TaggerError
 from tagger.matching import QueryOrigin, check_thresholds
 from tagger.paths import app_data_dir
-from tagger.run_files import read_versioned, stamped_name
+from tagger.run_files import read_versioned, stamped_name, unlink_logged, write_atomically
 from tagger.scraper_client import Source, TrackCandidate
 from tagger.tagging import FailureReason, Resolution, TrackState, is_decided
```

```diff
@@ if TYPE_CHECKING:
     )
 
+logger = logging.getLogger(__name__)
+
 SCHEMA_VERSION: Final = 1
 _SUFFIX: Final = ".json"
```

```diff
@@ def load_plan(path: Path) -> RunPlan:
 
 
+def discard_plan(path: Path) -> None:
+    """Un plan impossible a supprimer sera repropose au lancement suivant : rien n'est perdu."""
+    unlink_logged(path, "run plan not discarded")
+
+
+class PlanRecorder:
+    """Tient le plan d'un run et le vide sur le disque hors de la boucle.
+
+    Une seule tache de vidage a la fois : elle ecrit le dernier etat, puis repart tant qu'un
+    changement est arrive pendant l'ecriture. Une rafale de decisions ne coute que quelques
+    ecritures, jamais deux en parallele. Le plan est un filet : un echec d'ecriture se logue
+    et se retente, il n'arrete jamais le run.
+    """
+
+    def __init__(self, plan: RunPlan, folder: Path) -> None:
+        self._plan = plan
+        self._path = plan_path(folder, plan)
+        self._dirty = True
+        self._discarded = False
+        self._flushing: asyncio.Task[None] | None = None
+
+    @override
+    def __repr__(self) -> str:
+        return f"PlanRecorder(run_id={self._plan.run_id!r}, committed={self._plan.committed})"
+
+    @property
+    def plan(self) -> RunPlan:
+        return self._plan
+
+    def record(self, record: TrackRecord) -> None:
+        """Observateur de `LiveRun.update` ; ecriture, relance et rollback ne changent rien."""
+        if self._plan.committed or self._discarded:
+            return
+        self._plan = self._plan.with_track(record)
+        self._wake()
+
+    async def flush(self) -> None:
+        """Attend que le disque porte l'etat courant ; un echec est logue, jamais leve.
+
+        `shield` : l'ecriture va a son terme meme si l'appelant est annule (`shutdown`).
+        """
+        if self._dirty:
+            self._wake()
+        if self._flushing is not None:
+            await asyncio.shield(self._flushing)
+
+    async def commit(self) -> None:
+        """Confirme le plan sur le disque avant que le premier fichier musical ne soit ecrit."""
+        self._plan = self._plan.model_copy(update={"committed": True})
+        self._wake()
+        await self.flush()
+
+    async def reopen(self) -> None:
+        """Le dump a echoue sans toucher aucun fichier : le run redevient confirmable."""
+        self._plan = self._plan.model_copy(update={"committed": False})
+        self._wake()
+        await self.flush()
+
+    async def discard(self) -> None:
+        """Run remplace avant sa confirmation : son plan part, plus rien ne l'ecrit.
+
+        Un plan confirme reste a la purge du demarrage, comme tout run termine.
+        """
+        if self._plan.committed:
+            return
+        self._discarded = True
+        if self._flushing is not None:
+            await asyncio.shield(self._flushing)
+        await asyncio.to_thread(discard_plan, self._path)
+
+    def _wake(self) -> None:
+        self._dirty = True
+        if self._discarded:
+            return
+        if self._flushing is None or self._flushing.done():
+            self._flushing = asyncio.create_task(self._drain(), name=f"plan:{self._plan.run_id}")
+
+    async def _drain(self) -> None:
+        while self._dirty and not self._discarded:
+            self._dirty = False
+            plan = self._plan
+            try:
+                await asyncio.to_thread(
+                    write_atomically, self._path, plan.model_dump_json(indent=2)
+                )
+            except OSError as exc:
+                # Reste a ecrire : le prochain `flush` ou la prochaine decision retente.
+                self._dirty = True
+                logger.error(  # noqa: TRY400  (une trace porterait le chemin complet)
+                    "run plan not written run=%s reason=write_failed errno=%s",
+                    plan.run_id,
+                    exc.errno,
+                )
+                return
+
+
 def _network_reason(reason: TrackFailureReason | None) -> FailureReason | None:
     """Un motif de fichier n'apparait qu'apres la confirmation, que le plan ne suit plus."""
```

`record` n'est appelé que depuis la boucle (`LiveRun.update` tourne dans des coroutines), aucun thread ne l'appelle : `_wake` crée donc sa tâche sans précaution. Le `noqa: TRY400` est voulu : `logger.exception` joindrait la trace et celle d'un `OSError` porte le chemin complet.

- [ ] **Step 5: Lancer les tests, ils passent**

Run: `cd sidecar && uv run pytest tests/unit/test_plan.py tests/unit/test_tagging_rules.py tests/unit/test_tagging_run.py tests/unit/test_arbitration_gestures.py --no-cov -q`
Expected: PASS

- [ ] **Step 6: Gate et commit**

Run: `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar`
Expected: tout vert

```bash
git add sidecar/src/tagger/tagging.py sidecar/src/tagger/plan.py sidecar/tests/unit/test_plan.py sidecar/tests/unit/test_tagging_rules.py
git commit -m "feat(plan): enregistrement du plan au fil de l'eau, hors de la boucle"
```

---

### Task 4: Purge des plans au démarrage

**Files:**
- Modify: `sidecar/src/tagger/plan.py` (ajout de `purge_plans`)
- Modify: `sidecar/src/tagger/__main__.py` (`main`, `_purge_old_plans`)
- Test: `sidecar/tests/unit/test_plan.py`, `sidecar/tests/unit/test_main.py`

**Interfaces:**
- Consumes: `load_plan`, `RunPlanUnreadableError` (Task 2) ; `run_files.PENDING_SUFFIX`, `RETENTION`, `created_at_of`, `unlink_logged` (Task 1) ; `plan_dir` (Task 2) ; `run_plans.plan_of`, `save_plan` (Task 2).
- Produces: `plan.purge_plans(folder: Path, now: datetime) -> None` ; `__main__._purge_old_plans() -> None`.

- [ ] **Step 1: Écrire les tests de la purge**

Ajouter les imports `timedelta` et `purge_plans` à `sidecar/tests/unit/test_plan.py`, puis les tests à la fin du fichier :

```diff
@@ import asyncio
 import json
 from dataclasses import replace
+from datetime import timedelta
 from pathlib import Path
 from typing import Final
```

```diff
@@ from tagger.plan import (
     load_plan,
     plan_path,
+    purge_plans,
 )
 from tagger.run_files import write_atomically
```

Ajouter à la fin du fichier :

```python
def _plan_file(folder: Path, age: timedelta, run_id: str, *, committed: bool = False) -> Path:
    plan = plan_of(MUSIC, [WAITING], run_id=run_id, started_at=CREATED - age, committed=committed)
    return save_plan(folder, plan)


def test_purges_the_plans_that_will_never_be_resumed(tmp_path: Path) -> None:
    committed = _plan_file(tmp_path, timedelta(days=1), "1b2c3d", committed=True)
    open_recent = _plan_file(tmp_path, timedelta(days=3), "4d5e6f")
    open_expired = _plan_file(tmp_path, timedelta(days=31), "7a8b9c")
    unknown_version = tmp_path / "20261003T000000Z-9e8f7a.json"
    unknown_version.write_text(json.dumps({"schema_version": 2}), encoding="utf-8")
    orphan = tmp_path / "20261006T000000Z-2c3d4e.tmp"
    orphan.write_text("{", encoding="utf-8")
    foreign = [tmp_path / "notes.json", tmp_path / "notes.tmp"]
    for path in foreign:
        path.write_text("{}", encoding="utf-8")

    purge_plans(tmp_path, CREATED)

    assert set(tmp_path.iterdir()) == {open_recent, unknown_version, *foreign}
    assert not committed.exists()
    assert not open_expired.exists()
    assert not orphan.exists()


def test_purge_ignores_a_missing_folder(tmp_path: Path) -> None:
    purge_plans(tmp_path / "plans", CREATED)

    assert not (tmp_path / "plans").exists()


def test_purge_carries_on_after_a_plan_it_cannot_delete(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    locked = _plan_file(tmp_path, timedelta(days=40), "1b2c3d")
    expired = _plan_file(tmp_path, timedelta(days=35), "9e8f7a")
    real_unlink = Path.unlink

    def unlink_unless_locked(self: Path, missing_ok: bool = False) -> None:
        if self == locked:
            raise PermissionError(13, "Permission denied")
        real_unlink(self, missing_ok=missing_ok)

    monkeypatch.setattr(Path, "unlink", unlink_unless_locked)

    purge_plans(tmp_path, CREATED)

    assert locked.exists()
    assert not expired.exists()
    assert "run plan not purged run=1b2c3d reason=unlink_failed" in caplog.messages
```

Dans `sidecar/tests/unit/test_main.py`, les deux tests qui lancent `main()` doivent isoler la purge des plans : sans cela, `test_a_failed_dump_purge_never_stops_the_startup` purgerait le vrai dossier de données de la machine.

```diff
@@ def test_logging_and_sentry_are_armed_before_the_loop() -> None:
         patch.object(__main__, "setup_logging", autospec=True) as setup,
         patch.object(__main__, "init_sentry", autospec=True) as sentry,
-        patch.object(__main__, "_purge_old_dumps", autospec=True) as purge,
+        patch.object(__main__, "_purge_old_dumps", autospec=True) as purge_dumps,
+        patch.object(__main__, "_purge_old_plans", autospec=True) as purge_plans,
         patch.object(__main__, "run_loop", autospec=True) as run_loop,
     ):
         parent.attach_mock(setup, "setup_logging")
         parent.attach_mock(sentry, "init_sentry")
-        parent.attach_mock(purge, "_purge_old_dumps")
+        parent.attach_mock(purge_dumps, "_purge_old_dumps")
+        parent.attach_mock(purge_plans, "_purge_old_plans")
         parent.attach_mock(run_loop, "run_loop")
```

```diff
@@ def test_logging_and_sentry_are_armed_before_the_loop() -> None:
 
     order = [call[0] for call in parent.mock_calls]
-    assert order == ["setup_logging", "init_sentry", "_purge_old_dumps", "run_loop"]
+    assert order == [
+        "setup_logging",
+        "init_sentry",
+        "_purge_old_dumps",
+        "_purge_old_plans",
+        "run_loop",
+    ]
```

```diff
@@ def test_a_failed_dump_purge_never_stops_the_startup(caplog: pytest.LogCaptureFi
         patch.object(__main__, "init_sentry", autospec=True),
         patch.object(__main__, "purge_dumps", autospec=True, side_effect=OSError(5, "denied")),
+        patch.object(__main__, "_purge_old_plans", autospec=True),
         patch.object(__main__, "run_loop", autospec=True) as run_loop,
     ):
```

```diff
@@ def test_a_failed_dump_purge_never_stops_the_startup(caplog: pytest.LogCaptureFi
 
 
+def test_a_failed_plan_purge_never_stops_the_startup(caplog: pytest.LogCaptureFixture) -> None:
+    with (
+        patch.object(__main__, "setup_logging", autospec=True),
+        patch.object(__main__, "init_sentry", autospec=True),
+        patch.object(__main__, "_purge_old_dumps", autospec=True),
+        patch.object(__main__, "purge_plans", autospec=True, side_effect=OSError(5, "denied")),
+        patch.object(__main__, "run_loop", autospec=True) as run_loop,
+    ):
+        __main__.main()
+
+    run_loop.assert_called_once()
+    assert "run plan purge failed" in caplog.messages
+
+
 def test_the_protocol_streams_are_forced_to_utf8(monkeypatch: pytest.MonkeyPatch) -> None:
     """Tauri lance le sidecar avec des pipes, que Windows ouvre en cp1252 : un seul
```

- [ ] **Step 2: Lancer les tests, ils échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_plan.py tests/unit/test_main.py --no-cov -q`
Expected: FAIL, `ImportError: cannot import name 'purge_plans'` et `AttributeError: ... '_purge_old_plans'`

- [ ] **Step 3: Écrire `purge_plans`**

Dans `sidecar/src/tagger/plan.py` :

```diff
@@ from tagger.errors import TaggerError
 from tagger.matching import QueryOrigin, check_thresholds
 from tagger.paths import app_data_dir
-from tagger.run_files import read_versioned, stamped_name, unlink_logged, write_atomically
+from tagger.run_files import (
+    PENDING_SUFFIX,
+    RETENTION,
+    created_at_of,
+    read_versioned,
+    stamped_name,
+    unlink_logged,
+    write_atomically,
+)
 from tagger.scraper_client import Source, TrackCandidate
 from tagger.tagging import FailureReason, Resolution, TrackState, is_decided
```

```diff
@@ class PlanRecorder:
 
 
+def purge_plans(folder: Path, now: datetime) -> None:
+    """Supprime les plans qui ne serviront plus : confirmes, ou passes les 30 jours.
+
+    Un plan illisible ou d'une version inconnue reste jusqu'a ses 30 jours : la reprise doit
+    pouvoir dire pourquoi elle ne reprend pas. Un temporaire n'a aucun ecrivain au demarrage
+    (instance unique) : c'est le reste d'une ecriture coupee.
+    """
+    if not folder.is_dir():
+        return
+    for path in folder.iterdir():
+        if path.suffix not in (_SUFFIX, PENDING_SUFFIX):
+            continue
+        created = created_at_of(path)
+        if created is None:
+            continue
+        if path.suffix == PENDING_SUFFIX or now - created > RETENTION or _committed(path):
+            unlink_logged(path, "run plan not purged")
+
+
+def _committed(path: Path) -> bool:
+    try:
+        return load_plan(path).committed
+    except RunPlanUnreadableError:
+        return False
+
+
 def _network_reason(reason: TrackFailureReason | None) -> FailureReason | None:
     """Un motif de fichier n'apparait qu'apres la confirmation, que le plan ne suit plus."""
```

- [ ] **Step 4: Brancher la purge au démarrage**

Dans `sidecar/src/tagger/__main__.py` :

```diff
@@ from tagger.logger import setup_logging
 from tagger.observability import init_sentry
 from tagger.paths import app_data_dir
+from tagger.plan import plan_dir, purge_plans
 from tagger.protocol import (
     CancelRun,
```

```diff
@@ def main() -> None:
     init_sentry(SENTRY_DSN, RELEASE)
     _purge_old_dumps()
+    _purge_old_plans()
     # Avant tout acces au secret : dans le binaire fige, la decouverte par entry
     # points rend une liste vide et keyring basculerait sur son backend `fail`.
```

```diff
@@ def _purge_old_dumps() -> None:
 
 
+def _purge_old_plans() -> None:
+    # Meme garde que les dumps : un plan qui reste quelques jours de plus ne gene personne.
+    try:
+        purge_plans(plan_dir(), datetime.now(UTC))
+    except OSError:
+        logger.exception("run plan purge failed")
+
+
 async def run_loop(stdin: TextIO, stdout: TextIO) -> None:
     """Lit les commandes ligne a ligne et emet les evenements produits.
```

- [ ] **Step 5: Lancer les tests, ils passent**

Run: `cd sidecar && uv run pytest tests/unit/test_plan.py tests/unit/test_main.py --no-cov -q`
Expected: PASS

- [ ] **Step 6: Gate et commit**

Run: `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar`
Expected: tout vert

```bash
git add sidecar/src/tagger/plan.py sidecar/src/tagger/__main__.py sidecar/tests/unit/test_plan.py sidecar/tests/unit/test_main.py
git commit -m "feat(plan): purge au demarrage des plans confirmes ou de plus de 30 jours"
```

---

### Task 5: Cycle de vie du plan dans la session

**Files:**
- Modify: `sidecar/src/tagger/handlers.py` (`CurrentRun`, `open_tagging`, `_open_plan`, `handle_commit_run`)
- Modify: `sidecar/src/tagger/__main__.py` (`_Session.start_tagging`, `_Session._replace`)
- Create: `sidecar/tests/integration/test_ndjson_plan.py`
- Modify: `sidecar/tests/integration/test_ndjson_write.py`
- Modify: `docs/ARCHITECTURE.md`

**Interfaces:**
- Consumes: `PlanRecorder`, `RunPlan.opened`, `plan_dir`, `load_plan`, `discard_plan` (Tasks 2 à 4) ; `LiveRun.observe` (Task 3) ; `run_plans.only_plan`, `plan_files` (Task 2).
- Produces :
  - `CurrentRun(stack, live, sources, arbitration, url_recovery, plan: PlanRecorder | None = None)` ;
  - l'attribut `CurrentRun.plan` ;
  - `async CurrentRun.abandon() -> None` : annule les gestes, supprime le plan non confirmé sans le vider d'abord, ferme la pile ;
  - `async handlers._open_plan(live: LiveRun, thresholds: MatchingThresholds, *, started_at: datetime | None = None) -> PlanRecorder | None`, où `started_at` est l'instant de départ d'un run repris (le sub-project 04 le passe pour que le plan garde son fichier) ;
  - `handlers.handle_commit_run(current, writer)` qui confirme le plan avant d'écrire.

- [ ] **Step 1: Écrire les tests d'intégration**

`sidecar/tests/integration/test_ndjson_plan.py` :

```python
"""Cycle de vie du plan de run, de bout en bout sur la boucle NDJSON."""

from typing import TYPE_CHECKING, Final

import pytest
from ndjson_loop import conversation, held_call, resolved_run
from run_plans import only_plan, plan_files
from scraper_responses import BANDCAMP_TRACK, YOUR_MIND, BASIEL, bandcamp_track_payload
from stubs import raising
from tagging_api import (
    ONE_TRACK,
    ORIGINAL,
    FakeApi,
    found,
    hold_on_beatport,
    ok,
    one_track,
    two_tracks,
)

from tagger import writing
from tagger.scraper_client import Source
from tagger.tag_dump import TagDumpWriteError
from tagger.tagging import Resolution, TrackState

if TYPE_CHECKING:
    from pathlib import Path

pytestmark = [pytest.mark.asyncio, pytest.mark.usefixtures("_key")]

CHOOSE_ON_BEATPORT: Final = {
    "command": "resolve_arbitration",
    "track_id": ONE_TRACK,
    "source": "beatport",
    "candidate": 0,
}


async def test_records_an_automatic_validation(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)

    plan = only_plan()
    track = plan.tracks[ONE_TRACK]
    assert (plan.run_id, plan.committed) == (run_id, False)
    assert (track.state, track.resolution, track.source) == (
        TrackState.RESOLVED,
        Resolution.AUTO,
        Source.BEATPORT,
    )
    assert track.candidate is not None
    assert track.scores is not None


async def test_records_an_arbitration_still_pending(
    tmp_path: Path, app_data: None, api: FakeApi
) -> None:
    hold_on_beatport(api)

    async with conversation() as talk:
        await resolved_run(talk, one_track(tmp_path))

    pending = only_plan().tracks[ONE_TRACK].arbitration
    assert pending is not None
    assert (pending.source, len(pending.candidates)) == (Source.BEATPORT, 2)


async def test_records_an_arbitration_decision(
    tmp_path: Path, app_data: None, api: FakeApi
) -> None:
    hold_on_beatport(api)

    async with conversation() as talk:
        await resolved_run(talk, one_track(tmp_path))
        talk.send(**CHOOSE_ON_BEATPORT)
        await talk.expect("track_resolved", track_id=ONE_TRACK, resolution="arbitration")

    track = only_plan().tracks[ONE_TRACK]
    assert (track.state, track.resolution, track.arbitration) == (
        TrackState.RESOLVED,
        Resolution.ARBITRATION,
        None,
    )


async def test_records_a_recovery_by_url(tmp_path: Path, app_data: None, api: FakeApi) -> None:
    api.on("/bandcamp/tracks", BANDCAMP_TRACK, ok(bandcamp_track_payload()))

    async with conversation() as talk:
        await resolved_run(talk, one_track(tmp_path))
        talk.send(command="resolve_by_url", track_id=ONE_TRACK, url=BANDCAMP_TRACK)
        await talk.expect("track_resolved", track_id=ONE_TRACK, resolution="url")

    track = only_plan().tracks[ONE_TRACK]
    assert (track.resolution, track.source, track.scores) == (
        Resolution.URL,
        Source.BANDCAMP,
        None,
    )


async def test_keeps_the_plan_of_a_run_shut_down_mid_network(
    tmp_path: Path, app_data: None, api: FakeApi
) -> None:
    api.on("/beatport/search", YOUR_MIND, found(ORIGINAL))
    gate = api.gate("/beatport/search", BASIEL)

    async with conversation() as talk:
        talk.send(command="start_tagging", folder=str(two_tracks(tmp_path)))
        await talk.expect("track_resolved", track_id="a.mp3")
        await gate.reached.wait()
        talk.send(command="shutdown")

    plan = only_plan()
    assert (plan.committed, plan.processed_count(), len(plan.tracks)) == (False, 1, 2)
    assert plan.tracks["b.mp3"].state is None


async def test_keeps_the_plan_of_a_run_stopped_by_cancel_run(
    tmp_path: Path, app_data: None, api: FakeApi
) -> None:
    api.on("/beatport/search", YOUR_MIND, found(ORIGINAL))
    gate = api.gate("/beatport/search", BASIEL)

    async with conversation() as talk:
        talk.send(command="start_tagging", folder=str(two_tracks(tmp_path)))
        await talk.expect("track_resolved", track_id="a.mp3")
        await gate.reached.wait()
        talk.send(command="cancel_run")
        await talk.expect("progress", phase="url_recovery")

    plan = only_plan()
    assert (plan.committed, plan.processed_count(), len(plan.tracks)) == (False, 1, 2)


async def test_deletes_the_plan_of_a_run_replaced_by_a_new_one(folder: Path) -> None:
    async with conversation() as talk:
        await resolved_run(talk, folder)
        second = await resolved_run(talk, folder)

    assert only_plan().run_id == second


@pytest.mark.usefixtures("api")
async def test_leaves_no_plan_for_a_folder_without_audio(tmp_path: Path, app_data: None) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()

    async with conversation() as talk:
        talk.send(command="start_tagging", folder=str(empty))
        await talk.expect("run_finished", phase="network")

    assert plan_files() == []


async def test_confirms_the_plan_before_the_first_file_is_written(
    folder: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    held = held_call(monkeypatch, writing, "write_tags")

    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="commit_run", run_id=run_id)
        await held.wait_reached()
        confirmed_before_writing = only_plan().committed
        held.release.set()
        await talk.expect("run_finished", phase="write")

    assert confirmed_before_writing
    assert only_plan().tracks[ONE_TRACK].state is TrackState.RESOLVED


async def test_reopens_the_plan_when_the_dump_cannot_be_saved(
    folder: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(writing, "save_entries", raising(TagDumpWriteError(folder / "x.json")))

    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="commit_run", run_id=run_id)
        await talk.expect("error", code="tag_dump_write_failed")

    assert not only_plan().committed
```

`folder` (conftest) dépend déjà de `app_data` et d'`api` et `api` de `monkeypatch`. Les tests qui bâtissent leur propre dossier demandent `app_data` explicitement.

- [ ] **Step 2: Lancer les tests, ils échouent**

Run: `cd sidecar && uv run pytest tests/integration/test_ndjson_plan.py --no-cov -q`
Expected: FAIL. `only_plan` trouve 0 plan et `test_leaves_no_plan_for_a_folder_without_audio` passe déjà.

- [ ] **Step 3: Brancher le recorder dans `handlers.py`**

`MatchingThresholds` est déjà importé à l'exécution dans `handlers.py` (`from tagger.matching import DEFAULT_THRESHOLDS, MatchingThresholds, ...`), `datetime` et `UTC` aussi. Dans `sidecar/src/tagger/handlers.py` :

```diff
@@ from tagger.files import after_tags, project_tags, shown_key, tag_system_of
 from tagger.matching import DEFAULT_THRESHOLDS, MatchingThresholds, credited_artists, full_title
 from tagger.paths import app_data_dir
+from tagger.plan import PlanRecorder, RunPlan, plan_dir
 from tagger.playlists import list_playlists, read_playlist
 from tagger.protocol import (
```

```diff
@@ class CurrentRun:
         arbitration: Arbitration,
         url_recovery: UrlRecovery,
+        plan: PlanRecorder | None = None,
     ) -> None:
         self.live = live
```

```diff
@@ class CurrentRun:
         self.arbitration = arbitration
         self.url_recovery = url_recovery
+        # `None` pour un dossier sans morceau : rien a reprendre.
+        self.plan = plan
         # Pose a la confirmation : sa presence fige le run, plus aucune decision n'y entre.
         self.writer: RunWriter | None = None
```

```diff
@@ class CurrentRun:
 
     async def close(self) -> None:
-        """`finally` : une annulation du `gather` en attente ne doit pas empecher la fermeture."""
+        """`finally` : une annulation du `gather` en attente ne doit pas empecher la fermeture.
+
+        Le plan est vide, jamais supprime : c'est lui que la reprise cherchera.
+        """
+        try:
+            await self._cancel_gestures()
+        finally:
+            try:
+                if self.plan is not None:
+                    await self.plan.flush()
+            finally:
+                await self._stack.aclose()
+
+    async def abandon(self) -> None:
+        """Run remplace par un nouveau : son plan non confirme part, sans etre vide d'abord."""
         try:
-            for gesture in self._gestures:
-                gesture.cancel()
-            await asyncio.gather(*self._gestures, return_exceptions=True)
+            await self._cancel_gestures()
+            if self.plan is not None:
+                await self.plan.discard()
         finally:
             await self._stack.aclose()
 
+    async def _cancel_gestures(self) -> None:
+        for gesture in self._gestures:
+            gesture.cancel()
+        await asyncio.gather(*self._gestures, return_exceptions=True)
+
 
 async def open_tagging(command: StartTagging, emit: Callable[[Event], None]) -> CurrentRun:
```

```diff
@@ async def open_tagging(command: StartTagging, emit: Callable[[Event], None]) ->
         relay = _relay(emit)
         live = await open_run(command.folder, on_event=relay)
-        sources = RunSources(live.run_id, client, artworks, _thresholds(command))
+        thresholds = _thresholds(command)
+        sources = RunSources(live.run_id, client, artworks, thresholds)
+        plan = await _open_plan(live, thresholds)
         desk = Arbitration(live, sources, relay)
         recovery = UrlRecovery(live, sources, relay)
-        return CurrentRun(stack.pop_all(), live, sources, desk, recovery)
+        return CurrentRun(stack.pop_all(), live, sources, desk, recovery, plan)
+
+
+async def _open_plan(
+    live: LiveRun, thresholds: MatchingThresholds, *, started_at: datetime | None = None
+) -> PlanRecorder | None:
+    """Plan ecrit avant la phase reseau, tous morceaux en attente ; sans morceau, aucun plan.
+
+    `started_at` : l'instant de depart d'un run repris, qui garde ainsi le fichier de son plan.
+    """
+    if not live.snapshot().tracks:
+        return None
+    plan = RunPlan.opened(live, thresholds, started_at or datetime.now(UTC))
+    recorder = PlanRecorder(plan, plan_dir())
+    live.observe(recorder.record)
+    await recorder.flush()
+    return recorder
```

```diff
@@ def commit(current: CurrentRun, emit: Callable[[Event], None]) -> RunWriter:
 
 async def handle_commit_run(current: CurrentRun, writer: RunWriter) -> Event:
-    """Un dump qui ne s'enregistre pas n'a touche aucun fichier : le run redevient confirmable."""
+    """Le plan est confirme sur le disque avant le premier fichier (write-ahead).
+
+    Un dump qui ne s'enregistre pas n'a touche aucun fichier : le run et son plan redeviennent
+    confirmables.
+    """
+    if current.plan is not None:
+        await current.plan.commit()
     try:
         await writer.write()
     except TagDumpError:
         current.writer = None
+        if current.plan is not None:
+            await current.plan.reopen()
         raise
     return _run_finished(current.live.snapshot(), RunPhase.WRITE)
```

- [ ] **Step 4: Abandonner le run remplacé dans `__main__.py`**

Dans `sidecar/src/tagger/__main__.py` :

```diff
@@ class _Session:
 
     def start_tagging(self, command: StartTagging) -> None:
-        """Lance le run en tache de fond ; il cesse aussitot d'etre le run courant."""
+        """Lance le run en tache de fond ; il cesse aussitot d'etre le run courant.
+
+        Le run remplace est abandonne : son plan non confirme est supprime, un seul run
+        interrompu peut exister a la fois.
+        """
         self._ensure_idle()
         replaced, self._current = self._current, None
```

```diff
@@ class _Session:
     async def _replace(self, replaced: CurrentRun | None, command: StartTagging) -> None:
         if replaced is not None:
-            await replaced.close()
+            await replaced.abandon()
         await handle_start_tagging(command, self.send, self._adopt)
```

- [ ] **Step 5: Cibler le dump dans `test_ndjson_write.py`**

Le glob `*-{run_id}.json` de `test_writes_a_committed_run_end_to_end` matche désormais aussi le plan, qui porte le même `run_id`. Il faut viser le seul dossier des dumps. Dans `sidecar/tests/integration/test_ndjson_write.py` :

```diff
@@ from tagger import files, handlers, tag_dump, writing
 from tagger.file_failures import FileFailureReason
 from tagger.files import TagsUnreadableError, TagsWriteError
-from tagger.tag_dump import TagDumpUnreadableError, TagDumpWriteError
+from tagger.tag_dump import TagDumpUnreadableError, TagDumpWriteError, dump_dir
 
 if TYPE_CHECKING:
```

```diff
@@ def _locked_until_lifted(monkeypatch: pytest.MonkeyPatch) -> Callable[[], None]:
 
 
-async def test_writes_a_committed_run_end_to_end(folder: Path, tmp_path: Path) -> None:
+async def test_writes_a_committed_run_end_to_end(folder: Path) -> None:
     async with conversation() as talk:
         run_id = await resolved_run(talk, folder)
```

```diff
@@ async def test_writes_a_committed_run_end_to_end(folder: Path, tmp_path: Path) -
     assert (finished["written"], finished["write_error"]) == (1, 0)
     assert (folder / WRITTEN_NAME).is_file()
-    assert list((tmp_path / "appdata").rglob(f"*-{run_id}.json"))
+    assert list(dump_dir().glob(f"*-{run_id}.json"))
```

- [ ] **Step 6: Lancer les tests, ils passent**

Run: `cd sidecar && uv run pytest tests/integration/ tests/unit/test_handlers.py --no-cov -q`
Expected: PASS

- [ ] **Step 7: Mettre à jour `docs/ARCHITECTURE.md`**

Relire les numéros de ligne avant d'éditer (ceux ci-dessous sont ceux du 2026-10-12). Les commentaires de l'arborescence gardent leurs accents, comme leurs voisins.

1. Arborescence (la ligne `plan.py`, vers la ligne 138) : remplacer son commentaire par `# plan de run : modèle, enregistrement, relecture, purge`. Ajouter juste au-dessus la ligne `run_files.py` avec le commentaire `# nom horodaté, écriture atomique et rétention des fichiers d'un run, partagés par dumps et plans`, sur le même alignement que ses voisines. La ligne `tag_dump.py` reste telle quelle.
2. § Données, ligne « Plan de run » du tableau (vers la ligne 614) :
   - emplacement : `appLocalDataDir()/plans` ;
   - durée de vie : « Purgé au démarrage une fois confirmé (`commit_run`), 30 jours depuis son démarrage s'il est interrompu, même repris. Un run remplacé dans la session supprime le sien, `shutdown` et `cancel_run` le gardent ».
3. Diagramme de séquence (vers la ligne 674) : remplacer `décision gardée en mémoire (plan JSON : Feature 6)` par `décision écrite au plan JSON (appLocalDataDir/plans)`.
4. Mode de panne « Sidecar qui meurt **pendant** un run » (vers la ligne 851), à remplacer par :

   ```text
   Le plan de run étant écrit au fil de l'eau, l'état est intact sur le disque. Avant `commit_run`, aucun fichier musical n'a été touché : l'application propose la reprise au lancement suivant (cf. use-case 6). Dès `commit_run`, le plan est confirmé et ne se reprend plus : des fichiers peuvent être à moitié écrits, mais le dump des tags d'origine, enregistré avant toute réécriture, permet de les restaurer depuis les Réglages. Le journal des renommages, forcé sur le disque avant chaque déplacement, retrouve même un fichier déjà renommé.
   ```

- [ ] **Step 8: Gate et commit**

Run: `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar`
Expected: tout vert, couverture du sidecar au-dessus du seuil

```bash
git add sidecar/src/tagger/handlers.py sidecar/src/tagger/__main__.py sidecar/tests/integration/test_ndjson_plan.py sidecar/tests/integration/test_ndjson_write.py docs/ARCHITECTURE.md
git commit -m "feat(plan): plan de run ecrit au fil du run, confirme avant l'ecriture"
```
