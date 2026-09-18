# Résolution par nom de fichier et extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retrouver sur disque les morceaux d'une playlist par leur nom de fichier et les copier ou les déplacer vers le dossier destination.

**Architecture:** Un module `tagger/extraction.py` à responsabilité unique. Le dossier source est indexé en une seule passe récursive, les homonymes sont départagés par taille puis par ordre de chemin, et chaque morceau est copié ou déplacé sans jamais écraser la destination. Aucun incident n'interrompt le run : introuvables, doublons départagés et copies en échec sont consignés dans le résultat rendu en mémoire.

**Tech Stack:** Python 3.14 (`pathlib`, `errno`, `logging`), pytest, Mypy strict, Ruff. Aucune dépendance nouvelle, et pas de `shutil` : `Path.copy()` et `Path.move()` existent depuis 3.14.

**Spec:** `docs/superpowers/specs/onglet-playlist-extraction-selective/02-resolution-extraction-fichiers-design.md`

## Global Constraints

- **Dépendance au sub-project 01** : `tagger/errors.py` et sa classe `TaggerError(message: str, **params: object)` avec `code: ClassVar[str]` et `params: dict[str, object]` existent déjà. Ne pas les recréer.
- **Gate qualité vert à chaque commit** : `just test` (couverture bloquante à 80 %), `just lint`, `just typecheck`. Les commandes exigent bash.
- **Convention de commit** : `type(scope): description`, scope `files` pour ce sub-project.
- **`Path` partout**, jamais `os.path` ni de concaténation de chaînes. `mkdir(parents=True, exist_ok=True)` pour les créations.
- **Motifs d'échec repris verbatim d'ARCHITECTURE.md § Backend** : `permission_denied`, `disk_full`, `path_too_long`, `file_locked`, `write_failed`. Aucun motif nouveau.
- **Départage des homonymes selon ADR-020** : taille décroissante, puis ordre alphabétique du chemin à taille égale.
- **Jamais d'écrasement en destination** : un fichier du même nom déjà présent fait passer le morceau en « déjà présent ».
- **Typage complet** : Mypy strict, `Final` sur les constantes, `@verify(UNIQUE)` sur les `StrEnum`, imports d'annotation seule sous `if TYPE_CHECKING:` (Ruff `TC003`), lignes à 100 caractères maximum, jamais `from __future__ import annotations`.
- **Tests en Arrange / Act / Assert séparés par une ligne vide**, sans commentaire de section, écriture dans `tmp_path` uniquement.
- **Codes d'erreur en `snake_case` plat**, sans préfixe de domaine : `vlc_schema_mismatch`, `playlist_not_found`, `malformed_command`, comme les exemples d'ARCHITECTURE.md § API et de `.claude/rules/python/gestion-erreurs.md`. C'est la clé que l'interface traduit sous `errors.<code>`.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `sidecar/src/tagger/extraction.py` | Modèles, erreurs, index du dossier source, départage des homonymes, extraction. Un seul fichier : les modèles sont consommés par la seule fonction du module et n'ont pas de vie propre. |
| `sidecar/tests/conftest.py` | Fixture `music_library`, arborescence source de test aux tailles contrôlées. |
| `sidecar/tests/unit/test_extraction_index.py` | Construction de l'index et départage des homonymes. |
| `sidecar/tests/unit/test_extraction_run.py` | Copie, déplacement, incidents, progression. |

---

## Task 1: Modèles, erreurs et index du dossier source

**Files:**
- Create: `sidecar/src/tagger/extraction.py`
- Modify: `sidecar/tests/conftest.py`
- Test: `sidecar/tests/unit/test_extraction_index.py`

