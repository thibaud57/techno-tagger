# Reprise d'un run interrompu : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Détecter au lancement un run interrompu, le résumer, reconstruire son état en mémoire depuis son plan pour ne relancer que les morceaux jamais traités, ou l'abandonner.

**Architecture:** `plan.py` gagne les conversions inverses : un `PlanTrack` se pose sur un `TrackRecord` relu. Le nouveau module `resume.py` porte deux choses : la détection, qui produit un `InterruptedRun` ou un `UnreadablePlan` et ignore le run ouvert dans la session, avec la désignation d'un plan ; et `reopen_run`, pendant de `open_run`, qui reconstruit le run sur le dossier actuel, annonce le run, retélécharge les pochettes et rejoue les événements d'un run vivant. L'abandon d'un plan est `plan.discard_plan` (sub-project 01). `resolve_run` ne traite plus que les morceaux sans décision (`TrackRecord.decided`), avec une progression qui part du nombre déjà traité.

**Tech Stack:** Python 3.14, pydantic 2, pytest + pytest-asyncio. Helpers `tagging_api` (`FakeApi`, `FakeCdn`, `tagged_mp3`, `two_tracks`, `three_tracks`, `opened_run`), `tagging_records`, `scraper_responses`, `run_plans` (livré par le sub-project 01).

**Spec:** `docs/superpowers/specs/plan-de-run-reprise-et-rapport/02-reprise-run-sidecar-design.md`

## Global Constraints

- **Lecture des blocs de code** : un bloc `diff` donne les lignes à supprimer (`-`) et à ajouter (`+`) autour de lignes de contexte, sans numéro de ligne. Un bloc précédé de « Ajouter à la fin du fichier » donne du code à poser tel quel. Un fichier à créer est donné en entier.
- **Dépend du sub-project 01, implémenté avant**, qui livre :
  - `plan.py` : `RunPlan`, `PlanTrack`, `PlanQuery`, `PlanScores`, `PlanScored`, `PlanSourceList`, `PlanArbitration`, `PlanThresholds` (déjà validé par `check_thresholds`), `RunPlan.opened`, `processed_count`, `plan_dir`, `plan_path`, `load_plan`, `RunPlanUnreadableError`, `discard_plan` ;
  - `run_files.py` : `created_at_of`, `run_id_of`, `stamped_name`, `newest_first` ;
  - `tagging.py` : `TrackRecord.decided` (règle unique du « traité ») ;
  - `tests/helpers/run_plans.py` : `RUN_ID`, `music`, `plan_of`, `save_plan`, `plan_files`, `only_plan`, que ce plan réutilise sans les redéfinir.
- **Détection** : du plus récent au plus ancien, selon l'horodatage du nom.
  - Le plan du run ouvert dans la session (`active_run_id`) est ignoré.
  - Un plan `committed` est passé.
  - Un plan ouvert dont le `run_id` a un dump est supprimé, avec le log WARNING `run plan dropped run=<run_id> reason=files_written`.
  - Un plan illisible est rendu en `UnreadablePlan`, un plan ouvert en `InterruptedRun`.
  - Seul le premier retenu est rendu.
- **`folder_missing`** : vrai quand `list_audio_files(plan.folder)` lève `TaggingFolderUnreadableError` ou ne rend aucun fichier. Le plan n'est alors pas reprenable, mais reste sur le disque.
- **Abandon d'un plan** : `plan.discard_plan` (sub-project 01), log WARNING `run plan not discarded run=<run_id> reason=unlink_failed` sans exception.
- **Run repris** : il se reconstruit sur le dossier actuel.
  - Les décisions s'appliquent par `track_id`, sauf pour un morceau non décidé (`TrackRecord.decided` faux) : un `unresolved` pour `source_unavailable` repart sur le réseau.
  - Un fichier nouveau entre en attente.
  - Un fichier disparu sort du run, avec le log WARNING `track dropped run=<run_id> track=<position dans le plan> reason=file_missing`.
  - Un dossier sans aucun fichier audio lève `TaggingFolderUnreadableError` avant tout événement.
- **Rejeu**, dans cet ordre :
  - `RunStarted`, avant le téléchargement des pochettes ;
  - un `TrackResolved` par morceau tranché et un `ArbitrationRequired` par arbitrage en attente, dans l'ordre du dossier ;
  - `RunProgress(traités, total)`, les traités étant les morceaux décidés.
- **`resolve_run`** : jamais d'appel API pour un morceau décidé (tranché ou en attente d'arbitrage).
- **Un run arrêté par `cancel_run`** garde son plan (sub-project 01) : il est proposé à la reprise comme un run interrompu et la reprise relance les recherches des morceaux non atteints.
- **Pas de commande NDJSON** dans ce sub-project : `resume_run`, `discard_run` et l'événement de détection arrivent avec le sub-project 04.
- **Code Python sans accents**, docstrings et commentaires en français, le pourquoi seulement. Logs en logfmt sur le jeu de clés fixe, jamais un titre.
- **Tests** : noms en anglais, AAA séparé par des lignes vides (l'Act est l'appel testé), `tmp_path`, `@pytest.mark.asyncio` sur les tests async.
- **Gate vert à chaque commit** : `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar` (le typage porte sur `src` et `tests`). Commits `type(scope): description`, scope `plan` ou `sidecar`.

## Review Focus

- **Dossier vidé depuis le plan** : `reopen_run` lève `TaggingFolderUnreadableError` avant tout événement et la détection rend `folder_missing` (Task 3, `test_flags_a_run_whose_folder_was_emptied` ; Task 4, `test_refuses_to_reopen_a_folder_with_nothing_left_to_resume`).
- **Run ouvert dans la session** : la détection ne le propose pas comme interrompu (Task 3, `test_ignores_the_plan_of_the_run_still_open`).
- **Morceau dont la source n'a pas répondu** (403, panne) : il repart sur le réseau à la reprise et ne compte pas comme traité (Task 2, `test_sends_back_to_the_api_a_track_whose_source_did_not_answer` ; Task 4, `test_leaves_a_track_whose_source_did_not_answer_to_the_network`).
- **Arbitrage en attente tranché après la reprise** : `Arbitration.choose` fonctionne sur le morceau reconstruit, requête comprise (Task 4, `test_a_reopened_arbitration_can_still_be_decided`).
- **Plan illisible plus récent qu'un plan ouvert** : la détection rend l'illisible, l'ouvert attend le lancement suivant (Task 3, `test_reports_the_newest_plan_first_even_when_unreadable`).
- **Pochette refusée par le CDN à la reprise** : le morceau reste résolu, sans pochette (Task 4, `test_keeps_a_track_resolved_when_its_artwork_is_unavailable`).
- **Morceau rangé dans un sous-dossier** (`track_id` = `sub/b.mp3`) : sa décision est rendue comme les autres (Task 4, `test_gives_back_the_decisions_of_the_plan`).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `sidecar/src/tagger/plan.py` | Conversions inverses : `to_query`, `applied_to`, `to_scored`, `to_source_list`, `to_pending`, `to_matching` ; `plans_newest_first` |
| `sidecar/src/tagger/tagging.py` | `read_identities` public ; `resolve_run` sélectif, compteur de départ dans `_Runner` |
| `sidecar/src/tagger/sources.py` | `RunSources.artwork` public |
| `sidecar/src/tagger/resume.py` | Détection, désignation, `reopen_run` |
| `sidecar/tests/helpers/tagging_api.py` | `run_sources` : `RunSources` sur l'API et le CDN simulés, sans ouvrir de run |
| `sidecar/tests/unit/test_plan.py` | Conversions inverses |
| `sidecar/tests/unit/test_tagging_run.py` | Pipeline sélectif |
| `sidecar/tests/unit/test_resume.py` | Détection, désignation, reconstruction, état livré |
| `docs/ARCHITECTURE.md` | Arborescence : `resume.py` |

