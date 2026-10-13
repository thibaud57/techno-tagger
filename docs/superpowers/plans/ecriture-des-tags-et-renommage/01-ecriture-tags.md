# Écriture des tags d'un fichier : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Écrire dans un fichier MP3, WAV, AIFF ou FLAC les champs de la table de correspondance de l'ADR-011 projetés depuis le candidat retenu, une seule pochette et aucun commentaire, sans toucher aux champs que la source ne renseigne pas.

**Architecture:** `file_failures.py` reçoit les motifs d'échec de fichier et leur traduction, sortis d'`extraction.py` pour servir aussi à l'écriture. `files.py` gagne la table `TagField` → `TagKeys`, la projection `project_tags(candidate)` (une chaîne par champ, absents et vides omis) et le writer `write_tags(path, values, artwork)`, qui écrit en place : ID3 par l'objet `ID3` complet puis `update_to_v23()` et `save(v2_version=3)`, Vorbis par clé, une seule image, aucun commentaire. Un échec lève `TagsWriteError` avec son motif, calculé par `_write_failure` : un fichier tenu par un autre programme, que mutagen remonte en `PermissionError` sans code Windows, se reconnaît à son inscriptibilité.

**Tech Stack:** Python 3.14, mutagen 1.48.1, pydantic 2 (`TrackCandidate`), pytest + fixtures `blank_audio` et helpers `audio_samples`, `scraper_responses`, `tagging_api`. Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/ecriture-des-tags-et-renommage/01-ecriture-tags-design.md`

## Global Constraints

- **Aucun sub-project préalable** : le code part de l'état de la branche (`files.py` en lecture seule, `extraction.failure_reason`, `matching.full_title`, `matching.credited_artists`).
- **16 champs écrits**, table du spec, `TPE2` jamais écrit. Une seule chaîne par champ, jamais une liste, artistes et remixeurs joints par `", "`.
- **Remixeur** dans `title` (par `mix_name`) et `remixer`, jamais dans `artist`.
- **Date à l'année seule** dans `date` et `original_date`, sur les quatre formats : `TYER` et `TORY` sans `TDAT` ni `TDRC` sur le disque.
- **ID3** : `update_to_v23()` puis `save(v2_version=3)`. `save(v2_version=3)` seul laisse `TDRC` et `TDOR` sur le disque (constaté le 2026-10-06 sur mutagen 1.48.1).
- **Une seule image** : avec pochette, toutes les images retirées puis la pochette posée en recto ; sans pochette lisible, recto existant gardé, à défaut la première image.
- **Zéro commentaire** : `COMM` en ID3, `COMMENT` et `DESCRIPTION` en Vorbis. Tout autre tag hors table intact.
- **Champ absent de la projection** : le tag existant reste tel quel.
- **Échec** : `TagsWriteError(path, reason: FileFailureReason)`, code `tags_write_failed`, `params` = `file` (nom du fichier) et `reason`. Aucun log dans `files.py`. Le motif se calcule dans `_write_failure(path, error)`, que le sub-project 02 réutilise pour la restauration.
- **Verrou Windows** : un fichier tenu par un autre programme fait lever à mutagen une `MutagenError` dont la cause est `PermissionError(13)` sans `winerror` (ouverture par le CRT, mesuré le 2026-10-06), que `file_failure_reason` traduit en `permission_denied`. `_write_failure` la rend `file_locked` quand le fichier reste inscriptible (`os.access(path, os.W_OK)`) : un fichier en lecture seule, seule autre cause de cette erreur, ne l'est pas.
- **Code Python sans accents**, docstrings et commentaires en français, le pourquoi seulement.
- **Tests** : noms en anglais, AAA séparé par des lignes vides, écriture dans `tmp_path`, relecture du fichier par mutagen.
- **Gate vert à chaque commit** : `just lint-sidecar`, `just typecheck-sidecar`, `just test-sidecar`. Commits `type(scope): description`, scope `sidecar` ou `files`.

## Review Focus

- **Fichier déjà en ID3v2.4** (tagué par un autre logiciel) : réécrit en v2.3, `TYER` à l'année, ni `TDRC` ni `TDAT` (Task 3, `test_saves_id3_v23_with_the_year_alone`, cas `from-v24`).
- **Texte accentué** (« Für Éline », « Señor ») : relu à l'identique en ID3v2.3 comme en FLAC (Task 3, `test_keeps_accented_text_intact`).
- **Clé Vorbis d'origine en minuscules et à plusieurs valeurs** (`artist` = deux valeurs) : remplacée par une seule valeur, sans doublon (Task 3, `test_replaces_existing_vorbis_values_whatever_their_case_or_count`).
- **Deuxième écriture du même fichier** (relance de l'écriture) : toujours une seule pochette (Task 3, `test_writing_twice_still_leaves_a_single_cover`).
- **Fichier tenu par un autre programme** : `file_locked` et non `permission_denied`, sur un vrai verrou et non une erreur fabriquée (Task 3, `test_reports_a_file_held_by_another_program_as_locked`) ; un fichier en lecture seule reste `permission_denied` (Task 3, `test_keeps_permission_denied_for_a_read_only_file`).
- **Pochette du cache illisible ou d'extension inconnue** : traitée comme absente, les tags sont écrits (Task 3, `test_treats_a_cover_the_cache_cannot_give_as_absent`, cas `unreadable` et `foreign`).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `sidecar/src/tagger/file_failures.py` | `FileFailureReason`, `file_failure_reason(OSError)`, codes d'erreur Windows. |
| `sidecar/src/tagger/extraction.py` | Importe les motifs au lieu de les définir. |
| `sidecar/src/tagger/reports.py`, `sidecar/src/tagger/protocol.py` | Importent `FileFailureReason`. |
| `sidecar/src/tagger/files.py` | Table, projection, écriture, `TagsWriteError`, `_write_failure`. |
| `sidecar/pyproject.toml` | `untyped_calls_exclude = ["mutagen"]`. |
| `sidecar/tests/unit/test_file_failures.py` | Traduction `OSError` → motif. |
| `sidecar/tests/unit/test_files_write.py` | Projection et écriture relue sur les quatre formats. |
| `sidecar/tests/helpers/audio_samples.py` | `append_id3v1`, `held_open` (verrou réel, Windows), retrait de deux ignores. |
| `public/i18n/{fr,en}.json` | `errors.tags_write_failed`. |
| `docs/adrs/011-politique-ecriture-tags.md`, `docs/ARCHITECTURE.md`, `docs/VERSIONS.md`, `docs/knowledges/mutagen.md`, `.claude/rules/mutagen/tags.md` | Décisions et correctifs du spec. |

---

### Task 1: Motifs d'échec de fichier partagés

**Files:**
- Create: `sidecar/src/tagger/file_failures.py`
- Create: `sidecar/tests/unit/test_file_failures.py`
- Modify: `sidecar/src/tagger/extraction.py` (imports l. 9-26, enum l. 45-57, `failure_reason` l. 205-224, appel l. 321)
- Modify: `sidecar/src/tagger/reports.py:24,105`
- Modify: `sidecar/src/tagger/protocol.py:26,303`
- Modify: `sidecar/tests/unit/test_extraction_run.py` (imports, test paramétré l. 214-232)
- Modify: `sidecar/tests/unit/test_error_translations.py:13,45-48`
- Modify: `sidecar/tests/helpers/extraction_samples.py:10-18,47`

**Interfaces:**
- Consumes: rien.
- Produces: `tagger.file_failures.FileFailureReason` (`StrEnum` : `PERMISSION_DENIED`, `DISK_FULL`, `PATH_TOO_LONG`, `FILE_LOCKED`, `FILE_MISSING`, `WRITE_FAILED`) et `file_failure_reason(error: OSError) -> FileFailureReason`. Valeurs inchangées : le miroir TypeScript `ExtractionFailureReason` de `src/app/core/models/protocol.ts` reste tel quel.

- [ ] **Step 1: Écrire le test de traduction**

`sidecar/tests/unit/test_file_failures.py` :

```python
"""Tests de la traduction d'une erreur systeme en motif d'echec de fichier."""

