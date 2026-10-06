# Phase d'écriture d'un run : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Appliquer sur le disque un run confirmé, dump des tags d'origine d'abord puis tags, pochette et renommage morceau par morceau, et rejouer ses seuls échecs d'écriture.

**Architecture:** `tagging.py` gagne les états `written` et `write_error`, les six motifs de fichier dans `FailureReason`, et ce que l'écriture a posé (`WriteOutcome`). Le nouveau module `writing.py` porte `RunWriter`, qui travaille sur le `LiveRun` en mémoire : lecture parallèle et enregistrement du dump avant le premier fichier, puis écriture et renommage séquentiels, échecs locaux à leur morceau, relance des seuls échecs, événements par rappel.

**Tech Stack:** Python 3.14 (`asyncio.to_thread`, `asyncio.gather`), pytest + pytest-asyncio (mode strict, `pytestmark`), fichiers réels de `audio_samples`. Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/ecriture-des-tags-et-renommage/04-phase-ecriture-sidecar-design.md`

## Global Constraints

- **Dépend des sub-projects 01, 02 et 03, implémentés avant** : `files.project_tags`, `write_tags`, `TagsWriteError`, `TagField`, `read_original_tags`, `OriginalTags`, `TagsUnreadableError`, `UnreadableReason` ; `file_failures.FileFailureReason`, `file_failure_reason` ; `tag_dump.TagDump`, `DumpEntry`, `save_entries`, `record_renamed_path`, `load_dump`, `TagDumpError`, `TagDumpWriteError` ; `renaming.rename_track(path, artist, title, before_rename)`, `RenameError`.
- **Morceaux visés** : `write()` les `resolved`, `retry()` les `write_error`. Jamais un `unresolved`, un morceau en attente (`state` vide) ni un non traité.
- **Ordre** : dump de tous les morceaux visés absents du dump, en un seul enregistrement, avant le premier fichier ; puis, morceau par morceau et dans l'ordre du run, tags et pochette, puis renommage. Le chemin cible est noté au dump juste avant le déplacement du fichier, par le rappel `before_rename` de `rename_track`, appelé dès qu'un renommage a lieu, casse seule comprise : une coupure entre les deux laisse un chemin qui ne mène nulle part, que le rollback retrouve par l'ancien nom.
- **Échec local** : lecture d'origine, écriture ou renommage en échec → `write_error` avec le motif de fichier, la phase continue. Seule la sauvegarde initiale du dump, avant tout fichier, arrête la phase : aucun morceau n'a alors changé d'état, les échecs de lecture ne se réglant qu'une fois le dump sauvé. Un dump qui ne se met pas à jour au moment du renommage est logué sans rien arrêter : le fichier est écrit et le morceau passe `written`, mais son rollback échouera en `file_missing`, faute de chemin renommé.
- **Motif d'une lecture en échec** : `UnreadableReason.LOCKED` se lit avant la cause système, un fichier tenu par un autre programme remontant en `PermissionError` sans code Windows.
- **Dump jamais réécrit** pour une entrée présente ; dump créé à la première écriture et gardé pour la relance. `save_entries` et `record_renamed_path` repartent du dump du disque (sub-project 02) : le `RunWriter` reprend à chaque appel le dump qu'ils rendent, un rollback entre deux écritures ayant pu vider celui qu'il gardait.
- **Motifs** : `FailureReason` reprend les six valeurs de `FileFailureReason` (`permission_denied`, `disk_full`, `path_too_long`, `file_locked`, `file_missing`, `write_failed`), copie gardée par un test.
- **Logs** logfmt, clés du jeu fixe seulement (`run`, `track`, `reason`).
- **Code Python sans accents**, docstrings et commentaires en français, le pourquoi seulement.
- **Tests** : noms en anglais, AAA séparé par des lignes vides, fichiers dans `tmp_path`.
- **Gate vert à chaque commit** : `just lint-sidecar`, `just typecheck-sidecar`, `just test-sidecar`, plus `just lint-ui` quand les JSON de langue changent. Commits `type(scope): description`, scope `sidecar`.

## Review Focus

- **Deux morceaux du run visant le même nom** : le second reçoit ` (2)` (Task 2, garanti par la passe séquentielle et couvert par `test_renaming.py` du sub-project 03 ; aucun test de phase supplémentaire).
- **Fichier tenu par un autre programme** : `file_locked` sur un vrai verrou, les autres morceaux écrits (Task 2, `test_marks_a_locked_file_and_carries_on`).
- **Dump impossible avec un morceau à l'origine illisible** : aucun morceau ne change d'état, l'échec de lecture n'est réglé qu'une fois le dump sauvé (Task 2, `test_settles_no_track_when_the_dump_cannot_be_saved`).
- **Chemin cible noté avant le déplacement** : le dump porte le chemin cible alors que le fichier a encore son ancien nom (Task 2, `test_notes_the_rename_target_before_the_file_moves`).
- **Renommage de casse seule** : le chemin renommé est noté au dump, `Path` comparant sans la casse sous Windows (Task 2, `test_records_a_rename_that_only_changes_the_case`).
- **Dump qui ne se met pas à jour au renommage** : fichier écrit, morceau `written`, `renamed_path` vide (Task 2, `test_keeps_a_written_track_when_the_dump_cannot_note_its_rename`).
- **Morceau verrouillé au moment de la lecture d'origine** : jamais écrit, aucun octet modifié (Task 2, `test_never_writes_a_track_whose_origin_cannot_be_read`).
- **Relance après un renommage raté** : seul ce fichier est réécrit, l'origine du dump reste celle d'avant la première écriture (Task 2, `test_retries_only_the_failures_and_keeps_the_dumped_origin`).
- **Fichier corrompu dans le dossier** : `write_failed`, sans faire tomber la phase (Task 2, `test_marks_a_corrupt_file_as_write_failed`).
- **Fichier déjà au bon nom** : écrit, aucun renommage noté au dump (Task 2, `test_keeps_a_correctly_named_file_and_records_no_rename`).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `sidecar/src/tagger/tagging.py` | États d'écriture, motifs, `WriteOutcome`, transitions du morceau. |
| `sidecar/src/tagger/writing.py` | `RunWriter` : dump, écriture, renommage, relance, événements. |
| `sidecar/tests/unit/test_file_failures.py` | Motifs de fichier recopiés sous le même nom. |
| `sidecar/tests/unit/test_writing.py` | Phase d'écriture, relance et verrou réel sur des fichiers réels. |
| `public/i18n/{fr,en}.json` | `tagging.reason` des six motifs d'écriture. |
| `docs/ARCHITECTURE.md` | `writing.py` dans l'arborescence. |

---

### Task 1: États et motifs d'écriture d'un morceau

**Files:**
- Modify: `sidecar/src/tagger/tagging.py` (import `files`, `TrackState`, `FailureReason`, `TrackRecord`)
- Modify: `sidecar/tests/unit/test_file_failures.py`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`