**Interfaces:**
- Consumes: `tagger.errors.TaggerError` (sub-project 01)
- Produces:
  - `ExtractionMode` : `COPY`, `MOVE`
  - `DuplicateCriterion` : `LARGEST_FILE`, `PATH_ORDER`
  - `ExtractionFailureReason` : `PERMISSION_DENIED`, `DISK_FULL`, `PATH_TOO_LONG`, `FILE_LOCKED`, `WRITE_FAILED`
  - `DiscardedCandidate(path: Path, size: int)`
  - `DuplicateResolution(file_name: str, kept_path: Path, kept_size: int, discarded: tuple[DiscardedCandidate, ...], criterion: DuplicateCriterion)`
  - `ExtractionFailure(file_name: str, reason: ExtractionFailureReason)`
  - `ExtractionResult(extracted, already_present, missing, duplicates, failures)`, tous des tuples
  - `ExtractionError(TaggerError)`, `SourceFolderUnreadable(path: Path)`
  - `build_source_index(source: Path) -> dict[str, tuple[Path, ...]]`
  - fixture pytest `music_library: Path`

- [ ] **Step 1: Écrire la fixture d'arborescence source**

Les tailles sont contrôlées parce que le départage des homonymes en dépend. `beta` est volontairement présent deux fois, en 12 Mo et 5 Mo, et `gamma` deux fois à taille égale.

Dans `sidecar/tests/conftest.py`, remplacer le `TODO` par la version ci-dessous et ajouter la fixture :

```python
import logging
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from collections.abc import Iterator

# TODO: implement — fixture de transport httpx2 mocke, fichiers audio des quatre
# formats, base vlc_media.db de test, playlists M3U8 d'exemple.


@pytest.fixture
def music_library(tmp_path: Path) -> Path:
    """Arborescence source de test, morceaux repartis en sous-dossiers.

    Les tailles sont controlees : le departage des homonymes retient le plus gros
    fichier, et deux `gamma` de taille egale forcent le second critere, l'ordre
    alphabetique du chemin.
    """
    library = tmp_path / "library"
    files = {
        library / "albums" / "alpha.mp3": 1_000,
        library / "albums" / "beta.mp3": 5_000,
        library / "singles" / "beta.mp3": 12_000,
        library / "aaa" / "gamma.mp3": 3_000,
        library / "zzz" / "gamma.mp3": 3_000,
        library / "singles" / "DELTA.mp3": 2_000,
    }

    for path, size in files.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"\x00" * size)

    return library
```

- [ ] **Step 2: Écrire les tests d'index**

Créer `sidecar/tests/unit/test_extraction_index.py` :

```python
"""Tests de l'index du dossier source et du departage des homonymes."""

from pathlib import Path

import pytest

from tagger.extraction import SourceFolderUnreadable, build_source_index


def test_indexes_files_across_subfolders(music_library: Path) -> None:
    index = build_source_index(music_library)

    assert "alpha.mp3" in index


def test_groups_homonyms_under_one_key(music_library: Path) -> None:
    index = build_source_index(music_library)

    assert len(index["beta.mp3"]) == 2


def test_keys_are_lowercased_for_windows(music_library: Path) -> None:
    index = build_source_index(music_library)

    assert "delta.mp3" in index


def test_ignores_directories(music_library: Path) -> None:
    index = build_source_index(music_library)

    assert "albums" not in index


def test_leaves_no_entry_for_a_name_the_source_does_not_hold(music_library: Path) -> None:
    index = build_source_index(music_library)

    assert "absent.mp3" not in index


def test_raises_on_a_missing_source_folder(tmp_path: Path) -> None:
    with pytest.raises(SourceFolderUnreadable):
        build_source_index(tmp_path / "absent")


def test_raises_when_the_source_is_a_file(tmp_path: Path) -> None:
    not_a_folder = tmp_path / "track.mp3"
    not_a_folder.write_bytes(b"\x00")

    with pytest.raises(SourceFolderUnreadable):
        build_source_index(not_a_folder)
```

- [ ] **Step 3: Lancer les tests pour les voir échouer**

Run: `cd sidecar && uv run pytest tests/unit/test_extraction_index.py -x -q`
Expected: FAIL, `ModuleNotFoundError: No module named 'tagger.extraction'`

- [ ] **Step 4: Écrire les modèles, les erreurs et l'index**

Créer `sidecar/src/tagger/extraction.py` :