import errno

import pytest

from tagger.file_failures import FileFailureReason, file_failure_reason


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        # winerror 32 fait de cette OSError une PermissionError : le code Windows
        # doit primer sur le type, sinon un verrou passe pour un refus de droits
        (
            OSError(32, "The process cannot access the file", None, 32),
            FileFailureReason.FILE_LOCKED,
        ),
        (PermissionError(13, "Permission denied"), FileFailureReason.PERMISSION_DENIED),
        (FileNotFoundError(2, "No such file or directory"), FileFailureReason.FILE_MISSING),
        (OSError(errno.ENAMETOOLONG, "File name too long"), FileFailureReason.PATH_TOO_LONG),
        (OSError(errno.ENOSPC, "No space left on device"), FileFailureReason.DISK_FULL),
        (OSError(99, "unheard of"), FileFailureReason.WRITE_FAILED),
    ],
    ids=[
        "sharing_violation",
        "access_denied",
        "vanished_file",
        "overlong_path",
        "full_disk",
        "unknown_error",
    ],
)
def test_maps_a_system_error_to_the_project_vocabulary(
    error: OSError, expected: FileFailureReason
) -> None:
    reason = file_failure_reason(error)

    assert reason is expected
```

- [ ] **Step 2: Vérifier qu'il échoue**

Run: `cd sidecar && uv run pytest tests/unit/test_file_failures.py --no-cov -q`
Expected: FAIL, `ModuleNotFoundError: No module named 'tagger.file_failures'`

- [ ] **Step 3: Créer le module**

`sidecar/src/tagger/file_failures.py` :

```python
"""Motifs d'echec d'un fichier, communs a l'extraction et a l'ecriture : meme panne, meme nom."""

import errno
from enum import UNIQUE, StrEnum, auto, verify
from typing import Final

# Codes d'erreur Windows, absents des autres plateformes.
WINDOWS_LOCK_ERRORS: Final = frozenset({32, 33})  # SHARING_VIOLATION, LOCK_VIOLATION
WINDOWS_PATH_TOO_LONG: Final = 206  # FILENAME_EXCED_RANGE


@verify(UNIQUE)
class FileFailureReason(StrEnum):
    """Motif d'un fichier qui n'a pas pu etre copie, deplace ou ecrit."""

    PERMISSION_DENIED = auto()
    DISK_FULL = auto()
    PATH_TOO_LONG = auto()
    FILE_LOCKED = auto()
    FILE_MISSING = auto()
    WRITE_FAILED = auto()


def file_failure_reason(error: OSError) -> FileFailureReason:
    """`winerror` prime sur le type : un verrou leve `PermissionError` comme un refus de droits."""
    windows_code = getattr(error, "winerror", None)
    if windows_code in WINDOWS_LOCK_ERRORS:
        return FileFailureReason.FILE_LOCKED
    if windows_code == WINDOWS_PATH_TOO_LONG or error.errno == errno.ENAMETOOLONG:
        return FileFailureReason.PATH_TOO_LONG
    if isinstance(error, FileNotFoundError):
        return FileFailureReason.FILE_MISSING
    if isinstance(error, PermissionError):
        return FileFailureReason.PERMISSION_DENIED
    if error.errno == errno.ENOSPC:
        return FileFailureReason.DISK_FULL

    return FileFailureReason.WRITE_FAILED
```

- [ ] **Step 4: Retirer la définition d'`extraction.py`**

Dans `sidecar/src/tagger/extraction.py` :
- supprimer `import errno` et `Final` de `from typing import ...` (plus aucun usage) ;
- supprimer le commentaire « Codes d'erreur Windows » et les constantes `WINDOWS_LOCK_ERRORS`, `WINDOWS_PATH_TOO_LONG` ;
- supprimer la classe `ExtractionFailureReason` et la fonction `failure_reason` entières ;
- ajouter sous `from tagger.errors import TaggerError` :

```python
from tagger.file_failures import FileFailureReason, file_failure_reason
```

- remplacer `reason: ExtractionFailureReason` (champ d'`ExtractionFailure`) par `reason: FileFailureReason` ; dans `extract`, `reason = failure_reason(error)` par `reason = file_failure_reason(error)`.

- [ ] **Step 5: Réaligner les importeurs**

`sidecar/src/tagger/reports.py` et `sidecar/src/tagger/protocol.py`, même remplacement :

```python
from tagger.extraction import DuplicateCriterion, ExtractionMode
from tagger.file_failures import FileFailureReason
```

puis `reason: ExtractionFailureReason` → `reason: FileFailureReason` (`reports.py` dans le modèle d'échec du rapport, `protocol.py` dans `FailurePayload`).

`sidecar/tests/helpers/extraction_samples.py` : retirer `ExtractionFailureReason` de l'import `tagger.extraction`, ajouter `from tagger.file_failures import FileFailureReason` avant `from tagger.reports import ReportContext` ; `ExtractionFailureReason.FILE_LOCKED` → `FileFailureReason.FILE_LOCKED`.

`sidecar/tests/unit/test_error_translations.py` :

```python
from tagger.extraction import DuplicateCriterion
from tagger.file_failures import FileFailureReason
```

et dans le paramétrage `(FileFailureReason, ("playlist", "report", "reason"))`, id `"file-failure"`.

`sidecar/tests/unit/test_extraction_run.py` : supprimer `import errno`, retirer `ExtractionFailureReason` et `failure_reason` de l'import `tagger.extraction`, ajouter `from tagger.file_failures import FileFailureReason`, remplacer partout `ExtractionFailureReason` par `FileFailureReason` et supprimer le test paramétré `test_maps_a_system_error_to_the_project_vocabulary` (repris par `test_file_failures.py`).

- [ ] **Step 6: Formater et lancer le gate**

Run: `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar`
Expected: tout passe, `test_file_failures.py` à 6 cas verts.

- [ ] **Step 7: Commit**

```bash
git add sidecar/src/tagger/file_failures.py sidecar/src/tagger/extraction.py sidecar/src/tagger/reports.py sidecar/src/tagger/protocol.py sidecar/tests/unit/test_file_failures.py sidecar/tests/unit/test_extraction_run.py sidecar/tests/unit/test_error_translations.py sidecar/tests/helpers/extraction_samples.py
git commit -m "refactor(sidecar): partager les motifs d'échec de fichier entre extraction et écriture"
```

---

### Task 2: Table de correspondance et projection d'un candidat

**Files:**
- Modify: `sidecar/src/tagger/files.py` (imports, `TagKeys`, `IDENTITY_FIELDS` l. 35-40, `read_identity` l. 157)
- Create: `sidecar/tests/unit/test_files_write.py`

**Interfaces:**
- Consumes: `matching.full_title(candidate) -> str`, `matching.credited_artists(candidate) -> str`, `scraper_client.TrackCandidate`.
- Produces: `files.TagField` (`StrEnum` : `ARTIST`, `REMIXER`, `TITLE`, `ALBUM`, `DATE`, `ORIGINAL_DATE`, `GENRE`, `LABEL`, `CATALOG_NUMBER`, `BPM`, `KEY`, `ISRC`, `TRACK_NUMBER`, `URL`, `SOURCE_ID`, `SOURCE`, valeurs en snake_case), `files.TAG_FIELDS: Final[dict[TagField, TagKeys]]`, `type TagValues = Mapping[TagField, str]`, `files.project_tags(candidate: TrackCandidate) -> TagValues`. Les sub-projects 02, 03 et 07 s'appuient sur ces noms.

- [ ] **Step 1: Écrire les tests de projection**

`sidecar/tests/unit/test_files_write.py` :

```python
"""Tests de la projection d'un candidat et de l'ecriture des tags, relus sur le fichier."""

