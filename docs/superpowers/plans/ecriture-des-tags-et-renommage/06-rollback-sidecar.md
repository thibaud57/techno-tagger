# Rollback côté sidecar : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restaurer depuis le dump disque les tags et le nom d'origine d'un morceau ou d'un run entier, y compris d'un run écrit dans une session précédente.

**Architecture:** `tag_dump.py` gagne la recherche d'un dump par run, l'ordre des dumps et le retrait des entrées restaurées ; `renaming.py` sait rendre un nom d'origine. Un module `rollback.py`, hors protocole comme `writing.py`, restaure chaque morceau en sens inverse de l'écriture (nom, puis tags), du dernier écrit au premier, et décrit le dernier run annulable. `protocol.py`, `handlers.py` et `__main__.py` exposent `get_rollback_target` et `rollback`, qui occupe le même créneau de fichiers que l'écriture.

**Tech Stack:** Python 3.14 (`asyncio.TaskGroup`, `asyncio.to_thread`), pydantic 2, mutagen 1.48 par `restore_tags`, pytest-asyncio et `ndjson_loop.conversation`, TypeScript pour le miroir. Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/ecriture-des-tags-et-renommage/06-rollback-sidecar-design.md`

## Global Constraints

- **Dépend des sub-projects 02, 03, 04 et 05, implémentés avant** : `tag_dump` (`TagDump`, `DumpEntry.renamed_path`, `save_entries`, `load_dump`, `dump_path`, `dump_dir`, `_write`, `TagDumpUnreadableError`, `TagDumpWriteError`), `files.restore_tags` et `TagsWriteError.reason`, `renaming` (`RenameError.reason`, `_taken_by_another_file`, `extended_path`), `TrackState.WRITTEN` / `WRITE_ERROR`, `RunWriter.retry`, `_Session._write`, `_writable`, `WriteInProgressError` ; côté tests, `ndjson_loop.resolved_run` et `held_call`.
- **Ordre d'un morceau** : nom d'origine, puis tags d'origine. Nom pris par un autre fichier : échec `name_taken`, rien touché.
- **Ordre d'un run** : morceaux restaurés dans l'ordre inverse de l'écriture, l'ancien nom d'un morceau pouvant être le nom final d'un morceau écrit après.
- **Dump consommé** : entrées restaurées retirées en une réécriture finale, avec celles dont le fichier n'existe plus sous aucun nom tant que le dossier de leur chemin d'origine existe (`file_missing` : rien à leur rendre plus tard ; dossier introuvable, disque débranché par exemple : entrée gardée). Les autres entrées en échec sont gardées, le fichier est supprimé quand il est vide. Échec de cette réécriture : warning, jamais une erreur.
- **Créneau unique** : `rollback` refusé en `tagging_in_progress` (phase réseau), `write_in_progress` (écriture), `extraction_in_progress` (extraction), `rollback_in_progress` (rollback) ; `commit_run`, `retry_write`, `start_tagging` et `extract_playlist` refusés en `rollback_in_progress` pendant un rollback (refus mutuel de l'extraction et du rollback : choix du propriétaire en cours d'exécution, testé dans `test_ndjson_phases.py`). Ni `cancel_run`, ni `shutdown`, ni l'EOF ne le coupent.
- **Logs** : clés du jeu fixe de `gestion-erreurs.md` seulement (`run`, `reason`), jamais un nom de fichier, un compteur ni un titre.
- **Code Python sans accents**, docstrings et commentaires en français, le pourquoi seulement.
- **Tests** : noms en anglais, AAA séparé par des lignes vides, `@pytest.mark.asyncio` posé test par test dans un fichier qui mêle tests synchrones et asynchrones (mode `strict`, `filterwarnings=error`).
- **Gate vert à chaque commit** : `just format-sidecar`, `just lint-sidecar`, `just typecheck-sidecar`, `just test-sidecar`, plus `just lint-ui`, `just typecheck-ui` et `just test-ui` quand `public/i18n` ou `protocol.ts` changent. Commits `type(scope): description`, scope `sidecar` ou `ui`.

## Review Focus

- **Ancien run restauré pendant qu'un run plus récent du même dossier est affiché** : les `track_id` coïncident, mais aucun morceau affiché ne passe en `rolled_back` ; le fichier porte déjà son nom conforme, sans quoi le renommage séparerait les `track_id` et le test ne prouverait rien (Task 3, `test_leaves_the_displayed_run_alone_when_rolling_back_an_older_one`).
- **Ancien nom devenu le nom final d'un morceau écrit après** : restauré à l'envers, aucun `name_taken` (Task 2, `test_gives_names_back_in_the_reverse_order_of_the_writing`).
- **Fichier disparu sous ses deux noms** : il sort du dump, la cible du bouton ne vise pas un run irrestaurable (Task 2, `test_forgets_restored_and_vanished_tracks_and_keeps_the_others`).
- **Dernier run restauré en entier** : la cible passe au précédent (Task 2, `test_targets_the_previous_run_once_the_newest_is_restored`).
- **Ligne restaurée** : elle retombe sur le fichier, sans source ni `after` (Task 3, `test_marks_a_restored_track_that_retry_leaves_alone`).
- **`run_id` reçu qui contient un caractère de glob (`*`)** : il ne désigne aucun dump (Task 1, `test_finds_no_dump_for_an_unknown_run`, cas `*`).
- **Nom d'origine qui ne diffère que par la casse** : `Path` compare sans la casse sous Windows, le renommage doit quand même avoir lieu (Task 1, `test_gives_back_a_name_that_differs_only_by_case`).
- **Rollback interrompu par la fermeture de l'application** : le suivant retrouve le fichier sous son nom d'origine et termine (Task 2, `test_restores_a_file_already_back_under_its_name`).
- **Dump le plus récent illisible** : la cible passe au suivant au lieu de bloquer le bouton (Task 2, `test_skips_an_unreadable_dump`).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `sidecar/src/tagger/tag_dump.py` | `find_dump`, `dumps_newest_first`, `remove_entries`. |
| `sidecar/src/tagger/renaming.py` | `restore_name`, `OriginalNameTakenError`. |
| `sidecar/src/tagger/rollback.py` | Restauration d'un morceau et d'un run, dernier run annulable, `RollbackUnavailableError`. |
| `sidecar/src/tagger/tagging.py` | `FailureReason.NAME_TAKEN`, `TrackState.ROLLED_BACK`, `TrackRecord.rolled_back` (vide le candidat). |
| `sidecar/src/tagger/protocol.py` | `GetRollbackTarget`, `Rollback`, `RollbackTarget`, `RollbackFinished` et leurs payloads. |
| `sidecar/src/tagger/handlers.py` | `handle_get_rollback_target`, `handle_rollback`. |
| `sidecar/src/tagger/__main__.py` | Rollback en tâche de fond, gardes, `RollbackInProgressError`, dispatch. |
| `sidecar/tests/unit/test_tag_dump.py`, `test_renaming.py` | Primitives. |
| `sidecar/tests/unit/test_rollback.py` | Restauration et cible. |
| `sidecar/tests/integration/test_ndjson_rollback.py` | Conversations de rollback et refus. |
| `src/app/core/models/protocol.ts` | Miroir du contrat. |
| `public/i18n/{fr,en}.json` | Trois codes d'erreur, un motif. |
| `docs/ARCHITECTURE.md` | § API, § Concurrence, § Données, états et filtres du morceau, arborescence, ordre de développement. |

---

### Task 1: Retrouver un dump, le consommer, rendre un nom d'origine

**Files:**
- Modify: `sidecar/src/tagger/tag_dump.py` (après `dump_path`, après `record_renamed_path`, à côté de `_created_at`)
- Modify: `sidecar/src/tagger/renaming.py` (après `RenameError`, après `rename_track`)
- Modify: `sidecar/tests/unit/test_tag_dump.py`
- Modify: `sidecar/tests/unit/test_renaming.py`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json` (`errors`)