---

### Task 1: Conversions inverses du plan

**Files:**
- Modify: `sidecar/src/tagger/plan.py`
- Test: `sidecar/tests/unit/test_plan.py`

**Interfaces:**
- Consumes: modèles du plan (sub-project 01) ; `tagging.TrackRecord`, `PendingArbitration`, `SourceList` ; `matching.TrackQuery`, `ScoredCandidate`, `MatchingThresholds`.
- Produces :
  - `PlanQuery.to_query() -> TrackQuery` ;
  - `PlanScores.applied_to(candidate: TrackCandidate) -> ScoredCandidate` ;
  - `PlanScored.to_scored() -> ScoredCandidate` ;
  - `PlanSourceList.to_source_list() -> SourceList` ;
  - `PlanArbitration.to_pending() -> PendingArbitration` ;
  - `PlanThresholds.to_matching() -> MatchingThresholds` ;
  - `PlanTrack.applied_to(record: TrackRecord) -> TrackRecord`, qui pose la décision du plan sans regarder si le morceau est décidé (c'est `reopen_run` qui trie).

- [ ] **Step 1: Écrire les tests**

`sidecar/tests/unit/test_plan.py` définit déjà `AUTO`, `HELD`, `BY_URL`, `UNRESOLVED` et `WAITING` (sub-project 01). Ajouter `PlanThresholds` à son import de `tagger.plan` et `MatchingThresholds` à celui de `tagger.matching`, puis les tests :

```diff
@@ from tagging_records import RECORD, scored_candidate
 from tagger import plan as plan_module
 from tagger.file_failures import FileFailureReason
-from tagger.matching import DEFAULT_THRESHOLDS, QueryOrigin, TrackQuery
+from tagger.matching import DEFAULT_THRESHOLDS, MatchingThresholds, QueryOrigin, TrackQuery
 from tagger.plan import (
     PlanRecorder,
     PlanScores,
+    PlanThresholds,
     PlanTrack,
     RunPlan,
```

Ajouter à la fin du fichier :

```python
@pytest.mark.parametrize(
    "record",
    [AUTO, HELD, BY_URL, UNRESOLVED, WAITING],
    ids=["auto", "held", "by-url", "unresolved", "waiting"],
)
def test_gives_back_the_decision_it_recorded(record: TrackRecord) -> None:
    reread = TrackRecord(track_id=record.track_id, path=record.path, identity=record.identity)

    restored = PlanTrack.of(record).applied_to(reread)

    assert restored == replace(record, artwork=None)


def test_gives_back_the_thresholds_of_the_run() -> None:
    thresholds = PlanThresholds(floor=60, ceiling=85)

    restored = thresholds.to_matching()

    assert restored == MatchingThresholds(floor=60, ceiling=85)
```

- [ ] **Step 2: Lancer les tests, ils échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_plan.py --no-cov -q`
Expected: FAIL, `AttributeError: 'PlanTrack' object has no attribute 'applied_to'`

- [ ] **Step 3: Écrire les conversions**

Dans `sidecar/src/tagger/plan.py`, les noms construits à l'exécution (`MatchingThresholds`, `ScoredCandidate`, `TrackQuery`, `PendingArbitration`, `SourceList`) sortent du bloc `TYPE_CHECKING` :

```diff
@@ Deux politiques de version voisines, a ne pas aligner (ADR-018) : le plan, jetab
 import asyncio
 import logging
+from dataclasses import replace
 from pathlib import Path
 from typing import TYPE_CHECKING, ClassVar, Final, Self, override
```

```diff
@@ from pydantic import AwareDatetime, BaseModel, ConfigDict, model_validator
 
 from tagger.errors import TaggerError
-from tagger.matching import QueryOrigin, check_thresholds
+from tagger.matching import (
+    MatchingThresholds,
+    QueryOrigin,
+    ScoredCandidate,
+    TrackQuery,
+    check_thresholds,
+)
 from tagger.paths import app_data_dir
 from tagger.run_files import (
```

```diff
@@ from tagger.run_files import (
 )
 from tagger.scraper_client import Source, TrackCandidate
-from tagger.tagging import FailureReason, Resolution, TrackState, is_decided
+from tagger.tagging import (
+    FailureReason,
+    PendingArbitration,
+    Resolution,
+    SourceList,
+    TrackState,
+    is_decided,
+)
 
 if TYPE_CHECKING:
     from datetime import datetime
 
-    from tagger.matching import MatchingThresholds, ScoredCandidate, TrackQuery
-    from tagger.tagging import (
-        LiveRun,
-        PendingArbitration,
-        SourceList,
-        TrackFailureReason,
-        TrackRecord,
-    )
+    from tagger.tagging import LiveRun, TrackFailureReason, TrackRecord
 
 logger = logging.getLogger(__name__)
```

```diff
@@ class PlanQuery(_PlanModel):
         return cls(artist=query.artist, title=query.title, origin=query.origin)
 
+    def to_query(self) -> TrackQuery:
+        return TrackQuery(self.artist, self.title, self.origin)
+
 
 class PlanScores(_PlanModel):
```

```diff
@@ class PlanScores(_PlanModel):
         )
 
+    def applied_to(self, candidate: TrackCandidate) -> ScoredCandidate:
+        """Scores poses sur le candidat retenu, celui que l'ecriture posera."""
+        return ScoredCandidate(
+            candidate,
+            self.artist,
+            self.title,
+            self.average,
+            version_mismatch=self.version_mismatch,
+            number_mismatch=self.number_mismatch,
+        )
+
 
 class PlanScored(_PlanModel):
```

```diff
@@ class PlanScored(_PlanModel):
         return cls(candidate=scored.candidate, scores=PlanScores.of(scored))
 
+    def to_scored(self) -> ScoredCandidate:
+        return self.scores.applied_to(self.candidate)
+
 
 class PlanSourceList(_PlanModel):
```

```diff
@@ class PlanSourceList(_PlanModel):
         )
 
+    def to_source_list(self) -> SourceList:
+        return SourceList(
+            self.source,
+            tuple(scored.to_scored() for scored in self.candidates),
+            self.empty_reason,
+        )
+
 
 class PlanArbitration(_PlanModel):