```python
"""Resolution des morceaux d'une playlist et extraction vers le dossier destination.

Le chemin stocke dans la playlist est ignore : la base vient du telephone quand les
fichiers sont sur le PC, seul le nom est cherche recursivement dans le dossier
source (ADR-019, ADR-020). Rien n'interrompt le run : introuvables, homonymes
departages et copies en echec sont consignes, jamais leves.
"""

import logging
from collections import defaultdict
from dataclasses import dataclass
from enum import UNIQUE, StrEnum, auto, verify
from typing import TYPE_CHECKING, ClassVar, NamedTuple

from tagger.errors import TaggerError

if TYPE_CHECKING:
    from pathlib import Path

logger = logging.getLogger(__name__)


@verify(UNIQUE)
class ExtractionMode(StrEnum):
    """Copie par defaut : la bibliotheque source reste intacte pendant que le
    re-tagging reecrit les fichiers de destination.
    """

    COPY = auto()  # "copy"
    MOVE = auto()  # "move"


@verify(UNIQUE)
class DuplicateCriterion(StrEnum):
    """Critere qui a departage deux homonymes, consigne dans le rapport."""

    LARGEST_FILE = auto()  # "largest_file"
    PATH_ORDER = auto()  # "path_order"


@verify(UNIQUE)
class ExtractionFailureReason(StrEnum):
    """Motifs repris de la nomenclature d'ecriture d'ARCHITECTURE.md § Backend :
    une meme panne de systeme de fichiers porte le meme nom dans les deux rapports
    que produit un run.
    """

    PERMISSION_DENIED = auto()  # "permission_denied"
    DISK_FULL = auto()  # "disk_full"
    PATH_TOO_LONG = auto()  # "path_too_long"
    FILE_LOCKED = auto()  # "file_locked"
    FILE_MISSING = auto()  # "file_missing"
    WRITE_FAILED = auto()  # "write_failed"


class PickedFile(NamedTuple):
    """Chemin retenu parmi des homonymes, et la trace du choix si choix il y a eu."""

    path: Path
    resolution: DuplicateResolution | None


@dataclass(frozen=True, slots=True)
class DiscardedCandidate:
    """Homonyme ecarte, avec de quoi le retrouver a la main depuis le rapport."""

    path: Path
    size: int


@dataclass(frozen=True, slots=True)
class DuplicateResolution:
    """Trace d'un choix automatique entre homonymes.

    Ce que la CLI d'origine faisait silencieusement, et qui est la vraie regression
    corrigee par ADR-020 : le choix reste automatique, mais il devient verifiable.
    """

    file_name: str
    kept_path: Path
    kept_size: int
    discarded: tuple[DiscardedCandidate, ...]
    criterion: DuplicateCriterion


@dataclass(frozen=True, slots=True)
class ExtractionFailure:
    """Morceau trouve mais non transfere."""

    file_name: str
    reason: ExtractionFailureReason


@dataclass(frozen=True, slots=True)
class ExtractionResult:
    """Issue d'une extraction, en cinq categories exclusives.

    `already_present` est distinct de `extracted` : relancer un run interrompu ne
    doit pas faire croire qu'il a recopie ce qui etait deja la.
    """

    extracted: tuple[str, ...]
    already_present: tuple[str, ...]
    missing: tuple[str, ...]
    duplicates: tuple[DuplicateResolution, ...]
    failures: tuple[ExtractionFailure, ...]


class ExtractionError(TaggerError):
    """Erreur portant sur le run entier, par opposition a un incident par morceau."""

    code: ClassVar[str] = "extraction_error"


class SourceFolderUnreadable(ExtractionError):
    """Le dossier source n'existe pas ou n'est pas un dossier."""

    code: ClassVar[str] = "source_folder_unreadable"

    def __init__(self, path: Path) -> None:
        super().__init__(f"unreadable source folder: {path.name}", folder=path.name)


def build_source_index(source: Path) -> dict[str, tuple[Path, ...]]:
    """Indexe le dossier source en une passe : nom de fichier vers ses chemins.

    Une recherche par nom relirait l'arborescence autant de fois qu'il y a de
    morceaux, et devrait de toute facon la parcourir entierement pour reperer les
    homonymes qu'ADR-020 impose de departager.

    Les cles sont en minuscules : la cible est Windows, dont le systeme de fichiers
    est insensible a la casse.
    """
    if not source.is_dir():
        raise SourceFolderUnreadable(source)

    grouped: defaultdict[str, list[Path]] = defaultdict(list)
    for path in source.rglob("*"):
        if path.is_file():
            grouped[path.name.lower()].append(path)

    logger.info("source indexed names=%d root=%s", len(grouped), source.name)

    return {name: tuple(paths) for name, paths in grouped.items()}
```