**Interfaces:**
- Consumes: `tag_dump.TagDump`, `DumpEntry`, `dump_path(folder, dump)`, `save_entries`, `load_dump`, `_write`, `_SUFFIX`, `TagDumpWriteError` ; `renaming.RenameError(path, reason)`, `_taken_by_another_file(target, path)`, `paths.extended_path`, `file_failures.file_failure_reason`.
- Produces: `tag_dump.find_dump(folder: Path, run_id: str) -> Path | None`, `tag_dump.dumps_newest_first(folder: Path) -> list[Path]`, `tag_dump.remove_entries(folder: Path, dump: TagDump, track_ids: Collection[str]) -> TagDump` ; `renaming.restore_name(current: Path, original: Path) -> None`, `renaming.OriginalNameTakenError(path)` (code `original_name_taken`).

- [ ] **Step 1: Écrire les tests du dump**

Dans `sidecar/tests/unit/test_tag_dump.py`, passer l'import de `datetime` à `from datetime import UTC, datetime, timedelta`, ajouter `dumps_newest_first`, `find_dump` et `remove_entries` à l'import de `tagger.tag_dump`, puis en fin de fichier :

```python
def test_finds_the_dump_of_a_run(tmp_path: Path) -> None:
    saved = save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3")})
    save_entries(tmp_path, TagDump(run_id="b7e2d4", created_at=CREATED), {"a.mp3": _entry("a.mp3")})

    found = find_dump(tmp_path, "a3f9c1")

    assert found == dump_path(tmp_path, saved)


@pytest.mark.parametrize("run_id", ["000000", "*"], ids=["unknown-run", "glob-pattern"])
def test_finds_no_dump_for_an_unknown_run(tmp_path: Path, run_id: str) -> None:
    save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3")})

    found = find_dump(tmp_path, run_id)

    assert found is None


def test_lists_dumps_from_newest_to_oldest(tmp_path: Path) -> None:
    older = save_entries(
        tmp_path,
        TagDump(run_id="b7e2d4", created_at=CREATED - timedelta(days=1)),
        {"a.mp3": _entry("a.mp3")},
    )
    newer = save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3")})

    listed = dumps_newest_first(tmp_path)

    assert listed == [dump_path(tmp_path, newer), dump_path(tmp_path, older)]


def test_lists_only_the_files_named_like_a_dump(tmp_path: Path) -> None:
    saved = save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3")})
    (tmp_path / "notes.json").write_text("{}", encoding="utf-8")

    listed = dumps_newest_first(tmp_path)

    assert listed == [dump_path(tmp_path, saved)]


def test_lists_no_dump_in_a_missing_folder(tmp_path: Path) -> None:
    listed = dumps_newest_first(tmp_path / "absent")

    assert listed == []


def test_removes_restored_entries_and_keeps_the_others(tmp_path: Path) -> None:
    saved = save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3"), "b.mp3": _entry("b.mp3")})

    updated = remove_entries(tmp_path, saved, {"a.mp3"})

    assert list(updated.entries) == ["b.mp3"]
    assert load_dump(dump_path(tmp_path, saved)) == updated


def test_deletes_a_dump_left_empty(tmp_path: Path) -> None:
    saved = save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3")})

    remove_entries(tmp_path, saved, {"a.mp3"})

    assert not dump_path(tmp_path, saved).exists()
```

- [ ] **Step 2: Écrire les tests du nom rendu**

Dans `sidecar/tests/unit/test_renaming.py`, ajouter `OriginalNameTakenError` et `restore_name` à l'import de `tagger.renaming`, la constante `ORIGINAL = "01 - untitled.mp3"` après `TARGET`, puis en fin de fichier :

```python
def test_gives_the_file_back_its_original_name(tmp_path: Path) -> None:
    current = _file(tmp_path, TARGET)

    restore_name(current, tmp_path / ORIGINAL)

    assert [entry.name for entry in tmp_path.iterdir()] == [ORIGINAL]


def test_gives_back_a_name_that_differs_only_by_case(tmp_path: Path) -> None:
    current = _file(tmp_path, "Adam Beyer - Your Mind.mp3")

    restore_name(current, tmp_path / "adam beyer - your mind.mp3")

    assert [entry.name for entry in tmp_path.iterdir()] == ["adam beyer - your mind.mp3"]


def test_refuses_an_original_name_taken_by_another_file(tmp_path: Path) -> None:
    current = _file(tmp_path, TARGET)
    _file(tmp_path, ORIGINAL, b"newcomer")

    with pytest.raises(OriginalNameTakenError) as error:
        restore_name(current, tmp_path / ORIGINAL)

    assert error.value.params == {"file": ORIGINAL}
    assert current.read_bytes() == b"audio"
    assert (tmp_path / ORIGINAL).read_bytes() == b"newcomer"
```

- [ ] **Step 3: Vérifier qu'ils échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_tag_dump.py tests/unit/test_renaming.py --no-cov -q`
Expected: FAIL à la collecte, `ImportError: cannot import name 'dumps_newest_first'` puis `'OriginalNameTakenError'`

- [ ] **Step 4: Retrouver et consommer un dump**

Dans `sidecar/src/tagger/tag_dump.py`, ajouter `Collection` à l'import sous `TYPE_CHECKING` (`from collections.abc import Collection, Mapping`), puis après `dump_path` :

```python
def find_dump(folder: Path, run_id: str) -> Path | None:
    """Dump d'un run, `None` s'il n'existe pas ; compare, jamais glob : un `*` designerait tout."""
    return next((path for path in dumps_newest_first(folder) if _run_id_of(path) == run_id), None)


def dumps_newest_first(folder: Path) -> list[Path]:
    """Dumps du plus recent au plus ancien ; l'horodatage ouvre le nom, tout autre est ecarte."""
    if not folder.is_dir():
        return []
    named_like_a_dump = (
        path for path in folder.glob(f"*{_SUFFIX}") if _created_at(path) is not None
    )
    return sorted(named_like_a_dump, reverse=True)
```

Après `record_renamed_path` :

```python
def remove_entries(folder: Path, dump: TagDump, track_ids: Collection[str]) -> TagDump:
    """Retire les morceaux restaures ; un dump vide est supprime, plus rien n'y est a annuler."""
    kept = {key: entry for key, entry in dump.entries.items() if key not in track_ids}
    updated = dump.model_copy(update={"entries": kept})
    path = dump_path(folder, updated)
    if kept:
        _write(path, updated)
        return updated
    try:
        path.unlink(missing_ok=True)
    except OSError as exc:
        raise TagDumpWriteError(path) from exc
    return updated
```

À côté de `_created_at` :

```python
def _run_id_of(path: Path) -> str:
    _, _, run_id = path.stem.partition("-")
    return run_id
```

- [ ] **Step 5: Rendre un nom d'origine**

Dans `sidecar/src/tagger/renaming.py`, après `RenameError` :

```python
class OriginalNameTakenError(TaggerError):
    """Un autre fichier porte le nom d'origine : le rendre l'ecraserait."""

    code: ClassVar[str] = "original_name_taken"

    def __init__(self, path: Path) -> None:
        super().__init__(f"original name taken: {path.name}", file=path.name)
```