**Interfaces:**
- Consumes: `files.TagField` (sub-project 01), `file_failures.FileFailureReason`.
- Produces: `TrackState.WRITTEN`, `TrackState.WRITE_ERROR` ; `FailureReason.PERMISSION_DENIED`, `DISK_FULL`, `PATH_TOO_LONG`, `FILE_LOCKED`, `FILE_MISSING`, `WRITE_FAILED` ; `tagging.WriteOutcome(fields: tuple[TagField, ...], artwork: bool, truncated: bool)` ; `TrackRecord.written: WriteOutcome | None` ; `TrackRecord.written_to(path: Path, outcome: WriteOutcome) -> TrackRecord` ; `TrackRecord.write_failed(reason: FailureReason) -> TrackRecord`.

- [ ] **Step 1: Écrire le test de cohérence**

À la fin de `sidecar/tests/unit/test_file_failures.py`, avec `from tagger.tagging import FailureReason` dans les imports :

```python
def test_track_failures_carry_every_file_failure_under_the_same_name() -> None:
    """Le protocole porte un seul `failure_reason` : les motifs d'ecriture y sont recopies."""
    file_reasons = {reason.value for reason in FileFailureReason}

    track_reasons = {reason.value for reason in FailureReason}

    assert file_reasons <= track_reasons
```

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `cd sidecar && uv run pytest tests/unit/test_file_failures.py --no-cov -q`
Expected: FAIL sur `test_track_failures_carry_every_file_failure_under_the_same_name`

- [ ] **Step 3: Déclarer états, motifs et résultat d'écriture**

Dans `sidecar/src/tagger/tagging.py`, l'import de `files` devient :

```python
from tagger.files import (
    IdentityTags,
    TagField,
    TagsUnreadableError,
    list_audio_files,
    read_identity,
)
```

`TrackState` :

```python
class TrackState(StrEnum):
    """Etat d'un morceau, apres la phase reseau ou l'ecriture."""

    RESOLVED = auto()
    UNRESOLVED = auto()
    WRITTEN = auto()
    WRITE_ERROR = auto()
```