- [ ] **Step 5: Lancer les tests pour les voir passer**

Run: `cd sidecar && uv run pytest tests/unit/test_extraction_index.py -x -q`
Expected: PASS, 7 tests

- [ ] **Step 6: Vérifier le gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 7: Commit**

```bash
git add sidecar/src/tagger/extraction.py sidecar/tests/conftest.py sidecar/tests/unit/test_extraction_index.py
git commit -m "feat(files): indexer le dossier source en une passe"
```

---

## Task 2: Départage des homonymes

**Files:**
- Modify: `sidecar/src/tagger/extraction.py`
- Test: `sidecar/tests/unit/test_extraction_index.py` (compléter)

**Interfaces:**
- Consumes: `build_source_index`, `DiscardedCandidate`, `DuplicateResolution`, `DuplicateCriterion` de la Task 1
- Produces: `PickedFile(NamedTuple)` de champs `path` et `resolution`, et `pick_file(file_name: str, candidates: Sequence[Path]) -> PickedFile` — rend le chemin retenu et, si les candidats étaient plusieurs, la trace du départage

- [ ] **Step 1: Écrire les tests de départage**

Ajouter à `sidecar/tests/unit/test_extraction_index.py` :

```python
def test_keeps_the_largest_of_two_homonyms(music_library: Path) -> None:
    index = build_source_index(music_library)

    kept, resolution = pick_file("beta.mp3", index["beta.mp3"])

    assert kept.parent.name == "singles"
    assert resolution is not None
    assert resolution.criterion is DuplicateCriterion.LARGEST_FILE


def test_records_the_discarded_candidate_with_path_and_size(music_library: Path) -> None:
    index = build_source_index(music_library)

    _, resolution = pick_file("beta.mp3", index["beta.mp3"])

    assert resolution is not None
    assert [(candidate.path.parent.name, candidate.size) for candidate in resolution.discarded] == [
        ("albums", 5_000)
    ]


def test_breaks_a_size_tie_on_path_order(music_library: Path) -> None:
    index = build_source_index(music_library)

    kept, resolution = pick_file("gamma.mp3", index["gamma.mp3"])

    assert kept.parent.name == "aaa"
    assert resolution is not None
    assert resolution.criterion is DuplicateCriterion.PATH_ORDER


def test_is_deterministic_across_two_runs(music_library: Path) -> None:
    first, _ = pick_file("gamma.mp3", build_source_index(music_library)["gamma.mp3"])
    second, _ = pick_file("gamma.mp3", build_source_index(music_library)["gamma.mp3"])

    assert first == second


def test_reports_no_resolution_for_a_single_candidate(music_library: Path) -> None:
    index = build_source_index(music_library)

    kept, resolution = pick_file("alpha.mp3", index["alpha.mp3"])

    assert kept.name == "alpha.mp3"
    assert resolution is None
```

Compléter l'import : `from tagger.extraction import DuplicateCriterion, SourceFolderUnreadable, build_source_index, pick_file`.

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `cd sidecar && uv run pytest tests/unit/test_extraction_index.py -x -q`
Expected: FAIL, `ImportError: cannot import name 'pick_file'`

- [ ] **Step 3: Écrire le départage**

Ajouter à `sidecar/src/tagger/extraction.py` :

