# Lecture de l'artiste et du titre des fichiers d'un dossier : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lire l'artiste et le titre des fichiers audio d'un dossier, dans les quatre formats supportés, sans jamais les modifier.

**Architecture:** La partie lecture de `tagger/files.py`, seul module du sidecar qui ouvre un fichier audio. `list_audio_files` parcourt récursivement le dossier et filtre sur les extensions. `read_identity` ouvre le fichier par `mutagen.File()`, puis choisit la colonne de l'unique table `IDENTITY_FIELDS` selon le type des tags lus (ID3 ou Vorbis). Une lecture en échec lève une erreur typée, que le pipeline (sub-project 06) logue et traite.

**Tech Stack:** Python 3.14 (`pathlib`, `wave`, `struct`, `dataclasses`, `enum`), mutagen 1.48, pytest, Mypy strict, Ruff. Aucune dépendance nouvelle : mutagen est déjà déclaré dans `sidecar/pyproject.toml`.

**Spec:** `docs/superpowers/specs/onglet-scraping-pipeline-de-re-tagging/01-lecture-tags-fichiers-design.md`

## Global Constraints

- **Existant à réutiliser** : `tagger/errors.py` et `TaggerError(message: str, **params: object)`, avec `code: ClassVar[str]` et `params: dict[str, object]`. Ne pas les recréer.
- **Lecture seule stricte** : aucun `save()`, aucun `add_tags()` dans `files.py`. Seuls les tests écrivent des tags, dans `tmp_path`.
- **Extensions reconnues** : `.mp3`, `.wav`, `.aif`, `.aiff`, `.flac`, comparées en minuscules.
- **Table de correspondance (ADR-011 § Correspondance des champs)** : `artist` vers `TPE1` / `ARTIST`, `title` vers `TIT2` / `TITLE`. Une seule table, dans `files.py`.
- **Valeurs multiples** : entrées trimées, entrées vides écartées, jointure par `", "`.
- **Codes d'erreur** : `tagging_folder_unreadable` (param `folder`), `tags_unreadable` (params `file`, `reason` valant `locked` ou `unreadable`). Noms de fichier et de dossier seuls en paramètre, jamais le chemin complet.
- **Pas de log dans `files.py`** : l'incident de lecture est logué par le pipeline, qui connaît `run` et `track` (PRODUCTION.md § Logging).
- **Gate qualité vert à chaque commit** : `just test` (couverture bloquante à 80 %), `just lint`, `just typecheck`. Les commandes exigent bash.
- **Convention de commit** : `type(scope): description`, scope `files`.
- **Tests** : noms en anglais, Arrange / Act / Assert séparés par une ligne vide sans commentaire de section, écriture dans `tmp_path` uniquement, aucun fichier audio binaire commité.
- **Typage** : Mypy strict, `Final` sur les constantes, `@verify(UNIQUE)` sur les `StrEnum`, imports d'annotation seule sous `if TYPE_CHECKING:`, lignes à 100 caractères, jamais `from __future__ import annotations`.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `sidecar/src/tagger/files.py` | Extensions reconnues, table de correspondance, erreurs, énumération du dossier, lecture de l'identité. La partie écriture arrivera à la Feature 5 dans ce même fichier. |
| `sidecar/tests/helpers/audio_samples.py` | Fichiers audio vierges minimaux des quatre formats construits en octets, et pose de tags pour l'arrange. |
| `sidecar/tests/conftest.py` | Fixture `blank_audio`, fabrique de fichiers vierges dans `tmp_path`. |
| `sidecar/tests/unit/test_files_listing.py` | Énumération du dossier. |
| `sidecar/tests/unit/test_files_identity.py` | Lecture de l'artiste et du titre, erreurs de lecture. |
| `public/i18n/fr.json`, `public/i18n/en.json` | Une phrase par nouveau code d'erreur, exigée par `test_error_translations.py`. |

---