À la fin de `FailureReason`, après `SOURCE_UNAVAILABLE` :

```python
    # Memes valeurs que `FileFailureReason`, garde par un test : le protocole n'a qu'un seul
    # champ `failure_reason`.
    PERMISSION_DENIED = auto()
    DISK_FULL = auto()
    PATH_TOO_LONG = auto()
    FILE_LOCKED = auto()
    FILE_MISSING = auto()
    WRITE_FAILED = auto()
```

Avant `TrackRecord` :

```python
@dataclass(frozen=True, slots=True)
class WriteOutcome:
    """Ce que l'ecriture a pose sur le fichier, pour le rapport."""

    fields: tuple[TagField, ...]
    artwork: bool
    truncated: bool
```

Dans `TrackRecord`, dernier champ après `arbitration` :

```python
    written: WriteOutcome | None = None
```

et, avant `unresolved` :

```python
    def written_to(self, path: Path, outcome: WriteOutcome) -> TrackRecord:
        """Morceau ecrit ; `path` suit le renommage, `track_id` reste celui du run."""
        return replace(
            self, state=TrackState.WRITTEN, failure_reason=None, path=path, written=outcome
        )

    def write_failed(self, reason: FailureReason) -> TrackRecord:
        """Ecriture en echec : la resolution reste, la relance n'a rien a redemander."""
        return replace(self, state=TrackState.WRITE_ERROR, failure_reason=reason)
```

- [ ] **Step 4: Traduire les six motifs**

`test_error_translations.py` exige une phrase `tagging.reason.<motif>` pour chaque valeur de `FailureReason`. Dans `tagging.reason`, après `user_refused` :

`public/i18n/fr.json` :

```json
      "permission_denied": "L'accès au fichier a été refusé.",
      "disk_full": "Le disque est plein.",
      "path_too_long": "Le chemin du fichier est trop long.",
      "file_locked": "Le fichier est ouvert dans un autre programme. Fermez-le, puis relancez l'écriture.",
      "file_missing": "Le fichier a disparu depuis le run.",
      "write_failed": "L'écriture du fichier a échoué."
```

`public/i18n/en.json` :

```json
      "permission_denied": "Access to the file was denied.",
      "disk_full": "The disk is full.",
      "path_too_long": "The file path is too long.",
      "file_locked": "The file is open in another program. Close it, then retry the write.",
      "file_missing": "The file disappeared since the run.",
      "write_failed": "Writing the file failed."
```

- [ ] **Step 5: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_file_failures.py tests/unit/test_error_translations.py --no-cov -q`
Expected: PASS

- [ ] **Step 6: Lancer le gate**

Run: `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar && just lint-ui`
Expected: tout passe.

- [ ] **Step 7: Commit**

```bash
git add sidecar/src/tagger/tagging.py sidecar/tests/unit/test_file_failures.py public/i18n/fr.json public/i18n/en.json
git commit -m "feat(sidecar): états et motifs d'écriture d'un morceau"
```

---

### Task 2: Écrire un run et relancer ses échecs

**Files:**
- Create: `sidecar/src/tagger/writing.py`
- Create: `sidecar/tests/unit/test_writing.py`

**Interfaces:**
- Consumes: Task 1 ; sub-projects 01 à 03 (cf. Global Constraints) ; `tagging.LiveRun` (`snapshot`, `record`, `update`, `position`, `run_id`), `tagging.TrackResolved`.
- Produces: `writing.RunWriter(live: LiveRun, dump_folder: Path, on_event: Callable[[WriteEvent], None], *, now: Callable[[], datetime] = ...)` avec `async write() -> WriteSummary` et `async retry() -> WriteSummary` (seule la sauvegarde initiale du dump lève vers l'appelant, en `TagDumpWriteError`) ; `writing.WriteProgress(processed: int, total: int)` ; `writing.WriteSummary(written: int, failed: int)` ; `type WriteEvent = TrackResolved | WriteProgress`. Le sub-project 05 crée le `RunWriter` du run courant avec `tag_dump.dump_dir()` et traduit ses événements.

- [ ] **Step 1: Écrire les tests**

`sidecar/tests/unit/test_writing.py` :

```python
"""Tests de la phase d'ecriture d'un run : dump, tags, renommage, echecs et relance."""

from datetime import UTC, datetime
from typing import TYPE_CHECKING