```python
def pick_file(file_name: str, candidates: Sequence[Path]) -> PickedFile:
    """Retient un chemin parmi des homonymes et rend la trace du choix.

    Departage d'ADR-020, dans l'ordre : taille decroissante, proxy de qualite entre
    deux encodages du meme morceau, puis ordre alphabetique du chemin a taille egale.
    Ce second critere n'est pas cosmetique : sans lui, deux runs sur le meme dossier
    pourraient retenir deux fichiers differents.

    Rend `None` en `resolution` quand il n'y avait qu'un candidat : il n'y a alors
    rien a consigner dans le rapport.
    """
    sized = sorted(
        ((path, path.stat().st_size) for path in candidates),
        key=lambda entry: (-entry[1], str(entry[0])),
    )
    kept_path, kept_size = sized[0]

    if len(sized) == 1:
        return PickedFile(kept_path, None)

    criterion = (
        DuplicateCriterion.PATH_ORDER
        if sized[1][1] == kept_size
        else DuplicateCriterion.LARGEST_FILE
    )
    logger.info("duplicate resolved track=%s reason=%s", file_name, criterion)

    return PickedFile(
        kept_path,
        DuplicateResolution(
            file_name=file_name,
            kept_path=kept_path,
            kept_size=kept_size,
            discarded=tuple(DiscardedCandidate(path=path, size=size) for path, size in sized[1:]),
            criterion=criterion,
        ),
    )
```

Compléter le bloc `TYPE_CHECKING` du module : `from collections.abc import Sequence`.

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `cd sidecar && uv run pytest tests/unit/test_extraction_index.py -x -q`
Expected: PASS, 12 tests

- [ ] **Step 5: Vérifier le gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 6: Commit**

```bash
git add sidecar/src/tagger/extraction.py sidecar/tests/unit/test_extraction_index.py
git commit -m "feat(files): departager les homonymes par taille puis par chemin"
```

---

## Task 3: Extraction nominale

**Files:**
- Modify: `sidecar/src/tagger/extraction.py`
- Test: `sidecar/tests/unit/test_extraction_run.py`

**Interfaces:**
- Consumes: `build_source_index`, `pick_file`, `ExtractionMode`, `ExtractionResult` des Tasks 1 et 2
- Produces: `extract(file_names: Sequence[str], source: Path, destination: Path, mode: ExtractionMode = ExtractionMode.COPY, on_progress: Callable[[int, int], None] | None = None) -> ExtractionResult`

- [ ] **Step 1: Écrire les tests d'extraction nominale**

Créer `sidecar/tests/unit/test_extraction_run.py` :