```

```diff
@@ class PlanArbitration(_PlanModel):
         )
 
+    def to_pending(self) -> PendingArbitration:
+        return PendingArbitration(
+            self.source,
+            tuple(scored.to_scored() for scored in self.candidates),
+            self.beatport_unavailable,
+            self.empty_reason,
+            None if self.other is None else self.other.to_source_list(),
+        )
+
 
 class PlanThresholds(_PlanModel):
```

```diff
@@ class PlanThresholds(_PlanModel):
         return self
 
+    def to_matching(self) -> MatchingThresholds:
+        return MatchingThresholds(floor=self.floor, ceiling=self.ceiling)
+
 
 class PlanTrack(_PlanModel):
```

```diff
@@ class PlanTrack(_PlanModel):
         )
 
+    def applied_to(self, record: TrackRecord) -> TrackRecord:
+        """Decision du plan posee sur le morceau relu ; sa pochette se retelecharge a part."""
+        candidate, scores = self.candidate, self.scores
+        return replace(
+            record,
+            state=self.state,
+            resolution=self.resolution,
+            failure_reason=self.failure_reason,
+            source=self.source,
+            query=None if self.query is None else self.query.to_query(),
+            candidate=candidate,
+            scored=None if scores is None or candidate is None else scores.applied_to(candidate),
+            arbitration=None if self.arbitration is None else self.arbitration.to_pending(),
+        )
+
 
 class RunPlan(_PlanModel):
```

- [ ] **Step 4: Lancer les tests, ils passent**

Run: `cd sidecar && uv run pytest tests/unit/test_plan.py --no-cov -q`
Expected: PASS

- [ ] **Step 5: Gate et commit**

Run: `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar`
Expected: tout vert

```bash
git add sidecar/src/tagger/plan.py sidecar/tests/unit/test_plan.py
git commit -m "feat(plan): rendre au run les decisions d'un plan relu"
```

---

### Task 2: Pipeline sélectif

**Files:**
- Modify: `sidecar/src/tagger/tagging.py` (`_read_identities`, `resolve_run`, `_Runner`)
- Modify: `sidecar/src/tagger/sources.py` (`_artwork` devient `artwork`)
- Test: `sidecar/tests/unit/test_tagging_run.py`

**Interfaces:**
- Consumes: `TrackRecord.decided` (sub-project 01) ; `tagging_api.opened_run`, `two_tracks`, `three_tracks`, `FakeApi` (existants) ; `tagging_records.scored_candidate`.
- Produces :
  - `tagging.read_identities(run_id: str, folder: Path, paths: tuple[Path, ...]) -> list[TrackRecord]` (async) ;
  - `resolve_run`, qui ignore les morceaux décidés ;
  - `RunSources.artwork(position: int, candidate: TrackCandidate) -> Path | None` (async).

- [ ] **Step 1: Écrire les tests**

Ajouter à `sidecar/tests/unit/test_tagging_run.py` (`RunProgress` y est déjà importé, ainsi que `FakeApi`) :

```diff
@@
 """Tests du run : evenements, progression, garde des 403, incidents."""
 
+from dataclasses import replace
 from typing import TYPE_CHECKING
 from unittest.mock import patch
```

```diff
@@ from tagging_api import (
     basiel,
     one_track,
+    opened_run,
     run,
     tagged_mp3,
     three_tracks,
+    two_tracks,
 )
+from tagging_records import scored_candidate
 
 from tagger.files import TaggingFolderUnreadableError
+from tagger.scraper_client import Source
 from tagger.sources import ApiKeyRejectedRunError, _RejectionGuard
 from tagger.tagging import (
     ArbitrationRequired,
+    FailureReason,
+    PendingArbitration,
     RunProgress,
     RunStarted,
     TrackResolved,
     TrackState,
+    resolve_run,
 )
```

```diff
@@ if TYPE_CHECKING:
     from pathlib import Path
 
-    from tagger.tagging import RunEvent
+    from tagger.tagging import LiveRun, RunEvent
 
 pytestmark = pytest.mark.asyncio
```

Ajouter à la fin du fichier :

```python
def _searched(api: FakeApi) -> set[str | None]:
    return {
        request.url.params.get("q")
        for request in api.requests
        if request.url.path.endswith("/search")
    }


def _hold(live: LiveRun, track_id: str) -> None:
    record = live.record(track_id)
    assert record is not None
    held = PendingArbitration(Source.BEATPORT, (scored_candidate(),), beatport_unavailable=False)
    live.update(replace(record, arbitration=held))


def _refuse(live: LiveRun, track_id: str, reason: FailureReason) -> None:
    record = live.record(track_id)
    assert record is not None
    live.update(record.unresolved(reason))


async def test_never_sends_a_decided_track_back_to_the_api(tmp_path: Path) -> None:
    api = FakeApi()
    events: list[RunEvent] = []
    async with opened_run(three_tracks(tmp_path), api) as (live, sources):
        _refuse(live, "a.mp3", FailureReason.USER_REFUSED)
        _hold(live, "b.mp3")

        await resolve_run(live, sources, on_event=events.append)

    assert _searched(api) == {"Sara Landry The Void"}
    assert [event for event in events if isinstance(event, RunProgress)] == [RunProgress(3, 3)]


async def test_sends_back_to_the_api_a_track_whose_source_did_not_answer(tmp_path: Path) -> None:
    api = FakeApi()
    async with opened_run(two_tracks(tmp_path), api) as (live, sources):
        _refuse(live, "a.mp3", FailureReason.SOURCE_UNAVAILABLE)
        _refuse(live, "b.mp3", FailureReason.NO_RESULT)

        await resolve_run(live, sources, on_event=lambda _event: None)

    assert _searched(api) == {"Adam Beyer Your Mind"}
```

Le test d'un run neuf (tous les morceaux traités, progression de 1 à M) existe déjà : `test_counts_a_track_as_processed_once_resolved_unresolved_or_on_hold`. Il doit rester vert sans modification.

- [ ] **Step 2: Lancer les tests, ils échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_tagging_run.py::test_never_sends_a_decided_track_back_to_the_api tests/unit/test_tagging_run.py::test_sends_back_to_the_api_a_track_whose_source_did_not_answer --no-cov -q`
Expected: FAIL, les recherches de `a.mp3` et `b.mp3` partent aussi.

- [ ] **Step 3: Rendre `resolve_run` sélectif**

Dans `sidecar/src/tagger/tagging.py` :

```diff
@@ async def open_run(folder: Path, *, on_event: Callable[[RunEvent], None]) -> Liv
     paths = await asyncio.to_thread(list_audio_files, folder)
     run_id = secrets.token_hex(3)
-    records = await _read_identities(run_id, folder, paths)
+    records = await read_identities(run_id, folder, paths)
     on_event(RunStarted(run_id, folder, tuple(records)))
     return LiveRun(run_id, folder, records)
```