import pytest
from audio_samples import BLANK_WRITERS, held_open, tag
from mutagen import MutagenError
from scraper_responses import track_payload

from tagger import files, renaming, writing
from tagger.file_failures import FileFailureReason
from tagger.files import (
    IdentityTags,
    TagField,
    TagsUnreadableError,
    UnreadableReason,
    read_original_tags,
)
from tagger.renaming import RenamedTrack, RenameError
from tagger.scraper_client import Source, TrackCandidate
from tagger.tag_dump import TagDumpWriteError, load_dump
from tagger.tagging import (
    FailureReason,
    LiveRun,
    Resolution,
    TrackRecord,
    TrackResolved,
    TrackState,
)
from tagger.writing import RunWriter, WriteProgress, WriteSummary

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

pytestmark = pytest.mark.asyncio

CREATED = datetime(2026, 10, 6, 21, 14, 3, tzinfo=UTC)
BEATPORT = TrackCandidate.model_validate(track_payload())
WRITTEN_NAME = "Adam Beyer - Your Mind (Extended Mix)"


def _track(folder: Path, name: str, state: TrackState | None = TrackState.RESOLVED) -> TrackRecord:
    """Fichier tague « adam beyer / your mind » et son morceau dans l'etat demande."""
    path = BLANK_WRITERS[name.rsplit(".", 1)[1]](folder / name)
    tag(path, artist=["adam beyer"], title=["your mind"])
    record = TrackRecord(track_id=name, path=path, identity=IdentityTags("adam beyer", "your mind"))
    match state:
        case TrackState.RESOLVED:
            return record.resolved(Resolution.AUTO, Source.BEATPORT, BEATPORT, None, None)
        case TrackState.UNRESOLVED:
            return record.unresolved(FailureReason.NO_RESULT)
        case _:
            return record


def _run(*records: TrackRecord) -> LiveRun:
    return LiveRun("a3f9c1", records[0].path.parent, records)


def _writer(
    live: LiveRun, tmp_path: Path, events: list[writing.WriteEvent] | None = None
) -> RunWriter:
    sink = events if events is not None else []
    return RunWriter(live, tmp_path / "dumps", sink.append, now=lambda: CREATED)


def _dump(tmp_path: Path, live: LiveRun) -> Path:
    return tmp_path / "dumps" / f"20261006T211403Z-{live.run_id}.json"


@pytest.fixture
def music(tmp_path: Path) -> Path:
    folder = tmp_path / "music"
    folder.mkdir()
    return folder


async def test_writes_and_renames_every_resolved_track(tmp_path: Path, music: Path) -> None:
    live = _run(_track(music, "a.mp3"), _track(music, "b.flac"))

    summary = await _writer(live, tmp_path).write()

    assert summary == WriteSummary(written=2, failed=0)
    for track_id, suffix in (("a.mp3", ".mp3"), ("b.flac", ".flac")):
        record = live.record(track_id)
        assert record is not None
        assert record.state is TrackState.WRITTEN
        assert record.path == music / f"{WRITTEN_NAME}{suffix}"
        assert read_original_tags(record.path).fields[TagField.TITLE] == (
            "Your Mind (Extended Mix)",
        )


async def test_never_touches_unresolved_or_pending_tracks(tmp_path: Path, music: Path) -> None:
    unresolved = _track(music, "u.mp3", TrackState.UNRESOLVED)
    pending = _track(music, "p.mp3", None)
    before = {record.track_id: record.path.read_bytes() for record in (unresolved, pending)}
    live = _run(_track(music, "a.mp3"), unresolved, pending)

    await _writer(live, tmp_path).write()

    for track_id, content in before.items():
        record = live.record(track_id)
        assert record is not None
        assert record.path.read_bytes() == content
        assert record.state is not TrackState.WRITTEN


