# Renommage des fichiers : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Renommer un fichier écrit en `{artist} - {title}.{ext}` avec un nom lisible, valide sous Windows, sans collision et dont le chemin reste ouvrable par les autres logiciels.

**Architecture:** Le nouveau module `renaming.py` sépare le calcul pur du nom (`track_file_name` : remplacements lisibles, extension en minuscules, troncature du titre, marqueur de copie) de son application sur le disque (`rename_track` : artiste ou titre absent, place disponible sous 259 caractères, premier nom libre, casse seule, nom déjà correct et le chemin cible annoncé à l'appelant juste avant l'appel système). L'appel système passe par `paths.extended_path`, qui préfixe `\\?\` sans résoudre le nom. Un échec devient `RenameError` avec un motif `FileFailureReason`.

**Tech Stack:** Python 3.14 (`re`, `pathlib`), pytest sur `tmp_path` (CI Windows `windows-2025`, système de fichiers insensible à la casse). Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/ecriture-des-tags-et-renommage/03-renommage-fichiers-design.md`

## Global Constraints

- **Dépend du sub-project 01, implémenté avant** : `tagger.file_failures.FileFailureReason` et `file_failure_reason(OSError)`.
- **Remplacements lisibles**, sur l'artiste et le titre séparément : `/`, `\`, `|` → `-` ; `": "` → `" - "` ; `:` isolé → `-` ; `"` → `'` ; `?`, `*`, `<`, `>` et caractères de contrôle supprimés ; espaces multiples réduits à un seul, tabulations comprises.
- **Nom** : `Artiste - Titre` sans point, espace ni tiret final, extension en minuscules (`.aif` reste `.aif`).
- **Longueur** : nom ≤ 255 caractères, chemin complet ≤ 259 ; la fin du titre est coupée, la troncature signalée.
- **Collision** avec un autre fichier : ` (2)`, ` (3)`… avant l'extension, rien n'est écrasé.
- **Pas de renommage** sans artiste ou sans titre (vides après nettoyage compris), ni quand le nom est déjà le bon. L'absence d'artiste ou de titre se juge avant la place disponible : un fichier sans artiste garde son nom même dans un dossier profond.
- **Cible annoncée** : `rename_track` appelle `before_rename(target)` juste avant l'appel système, jamais quand le fichier garde son nom. Le sub-project 04 y note le chemin au dump avant que le fichier ne bouge.
- **Casse seule** : renommage direct, sans marqueur.
- **Chemin rendu** sans préfixe `\\?\`.
- **Échec** : `RenameError(path, reason)`, code `file_rename_failed`, `params` = `file` et `reason`. Aucun log dans le module.
- **Code Python sans accents**, docstrings et commentaires en français, le pourquoi seulement.
- **Tests** : noms en anglais, AAA séparé par des lignes vides, disque dans `tmp_path`.
- **Gate vert à chaque commit** : `just lint-sidecar`, `just typecheck-sidecar`, `just test-sidecar`, plus `just lint-ui` quand les JSON de langue changent. Commits `type(scope): description`, scope `sidecar`.

## Review Focus

- **Fichier dont seule la casse change** (`adam beyer - …` vers `Adam Beyer - …`) : renommé sans ` (2)`, malgré un `exists()` vrai sous Windows (Task 1, `test_fixes_the_case_without_a_copy_marker`).
- **Fichier déjà suffixé par un run précédent** (`X (2).mp3` avec `X.mp3` présent) : garde son nom, pas de ` (3)` (Task 1, `test_keeps_a_name_already_suffixed_by_a_previous_run`).
- **Collision dans un dossier au chemin long** : le marqueur tient sous 259 caractères (Task 1, `test_keeps_the_copy_marker_within_the_path_limit`).
- **Tag contenant une tabulation ou un caractère de contrôle** : mots séparés par une espace, aucun caractère invisible dans le nom (Task 1, `test_replaces_the_characters_windows_forbids_readably`, cas `control-characters`).
- **Fichier sans artiste dans un dossier trop profond** : il garde son nom, aucune `RenameError` (Task 1, `test_keeps_the_name_without_an_artist_even_when_the_folder_leaves_no_room`).
- **Cible annoncée avant le déplacement** : l'appelant reçoit le chemin cible alors que le fichier porte encore son ancien nom (Task 1, `test_announces_the_target_just_before_renaming`).
- **Fichier verrouillé par le lecteur DJ au moment du renommage** : `file_locked`, nom d'origine conservé (Task 1, `test_raises_file_locked_and_keeps_the_name_of_a_held_file`).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `sidecar/src/tagger/renaming.py` | Calcul du nom, application, collisions, `RenameError`. |
| `sidecar/src/tagger/paths.py` | `extended_path` : préfixe `\\?\`, UNC compris. |
| `sidecar/tests/unit/test_renaming.py` | Calcul pur et renommage sur le disque. |
| `sidecar/tests/unit/test_paths.py` | Préfixe des chemins longs. |
| `public/i18n/{fr,en}.json` | `errors.file_rename_failed`. |
| `docs/ARCHITECTURE.md` | Règles du nom, limite de 259 caractères, collision. |

---

### Task 1: Calcul du nom et renommage sur le disque

**Files:**
- Create: `sidecar/src/tagger/renaming.py`
- Modify: `sidecar/src/tagger/paths.py`
- Create: `sidecar/tests/unit/test_renaming.py`
- Modify: `sidecar/tests/unit/test_paths.py`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`