from scraper_responses import track_payload

from tagger.files import TagField, project_tags
from tagger.scraper_client import TrackCandidate


def _credit(name: str) -> dict[str, object]:
    return {"id": name, "name": name, "kind": "artist", "social_links": []}


def _candidate(**overrides: object) -> TrackCandidate:
    return TrackCandidate.model_validate(track_payload(**overrides))


BEATPORT = _candidate()
REMIX = _candidate(
    artists=[_credit("Adam Beyer"), _credit("Bart Skils")],
    remixers=[_credit("Layton Giordani")],
    mix_name="Layton Giordani Remix",
)
BANDCAMP = _candidate(source="bandcamp", id="42", mix_name=None, genre=None, bpm=None, key=None)


def test_projects_every_field_a_beatport_candidate_carries() -> None:
    values = project_tags(BEATPORT)

    assert dict(values) == {
        TagField.ARTIST: "Adam Beyer",
        TagField.TITLE: "Your Mind (Extended Mix)",
        TagField.ALBUM: "Your Mind",
        TagField.DATE: "2023",
        TagField.ORIGINAL_DATE: "2023",
        TagField.GENRE: "Techno (Peak Time / Driving)",
        TagField.LABEL: "Drumcode",
        TagField.CATALOG_NUMBER: "DC287",
        TagField.BPM: "134",
        TagField.KEY: "4A",
        TagField.ISRC: "ZZ0AA2300001",
        TagField.TRACK_NUMBER: "1",
        TagField.URL: "https://www.beatport.com/track/your-mind/99000101",
        TagField.SOURCE_ID: "99000101",
        TagField.SOURCE: "beatport",
    }


def test_keeps_the_remixer_out_of_the_artist() -> None:
    values = project_tags(REMIX)

    assert values[TagField.ARTIST] == "Adam Beyer, Bart Skils"
    assert values[TagField.TITLE] == "Your Mind (Layton Giordani Remix)"
    assert values[TagField.REMIXER] == "Layton Giordani"


def test_omits_the_fields_the_source_leaves_null() -> None:
    values = project_tags(BANDCAMP)

    assert {TagField.GENRE, TagField.BPM, TagField.KEY, TagField.REMIXER}.isdisjoint(values)
    assert values[TagField.SOURCE] == "bandcamp"


def test_omits_blank_values() -> None:
    values = project_tags(_candidate(genre="   ", key=""))

    assert {TagField.GENRE, TagField.KEY}.isdisjoint(values)


def test_omits_the_release_fields_without_a_release() -> None:
    values = project_tags(_candidate(release=None))

    assert {
        TagField.ALBUM,
        TagField.DATE,
        TagField.ORIGINAL_DATE,
        TagField.CATALOG_NUMBER,
    }.isdisjoint(values)
```

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_files_write.py --no-cov -q`
Expected: FAIL, `ImportError: cannot import name 'TagField' from 'tagger.files'`

- [ ] **Step 3: Déclarer la table et la projection**

Dans `sidecar/src/tagger/files.py`, imports :

```python
from dataclasses import dataclass
from enum import UNIQUE, StrEnum, auto, verify
from types import MappingProxyType
from typing import TYPE_CHECKING, ClassVar, Final, NamedTuple

import mutagen
from mutagen import MutagenError
from mutagen.flac import VCFLACDict
from mutagen.id3 import ID3

from tagger.errors import TaggerError
from tagger.matching import credited_artists, full_title

if TYPE_CHECKING:
    from collections.abc import Iterable, Mapping
    from pathlib import Path

    from tagger.scraper_client import TrackCandidate
```

Remplacer le commentaire et la constante `IDENTITY_FIELDS` (l. 35-40) par :

```python
@verify(UNIQUE)
class TagField(StrEnum):
    """Champ ecrit, cf. ADR-011 § Correspondance des champs."""

    ARTIST = auto()
    REMIXER = auto()
    TITLE = auto()
    ALBUM = auto()
    DATE = auto()
    ORIGINAL_DATE = auto()
    GENRE = auto()
    LABEL = auto()
    CATALOG_NUMBER = auto()
    BPM = auto()
    KEY = auto()
    ISRC = auto()
    TRACK_NUMBER = auto()
    URL = auto()
    SOURCE_ID = auto()
    SOURCE = auto()


# TPE2 n'y entre pas : le contrat ne rend pas d'artiste de sortie. Les dates sont en frames
# v2.4, celles de mutagen en memoire : `update_to_v23()` les ecrit en TYER et TORY.
TAG_FIELDS: Final[dict[TagField, TagKeys]] = {
    TagField.ARTIST: TagKeys(id3="TPE1", vorbis="ARTIST"),
    TagField.REMIXER: TagKeys(id3="TPE4", vorbis="REMIXER"),
    TagField.TITLE: TagKeys(id3="TIT2", vorbis="TITLE"),
    TagField.ALBUM: TagKeys(id3="TALB", vorbis="ALBUM"),
    TagField.DATE: TagKeys(id3="TDRC", vorbis="DATE"),
    TagField.ORIGINAL_DATE: TagKeys(id3="TDOR", vorbis="ORIGINALDATE"),
    TagField.GENRE: TagKeys(id3="TCON", vorbis="GENRE"),
    TagField.LABEL: TagKeys(id3="TPUB", vorbis="LABEL"),
    TagField.CATALOG_NUMBER: TagKeys(id3="TXXX:CATALOGNUMBER", vorbis="CATALOGNUMBER"),
    TagField.BPM: TagKeys(id3="TBPM", vorbis="BPM"),
    TagField.KEY: TagKeys(id3="TKEY", vorbis="KEY"),
    TagField.ISRC: TagKeys(id3="TSRC", vorbis="ISRC"),
    TagField.TRACK_NUMBER: TagKeys(id3="TRCK", vorbis="TRACKNUMBER"),
    TagField.URL: TagKeys(id3="WOAS", vorbis="URL"),
    TagField.SOURCE_ID: TagKeys(id3="TXXX:SOURCE_ID", vorbis="SOURCE_ID"),
    TagField.SOURCE: TagKeys(id3="TXXX:SOURCE", vorbis="SOURCE"),
}

IDENTITY_FIELDS: Final = {field: TAG_FIELDS[field] for field in (TagField.ARTIST, TagField.TITLE)}

# Valeurs a ecrire, un champ absent laissant le tag du fichier intact.
type TagValues = Mapping[TagField, str]
```

Dans `read_identity`, la dernière ligne devient :

```python
    return IdentityTags(artist=values[TagField.ARTIST], title=values[TagField.TITLE])
```

Ajouter après `_join` :