## Task 1: Énumération des fichiers audio d'un dossier

**Files:**
- Modify: `sidecar/src/tagger/files.py` (remplace le placeholder)
- Modify: `public/i18n/fr.json`, `public/i18n/en.json` (`errors.files_error`, `errors.tagging_folder_unreadable`)
- Test: `sidecar/tests/unit/test_files_listing.py`

**Interfaces:**
- Consumes: `tagger.errors.TaggerError`
- Produces:
  - `AUDIO_EXTENSIONS: Final[frozenset[str]]`
  - `FilesError(TaggerError)`, code `files_error`
  - `TaggingFolderUnreadableError(path: Path)`, code `tagging_folder_unreadable`, params `{"folder": path.name}`
  - `list_audio_files(folder: Path) -> tuple[Path, ...]`

- [ ] **Step 1: Écrire les tests d'énumération**

L'énumération ne lit pas le contenu : des fichiers de quelques octets suffisent, pas besoin de vrais fichiers audio ici.

Créer `sidecar/tests/unit/test_files_listing.py` :

```python
"""Tests de l'enumeration des fichiers audio du dossier a re-tagger."""

from pathlib import Path

import pytest

from tagger.files import TaggingFolderUnreadableError, list_audio_files


def _touch(root: Path, *relative_paths: str) -> None:
    for relative in relative_paths:
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"\x00")


def _relative(root: Path, paths: tuple[Path, ...]) -> list[str]:
    return [path.relative_to(root).as_posix() for path in paths]


def test_lists_audio_files_recursively_and_ignores_other_extensions(tmp_path: Path) -> None:
    _touch(
        tmp_path,
        "a.mp3",
        "b.wav",
        "sub/c.aiff",
        "sub/deep/d.flac",
        "e.aif",
        "cover.jpg",
        "playlist.m3u8",
        "notes.txt",
    )

    found = list_audio_files(tmp_path)

    assert _relative(tmp_path, found) == [
        "a.mp3",
        "b.wav",
        "e.aif",
        "sub/c.aiff",
        "sub/deep/d.flac",
    ]


def test_recognises_extensions_regardless_of_case(tmp_path: Path) -> None:
    _touch(tmp_path, "a.MP3", "b.Aif", "c.FLAC")

    found = list_audio_files(tmp_path)

    assert _relative(tmp_path, found) == ["a.MP3", "b.Aif", "c.FLAC"]


def test_returns_files_sorted_by_relative_path_case_insensitively(tmp_path: Path) -> None:
    _touch(tmp_path, "b.mp3", "A.mp3", "sub/c.flac", "Sub2/a.wav")

    found = list_audio_files(tmp_path)

    assert _relative(tmp_path, found) == ["A.mp3", "b.mp3", "sub/c.flac", "Sub2/a.wav"]


def test_ignores_a_folder_named_like_an_audio_file(tmp_path: Path) -> None:
    (tmp_path / "album.mp3").mkdir()
    _touch(tmp_path, "album.mp3/track.flac")

    found = list_audio_files(tmp_path)

    assert _relative(tmp_path, found) == ["album.mp3/track.flac"]


def test_returns_an_empty_tuple_for_a_folder_without_audio_files(tmp_path: Path) -> None:
    _touch(tmp_path, "cover.jpg")

    found = list_audio_files(tmp_path)

    assert found == ()


def test_raises_a_tagging_folder_error_for_a_missing_path(tmp_path: Path) -> None:
    missing = tmp_path / "missing"

    with pytest.raises(TaggingFolderUnreadableError) as error:
        list_audio_files(missing)

    assert error.value.code == "tagging_folder_unreadable"
    assert error.value.params == {"folder": "missing"}


def test_raises_a_tagging_folder_error_for_a_path_that_is_a_file(tmp_path: Path) -> None:
    _touch(tmp_path, "track.mp3")

    with pytest.raises(TaggingFolderUnreadableError):
        list_audio_files(tmp_path / "track.mp3")
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_files_listing.py -x -q`
Expected: FAIL, `ImportError: cannot import name 'TaggingFolderUnreadableError' from 'tagger.files'`