**Interfaces:**
- Consumes: `FileFailureReason`, `file_failure_reason` (sub-project 01).
- Produces: `paths.extended_path(path: Path) -> Path` ; `renaming.MAX_PATH_LENGTH = 259`, `MAX_NAME_LENGTH = 255` ; `renaming.TrackFileName(name: str, truncated: bool)` ; `renaming.track_file_name(artist: str, title: str, suffix: str, room: int, copy: int = 1) -> TrackFileName | None` ; `renaming.RenamedTrack(path: Path, truncated: bool)` ; `renaming.rename_track(path: Path, artist: str | None, title: str | None, before_rename: Callable[[Path], None] | None = None) -> RenamedTrack`, synchrone ; `renaming.RenameError(path, reason)` (`.reason`). Le sub-project 04 renomme après l'écriture avec `TagField.ARTIST` et `TagField.TITLE` de la projection, le 06 rend son nom d'origine au fichier.

- [ ] **Step 1: Écrire les tests du préfixe**

Ajouter à `sidecar/tests/unit/test_paths.py`, en important `extended_path` à côté d'`app_data_dir` :

```python
def test_prefixes_a_local_path_for_long_paths(tmp_path: Path) -> None:
    path = tmp_path / "track.mp3"

    extended = extended_path(path)

    assert str(extended) == f"\\\\?\\{tmp_path.resolve()}\\track.mp3"


def test_prefixes_a_network_share_as_unc() -> None:
    path = Path("\\\\nas\\music\\track.mp3")

    extended = extended_path(path)

    assert str(extended) == "\\\\?\\UNC\\nas\\music\\track.mp3"


def test_leaves_an_already_prefixed_path_alone(tmp_path: Path) -> None:
    path = extended_path(tmp_path / "track.mp3")

    extended = extended_path(path)

    assert extended == path
```

- [ ] **Step 2: Écrire les tests du renommage**

`sidecar/tests/unit/test_renaming.py` :