```python
"""Tests de l'extraction vers le dossier destination."""

from pathlib import Path

from tagger.extraction import ExtractionMode, extract


def test_copies_the_requested_tracks(music_library: Path, tmp_path: Path) -> None:
    destination = tmp_path / "work"

    result = extract(["alpha.mp3"], music_library, destination)

    assert (destination / "alpha.mp3").is_file()
    assert result.extracted == ("alpha.mp3",)


def test_leaves_the_source_untouched_when_copying(music_library: Path, tmp_path: Path) -> None:
    extract(["alpha.mp3"], music_library, tmp_path / "work")

    assert (music_library / "albums" / "alpha.mp3").is_file()


def test_removes_the_source_file_when_moving(music_library: Path, tmp_path: Path) -> None:
    destination = tmp_path / "work"

    extract(["alpha.mp3"], music_library, destination, mode=ExtractionMode.MOVE)

    assert not (music_library / "albums" / "alpha.mp3").exists()
    assert (destination / "alpha.mp3").is_file()


def test_creates_the_destination_folder(music_library: Path, tmp_path: Path) -> None:
    destination = tmp_path / "work" / "nested"

    extract(["alpha.mp3"], music_library, destination)

    assert destination.is_dir()


def test_finds_a_track_whatever_the_case_used(music_library: Path, tmp_path: Path) -> None:
    destination = tmp_path / "work"

    result = extract(["delta.MP3"], music_library, destination)

    assert result.extracted == ("delta.MP3",)
    assert len(list(destination.iterdir())) == 1


def test_records_the_duplicate_it_resolved(music_library: Path, tmp_path: Path) -> None:
    result = extract(["beta.mp3"], music_library, tmp_path / "work")

    assert len(result.duplicates) == 1
    assert result.duplicates[0].file_name == "beta.mp3"


def test_never_overwrites_an_existing_destination_file(
    music_library: Path, tmp_path: Path
) -> None:
    destination = tmp_path / "work"
    destination.mkdir()
    (destination / "alpha.mp3").write_bytes(b"already retagged")

    result = extract(["alpha.mp3"], music_library, destination)

    assert (destination / "alpha.mp3").read_bytes() == b"already retagged"
    assert result.already_present == ("alpha.mp3",)
    assert result.extracted == ()


def test_returns_an_empty_result_for_an_empty_playlist(
    music_library: Path, tmp_path: Path
) -> None:
    result = extract([], music_library, tmp_path / "work")

    assert result.extracted == ()
    assert result.missing == ()


def test_leaves_no_destination_folder_behind_for_an_empty_playlist(
    music_library: Path, tmp_path: Path
) -> None:
    destination = tmp_path / "work"

    extract([], music_library, destination)

    assert not destination.exists()


def test_moves_nothing_when_the_destination_is_the_source(music_library: Path) -> None:
    result = extract(["alpha.mp3"], music_library, music_library, mode=ExtractionMode.MOVE)

    assert (music_library / "albums" / "alpha.mp3").is_file()
    assert not (music_library / "alpha.mp3").exists()
    assert result.already_present == ("alpha.mp3",)
    assert result.extracted == ()
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `cd sidecar && uv run pytest tests/unit/test_extraction_run.py -x -q`
Expected: FAIL, `ImportError: cannot import name 'extract'`

- [ ] **Step 3: Écrire l'extraction**

Le nom déposé en destination est celui du fichier trouvé sur le disque, pas celui demandé par la playlist : sur un dossier insensible à la casse, les deux peuvent différer, et c'est le fichier réel qui fait foi.

Ajouter à `sidecar/src/tagger/extraction.py` :

```python
def extract(
    file_names: Sequence[str],
    source: Path,
    destination: Path,
    mode: ExtractionMode = ExtractionMode.COPY,
    on_progress: Callable[[int, int], None] | None = None,
) -> ExtractionResult:
    """Extrait les morceaux nommes du dossier source vers le dossier destination.

    Aucun incident n'interrompt le run : un morceau introuvable ou une copie en
    echec sont consignes et le traitement continue (ADR-020). Seul un dossier
    source illisible leve, avant tout traitement.
    """
    index = build_source_index(source)

    # Extraire dans le dossier source lui-meme n'extrait rien : en mode deplacement
    # cela relocaliserait la bibliotheque a sa propre racine. Chaque morceau trouve
    # y est deja, aucun transfert n'a lieu.
    extracts_in_place = source.resolve() == destination.resolve()
    if file_names and not extracts_in_place:
        destination.mkdir(parents=True, exist_ok=True)

    extracted: list[str] = []
    already_present: list[str] = []
    missing: list[str] = []
    duplicates: list[DuplicateResolution] = []
    failures: list[ExtractionFailure] = []

    total = len(file_names)
    for processed, file_name in enumerate(file_names, start=1):
        candidates = index.get(file_name.lower())
        if not candidates:
            logger.info("track missing track=%s status=missing", file_name)
            missing.append(file_name)
        else:
            kept_path, resolution = pick_file(file_name, candidates)
            if resolution is not None:
                duplicates.append(resolution)

            target = destination / kept_path.name
            if extracts_in_place or target.exists():
                already_present.append(file_name)
            else:
                _transfer(kept_path, target, mode)
                extracted.append(file_name)

        if on_progress is not None:
            on_progress(processed, total)

    return ExtractionResult(
        extracted=tuple(extracted),
        already_present=tuple(already_present),
        missing=tuple(missing),
        duplicates=tuple(duplicates),
        failures=tuple(failures),
    )


def _transfer(origin: Path, target: Path, mode: ExtractionMode) -> None:
    """Copie ou deplace un fichier. `Path.copy` et `Path.move` existent depuis 3.14,
    ce qui dispense d'importer `shutil`.
    """
    if mode is ExtractionMode.MOVE:
        origin.move(target)
    else:
        origin.copy(target)