```python
def project_tags(candidate: TrackCandidate) -> TagValues:
    """Valeurs du candidat a ecrire, absentes et vides omises.

    Le remixeur n'entre jamais dans l'artiste ; la date se reduit a l'annee.
    """
    release = candidate.release
    year = release.release_date.year if release and release.release_date else None
    projected: dict[TagField, object] = {
        TagField.ARTIST: credited_artists(candidate),
        TagField.REMIXER: _MULTI_VALUE_SEPARATOR.join(c.name for c in candidate.remixers),
        TagField.TITLE: full_title(candidate),
        TagField.ALBUM: release.title if release else None,
        TagField.DATE: year,
        TagField.ORIGINAL_DATE: year,
        TagField.GENRE: candidate.genre,
        TagField.LABEL: candidate.label.name if candidate.label else None,
        TagField.CATALOG_NUMBER: release.catalog_number if release else None,
        TagField.BPM: candidate.bpm,
        TagField.KEY: candidate.key,
        TagField.ISRC: candidate.isrc,
        TagField.TRACK_NUMBER: candidate.track_number,
        TagField.URL: candidate.url,
        TagField.SOURCE_ID: candidate.id,
        TagField.SOURCE: candidate.source,
    }
    texts = {field: str(value).strip() for field, value in projected.items() if value is not None}
    return MappingProxyType({field: text for field, text in texts.items() if text})
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_files_write.py tests/unit/test_files_identity.py --no-cov -q`
Expected: PASS (5 projections, lecture d'identité inchangée)

- [ ] **Step 5: Lancer le gate**

Run: `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar`
Expected: tout passe.

- [ ] **Step 6: Commit**

```bash
git add sidecar/src/tagger/files.py sidecar/tests/unit/test_files_write.py
git commit -m "feat(files): projeter un candidat sur la table de correspondance de l'ADR-011"
```

---

### Task 3: Écrire les tags d'un fichier

**Files:**
- Modify: `sidecar/src/tagger/files.py` (docstring et TODO de tête, imports, constantes, `WrittenTags`, `_Artwork`, `TagsWriteError`, `write_tags` et ses aides)
- Modify: `sidecar/pyproject.toml` (`[tool.mypy]`)
- Modify: `sidecar/tests/helpers/audio_samples.py` (imports, `tag`, `append_id3v1`, `held_open`)
- Modify: `sidecar/tests/unit/test_files_write.py`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`

**Interfaces:**
- Consumes: `TagField`, `TAG_FIELDS`, `TagValues`, `project_tags` (Task 2) ; `FileFailureReason`, `file_failure_reason` (Task 1).
- Produces: `files.write_tags(path: Path, values: TagValues, artwork: Path | None) -> WrittenTags`, synchrone ; `files.WrittenTags(fields: tuple[TagField, ...], artwork: bool)` ; `files.TagsWriteError(path: Path, reason: FileFailureReason)` (sous `FilesError`, `code = "tags_write_failed"`, `.reason`, `params = {"file": path.name, "reason": reason}`). Le sub-project 04 l'appelle par `asyncio.to_thread`. `files._write_failure(path, error) -> TagsWriteError`, privé, est réutilisé par `restore_tags` (sub-project 02).

- [ ] **Step 1: Ajouter le tag ID3v1 et le verrou réel aux échantillons**

Dans `sidecar/tests/helpers/audio_samples.py`, imports :

```python
import ctypes
import struct
import wave
from contextlib import contextmanager
from ctypes import wintypes
from typing import TYPE_CHECKING, Final
```

et sous `TYPE_CHECKING`, `from collections.abc import Callable, Iterator`. À la fin du fichier :

```python
def append_id3v1(path: Path, *, comment: str) -> None:
    """Ajoute en fin de MP3 un tag ID3v1 de 128 octets portant un commentaire."""
    fields = (b"Old Title", b"Old Artist", b"Old Album")
    body = b"".join(field.ljust(30, b"\0") for field in fields)
    tail = b"2001" + comment.encode("latin-1").ljust(30, b"\0") + bytes([255])
    with path.open("ab") as audio:
        audio.write(b"TAG" + body + tail)


_GENERIC_READ: Final = 0x80000000
_FILE_SHARE_READ: Final = 1
_OPEN_EXISTING: Final = 3
_INVALID_HANDLE: Final = wintypes.HANDLE(-1).value


@contextmanager
def held_open(path: Path) -> Iterator[None]:
    """Tient le fichier comme un lecteur audio : lisible, plus inscriptible (Windows seulement)."""
    kernel32 = ctypes.windll.kernel32
    kernel32.CreateFileW.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.LPVOID,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.HANDLE,
    ]
    kernel32.CreateFileW.restype = wintypes.HANDLE
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel32.CreateFileW(
        str(path), _GENERIC_READ, _FILE_SHARE_READ, None, _OPEN_EXISTING, 0, None
    )
    if handle == _INVALID_HANDLE:
        raise ctypes.WinError()
    try:
        yield
    finally:
        kernel32.CloseHandle(handle)
```

`held_open` appelle `CreateFileW` avec `GENERIC_READ`, `FILE_SHARE_READ` (sans partage d'écriture) et `OPEN_EXISTING`, puis `CloseHandle` à la sortie. Les signatures ctypes sont posées pour que le handle ne soit pas tronqué sur 64 bits.

- [ ] **Step 2: Écrire les tests d'écriture**

Dans `sidecar/tests/unit/test_files_write.py`, remplacer le bloc d'imports par :

```python
import errno
import stat
from typing import TYPE_CHECKING

import mutagen
import pytest
from audio_samples import append_id3v1, held_open, write_tagged_wavpack
from mutagen import MutagenError
from mutagen.flac import FLAC, Picture
from mutagen.id3 import APIC, COMM, TDRC, TPE2, TXXX, Frames
from mutagen.mp3 import MP3
from scraper_responses import track_payload
from tagging_api import JPEG

from tagger.file_failures import FileFailureReason
from tagger.files import TAG_FIELDS, TagField, TagsWriteError, project_tags, write_tags
from tagger.scraper_client import TrackCandidate

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

FRONT_COVER = 3
BACK_COVER = 4
BOOKLET = 5
```

Ajouter après la constante `BANDCAMP` les aides de relecture et d'arrange :

```python
def _read_back(path: Path) -> dict[TagField, str]:
    """Valeurs relues sous les cles de la table ; mutagen remonte TYER et TORY en TDRC et TDOR."""
    audio = mutagen.File(path)
    if isinstance(audio, FLAC):
        return {
            field: audio[keys.vorbis][0]
            for field, keys in TAG_FIELDS.items()
            if keys.vorbis in audio
        }
    return {
        field: str(audio.tags[keys.id3])
        for field, keys in TAG_FIELDS.items()
        if keys.id3 in audio.tags
    }


def _preset(path: Path, **frames_or_keys: str) -> None:
    """Pose des tags d'origine dans l'arrange : frames texte ID3 ou cles Vorbis."""
    audio = mutagen.File(path)
    if isinstance(audio, FLAC):
        for key, value in frames_or_keys.items():
            audio[key] = [value]
        audio.save()
        return
    if audio.tags is None:
        audio.add_tags()
    for frame_id, value in frames_or_keys.items():
        audio.tags.add(Frames[frame_id](encoding=3, text=[value]))
    audio.tags.update_to_v23()
    audio.save(v2_version=3)


def _add_pictures(path: Path, *pictures: tuple[int, bytes]) -> None:
    audio = mutagen.File(path)
    if isinstance(audio, FLAC):
        for kind, data in pictures:
            picture = Picture()
            picture.type = kind
            picture.mime = "image/png"
            picture.data = data
            audio.add_picture(picture)
        audio.save()
        return
    if audio.tags is None:
        audio.add_tags()
    for kind, data in pictures:
        audio.tags.add(APIC(encoding=3, mime="image/png", type=kind, desc=str(kind), data=data))
    audio.save(v2_version=3)


def _pictures(path: Path) -> list[tuple[int, str, bytes]]:
    audio = mutagen.File(path)
    if isinstance(audio, FLAC):
        return [(picture.type, picture.mime, picture.data) for picture in audio.pictures]
    return [(frame.type, frame.mime, frame.data) for frame in audio.tags.getall("APIC")]
```

Ajouter à la fin du fichier, après les tests de projection :

```python
@pytest.mark.parametrize(
    "audio_format",
    ["mp3", "wav", "aiff", "flac"],
    ids=["id3-mp3", "id3-wav", "id3-aiff", "vorbis-flac"],
)
def test_writes_the_same_values_on_every_format(
    blank_audio: Callable[[str], Path], audio_format: str
) -> None:
    path = blank_audio(audio_format)
    values = project_tags(REMIX)

    written = write_tags(path, values, None)

    assert _read_back(path) == dict(values)
    assert written.fields == tuple(values)