```python
"""Tests du renommage d'un fichier ecrit, calcul du nom puis application sur le disque."""

from pathlib import Path

import pytest

from tagger.file_failures import FileFailureReason
from tagger.renaming import (
    MAX_PATH_LENGTH,
    RenamedTrack,
    RenameError,
    TrackFileName,
    rename_track,
    track_file_name,
)

ARTIST = "Adam Beyer"
TITLE = "Your Mind (Extended Mix)"
TARGET = "Adam Beyer - Your Mind (Extended Mix).mp3"


def _file(folder: Path, name: str, content: bytes = b"audio") -> Path:
    path = folder / name
    path.write_bytes(content)
    return path


def _folder_leaving(tmp_path: Path, room: int) -> Path:
    """Dossier dont le chemin ne laisse que `room` caracteres au nom du fichier."""
    folder = tmp_path / ("x" * (MAX_PATH_LENGTH - len(str(tmp_path)) - 2 - room))
    folder.mkdir()
    return folder


@pytest.mark.parametrize(
    ("artist", "title", "expected"),
    [
        ("AC/DC", "Back In Black", "AC-DC - Back In Black.mp3"),
        ("Someone", "Mind: Body (Who? Remix)", "Someone - Mind - Body (Who Remix).mp3"),
        ("Someone", '"Kick" *Edit*', "Someone - 'Kick' Edit.mp3"),
        ("A\\B", "C|D", "A-B - C-D.mp3"),
        ("Someone", "12:00 <Live>", "Someone - 12-00 Live.mp3"),
        ("Some\tone", "Bell\x07 Ring", "Some one - Bell Ring.mp3"),
        ("Mr. Oizo", "Flat Beat.", "Mr. Oizo - Flat Beat.mp3"),
        ("Adam  Beyer", "Your   Mind", "Adam Beyer - Your Mind.mp3"),
    ],
    ids=[
        "slash",
        "colon-and-question-mark",
        "quotes-and-star",
        "backslash-and-pipe",
        "bare-colon-and-angles",
        "control-characters",
        "trailing-dot",
        "repeated-spaces",
    ],
)
def test_replaces_the_characters_windows_forbids_readably(
    artist: str, title: str, expected: str
) -> None:
    named = track_file_name(artist, title, ".mp3", room=255)

    assert named == TrackFileName(expected, truncated=False)


@pytest.mark.parametrize(
    ("suffix", "expected"), [(".MP3", ".mp3"), (".Flac", ".flac"), (".AIF", ".aif")]
)
def test_lowercases_the_extension(suffix: str, expected: str) -> None:
    named = track_file_name(ARTIST, "Your Mind", suffix, room=255)

    assert named == TrackFileName(f"Adam Beyer - Your Mind{expected}", truncated=False)


def test_cuts_the_end_of_the_title_to_fit_the_room() -> None:
    named = track_file_name(ARTIST, "Your Mind (Layton Giordani Extended Remix)", ".mp3", room=30)

    assert named == TrackFileName("Adam Beyer - Your Mind (La.mp3", truncated=True)


def test_cleans_the_loose_end_a_cut_leaves() -> None:
    named = track_file_name(ARTIST, "Your Mind", ".mp3", room=17)

    assert named == TrackFileName("Adam Beyer.mp3", truncated=True)


def test_keeps_the_copy_marker_inside_the_room() -> None:
    named = track_file_name(ARTIST, "Your Mind", ".mp3", room=30, copy=2)

    assert named == TrackFileName("Adam Beyer - Your Mind (2).mp3", truncated=False)


@pytest.mark.parametrize(
    ("artist", "title"),
    [("", "Tarantula"), ("Adam Beyer", ""), ("???", "Tarantula"), ("Adam Beyer", "*")],
    ids=["no-artist", "no-title", "artist-of-forbidden-characters", "title-of-forbidden"],
)
def test_names_nothing_without_an_artist_and_a_title(artist: str, title: str) -> None:
    named = track_file_name(artist, title, ".mp3", room=255)

    assert named is None


def test_renames_the_file_in_its_folder(tmp_path: Path) -> None:
    path = _file(tmp_path, "adam beyer - your mind.MP3")

    renamed = rename_track(path, ARTIST, TITLE)

    assert renamed == RenamedTrack(tmp_path / TARGET, truncated=False)
    assert [entry.name for entry in tmp_path.iterdir()] == [TARGET]


def test_leaves_a_correctly_named_file_alone(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = _file(tmp_path, TARGET)
    renames: list[Path] = []
    monkeypatch.setattr(Path, "rename", lambda source, _target: renames.append(source))

    renamed = rename_track(path, ARTIST, TITLE)

    assert renamed == RenamedTrack(path, truncated=False)
    assert renames == []


def test_fixes_the_case_without_a_copy_marker(tmp_path: Path) -> None:
    path = _file(tmp_path, "adam beyer - your mind (extended mix).mp3")

    renamed = rename_track(path, ARTIST, TITLE)

    assert renamed.path == tmp_path / TARGET
    assert [entry.name for entry in tmp_path.iterdir()] == [TARGET]


def test_adds_a_copy_marker_on_collision(tmp_path: Path) -> None:
    _file(tmp_path, TARGET, b"existing")
    second = _file(tmp_path, "second.mp3")
    third = _file(tmp_path, "third.mp3")

    renamed = [rename_track(second, ARTIST, TITLE), rename_track(third, ARTIST, TITLE)]

    assert [track.path.name for track in renamed] == [
        "Adam Beyer - Your Mind (Extended Mix) (2).mp3",
        "Adam Beyer - Your Mind (Extended Mix) (3).mp3",
    ]
    assert (tmp_path / TARGET).read_bytes() == b"existing"


def test_cuts_a_name_that_would_exceed_the_path_limit(tmp_path: Path) -> None:
    folder = _folder_leaving(tmp_path, room=40)
    path = _file(folder, "track.mp3")

    renamed = rename_track(path, ARTIST, "Your Mind (Layton Giordani Extended Remix)")

    assert renamed.truncated
    assert len(str(renamed.path)) <= MAX_PATH_LENGTH
    assert renamed.path.is_file()


def test_keeps_the_copy_marker_within_the_path_limit(tmp_path: Path) -> None:
    folder = _folder_leaving(tmp_path, room=40)
    title = "Your Mind (Layton Giordani Extended Remix)"
    rename_track(_file(folder, "first.mp3"), ARTIST, title)

    renamed = rename_track(_file(folder, "second.mp3"), ARTIST, title)

    assert renamed.path.name.endswith(" (2).mp3")
    assert len(str(renamed.path)) <= MAX_PATH_LENGTH


def test_keeps_the_name_without_an_artist(tmp_path: Path) -> None:
    path = _file(tmp_path, "rip_0042.wav")

    renamed = rename_track(path, None, "Tarantula")

    assert renamed == RenamedTrack(path, truncated=False)
    assert path.is_file()


def test_keeps_the_name_without_an_artist_even_when_the_folder_leaves_no_room() -> None:
    path = Path("C:/") / ("x" * 300) / "track.mp3"

    renamed = rename_track(path, None, "Tarantula")

    assert renamed == RenamedTrack(path, truncated=False)


def test_announces_the_target_just_before_renaming(tmp_path: Path) -> None:
    path = _file(tmp_path, "adam beyer - your mind.MP3")
    announced: list[tuple[Path, bool]] = []

    renamed = rename_track(
        path, ARTIST, TITLE, lambda target: announced.append((target, path.is_file()))
    )

    assert announced == [(tmp_path / TARGET, True)]
    assert renamed.path == tmp_path / TARGET


def test_announces_nothing_when_the_file_keeps_its_name(tmp_path: Path) -> None:
    path = _file(tmp_path, TARGET)
    announced: list[Path] = []

    rename_track(path, ARTIST, TITLE, announced.append)

    assert announced == []


def test_raises_path_too_long_when_the_folder_leaves_no_room() -> None:
    path = Path("C:/") / ("x" * 300) / "track.mp3"

    with pytest.raises(RenameError, match="file not renamed") as error:
        rename_track(path, ARTIST, TITLE)

    assert error.value.reason is FileFailureReason.PATH_TOO_LONG


def test_raises_file_locked_and_keeps_the_name_of_a_held_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = _file(tmp_path, "track.mp3")

    def held(_source: Path, _target: Path) -> Path:
        raise OSError(32, "The process cannot access the file", None, 32)

    monkeypatch.setattr(Path, "rename", held)

    with pytest.raises(RenameError) as error:
        rename_track(path, ARTIST, TITLE)

    assert error.value.params == {"file": "track.mp3", "reason": FileFailureReason.FILE_LOCKED}
    assert path.is_file()


def test_raises_file_missing_for_a_vanished_file(tmp_path: Path) -> None:
    path = tmp_path / "gone.mp3"

    with pytest.raises(RenameError) as error:
        rename_track(path, ARTIST, TITLE)

    assert error.value.reason is FileFailureReason.FILE_MISSING


def test_keeps_a_name_already_suffixed_by_a_previous_run(tmp_path: Path) -> None:
    _file(tmp_path, TARGET)
    path = _file(tmp_path, "Adam Beyer - Your Mind (Extended Mix) (2).mp3")

    renamed = rename_track(path, ARTIST, TITLE)

    assert renamed == RenamedTrack(path, truncated=False)
```