- [ ] **Step 3: Implémenter l'énumération**

Remplacer tout le contenu de `sidecar/src/tagger/files.py` :

```python
"""Lecture et ecriture des tags par mutagen, sur les quatre formats retenus.

Seul module du sidecar qui ouvre un fichier audio. La lecture de l'artiste et du
titre alimente la requete envoyee a techno-scraper ; l'ecriture arrivera avec la
confirmation globale du run (Feature 5).
"""

# TODO: implement, ecriture en ID3v2.3, regles de non-ecrasement sur null, dump des
# tags d'origine avant reecriture (Feature 5).

from typing import TYPE_CHECKING, ClassVar, Final

from tagger.errors import TaggerError

if TYPE_CHECKING:
    from pathlib import Path

AUDIO_EXTENSIONS: Final = frozenset({".mp3", ".wav", ".aif", ".aiff", ".flac"})


class FilesError(TaggerError):
    """Erreur de lecture du dossier ou d'un fichier audio."""

    code: ClassVar[str] = "files_error"


class TaggingFolderUnreadableError(FilesError):
    """Le dossier a re-tagger n'existe pas ou n'est pas un dossier."""

    code: ClassVar[str] = "tagging_folder_unreadable"

    def __init__(self, path: Path) -> None:
        super().__init__(f"unreadable tagging folder: {path.name}", folder=path.name)


def list_audio_files(folder: Path) -> tuple[Path, ...]:
    """Fichiers audio du dossier, sous-dossiers compris, dans un ordre stable.

    Meme parcours que le dossier source de l'extraction. Le tri se fait segment par
    segment du chemin relatif, sans tenir compte de la casse comme le systeme de
    fichiers Windows : deux runs sur le meme dossier traitent les morceaux dans le
    meme ordre. Trier la chaine entiere ferait dependre l'ordre du separateur,
    l'antislash passant apres les chiffres quand la barre oblique passe avant. Un
    sous-dossier illisible est saute par `rglob` sans erreur.
    """
    if not folder.is_dir():
        raise TaggingFolderUnreadableError(folder)

    found = [
        path
        for path in folder.rglob("*")
        if path.suffix.lower() in AUDIO_EXTENSIONS and path.is_file()
    ]
    return tuple(sorted(found, key=lambda path: _sort_key(path.relative_to(folder))))


def _sort_key(relative: Path) -> tuple[str, ...]:
    return tuple(part.casefold() for part in relative.parts)
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_files_listing.py -x -q`
Expected: PASS, 7 tests

- [ ] **Step 5: Traduire les nouveaux codes d'erreur**

`sidecar/tests/unit/test_error_translations.py` parcourt toutes les sous-classes de `TaggerError`, bases abstraites comprises, et exige une entrée `errors.<code>` dans les deux langues. Dans le bloc `errors` de `public/i18n/fr.json`, ajouter :

```json
    "files_error": "La lecture des fichiers audio a échoué.",
    "tagging_folder_unreadable": "Le dossier à re-tagger est introuvable ou illisible\u00a0: {{folder}}.",
```

et dans `public/i18n/en.json`, au même endroit :

```json
    "files_error": "The audio files could not be read.",
    "tagging_folder_unreadable": "The folder to re-tag cannot be found or read: {{folder}}.",
```

Garder l'ordre des clés identique dans les deux fichiers : `translations.spec.ts` compare leurs clés.

- [ ] **Step 6: Gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 7: Commit**

```bash
git add sidecar/src/tagger/files.py sidecar/tests/unit/test_files_listing.py public/i18n/fr.json public/i18n/en.json
git commit -m "feat(files): enumerer les fichiers audio du dossier a re-tagger"
```

---

## Task 2: Lecture de l'artiste et du titre sur les quatre formats