```

Compléter le bloc `TYPE_CHECKING` du module : `from collections.abc import Callable, Sequence`.

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `cd sidecar && uv run pytest tests/unit/test_extraction_run.py -x -q`
Expected: PASS, 10 tests

- [ ] **Step 5: Vérifier le gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 6: Commit**

```bash
git add sidecar/src/tagger/extraction.py sidecar/tests/unit/test_extraction_run.py
git commit -m "feat(files): copier ou deplacer les morceaux vers la destination"
```

---

## Task 4: Incidents de transfert et progression

La Task 3 laisse `failures` toujours vide : une copie qui échoue y remonterait en `OSError` et casserait le run. Cette tâche ferme ce trou et branche le rappel de progression sur les cas d'incident.

**Files:**
- Modify: `sidecar/src/tagger/extraction.py`
- Test: `sidecar/tests/unit/test_extraction_run.py` (compléter)

**Interfaces:**
- Consumes: `extract`, `_transfer`, `ExtractionFailure`, `ExtractionFailureReason` des Tasks 1 et 3
- Produces: `failure_reason(error: OSError) -> ExtractionFailureReason`, et un `extract` dont le champ `failures` est alimenté

- [ ] **Step 1: Écrire les tests d'incident et de progression**

Un vrai disque plein ou un vrai refus de permission ne se provoquent pas en test : le transfert est remplacé par une fonction qui lève l'erreur voulue.

Ajouter à `sidecar/tests/unit/test_extraction_run.py` :

```python
def test_records_a_missing_track_and_carries_on(music_library: Path, tmp_path: Path) -> None:
    destination = tmp_path / "work"

    result = extract(["absent.mp3", "alpha.mp3"], music_library, destination)

    assert result.missing == ("absent.mp3",)
    assert result.extracted == ("alpha.mp3",)