async def test_dumps_every_origin_before_writing_the_first_file(
    tmp_path: Path, music: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    live = _run(_track(music, "a.mp3"), _track(music, "b.mp3"))
    dumped_at_first_write: list[set[str]] = []
    real_write = files.write_tags

    def spying_write(*args: object) -> object:
        if not dumped_at_first_write:
            dumped_at_first_write.append(set(load_dump(_dump(tmp_path, live)).entries))
        return real_write(*args)  # type: ignore[arg-type]

    monkeypatch.setattr(writing, "write_tags", spying_write)

    await _writer(live, tmp_path).write()

    assert dumped_at_first_write == [{"a.mp3", "b.mp3"}]
    entry = load_dump(_dump(tmp_path, live)).entries["a.mp3"]
    assert entry.fields[TagField.TITLE] == ("your mind",)
    assert entry.renamed_path == music / f"{WRITTEN_NAME}.mp3"


async def test_stops_before_any_file_when_the_dump_cannot_be_saved(
    tmp_path: Path, music: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    track = _track(music, "a.mp3")
    before = track.path.read_bytes()

    def full_disk(_folder: Path, dump: object, _entries: object) -> object:
        raise TagDumpWriteError(tmp_path / "dumps" / "x.json")

    monkeypatch.setattr(writing, "save_entries", full_disk)

    with pytest.raises(TagDumpWriteError):
        await _writer(_run(track), tmp_path).write()

    assert track.path.read_bytes() == before


async def test_settles_no_track_when_the_dump_cannot_be_saved(
    tmp_path: Path, music: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    unreadable, readable = _track(music, "u.mp3"), _track(music, "a.mp3")
    live = _run(unreadable, readable)
    events: list[writing.WriteEvent] = []
    real_read = files.read_original_tags

    def held_one(path: Path) -> object:
        if path == unreadable.path:
            raise TagsUnreadableError(path, UnreadableReason.LOCKED)
        return real_read(path)

    def full_disk(_folder: Path, _dump: object, _entries: object) -> object:
        raise TagDumpWriteError(tmp_path / "dumps" / "x.json")

    monkeypatch.setattr(writing, "read_original_tags", held_one)
    monkeypatch.setattr(writing, "save_entries", full_disk)

    with pytest.raises(TagDumpWriteError):
        await _writer(live, tmp_path, events).write()

    assert events == []
    assert [record.state for record in live.snapshot().tracks] == [TrackState.RESOLVED] * 2


async def test_marks_a_locked_file_and_carries_on(tmp_path: Path, music: Path) -> None:
    locked = _track(music, "locked.mp3")
    live = _run(locked, _track(music, "a.mp3"))

    with held_open(locked.path):
        summary = await _writer(live, tmp_path).write()

    assert summary == WriteSummary(written=1, failed=1)
    record = live.record("locked.mp3")
    assert record is not None
    assert (record.state, record.failure_reason) == (
        TrackState.WRITE_ERROR,
        FailureReason.FILE_LOCKED,
    )


async def test_never_writes_a_track_whose_origin_cannot_be_read(
    tmp_path: Path, music: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    track = _track(music, "a.mp3")
    before = track.path.read_bytes()
    live = _run(track)

    def held(path: Path) -> object:
        error = MutagenError("file in use")
        error.__cause__ = PermissionError(13, "Permission denied")
        raise TagsUnreadableError(path, UnreadableReason.LOCKED) from error

    monkeypatch.setattr(writing, "read_original_tags", held)

    summary = await _writer(live, tmp_path).write()

    assert summary == WriteSummary(written=0, failed=1)
    record = live.record("a.mp3")
    assert record is not None
    assert record.failure_reason is FailureReason.FILE_LOCKED
    assert track.path.read_bytes() == before


async def test_marks_a_file_that_vanished_since_the_run_as_missing(
    tmp_path: Path, music: Path
) -> None:
    track = _track(music, "a.mp3")
    track.path.unlink()
    live = _run(track)

    summary = await _writer(live, tmp_path).write()

    assert summary == WriteSummary(written=0, failed=1)
    record = live.record("a.mp3")
    assert record is not None
    assert record.failure_reason is FailureReason.FILE_MISSING


async def test_marks_a_failed_rename_after_written_tags(
    tmp_path: Path, music: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    track = _track(music, "a.mp3")
    live = _run(track)

    def held(path: Path, *_args: object) -> object:
        raise RenameError(path, FileFailureReason.FILE_LOCKED)

    monkeypatch.setattr(writing, "rename_track", held)

    await _writer(live, tmp_path).write()

    record = live.record("a.mp3")
    assert record is not None
    assert (record.state, record.path) == (TrackState.WRITE_ERROR, track.path)
    assert read_original_tags(track.path).fields[TagField.TITLE] == ("Your Mind (Extended Mix)",)


async def test_notes_the_rename_target_before_the_file_moves(
    tmp_path: Path, music: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    live = _run(_track(music, "a.mp3"))
    seen: list[tuple[Path | None, bool]] = []
    real_rename = renaming.rename_track

    def spying_rename(
        path: Path, artist: str | None, title: str | None, before_rename: Callable[[Path], None]
    ) -> RenamedTrack:
        def spy(target: Path) -> None:
            before_rename(target)
            noted = load_dump(_dump(tmp_path, live)).entries["a.mp3"].renamed_path
            seen.append((noted, path.is_file()))

        return real_rename(path, artist, title, spy)

    monkeypatch.setattr(writing, "rename_track", spying_rename)

    await _writer(live, tmp_path).write()

    assert seen == [(music / f"{WRITTEN_NAME}.mp3", True)]


async def test_keeps_a_written_track_when_the_dump_cannot_note_its_rename(
    tmp_path: Path, music: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    live = _run(_track(music, "a.mp3"))

    def full_disk(*_args: object) -> object:
        raise TagDumpWriteError(tmp_path / "dumps" / "x.json")

    monkeypatch.setattr(writing, "record_renamed_path", full_disk)

    summary = await _writer(live, tmp_path).write()

    assert summary == WriteSummary(written=1, failed=0)
    assert (music / f"{WRITTEN_NAME}.mp3").is_file()
    assert load_dump(_dump(tmp_path, live)).entries["a.mp3"].renamed_path is None


async def test_retries_only_the_failures_and_keeps_the_dumped_origin(
    tmp_path: Path, music: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    failing = _track(music, "a.mp3")
    live = _run(failing, _track(music, "b.mp3"))
    writer = _writer(live, tmp_path)
    real_rename = renaming.rename_track

    def held_once(path: Path, *args: object) -> object:
        if path == failing.path:
            raise RenameError(path, FileFailureReason.FILE_LOCKED)
        return real_rename(path, *args)  # type: ignore[arg-type]

    monkeypatch.setattr(writing, "rename_track", held_once)
    await writer.write()
    monkeypatch.setattr(writing, "rename_track", real_rename)
    written_paths: list[Path] = []
    real_write = files.write_tags

    def recording_write(path: Path, *args: object) -> object:
        written_paths.append(path)
        return real_write(path, *args)  # type: ignore[arg-type]

    monkeypatch.setattr(writing, "write_tags", recording_write)

    summary = await writer.retry()

    assert summary == WriteSummary(written=1, failed=0)
    assert written_paths == [failing.path]
    assert load_dump(_dump(tmp_path, live)).entries["a.mp3"].fields[TagField.TITLE] == (
        "your mind",
    )


async def test_retry_reads_the_origin_a_failed_read_missed(
    tmp_path: Path, music: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    live = _run(_track(music, "a.mp3"))
    writer = _writer(live, tmp_path)
    real_read = files.read_original_tags

    def held(path: Path) -> object:
        raise TagsUnreadableError(path, UnreadableReason.LOCKED)

    monkeypatch.setattr(writing, "read_original_tags", held)
    await writer.write()
    monkeypatch.setattr(writing, "read_original_tags", real_read)

    summary = await writer.retry()

    assert summary == WriteSummary(written=1, failed=0)
    assert set(load_dump(_dump(tmp_path, live)).entries) == {"a.mp3"}


async def test_emits_each_track_then_the_progress(tmp_path: Path, music: Path) -> None:
    live = _run(_track(music, "a.mp3"), _track(music, "b.mp3"))
    events: list[writing.WriteEvent] = []

    await _writer(live, tmp_path, events).write()

    kinds = [type(event) for event in events]
    assert kinds == [TrackResolved, WriteProgress, TrackResolved, WriteProgress]
    assert events[-1] == WriteProgress(processed=2, total=2)


async def test_keeps_a_correctly_named_file_and_records_no_rename(
    tmp_path: Path, music: Path
) -> None:
    track = _track(music, f"{WRITTEN_NAME}.mp3")
    live = _run(track)

    await _writer(live, tmp_path).write()

    record = live.record(track.track_id)
    assert record is not None
    assert (record.state, record.path) == (TrackState.WRITTEN, track.path)
    assert load_dump(_dump(tmp_path, live)).entries[track.track_id].renamed_path is None


async def test_records_a_rename_that_only_changes_the_case(tmp_path: Path, music: Path) -> None:
    track = _track(music, "adam beyer - your mind (extended mix).mp3")
    live = _run(track)

    await _writer(live, tmp_path).write()

    noted = load_dump(_dump(tmp_path, live)).entries[track.track_id].renamed_path
    assert str(noted) == str(music / f"{WRITTEN_NAME}.mp3")


async def test_marks_a_corrupt_file_as_write_failed(tmp_path: Path, music: Path) -> None:
    path = music / "broken.mp3"
    path.write_bytes(b"not an audio file" * 16)
    record = TrackRecord(track_id="broken.mp3", path=path, identity=IdentityTags("", ""))
    live = _run(record.resolved(Resolution.AUTO, Source.BEATPORT, BEATPORT, None, None))

    await _writer(live, tmp_path).write()

    written = live.record("broken.mp3")
    assert written is not None
    assert written.failure_reason is FailureReason.WRITE_FAILED
```

Les fonctions réelles se capturent sur leur module d'origine (`files.write_tags`) : mypy strict refuse l'attribut ré-exporté `writing.write_tags`.

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_writing.py --no-cov -q`
Expected: FAIL, `ImportError: cannot import name 'writing' from 'tagger'`

- [ ] **Step 3: Écrire le module**

`sidecar/src/tagger/writing.py` :

```python
"""Ecriture d'un run confirme (use-case 5), hors protocole NDJSON : rendue par rappel.

Dump des tags d'origine de tous les morceaux vises avant le premier fichier (ADR-010), puis,
morceau par morceau, tags, pochette et renommage. Un echec reste local a son morceau.
Sequentielle : deux morceaux visant le meme nom ne se doublent pas.
"""

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, override

from tagger.file_failures import FileFailureReason, file_failure_reason
from tagger.files import (
    OriginalTags,
    TagField,
    TagsUnreadableError,
    TagsWriteError,
    UnreadableReason,
    project_tags,
    read_original_tags,
    write_tags,
)
from tagger.renaming import RenameError, rename_track
from tagger.tag_dump import (
    DumpEntry,
    TagDump,
    TagDumpError,
    record_renamed_path,
    save_entries,
)
from tagger.tagging import FailureReason, TrackResolved, TrackState, WriteOutcome

if TYPE_CHECKING:
    from collections.abc import Callable, Sequence
    from pathlib import Path

    from tagger.tagging import LiveRun, TrackRecord

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class WriteProgress:
    """Morceaux traites, ecrits ou en echec, sur morceaux vises par la phase."""

    processed: int
    total: int


@dataclass(frozen=True, slots=True)
class WriteSummary:
    """Bilan d'une phase d'ecriture ou de sa relance."""

    written: int
    failed: int


type WriteEvent = TrackResolved | WriteProgress


class RunWriter:
    """Ecrit les morceaux resolus d'un run, puis rejoue ses seuls echecs d'ecriture.

    Le dump cree au premier passage est garde pour les relances : l'origine reste celle
    d'avant la premiere ecriture.
    """

    def __init__(
        self,
        live: LiveRun,
        dump_folder: Path,
        on_event: Callable[[WriteEvent], None],
        *,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._live = live
        self._dump_folder = dump_folder
        self._on_event = on_event
        self._dump = TagDump(run_id=live.run_id, created_at=now())
        self._processed = 0
        self._total = 0

    @override
    def __repr__(self) -> str:
        return f"RunWriter(run_id={self._live.run_id!r}, dumped={len(self._dump.entries)})"

    async def write(self) -> WriteSummary:
        """Ecrit les morceaux resolus ; non resolus et attentes d'arbitrage restent intacts."""
        return await self._apply(TrackState.RESOLVED)

    async def retry(self) -> WriteSummary:
        """Rejoue les seuls echecs d'ecriture, sans refaire ni reseau ni arbitrage."""
        return await self._apply(TrackState.WRITE_ERROR)

    async def _apply(self, state: TrackState) -> WriteSummary:
        targets = [record for record in self._live.snapshot().tracks if record.state is state]
        self._processed, self._total = 0, len(targets)
        logger.info("write phase started run=%s", self._live.run_id)

        writable = await self._dump_originals(targets)
        for record in writable:
            self._settle(await asyncio.to_thread(self._write_one, record))

        logger.info("write phase finished run=%s", self._live.run_id)
        tracks = [self._live.record(record.track_id) for record in targets]
        written = sum(1 for track in tracks if track and track.state is TrackState.WRITTEN)
        return WriteSummary(written=written, failed=len(targets) - written)

    async def _dump_originals(self, targets: Sequence[TrackRecord]) -> list[TrackRecord]:
        """Lit et enregistre l'origine des morceaux absents du dump, avant tout fichier.

        Une lecture en echec met son morceau en `write_error`, regle apres l'enregistrement :
        un dump impossible arrete la phase sans changer aucun morceau.
        """
        unread = [record for record in targets if record.track_id not in self._dump.entries]
        reads = await asyncio.gather(
            *(asyncio.to_thread(read_original_tags, record.path) for record in unread),
            return_exceptions=True,
        )
        entries: dict[str, DumpEntry] = {}
        failed: list[TrackRecord] = []
        for record, read in zip(unread, reads, strict=True):
            match read:
                case OriginalTags():
                    entries[record.track_id] = DumpEntry.of(record.path, read)
                case TagsUnreadableError():
                    failed.append(record.write_failed(_unreadable_reason(read)))
                case _:
                    raise read
        if entries:
            self._dump = await asyncio.to_thread(
                save_entries, self._dump_folder, self._dump, entries
            )
        for record in failed:
            self._settle(record)
        failed_ids = {record.track_id for record in failed}
        return [record for record in targets if record.track_id not in failed_ids]

    def _write_one(self, record: TrackRecord) -> TrackRecord:
        candidate = record.candidate
        if candidate is None:
            raise ValueError("resolved track without candidate")
        values = project_tags(candidate)
        try:
            written = write_tags(record.path, values, record.artwork)
            renamed = rename_track(
                record.path,
                values.get(TagField.ARTIST),
                values.get(TagField.TITLE),
                lambda target: self._note_rename(record.track_id, target),
            )
        except (TagsWriteError, RenameError) as error:
            return record.write_failed(_track_reason(error.reason))
        outcome = WriteOutcome(written.fields, written.artwork, renamed.truncated)
        return record.written_to(renamed.path, outcome)

    def _note_rename(self, track_id: str, target: Path) -> None:
        """Note le chemin cible au dump avant que le fichier ne bouge.

        Une coupure entre les deux laisse un chemin que le rollback retrouve par l'ancien
        nom. Un dump qui ne se met pas a jour n'arrete rien : le morceau passe `written`, son
        rollback echouera en `file_missing`, faute de chemin renomme.
        """
        try:
            self._dump = record_renamed_path(self._dump_folder, self._dump, track_id, target)
        except TagDumpError:
            logger.exception(
                "tag dump not updated after rename run=%s track=%d",
                self._live.run_id,
                self._live.position(track_id),
            )

    def _settle(self, record: TrackRecord) -> None:
        self._live.update(record)
        if record.state is TrackState.WRITE_ERROR:
            logger.error(
                "write failed run=%s track=%d reason=%s",
                self._live.run_id,
                self._live.position(record.track_id),
                record.failure_reason,
            )
        self._on_event(TrackResolved(record))
        self._processed += 1
        self._on_event(WriteProgress(self._processed, self._total))


def _track_reason(reason: FileFailureReason) -> FailureReason:
    return FailureReason(reason.value)


def _unreadable_reason(error: TagsUnreadableError) -> FailureReason:
    """Motif d'une lecture en echec.

    `LOCKED` prime : un verrou est un `PermissionError` sans `winerror`, lu comme un refus.
    """
    if error.reason is UnreadableReason.LOCKED:
        return FailureReason.FILE_LOCKED
    cause = error.__cause__
    while cause is not None and not isinstance(cause, OSError):
        cause = cause.__cause__
    if isinstance(cause, OSError):
        return _track_reason(file_failure_reason(cause))
    return FailureReason.WRITE_FAILED
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_writing.py --no-cov -q`
Expected: PASS (17 tests)

- [ ] **Step 5: Lancer le gate**

Run: `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar`
Expected: tout passe. Restent non couverts, volontairement : `__repr__`, le `raise read` d'une exception inattendue et la `ValueError` d'un résolu sans candidat.

- [ ] **Step 6: Commit**

```bash
git add sidecar/src/tagger/writing.py sidecar/tests/unit/test_writing.py
git commit -m "feat(sidecar): écrire un run confirmé et relancer ses échecs d'écriture"
```

---

### Task 3: Arborescence du sidecar

**Files:**
- Modify: `docs/ARCHITECTURE.md:113-133`

- [ ] **Step 1: Ajouter le module**

Charger `Skill[architecture-doc]` avant d'éditer. Dans `docs/ARCHITECTURE.md`, arborescence du sidecar (l. 113-133) : ajouter après `tagging.py` la ligne `writing.py  # phase d'écriture d'un run : dump, tags, renommage, relance`, au même alignement que ses voisines.

- [ ] **Step 2: Vérifier le rendu**

Run: `just lint-ui`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs(sidecar): writing.py dans l'arborescence du sidecar"
```