@pytest.mark.parametrize("audio_format", ["mp3", "wav", "aiff"])
@pytest.mark.parametrize("version", [3, 4], ids=["from-v23", "from-v24"])
def test_saves_id3_v23_with_the_year_alone(
    blank_audio: Callable[[str], Path], audio_format: str, version: int
) -> None:
    path = blank_audio(audio_format)
    audio = mutagen.File(path)
    audio.add_tags()
    audio.tags.add(TDRC(encoding=3, text=["2019-06-16"]))
    if version == 3:
        audio.tags.update_to_v23()
    audio.save(v2_version=version)

    write_tags(path, project_tags(BEATPORT), None)

    # Rechargees sans la remontee en v2.4 : les frames telles qu'ecrites sur le disque.
    on_disk = type(mutagen.File(path))(path, translate=False).tags
    assert on_disk.version == (2, 3, 0)
    assert (str(on_disk["TYER"]), str(on_disk["TORY"])) == ("2023", "2023")
    assert {"TDRC", "TDOR", "TDAT"}.isdisjoint(on_disk.keys())


@pytest.mark.parametrize("audio_format", ["mp3", "flac"], ids=["id3", "vorbis"])
def test_keeps_accented_text_intact(blank_audio: Callable[[str], Path], audio_format: str) -> None:
    path = blank_audio(audio_format)
    values = project_tags(_candidate(title="Für Éline", mix_name="Señor Remix"))

    write_tags(path, values, None)

    assert _read_back(path)[TagField.TITLE] == "Für Éline (Señor Remix)"


def test_replaces_existing_vorbis_values_whatever_their_case_or_count(
    blank_audio: Callable[[str], Path],
) -> None:
    path = blank_audio("flac")
    audio = FLAC(path)
    audio["artist"] = ["Old One", "Old Two"]
    audio.save()

    write_tags(path, project_tags(BEATPORT), None)

    assert FLAC(path)["ARTIST"] == ["Adam Beyer"]


@pytest.mark.parametrize(
    ("audio_format", "preset"),
    [("mp3", {"TBPM": "130", "TKEY": "8A"}), ("flac", {"BPM": "130", "KEY": "8A"})],
    ids=["id3", "vorbis"],
)
def test_keeps_the_tags_the_source_leaves_null(
    blank_audio: Callable[[str], Path], audio_format: str, preset: dict[str, str]
) -> None:
    path = blank_audio(audio_format)
    _preset(path, **preset)

    write_tags(path, project_tags(BANDCAMP), None)

    read_back = _read_back(path)
    assert (read_back[TagField.BPM], read_back[TagField.KEY]) == ("130", "8A")


def test_leaves_the_id3_frames_outside_the_table_alone(
    blank_audio: Callable[[str], Path],
) -> None:
    path = blank_audio("mp3")
    audio = mutagen.File(path)
    audio.add_tags()
    audio.tags.add(TPE2(encoding=3, text=["Drumcode"]))
    audio.tags.add(TXXX(encoding=3, desc="SERATO_PLAYCOUNT", text=["12"]))
    audio.save(v2_version=3)

    write_tags(path, project_tags(BEATPORT), None)

    tags = mutagen.File(path).tags
    assert (str(tags["TPE2"]), str(tags["TXXX:SERATO_PLAYCOUNT"])) == ("Drumcode", "12")


def test_leaves_the_vorbis_keys_outside_the_table_alone(
    blank_audio: Callable[[str], Path],
) -> None:
    path = blank_audio("flac")
    _preset(path, ALBUMARTIST="Drumcode", SERATO_PLAYCOUNT="12")

    write_tags(path, project_tags(BEATPORT), None)

    audio = FLAC(path)
    assert (audio["ALBUMARTIST"], audio["SERATO_PLAYCOUNT"]) == (["Drumcode"], ["12"])


def test_removes_every_id3_comment(blank_audio: Callable[[str], Path]) -> None:
    path = blank_audio("mp3")
    audio = mutagen.File(path)
    audio.add_tags()
    audio.tags.add(COMM(encoding=3, lang="eng", desc="", text=["ripped by X"]))
    audio.tags.add(COMM(encoding=3, lang="fra", desc="note", text=["320kbps"]))
    audio.save(v2_version=3)

    write_tags(path, project_tags(BEATPORT), None)

    assert not mutagen.File(path).tags.getall("COMM")


def test_removes_every_vorbis_comment(blank_audio: Callable[[str], Path]) -> None:
    path = blank_audio("flac")
    _preset(path, COMMENT="ripped by X", DESCRIPTION="320kbps")

    write_tags(path, project_tags(BEATPORT), None)

    audio = FLAC(path)
    assert "COMMENT" not in audio
    assert "DESCRIPTION" not in audio


def test_clears_the_comment_of_an_id3v1_tag(blank_audio: Callable[[str], Path]) -> None:
    path = blank_audio("mp3")
    append_id3v1(path, comment="ripped by X")

    write_tags(path, project_tags(BEATPORT), None)

    assert b"ripped by X" not in path.read_bytes()


@pytest.mark.parametrize("audio_format", ["mp3", "flac"], ids=["id3", "vorbis"])
def test_replaces_every_picture_with_the_given_cover(
    blank_audio: Callable[[str], Path], tmp_path: Path, audio_format: str
) -> None:
    path = blank_audio(audio_format)
    _add_pictures(path, (BACK_COVER, b"back"), (FRONT_COVER, b"old front"))
    cover = tmp_path / "cover.jpg"
    cover.write_bytes(JPEG)

    written = write_tags(path, project_tags(BEATPORT), cover)

    assert _pictures(path) == [(FRONT_COVER, "image/jpeg", JPEG)]
    assert written.artwork


@pytest.mark.parametrize("audio_format", ["mp3", "flac"], ids=["id3", "vorbis"])
def test_writing_twice_still_leaves_a_single_cover(
    blank_audio: Callable[[str], Path], tmp_path: Path, audio_format: str
) -> None:
    path = blank_audio(audio_format)
    cover = tmp_path / "cover.jpg"
    cover.write_bytes(JPEG)
    write_tags(path, project_tags(BEATPORT), cover)

    write_tags(path, project_tags(BEATPORT), cover)

    assert _pictures(path) == [(FRONT_COVER, "image/jpeg", JPEG)]


def test_tags_the_cover_with_the_mime_of_its_extension(
    blank_audio: Callable[[str], Path], tmp_path: Path
) -> None:
    path = blank_audio("mp3")
    cover = tmp_path / "cover.png"
    cover.write_bytes(b"\x89PNG")

    write_tags(path, project_tags(BEATPORT), cover)

    assert _pictures(path) == [(FRONT_COVER, "image/png", b"\x89PNG")]


@pytest.mark.parametrize("audio_format", ["mp3", "flac"], ids=["id3", "vorbis"])
def test_keeps_only_the_front_cover_without_artwork(
    blank_audio: Callable[[str], Path], audio_format: str
) -> None:
    path = blank_audio(audio_format)
    _add_pictures(path, (BACK_COVER, b"back"), (FRONT_COVER, b"front"))

    written = write_tags(path, project_tags(BEATPORT), None)

    assert _pictures(path) == [(FRONT_COVER, "image/png", b"front")]
    assert not written.artwork


@pytest.mark.parametrize("audio_format", ["mp3", "flac"], ids=["id3", "vorbis"])
def test_keeps_the_first_picture_when_none_is_a_front_cover(
    blank_audio: Callable[[str], Path], audio_format: str
) -> None:
    path = blank_audio(audio_format)
    _add_pictures(path, (BACK_COVER, b"back"), (BOOKLET, b"booklet"))

    write_tags(path, project_tags(BEATPORT), None)

    assert _pictures(path) == [(BACK_COVER, "image/png", b"back")]