Après `rename_track` :

```python
def restore_name(current: Path, original: Path) -> None:
    """Rend au fichier son nom d'origine, refuse s'il est porte par un autre fichier.

    Jamais un nom approchant : les logiciels DJ retrouvent un fichier par son chemin exact.
    """
    # Chaines comparees : `Path` ignore la casse sous Windows, un changement de casse seule
    # passerait pour un nom deja rendu.
    if str(current) == str(original):
        return
    if _taken_by_another_file(original, current):
        raise OriginalNameTakenError(original)
    try:
        extended_path(current).rename(extended_path(original))
    except OSError as error:
        raise RenameError(current, file_failure_reason(error)) from error
```

- [ ] **Step 6: Traduire le code**

Dans `errors`, juste après `file_rename_failed` :

`public/i18n/fr.json` :

```json
    "original_name_taken": "Le nom {{file}} est déjà porté par un autre fichier.",
```

`public/i18n/en.json` :

```json
    "original_name_taken": "The name {{file}} is already used by another file.",
```

- [ ] **Step 7: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_tag_dump.py tests/unit/test_renaming.py tests/unit/test_error_translations.py --no-cov -q`
Expected: PASS

- [ ] **Step 8: Lancer le gate**

Run: `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar && just lint-ui`
Expected: tout passe.

- [ ] **Step 9: Commit**

```bash
git add sidecar/src/tagger/tag_dump.py sidecar/src/tagger/renaming.py sidecar/tests/unit/test_tag_dump.py sidecar/tests/unit/test_renaming.py public/i18n/fr.json public/i18n/en.json
git commit -m "feat(sidecar): retrouver et consommer un dump, rendre un nom d'origine"
```

---

### Task 2: Restaurer un run ou un morceau depuis son dump

**Files:**
- Create: `sidecar/src/tagger/rollback.py`
- Modify: `sidecar/src/tagger/tagging.py` (`FailureReason`)
- Create: `sidecar/tests/unit/test_rollback.py`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json` (`errors`, `tagging.reason`)

**Interfaces:**
- Consumes: Task 1 (`find_dump`, `dumps_newest_first`, `remove_entries`, `restore_name`, `OriginalNameTakenError`) ; `tag_dump.load_dump`, `TagDumpUnreadableError`, `TagDumpWriteError`, `DumpEntry.original_tags()` ; `files.restore_tags(path, original)`, `TagsWriteError.reason` ; `renaming.RenameError.reason`.
- Produces: `tagging.FailureReason.NAME_TAKEN` ; `rollback.RollbackTarget(run_id: str, written_at: datetime, folder: Path, tracks: int)`, `rollback.RollbackFailure(track_id: str, file_name: str, reason: FailureReason)`, `rollback.RollbackSummary(run_id: str, restored: tuple[str, ...], failed: tuple[RollbackFailure, ...])`, `rollback.RollbackUnavailableError(run_id, track_id=None)` (code `rollback_unavailable`, `params` `{run_id, track_id}`), `rollback.find_rollback_target(folder: Path) -> RollbackTarget | None`, `async rollback.roll_back(folder: Path, run_id: str, track_id: str | None, on_restored: Callable[[str, Path], None]) -> RollbackSummary`. `roll_back` lève `TagDumpUnreadableError` sur un dump visé illisible.

- [ ] **Step 1: Écrire les tests**

Créer `sidecar/tests/unit/test_rollback.py` :