- [ ] **Step 3: Vérifier qu'ils échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_renaming.py tests/unit/test_paths.py --no-cov -q`
Expected: FAIL, `ModuleNotFoundError: No module named 'tagger.renaming'` et `ImportError: cannot import name 'extended_path'`

- [ ] **Step 4: Préfixer les chemins longs**

Dans `sidecar/src/tagger/paths.py`, ajouter `from typing import Final` aux imports, puis sous `from tagger import BUNDLE_IDENTIFIER` :

```python
_EXTENDED_PREFIX: Final = "\\\\?\\"
_UNC_PREFIX: Final = "\\\\"
```

À la fin du module :

```python
def extended_path(path: Path) -> Path:
    """Chemin prefixe `\\\\?\\`, qui leve la limite de 260 caracteres de l'API Win32.

    La cle `LongPathsEnabled` est desactivee par defaut et l'application ne peut pas l'activer.
    Le prefixe exige un chemin absolu et normalise. Seul le dossier est resolu : resoudre le
    nom rendrait la casse deja sur le disque, et un renommage de casse seule n'aurait plus d'effet.
    """
    text = str(path.parent.resolve() / path.name)
    if text.startswith(_EXTENDED_PREFIX):
        return path
    if text.startswith(_UNC_PREFIX):
        return Path(f"{_EXTENDED_PREFIX}UNC\\{text.removeprefix(_UNC_PREFIX)}")
    return Path(f"{_EXTENDED_PREFIX}{text}")
```