@pytest.mark.parametrize("cover_state", ["purged", "unreadable", "foreign"])
def test_treats_a_cover_the_cache_cannot_give_as_absent(
    blank_audio: Callable[[str], Path], tmp_path: Path, cover_state: str
) -> None:
    path = blank_audio("mp3")
    _add_pictures(path, (FRONT_COVER, b"front"))
    cover = tmp_path / ("cover.gif" if cover_state == "foreign" else "cover.jpg")
    if cover_state == "unreadable":
        cover.mkdir()
    elif cover_state == "foreign":
        cover.write_bytes(b"GIF89a")

    written = write_tags(path, project_tags(BEATPORT), cover)

    assert _pictures(path) == [(FRONT_COVER, "image/png", b"front")]
    assert not written.artwork
    assert _read_back(path)[TagField.TITLE] == "Your Mind (Extended Mix)"


def test_raises_file_locked_and_leaves_a_locked_file_unchanged(
    blank_audio: Callable[[str], Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    path = blank_audio("mp3")
    before = path.read_bytes()

    def locked_file(_path: Path) -> None:
        raise MutagenError("file in use") from OSError(
            32, "The process cannot access the file", None, 32
        )

    monkeypatch.setattr(mutagen, "File", locked_file)

    with pytest.raises(TagsWriteError, match="tags not written") as error:
        write_tags(path, project_tags(BEATPORT), None)

    assert error.value.reason is FileFailureReason.FILE_LOCKED
    assert path.read_bytes() == before


def test_reports_a_file_held_by_another_program_as_locked(
    blank_audio: Callable[[str], Path],
) -> None:
    path = blank_audio("mp3")
    before = path.read_bytes()

    with held_open(path), pytest.raises(TagsWriteError) as error:
        write_tags(path, project_tags(BEATPORT), None)

    assert error.value.reason is FileFailureReason.FILE_LOCKED
    assert path.read_bytes() == before


def test_keeps_permission_denied_for_a_read_only_file(
    blank_audio: Callable[[str], Path],
) -> None:
    path = blank_audio("mp3")
    path.chmod(stat.S_IREAD)

    with pytest.raises(TagsWriteError) as error:
        write_tags(path, project_tags(BEATPORT), None)

    assert error.value.reason is FileFailureReason.PERMISSION_DENIED


def test_names_a_full_disk_met_while_saving(
    blank_audio: Callable[[str], Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    path = blank_audio("mp3")

    def full_disk(_self: MP3, *_args: object, **_kwargs: object) -> None:
        raise MutagenError("no space") from OSError(errno.ENOSPC, "No space left on device")

    monkeypatch.setattr(MP3, "save", full_disk)

    with pytest.raises(TagsWriteError) as error:
        write_tags(path, project_tags(BEATPORT), None)

    assert error.value.reason is FileFailureReason.DISK_FULL
    assert error.value.params == {"file": "track.mp3", "reason": FileFailureReason.DISK_FULL}


def test_refuses_a_container_outside_the_four_formats(tmp_path: Path) -> None:
    path = write_tagged_wavpack(tmp_path / "track.wav")
    before = path.read_bytes()

    with pytest.raises(TagsWriteError) as error:
        write_tags(path, project_tags(BEATPORT), None)

    assert error.value.reason is FileFailureReason.WRITE_FAILED
    assert path.read_bytes() == before


@pytest.mark.parametrize("name", ["notes.mp3", "notes.txt"], ids=["corrupt-mp3", "unknown"])
def test_refuses_a_file_that_is_not_audio(tmp_path: Path, name: str) -> None:
    path = tmp_path / name
    path.write_bytes(b"not an audio file" * 16)

    with pytest.raises(TagsWriteError) as error:
        write_tags(path, project_tags(BEATPORT), None)

    assert error.value.reason is FileFailureReason.WRITE_FAILED
```

- [ ] **Step 3: Vérifier qu'ils échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_files_write.py --no-cov -q`
Expected: FAIL, `ImportError: cannot import name 'TagsWriteError' from 'tagger.files'`

- [ ] **Step 4: Exclure mutagen du contrôle des appels non typés**

mutagen livre un `py.typed` sans annoter ses frames ni `setall`, `delall`, `add`, `update_to_v23`, `add_picture`. Dans `sidecar/pyproject.toml`, sous `plugins = ["pydantic.mypy"]` de `[tool.mypy]` :

```toml
# mutagen livre un py.typed sans annoter ses frames ni les methodes de ses tags
# (setall, delall, add, update_to_v23, add_picture) : sans cette exclusion, chaque
# appel demanderait un `# type: ignore[no-untyped-call]`.
untyped_calls_exclude = ["mutagen"]
```

Dans `tag()` de `sidecar/tests/helpers/audio_samples.py`, les deux ignores deviennent inutiles (et `warn_unused_ignores` les refuse) : supprimer le commentaire « Frame ID3 non annotee... » et le `  # type: ignore[no-untyped-call]` des deux lignes `audio.tags.add(...)`.

- [ ] **Step 5: Écrire le writer**

Dans `sidecar/src/tagger/files.py`, en tête :

```python
"""Lecture et ecriture des tags par mutagen, sur les quatre formats retenus.

Seul module du sidecar qui ouvre un fichier audio ; l'ecriture suit la confirmation (ADR-010).
"""

# TODO: implement, dump des tags d'origine avant reecriture (Feature 5).
```

Imports complétés (`import os` avant `from dataclasses import dataclass`) :

```python
import os

import mutagen
from mutagen import MutagenError
from mutagen.flac import FLAC, Picture, VCFLACDict
from mutagen.id3 import APIC, ID3, TXXX, WOAS, Encoding, Frame, Frames, PictureType

from tagger.errors import TaggerError
from tagger.file_failures import FileFailureReason, file_failure_reason
from tagger.matching import credited_artists, full_title

if TYPE_CHECKING:
    from collections.abc import Iterable, Mapping, Sequence
    from pathlib import Path

    from tagger.scraper_client import TrackCandidate
```

Constantes, après `_MULTI_VALUE_SEPARATOR` :

```python
# Aucun commentaire ne survit a l'ecriture : ils portent surtout des traces de rip.
_ID3_COMMENT: Final = "COMM"
_VORBIS_COMMENTS: Final = ("COMMENT", "DESCRIPTION")

# Extensions que le cache donne aux pochettes, cf. cache._ARTWORK_EXTENSIONS.
_ARTWORK_MIME: Final = {".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
```

Types, après `IdentityTags` :

```python
@dataclass(frozen=True, slots=True)
class WrittenTags:
    """Ce que l'ecriture a pose : le rapport compte les champs ecrits (ADR-011)."""

    fields: tuple[TagField, ...]
    artwork: bool


class _Artwork(NamedTuple):
    mime: str
    data: bytes
```

Erreur, après `TagsUnreadableError` :

```python
class TagsWriteError(FilesError):
    """Tags non ecrits ; levee sans log, l'appelant connait le run et le morceau."""

    code: ClassVar[str] = "tags_write_failed"

    def __init__(self, path: Path, reason: FileFailureReason) -> None:
        super().__init__(f"tags not written: {path.name}", file=path.name, reason=reason)
        self.reason = reason
```

Writer et aides, après `project_tags` :

```python
def write_tags(path: Path, values: TagValues, artwork: Path | None) -> WrittenTags:
    """Ecrit les valeurs, une seule image et aucun commentaire, en place.

    Verrou, droits et fichier absent echouent a l'ouverture, avant toute ecriture. Une
    pochette absente garde l'image du fichier : le cache est jetable (ADR-013).
    """
    picture = _read_artwork(artwork)
    try:
        audio = mutagen.File(path)
        if audio is None:
            raise TagsWriteError(path, FileFailureReason.WRITE_FAILED)
        if audio.tags is None:
            audio.add_tags()
        match audio, audio.tags:
            case FLAC() as flac, VCFLACDict() as comments:
                _write_vorbis(flac, comments, values, picture)
                flac.save()
            case _, ID3() as tags:
                _write_id3(tags, values, picture)
                # `save(v2_version=3)` seul laisse TDRC et TDOR sur le disque (mutagen 1.48.1).
                tags.update_to_v23()
                audio.save(v2_version=3)
            case _:
                # Conteneur hors des quatre formats : refuse avant toute ecriture.
                raise TagsWriteError(path, FileFailureReason.WRITE_FAILED)
    except (MutagenError, OSError) as exc:
        raise _write_failure(path, exc) from exc

    return WrittenTags(fields=tuple(values), artwork=picture is not None)


def _write_failure(path: Path, error: MutagenError | OSError) -> TagsWriteError:
    cause = error.__cause__ or error
    reason = (
        file_failure_reason(cause) if isinstance(cause, OSError) else FileFailureReason.WRITE_FAILED
    )
    # Le CRT ne remonte pas le code Windows d'un verrou : `PermissionError` sans `winerror`.
    # Un fichier en lecture seule, seule autre cause, n'est pas inscriptible.
    if (
        reason is FileFailureReason.PERMISSION_DENIED
        and getattr(cause, "winerror", None) is None
        and os.access(path, os.W_OK)
    ):
        reason = FileFailureReason.FILE_LOCKED
    return TagsWriteError(path, reason)


def _write_id3(tags: ID3, values: TagValues, artwork: _Artwork | None) -> None:
    for field, value in values.items():
        frame_id = TAG_FIELDS[field].id3
        # Remplacement par cle exacte : un TXXX d'un autre logiciel reste en place.
        tags.setall(frame_id, [_id3_frame(frame_id, value)])
    tags.delall(_ID3_COMMENT)

    frames = tags.getall("APIC")
    kept = (
        _front_or_first(frames, [frame.type for frame in frames])
        if artwork is None
        else APIC(
            encoding=Encoding.UTF8,
            mime=artwork.mime,
            type=PictureType.COVER_FRONT,
            desc="Cover",
            data=artwork.data,
        )
    )
    tags.delall("APIC")
    if kept is not None:
        tags.add(kept)


def _id3_frame(frame_id: str, value: str) -> Frame:
    kind, _, description = frame_id.partition(":")
    if kind == "TXXX":
        return TXXX(encoding=Encoding.UTF8, desc=description, text=[value])
    if kind == "WOAS":
        return WOAS(url=value)
    return Frames[kind](encoding=Encoding.UTF8, text=[value])


def _write_vorbis(
    audio: FLAC, comments: VCFLACDict, values: TagValues, artwork: _Artwork | None
) -> None:
    for field, value in values.items():
        comments[TAG_FIELDS[field].vorbis] = [value]
    for key in _VORBIS_COMMENTS:
        if key in comments:
            del comments[key]

    pictures = audio.pictures
    kept = (
        _front_or_first(pictures, [picture.type for picture in pictures])
        if artwork is None
        else _flac_picture(artwork)
    )
    audio.clear_pictures()
    if kept is not None:
        audio.add_picture(kept)


def _flac_picture(artwork: _Artwork) -> Picture:
    picture = Picture()
    picture.type = PictureType.COVER_FRONT
    picture.mime = artwork.mime
    picture.data = artwork.data
    return picture


def _front_or_first[P](pictures: Sequence[P], types: Sequence[int]) -> P | None:
    """Recto du fichier, a defaut sa premiere image : une seule doit rester."""
    fronts = (
        picture
        for picture, kind in zip(pictures, types, strict=True)
        if kind == PictureType.COVER_FRONT
    )
    return next(fronts, pictures[0] if pictures else None)


def _read_artwork(artwork: Path | None) -> _Artwork | None:
    if artwork is None:
        return None
    mime = _ARTWORK_MIME.get(artwork.suffix.lower())
    if mime is None:
        return None
    try:
        return _Artwork(mime=mime, data=artwork.read_bytes())
    except OSError:
        return None
```

- [ ] **Step 6: Traduire le code d'erreur**

`test_error_translations.py` exige une phrase pour tout `TaggerError`. Dans `errors`, juste après `tags_unreadable` :

`public/i18n/fr.json` :

```json
    "tags_write_failed": "Les tags de {{file}} n'ont pas pu être écrits.",
```

`public/i18n/en.json` :

```json
    "tags_write_failed": "The tags of {{file}} could not be written.",
```

- [ ] **Step 7: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_files_write.py tests/unit/test_files_identity.py tests/unit/test_error_translations.py --no-cov -q`
Expected: PASS

- [ ] **Step 8: Lancer le gate**

Run: `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar && just lint-ui`
Expected: tout passe, `files.py` couvert à 100 % (`lint-ui` passe Prettier sur les deux JSON).

- [ ] **Step 9: Commit**

```bash
git add sidecar/src/tagger/files.py sidecar/pyproject.toml sidecar/tests/helpers/audio_samples.py sidecar/tests/unit/test_files_write.py public/i18n/fr.json public/i18n/en.json
git commit -m "feat(files): écrire les tags d'un fichier, une seule pochette et sans commentaire"
```

---

### Task 4: Documentation de la politique d'écriture

**Files:**
- Modify: `docs/adrs/011-politique-ecriture-tags.md`
- Modify: `docs/ARCHITECTURE.md:113-133,605,609,953`
- Modify: `docs/VERSIONS.md:199`
- Modify: `docs/knowledges/mutagen.md` (§ Écriture en ID3v2.3, l. 82, exemples l. 104, 147, 196-199, l. 208)
- Modify: `.claude/rules/mutagen/tags.md` (l. 16, 28)

**Interfaces:**
- Consumes: les décisions du spec et le constat `update_to_v23()` de la Task 3.
- Produces: docs alignées sur le code livré.

- [ ] **Step 1: ADR-011**

Charger `Skill[architecture-doc]` et lire son template d'ADR avant d'éditer. Puis, dans `docs/adrs/011-politique-ecriture-tags.md` :
- tableau « Formats et systèmes de tags », ligne Vorbis : `pochette en METADATA_BLOCK_PICTURE` → `pochette en bloc PICTURE natif du FLAC, posé par add_picture() (METADATA_BLOCK_PICTURE est le champ propre à Ogg)` ;
- règle « Version et encodage ID3 explicites » : ajouter « écrite par `update_to_v23()` puis `save(v2_version=3)` » ;
- règle « Deux réglages de `save()` » : ajouter en fin de règle « **Tranché le 2026-10-06** : chaque champ s'écrit en une seule chaîne, artistes et remixeurs joints par « , », donc `v23_sep` ne s'applique plus ; la date se réduit à l'année sur les quatre formats, donc `TORY` ne perd rien » ;
- l. 100-101 (tableau de correspondance) : `TYER + TDAT` → `TYER`, la date étant réduite à l'année sur les quatre formats et `TDAT` jamais écrit ; la ligne `TORY` reste, avec la même année ;
- l. 123-124 (`TDRC`, `TDOR`) : « Écrite par mutagen, convertie en TYER + TDAT au `save(v2_version=3)` » → « année seule, convertie en `TYER` par `update_to_v23()` » ; `TDOR` : « Frame v2.4 sans équivalent complet en v2.3 » → « année seule, convertie en `TORY` par `update_to_v23()` : aucune précision perdue » ;
- l. 141 : « Les tags hors tableau sont laissés intacts, pas d'effacement global du bloc » → ajouter « sauf les commentaires et les images, cf. les précisions du 2026-10-06 » ;
- l. 169 (Négatives) : « La cible v2.3 dégrade un champ : la date de sortie perd le jour et le mois. Les valeurs multiples sont un second arbitrage ouvert : … » → « La cible v2.3 et l'année seule font perdre à la date de sortie le jour et le mois, sur les quatre formats. Les valeurs multiples sont tranchées le 2026-10-06 : une seule chaîne par champ, jointe par « , », `v23_sep` sans objet » ;
- l. 183 : retirer « Les valeurs multiples restent à trancher : `v23_sep=None` conserve le séparateur null mais produit un v2.3 non standard, déconseillé par la documentation mutagen » au profit de « Les valeurs multiples sont tranchées le 2026-10-06 : une seule chaîne par champ, `v23_sep` ne s'applique pas » ;
- l. 187 : « Un échec d'écriture est logué, le fichier reste intact, le run continue » → « Un échec d'écriture est logué et le run continue ; l'écriture se fait en place, donc le fichier reste intact pour les échecs courants (verrou, droits, fichier absent), qui surviennent à l'ouverture » ;
- ajouter aux Règles :
  - « **Précision 2026-10-06 : écriture en place.** mutagen écrit dans le fichier, sans copie voisine : quelques secondes pour 100 morceaux, là où une copie recopierait 6 Go pour 100 WAV de 60 Mo et doublerait l'espace disque. Verrou, droits et fichier absent échouent à l'ouverture, avant toute modification ; une panne en pleine écriture peut abîmer le fichier, le dump restaurant les tags et non l'audio. » ;
  - « **Précision 2026-10-06 : une seule image.** Avec une pochette, toutes les images du fichier sont retirées puis la pochette est posée en recto ; sans pochette lisible, le recto existant est gardé, à défaut la première image, et les autres sont retirées. »
  - « **Précision 2026-10-06 : aucun commentaire.** `COMM` en ID3, `COMMENT` et `DESCRIPTION` en Vorbis sont retirés à chaque écriture. Les autres tags hors tableau restent intacts : Serato et Traktor rangent cue points et beatgrids dans des frames `GEOB` et `PRIV`. »
  - « **Précision 2026-10-06 : `update_to_v23()` est obligatoire.** Constaté sur mutagen 1.48.1 : `save(v2_version=3)` seul écrit un en-tête v2.3 mais laisse `TDRC` et `TDOR` sur le disque, que seul `update_to_v23()` convertit en `TYER` et `TORY`. Le piège n'est donc pas propre à `EasyID3`. »

- [ ] **Step 2: ARCHITECTURE.md et VERSIONS.md**

Charger `Skill[architecture-doc]` (déjà chargé au Step 1), puis `Skill[versions-doc]` et lire son template avant d'éditer `docs/VERSIONS.md`. Dans `docs/ARCHITECTURE.md` :
- l. 605 : `ou METADATA_BLOCK_PICTURE lors de la phase d'écriture` → `ou en bloc PICTURE du FLAC lors de la phase d'écriture, une seule image par fichier` ;
- l. 609 : `obtenue par save(v2_version=3)` → `obtenue par update_to_v23() puis save(v2_version=3)` ;
- l. 953 : supprimer la ligne « Réglages `save()` en ID3v2.3 » du tableau des questions ouvertes, tranchée dans l'ADR-011 ;
- arborescence du sidecar (l. 113-133) : ajouter après `errors.py` la ligne `file_failures.py  # motifs d'échec d'un fichier, partagés par l'extraction et l'écriture`, au même alignement que ses voisines.

Dans `docs/VERSIONS.md` :
- l. 199 (§ mutagen, ID3v2.3) : « `save(v2_version=3)` repasse les frames texte d'UTF-8 en UTF-16 et joint les valeurs multiples avec `v23_sep` (défaut `/`). Le `v23_sep=None` est déconseillé par la doc… » → « `save(v2_version=3)` repasse les frames texte d'UTF-8 en UTF-16, mais ne convertit pas `TDRC` ni `TDOR` : sans `update_to_v23()` préalable ils restent sur le disque sous un en-tête v2.3 (constaté le 2026-10-06 sur 1.48.1). techno-tagger écrit une seule chaîne par champ, `v23_sep` ne lui sert donc pas ».

- [ ] **Step 3: Fiche mutagen**

Charger `Skill[knowledge-doc]` et lire son template avant d'éditer. Dans `docs/knowledges/mutagen.md` :
- § Écriture en ID3v2.3, exemple : `tags.update_to_v23()` avant `tags.save(v2_version=3)` ;
- Points Importants, l. 82 : remplacer « La conversion ne s'applique qu'à l'écriture : l'objet en mémoire reste en v2.4 » par « **`save(v2_version=3)` ne convertit pas les frames** : sans `update_to_v23()` préalable, `TDRC` et `TDOR` restent sur le disque sous un en-tête v2.3 (constaté le 2026-10-06 sur 1.48.1, objet `ID3` complet compris). Asserter sur le fichier rechargé avec `translate=False` » ;
- exemples l. 104 et 147 : `update_to_v23()` avant `save(v2_version=3)` ;
- l. 208 : « Le motif de renommage vient après l'écriture, puisqu'il relit les tags fraîchement écrits : un échec d'écriture doit aussi annuler le renommage de ce fichier » → « Le renommage vient après l'écriture et se calcule sur la projection, sans rouvrir le fichier : un morceau dont l'écriture a échoué n'est pas renommé » ;
- exemple l. 196-199 : remplacer la ligne `reason = "file_locked" if ... else "write_error"` par `reason = file_failure_reason(cause) if isinstance(cause, OSError) else FileFailureReason.WRITE_FAILED` (motif `write_failed`, `write_error` étant un `state`).

- [ ] **Step 4: Rule mutagen**

Charger `Skill[rules-doc]` et lire son template avant d'éditer. Dans `.claude/rules/mutagen/tags.md` :
- À faire : « Sauver en `save(v2_version=3)` » → « Appeler `update_to_v23()` puis `save(v2_version=3)` : mutagen vise v2.4 par défaut, et `save(v2_version=3)` seul laisse `TDRC` et `TDOR` sur le disque » ;
- l. 16 : « Annuler le renommage d'un fichier dont l'écriture a échoué : le motif de renommage relit les tags fraîchement écrits » → « Ne renommer qu'un fichier dont l'écriture a réussi : le nom se calcule sur la projection, sans rouvrir le fichier » ;
- l. 28 (Gotchas) : « La conversion v2.4 → v2.3 n'est pas neutre : … les valeurs multiples sont jointes par `v23_sep` (à choisir explicitement), `TDRC` est éclaté en `TYER` + `TDAT` + `TIME` » → « …, une seule chaîne par champ rend `v23_sep` sans objet, et la date réduite à l'année donne `TYER` seul, sans `TDAT` ni `TIME` » ;
- À faire, ajouter : « Une seule image par fichier : retirer toutes les images (`delall("APIC")`, `clear_pictures()`) avant de poser la pochette ; sans pochette, garder le recto existant » et « Retirer `COMM` en ID3, `COMMENT` et `DESCRIPTION` en Vorbis à chaque écriture » ;
- À éviter, ajouter : « `save(v2_version=3)` sans `update_to_v23()` préalable » ;
- Exemples : `tags.update_to_v23()` avant `tags.save(v2_version=3)` ; `plan.mark_failed(track, "file_locked" if ... else "write_error")` → `raise TagsWriteError(path, file_failure_reason(cause) if isinstance(cause, OSError) else FileFailureReason.WRITE_FAILED) from exc`.

- [ ] **Step 5: Vérifier le rendu**

Run: `just lint-ui`
Expected: PASS (Prettier sur les fichiers markdown).

- [ ] **Step 6: Commit**

```bash
git add docs/adrs/011-politique-ecriture-tags.md docs/ARCHITECTURE.md docs/VERSIONS.md docs/knowledges/mutagen.md .claude/rules/mutagen/tags.md
git commit -m "docs(files): politique d'écriture précisée, v2.3 par update_to_v23, image unique, sans commentaire"
```