```diff
@@ async def resolve_run(
     live: LiveRun, sources: RunSources, *, on_event: Callable[[RunEvent], None]
 ) -> None:
-    """Ne s'arrete jamais sur un morceau : seuls trois 403 consecutifs arretent le run."""
+    """Ne s'arrete jamais sur un morceau : seuls trois 403 consecutifs arretent le run.
+
+    Un morceau deja traite (run repris) n'est jamais renvoye a l'API : la progression part du
+    nombre deja traite, sur le total du run.
+    """
     tracks = live.snapshot().tracks
-    runner = _Runner(len(tracks), sources, live, on_event)
+    waiting = [record for record in tracks if not record.decided]
+    runner = _Runner(len(tracks), sources, live, on_event, processed=len(tracks) - len(waiting))
     try:
         async with asyncio.TaskGroup() as group:
-            for position, record in enumerate(tracks, start=1):
+            for record in waiting:
+                position = live.position(record.track_id)
                 group.create_task(runner.process(position, record), name=f"track:{position}")
     except* ApiKeyRejectedRunError:
```

```diff
@@ async def resolve_run(
 
 
-async def _read_identities(run_id: str, folder: Path, paths: tuple[Path, ...]) -> list[TrackRecord]:
+async def read_identities(run_id: str, folder: Path, paths: tuple[Path, ...]) -> list[TrackRecord]:
     """Identites lues avant tout appel reseau : la liste s'affiche entiere des le depart.
```

```diff
@@ class _Runner:
         live: LiveRun,
         on_event: Callable[[RunEvent], None],
+        *,
+        processed: int = 0,
     ) -> None:
         self._total = total
```

```diff
@@ class _Runner:
         self._live = live
         self._on_event = on_event
-        self._processed = 0
+        self._processed = processed
 
     async def process(self, position: int, record: TrackRecord) -> None:
```

Dans `sidecar/src/tagger/sources.py` :

```diff
@@ class RunSources:
         """Candidat recharge et sa pochette ; ni l'un ni l'autre ne fait echouer le morceau."""
         candidate = await self._refetch(position, source, chosen.candidate)
-        return candidate, await self._artwork(position, candidate)
+        return candidate, await self.artwork(position, candidate)
 
     async def from_url(self, position: int, url: str) -> tuple[TrackCandidate, Path | None]:
```

```diff
@@ class RunSources:
         """
         candidate = await self._call(self._client.fetch_by_url(url))
-        return candidate, await self._artwork(position, candidate)
+        return candidate, await self.artwork(position, candidate)
 
     def log_source_failure(
```

```diff
@@ class RunSources:
             return candidate
 
-    async def _artwork(self, position: int, candidate: TrackCandidate) -> Path | None:
+    async def artwork(self, position: int, candidate: TrackCandidate) -> Path | None:
+        """Pochette du candidat, cache d'abord ; une indisponibilite ne fait jamais echouer le
+        morceau."""
         url = candidate.release.artwork_url if candidate.release else None
         if url is None:
```

- [ ] **Step 4: Lancer les tests, ils passent**

Run: `cd sidecar && uv run pytest tests/unit/test_tagging_run.py tests/unit/test_tagging_outcomes.py tests/unit/test_tagging_live_run.py tests/unit/test_arbitration_gestures.py tests/unit/test_url_recovery.py tests/integration/test_ndjson_tagging.py --no-cov -q`
Expected: PASS. Les tests existants d'un run neuf restent verts sans modification.

- [ ] **Step 5: Gate et commit**

Run: `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar`
Expected: tout vert

```bash
git add sidecar/src/tagger/tagging.py sidecar/src/tagger/sources.py sidecar/tests/unit/test_tagging_run.py
git commit -m "feat(sidecar): la phase reseau ne traite que les morceaux sans decision"
```

---

### Task 3: Détection et désignation

**Files:**
- Create: `sidecar/src/tagger/resume.py`
- Modify: `sidecar/src/tagger/plan.py` (`plans_newest_first`)
- Modify: `docs/ARCHITECTURE.md`
- Test: `sidecar/tests/unit/test_resume.py`

**Interfaces:**
- Consumes: `load_plan`, `RunPlanUnreadableError`, `RunPlan.opened`, `plan_path`, `discard_plan` (01) ; `run_files.created_at_of`, `run_id_of`, `stamped_name`, `newest_first` (01) ; `tag_dump.find_dump` ; `files.list_audio_files`, `TaggingFolderUnreadableError` ; `run_plans.RUN_ID`, `plan_of`, `save_plan` (01).
- Produces :
  - `resume.InterruptedRun(path, run_id, started_at, folder, processed, total, folder_missing)` ;
  - `resume.UnreadablePlan(path, run_id, started_at, error: RunPlanUnreadableError)` ;
  - `resume.DetectedPlan`, l'union des deux ;
  - `resume.detect_interrupted(plans: Path, dumps: Path, *, active_run_id: str | None = None) -> DetectedPlan | None` ;
  - `resume.find_plan(plans: Path, run_id: str) -> Path | None` ;
  - `plan.plans_newest_first(folder: Path) -> list[Path]`.

  Les fonctions de `resume` sont synchrones : le sub-project 04 les appelle par `to_thread`, avec le `run_id` du run ouvert quand il y en a un.

- [ ] **Step 1: Écrire les tests de détection et de désignation**

`sidecar/tests/unit/test_resume.py` :