La docstring de tête du module, réécrite par le sub-project 02, reste telle quelle.

- [ ] **Step 5: Écrire le module de renommage**

`sidecar/src/tagger/renaming.py` :

```python
"""Renommage d'un fichier ecrit en `{artist} - {title}.{ext}`, dans son dossier.

Le nom reste ouvrable par les logiciels qui ignorent les chemins longs : ce sont eux qui
fixent la limite de 259 caracteres (ARCHITECTURE.md § Robustesse).
"""

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, ClassVar, Final, NamedTuple

from tagger.errors import TaggerError
from tagger.file_failures import FileFailureReason, file_failure_reason
from tagger.paths import extended_path

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

# MAX_PATH de l'API Win32, terminateur nul deduit.
MAX_PATH_LENGTH: Final = 259
# Longueur maximale d'un nom sous NTFS.
MAX_NAME_LENGTH: Final = 255

_SEPARATOR: Final = " - "
_SPACES: Final = re.compile(r"\s+")
# Ordre significatif : tabulation en espace avant la purge des controles, `: ` avant le
# `:` isole, espaces resserres a nouveau apres les suppressions.
_READABLE_REPLACEMENTS: Final = (
    (_SPACES, " "),
    (re.compile(r"[\\/|]"), "-"),
    (re.compile(r":\s+"), " - "),
    (re.compile(r":"), "-"),
    (re.compile(r'"'), "'"),
    (re.compile(r"[?*<>\x00-\x1f]"), ""),
    (_SPACES, " "),
)
# Ce qu'une coupe ou un nettoyage laisse en bout de nom sans rien signifier.
_LOOSE_END: Final = " .-"


class TrackFileName(NamedTuple):
    """Nom calcule, et s'il a fallu couper le titre pour qu'il tienne."""

    name: str
    truncated: bool


@dataclass(frozen=True, slots=True)
class RenamedTrack:
    """Chemin du fichier apres renommage, sans prefixe `\\\\?\\`."""

    path: Path
    truncated: bool


class RenameError(TaggerError):
    """Fichier non renomme, il garde son nom ; levee sans log, l'appelant connait le run."""

    code: ClassVar[str] = "file_rename_failed"

    def __init__(self, path: Path, reason: FileFailureReason) -> None:
        super().__init__(f"file not renamed: {path.name}", file=path.name, reason=reason)
        self.reason = reason


def track_file_name(
    artist: str, title: str, suffix: str, room: int, copy: int = 1
) -> TrackFileName | None:
    """Nom `Artiste - Titre.ext` tenant en `room` caracteres, `None` sans artiste ou titre.

    `copy` au-dela de 1 ajoute ` (copy)` avant l'extension. La coupe entame le titre, l'artiste
    en dernier recours.
    """
    readable_artist, readable_title = _readable(artist), _readable(title)
    if not readable_artist or not readable_title:
        return None

    marker = f" ({copy})" if copy > 1 else ""
    extension = suffix.lower()
    # Windows retire en silence point et espace finaux : les garder ferait diverger le nom.
    stem = f"{readable_artist}{_SEPARATOR}{readable_title}".rstrip(_LOOSE_END)
    available = max(room - len(extension) - len(marker), 1)
    if len(stem) <= available:
        return TrackFileName(f"{stem}{marker}{extension}", truncated=False)

    cut = stem[:available].rstrip(_LOOSE_END) or stem[:available]
    return TrackFileName(f"{cut}{marker}{extension}", truncated=True)


def rename_track(
    path: Path,
    artist: str | None,
    title: str | None,
    before_rename: Callable[[Path], None] | None = None,
) -> RenamedTrack:
    """Renomme le fichier dans son dossier ; sans artiste ou titre, il garde son nom.

    `before_rename(target)` part juste avant l'appel systeme, jamais si le nom est garde :
    l'appelant le note avant le deplacement.
    """
    if not _readable(artist or "") or not _readable(title or ""):
        return RenamedTrack(path, truncated=False)

    room = min(MAX_NAME_LENGTH, MAX_PATH_LENGTH - len(str(path.parent)) - 1)
    if room <= len(path.suffix):
        raise RenameError(path, FileFailureReason.PATH_TOO_LONG)

    named = _free_name(path, artist or "", title or "", room)
    if named is None:
        return RenamedTrack(path, truncated=False)

    target = path.with_name(named.name)
    if before_rename is not None:
        before_rename(target)
    try:
        extended_path(path).rename(extended_path(target))
    except OSError as error:
        raise RenameError(path, file_failure_reason(error)) from error
    return RenamedTrack(target, named.truncated)


def _free_name(path: Path, artist: str, title: str, room: int) -> TrackFileName | None:
    """Premier nom libre au motif, `None` quand le fichier garde le sien."""
    copy = 1
    while True:
        named = track_file_name(artist, title, path.suffix, room, copy)
        if named is None or named.name == path.name:
            return None
        if not _taken_by_another_file(path.with_name(named.name), path):
            return named
        copy += 1


def _readable(text: str) -> str:
    for pattern, replacement in _READABLE_REPLACEMENTS:
        text = pattern.sub(replacement, text)
    return text.strip()


def _taken_by_another_file(target: Path, path: Path) -> bool:
    """Un nom qui ne differe que par la casse designe le meme fichier sous Windows."""
    extended_target = extended_path(target)
    return extended_target.exists() and not extended_target.samefile(extended_path(path))
```