```python
"""Tests du rollback : nom d'origine puis tags d'origine, dump consomme, dernier run."""

from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import NamedTuple

import pytest
from scraper_responses import track_payload
from tagging_api import tagged_mp3

from tagger.files import OriginalTags, TagField, project_tags, read_original_tags, write_tags
from tagger.renaming import rename_track
from tagger.rollback import (
    RollbackFailure,
    RollbackTarget,
    RollbackUnavailableError,
    find_rollback_target,
    roll_back,
)
from tagger.scraper_client import TrackCandidate
from tagger.tag_dump import DumpEntry, TagDump, dump_path, load_dump, save_entries
from tagger.tagging import FailureReason

RUN = "a3f9c1"
WRITTEN_AT = datetime(2026, 10, 5, 21, 14, 3, tzinfo=UTC)
BEATPORT = TrackCandidate.model_validate(track_payload())
ORIGINAL = "01 - untitled.mp3"


class _Written(NamedTuple):
    """Morceau ecrit puis renomme comme par une phase d'ecriture, et son origine."""

    original: Path
    renamed: Path
    origin: OriginalTags
    entry: DumpEntry


def _write(folder: Path, name: str) -> _Written:
    path = tagged_mp3(folder, name, "adam beyer", "your mind")
    origin = read_original_tags(path)
    values = project_tags(BEATPORT)
    write_tags(path, values, None)
    renamed = rename_track(path, values.get(TagField.ARTIST), values.get(TagField.TITLE)).path
    entry = DumpEntry.of(path, origin).model_copy(update={"renamed_path": renamed})
    return _Written(path, renamed, origin, entry)


def _dumped(
    folder: Path, *tracks: _Written, run_id: str = RUN, written_at: datetime = WRITTEN_AT
) -> TagDump:
    entries = {track.original.name: track.entry for track in tracks}
    return save_entries(folder, TagDump(run_id=run_id, created_at=written_at), entries)


def _ignore(_track_id: str, _path: Path) -> None:
    """Le run restaure n'est pas celui qu'affiche l'interface."""


@pytest.mark.asyncio
async def test_gives_a_renamed_file_back_its_name_and_tags(tmp_path: Path) -> None:
    track = _write(tmp_path / "music", ORIGINAL)
    _dumped(tmp_path / "dumps", track)
    restored: list[tuple[str, Path]] = []

    summary = await roll_back(
        tmp_path / "dumps", RUN, None, lambda track_id, path: restored.append((track_id, path))
    )

    assert (summary.restored, summary.failed) == ((ORIGINAL,), ())
    assert restored == [(ORIGINAL, track.original)]
    assert not track.renamed.exists()
    assert read_original_tags(track.original) == track.origin


@pytest.mark.asyncio
async def test_leaves_a_track_whose_original_name_is_taken_untouched(tmp_path: Path) -> None:
    track = _write(tmp_path / "music", ORIGINAL)
    dump = _dumped(tmp_path / "dumps", track)
    track.original.write_bytes(b"newcomer")
    written = read_original_tags(track.renamed)

    summary = await roll_back(tmp_path / "dumps", RUN, None, _ignore)

    assert summary.failed == (
        RollbackFailure(ORIGINAL, track.renamed.name, FailureReason.NAME_TAKEN),
    )
    assert read_original_tags(track.renamed) == written
    assert track.original.read_bytes() == b"newcomer"
    assert load_dump(dump_path(tmp_path / "dumps", dump)).entries.keys() == {ORIGINAL}


@pytest.mark.asyncio
async def test_reports_a_file_gone_under_both_names(tmp_path: Path) -> None:
    track = _write(tmp_path / "music", ORIGINAL)
    _dumped(tmp_path / "dumps", track)
    track.renamed.unlink()

    summary = await roll_back(tmp_path / "dumps", RUN, None, _ignore)

    assert summary.failed == (
        RollbackFailure(ORIGINAL, track.renamed.name, FailureReason.FILE_MISSING),
    )


@pytest.mark.asyncio
async def test_leaves_the_tags_of_a_locked_file_untouched(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    track = _write(tmp_path / "music", ORIGINAL)
    _dumped(tmp_path / "dumps", track)
    written = read_original_tags(track.renamed)

    def held(_source: Path, _target: Path) -> Path:
        raise OSError(32, "The process cannot access the file", None, 32)

    monkeypatch.setattr(Path, "rename", held)

    summary = await roll_back(tmp_path / "dumps", RUN, None, _ignore)

    assert [failure.reason for failure in summary.failed] == [FailureReason.FILE_LOCKED]
    assert read_original_tags(track.renamed) == written


@pytest.mark.asyncio
async def test_restores_a_file_already_back_under_its_name(tmp_path: Path) -> None:
    track = _write(tmp_path / "music", ORIGINAL)
    _dumped(tmp_path / "dumps", track)
    track.renamed.rename(track.original)

    summary = await roll_back(tmp_path / "dumps", RUN, None, _ignore)

    assert summary.restored == (ORIGINAL,)
    assert read_original_tags(track.original) == track.origin


@pytest.mark.asyncio
async def test_gives_names_back_in_the_reverse_order_of_the_writing(tmp_path: Path) -> None:
    music = tmp_path / "music"
    first = _write(music, "a.mp3")
    # Le second morceau prend, une fois le premier renomme, le nom d'origine de celui-ci.
    second_original = tagged_mp3(music, "b.mp3", "adam beyer", "your mind")
    second_origin = read_original_tags(second_original)
    second_renamed = second_original.rename(first.original)
    second_entry = DumpEntry.of(second_original, second_origin).model_copy(
        update={"renamed_path": second_renamed}
    )
    _dumped(
        tmp_path / "dumps",
        first,
        _Written(second_original, second_renamed, second_origin, second_entry),
    )

    summary = await roll_back(tmp_path / "dumps", RUN, None, _ignore)

    assert summary.failed == ()
    assert summary.restored == ("b.mp3", "a.mp3")


@pytest.mark.asyncio
async def test_forgets_restored_and_vanished_tracks_and_keeps_the_others(tmp_path: Path) -> None:
    music = tmp_path / "music"
    restorable, vanished, taken = (_write(music, name) for name in ("a.mp3", "b.mp3", "c.mp3"))
    dump = _dumped(tmp_path / "dumps", restorable, vanished, taken)
    vanished.renamed.unlink()
    taken.original.write_bytes(b"newcomer")

    await roll_back(tmp_path / "dumps", RUN, None, _ignore)

    assert load_dump(dump_path(tmp_path / "dumps", dump)).entries.keys() == {"c.mp3"}


@pytest.mark.asyncio
async def test_deletes_the_dump_once_every_track_is_restored(tmp_path: Path) -> None:
    dump = _dumped(tmp_path / "dumps", _write(tmp_path / "music", ORIGINAL))

    await roll_back(tmp_path / "dumps", RUN, None, _ignore)

    assert not dump_path(tmp_path / "dumps", dump).exists()


@pytest.mark.asyncio
async def test_rolls_back_a_single_track_only(tmp_path: Path) -> None:
    music = tmp_path / "music"
    first, second = _write(music, "a.mp3"), _write(music, "b.mp3")
    dump = _dumped(tmp_path / "dumps", first, second)

    summary = await roll_back(tmp_path / "dumps", RUN, "a.mp3", _ignore)

    assert summary.restored == ("a.mp3",)
    assert second.renamed.is_file()
    assert load_dump(dump_path(tmp_path / "dumps", dump)).entries.keys() == {"b.mp3"}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("run_id", "track_id"),
    [("000000", None), (RUN, "absent.mp3")],
    ids=["run-without-dump", "track-absent-from-dump"],
)
async def test_refuses_what_the_dump_cannot_restore(
    tmp_path: Path, run_id: str, track_id: str | None
) -> None:
    _dumped(tmp_path / "dumps", _write(tmp_path / "music", ORIGINAL))

    with pytest.raises(RollbackUnavailableError) as error:
        await roll_back(tmp_path / "dumps", run_id, track_id, _ignore)

    assert error.value.params == {"run_id": run_id, "track_id": track_id}


def test_targets_the_newest_run_left_to_restore(tmp_path: Path) -> None:
    music = tmp_path / "music"
    _dumped(
        tmp_path / "dumps",
        _write(music, "a.mp3"),
        run_id="b7e2d4",
        written_at=WRITTEN_AT - timedelta(days=1),
    )
    _dumped(tmp_path / "dumps", _write(music, "b.mp3"), _write(music, "c.mp3"))

    target = find_rollback_target(tmp_path / "dumps")

    assert target == RollbackTarget(run_id=RUN, written_at=WRITTEN_AT, folder=music, tracks=2)


@pytest.mark.asyncio
async def test_targets_the_previous_run_once_the_newest_is_restored(tmp_path: Path) -> None:
    music = tmp_path / "music"
    _dumped(
        tmp_path / "dumps",
        _write(music, "a.mp3"),
        run_id="b7e2d4",
        written_at=WRITTEN_AT - timedelta(days=1),
    )
    _dumped(tmp_path / "dumps", _write(music, "b.mp3"))
    await roll_back(tmp_path / "dumps", RUN, None, _ignore)

    target = find_rollback_target(tmp_path / "dumps")

    assert target is not None
    assert target.run_id == "b7e2d4"


def test_skips_an_unreadable_dump(tmp_path: Path) -> None:
    _dumped(tmp_path / "dumps", _write(tmp_path / "music", ORIGINAL))
    (tmp_path / "dumps" / "20261006T080000Z-b7e2d4.json").write_text("{", encoding="utf-8")

    target = find_rollback_target(tmp_path / "dumps")

    assert target is not None
    assert target.run_id == RUN


def test_targets_nothing_without_a_dump(tmp_path: Path) -> None:
    target = find_rollback_target(tmp_path / "dumps")

    assert target is None
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_rollback.py --no-cov -q`
Expected: FAIL à la collecte, `ModuleNotFoundError: No module named 'tagger.rollback'`

- [ ] **Step 3: Ajouter le motif**

Dans `sidecar/src/tagger/tagging.py`, à la fin de `FailureReason` :

```python
    # Motif du rollback seul, hors `FileFailureReason` : l'ecriture suffixe un nom pris.
    NAME_TAKEN = auto()
```

- [ ] **Step 4: Écrire le module**

Créer `sidecar/src/tagger/rollback.py` :