```python
"""Tests de la reprise d'un run interrompu : detection, designation, reconstruction."""

import json
from datetime import timedelta
from pathlib import Path
from typing import Final

import pytest
from run_plans import RUN_ID, plan_of, save_plan
from tagging_api import CREATED
from tagging_records import RECORD

from tagger.resume import InterruptedRun, UnreadablePlan, detect_interrupted, find_plan
from tagger.run_files import stamped_name
from tagger.tagging import FailureReason, TrackRecord

OLDER: Final = CREATED - timedelta(days=2)


@pytest.fixture
def plans(tmp_path: Path) -> Path:
    return tmp_path / "plans"


@pytest.fixture
def dumps(tmp_path: Path) -> Path:
    folder = tmp_path / "dumps"
    folder.mkdir()
    return folder


@pytest.fixture
def music_folder(tmp_path: Path) -> Path:
    """Dossier vide, que `music` et `tagged_mp3` remplissent de vrais fichiers."""
    folder = tmp_path / "music"
    folder.mkdir()
    return folder


@pytest.fixture
def folder_with_audio(music_folder: Path) -> Path:
    """Un fichier audio vide suffit a la detection, qui ne lit aucun tag."""
    (music_folder / "a.mp3").touch()
    return music_folder


def _decided(count: int, waiting: int) -> list[TrackRecord]:
    """`count` morceaux tranches puis `waiting` en attente ; aucun fichier : la detection
    ne relit que le dossier du plan."""
    decided = [
        TrackRecord(
            track_id=f"d{n}.mp3", path=Path(f"d{n}.mp3"), identity=RECORD.identity
        ).unresolved(FailureReason.NO_RESULT)
        for n in range(count)
    ]
    pending = [
        TrackRecord(track_id=f"w{n}.mp3", path=Path(f"w{n}.mp3"), identity=RECORD.identity)
        for n in range(waiting)
    ]
    return [*decided, *pending]


def test_finds_no_interrupted_run_without_plans(plans: Path, dumps: Path) -> None:
    detected = detect_interrupted(plans, dumps)

    assert detected is None


def test_sums_up_an_interrupted_run(plans: Path, dumps: Path, folder_with_audio: Path) -> None:
    path = save_plan(plans, plan_of(folder_with_audio, _decided(62, 38)))

    detected = detect_interrupted(plans, dumps)

    assert detected == InterruptedRun(
        path=path,
        run_id=RUN_ID,
        started_at=CREATED,
        folder=folder_with_audio,
        processed=62,
        total=100,
        folder_missing=False,
    )


def test_flags_a_run_whose_folder_is_gone(plans: Path, dumps: Path, tmp_path: Path) -> None:
    path = save_plan(plans, plan_of(tmp_path / "unplugged", _decided(1, 1)))

    detected = detect_interrupted(plans, dumps)

    assert isinstance(detected, InterruptedRun)
    assert detected.folder_missing
    assert path.exists()


def test_flags_a_run_whose_folder_was_emptied(plans: Path, dumps: Path, music_folder: Path) -> None:
    path = save_plan(plans, plan_of(music_folder, _decided(1, 1)))

    detected = detect_interrupted(plans, dumps)

    assert isinstance(detected, InterruptedRun)
    assert detected.folder_missing
    assert path.exists()


def test_reports_a_plan_of_another_version(plans: Path, dumps: Path) -> None:
    plans.mkdir()
    path = plans / stamped_name(CREATED, RUN_ID, ".json")
    path.write_text(json.dumps({"schema_version": 2}), encoding="utf-8")

    detected = detect_interrupted(plans, dumps)

    assert isinstance(detected, UnreadablePlan)
    assert (detected.path, detected.run_id, detected.started_at) == (path, RUN_ID, CREATED)
    assert detected.error.params == {"file": path.name, "found": 2, "expected": 1}


def test_drops_a_plan_whose_files_were_already_written(
    plans: Path,
    dumps: Path,
    folder_with_audio: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    written = save_plan(plans, plan_of(folder_with_audio, _decided(1, 1)))
    (dumps / stamped_name(CREATED, RUN_ID, ".json")).write_text("{}", encoding="utf-8")
    older = save_plan(
        plans, plan_of(folder_with_audio, _decided(1, 1), run_id="9e8f7a", started_at=OLDER)
    )

    detected = detect_interrupted(plans, dumps)

    assert not written.exists()
    assert isinstance(detected, InterruptedRun)
    assert detected.path == older
    assert "run plan dropped run=a3f9c1 reason=files_written" in caplog.messages


def test_skips_a_committed_plan_and_foreign_files(
    plans: Path, dumps: Path, folder_with_audio: Path
) -> None:
    save_plan(plans, plan_of(folder_with_audio, _decided(1, 1), committed=True))
    older = save_plan(
        plans, plan_of(folder_with_audio, _decided(1, 1), run_id="9e8f7a", started_at=OLDER)
    )
    (plans / "notes.json").write_text("{", encoding="utf-8")
    (plans / stamped_name(CREATED, "2c3d4e", ".tmp")).write_text("{", encoding="utf-8")

    detected = detect_interrupted(plans, dumps)

    assert isinstance(detected, InterruptedRun)
    assert detected.path == older


def test_reports_the_newest_plan_first_even_when_unreadable(
    plans: Path, dumps: Path, folder_with_audio: Path
) -> None:
    save_plan(plans, plan_of(folder_with_audio, _decided(1, 1), run_id="9e8f7a", started_at=OLDER))
    newest = plans / stamped_name(CREATED, RUN_ID, ".json")
    newest.write_text("{not json", encoding="utf-8")

    detected = detect_interrupted(plans, dumps)

    assert isinstance(detected, UnreadablePlan)
    assert detected.path == newest


def test_ignores_the_plan_of_the_run_still_open(
    plans: Path, dumps: Path, folder_with_audio: Path
) -> None:
    save_plan(plans, plan_of(folder_with_audio, _decided(1, 1)))
    older = save_plan(
        plans, plan_of(folder_with_audio, _decided(1, 1), run_id="9e8f7a", started_at=OLDER)
    )

    detected = detect_interrupted(plans, dumps, active_run_id=RUN_ID)

    assert isinstance(detected, InterruptedRun)
    assert detected.path == older


def test_finds_nothing_when_the_only_plan_is_the_run_still_open(
    plans: Path, dumps: Path, folder_with_audio: Path
) -> None:
    save_plan(plans, plan_of(folder_with_audio, _decided(1, 1)))

    detected = detect_interrupted(plans, dumps, active_run_id=RUN_ID)

    assert detected is None


def test_finds_a_plan_by_its_run(plans: Path, music_folder: Path) -> None:
    path = save_plan(plans, plan_of(music_folder, _decided(1, 1)))

    found = find_plan(plans, RUN_ID)

    assert found == path


def test_finds_no_plan_for_an_unknown_run(plans: Path, music_folder: Path) -> None:
    save_plan(plans, plan_of(music_folder, _decided(1, 1)))

    found = find_plan(plans, "000000")

    assert found is None
```