**Files:**
- Create: `sidecar/tests/helpers/audio_samples.py`
- Modify: `sidecar/tests/conftest.py` (fixture `blank_audio`, TODO réduit au transport httpx2)
- Modify: `sidecar/src/tagger/files.py` (identité, table, erreur de lecture)
- Modify: `public/i18n/fr.json`, `public/i18n/en.json` (`errors.tags_unreadable`)
- Test: `sidecar/tests/unit/test_files_identity.py`

**Interfaces:**
- Consumes: `FilesError`, `AUDIO_EXTENSIONS` (Task 1)
- Produces:
  - `IDENTITY_FIELDS: Final[dict[str, tuple[str, str]]]`, champ vers (frame ID3, clé Vorbis)
  - `UnreadableReason(StrEnum)` : `LOCKED = "locked"`, `UNREADABLE = "unreadable"`
  - `IdentityTags(artist: str, title: str)`, dataclass gelée
  - `TagsUnreadableError(path: Path, reason: UnreadableReason)`, code `tags_unreadable`, params `{"file": path.name, "reason": reason}`, attribut `reason`
  - `read_identity(path: Path) -> IdentityTags`
  - helpers de test : `write_blank_mp3`, `write_blank_wav`, `write_blank_aiff`, `write_blank_flac` (chacun `(path: Path) -> Path`), `BLANK_WRITERS: dict[str, Callable[[Path], Path]]`, `tag(path: Path, *, artist: list[str], title: list[str]) -> None`
  - fixture pytest `blank_audio: Callable[[str], Path]`, qui prend `"mp3"`, `"wav"`, `"aiff"` ou `"flac"`

- [ ] **Step 1: Écrire le helper de fichiers audio vierges**

Chaque fichier est le plus petit que mutagen reconnaisse. Ces constructions ont été vérifiées contre mutagen 1.48.1 : les quatre formats s'ouvrent, se taguent et se relisent.

Créer `sidecar/tests/helpers/audio_samples.py` :