def test_records_a_failed_copy_and_carries_on(
    music_library: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def refuse(self: Path, target: Path) -> None:
        raise PermissionError(13, "Permission denied")

    monkeypatch.setattr(Path, "copy", refuse)

    result = extract(["alpha.mp3"], music_library, tmp_path / "work")

    assert result.failures == (
        ExtractionFailure("alpha.mp3", ExtractionFailureReason.PERMISSION_DENIED),
    )


def test_a_failed_copy_does_not_stop_the_following_tracks(
    music_library: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[Path] = []

    def refuse_first(self: Path, target: Path) -> None:
        calls.append(self)
        if len(calls) == 1:
            raise OSError(28, "No space left on device")

    monkeypatch.setattr(Path, "copy", refuse_first)

    result = extract(["alpha.mp3", "delta.mp3"], music_library, tmp_path / "work")

    assert result.failures[0].reason is ExtractionFailureReason.DISK_FULL
    assert result.extracted == ("delta.mp3",)


def test_maps_a_windows_sharing_violation_to_file_locked() -> None:
    locked = OSError(32, "The process cannot access the file", None, 32)

    reason = failure_reason(locked)

    assert reason is ExtractionFailureReason.FILE_LOCKED
    assert isinstance(locked, PermissionError)


def test_maps_a_vanished_homonym_to_file_missing() -> None:
    reason = failure_reason(FileNotFoundError(2, "No such file or directory"))

    assert reason is ExtractionFailureReason.FILE_MISSING


def test_maps_an_overlong_destination_path_to_path_too_long() -> None:
    reason = failure_reason(OSError(errno.ENAMETOOLONG, "File name too long"))

    assert reason is ExtractionFailureReason.PATH_TOO_LONG


def test_falls_back_to_write_failed_on_an_unknown_error() -> None:
    reason = failure_reason(OSError(99, "unheard of"))

    assert reason is ExtractionFailureReason.WRITE_FAILED


def test_reports_progress_once_per_track(music_library: Path, tmp_path: Path) -> None:
    seen: list[tuple[int, int]] = []

    extract(
        ["alpha.mp3", "absent.mp3", "delta.mp3"],
        music_library,
        tmp_path / "work",
        on_progress=lambda processed, total: seen.append((processed, total)),
    )

    assert seen == [(1, 3), (2, 3), (3, 3)]
```

Compléter les imports : `import errno`, `import pytest` et `from tagger.extraction import ExtractionFailure, ExtractionFailureReason, ExtractionMode, extract, failure_reason`.

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `cd sidecar && uv run pytest tests/unit/test_extraction_run.py -x -q`
Expected: FAIL, `ImportError: cannot import name 'failure_reason'`

- [ ] **Step 3: Écrire la traduction des erreurs système**

L'ordre des tests compte, et c'est vérifié : `OSError(32, "...", None, 32)` construit bien un `PermissionError` portant `winerror = 32`, ce que Windows lève sur un fichier tenu par un autre processus. Lire le code Windows avant le type de l'exception est donc indispensable, faute de quoi tout verrou serait rapporté comme un refus de permission. Le quatrième argument d'`OSError` n'est interprété que sous Windows, seule plateforme visée au MVP ([ADR-015](../../../adrs/015-cibles-distribution-windows.md)) et seule cible de la CI.

Ajouter à `sidecar/src/tagger/extraction.py` :

```python
# Codes d'erreur Windows, absents des autres plateformes.
WINDOWS_LOCK_ERRORS: Final = frozenset({32, 33})  # SHARING_VIOLATION, LOCK_VIOLATION
WINDOWS_PATH_TOO_LONG: Final = 206  # FILENAME_EXCED_RANGE


def failure_reason(error: OSError) -> ExtractionFailureReason:
    """Traduit une erreur systeme en motif du vocabulaire du projet.

    Le code Windows se lit avant le type de l'exception : un fichier tenu par un
    lecteur audio leve `PermissionError` comme un vrai refus de droits, et seul
    `winerror` les distingue.
    """
    windows_code = getattr(error, "winerror", None)
    if windows_code in WINDOWS_LOCK_ERRORS:
        return ExtractionFailureReason.FILE_LOCKED
    if windows_code == WINDOWS_PATH_TOO_LONG or error.errno == errno.ENAMETOOLONG:
        return ExtractionFailureReason.PATH_TOO_LONG
    if isinstance(error, FileNotFoundError):
        return ExtractionFailureReason.FILE_MISSING
    if isinstance(error, PermissionError):
        return ExtractionFailureReason.PERMISSION_DENIED
    if error.errno == errno.ENOSPC:
        return ExtractionFailureReason.DISK_FULL

    return ExtractionFailureReason.WRITE_FAILED
```

Compléter les imports du module : `import errno` et `from typing import TYPE_CHECKING, ClassVar, Final, NamedTuple`.

- [ ] **Step 4: Brancher la traduction sur le transfert**

Dans `extract`, remplacer le bloc de transfert par sa version protégée :

```python
            target = destination / kept_path.name
            if extracts_in_place or target.exists():
                already_present.append(file_name)
            else:
                try:
                    _transfer(kept_path, target, mode)
                except OSError as error:
                    reason = failure_reason(error)
                    logger.warning("transfer failed track=%s reason=%s", file_name, reason)
                    failures.append(ExtractionFailure(file_name=file_name, reason=reason))
                else:
                    extracted.append(file_name)
```

- [ ] **Step 5: Lancer les tests pour les voir passer**

Run: `cd sidecar && uv run pytest tests/unit/test_extraction_run.py -x -q`
Expected: PASS, 18 tests

- [ ] **Step 6: Vérifier le gate qualité complet**

Run: `just test && just lint && just typecheck`
Expected: 30 tests d'extraction verts, couverture au-dessus de 80 %, Ruff et Mypy sans erreur

- [ ] **Step 7: Commit**

```bash
git add sidecar/src/tagger/extraction.py sidecar/tests/unit/test_extraction_run.py
git commit -m "feat(files): consigner les echecs de transfert sans interrompre le run"
```

---

## Vérification de l'état livré

L'incrément est complet quand `just test && just lint && just typecheck` rend les trois gates verts et que les scénarios du spec sont couverts : extraction en copie et en déplacement (Task 3), résolution par nom quelle que soit la casse (Tasks 1 et 3), homonymes départagés par taille puis par chemin (Task 2), introuvables et échecs de copie consignés sans interrompre le run (Task 4), destination jamais écrasée (Task 3), progression remontée par rappel (Task 4).

Ce que ce sub-project ne fait pas : écrire le rapport sur disque (sub-project 03) et exposer le résultat en NDJSON (sub-project 04). Le sub-project 04 devra étendre l'événement `extraction_finished`, qu'ARCHITECTURE.md décrit avec trois catégories quand `ExtractionResult` en porte cinq.