```python
"""Rollback d'un run ou d'un morceau depuis son dump (ADR-010), hors protocole : rendu par rappel.

Nom d'origine puis tags, chaque etape rejouable : un fichier verrouille echoue au renommage,
avant que ses tags bougent. Pochettes et commentaires retires a l'ecriture ne reviennent pas.
"""

import asyncio
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, ClassVar

from tagger.errors import TaggerError
from tagger.files import TagsWriteError, restore_tags
from tagger.paths import extended_path
from tagger.renaming import OriginalNameTakenError, RenameError, restore_name
from tagger.tag_dump import (
    TagDumpUnreadableError,
    TagDumpWriteError,
    dumps_newest_first,
    find_dump,
    load_dump,
    remove_entries,
)
from tagger.tagging import FailureReason

if TYPE_CHECKING:
    from collections.abc import Callable, Sequence
    from datetime import datetime

    from tagger.file_failures import FileFailureReason
    from tagger.tag_dump import DumpEntry, TagDump

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class RollbackTarget:
    """Dernier run annulable, de quoi le nommer dans la confirmation."""

    run_id: str
    written_at: datetime
    folder: Path
    tracks: int


@dataclass(frozen=True, slots=True)
class RollbackFailure:
    """Morceau laisse en l'etat ; `file_name` est son nom actuel, celui que l'utilisateur voit."""

    track_id: str
    file_name: str
    reason: FailureReason


@dataclass(frozen=True, slots=True)
class RollbackSummary:
    """Bilan d'un rollback ; les morceaux en echec restent dans le dump, sauf `file_missing`."""

    run_id: str
    restored: tuple[str, ...]
    failed: tuple[RollbackFailure, ...]


class RollbackUnavailableError(TaggerError):
    """Rien a restaurer : dump purge ou jamais ecrit, morceau deja restaure ou jamais ecrit."""

    code: ClassVar[str] = "rollback_unavailable"

    def __init__(self, run_id: str, track_id: str | None = None) -> None:
        super().__init__("nothing to roll back", run_id=run_id, track_id=track_id)


def find_rollback_target(folder: Path) -> RollbackTarget | None:
    """Le plus recent dump qui a encore des morceaux ; un dump illisible est saute."""
    for path in dumps_newest_first(folder):
        try:
            dump = load_dump(path)
        except TagDumpUnreadableError:
            logger.warning("unreadable tag dump skipped")
            continue
        if dump.entries:
            return RollbackTarget(
                run_id=dump.run_id,
                written_at=dump.created_at,
                folder=_common_folder(dump),
                tracks=len(dump.entries),
            )
    return None


async def roll_back(
    folder: Path,
    run_id: str,
    track_id: str | None,
    on_restored: Callable[[str, Path], None],
) -> RollbackSummary:
    """Restaure un run ou son seul morceau ; `on_restored` rend chaque morceau et son chemin."""
    dump = await asyncio.to_thread(_load_run, folder, run_id)
    entries = _targets(dump, track_id)
    logger.info("rollback started run=%s", run_id)
    restored: list[str] = []
    failed: list[RollbackFailure] = []
    # Ordre inverse de l'ecriture : l'ancien nom d'un morceau peut etre le nom final d'un
    # morceau ecrit apres.
    for target_id, entry in reversed(list(entries.items())):
        failure = await asyncio.to_thread(_restore_one, target_id, entry)
        if failure is None:
            restored.append(target_id)
            on_restored(target_id, entry.path)
        else:
            logger.error("rollback failed run=%s reason=%s", run_id, failure.reason)
            failed.append(failure)
    await asyncio.to_thread(_forget, folder, dump, restored, failed)
    logger.info("rollback finished run=%s", run_id)
    return RollbackSummary(run_id, tuple(restored), tuple(failed))


def _load_run(folder: Path, run_id: str) -> TagDump:
    path = find_dump(folder, run_id)
    if path is None:
        raise RollbackUnavailableError(run_id)
    return load_dump(path)


def _targets(dump: TagDump, track_id: str | None) -> dict[str, DumpEntry]:
    if track_id is None:
        return dict(dump.entries)
    entry = dump.entries.get(track_id)
    if entry is None:
        raise RollbackUnavailableError(dump.run_id, track_id)
    return {track_id: entry}


def _restore_one(track_id: str, entry: DumpEntry) -> RollbackFailure | None:
    current = _located(entry)
    if current is None:
        missing = entry.renamed_path or entry.path
        return RollbackFailure(track_id, missing.name, FailureReason.FILE_MISSING)
    try:
        restore_name(current, entry.path)
    except OriginalNameTakenError:
        return RollbackFailure(track_id, current.name, FailureReason.NAME_TAKEN)
    except RenameError as error:
        return RollbackFailure(track_id, current.name, _reason(error.reason))
    try:
        restore_tags(entry.path, entry.original_tags())
    except TagsWriteError as error:
        return RollbackFailure(track_id, entry.path.name, _reason(error.reason))
    return None


def _located(entry: DumpEntry) -> Path | None:
    """Sous son nouveau nom, sinon sous l'ancien : rollback interrompu, renommage jamais fait."""
    for candidate in (entry.renamed_path, entry.path):
        if candidate is not None and extended_path(candidate).is_file():
            return candidate
    return None


def _forget(
    folder: Path,
    dump: TagDump,
    restored: Sequence[str],
    failed: Sequence[RollbackFailure],
) -> None:
    """Retire du dump les morceaux restaures et ceux dont le fichier a disparu : rien a leur rendre.

    Un `file_missing` dont le dossier d'origine a disparu reste dans le dump : un disque externe
    debranche ou une lettre changee ferait perdre pour toujours les tags d'origine. Un dump non
    reecrit ne perd rien : le prochain rollback rejoue les morceaux restaures.
    """
    gone = [
        failure.track_id
        for failure in failed
        if failure.reason is FailureReason.FILE_MISSING
        and extended_path(dump.entries[failure.track_id].path.parent).is_dir()
    ]
    forgotten = {*restored, *gone}
    if not forgotten:
        return
    try:
        remove_entries(folder, dump, forgotten)
    except TagDumpWriteError:
        logger.warning("tag dump not updated after rollback run=%s", dump.run_id)


def _common_folder(dump: TagDump) -> Path:
    """Deduit des fichiers plutot que stocke dans le dump : une valeur, une source."""
    return Path(os.path.commonpath([entry.path.parent for entry in dump.entries.values()]))


def _reason(reason: FileFailureReason) -> FailureReason:
    return FailureReason(reason.value)
```

- [ ] **Step 5: Traduire le code et le motif**

`public/i18n/fr.json` : dans `errors`, juste après `run_committed` :

```json
    "rollback_unavailable": "Rien à restaurer : les tags d'origine ont déjà été rendus, ou leur sauvegarde a expiré.",
```

dans `tagging.reason`, après `write_failed` :

```json
      "name_taken": "Un autre fichier porte déjà son nom d'origine. Renommez ou déplacez cet autre fichier, puis relancez la restauration."
```

`public/i18n/en.json` : mêmes emplacements :

```json
    "rollback_unavailable": "Nothing to restore: the original tags were already restored, or their backup has expired.",
```

```json
      "name_taken": "Another file already has its original name. Rename or move that file, then restore again."
```

La ligne `write_failed` qui précède prend une virgule.

- [ ] **Step 6: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_rollback.py tests/unit/test_file_failures.py tests/unit/test_error_translations.py --no-cov -q`
Expected: PASS (`test_track_failures_carry_every_file_failure_under_the_same_name` et le cas `track-failure` de `test_every_shown_reason_has_a_translation` compris)

- [ ] **Step 7: Lancer le gate**

Run: `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar && just lint-ui`
Expected: tout passe.

- [ ] **Step 8: Commit**

```bash
git add sidecar/src/tagger/rollback.py sidecar/src/tagger/tagging.py sidecar/tests/unit/test_rollback.py public/i18n/fr.json public/i18n/en.json
git commit -m "feat(sidecar): restaurer un run ou un morceau depuis son dump"
```

---

### Task 3: Rollback sur le protocole NDJSON

**Files:**
- Modify: `sidecar/src/tagger/tagging.py` (`TrackState`, `TrackRecord`)
- Modify: `sidecar/src/tagger/protocol.py` (après `RetryWrite`, unions, `CommandName`, après `RunFinished`)
- Modify: `sidecar/src/tagger/handlers.py`
- Modify: `sidecar/src/tagger/__main__.py`
- Create: `sidecar/tests/integration/test_ndjson_rollback.py`
- Modify: `src/app/core/models/protocol.ts`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json` (`errors`)

