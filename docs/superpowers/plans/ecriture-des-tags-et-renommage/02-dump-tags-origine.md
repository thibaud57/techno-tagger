# Dump des tags d'origine : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sauvegarder avant réécriture les tags d'origine des champs de la table dans un dump JSON par run, conservé 30 jours ; savoir aussi les restaurer sur un fichier.

**Architecture:** `files.py` gagne `read_original_tags` (les 16 champs avec toutes leurs valeurs, le système de tags et la version ID3) et `restore_tags` (remet ces champs, retire les autres champs de la table, réenregistre dans la version ID3 d'origine). Le nouveau module `tag_dump.py` porte le fichier de dump d'un run : modèles Pydantic, écriture atomique, ajout sans écrasement, chemin après renommage, relecture versionnée et purge à 30 jours, appelée au démarrage du sidecar.

**Tech Stack:** Python 3.14, mutagen 1.48.1, pydantic 2, pytest (fixtures `blank_audio`, helpers `audio_samples`, `scraper_responses`, `tagging_api`). Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/ecriture-des-tags-et-renommage/02-dump-tags-origine-design.md`

## Global Constraints

- **Dépend du sub-project 01, implémenté avant** : `files.TagField`, `TAG_FIELDS`, `TagValues`, `project_tags`, `write_tags`, `TagsWriteError`, `_id3_frame(frame_id, value: str)`, `_write_failure(path, error)` qui calcule le motif d'échec, `file_failures.FileFailureReason`, `file_failure_reason` et `untyped_calls_exclude = ["mutagen"]` dans `[tool.mypy]`.
- **Le dump ne garde que les 16 champs de la table**, avec toutes leurs valeurs, le système de tags et la version ID3. Ni images, ni commentaires, ni tags hors table.
- **Restauration** : champ du dump remis à l'identique, champ absent du dump retiré, fichier réenregistré en v2.4 s'il l'était, sinon `update_to_v23()` puis `save(v2_version=3)`. Images, commentaires et tags hors table jamais touchés.
- **Fichier de dump** : `app_data_dir() / "dumps" / "<YYYYMMDDTHHMMSSZ>-<run_id>.json"`, horodatage au format `reports.TIMESTAMP_FORMAT`, en UTC, `schema_version` = 1.
- **Jamais d'écrasement** d'une entrée déjà présente dans le dump.
- **Le disque fait foi** : `save_entries` et `record_renamed_path` fusionnent sur le dump du disque, pas sur celui que l'appelant garde en mémoire, qu'un rollback a pu vider de ses entrées restaurées. Les entrées gardent leur ordre d'écriture, que le rollback parcourt à l'envers.
- **Écriture atomique** : fichier `.tmp` voisin puis `replace` ; un échec ne laisse aucun fichier partiel et lève `TagDumpWriteError`.
- **Version de schéma inconnue ou JSON illisible** : `TagDumpUnreadableError`, `params` = `file`, `found`, `expected`.
- **Purge** au démarrage du sidecar : dumps dont l'horodatage du nom a plus de 30 jours, quel que soit l'état du run ; nom non reconnu ignoré ; une erreur de purge est loguée, jamais fatale.
- **Textes d'interface** : jamais le mot « dump », on parle de « sauvegarde des tags d'origine » (`.claude/rules/ngx-translate/i18n.md`).
- **Code Python sans accents**, docstrings et commentaires en français, le pourquoi seulement.
- **Tests** : noms en anglais, AAA séparé par des lignes vides, écriture dans `tmp_path`.
- **Gate vert à chaque commit** : `just lint-sidecar`, `just typecheck-sidecar`, `just test-sidecar`, plus `just lint-ui` quand les JSON de langue changent. Commits `type(scope): description`, scope `files` ou `sidecar`.

## Review Focus

- **MP3 v2.3 à deux artistes**, que mutagen relit en une seule chaîne « lior vance/mara quill » : restauré à l'identique (Task 1, `test_restores_exactly_the_original_fields_after_a_write`, cas `mp3-v23`).
- **Rollback d'un fichier que l'écriture n'a jamais atteint** (échec à l'ouverture, aucun tag) : la restauration le laisse sans champ de la table (Task 1, `test_restores_an_untagged_file_the_write_never_reached`).
- **Relance de l'écriture après un échec** : l'entrée d'origine reste celle du dump, jamais l'état déjà écrit (Task 2, `test_never_replaces_an_entry_already_saved`).
- **Disque plein au moment d'écrire le dump** : erreur levée, aucun fichier partiel dans le dossier (Task 2, `test_leaves_no_partial_file_when_the_dump_cannot_be_written`).
- **Rollback entre deux écritures** : le dump que l'écrivain garde en mémoire est périmé, la fusion repart de celui du disque (Task 2, `test_merges_onto_the_dump_on_disk`).
- **Fichier étranger dans `dumps/`** (`notes.json`) : ignoré par la purge, jamais supprimé (Task 2, `test_purges_dumps_older_than_thirty_days`).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `sidecar/src/tagger/files.py` | `TagSystem`, `OriginalTags`, `read_original_tags`, `restore_tags` (qui réutilise `_write_failure` du sub-project 01), `_load` partagé avec `read_identity`. |
| `sidecar/src/tagger/tag_dump.py` | Modèles du dump, chemin, écriture atomique, ajout sans écrasement sur le dump du disque, chemin renommé, relecture, purge, erreurs. |
| `sidecar/src/tagger/__main__.py` | Purge au démarrage. |
| `sidecar/src/tagger/paths.py` | Docstring : le dump a sa racine. |
| `sidecar/tests/unit/test_files_restore.py` | Lecture et restauration sur les quatre formats. |
| `sidecar/tests/unit/test_tag_dump.py` | Fichier de dump et purge. |
| `public/i18n/{fr,en}.json` | Trois codes `tag_dump_*`. |
| `docs/PRODUCTION.md`, `docs/ARCHITECTURE.md`, `docs/knowledges/mutagen.md` | Durée de vie et contenu du dump, `tag_dump.py` dans l'arborescence. |

---

### Task 1: Lire et restaurer les tags d'origine

**Files:**
- Modify: `sidecar/src/tagger/files.py`
- Create: `sidecar/tests/unit/test_files_restore.py`

**Interfaces:**
- Consumes: `TagField`, `TAG_FIELDS`, `write_tags`, `TagsWriteError`, `_id3_frame`, `_write_failure` (sub-project 01) ; `FileFailureReason`, `file_failure_reason`.
- Produces: `files.TagSystem` (`StrEnum` : `ID3`, `VORBIS`) ; `files.OriginalTags(system: TagSystem, id3_version: int | None, fields: Mapping[TagField, tuple[str, ...]])`, dataclass gelée ; `files.read_original_tags(path: Path) -> OriginalTags` (lève `TagsUnreadableError`) ; `files.restore_tags(path: Path, original: OriginalTags) -> None` (lève `TagsWriteError`). Le sub-project 04 lit avant d'écrire, le 06 restaure, le 07 affiche la colonne Avant.

- [ ] **Step 1: Écrire les tests**

`sidecar/tests/unit/test_files_restore.py` :

```python
"""Tests de la lecture des tags d'origine et de leur restauration, sur les quatre formats."""

from types import MappingProxyType
from typing import TYPE_CHECKING

import mutagen
import pytest
from audio_samples import write_tagged_wavpack
from mutagen import MutagenError
from mutagen.flac import FLAC
from mutagen.id3 import TBPM, TDRC, TIT2, TPE1, TXXX, WOAS
from scraper_responses import track_payload
from tagging_api import JPEG

from tagger.file_failures import FileFailureReason
from tagger.files import (
    OriginalTags,
    TagField,
    TagsUnreadableError,
    TagsWriteError,
    TagSystem,
    project_tags,
    read_original_tags,
    restore_tags,
    write_tags,
)
from tagger.scraper_client import TrackCandidate

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

BEATPORT = TrackCandidate.model_validate(track_payload())
ORIGINAL_URL = "https://liorvance.bandcamp.com/track/dim-orbit"


def _tag(path: Path, id3_version: int = 3) -> None:
    """Tags d'un fichier tague ailleurs : deux artistes, titre, date complete, BPM, URL."""
    audio = mutagen.File(path)
    if isinstance(audio, FLAC):
        audio["ARTIST"] = ["lior vance", "mara quill"]
        audio["TITLE"] = ["dim orbit"]
        audio["DATE"] = ["2019-06-16"]
        audio["BPM"] = ["130"]
        audio["URL"] = [ORIGINAL_URL]
        audio.save()
        return
    audio.add_tags()
    audio.tags.add(TPE1(encoding=3, text=["lior vance", "mara quill"]))
    audio.tags.add(TIT2(encoding=3, text=["dim orbit"]))
    audio.tags.add(TDRC(encoding=3, text=["2019-06-16"]))
    audio.tags.add(TBPM(encoding=3, text=["130"]))
    audio.tags.add(WOAS(url=ORIGINAL_URL))
    if id3_version == 3:
        audio.tags.update_to_v23()
    audio.save(v2_version=id3_version)


@pytest.mark.parametrize(
    ("audio_format", "id3_version"),
    [("mp3", 3), ("mp3", 4), ("wav", 3), ("aiff", 3), ("flac", 3)],
    ids=["mp3-v23", "mp3-v24", "wav", "aiff", "flac"],
)
def test_restores_exactly_the_original_fields_after_a_write(
    blank_audio: Callable[[str], Path], audio_format: str, id3_version: int
) -> None:
    path = blank_audio(audio_format)
    _tag(path, id3_version)
    original = read_original_tags(path)
    write_tags(path, project_tags(BEATPORT), None)

    restore_tags(path, original)

    assert read_original_tags(path) == original


@pytest.mark.parametrize(
    ("audio_format", "id3_version", "expected"),
    [
        (
            "mp3",
            4,
            OriginalTags(
                TagSystem.ID3,
                4,
                MappingProxyType(
                    {
                        TagField.ARTIST: ("lior vance", "mara quill"),
                        TagField.TITLE: ("dim orbit",),
                        TagField.DATE: ("2019-06-16",),
                        TagField.BPM: ("130",),
                        TagField.URL: (ORIGINAL_URL,),
                    }
                ),
            ),
        ),
        (
            "flac",
            3,
            OriginalTags(
                TagSystem.VORBIS,
                None,
                MappingProxyType(
                    {
                        TagField.ARTIST: ("lior vance", "mara quill"),
                        TagField.TITLE: ("dim orbit",),
                        TagField.DATE: ("2019-06-16",),
                        TagField.BPM: ("130",),
                        TagField.URL: (ORIGINAL_URL,),
                    }
                ),
            ),
        ),
    ],
    ids=["id3-v24", "vorbis"],
)
def test_reads_every_value_of_the_original_fields(
    blank_audio: Callable[[str], Path],
    audio_format: str,
    id3_version: int,
    expected: OriginalTags,
) -> None:
    path = blank_audio(audio_format)
    _tag(path, id3_version)

    original = read_original_tags(path)

    assert original == expected


@pytest.mark.parametrize("id3_version", [3, 4], ids=["v23", "v24"])
def test_saves_the_file_back_in_its_original_id3_version(
    blank_audio: Callable[[str], Path], id3_version: int
) -> None:
    path = blank_audio("mp3")
    _tag(path, id3_version)
    original = read_original_tags(path)
    write_tags(path, project_tags(BEATPORT), None)

    restore_tags(path, original)

    # Rechargees sans la remontee en v2.4 : les frames telles qu'ecrites sur le disque.
    on_disk = type(mutagen.File(path))(path, translate=False).tags
    assert on_disk.version == (2, id3_version, 0)
    expected_dates = {"TYER", "TDAT"} if id3_version == 3 else {"TDRC"}
    assert expected_dates <= on_disk.keys()


@pytest.mark.parametrize("audio_format", ["mp3", "flac"], ids=["id3", "vorbis"])
def test_restores_an_untagged_file_without_any_field_of_the_table(
    blank_audio: Callable[[str], Path], audio_format: str
) -> None:
    path = blank_audio(audio_format)
    original = read_original_tags(path)
    write_tags(path, project_tags(BEATPORT), None)

    restore_tags(path, original)

    assert original.fields == {}
    assert read_original_tags(path).fields == {}


def test_restores_an_untagged_file_the_write_never_reached(
    blank_audio: Callable[[str], Path],
) -> None:
    path = blank_audio("wav")
    original = read_original_tags(path)

    restore_tags(path, original)

    assert read_original_tags(path).fields == {}


@pytest.mark.parametrize("name", ["track.wav", "notes.txt"], ids=["wavpack", "unknown"])
def test_refuses_to_restore_a_file_outside_the_four_formats(tmp_path: Path, name: str) -> None:
    path = tmp_path / name
    if name == "track.wav":
        write_tagged_wavpack(path)
    else:
        path.write_bytes(b"not an audio file" * 16)
    original = OriginalTags(TagSystem.ID3, 3, MappingProxyType({}))

    with pytest.raises(TagsWriteError) as error:
        restore_tags(path, original)

    assert error.value.reason is FileFailureReason.WRITE_FAILED


def test_leaves_pictures_and_foreign_tags_alone(
    blank_audio: Callable[[str], Path], tmp_path: Path
) -> None:
    path = blank_audio("mp3")
    audio = mutagen.File(path)
    audio.add_tags()
    audio.tags.add(TXXX(encoding=3, desc="SERATO_PLAYCOUNT", text=["12"]))
    audio.save(v2_version=3)
    original = read_original_tags(path)
    cover = tmp_path / "cover.jpg"
    cover.write_bytes(JPEG)
    write_tags(path, project_tags(BEATPORT), cover)

    restore_tags(path, original)

    tags = mutagen.File(path).tags
    assert str(tags["TXXX:SERATO_PLAYCOUNT"]) == "12"
    assert [frame.data for frame in tags.getall("APIC")] == [JPEG]


def test_raises_file_locked_when_restoring_a_locked_file(
    blank_audio: Callable[[str], Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    path = blank_audio("mp3")
    original = read_original_tags(path)

    def locked_file(_path: Path) -> None:
        raise MutagenError("file in use") from OSError(
            32, "The process cannot access the file", None, 32
        )

    monkeypatch.setattr(mutagen, "File", locked_file)

    with pytest.raises(TagsWriteError) as error:
        restore_tags(path, original)

    assert error.value.reason is FileFailureReason.FILE_LOCKED


def test_refuses_to_read_a_container_outside_the_four_formats(tmp_path: Path) -> None:
    path = write_tagged_wavpack(tmp_path / "track.wav")

    with pytest.raises(TagsUnreadableError, match="unreadable tags"):
        read_original_tags(path)
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_files_restore.py --no-cov -q`
Expected: FAIL, `ImportError: cannot import name 'OriginalTags' from 'tagger.files'`

- [ ] **Step 3: Déclarer les types**

Dans `sidecar/src/tagger/files.py`, retirer la ligne `# TODO: implement, dump des tags d'origine avant reecriture (Feature 5).` et la ligne vide qui la suit. Compléter les imports mutagen :

```python
from mutagen.aiff import AIFF
from mutagen.flac import FLAC, Picture, VCFLACDict
from mutagen.id3 import APIC, ID3, TXXX, WOAS, Encoding, Frame, Frames, PictureType
from mutagen.mp3 import MP3
from mutagen.wave import WAVE
```

Après `_ARTWORK_MIME` :

```python
# Seule version ID3 autre que la cible v2.3 qu'un fichier peut porter et retrouver.
_ID3_V24: Final = 4
```

Avant `WrittenTags` :

```python
@verify(UNIQUE)
class TagSystem(StrEnum):
    """Systeme de tags : ID3 pour MP3, WAV et AIFF, Vorbis pour FLAC."""

    ID3 = auto()
    VORBIS = auto()


@dataclass(frozen=True, slots=True)
class OriginalTags:
    """Champs de la table tels que le fichier les porte, de quoi le restaurer.

    `id3_version` vaut 3 ou 4, `None` pour un fichier sans tag ID3 et pour un FLAC.
    """

    system: TagSystem
    id3_version: int | None
    fields: Mapping[TagField, tuple[str, ...]]
```

- [ ] **Step 4: Partager l'ouverture et lire les tags d'origine**

Dans `read_identity`, remplacer tout le bloc qui va du `try:` jusqu'à `match audio.tags:` inclus par :

```python
    _, tags = _load(path)
    match tags:
```

Après `read_identity` :

```python
def read_original_tags(path: Path) -> OriginalTags:
    """Champs de la table avec toutes leurs valeurs, sans jamais ecrire le fichier.

    Ni jointes ni nettoyees : la restauration doit rendre le fichier tel qu'il etait.
    """
    match _load(path):
        case FLAC(), VCFLACDict() as comments:
            fields = {
                field: tuple(comments[keys.vorbis])
                for field, keys in TAG_FIELDS.items()
                if keys.vorbis in comments
            }
            return OriginalTags(TagSystem.VORBIS, None, MappingProxyType(fields))
        case FLAC(), None:
            return OriginalTags(TagSystem.VORBIS, None, MappingProxyType({}))
        case MP3() | WAVE() | AIFF(), ID3() as tags:
            fields = {
                field: _id3_values(tags, keys.id3)
                for field, keys in TAG_FIELDS.items()
                if keys.id3 in tags
            }
            return OriginalTags(TagSystem.ID3, tags.version[1], MappingProxyType(fields))
        case MP3() | WAVE() | AIFF(), None:
            return OriginalTags(TagSystem.ID3, None, MappingProxyType({}))
        case _:
            raise TagsUnreadableError(path, UnreadableReason.UNREADABLE)


def _load(path: Path) -> tuple[object, object]:
    """Fichier et tags charges par mutagen, ou l'erreur de lecture qui les nomme."""
    try:
        audio = mutagen.File(path)
    except (MutagenError, OSError) as exc:
        # Un fichier tenu par un lecteur audio remonte en PermissionError sous
        # l'erreur de mutagen : seul __cause__ le distingue d'une corruption.
        cause = exc.__cause__ or exc
        reason = (
            UnreadableReason.LOCKED
            if isinstance(cause, PermissionError)
            else UnreadableReason.UNREADABLE
        )
        raise TagsUnreadableError(path, reason) from exc

    if audio is None:
        raise TagsUnreadableError(path, UnreadableReason.UNREADABLE)
    return audio, audio.tags


def _id3_values(tags: ID3, frame_id: str) -> tuple[str, ...]:
    frame = tags[frame_id]
    if frame_id == "WOAS":
        return (str(frame.url),)
    return tuple(str(value) for value in frame.text)
```

`_load` rend des `object` : `mutagen.File` n'est pas annoté ; un `FileType` typé ferait de `.tags` un `None` pour mypy.

- [ ] **Step 5: Restaurer**

`restore_tags` lève ses échecs par `_write_failure`, que le sub-project 01 a posé avec `write_tags`. Dans `_write_id3`, l'appel devient `tags.setall(frame_id, [_id3_frame(frame_id, (value,))])` ; `_id3_frame` accepte plusieurs valeurs :

```python
def _id3_frame(frame_id: str, values: Sequence[str]) -> Frame:
    kind, _, description = frame_id.partition(":")
    if kind == "TXXX":
        return TXXX(encoding=Encoding.UTF8, desc=description, text=list(values))
    if kind == "WOAS":
        return WOAS(url=values[0])
    return Frames[kind](encoding=Encoding.UTF8, text=list(values))
```

Après `write_tags` :

```python
def restore_tags(path: Path, original: OriginalTags) -> None:
    """Rend au fichier les champs du dump, dans sa version ID3 d'origine.

    Un champ absent du dump est retire : l'ecriture l'a ajoute. Le reste n'est pas touche.
    """
    try:
        audio = mutagen.File(path)
        if audio is None:
            raise TagsWriteError(path, FileFailureReason.WRITE_FAILED)
        if audio.tags is None:
            audio.add_tags()
        match audio, audio.tags:
            case FLAC() as flac, VCFLACDict() as comments:
                _restore_vorbis(comments, original)
                flac.save()
            case _, ID3() as tags:
                _restore_id3(tags, original)
                if original.id3_version == _ID3_V24:
                    audio.save(v2_version=_ID3_V24)
                else:
                    tags.update_to_v23()
                    audio.save(v2_version=3)
            case _:
                raise TagsWriteError(path, FileFailureReason.WRITE_FAILED)
    except (MutagenError, OSError) as exc:
        raise _write_failure(path, exc) from exc


def _restore_id3(tags: ID3, original: OriginalTags) -> None:
    for field, keys in TAG_FIELDS.items():
        if field in original.fields:
            tags.setall(keys.id3, [_id3_frame(keys.id3, original.fields[field])])
        else:
            tags.delall(keys.id3)


def _restore_vorbis(comments: VCFLACDict, original: OriginalTags) -> None:
    for field, keys in TAG_FIELDS.items():
        if field in original.fields:
            comments[keys.vorbis] = list(original.fields[field])
        elif keys.vorbis in comments:
            del comments[keys.vorbis]
```

- [ ] **Step 6: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_files_restore.py tests/unit/test_files_write.py tests/unit/test_files_identity.py --no-cov -q`
Expected: PASS

- [ ] **Step 7: Lancer le gate**

Run: `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar`
Expected: tout passe, `files.py` couvert à 100 %.

- [ ] **Step 8: Commit**

```bash
git add sidecar/src/tagger/files.py sidecar/tests/unit/test_files_restore.py
git commit -m "feat(files): lire et restaurer les tags d'origine d'un fichier"
```

---

### Task 2: Fichier de dump d'un run et purge au démarrage

**Files:**
- Create: `sidecar/src/tagger/tag_dump.py`
- Create: `sidecar/tests/unit/test_tag_dump.py`
- Modify: `sidecar/src/tagger/__main__.py` (imports, `main`, nouvelle `_purge_old_dumps`)
- Modify: `sidecar/src/tagger/paths.py:1-5` (docstring)
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`

**Interfaces:**
- Consumes: `OriginalTags`, `TagField`, `TagSystem` (Task 1) ; `paths.app_data_dir`, `reports.TIMESTAMP_FORMAT`.
- Produces: `tag_dump.DumpEntry` (`path: Path`, `renamed_path: Path | None`, `system`, `id3_version`, `fields`, `DumpEntry.of(path, original)`, `.original_tags()`), `tag_dump.TagDump` (`schema_version`, `run_id`, `created_at`, `entries: dict[str, DumpEntry]`), `dump_dir() -> Path`, `dump_path(folder, dump) -> Path`, `save_entries(folder, dump, entries) -> TagDump`, `record_renamed_path(folder, dump, track_id, renamed) -> TagDump`, `load_dump(path) -> TagDump`, `purge_dumps(folder, now) -> None`, erreurs `TagDumpError`, `TagDumpWriteError`, `TagDumpUnreadableError`. Le sub-project 04 crée le dump et enregistre le chemin renommé, le 06 le relit.

- [ ] **Step 1: Écrire les tests**

`sidecar/tests/unit/test_tag_dump.py` :

```python
"""Tests du fichier de dump : ecriture, ajout sans ecrasement, relecture, purge."""

import json
from datetime import UTC, datetime
from pathlib import Path
from types import MappingProxyType

import pytest

from tagger.files import OriginalTags, TagField, TagSystem
from tagger.tag_dump import (
    DumpEntry,
    TagDump,
    TagDumpUnreadableError,
    TagDumpWriteError,
    dump_path,
    load_dump,
    purge_dumps,
    record_renamed_path,
    save_entries,
)

CREATED = datetime(2026, 10, 6, 21, 14, 3, tzinfo=UTC)
ORIGIN = OriginalTags(
    TagSystem.ID3,
    3,
    MappingProxyType({TagField.ARTIST: ("lior vance",), TagField.BPM: ("130",)}),
)
WRITTEN = OriginalTags(TagSystem.ID3, 3, MappingProxyType({TagField.ARTIST: ("Lior Vance",)}))


def _entry(name: str, original: OriginalTags = ORIGIN) -> DumpEntry:
    return DumpEntry.of(Path("D:/Sets/Octobre") / name, original)


def _dump() -> TagDump:
    return TagDump(run_id="a3f9c1", created_at=CREATED)


def test_names_the_dump_after_its_time_and_run(tmp_path: Path) -> None:
    path = dump_path(tmp_path, _dump())

    assert path == tmp_path / "20261006T211403Z-a3f9c1.json"


def test_reloads_the_entries_it_saved(tmp_path: Path) -> None:
    saved = save_entries(tmp_path, _dump(), {"dim orbit.mp3": _entry("dim orbit.mp3")})

    reloaded = load_dump(dump_path(tmp_path, saved))

    assert reloaded == saved
    assert reloaded.entries["dim orbit.mp3"].original_tags() == ORIGIN


def test_never_replaces_an_entry_already_saved(tmp_path: Path) -> None:
    first = save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3")})

    second = save_entries(
        tmp_path, first, {"a.mp3": _entry("a.mp3", WRITTEN), "b.mp3": _entry("b.mp3")}
    )

    reloaded = load_dump(dump_path(tmp_path, second))
    assert reloaded.entries["a.mp3"].original_tags() == ORIGIN
    assert set(reloaded.entries) == {"a.mp3", "b.mp3"}


def test_merges_onto_the_dump_on_disk(tmp_path: Path) -> None:
    save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3")})

    saved = save_entries(tmp_path, _dump(), {"b.mp3": _entry("b.mp3")})

    assert set(load_dump(dump_path(tmp_path, saved)).entries) == {"a.mp3", "b.mp3"}


def test_records_where_a_track_was_renamed(tmp_path: Path) -> None:
    saved = save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3")})
    renamed = Path("D:/Sets/Octobre/Lior Vance - Dim Orbit (Extended Mix).mp3")

    updated = record_renamed_path(tmp_path, saved, "a.mp3", renamed)

    assert load_dump(dump_path(tmp_path, updated)).entries["a.mp3"].renamed_path == renamed


def test_refuses_a_dump_of_an_unknown_version(tmp_path: Path) -> None:
    path = tmp_path / "20261006T211403Z-a3f9c1.json"
    path.write_text(json.dumps({"schema_version": 2, "run_id": "a3f9c1"}), encoding="utf-8")

    with pytest.raises(TagDumpUnreadableError, match="unreadable tag dump") as error:
        load_dump(path)

    assert error.value.params == {"file": path.name, "found": 2, "expected": 1}


@pytest.mark.parametrize(
    "content",
    ["{not json", '{"schema_version": 1, "run_id": 42}'],
    ids=["broken-json", "invalid-fields"],
)
def test_refuses_an_unreadable_dump(tmp_path: Path, content: str) -> None:
    path = tmp_path / "20261006T211403Z-a3f9c1.json"
    path.write_text(content, encoding="utf-8")

    with pytest.raises(TagDumpUnreadableError):
        load_dump(path)


def test_leaves_no_partial_file_when_the_dump_cannot_be_written(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def full_disk(_self: Path, _target: Path) -> Path:
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(Path, "replace", full_disk)

    with pytest.raises(TagDumpWriteError, match="tag dump not written"):
        save_entries(tmp_path, _dump(), {"a.mp3": _entry("a.mp3")})

    assert list(tmp_path.iterdir()) == []


def test_purges_dumps_older_than_thirty_days(tmp_path: Path) -> None:
    names = [
        "20260905T211402Z-1b2c3d.json",
        "20260919T000000Z-9e8f7a.json",
        "notes.json",
        "notes.txt",
    ]
    for name in names:
        (tmp_path / name).write_text("{}", encoding="utf-8")

    purge_dumps(tmp_path, CREATED)

    assert sorted(path.name for path in tmp_path.iterdir()) == names[1:]


def test_purge_ignores_a_missing_folder(tmp_path: Path) -> None:
    purge_dumps(tmp_path / "dumps", CREATED)

    assert not (tmp_path / "dumps").exists()
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_tag_dump.py --no-cov -q`
Expected: FAIL, `ModuleNotFoundError: No module named 'tagger.tag_dump'`

- [ ] **Step 3: Écrire le module**

`sidecar/src/tagger/tag_dump.py` :

```python
"""Dump des tags d'origine d'un run, de quoi les restaurer pendant 30 jours (ADR-010).

Un fichier par run, hors plan de run : un run rate se decouvre au lancement suivant.
Seuls les champs de la table y vont, ni images ni commentaires.
"""

import contextlib
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import MappingProxyType
from typing import TYPE_CHECKING, ClassVar, Final, Self

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from tagger.errors import TaggerError
from tagger.files import OriginalTags, TagField, TagSystem
from tagger.paths import app_data_dir
from tagger.reports import TIMESTAMP_FORMAT

if TYPE_CHECKING:
    from collections.abc import Mapping

SCHEMA_VERSION: Final = 1
RETENTION: Final = timedelta(days=30)
_SUFFIX: Final = ".json"


class DumpEntry(BaseModel):
    """Etat d'origine d'un morceau, et ou le retrouver apres son renommage."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    path: Path
    renamed_path: Path | None = None
    system: TagSystem
    id3_version: int | None
    fields: dict[TagField, tuple[str, ...]]

    @classmethod
    def of(cls, path: Path, original: OriginalTags) -> Self:
        return cls(
            path=path,
            system=original.system,
            id3_version=original.id3_version,
            fields=dict(original.fields),
        )

    def original_tags(self) -> OriginalTags:
        return OriginalTags(self.system, self.id3_version, MappingProxyType(self.fields))


class TagDump(BaseModel):
    """Dump d'un run tel qu'il est ecrit sur le disque, entrees par `track_id`."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    schema_version: int = SCHEMA_VERSION
    run_id: str
    created_at: datetime
    entries: dict[str, DumpEntry] = Field(default_factory=dict)


class TagDumpError(TaggerError):
    """Erreur d'ecriture ou de lecture d'un dump des tags d'origine."""

    code: ClassVar[str] = "tag_dump_error"


class TagDumpWriteError(TagDumpError):
    """Le dump n'a pas pu etre ecrit : sans lui, aucun fichier ne doit l'etre."""

    code: ClassVar[str] = "tag_dump_write_failed"

    def __init__(self, path: Path) -> None:
        super().__init__(f"tag dump not written: {path.name}", file=path.name)


class TagDumpUnreadableError(TagDumpError):
    """Dump illisible ou d'une version de schema inconnue, jamais migre (ADR-018)."""

    code: ClassVar[str] = "tag_dump_unreadable"

    def __init__(self, path: Path, found: object = None) -> None:
        super().__init__(
            f"unreadable tag dump: {path.name}",
            file=path.name,
            found=found,
            expected=SCHEMA_VERSION,
        )


def dump_dir() -> Path:
    """Dossier des dumps, sous la racine des donnees de l'application."""
    return app_data_dir() / "dumps"


def dump_path(folder: Path, dump: TagDump) -> Path:
    """Nom horodate : le dernier run et l'age d'un dump se lisent sans l'ouvrir."""
    return folder / f"{dump.created_at.strftime(TIMESTAMP_FORMAT)}-{dump.run_id}{_SUFFIX}"


def save_entries(folder: Path, dump: TagDump, entries: Mapping[str, DumpEntry]) -> TagDump:
    """Ajoute les entrees absentes du disque, dans l'ordre d'ecriture que le rollback inverse.

    Le disque fait foi : un rollback a pu y consommer des entrees que l'appelant garde en
    memoire. Une entree presente n'est jamais remplacee, l'origine d'une relance reste la premiere.
    """
    base = _on_disk(folder, dump)
    added = {track_id: entry for track_id, entry in entries.items() if track_id not in base.entries}
    merged = base.model_copy(update={"entries": {**base.entries, **added}})
    _write(dump_path(folder, merged), merged)
    return merged


def record_renamed_path(folder: Path, dump: TagDump, track_id: str, renamed: Path) -> TagDump:
    """Retient ou trouver le fichier apres son renommage, pour le rendre a son nom."""
    base = _on_disk(folder, dump)
    entry = base.entries[track_id].model_copy(update={"renamed_path": renamed})
    updated = base.model_copy(update={"entries": {**base.entries, track_id: entry}})
    _write(dump_path(folder, updated), updated)
    return updated


def load_dump(path: Path) -> TagDump:
    """Relit un dump ; une version de schema inconnue est refusee, jamais migree."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise TagDumpUnreadableError(path) from exc

    found = raw.get("schema_version") if isinstance(raw, dict) else None
    if found != SCHEMA_VERSION:
        raise TagDumpUnreadableError(path, found)
    try:
        return TagDump.model_validate(raw)
    except ValidationError as exc:
        raise TagDumpUnreadableError(path, found) from exc


def purge_dumps(folder: Path, now: datetime) -> None:
    """Supprime les dumps de plus de 30 jours, que leur run ait ete ecrit ou non."""
    if not folder.is_dir():
        return
    for path in folder.glob(f"*{_SUFFIX}"):
        created = _created_at(path)
        if created is not None and now - created > RETENTION:
            path.unlink(missing_ok=True)


def _on_disk(folder: Path, dump: TagDump) -> TagDump:
    """Le dump tel que le disque le porte, vide s'il n'y est pas encore."""
    path = dump_path(folder, dump)
    if path.is_file():
        return load_dump(path)
    return dump.model_copy(update={"entries": {}})


def _created_at(path: Path) -> datetime | None:
    stamp, _, _ = path.stem.partition("-")
    try:
        return datetime.strptime(stamp, TIMESTAMP_FORMAT).replace(tzinfo=UTC)
    except ValueError:
        return None


def _write(path: Path, dump: TagDump) -> None:
    """Ecriture atomique : un fichier temporaire voisin, puis remplacement."""
    pending = path.with_suffix(".tmp")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        pending.write_text(dump.model_dump_json(indent=2), encoding="utf-8")
        pending.replace(path)
    except OSError as exc:
        with contextlib.suppress(OSError):
            pending.unlink(missing_ok=True)
        raise TagDumpWriteError(path) from exc
```

- [ ] **Step 4: Purger au démarrage**

Dans `sidecar/src/tagger/__main__.py`, ajouter `from datetime import UTC, datetime` après `import sys` et `from tagger.tag_dump import dump_dir, purge_dumps` avant `from tagger.url_recovery import UrlRecoveryNotOpenError`. Dans `main()`, juste après `init_sentry(SENTRY_DSN, RELEASE)` :

```python
    _purge_old_dumps()
```

Puis, avant `async def run_loop` :

```python
def _purge_old_dumps() -> None:
    # Une purge ratee ne doit jamais empecher le sidecar de demarrer : le dump reste
    # au pire quelques jours de plus.
    try:
        purge_dumps(dump_dir(), datetime.now(UTC))
    except OSError:
        logger.exception("tag dump purge failed")
```

Dans `sidecar/src/tagger/paths.py`, la docstring devient :

```python
"""Racine des donnees de l'application, source unique des chemins sous `appLocalDataDir()`."""
```

- [ ] **Step 5: Traduire les trois codes**

`test_error_translations.py` exige une phrase pour tout `TaggerError`. Dans `errors`, juste après `tags_write_failed` :

`public/i18n/fr.json` :

```json
    "tag_dump_error": "La sauvegarde des tags d'origine a échoué.",
    "tag_dump_write_failed": "Les tags d'origine n'ont pas pu être sauvegardés.",
    "tag_dump_unreadable": "La sauvegarde des tags d'origine est illisible ou d'une autre version de l'application.",
```

`public/i18n/en.json` :

```json
    "tag_dump_error": "Saving the original tags failed.",
    "tag_dump_write_failed": "The original tags could not be saved.",
    "tag_dump_unreadable": "The saved original tags are unreadable or come from another version of the application.",
```

- [ ] **Step 6: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_tag_dump.py tests/unit/test_error_translations.py --no-cov -q`
Expected: PASS

- [ ] **Step 7: Lancer le gate**

Run: `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar && just lint-ui`
Expected: tout passe.

- [ ] **Step 8: Commit**

```bash
git add sidecar/src/tagger/tag_dump.py sidecar/src/tagger/__main__.py sidecar/src/tagger/paths.py sidecar/tests/unit/test_tag_dump.py public/i18n/fr.json public/i18n/en.json
git commit -m "feat(sidecar): dump des tags d'origine par run, purgé après 30 jours"
```

---

### Task 3: Durée de vie et contenu du dump dans la documentation

**Files:**
- Modify: `docs/PRODUCTION.md:293,636,642,654`
- Modify: `docs/ARCHITECTURE.md:113-133,590`
- Modify: `docs/knowledges/mutagen.md` (§ Dump des tags d'origine pour le rollback)

**Interfaces:**
- Consumes: les décisions du spec.
- Produces: docs alignées sur l'ADR-010 et le code livré.

- [ ] **Step 1: PRODUCTION.md**

Charger `Skill[production-doc]` et lire son template avant d'éditer. Dans `docs/PRODUCTION.md` :
- l. 293 : `dump des tags d'origine conservé avec le plan de run` → `dump des tags d'origine, conservé 30 jours indépendamment du plan de run` ;
- l. 636 : retirer « dump des tags » de la ligne « Plan de run, dump des tags, cache » puis ajouter juste dessous une ligne `| Dump des tags d'origine (machine utilisateur) | Avant l'écriture d'un run | 30 jours, même pour un run terminé | appLocalDataDir()/dumps, aucune sauvegarde |` ;
- l. 642 : `le dump des tags d'origine vit avec le plan qu'il sert à annuler` → `le dump des tags d'origine vit 30 jours pour qu'un run raté puisse s'annuler au lancement suivant (ADR-010)` ;
- l. 654 : `tant que le plan n'a pas été purgé (30 jours)` → `tant que son dump n'a pas été purgé (30 jours)`.

- [ ] **Step 2: ARCHITECTURE.md**

Charger `Skill[architecture-doc]`. Dans `docs/ARCHITECTURE.md` § Données, ligne « Dump des tags d'origine » (l. 590) : emplacement `appLocalDataDir()/dumps`, un JSON par run nommé par son horodatage et son `run_id`, rôle complété par « 16 champs de la table seuls, ni images ni commentaires » ; arborescence du sidecar (l. 113-133) : ajouter après `files.py` la ligne `tag_dump.py  # dump des tags d'origine d'un run, purgé après 30 jours`, au même alignement que ses voisines.

- [ ] **Step 3: Fiche mutagen**

Charger `Skill[knowledge-doc]` et lire son template avant d'éditer. Dans `docs/knowledges/mutagen.md` § Dump des tags d'origine pour le rollback :
- remplacer l'exemple `dump_tags` par un exemple qui lit les seuls champs de la table avec toutes leurs valeurs et la version ID3 (`tags.version[1]`) ;
- ajouter aux Points Importants : « **Restaurer dans la version d'origine** : `save(v2_version=4)` pour un fichier arrivé en v2.4, sinon `update_to_v23()` puis `save(v2_version=3)`, et retirer les champs de la table absents du dump, que l'écriture a ajoutés » et « **Valeurs multiples d'un v2.3** : mutagen les relit en une seule chaîne jointe par `/`, restaurée telle quelle ».

- [ ] **Step 4: Vérifier le rendu**

Run: `just lint-ui`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add docs/PRODUCTION.md docs/ARCHITECTURE.md docs/knowledges/mutagen.md
git commit -m "docs(sidecar): durée de vie et contenu du dump des tags d'origine"
```