- [ ] **Step 6: Traduire le code d'erreur**

Dans `errors`, juste après `tags_write_failed` :

`public/i18n/fr.json` :

```json
    "file_rename_failed": "Le fichier {{file}} n'a pas pu être renommé.",
```

`public/i18n/en.json` :

```json
    "file_rename_failed": "The file {{file}} could not be renamed.",
```

- [ ] **Step 7: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_renaming.py tests/unit/test_paths.py tests/unit/test_error_translations.py --no-cov -q`
Expected: PASS

- [ ] **Step 8: Lancer le gate**

Run: `just format-sidecar && just lint-sidecar && just typecheck-sidecar && just test-sidecar && just lint-ui`
Expected: tout passe, `renaming.py` et `paths.py` couverts à 100 %.

- [ ] **Step 9: Commit**

```bash
git add sidecar/src/tagger/renaming.py sidecar/src/tagger/paths.py sidecar/tests/unit/test_renaming.py sidecar/tests/unit/test_paths.py public/i18n/fr.json public/i18n/en.json
git commit -m "feat(sidecar): renommer un fichier écrit en artiste - titre, lisible et sans collision"
```

---

### Task 2: Règles du nom dans l'architecture

**Files:**
- Modify: `docs/ARCHITECTURE.md` (§ Capacités Natives l. 386 et use-case 5 l. 247 ; § Robustesse l. 827 ; arborescence l. 113-133)
- Modify: `docs/PRODUCTION.md:323`

**Interfaces:**
- Consumes: les décisions du spec.
- Produces: une architecture qui décrit le nom réellement produit.

- [ ] **Step 1: Décrire le nom produit**

Charger `Skill[architecture-doc]` avant d'éditer. Dans `docs/ARCHITECTURE.md` :
- § Capacités Natives, après la phrase sur le motif `{artist} - {title}.{ext}` : « Caractères interdits remplacés de façon lisible (`/ \ |` → `-`, `": "` → `" - "`, `:` → `-`, `"` → `'`, `? * < >` et caractères de contrôle supprimés), extension en minuscules, aucun renommage sans artiste ou sans titre, collision suffixée ` (2)`, ` (3)`… sans jamais écraser un fichier » ;
- § Robustesse, chemins longs Windows (l. 827) : corriger « `LongPathsEnabled` ne suffit pas, l'application devant elle-même être manifestée pour en bénéficier, ce que l'interpréteur Python n'est pas », faux depuis que PyInstaller active `longPathAware` (version 4.2), en « la clé `LongPathsEnabled` est désactivée par défaut chez l'utilisateur et l'application ne peut pas l'activer à sa place » ; préciser que le nom généré est tronqué en fin de titre pour que le chemin complet reste à 259 caractères au plus, limite des logiciels non adaptés aux chemins longs, le préfixe `\\?\` ne protégeant que le sidecar ;
- use-case 5 (l. 247) : « Le renommage vient toujours en dernier, puisqu'il relit les tags fraîchement écrits » est faux, le renommage part de la projection sans rouvrir le fichier : → « Le renommage vient toujours en dernier : il ne s'applique qu'à un morceau dont les tags sont écrits, et calcule le nom depuis la projection écrite, sans rouvrir le fichier » ;
- arborescence du sidecar (l. 113-133) : ajouter après `files.py` la ligne `renaming.py  # nom de fichier artiste - titre, collisions, chemins longs`, au même alignement que ses voisines.

Charger `Skill[production-doc]` et lire son template avant d'éditer `docs/PRODUCTION.md`. Dans `docs/PRODUCTION.md` :
- l. 323 (checklist, préfixe `\\?\`) : « `LongPathsEnabled` ne suffit pas à un interpréteur Python non manifesté » → « `LongPathsEnabled` est désactivée par défaut chez l'utilisateur et l'application ne peut pas l'activer ».

- [ ] **Step 2: Vérifier le rendu**

Run: `just lint-ui`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add docs/ARCHITECTURE.md docs/PRODUCTION.md
git commit -m "docs(sidecar): règles du nom de fichier produit par le renommage"
```