**Interfaces:**
- Consumes: Task 2 (`find_rollback_target`, `roll_back`, `RollbackFailure`, `RollbackUnavailableError`) ; `handlers._resolved(record)`, `CurrentRun.live`, `LiveRun.record(track_id)`, `LiveRun.update(record)`, `tag_dump.dump_dir()` ; `_Session._write`, `_active`, `_active_run`, `_phase`, `_writable`.
- Produces: `TrackState.ROLLED_BACK`, `TrackRecord.rolled_back(path: Path) -> TrackRecord` ; `protocol.GetRollbackTarget(command="get_rollback_target")`, `protocol.Rollback(command="rollback", run_id: str, track_id: str | None = None)`, `protocol.RollbackRun(run_id, written_at, folder, tracks)`, `protocol.RollbackTarget(event="rollback_target", run: RollbackRun | None)`, `protocol.RollbackFailurePayload(track_id, file_name, reason)`, `protocol.RollbackFinished(event="rollback_finished", run_id, track_id, restored, failed)` ; `handlers.handle_get_rollback_target() -> RollbackTarget`, `async handlers.handle_rollback(command: Rollback, live: LiveRun | None, emit: Callable[[Event], None]) -> RollbackFinished` ; `__main__.RollbackInProgressError` (code `rollback_in_progress`), `_Session.rollback(command)`. Côté TS : `GetRollbackTargetCommand`, `RollbackCommand`, `RollbackRun`, `RollbackTargetEvent`, `RollbackFailure`, `RollbackFinishedEvent`, `TrackState` à cinq valeurs, `TrackFailureReason` à douze.

- [ ] **Step 1: Écrire les tests d'intégration**

Créer `sidecar/tests/integration/test_ndjson_rollback.py` :

```python
"""Rollback d'un run sur la boucle NDJSON, dans la session qui l'a ecrit ou une suivante."""

from typing import TYPE_CHECKING

import pytest
from ndjson_loop import conversation, held_call, resolved_run
from scraper_responses import YOUR_MIND
from tagging_api import ONE_TRACK, ORIGINAL, FakeApi, found, one_track, tagged_mp3

from tagger import rollback, writing
from tagger.files import read_original_tags

if TYPE_CHECKING:
    from pathlib import Path

    from ndjson_loop import Conversation

pytestmark = [pytest.mark.asyncio, pytest.mark.usefixtures("_key")]

WRITTEN = "Adam Beyer - Your Mind (Original Mix).mp3"


@pytest.fixture
def folder(tmp_path: Path, app_data: None, api: FakeApi) -> Path:
    """« Your Mind » que Beatport resout d'office : un morceau a ecrire puis a restaurer."""
    api.on("/beatport/search", YOUR_MIND, found(ORIGINAL))
    return one_track(tmp_path)


async def _written_run(talk: Conversation, folder: Path) -> str:
    run_id = await resolved_run(talk, folder)
    talk.send(command="commit_run", run_id=run_id)
    await talk.expect("run_finished", phase="write")
    return run_id


async def test_rolls_back_a_run_written_in_a_previous_session(folder: Path) -> None:
    origin = read_original_tags(folder / ONE_TRACK)
    async with conversation() as talk:
        run_id = await _written_run(talk, folder)

    async with conversation() as talk:
        talk.send(command="get_rollback_target")
        target = await talk.expect("rollback_target")
        talk.send(command="rollback", run_id=run_id)
        finished = await talk.expect("rollback_finished")
        talk.send(command="get_rollback_target")
        emptied = await talk.expect("rollback_target")

    run = target["run"]
    assert isinstance(run, dict)
    assert (run["run_id"], run["folder"], run["tracks"]) == (run_id, str(folder), 1)
    assert (finished["restored"], finished["failed"]) == ([ONE_TRACK], [])
    assert emptied["run"] is None
    assert not (folder / WRITTEN).exists()
    assert read_original_tags(folder / ONE_TRACK) == origin


async def test_marks_a_restored_track_that_retry_leaves_alone(folder: Path) -> None:
    async with conversation() as talk:
        run_id = await _written_run(talk, folder)
        talk.send(command="rollback", run_id=run_id, track_id=ONE_TRACK)
        rolled_back = await talk.expect("track_resolved", state="rolled_back")
        finished = await talk.expect("rollback_finished")
        talk.send(command="retry_write", run_id=run_id)
        retried = await talk.expect("run_finished", phase="write")

    assert rolled_back["track_id"] == ONE_TRACK
    assert (rolled_back["after"], rolled_back["source"]) == (None, None)
    assert (finished["track_id"], finished["restored"]) == (ONE_TRACK, [ONE_TRACK])
    assert (retried["written"], retried["write_error"]) == (0, 0)
    assert (folder / ONE_TRACK).is_file()


async def test_leaves_the_displayed_run_alone_when_rolling_back_an_older_one(
    tmp_path: Path, app_data: None, api: FakeApi
) -> None:
    api.on("/beatport/search", YOUR_MIND, found(ORIGINAL))
    conform = tagged_mp3(tmp_path / "conform", WRITTEN, "Adam Beyer", "Your Mind").parent
    async with conversation() as talk:
        first = await _written_run(talk, conform)
        await resolved_run(talk, conform)
        talk.send(command="rollback", run_id=first)
        finished = await talk.expect("rollback_finished")

    assert finished["restored"] == [WRITTEN]
    assert not [event for event in talk.events if event.get("state") == "rolled_back"]


async def test_refuses_a_rollback_without_dump(app_data: None) -> None:
    async with conversation() as talk:
        talk.send(command="rollback", run_id="000000")
        error = await talk.expect("error")

    assert (error["code"], error["command"], error["params"]) == (
        "rollback_unavailable",
        "rollback",
        {"run_id": "000000", "track_id": None},
    )


async def test_refuses_a_rollback_while_writing(
    folder: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    held = held_call(monkeypatch, writing, "write_tags")

    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="commit_run", run_id=run_id)
        await held.wait_reached()
        talk.send(command="rollback", run_id=run_id)
        error = await talk.expect("error")
        held.release.set()
        await talk.expect("run_finished", phase="write")

    assert (error["code"], error["command"]) == ("write_in_progress", "rollback")


async def test_refuses_a_rollback_during_the_network_phase(folder: Path, api: FakeApi) -> None:
    gate = api.gate("/beatport/search", YOUR_MIND)

    async with conversation() as talk:
        talk.send(command="start_tagging", folder=str(folder))
        started = await talk.expect("run_started")
        await gate.reached.wait()
        talk.send(command="rollback", run_id=started["run_id"])
        error = await talk.expect("error")
        gate.release.set()
        await talk.expect("run_finished", phase="network")

    assert (error["code"], error["command"]) == ("tagging_in_progress", "rollback")


@pytest.mark.parametrize("command", ["rollback", "commit_run", "retry_write", "start_tagging"])
async def test_refuses_files_work_while_rolling_back(
    folder: Path, monkeypatch: pytest.MonkeyPatch, command: str
) -> None:
    held = held_call(monkeypatch, rollback, "restore_tags")

    async with conversation() as talk:
        run_id = await _written_run(talk, folder)
        talk.send(command="rollback", run_id=run_id)
        await held.wait_reached()
        if command == "start_tagging":
            talk.send(command=command, folder=str(folder))
        else:
            talk.send(command=command, run_id=run_id)
        error = await talk.expect("error")
        held.release.set()
        await talk.expect("rollback_finished")

    assert (error["code"], error["command"]) == ("rollback_in_progress", command)


async def test_shutdown_lets_a_rollback_finish(
    folder: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    held = held_call(monkeypatch, rollback, "restore_tags")

    async with conversation() as talk:
        run_id = await _written_run(talk, folder)
        talk.send(command="rollback", run_id=run_id)
        await held.wait_reached()
        talk.send(command="cancel_run")
        talk.send(command="shutdown")
        held.release.set()
        finished = await talk.expect("rollback_finished")

    assert finished["restored"] == [ONE_TRACK]
    assert (folder / ONE_TRACK).is_file()
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `cd sidecar && uv run pytest tests/integration/test_ndjson_rollback.py --no-cov -q -x`
Expected: FAIL en `TimeoutError` : `get_rollback_target`, inconnue, rend un `error` `malformed_command`, et `expect("rollback_target")` dépasse son délai

- [ ] **Step 3: État `rolled_back`**

Dans `sidecar/src/tagger/tagging.py`, `TrackState` devient :

```python
@verify(UNIQUE)
class TrackState(StrEnum):
    """Etat d'un morceau, apres la phase reseau, l'ecriture ou un rollback."""

    RESOLVED = auto()
    UNRESOLVED = auto()
    WRITTEN = auto()
    WRITE_ERROR = auto()
    ROLLED_BACK = auto()