```python
"""Fichiers audio vierges minimaux des quatre formats, construits en octets.

Aucun binaire commite : comme le dump VLC, ce que les tests manipulent se
construit a l'execution. Les fichiers sont muets et sans tags, `tag` les
renseigne dans l'arrange.
"""

import struct
import wave
from typing import TYPE_CHECKING, Final

import mutagen
from mutagen.flac import FLAC
from mutagen.id3 import TIT2, TPE1

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

# MPEG-1 Layer III, 128 kbit/s, 44,1 kHz, mono, sans CRC ni padding : une trame
# fait 144 * 128000 / 44100 = 417 octets. Plusieurs trames, mutagen se
# synchronisant sur une suite de trames coherente.
_MP3_FRAME_HEADER: Final = b"\xff\xfb\x90\xc0"
_MP3_FRAME_LENGTH: Final = 417
_MP3_FRAME_COUNT: Final = 8

# 44100 Hz en flottant etendu 80 bits, seul format de frequence du chunk COMM.
_AIFF_RATE_44100: Final = b"\x40\x0e\xac\x44\x00\x00\x00\x00\x00\x00"


def write_blank_mp3(path: Path) -> Path:
    """Suite de trames MPEG silencieuses, sans tag ID3."""
    frame = _MP3_FRAME_HEADER + b"\x00" * (_MP3_FRAME_LENGTH - len(_MP3_FRAME_HEADER))
    path.write_bytes(frame * _MP3_FRAME_COUNT)
    return path


def write_blank_wav(path: Path) -> Path:
    """RIFF/WAVE mono 16 bits, un centieme de seconde de silence."""
    with wave.open(str(path), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(44_100)
        audio.writeframes(b"\x00\x00" * 441)
    return path


def write_blank_aiff(path: Path) -> Path:
    """FORM/AIFF ecrit a la main : `aifc` a quitte la stdlib en 3.13."""
    frames = 441
    comm = struct.pack(">hLh", 1, frames, 16) + _AIFF_RATE_44100
    ssnd = struct.pack(">LL", 0, 0) + b"\x00\x00" * frames
    chunks = (
        b"COMM"
        + struct.pack(">L", len(comm))
        + comm
        + b"SSND"
        + struct.pack(">L", len(ssnd))
        + ssnd
    )
    path.write_bytes(b"FORM" + struct.pack(">L", 4 + len(chunks)) + b"AIFF" + chunks)
    return path


def write_blank_flac(path: Path) -> Path:
    """Signature `fLaC` et bloc STREAMINFO seul : mutagen n'a besoin d'aucune trame."""
    sample_rate, channels, bits_per_sample, total_samples = 44_100, 1, 16, 0
    packed = (
        (sample_rate << 44) | ((channels - 1) << 41) | ((bits_per_sample - 1) << 36) | total_samples
    )
    streaminfo = (
        struct.pack(">HH", 4096, 4096) + b"\x00" * 6 + struct.pack(">Q", packed) + b"\x00" * 16
    )
    last_block_streaminfo = bytes([0x80]) + len(streaminfo).to_bytes(3, "big")
    path.write_bytes(b"fLaC" + last_block_streaminfo + streaminfo)
    return path


BLANK_WRITERS: Final[dict[str, Callable[[Path], Path]]] = {
    "mp3": write_blank_mp3,
    "wav": write_blank_wav,
    "aiff": write_blank_aiff,
    "flac": write_blank_flac,
}


def tag(path: Path, *, artist: list[str], title: list[str]) -> None:
    """Pose artiste et titre avec mutagen, dans le systeme de tags du format."""
    audio = mutagen.File(path)
    if isinstance(audio, FLAC):
        audio["ARTIST"] = artist
        audio["TITLE"] = title
    else:
        if audio.tags is None:
            audio.add_tags()
        audio.tags.add(TPE1(encoding=3, text=artist))
        audio.tags.add(TIT2(encoding=3, text=title))
    audio.save()
```

- [ ] **Step 2: Ajouter la fixture `blank_audio`**

Dans `sidecar/tests/conftest.py`, réduire le TODO au seul transport httpx2, importer le helper et ajouter la fixture après `vlc_dump` :

```python
from audio_samples import BLANK_WRITERS

# TODO: implement — fixture de transport httpx2 mocke.
```

```python
@pytest.fixture
def blank_audio(tmp_path: Path) -> Callable[[str], Path]:
    """Fabrique de fichiers audio vierges, `"mp3"`, `"wav"`, `"aiff"` ou `"flac"`.

    Construits en octets par `helpers/audio_samples.py` : aucun binaire commite.
    """

    def make(audio_format: str) -> Path:
        return BLANK_WRITERS[audio_format](tmp_path / f"track.{audio_format}")

    return make
```

Ajouter `Callable` aux imports sous `if TYPE_CHECKING:` : `from collections.abc import Callable, Iterator`.

- [ ] **Step 3: Écrire les tests de lecture**

Créer `sidecar/tests/unit/test_files_identity.py` :