- [ ] **Step 2: Lancer les tests, ils échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_resume.py --no-cov -q`
Expected: FAIL, `ModuleNotFoundError: No module named 'tagger.resume'`

- [ ] **Step 3: Lister les plans dans `plan.py`**

Dans `sidecar/src/tagger/plan.py` :

```diff
@@ from tagger.run_files import (
     RETENTION,
     created_at_of,
+    newest_first,
     read_versioned,
     stamped_name,
```

```diff
@@ def plan_path(folder: Path, plan: RunPlan) -> Path:
 
 
+def plans_newest_first(folder: Path) -> list[Path]:
+    """Plans du dossier du plus recent au plus ancien ; temporaires et noms etrangers ecartes."""
+    return newest_first(folder, _SUFFIX)
+
+
 def load_plan(path: Path) -> RunPlan:
     """Relit un plan ; une version inconnue est refusee, jamais migree."""
```

- [ ] **Step 4: Écrire la détection**

`sidecar/src/tagger/resume.py` :

```python
"""Reprise d'un run interrompu (use-case 6) : detection au lancement et designation du plan.

Hors protocole NDJSON : le sub-project 04 en fait des commandes.
"""

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

from tagger.files import TaggingFolderUnreadableError, list_audio_files
from tagger.plan import RunPlanUnreadableError, discard_plan, load_plan, plans_newest_first
from tagger.run_files import created_at_of, run_id_of
from tagger.tag_dump import find_dump

if TYPE_CHECKING:
    from datetime import datetime
    from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class InterruptedRun:
    """Run a proposer a la reprise, resume tire du plan."""

    path: Path
    run_id: str
    started_at: datetime
    folder: Path
    processed: int
    total: int
    # Disque debranche, dossier deplace ou vide : seule l'option de repartir de zero reste.
    folder_missing: bool


@dataclass(frozen=True, slots=True)
class UnreadablePlan:
    """Plan illisible ou d'une autre version : jamais repris, son erreur dit pourquoi (ADR-018)."""

    path: Path
    run_id: str
    started_at: datetime
    error: RunPlanUnreadableError


type DetectedPlan = InterruptedRun | UnreadablePlan


def detect_interrupted(
    plans: Path, dumps: Path, *, active_run_id: str | None = None
) -> DetectedPlan | None:
    """Le plan le plus recent a proposer ; un plus ancien attend le lancement suivant.

    `active_run_id` : le run ouvert dans la session n'est pas interrompu, son plan est ignore.

    Un plan dont le run a un dump a vu des fichiers bouger : la reprise affirmerait qu'aucun
    n'a ete touche. Il est traite comme termine, la restauration des Reglages couvre le cas.
    """
    for path, started_at in _stamped(plans):
        if run_id_of(path) == active_run_id:
            continue
        try:
            plan = load_plan(path)
        except RunPlanUnreadableError as error:
            return UnreadablePlan(path, run_id_of(path), started_at, error)
        if plan.committed:
            continue
        if find_dump(dumps, plan.run_id) is not None:
            logger.warning("run plan dropped run=%s reason=files_written", plan.run_id)
            discard_plan(path)
            continue
        return InterruptedRun(
            path=path,
            run_id=plan.run_id,
            started_at=plan.started_at,
            folder=plan.folder,
            processed=plan.processed_count(),
            total=len(plan.tracks),
            folder_missing=_folder_missing(plan.folder),
        )
    return None


def find_plan(plans: Path, run_id: str) -> Path | None:
    """Plan d'un run ; compare, jamais glob : un `*` designerait tout."""
    return next((path for path in plans_newest_first(plans) if run_id_of(path) == run_id), None)


def _stamped(plans: Path) -> list[tuple[Path, datetime]]:
    """Plans du plus recent au plus ancien, avec la date lue sur leur nom."""
    return [
        (path, created)
        for path in plans_newest_first(plans)
        if (created := created_at_of(path)) is not None
    ]


def _folder_missing(folder: Path) -> bool:
    """Un dossier vide vaut un dossier introuvable : `reopen_run` n'aurait rien a rouvrir."""
    try:
        return not list_audio_files(folder)
    except TaggingFolderUnreadableError:
        return True
```

- [ ] **Step 5: Lancer les tests, ils passent**

Run: `cd sidecar && uv run pytest tests/unit/test_resume.py --no-cov -q`
Expected: PASS

- [ ] **Step 6: Mettre à jour `docs/ARCHITECTURE.md`**

Arborescence (vers la ligne 138) : ajouter, après la ligne `plan.py`, la ligne `resume.py` avec le commentaire `# détection d'un run interrompu, reconstruction depuis son plan`, sur le même alignement que ses voisines. `plan.py` prend alors le préfixe `├──` et `resume.py` le préfixe `└──`. Relire les numéros de ligne avant d'éditer (ceux-ci sont ceux du 2026-10-12).

- [ ] **Step 7: Gate et commit**

Run: `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar`
Expected: tout vert

```bash
git add sidecar/src/tagger/resume.py sidecar/src/tagger/plan.py sidecar/tests/unit/test_resume.py docs/ARCHITECTURE.md
git commit -m "feat(plan): detection d'un run interrompu et designation de son plan"
```

---

### Task 4: Reconstruction d'un run depuis son plan

**Files:**
- Modify: `sidecar/src/tagger/resume.py` (ajout de `reopen_run`)
- Modify: `sidecar/tests/helpers/tagging_api.py` (ajout de `run_sources`)
- Test: `sidecar/tests/unit/test_resume.py`

**Interfaces:**
- Consumes :
  - `PlanTrack.applied_to`, `PlanTrack.processed` (Task 1 et sub-project 01) ;
  - `tagging.read_identities`, `resolve_run` sélectif, `TrackRecord.decided`, `RunSources.artwork` (Task 2) ;
  - `run_plans.music`, `plan_of`, `RUN_ID` (sub-project 01) ;
  - `tagging.LiveRun`, `RunStarted`, `TrackResolved`, `ArbitrationRequired`, `RunProgress`, `RunEvent` ;
  - `files.list_audio_files`, `TaggingFolderUnreadableError`.
- Produces :
  - `resume.reopen_run(plan: RunPlan, sources: RunSources, *, on_event: Callable[[RunEvent], None]) -> LiveRun` (async), que le sub-project 04 appelle avant `resolve_run` ; lève `TaggingFolderUnreadableError` quand le dossier est introuvable ou ne contient aucun fichier audio ;
  - le helper `tagging_api.run_sources(folder: Path, api: FakeApi, run_id: str, *, cdn: FakeCdn | None = None) -> AsyncContextManager[RunSources]`.

- [ ] **Step 1: Ajouter le helper `run_sources`**

Dans `sidecar/tests/helpers/tagging_api.py` :

Ajouter à la fin du fichier :

```python
@asynccontextmanager
async def run_sources(
    folder: Path, api: FakeApi, run_id: str, *, cdn: FakeCdn | None = None
) -> AsyncGenerator[RunSources]:
    """Sources d'un run deja ouvert ailleurs (reprise) : rien n'est relu, rien n'est emis."""
    async with _wired(folder, api.gated_handler, cdn) as (client, artworks):
        yield RunSources(run_id, client, artworks, DEFAULT_THRESHOLDS)
```

- [ ] **Step 2: Écrire les tests de reconstruction**

Dans `sidecar/tests/unit/test_resume.py`, modifier les imports comme suit, puis ajouter les tests à la fin du fichier :

```diff
@@
 
 import json
+from dataclasses import replace
 from datetime import timedelta
 from pathlib import Path
-from typing import Final
+from typing import TYPE_CHECKING, Final
 
 import pytest
-from run_plans import RUN_ID, plan_of, save_plan
-from tagging_api import CREATED
-from tagging_records import RECORD
-
-from tagger.resume import InterruptedRun, UnreadablePlan, detect_interrupted, find_plan
+from run_plans import RUN_ID, music, plan_of, save_plan
+from scraper_responses import payload_candidate
+from tagging_api import CREATED, FakeApi, FakeCdn, run_sources, tagged_mp3
+from tagging_records import RECORD, scored_candidate
+
+from tagger.arbitration import Arbitration
+from tagger.files import TaggingFolderUnreadableError
+from tagger.matching import TrackQuery, build_query
+from tagger.resume import (
+    InterruptedRun,
+    UnreadablePlan,
+    detect_interrupted,
+    find_plan,
+    reopen_run,
+)
 from tagger.run_files import stamped_name
-from tagger.tagging import FailureReason, TrackRecord
+from tagger.scraper_client import Source
+from tagger.tagging import (
+    ArbitrationRequired,
+    FailureReason,
+    PendingArbitration,
+    Resolution,
+    RunProgress,
+    RunStarted,
+    SourceList,
+    TrackRecord,
+    TrackResolved,
+    TrackState,
+    resolve_run,
+)
+
+if TYPE_CHECKING:
+    from tagger.scraper_client import TrackCandidate
+    from tagger.tagging import RunEvent
 
 OLDER: Final = CREATED - timedelta(days=2)
```

Ajouter à la fin du fichier :

```python
def _query(record: TrackRecord) -> TrackQuery:
    query = build_query(record.identity.artist, record.identity.title, record.path.name)
    assert query is not None
    return query


def _auto(record: TrackRecord) -> TrackRecord:
    candidate = payload_candidate()
    return replace(record, query=_query(record)).resolved(
        Resolution.AUTO, Source.BEATPORT, candidate, scored_candidate(candidate=candidate), None
    )


def _held(record: TrackRecord) -> TrackRecord:
    return replace(
        record,
        query=_query(record),
        arbitration=PendingArbitration(
            Source.BEATPORT,
            (scored_candidate(),),
            beatport_unavailable=False,
            other=SourceList(Source.BANDCAMP, (scored_candidate(artist=81.0, title=77.0),)),
        ),
    )


def _refused(record: TrackRecord) -> TrackRecord:
    return replace(record, query=_query(record)).unresolved(FailureReason.USER_REFUSED)


def _silent(record: TrackRecord) -> TrackRecord:
    return replace(record, query=_query(record)).unresolved(FailureReason.SOURCE_UNAVAILABLE)


def _nothing(_event: RunEvent) -> None:
    """Rappel d'un test qui n'observe pas les evenements."""


@pytest.mark.asyncio
async def test_gives_back_the_decisions_of_the_plan(music_folder: Path) -> None:
    auto, held = music(music_folder, 2)
    nested = tagged_mp3(music_folder / "sub", "b.mp3", "Amelie Lens", "Basiel")
    refused = TrackRecord(track_id="sub/b.mp3", path=nested, identity=RECORD.identity)
    plan = plan_of(music_folder, [_auto(auto), _held(held), _refused(refused)])

    async with run_sources(music_folder, FakeApi(), RUN_ID) as sources:
        live = await reopen_run(plan, sources, on_event=_nothing)

    reopened = {record.track_id: record for record in live.snapshot().tracks}
    assert reopened["t000.mp3"].resolution is Resolution.AUTO
    pending = reopened["t001.mp3"].arbitration
    assert pending is not None
    assert pending.other is not None
    assert (pending.source, pending.other.source) == (Source.BEATPORT, Source.BANDCAMP)
    assert reopened["sub/b.mp3"].failure_reason is FailureReason.USER_REFUSED


@pytest.mark.asyncio
async def test_rebuilds_the_run_on_the_folder_as_it_is_now(
    music_folder: Path, caplog: pytest.LogCaptureFixture
) -> None:
    kept, gone = music(music_folder, 2)
    plan = plan_of(music_folder, [_refused(kept), _refused(gone)])
    gone.path.unlink()
    tagged_mp3(music_folder, "new.mp3", "Sara Landry", "The Void")

    async with run_sources(music_folder, FakeApi(), RUN_ID) as sources:
        live = await reopen_run(plan, sources, on_event=_nothing)

    reopened = {record.track_id: record for record in live.snapshot().tracks}
    assert set(reopened) == {"t000.mp3", "new.mp3"}
    assert reopened["new.mp3"].state is None
    assert "track dropped run=a3f9c1 track=2 reason=file_missing" in caplog.messages


@pytest.mark.asyncio
async def test_replays_the_events_of_a_live_run(music_folder: Path) -> None:
    auto, held, waiting = music(music_folder, 3)
    plan = plan_of(music_folder, [_auto(auto), _held(held), waiting])
    events: list[RunEvent] = []

    async with run_sources(music_folder, FakeApi(), RUN_ID) as sources:
        await reopen_run(plan, sources, on_event=events.append)

    assert [type(event) for event in events] == [
        RunStarted,
        TrackResolved,
        ArbitrationRequired,
        RunProgress,
    ]
    assert events[-1] == RunProgress(2, 3)


@pytest.mark.asyncio
async def test_announces_the_run_before_downloading_the_artworks(
    music_folder: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (auto,) = music(music_folder, 1)
    plan = plan_of(music_folder, [_auto(auto)])
    events: list[RunEvent] = []
    announced_at_download: list[int] = []

    async with run_sources(music_folder, FakeApi(), RUN_ID) as sources:

        async def spy(_position: int, _candidate: TrackCandidate) -> None:
            announced_at_download.append(len(events))

        monkeypatch.setattr(sources, "artwork", spy)

        await reopen_run(plan, sources, on_event=events.append)

    assert announced_at_download == [1]
    assert isinstance(events[0], RunStarted)


@pytest.mark.asyncio
async def test_downloads_again_the_artwork_of_a_resolved_track(music_folder: Path) -> None:
    (auto,) = music(music_folder, 1)
    plan = plan_of(music_folder, [_auto(auto)])

    async with run_sources(music_folder, FakeApi(), RUN_ID) as sources:
        live = await reopen_run(plan, sources, on_event=_nothing)

    reopened = live.record("t000.mp3")
    assert reopened is not None
    assert reopened.artwork is not None


@pytest.mark.asyncio
async def test_keeps_a_track_resolved_when_its_artwork_is_unavailable(
    music_folder: Path,
) -> None:
    (auto,) = music(music_folder, 1)
    plan = plan_of(music_folder, [_auto(auto)])
    cdn = FakeCdn()
    release = payload_candidate().release
    assert release is not None
    assert release.artwork_url is not None
    cdn.refused.add(release.artwork_url)

    async with run_sources(music_folder, FakeApi(), RUN_ID, cdn=cdn) as sources:
        live = await reopen_run(plan, sources, on_event=_nothing)

    reopened = live.record("t000.mp3")
    assert reopened is not None
    assert (reopened.state, reopened.artwork) == (TrackState.RESOLVED, None)


@pytest.mark.asyncio
@pytest.mark.parametrize("emptied", [True, False], ids=["emptied", "gone"])
async def test_refuses_to_reopen_a_folder_with_nothing_left_to_resume(
    music_folder: Path, tmp_path: Path, emptied: bool
) -> None:
    (gone,) = music(music_folder, 1)
    plan = plan_of(music_folder if emptied else tmp_path / "unplugged", [_refused(gone)])
    gone.path.unlink()
    events: list[RunEvent] = []

    async with run_sources(music_folder, FakeApi(), RUN_ID) as sources:
        with pytest.raises(TaggingFolderUnreadableError):
            await reopen_run(plan, sources, on_event=events.append)

    assert events == []


@pytest.mark.asyncio
async def test_leaves_a_track_whose_source_did_not_answer_to_the_network(
    music_folder: Path,
) -> None:
    refused, silent = music(music_folder, 2)
    plan = plan_of(music_folder, [_refused(refused), _silent(silent)])
    events: list[RunEvent] = []

    async with run_sources(music_folder, FakeApi(), RUN_ID) as sources:
        live = await reopen_run(plan, sources, on_event=events.append)

    reopened = live.record("t001.mp3")
    assert reopened is not None
    assert reopened.state is None
    assert events[-1] == RunProgress(1, 2)


@pytest.mark.asyncio
async def test_a_reopened_arbitration_can_still_be_decided(music_folder: Path) -> None:
    (held,) = music(music_folder, 1)
    plan = plan_of(music_folder, [_held(held)])

    async with run_sources(music_folder, FakeApi(), RUN_ID) as sources:
        live = await reopen_run(plan, sources, on_event=_nothing)
        desk = Arbitration(live, sources, lambda _event: None)

        await desk.choose("t000.mp3", Source.BEATPORT, 0)

    decided = live.record("t000.mp3")
    assert decided is not None
    assert (decided.state, decided.resolution) == (TrackState.RESOLVED, Resolution.ARBITRATION)


@pytest.mark.asyncio
async def test_resumes_a_run_left_at_62_out_of_100(music_folder: Path) -> None:
    records = music(music_folder, 100)
    decided = [_auto(records[0]), _held(records[1]), *map(_refused, records[2:62])]
    plan = plan_of(music_folder, [*decided, *records[62:]])
    api = FakeApi()
    events: list[RunEvent] = []

    async with run_sources(music_folder, api, RUN_ID) as sources:
        live = await reopen_run(plan, sources, on_event=events.append)
        await resolve_run(live, sources, on_event=events.append)

    searched = [
        request.url.params.get("q")
        for request in api.requests
        if request.url.path == "/beatport/search"
    ]
    assert sorted(searched) == sorted(_query(record).text for record in records[62:])
    progress = [event for event in events if isinstance(event, RunProgress)]
    assert (progress[0], progress[-1]) == (RunProgress(62, 100), RunProgress(100, 100))
    held = live.record("t001.mp3")
    assert held is not None
    assert held.arbitration is not None
    assert held.arbitration.other is not None
```

- [ ] **Step 3: Lancer les tests, ils échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_resume.py --no-cov -q`
Expected: FAIL, `ImportError: cannot import name 'reopen_run' from 'tagger.resume'`

- [ ] **Step 4: Écrire `reopen_run`**

Dans `sidecar/src/tagger/resume.py` :

```diff
@@
-"""Reprise d'un run interrompu (use-case 6) : detection au lancement et designation du plan.
-
-Hors protocole NDJSON : le sub-project 04 en fait des commandes.
+"""Reprise d'un run interrompu (use-case 6) : detection au lancement et reconstruction depuis
+son plan. Hors protocole NDJSON : les evenements sortent par un rappel.
 """
 
+import asyncio
 import logging
-from dataclasses import dataclass
+from dataclasses import dataclass, replace
 from typing import TYPE_CHECKING
```

```diff
@@ from tagger.plan import RunPlanUnreadableError, discard_plan, load_plan, plans_n
 from tagger.run_files import created_at_of, run_id_of
 from tagger.tag_dump import find_dump
+from tagger.tagging import (
+    ArbitrationRequired,
+    LiveRun,
+    RunProgress,
+    RunStarted,
+    TrackResolved,
+    TrackState,
+    read_identities,
+)
 
 if TYPE_CHECKING:
+    from collections.abc import Callable, Collection
     from datetime import datetime
     from pathlib import Path
 
+    from tagger.plan import RunPlan
+    from tagger.sources import RunSources
+    from tagger.tagging import RunEvent, TrackRecord
+
 logger = logging.getLogger(__name__)
```

```diff
@@ def find_plan(plans: Path, run_id: str) -> Path | None:
 
 
+async def reopen_run(
+    plan: RunPlan, sources: RunSources, *, on_event: Callable[[RunEvent], None]
+) -> LiveRun:
+    """Reconstruit le run quitte sur le dossier tel qu'il est, puis rejoue ses evenements.
+
+    Memes evenements qu'un run vivant : l'interface ne distingue pas une reprise. La phase
+    reseau qui suit (`resolve_run`) ne traite que les morceaux sans decision.
+    """
+    paths = await asyncio.to_thread(list_audio_files, plan.folder)
+    if not paths:
+        raise TaggingFolderUnreadableError(plan.folder)
+    reread = await read_identities(plan.run_id, plan.folder, paths)
+    _log_missing(plan, {record.track_id for record in reread})
+    records = [_decided_or_waiting(plan, record) for record in reread]
+
+    on_event(RunStarted(plan.run_id, plan.folder, tuple(records)))
+    records = await _with_artworks(records, sources)
+    for record in records:
+        if record.arbitration is not None:
+            on_event(ArbitrationRequired(record))
+        elif record.state is not None:
+            on_event(TrackResolved(record))
+    on_event(RunProgress(sum(record.decided for record in records), len(records)))
+    return LiveRun(plan.run_id, plan.folder, records)
+
+
 def _stamped(plans: Path) -> list[tuple[Path, datetime]]:
     """Plans du plus recent au plus ancien, avec la date lue sur leur nom."""
```

Ajouter à la fin du fichier :

```python
def _decided_or_waiting(plan: RunPlan, record: TrackRecord) -> TrackRecord:
    """Decision du plan posee sur le morceau ; fichier nouveau ou source muette : en attente."""
    track = plan.tracks.get(record.track_id)
    return record if track is None or not track.processed else track.applied_to(record)


def _log_missing(plan: RunPlan, on_disk: Collection[str]) -> None:
    """Fichier disparu depuis le plan : il sort du run, sa decision avec lui."""
    for position, track_id in enumerate(plan.tracks, start=1):
        if track_id not in on_disk:
            logger.warning(
                "track dropped run=%s track=%d reason=file_missing", plan.run_id, position
            )


async def _with_artworks(records: list[TrackRecord], sources: RunSources) -> list[TrackRecord]:
    """Pochettes des morceaux resolus, cache d'abord : le plan n'en garde aucune (ADR-013)."""
    async with asyncio.TaskGroup() as group:
        fetches = {
            record.track_id: group.create_task(
                sources.artwork(position, record.candidate), name=f"artwork:{position}"
            )
            for position, record in enumerate(records, start=1)
            if record.state is TrackState.RESOLVED and record.candidate is not None
        }
    return [
        replace(record, artwork=fetches[record.track_id].result())
        if record.track_id in fetches
        else record
        for record in records
    ]
```

- [ ] **Step 5: Lancer les tests, ils passent**

Run: `cd sidecar && uv run pytest tests/unit/test_resume.py tests/unit/test_plan.py tests/unit/test_tagging_run.py --no-cov -q`
Expected: PASS

- [ ] **Step 6: Gate et commit**

Run: `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar`
Expected: tout vert, couverture du sidecar au-dessus du seuil

```bash
git add sidecar/src/tagger/resume.py sidecar/tests/helpers/tagging_api.py sidecar/tests/unit/test_resume.py
git commit -m "feat(plan): reconstruire un run interrompu depuis son plan et rejouer ses evenements"
```