```

et `TrackRecord` gagne, après `write_failed` :

```python
    def rolled_back(self, path: Path) -> TrackRecord:
        """Rendu a son origine : plus rien du candidat, la ligne retombe sur le fichier.

        `resolution` reste, `_resolved` l'exigeant : l'etat la masque a l'ecran.
        """
        return replace(
            self,
            state=TrackState.ROLLED_BACK,
            failure_reason=None,
            path=path,
            written=None,
            source=None,
            candidate=None,
            scored=None,
            artwork=None,
        )
```

- [ ] **Step 4: Déclarer le contrat**

Dans `sidecar/src/tagger/protocol.py`, ajouter `from datetime import datetime` aux imports, puis après `RetryWrite` :

```python
class GetRollbackTarget(Command):
    """Dernier run annulable, pour que la confirmation des Reglages le nomme."""

    command: Literal["get_rollback_target"]


class Rollback(Command):
    """Restaure un run entier depuis son dump, ou son seul morceau `track_id`."""

    command: Literal["rollback"]
    run_id: str
    track_id: str | None = None
```

`AnyCommand` et `ExecutableCommand` se terminent par `| RetryWrite | GetRollbackTarget | Rollback`, `CommandName` par `"retry_write", "get_rollback_target", "rollback",`. Après `RunFinished` :

```python
class RollbackRun(BaseModel):
    """Dernier run annulable : de quoi le nommer dans la confirmation."""

    model_config = ConfigDict(frozen=True)

    run_id: str
    written_at: datetime
    folder: Path
    tracks: int


class RollbackTarget(Event):
    """`run` nul : rien a annuler, l'interface grise le bouton des Reglages."""

    event: Literal["rollback_target"]
    run: RollbackRun | None


class RollbackFailurePayload(BaseModel):
    model_config = ConfigDict(frozen=True)

    track_id: str
    file_name: str
    reason: FailureReason


class RollbackFinished(Event):
    """Bilan d'un rollback ; un morceau en echec reste dans le dump, le suivant le retente."""

    event: Literal["rollback_finished"]
    run_id: str
    track_id: str | None
    restored: tuple[str, ...]
    failed: tuple[RollbackFailurePayload, ...]
```

- [ ] **Step 5: Traduire le rollback en événements**

Dans `sidecar/src/tagger/handlers.py`, ajouter `Rollback`, `RollbackFailurePayload`, `RollbackFinished`, `RollbackRun` et `RollbackTarget` à l'import de `tagger.protocol`, `from tagger.rollback import find_rollback_target, roll_back` aux imports, et `from pathlib import Path` sous `TYPE_CHECKING`. Après `handle_retry_write` :

```python
def handle_get_rollback_target() -> RollbackTarget:
    """Relu sur le disque : le dernier run annulable peut venir d'une autre session."""
    target = find_rollback_target(dump_dir())
    return RollbackTarget(
        event="rollback_target",
        run=None if target is None else RollbackRun.model_validate(target, from_attributes=True),
    )


async def handle_rollback(
    command: Rollback, live: LiveRun | None, emit: Callable[[Event], None]
) -> RollbackFinished:
    """`live` : le run affiche quand c'est lui qu'on restaure, ses morceaux rendus passent en
    `rolled_back`.
    """

    def restored(track_id: str, path: Path) -> None:
        record = None if live is None else live.record(track_id)
        if live is None or record is None:
            return
        rolled_back = record.rolled_back(path)
        live.update(rolled_back)
        emit(_resolved(rolled_back))

    summary = await roll_back(dump_dir(), command.run_id, command.track_id, restored)
    return RollbackFinished(
        event="rollback_finished",
        run_id=summary.run_id,
        track_id=command.track_id,
        restored=summary.restored,
        failed=tuple(
            RollbackFailurePayload.model_validate(failure, from_attributes=True)
            for failure in summary.failed
        ),
    )
```

- [ ] **Step 6: Rollback en tâche de fond et gardes**

Dans `sidecar/src/tagger/__main__.py`, ajouter `handle_get_rollback_target` et `handle_rollback` à l'import de `tagger.handlers`, `GetRollbackTarget` et `Rollback` à celui de `tagger.protocol`. Après `RunCommittedError` :

```python
class RollbackInProgressError(TaggerError):
    """Un rollback tourne : ecriture, nouveau run ou second rollback toucheraient ses fichiers."""

    code: ClassVar[str] = "rollback_in_progress"

    def __init__(self) -> None:
        super().__init__("a rollback is already in progress")
```

Dans `_Session.__init__`, après `self._write` :

```python
        self._rollback: asyncio.Task[None] | None = None
```

En tête de `start_tagging` et de `_writable`, avant la garde d'écriture :

```python
        if self._active(self._rollback) is not None:
            raise RollbackInProgressError
```

Après `retry_write` :

```python
    def rollback(self, command: Rollback) -> None:
        """Rollback en tache de fond, seul sur les fichiers.

        Le run affiche ne suit que si c'est lui qu'on restaure : un ancien run du meme dossier
        porte les memes `track_id`.
        """
        if self._active(self._rollback) is not None:
            raise RollbackInProgressError
        if self._active(self._write) is not None:
            raise WriteInProgressError
        if self._active_run() is not None:
            raise TaggingInProgressError
        live = None if self._current is None else self._current.live
        if live is not None and live.run_id != command.run_id:
            live = None
        start_work = functools.partial(handle_rollback, command, live, self.send)
        self._rollback = self._group.create_task(
            self._phase(start_work, command, command.track_id), name="rollback"
        )
```

La docstring de `close` devient :

```python
        """`shutdown` annule la phase reseau, l'EOF l'attend ; le run courant se ferme ensuite.

        Ecriture et rollback ne sont jamais annules, le `TaskGroup` de la boucle les attend :
        un fichier coupe en vol resterait a moitie ecrit ou renomme.
        """
```

L'union `command` de `_phase` se termine par `| CommitRun | RetryWrite | Rollback`. `_dispatch` gagne deux cas avant `case _:`, ce qui le porte à quatorze branches pour un seuil de douze (mesuré le 2026-10-06 sur ruff) :

```python
# PLR0912 : une branche par commande, le `match` ferme par `assert_never` etant ce qui
# rend un oubli visible au typage.
async def _dispatch(command: ExecutableCommand, session: _Session) -> None:  # noqa: PLR0912
```

```python
        case GetRollbackTarget():
            session.send(await asyncio.to_thread(handle_get_rollback_target))
        case Rollback():
            session.rollback(command)