```python
"""Tests de la lecture de l'artiste et du titre, sur les quatre formats."""

from typing import TYPE_CHECKING

import mutagen
import pytest
from audio_samples import tag
from mutagen import MutagenError

from tagger.files import IdentityTags, TagsUnreadableError, UnreadableReason, read_identity

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path


@pytest.mark.parametrize("audio_format", ["mp3", "wav", "aiff"], ids=["mp3", "wav", "aiff"])
def test_reads_artist_and_title_from_the_id3_frames(
    blank_audio: Callable[[str], Path], audio_format: str
) -> None:
    path = blank_audio(audio_format)
    tag(path, artist=["Adam Beyer"], title=["Your Mind"])

    identity = read_identity(path)

    assert identity == IdentityTags(artist="Adam Beyer", title="Your Mind")


def test_reads_artist_and_title_from_the_vorbis_keys_of_a_flac_file(
    blank_audio: Callable[[str], Path],
) -> None:
    path = blank_audio("flac")
    tag(path, artist=["Amelie Lens"], title=["Basiel"])

    identity = read_identity(path)

    assert identity == IdentityTags(artist="Amelie Lens", title="Basiel")


@pytest.mark.parametrize("audio_format", ["mp3", "flac"], ids=["id3", "vorbis"])
def test_joins_multiple_artist_values_with_a_comma(
    blank_audio: Callable[[str], Path], audio_format: str
) -> None:
    path = blank_audio(audio_format)
    tag(path, artist=["Adam Beyer", "Bart Skils"], title=["Your Mind"])

    identity = read_identity(path)

    assert identity.artist == "Adam Beyer, Bart Skils"


def test_strips_blanks_and_drops_empty_values(blank_audio: Callable[[str], Path]) -> None:
    path = blank_audio("flac")
    tag(path, artist=[" Adam Beyer ", "", "  "], title=["  Your Mind"])

    identity = read_identity(path)

    assert identity == IdentityTags(artist="Adam Beyer", title="Your Mind")


@pytest.mark.parametrize("audio_format", ["mp3", "wav", "aiff", "flac"])
def test_returns_an_empty_identity_for_a_file_without_tags(
    blank_audio: Callable[[str], Path], audio_format: str
) -> None:
    path = blank_audio(audio_format)

    identity = read_identity(path)

    assert identity == IdentityTags(artist="", title="")


def test_raises_unreadable_when_the_content_matches_no_format(tmp_path: Path) -> None:
    path = tmp_path / "broken.mp3"
    path.write_bytes(b"not an audio file" * 16)

    with pytest.raises(TagsUnreadableError) as error:
        read_identity(path)

    assert error.value.reason is UnreadableReason.UNREADABLE
    assert error.value.params == {"file": "broken.mp3", "reason": UnreadableReason.UNREADABLE}


def test_raises_locked_when_the_read_fails_on_a_permission_error(
    blank_audio: Callable[[str], Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    path = blank_audio("mp3")

    def locked_file(_path: Path) -> None:
        raise MutagenError("file in use") from PermissionError(13, "Permission denied")

    monkeypatch.setattr(mutagen, "File", locked_file)

    with pytest.raises(TagsUnreadableError) as error:
        read_identity(path)

    assert error.value.reason is UnreadableReason.LOCKED


@pytest.mark.parametrize("audio_format", ["mp3", "wav", "aiff", "flac"])
def test_leaves_the_file_bytes_unchanged_after_reading(
    blank_audio: Callable[[str], Path], audio_format: str
) -> None:
    path = blank_audio(audio_format)
    tag(path, artist=["Sara Landry"], title=["The Void"])
    before = path.read_bytes()

    read_identity(path)

    assert path.read_bytes() == before
```

- [ ] **Step 4: Vérifier que les tests échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_files_identity.py -x -q`
Expected: FAIL, `ImportError: cannot import name 'IdentityTags' from 'tagger.files'`

- [ ] **Step 5: Implémenter la lecture**

Dans `sidecar/src/tagger/files.py`, compléter les imports :

```python
from dataclasses import dataclass
from enum import UNIQUE, StrEnum, auto, verify
from typing import TYPE_CHECKING, ClassVar, Final

import mutagen
from mutagen import MutagenError
from mutagen.flac import VCFLACDict
from mutagen.id3 import ID3

from tagger.errors import TaggerError

if TYPE_CHECKING:
    from collections.abc import Iterable
    from pathlib import Path
```

Ajouter après `AUDIO_EXTENSIONS` :

```python
# Champ vers (frame ID3, cle Vorbis), cf. ADR-011 § Correspondance des champs. La
# Feature 5 etend cette table aux autres champs, ici et nulle part ailleurs.
IDENTITY_FIELDS: Final = {
    "artist": ("TPE1", "ARTIST"),
    "title": ("TIT2", "TITLE"),
}

# La virgule fait basculer le scoring d'un artiste multiple sur token_sort_ratio.
_MULTI_VALUE_SEPARATOR: Final = ", "


@verify(UNIQUE)
class UnreadableReason(StrEnum):
    """Motif d'une lecture en echec, repris dans le log du pipeline."""

    LOCKED = auto()
    UNREADABLE = auto()


@dataclass(frozen=True, slots=True)
class IdentityTags:
    """Artiste et titre lus dans un fichier, chaine vide quand le tag est absent."""

    artist: str
    title: str
```

Ajouter après `TaggingFolderUnreadableError` :

```python
class TagsUnreadableError(FilesError):
    """Les tags d'un fichier n'ont pas pu etre lus.

    Leve et jamais logue ici : le pipeline connait le run et le morceau, logue
    l'incident avec eux et poursuit avec une identite vide.
    """

    code: ClassVar[str] = "tags_unreadable"

    def __init__(self, path: Path, reason: UnreadableReason) -> None:
        super().__init__(f"unreadable tags: {path.name}", file=path.name, reason=reason)
        self.reason = reason
```

Ajouter à la fin du fichier :

```python
def read_identity(path: Path) -> IdentityTags:
    """Artiste et titre du fichier, sans jamais l'ecrire.

    La colonne de la table se choisit sur le type des tags lus et non sur
    l'extension : un `.mp3` qui contient du FLAC est lu comme un FLAC.
    """
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

    match audio.tags:
        case ID3() as tags:
            artist, title = (_id3_text(tags, frame) for frame, _ in IDENTITY_FIELDS.values())
        case VCFLACDict() as tags:
            artist, title = (_vorbis_text(tags, key) for _, key in IDENTITY_FIELDS.values())
        case _:
            artist, title = "", ""

    return IdentityTags(artist=artist, title=title)


def _id3_text(tags: ID3, frame_id: str) -> str:
    return _join(tags[frame_id].text) if frame_id in tags else ""


def _vorbis_text(tags: VCFLACDict, key: str) -> str:
    return _join(tags[key]) if key in tags else ""


def _join(values: Iterable[object]) -> str:
    cleaned = (str(value).strip() for value in values)
    return _MULTI_VALUE_SEPARATOR.join(value for value in cleaned if value)
```

`ID3` couvre MP3, WAV et AIFF (les tags de `WAVE` et `AIFF` en héritent), `VCFLACDict` couvre FLAC. Le `case _` couvre un fichier sans tags, où `audio.tags` vaut `None`. Les accès par indexation après un test d'appartenance évitent le `.get()` non typé de mutagen.

- [ ] **Step 6: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_files_identity.py tests/unit/test_files_listing.py -x -q`
Expected: PASS, 24 tests (17 de lecture, paramétrages compris, plus les 7 de la Task 1)

- [ ] **Step 7: Traduire les nouveaux codes d'erreur**

`sidecar/tests/unit/test_error_translations.py` parcourt toutes les sous-classes de `TaggerError`, bases abstraites comprises, et exige une entrée `errors.<code>` dans les deux langues. Dans le bloc `errors` de `public/i18n/fr.json`, ajouter :

```json
    "tags_unreadable": "Les tags de {{file}} n'ont pas pu être lus.",
```

et dans `public/i18n/en.json`, au même endroit :

```json
    "tags_unreadable": "The tags of {{file}} could not be read.",
```

- [ ] **Step 8: Gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 9: Commit**

```bash
git add sidecar/src/tagger/files.py sidecar/tests/helpers/audio_samples.py sidecar/tests/conftest.py sidecar/tests/unit/test_files_identity.py public/i18n/fr.json public/i18n/en.json
git commit -m "feat(files): lire l'artiste et le titre des quatre formats audio"
```