```

- [ ] **Step 7: Traduire le code**

Dans `errors`, juste après `rollback_unavailable` :

`public/i18n/fr.json` :

```json
    "rollback_in_progress": "Une restauration est en cours. Attendez qu'elle se termine.",
```

`public/i18n/en.json` :

```json
    "rollback_in_progress": "A restore is in progress. Wait for it to finish.",
```

- [ ] **Step 8: Mirrorer le contrat**

Dans `src/app/core/models/protocol.ts`, après `RetryWriteCommand` :

```ts
/** Decrit le dernier run annulable, pour la confirmation des Reglages. */
export interface GetRollbackTargetCommand {
  readonly command: "get_rollback_target"
}

/** Restaure un run entier depuis son dump, ou son seul morceau `track_id`. */
export interface RollbackCommand {
  readonly command: "rollback"
  readonly run_id: string
  readonly track_id: string | null
}
```

`SidecarCommand` se termine par `| CommitRunCommand | RetryWriteCommand | GetRollbackTargetCommand | RollbackCommand`. `TrackState` gagne `| "rolled_back"`, `TrackFailureReason` gagne `| "name_taken"` après `"write_failed"`. Après `RunFinishedEvent` :

```ts
/** Dernier run annulable : de quoi le nommer dans la confirmation. */
export interface RollbackRun {
  readonly run_id: string
  readonly written_at: string
  readonly folder: string
  readonly tracks: number
}

/** `run` nul : rien a annuler. Hors `SidecarEvent` jusqu'a son routage (sub-project 08). */
export interface RollbackTargetEvent {
  readonly event: "rollback_target"
  readonly run: RollbackRun | null
}

export interface RollbackFailure {
  readonly track_id: string
  readonly file_name: string
  readonly reason: TrackFailureReason
}

/** Hors `SidecarEvent` jusqu'a son routage, comme `RollbackTargetEvent`. */
export interface RollbackFinishedEvent {
  readonly event: "rollback_finished"
  readonly run_id: string
  readonly track_id: string | null
  readonly restored: readonly string[]
  readonly failed: readonly RollbackFailure[]
}
```

- [ ] **Step 9: Vérifier que tout passe**

Run: `cd sidecar && uv run pytest tests/integration/test_ndjson_rollback.py tests/integration/test_ndjson_write.py tests/unit/test_protocol_models.py tests/unit/test_error_translations.py --no-cov -q`
Expected: PASS (11 cas de rollback, `test_command_name_lists_every_command` compris)

Run: `just typecheck-ui && just test-ui`
Expected: PASS

- [ ] **Step 10: Lancer le gate**

Run: `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar && just lint-ui`
Expected: tout passe.

- [ ] **Step 11: Commit**

```bash
git add sidecar/src/tagger/tagging.py sidecar/src/tagger/protocol.py sidecar/src/tagger/handlers.py sidecar/src/tagger/__main__.py sidecar/tests/integration/test_ndjson_rollback.py src/app/core/models/protocol.ts public/i18n/fr.json public/i18n/en.json
git commit -m "feat(sidecar): rollback d'un run ou d'un morceau sur le protocole NDJSON"
```

---

### Task 4: Contrat du rollback dans l'architecture

**Files:**
- Modify: `docs/ARCHITECTURE.md` (§ API : commandes l. 430-431 et 438-441, événements, paragraphe l. 465, états l. 473-477, diagramme l. 488-517, filtres du récapitulatif l. 521-535 ; § Concurrence l. 553-555 ; § Données, ligne du dump l. 590 ; arborescence l. 113-133 ; ordre de développement l. 969-970)

- [ ] **Step 1: Documenter le contrat livré**

Charger `Skill[architecture-doc]` avant d'éditer. Dans `docs/ARCHITECTURE.md` :
- § API, commandes : `get_rollback_target` (« aucune. Décrit le dernier run annulable, le plus récent des dumps qui a encore des morceaux à restaurer, un dump illisible sauté ») avant `rollback` ; `rollback` devient « identifiant du run, `track_id` optionnel pour un seul morceau. En tâche de fond : nom d'origine puis tags d'origine, un nom d'origine pris par un autre fichier laissant le morceau intact (`name_taken`). Refusée en `tagging_in_progress` pendant la phase réseau, `write_in_progress` pendant l'écriture, `rollback_in_progress` pendant un rollback, `rollback_unavailable` sans dump ou sur un morceau absent du dump. Ni `cancel_run`, ni `shutdown`, ni l'EOF ne la coupent » ;
- `commit_run`, `retry_write`, `start_tagging` : « refusés en `rollback_in_progress` pendant un rollback » ;
- `shutdown` (l. 430) : « … et **attend l'extraction, l'écriture et le rollback** si elles sont en cours ; l'EOF attend les quatre » ; `cancel_run` (l. 431) : « L'extraction, l'écriture et le rollback restent attendus jusqu'à leur terme, comme sous `shutdown` » ;
- paragraphe sous les tableaux (l. 465), « Le code `tagging_in_progress` est l'exception qui confirme la règle » : après `write_in_progress` (sub-project 05), ajouter `rollback_in_progress`, porté par `start_tagging` pendant un rollback : il refuse un lancement sans clore le run affiché ;
- § API, événements : `rollback_target` (« `run` : identifiant, date d'écriture, dossier, morceaux à restaurer ; nul s'il n'y a rien à annuler ») et `rollback_finished` (« identifiant du run, morceau visé, morceaux restaurés, échecs avec nom de fichier actuel et motif. Sur le run affiché, chaque morceau restauré part aussi en `track_resolved(rolled_back)`, sans source, scores ni pochette ») ;
- table des états (l. 473-477) : `state` gagne `rolled_back` (« rendu à son origine par un rollback : plus de candidat, `resolution` conservée mais masquée par l'état ») et `failure_reason` gagne « Rollback : `name_taken` » ;
- diagramme (l. 488-517) : ajouter `written --> rolled_back : rollback`, `write_error --> rolled_back : rollback` et `rolled_back --> [*]` ;
- filtres du récapitulatif (l. 521-535) : « validés » et « arbitrés » se lisent sur `state ∈ {resolved, written}` au lieu de `state ∉ échecs`, et le paragraphe d'après précise qu'un morceau `rolled_back` n'est ni validé, ni arbitré, ni en échec : il sort des trois, aucune décision ne le décrivant plus ; la garde du troisième piège devient la garde sur `state` ; « un `write_error` peut encore en sortir plus tard par `retry_write` » gagne « ou par `rollback` » ;
- § Concurrence (l. 553-555) : `shutdown` attend aussi le rollback, avec l'extraction et l'écriture, un fichier coupé en plein renommage restant à moitié rendu ;
- § Données, ligne du dump (l. 590) : « un morceau restauré en sort, comme un morceau dont le fichier n'existe plus sous aucun nom, et un dump vidé est supprimé : le dernier run annulable devient alors le précédent » ;
- arborescence du sidecar (l. 113-133) : ajouter après `writing.py` la ligne `rollback.py  # restauration d'un run ou d'un morceau depuis son dump`, au même alignement que ses voisines ;
- ordre de développement (l. 969-970) : le bouton de rollback vient avec la Feature 5 : la ligne 7 devient « Arbitrage, URL manuelle, écriture **avec son dump des tags d'origine**, bouton de rollback, récapitulatif, rapport » et la ligne 8 « Reste des Settings, monitoring ».

- [ ] **Step 2: Vérifier le rendu**

Run: `just lint-ui`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs(sidecar): contrat NDJSON du rollback"
```
