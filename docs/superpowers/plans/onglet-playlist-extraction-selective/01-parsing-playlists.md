# Parsing des playlists (dump SQLite VLC et M3U8) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lire les deux formats de playlist du projet et en extraire les noms de fichiers à traiter, sans toucher au système de fichiers musical.

**Architecture:** Un package `tagger/playlists/` à responsabilité unique, exposant une façade (`detect_format`, `list_playlists`, `read_playlist`) qui masque le découpage entre le lecteur de dump SQLite et le parser M3U8. Le format est reconnu à l'en-tête du fichier et non à son extension. Toute erreur sort en exception métier portant un `code` stable et des `params` structurés, jamais en exception `sqlite3` brute.

**Tech Stack:** Python 3.14, `sqlite3` et `pathlib` de la stdlib, pytest, Mypy strict, Ruff. Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/onglet-playlist-extraction-selective/01-parsing-playlists-design.md`

## Global Constraints

- **Gate qualité vert à chaque commit** : `just test` (couverture bloquante à 80 % sur `sidecar/`), `just lint` (Ruff check + format), `just typecheck` (Mypy strict). Les commandes exigent bash.
- **Convention de commit** : `type(scope): description`, scope `playlists` pour ce sub-project.
- **Aucune valeur métier inventée** : le DDL de la fixture est repris verbatim de `docs/knowledges/vlc-media-db.md` § DDL relevé, les requêtes SQL de `.claude/rules/vlc-media-db/playlists.md`.
- **Le dump est ouvert en lecture seule** : `sqlite3.connect(f"file:{path}?mode=ro", uri=True)`.
- **La collation `FILENAME` est enregistrée avant toute requête touchant `Media.filename`**, et avant tout `CREATE TABLE` la déclarant.
- **Rien de personnel dans les `params` d'une erreur** : un nom de fichier, jamais un chemin complet (cf. `.claude/rules/python/gestion-erreurs.md`).
- **Typage complet** : Mypy strict, `Final` sur les constantes, imports d'annotation seule sous `if TYPE_CHECKING:` (Ruff `TC003`).
- **Tests en Arrange / Act / Assert séparés par une ligne vide**, sans commentaire de section, écriture dans `tmp_path` uniquement.
- **Codes d'erreur en `snake_case` plat**, sans préfixe de domaine : `vlc_schema_mismatch`, `playlist_not_found`, `malformed_command`, comme les exemples d'ARCHITECTURE.md § API et de `.claude/rules/python/gestion-erreurs.md`. C'est la clé que l'interface traduit sous `errors.<code>`.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `sidecar/src/tagger/errors.py` | `TaggerError`, base de toutes les erreurs métier du sidecar. Créé ici parce que ce module en est le premier consommateur ; les sub-projects 02 à 04 s'y brancheront. |
| `sidecar/src/tagger/playlists/models.py` | `PlaylistFormat` (StrEnum) et `PlaylistSummary` (dataclass gelée). Structures internes, aucun pydantic. |
| `sidecar/src/tagger/playlists/errors.py` | Famille `PlaylistError` : format non supporté, schéma incompatible, playlist introuvable. |
| `sidecar/src/tagger/playlists/vlc.py` | Dump SQLite : connexion, collation, vérification de schéma, listage, extraction. |
| `sidecar/src/tagger/playlists/m3u8.py` | Parsing du fichier texte, réduction des chemins à leur nom de fichier. |
| `sidecar/src/tagger/playlists/__init__.py` | Façade du package et `__all__`. Aiguille vers `vlc` ou `m3u8` selon le format détecté. |
| `sidecar/tests/helpers/vlc_dump.py` | Constructeur de dump de test portant le DDL réel, avec omission d'une table ou d'une colonne pour les variantes amputées. |
| `sidecar/tests/fixtures/sample.m3u8` | Playlist M3U8 figée : BOM, directives, lignes vides, chemins Windows et POSIX, noms non-ASCII. |
| `sidecar/tests/conftest.py` | Fixtures `vlc_dump` et `m3u8_playlist`. |
| `sidecar/tests/unit/test_playlists_vlc.py` | Tests du lecteur de dump. |
| `sidecar/tests/unit/test_playlists_m3u8.py` | Tests du parser M3U8. |

---

## Task 1: Socle — erreurs, modèles et constructeur de fixture

Le constructeur de dump est la fondation de toutes les tâches suivantes : sans lui, aucun test VLC n'est écrivable. Il porte lui-même une règle projet testable — la fixture doit reproduire le piège de la collation, sans quoi les tests des tâches 3 à 5 passeraient sur du code qui échoue en production.

**Files:**
- Create: `sidecar/src/tagger/errors.py`
- Create: `sidecar/src/tagger/playlists/models.py`
- Create: `sidecar/src/tagger/playlists/errors.py`
- Create: `sidecar/tests/helpers/vlc_dump.py`
- Modify: `sidecar/tests/conftest.py` (remplacer la partie `vlc_media.db` du `TODO`)
- Test: `sidecar/tests/unit/test_playlists_vlc.py`

**Interfaces:**
- Consumes: rien, tâche initiale.
- Produces:
  - `tagger.errors.TaggerError(message: str, **params: object)`, attributs `code: ClassVar[str]` et `params: dict[str, object]`
  - `tagger.playlists.models.PlaylistFormat` : `VLC_DUMP`, `M3U8`
  - `tagger.playlists.models.PlaylistSummary(playlist_id: int, name: str, track_count: int)`
  - `tagger.playlists.errors.PlaylistError`, `UnsupportedPlaylistFormat(path: Path)`, `IncompatibleDumpSchema(missing: Sequence[str])`, `PlaylistNotFound(name: str)`
  - `tests/helpers/vlc_dump.build_dump(path: Path, *, omit_table: str | None = None, omit_column: str | None = None) -> Path`
  - constantes `TRACKS: tuple[str, ...]`, `PLAYLIST_MAIN: str`, `PLAYLIST_OTHER: str`
  - fixtures pytest `vlc_dump: Path` et `m3u8_playlist: Path`

- [ ] **Step 1: Écrire le test qui garde la fixture**

Ce test échoue si quelqu'un « nettoie » le DDL en retirant la collation : la fixture cesserait alors de reproduire le piège et les tests suivants ne prouveraient plus rien.

Créer `sidecar/tests/unit/test_playlists_vlc.py` :

```python
"""Tests du lecteur de dump `vlc_media.db`.

La collation `FILENAME` est propre a VLC : `sqlite3` ne la connait pas, et toute
requete touchant `Media.filename` echoue tant qu'elle n'est pas enregistree. La
fixture doit donc la declarer pour valoir dump reel (ADR-019).
"""

import sqlite3
from typing import TYPE_CHECKING

import pytest
from vlc_dump import PLAYLIST_MAIN, build_dump

if TYPE_CHECKING:
    from pathlib import Path


def test_fixture_declares_vlc_custom_collation(vlc_dump: Path) -> None:
    connection = sqlite3.connect(vlc_dump)

    ddl = connection.execute(
        "SELECT sql FROM sqlite_master WHERE name = 'Media'"
    ).fetchone()[0]
    connection.close()

    assert "COLLATE FILENAME" in ddl

```

- [ ] **Step 2: Lancer le test pour le voir échouer**

Run: `cd sidecar && uv run pytest tests/unit/test_playlists_vlc.py -x -q`
Expected: FAIL, `ModuleNotFoundError: No module named 'vlc_dump'`

- [ ] **Step 3: Écrire le constructeur de dump**

Reprendre les trois `CREATE TABLE` **verbatim** depuis `docs/knowledges/vlc-media-db.md` § DDL relevé. Ne pas les reformater : `COLLATE FILENAME` et `COLLATE NOCASE` sont ce qui donne sa valeur à la fixture. Les trois constantes dépassent la limite de 100 caractères de Ruff, d'où le `# noqa: E501`.

Créer `sidecar/tests/helpers/vlc_dump.py` :

```python
"""Construction de dumps `vlc_media.db` de test, a partir du DDL reel de VLC Android.

Le DDL ci-dessous est un releve verbatim sur un dump reel le 2026-09-08 (version de
VLC Android non notee), archive dans `docs/knowledges/vlc-media-db.md`. Ne pas le
"nettoyer" : `Media.filename TEXT COLLATE FILENAME` est une collation propre a VLC
qu'un `sqlite3` standard ne connait pas, et sans elle la fixture ne reproduirait pas
le piege que le lecteur doit contourner (cf. ADR-019 § Verification sur un dump reel).

Un dump reel n'entre jamais dans le depot : il porte la mediatheque entiere de son
proprietaire et le depot est public (ADR-021). Seul le DDL est repris, le contenu
etant invente.
"""

import sqlite3
from typing import TYPE_CHECKING, Final

if TYPE_CHECKING:
    from pathlib import Path

DDL_PLAYLIST: Final = "CREATE TABLE Playlist(id_playlist INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT COLLATE NOCASE,creation_date UNSIGNED INT NOT NULL,artwork_mrl TEXT,nb_video UNSIGNED INT NOT NULL DEFAULT 0,nb_audio UNSIGNED INT NOT NULL DEFAULT 0,nb_unknown UNSIGNED INT NOT NULL DEFAULT 0,nb_present_video UNSIGNED INT NOT NULL DEFAULT 0 CHECK(nb_present_video <= nb_video),nb_present_audio UNSIGNED INT NOT NULL DEFAULT 0 CHECK(nb_present_audio <= nb_audio),nb_present_unknown UNSIGNED INT NOT NULL DEFAULT 0 CHECK(nb_present_unknown <= nb_unknown),duration UNSIGNED INT NOT NULL DEFAULT 0,nb_duration_unknown UNSIGNED INT NOT NULL DEFAULT 0, is_favorite BOOLEAN NOT NULL DEFAULT FALSE)"  # noqa: E501

DDL_PLAYLIST_MEDIA_RELATION: Final = "CREATE TABLE PlaylistMediaRelation(media_id INTEGER,playlist_id INTEGER,position INTEGER,FOREIGN KEY(media_id) REFERENCES Media(id_media) ON DELETE NO ACTION,FOREIGN KEY(playlist_id) REFERENCES Playlist(id_playlist) ON DELETE CASCADE)"  # noqa: E501

DDL_MEDIA: Final = "CREATE TABLE Media(id_media INTEGER PRIMARY KEY AUTOINCREMENT,type INTEGER,subtype INTEGER NOT NULL DEFAULT 0,duration INTEGER DEFAULT -1,last_position REAL DEFAULT -1,last_time INTEGER DEFAULT -1,play_count UNSIGNED INTEGER NOT NULL DEFAULT 0,last_played_date UNSIGNED INTEGER,insertion_date UNSIGNED INTEGER,release_date UNSIGNED INTEGER,title TEXT COLLATE NOCASE,filename TEXT COLLATE FILENAME,is_favorite BOOLEAN NOT NULL DEFAULT 0,is_present BOOLEAN NOT NULL DEFAULT 1,device_id INTEGER,nb_playlists UNSIGNED INTEGER NOT NULL DEFAULT 0,folder_id UNSIGNED INTEGER,import_type UNSIGNED INTEGER NOT NULL,group_id UNSIGNED INTEGER,forced_title BOOLEAN NOT NULL DEFAULT 0,artist_id UNSIGNED INTEGER,genre_id UNSIGNED INTEGER,track_number UNSIGNED INTEGER,album_id UNSIGNED INTEGER,disc_number UNSIGNED INTEGER,lyrics TEXT,is_public BOOLEAN NOT NULL DEFAULT FALSE,nb_subscriptions UNSIGNED INTEGER NOT NULL DEFAULT 0,description TEXT)"  # noqa: E501

DDL_BY_TABLE: Final[dict[str, str]] = {
    "Playlist": DDL_PLAYLIST,
    "PlaylistMediaRelation": DDL_PLAYLIST_MEDIA_RELATION,
    "Media": DDL_MEDIA,
}

# Contenu invente. Casse mixte pour l'ordre NOCASE, non-ASCII pour l'encodage.
TRACKS: Final[tuple[str, ...]] = (
    "artist one - Alpha Track.mp3",
    "Artist One - beta track.mp3",
    "Artist Two - Ambiance Éthérée.mp3",
    "Artist Two - Дорога.mp3",
    "artist three - Zulu.flac",
)

PLAYLIST_MAIN: Final = "test playlist"
PLAYLIST_OTHER: Final = "other playlist"


def build_dump(
    path: Path,
    *,
    omit_table: str | None = None,
    omit_column: str | None = None,
) -> Path:
    """Ecrit un dump de test a `path` et rend ce chemin.

    `omit_table` retire une table, `omit_column` retire une colonne designee sous la
    forme `Table.colonne` : de quoi couvrir la verification de schema sans maintenir
    un second jeu de fichiers. Un dump ampute n'est jamais rempli.
    """
    connection = sqlite3.connect(path)
    # SQLite refuse un `CREATE TABLE` declarant une collation inconnue : la
    # construction en a besoin autant que la lecture.
    connection.create_collation("FILENAME", _collate_filename)
    try:
        for table, ddl in DDL_BY_TABLE.items():
            if table == omit_table:
                continue
            connection.execute(_without_column(ddl, table, omit_column))

        if omit_table is None and omit_column is None:
            _fill(connection)

        connection.commit()
    finally:
        connection.close()

    return path


def _collate_filename(left: str, right: str) -> int:
    """Collation `FILENAME` de VLC, reproduite comme le faisait la CLI d'origine."""
    lowered_left, lowered_right = left.lower(), right.lower()
    return (lowered_left > lowered_right) - (lowered_left < lowered_right)


def _without_column(ddl: str, table: str, omit_column: str | None) -> str:
    """Retire d'un `CREATE TABLE` la colonne designee par `Table.colonne`."""
    if omit_column is None:
        return ddl

    owner, _, column = omit_column.partition(".")
    if owner != table:
        return ddl

    parts = ddl.split(",")
    kept = [part for part in parts if not part.strip().startswith(f"{column} ")]
    return ",".join(kept)


def _fill(connection: sqlite3.Connection) -> None:
    """Deux playlists. La principale porte tous les morceaux plus une relation en
    double sur le premier, pour que le `DISTINCT` de l'extraction ait quelque chose a
    dedupliquer et que le comptage du listage doive l'etre aussi.

    `nb_audio` reste a 0 : c'est la valeur relevee sur le dump reel, et le comptage
    doit passer par `PlaylistMediaRelation`.
    """
    connection.executemany(
        "INSERT INTO Media(id_media, filename, import_type) VALUES (?, ?, 0)",
        list(enumerate(TRACKS, start=1)),
    )
    connection.executemany(
        "INSERT INTO Playlist(id_playlist, name, creation_date, nb_audio) VALUES (?, ?, 0, 0)",
        [(1, PLAYLIST_MAIN), (2, PLAYLIST_OTHER)],
    )

    relations = [(index, 1, index) for index in range(1, len(TRACKS) + 1)]
    relations.append((1, 1, len(TRACKS) + 1))
    relations.append((1, 2, 1))

    connection.executemany(
        "INSERT INTO PlaylistMediaRelation(media_id, playlist_id, position) VALUES (?, ?, ?)",
        relations,
    )
```

- [ ] **Step 4: Ajouter les fixtures pytest**

Dans `sidecar/tests/conftest.py`, remplacer le `TODO` existant par la version ci-dessous et ajouter les deux fixtures après lui. `m3u8_playlist` pointe sur un fichier créé en Task 6 ; la fixture est posée ici pour ne pas retoucher `conftest.py` deux fois.

```python
import logging
from pathlib import Path
from typing import TYPE_CHECKING

import pytest
from vlc_dump import build_dump

if TYPE_CHECKING:
    from collections.abc import Iterator

# TODO: implement — fixture de transport httpx2 mocke, fichiers audio des quatre
# formats.

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def vlc_dump(tmp_path: Path) -> Path:
    """Dump `vlc_media.db` de test, bati sur le DDL reel de VLC Android.

    Construit a chaque test plutot que commite : un dump reel porte la mediatheque
    entiere de son proprietaire et le depot est public (cf. ADR-021).
    """
    return build_dump(tmp_path / "vlc_media.db")


@pytest.fixture
def m3u8_playlist() -> Path:
    """Playlist M3U8 d'exemple : BOM, directives, lignes vides, chemins Windows et
    POSIX, noms non-ASCII. Figee sur disque, le format etant du texte stable.
    """
    return FIXTURES / "sample.m3u8"
```

- [ ] **Step 5: Lancer les tests pour les voir passer**

Run: `cd sidecar && uv run pytest tests/unit/test_playlists_vlc.py -x -q`
Expected: PASS, 1 test

- [ ] **Step 6: Écrire la base des erreurs métier**

Créer `sidecar/src/tagger/errors.py` :

```python
"""Base de toutes les erreurs metier du sidecar.

Le `code` et les `params` vivent en attributs et non dans le message : c'est ce que
serialise l'evenement `error` du protocole NDJSON, l'interface se chargeant de la
traduction (cf. ARCHITECTURE.md § API). Le message reste en anglais, destine aux
logs et non a l'utilisateur.
"""

from typing import ClassVar


class TaggerError(Exception):
    """Erreur metier du sidecar, porteuse d'un code stable et de parametres."""

    code: ClassVar[str] = "unknown_error"

    def __init__(self, message: str, **params: object) -> None:
        super().__init__(message)
        self.params: dict[str, object] = params
```

- [ ] **Step 7: Écrire les modèles du package**

Créer `sidecar/src/tagger/playlists/models.py` :

```python
"""Modeles internes du parsing de playlists.

Dataclasses et non modeles pydantic : rien ne traverse ici de frontiere externe, la
validation des charges NDJSON appartenant a `protocol.py` (cf.
`.claude/rules/python/modeles-donnees.md`).
"""

from dataclasses import dataclass
from enum import StrEnum, auto, verify, UNIQUE


@verify(UNIQUE)
class PlaylistFormat(StrEnum):
    """Formats d'entree acceptes par l'extraction."""

    VLC_DUMP = auto()  # "vlc_dump"
    M3U8 = auto()  # "m3u8"


@dataclass(frozen=True, slots=True)
class PlaylistSummary:
    """Une playlist du dump, telle que le selecteur de l'interface l'affiche."""

    playlist_id: int
    name: str
    track_count: int
```

- [ ] **Step 8: Écrire les erreurs du package**

Aucun chemin complet dans les `params` : seul le nom du fichier, ces valeurs pouvant remonter dans un rapport ou vers Sentry (cf. `.claude/rules/python/gestion-erreurs.md`).

Créer `sidecar/src/tagger/playlists/errors.py` :

```python
"""Erreurs du domaine playlist."""

from typing import TYPE_CHECKING, ClassVar

from tagger.errors import TaggerError

if TYPE_CHECKING:
    from collections.abc import Sequence
    from pathlib import Path


class PlaylistError(TaggerError):
    """Base des erreurs de lecture de playlist."""

    code: ClassVar[str] = "playlist_error"


class UnsupportedPlaylistFormat(PlaylistError):
    """Le fichier n'est ni un dump SQLite ni une playlist texte exploitable."""

    code: ClassVar[str] = "unsupported_playlist_format"

    def __init__(self, path: Path) -> None:
        super().__init__(f"unsupported playlist format: {path.name}", filename=path.name)


class IncompatibleDumpSchema(PlaylistError):
    """Le dump ne porte pas les tables et colonnes attendues.

    Un schema partiellement compatible est traite comme incompatible : extraire a
    moitie une playlist est pire qu'echouer clairement (ADR-019).
    """

    code: ClassVar[str] = "vlc_schema_mismatch"

    def __init__(self, missing: Sequence[str]) -> None:
        listed = ", ".join(missing)
        super().__init__(f"incompatible vlc_media.db schema: {listed}", missing=list(missing))


class PlaylistNotFound(PlaylistError):
    """Aucune playlist de ce nom dans le dump."""

    code: ClassVar[str] = "playlist_not_found"

    def __init__(self, name: str) -> None:
        super().__init__(f"playlist not found: {name}", playlist_name=name)
```

- [ ] **Step 9: Vérifier le gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tests verts, `All checks passed!`, `Success: no issues found`

- [ ] **Step 10: Commit**

```bash
git add sidecar/src/tagger/errors.py sidecar/src/tagger/playlists/models.py sidecar/src/tagger/playlists/errors.py sidecar/tests/helpers/vlc_dump.py sidecar/tests/conftest.py sidecar/tests/unit/test_playlists_vlc.py
git commit -m "feat(playlists): socle des erreurs, modeles et fixture de dump VLC"
```

---

## Task 2: Détection du format par en-tête de fichier

**Files:**
- Create: `sidecar/src/tagger/playlists/vlc.py`
- Test: `sidecar/tests/unit/test_playlists_vlc.py` (compléter)

**Interfaces:**
- Consumes: `PlaylistFormat` et `UnsupportedPlaylistFormat` de la Task 1, fixture `vlc_dump`
- Produces: `tagger.playlists.vlc.is_vlc_dump(path: Path) -> bool`, constante `SQLITE_HEADER: bytes`

- [ ] **Step 1: Écrire les tests de détection**

Ajouter à `sidecar/tests/unit/test_playlists_vlc.py` :

```python
def test_recognises_a_real_dump_by_its_header(vlc_dump: Path) -> None:
    recognised = vlc.is_vlc_dump(vlc_dump)

    assert recognised is True


def test_rejects_a_text_file_whatever_its_extension(tmp_path: Path) -> None:
    fake = tmp_path / "vlc_media.db"
    fake.write_text("#EXTM3U\ntrack.mp3\n", encoding="utf-8")

    recognised = vlc.is_vlc_dump(fake)

    assert recognised is False


def test_rejects_a_file_too_short_to_carry_a_header(tmp_path: Path) -> None:
    truncated = tmp_path / "truncated.db"
    truncated.write_bytes(b"SQLite")

    recognised = vlc.is_vlc_dump(truncated)

    assert recognised is False
```

Ajouter l'import en tête du fichier : `from tagger.playlists import vlc`

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `cd sidecar && uv run pytest tests/unit/test_playlists_vlc.py -x -q`
Expected: FAIL, `ImportError: cannot import name 'vlc'`

- [ ] **Step 3: Écrire la détection**

Créer `sidecar/src/tagger/playlists/vlc.py` :

```python
"""Lecture du dump `vlc_media.db` de VLC Android.

Format non documente, connu par observation seule : trois tables et six colonnes
sont attestees, tout le reste est non releve (cf.
`docs/knowledges/vlc-media-db.md`). Le schema est verifie avant tout traitement,
et un ecart nomme precisement ce qui manque (ADR-019).
"""

import sqlite3
from typing import TYPE_CHECKING, Final

if TYPE_CHECKING:
    from pathlib import Path

# Les 16 premiers octets de toute base SQLite. Reconnaitre le format ici plutot
# qu'a l'extension : l'utilisateur choisit un chemin dans un dialogue, rien ne
# garantit le nom du fichier.
SQLITE_HEADER: Final = b"SQLite format 3\x00"


def is_vlc_dump(path: Path) -> bool:
    """Dit si le fichier est une base SQLite, d'apres son en-tete."""
    with path.open("rb") as handle:
        return handle.read(len(SQLITE_HEADER)) == SQLITE_HEADER
```

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `cd sidecar && uv run pytest tests/unit/test_playlists_vlc.py -x -q`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add sidecar/src/tagger/playlists/vlc.py sidecar/tests/unit/test_playlists_vlc.py
git commit -m "feat(playlists): detecter un dump VLC a son en-tete SQLite"
```

---

## Task 3: Connexion et vérification du schéma

**Files:**
- Modify: `sidecar/src/tagger/playlists/vlc.py`
- Test: `sidecar/tests/unit/test_playlists_vlc.py` (compléter)

**Interfaces:**
- Consumes: `IncompatibleDumpSchema` de la Task 1, `build_dump(..., omit_table=, omit_column=)`
- Produces: `tagger.playlists.vlc.connect(dump_path: Path) -> sqlite3.Connection` (connexion en lecture seule, collation enregistrée, schéma vérifié), constante `EXPECTED_SCHEMA: dict[str, tuple[str, ...]]`

- [ ] **Step 1: Écrire les tests de vérification**

Ajouter à `sidecar/tests/unit/test_playlists_vlc.py` :

```python
def test_accepts_a_dump_carrying_the_expected_schema(vlc_dump: Path) -> None:
    connection = vlc.connect(vlc_dump)

    connection.close()


def test_reports_a_missing_table_by_name(tmp_path: Path) -> None:
    amputated = build_dump(tmp_path / "no_relation.db", omit_table="PlaylistMediaRelation")

    with pytest.raises(IncompatibleDumpSchema) as excinfo:
        vlc.connect(amputated)

    assert excinfo.value.params["missing"] == ["PlaylistMediaRelation"]


def test_reports_a_missing_column_by_table_and_name(tmp_path: Path) -> None:
    amputated = build_dump(tmp_path / "no_filename.db", omit_column="Media.filename")

    with pytest.raises(IncompatibleDumpSchema) as excinfo:
        vlc.connect(amputated)

    assert excinfo.value.params["missing"] == ["Media.filename"]


def test_accepts_table_and_column_names_whatever_their_case(tmp_path: Path) -> None:
    shouting = tmp_path / "shouting.db"
    connection = sqlite3.connect(shouting)
    connection.execute("CREATE TABLE PLAYLIST(ID_PLAYLIST INTEGER, NAME TEXT)")
    connection.execute("CREATE TABLE PLAYLISTMEDIARELATION(PLAYLIST_ID INTEGER, MEDIA_ID INTEGER)")
    connection.execute("CREATE TABLE MEDIA(ID_MEDIA INTEGER, FILENAME TEXT)")
    connection.commit()
    connection.close()

    verified = vlc.connect(shouting)

    verified.close()


def test_opens_the_dump_read_only(vlc_dump: Path) -> None:
    connection = vlc.connect(vlc_dump)

    with pytest.raises(sqlite3.OperationalError, match="readonly"):
        connection.execute("DELETE FROM Media")

    connection.close()


def test_converts_a_corrupt_file_into_a_business_error(tmp_path: Path) -> None:
    corrupt = tmp_path / "corrupt.db"
    corrupt.write_bytes(SQLITE_HEADER + b"\x00" * 64)

    with pytest.raises(PlaylistError):
        vlc.connect(corrupt)
```

Compléter les imports : `from tagger.playlists.errors import IncompatibleDumpSchema, PlaylistError` et `from tagger.playlists.vlc import SQLITE_HEADER`.

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `cd sidecar && uv run pytest tests/unit/test_playlists_vlc.py -x -q`
Expected: FAIL, `AttributeError: module 'tagger.playlists.vlc' has no attribute 'connect'`

- [ ] **Step 3: Écrire la connexion et la vérification**

Ajouter à `sidecar/src/tagger/playlists/vlc.py`, après `is_vlc_dump` :

```python
# Les seules tables et colonnes dont l'existence est attestee. Comparees en
# minuscules : la colonne se declare `filename`, et une comparaison litterale
# rejetterait un schema valide.
EXPECTED_SCHEMA: Final[dict[str, tuple[str, ...]]] = {
    "Playlist": ("id_playlist", "name"),
    "PlaylistMediaRelation": ("playlist_id", "media_id"),
    "Media": ("id_media", "filename"),
}


def connect(dump_path: Path) -> sqlite3.Connection:
    """Ouvre le dump pret a etre requete : lecture seule, collation enregistree,
    schema verifie.

    L'ordre compte. La collation precede la verification parce que celle-ci lit
    deja `Media`, et la verification precede toute requete metier pour qu'un
    schema inconnu echoue avant d'avoir extrait quoi que ce soit.
    """
    connection = sqlite3.connect(f"file:{dump_path}?mode=ro", uri=True)
    try:
        connection.create_collation("FILENAME", _collate_filename)
        _verify_schema(connection)
    except sqlite3.DatabaseError as error:
        connection.close()
        raise PlaylistError(
            f"unreadable vlc_media.db: {dump_path.name}", filename=dump_path.name
        ) from error
    except Exception:
        # `_verify_schema` leve `IncompatibleDumpSchema`, qui n'est pas une erreur
        # sqlite3 : sans ce filet la connexion deja ouverte resterait a la charge
        # du ramasse-miettes.
        connection.close()
        raise

    return connection


def _collate_filename(left: str, right: str) -> int:
    """Collation `FILENAME`, absente de `sqlite3` mais declaree par `Media.filename`.

    Sa logique reelle est inconnue, VLC ne la documentant pas ; cette version
    insensible a la casse est celle qu'employait la CLI d'origine. Elle ne gouverne
    que la deduplication du `SELECT DISTINCT`, l'ordre etant impose par le
    `COLLATE NOCASE` explicite de l'`ORDER BY`.
    """
    lowered_left, lowered_right = left.lower(), right.lower()
    return (lowered_left > lowered_right) - (lowered_left < lowered_right)


def _verify_schema(connection: sqlite3.Connection) -> None:
    """Leve `IncompatibleDumpSchema` en nommant tout ce qui manque.

    Un schema partiellement compatible est traite comme incompatible (ADR-019).
    """
    present_tables = {
        str(row[0]).lower()
        for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    }

    missing: list[str] = []
    for table, columns in EXPECTED_SCHEMA.items():
        if table.lower() not in present_tables:
            missing.append(table)
            continue

        declared = {str(row[1]).lower() for row in connection.execute(f"PRAGMA table_info({table})")}
        missing.extend(f"{table}.{column}" for column in columns if column.lower() not in declared)

    if missing:
        raise IncompatibleDumpSchema(missing)
```

Compléter les imports en tête du module : `from tagger.playlists.errors import IncompatibleDumpSchema, PlaylistError`.

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `cd sidecar && uv run pytest tests/unit/test_playlists_vlc.py -x -q`
Expected: PASS, 10 tests

- [ ] **Step 5: Vérifier le gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 6: Commit**

```bash
git add sidecar/src/tagger/playlists/vlc.py sidecar/tests/unit/test_playlists_vlc.py
git commit -m "feat(playlists): verifier le schema du dump avant tout traitement"
```

---

## Task 4: Listage des playlists

**Files:**
- Modify: `sidecar/src/tagger/playlists/vlc.py`
- Test: `sidecar/tests/unit/test_playlists_vlc.py` (compléter)

**Interfaces:**
- Consumes: `vlc.connect()` de la Task 3, `PlaylistSummary` de la Task 1
- Produces: `tagger.playlists.vlc.list_playlists(dump_path: Path) -> tuple[PlaylistSummary, ...]`

- [ ] **Step 1: Écrire les tests de listage**

La fixture rattache 6 relations à `PLAYLIST_MAIN` mais seulement 5 morceaux distincts : c'est ce que le comptage doit rendre, sans quoi le sélecteur annoncerait un morceau de plus que l'extraction n'en livre.

Ajouter à `sidecar/tests/unit/test_playlists_vlc.py` :

```python
def test_lists_every_playlist_of_the_dump(vlc_dump: Path) -> None:
    summaries = vlc.list_playlists(vlc_dump)

    assert [summary.name for summary in summaries] == [PLAYLIST_OTHER, PLAYLIST_MAIN]


def test_counts_distinct_tracks_not_relations(vlc_dump: Path) -> None:
    summaries = vlc.list_playlists(vlc_dump)

    counts = {summary.name: summary.track_count for summary in summaries}
    assert counts[PLAYLIST_MAIN] == len(TRACKS)


def test_ignores_the_unreliable_denormalised_counter(vlc_dump: Path) -> None:
    summaries = vlc.list_playlists(vlc_dump)

    assert all(summary.track_count > 0 for summary in summaries)


def test_carries_the_playlist_identifier(vlc_dump: Path) -> None:
    summaries = vlc.list_playlists(vlc_dump)

    assert {summary.playlist_id for summary in summaries} == {1, 2}
```

Compléter l'import du helper : `from vlc_dump import PLAYLIST_MAIN, PLAYLIST_OTHER, TRACKS, build_dump`.

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `cd sidecar && uv run pytest tests/unit/test_playlists_vlc.py -x -q`
Expected: FAIL, `AttributeError: module 'tagger.playlists.vlc' has no attribute 'list_playlists'`

- [ ] **Step 3: Écrire le listage**

Ajouter à `sidecar/src/tagger/playlists/vlc.py` :

```python
# `count(DISTINCT ...)` et non `count(...)` : un morceau peut figurer deux fois dans
# une playlist, et le `DISTINCT` de l'extraction les fusionnerait. Les compteurs
# denormalises de `Playlist` sont ignores, releves a zero sur un dump reel.
LIST_PLAYLISTS_QUERY: Final = """
    SELECT p.id_playlist, p.name, count(DISTINCT pm.media_id)
    FROM Playlist p
    LEFT JOIN PlaylistMediaRelation pm ON pm.playlist_id = p.id_playlist
    GROUP BY p.id_playlist, p.name
    ORDER BY p.name COLLATE NOCASE
"""


def list_playlists(dump_path: Path) -> tuple[PlaylistSummary, ...]:
    """Rend les playlists du dump, dans l'ordre ou le selecteur les affiche."""
    connection = connect(dump_path)
    try:
        rows = connection.execute(LIST_PLAYLISTS_QUERY).fetchall()
    finally:
        connection.close()

    return tuple(
        PlaylistSummary(playlist_id=int(row[0]), name=str(row[1]), track_count=int(row[2]))
        for row in rows
    )
```

Compléter les imports du module : `from tagger.playlists.models import PlaylistSummary`.

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `cd sidecar && uv run pytest tests/unit/test_playlists_vlc.py -x -q`
Expected: PASS, 14 tests

- [ ] **Step 5: Commit**

```bash
git add sidecar/src/tagger/playlists/vlc.py sidecar/tests/unit/test_playlists_vlc.py
git commit -m "feat(playlists): lister les playlists d un dump avec leur nombre de morceaux"
```

---

## Task 5: Extraction des noms de fichiers d'une playlist

**Files:**
- Modify: `sidecar/src/tagger/playlists/vlc.py`
- Test: `sidecar/tests/unit/test_playlists_vlc.py` (compléter)

**Interfaces:**
- Consumes: `vlc.connect()` de la Task 3, `PlaylistNotFound` de la Task 1
- Produces: `tagger.playlists.vlc.read_playlist(dump_path: Path, playlist_name: str) -> tuple[str, ...]`

- [ ] **Step 1: Écrire les tests d'extraction**

Ajouter à `sidecar/tests/unit/test_playlists_vlc.py` :

```python
def test_extracts_the_file_names_of_the_requested_playlist(vlc_dump: Path) -> None:
    names = vlc.read_playlist(vlc_dump, PLAYLIST_MAIN)

    assert set(names) == set(TRACKS)


def test_deduplicates_a_track_listed_twice(vlc_dump: Path) -> None:
    names = vlc.read_playlist(vlc_dump, PLAYLIST_MAIN)

    assert len(names) == len(set(names))


def test_sorts_case_insensitively(vlc_dump: Path) -> None:
    names = vlc.read_playlist(vlc_dump, PLAYLIST_MAIN)

    assert list(names) == sorted(names, key=str.lower)


def test_returns_file_names_never_paths(vlc_dump: Path) -> None:
    names = vlc.read_playlist(vlc_dump, PLAYLIST_MAIN)

    assert not any("/" in name or "\\" in name for name in names)


def test_raises_when_the_playlist_does_not_exist(vlc_dump: Path) -> None:
    with pytest.raises(PlaylistNotFound) as excinfo:
        vlc.read_playlist(vlc_dump, "absente")

    assert excinfo.value.params["playlist_name"] == "absente"


def test_extracts_only_the_tracks_of_the_requested_playlist(vlc_dump: Path) -> None:
    names = vlc.read_playlist(vlc_dump, PLAYLIST_OTHER)

    assert names == (TRACKS[0],)
```

Compléter les imports : ajouter `PlaylistNotFound` à l'import de `tagger.playlists.errors`.

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `cd sidecar && uv run pytest tests/unit/test_playlists_vlc.py -x -q`
Expected: FAIL, `AttributeError: module 'tagger.playlists.vlc' has no attribute 'read_playlist'`

- [ ] **Step 3: Écrire l'extraction**

Ajouter à `sidecar/src/tagger/playlists/vlc.py` :

```python
# Requete d'origine de la CLI, nom de playlist parametre et non plus code en dur.
# Le `CAST(... AS TEXT) COLLATE NOCASE` impose l'ordre independamment de la
# collation de colonne, ce qui rend le rapport lisible (ADR-019).
READ_PLAYLIST_QUERY: Final = """
    SELECT DISTINCT m.filename
    FROM Playlist p
    INNER JOIN PlaylistMediaRelation pm ON pm.playlist_id = p.id_playlist
    INNER JOIN Media m ON m.id_media = pm.media_id
    WHERE p.name = ?
    ORDER BY CAST(m.filename AS TEXT) COLLATE NOCASE
"""

PLAYLIST_EXISTS_QUERY: Final = "SELECT 1 FROM Playlist WHERE name = ? LIMIT 1"


def read_playlist(dump_path: Path, playlist_name: str) -> tuple[str, ...]:
    """Rend les noms de fichiers de la playlist demandee, dedupliques et tries.

    Une playlist absente leve plutot que de rendre un tuple vide : sans cela, une
    faute de frappe produirait un run silencieusement sans morceau.

    `Playlist.name` etant declare `COLLATE NOCASE`, deux playlists dont les noms ne
    different que par la casse sont confondues et leurs morceaux fusionnes.
    """
    connection = connect(dump_path)
    try:
        if connection.execute(PLAYLIST_EXISTS_QUERY, (playlist_name,)).fetchone() is None:
            raise PlaylistNotFound(playlist_name)

        rows = connection.execute(READ_PLAYLIST_QUERY, (playlist_name,)).fetchall()
    finally:
        connection.close()

    return tuple(str(row[0]) for row in rows)
```

Compléter les imports du module : ajouter `PlaylistNotFound` à l'import de `tagger.playlists.errors`.

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `cd sidecar && uv run pytest tests/unit/test_playlists_vlc.py -x -q`
Expected: PASS, 20 tests

- [ ] **Step 5: Vérifier le gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 6: Commit**

```bash
git add sidecar/src/tagger/playlists/vlc.py sidecar/tests/unit/test_playlists_vlc.py
git commit -m "feat(playlists): extraire les noms de fichiers d une playlist du dump"
```

---

## Task 6: Parsing M3U8

**Files:**
- Create: `sidecar/src/tagger/playlists/m3u8.py`
- Create: `sidecar/tests/fixtures/sample.m3u8`
- Test: `sidecar/tests/unit/test_playlists_m3u8.py`

**Interfaces:**
- Consumes: fixture `m3u8_playlist` de la Task 1, `UnsupportedPlaylistFormat` de la Task 1
- Produces: `tagger.playlists.m3u8.read_playlist(path: Path) -> tuple[str, ...]`

- [ ] **Step 1: Créer la fixture M3U8**

Le BOM se pose en écrivant `\ufeff` en tête avec l'encodage `utf-8`. Rekordbox et VLC desktop en produisent, et un BOM non absorbé colle `\ufeff` au premier nom de fichier, qui devient introuvable sur disque.

Créer `sidecar/tests/fixtures/sample.m3u8` avec exactement ce contenu, précédé d'un BOM UTF-8 :

```
#EXTM3U
#EXTINF:214,Artist One - Alpha Track
C:\Users\dj\Music\Library\artist one - Alpha Track.mp3

#EXTINF:198,Artist One - Beta Track
/home/dj/music/library/Artist One - beta track.mp3
   
#EXTINF:301,Artist Two - Ambiance
D:\Musique\Sets\Artist Two - Ambiance Éthérée.mp3
#EXTINF:187,Artist Two - Doroga
/mnt/usb/tracks/Artist Two - Дорога.mp3
#EXTINF:245,Artist Three - Zulu
artist three - Zulu.flac
```

Commande pour la produire sans se tromper sur le BOM :

```bash
cd sidecar && uv run python -c "
from pathlib import Path
lignes = [
    '#EXTM3U',
    '#EXTINF:214,Artist One - Alpha Track',
    r'C:\Users\dj\Music\Library\artist one - Alpha Track.mp3',
    '',
    '#EXTINF:198,Artist One - Beta Track',
    '/home/dj/music/library/Artist One - beta track.mp3',
    '   ',
    '#EXTINF:301,Artist Two - Ambiance',
    r'D:\Musique\Sets\Artist Two - Ambiance Éthérée.mp3',
    '#EXTINF:187,Artist Two - Doroga',
    '/mnt/usb/tracks/Artist Two - Дорога.mp3',
    '#EXTINF:245,Artist Three - Zulu',
    'artist three - Zulu.flac',
]
Path('tests/fixtures/sample.m3u8').write_text('\ufeff' + '\n'.join(lignes) + '\n', encoding='utf-8')
"
```

- [ ] **Step 2: Écrire les tests du parser**

Créer `sidecar/tests/unit/test_playlists_m3u8.py` :

```python
"""Tests du parser de playlists M3U8."""

from typing import TYPE_CHECKING

from tagger.playlists import m3u8

if TYPE_CHECKING:
    from pathlib import Path

EXPECTED = (
    "artist one - Alpha Track.mp3",
    "Artist One - beta track.mp3",
    "Artist Two - Ambiance Éthérée.mp3",
    "Artist Two - Дорога.mp3",
    "artist three - Zulu.flac",
)


def test_extracts_every_entry_in_file_order(m3u8_playlist: Path) -> None:
    names = m3u8.read_playlist(m3u8_playlist)

    assert names == EXPECTED


def test_drops_directives_and_comments(m3u8_playlist: Path) -> None:
    names = m3u8.read_playlist(m3u8_playlist)

    assert not any(name.startswith("#") for name in names)


def test_reduces_windows_paths_to_their_file_name(m3u8_playlist: Path) -> None:
    names = m3u8.read_playlist(m3u8_playlist)

    assert not any("\\" in name for name in names)


def test_reduces_posix_paths_to_their_file_name(m3u8_playlist: Path) -> None:
    names = m3u8.read_playlist(m3u8_playlist)

    assert not any("/" in name for name in names)


def test_absorbs_the_byte_order_mark(m3u8_playlist: Path) -> None:
    names = m3u8.read_playlist(m3u8_playlist)

    assert not names[0].startswith("\ufeff")


def test_keeps_non_ascii_names_intact(m3u8_playlist: Path) -> None:
    names = m3u8.read_playlist(m3u8_playlist)

    assert "Artist Two - Дорога.mp3" in names


def test_returns_nothing_for_a_file_holding_only_directives(tmp_path: Path) -> None:
    empty = tmp_path / "empty.m3u8"
    empty.write_text("#EXTM3U\n#EXTINF:1,nothing\n\n", encoding="utf-8")

    names = m3u8.read_playlist(empty)

    assert names == ()


def test_rejects_a_binary_file_as_an_unsupported_format(tmp_path: Path) -> None:
    binary = tmp_path / "cover.jpg"
    binary.write_bytes(b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x02\x03\xfe\xfd")

    with pytest.raises(UnsupportedPlaylistFormat):
        m3u8.read_playlist(binary)
```

Compléter les imports : `import pytest` et `from tagger.playlists.errors import UnsupportedPlaylistFormat`.

Note : la dernière entrée du fichier porte un `#EXTINF` suivi d'un chemin, donc `test_returns_nothing_for_a_file_holding_only_directives` écrit sa propre fixture, un `#EXTINF` orphelin n'existant pas dans `sample.m3u8`.

- [ ] **Step 3: Lancer les tests pour les voir échouer**

Run: `cd sidecar && uv run pytest tests/unit/test_playlists_m3u8.py -x -q`
Expected: FAIL, `ImportError: cannot import name 'm3u8'`

- [ ] **Step 4: Écrire le parser**

Créer `sidecar/src/tagger/playlists/m3u8.py` :

```python
"""Parsing des playlists M3U8.

Textuel et stable, ce format couvre Rekordbox, Traktor, foobar et VLC desktop avec
un seul parser, et ne contient qu'une playlist, donc aucune selection a proposer.
Il porte les chemins absolus de la machine d'origine, dont seul le nom de fichier
est retenu : la resolution se fait par nom, jamais par chemin (ADR-020).
"""

from typing import TYPE_CHECKING, Final

from tagger.playlists.errors import UnsupportedPlaylistFormat

if TYPE_CHECKING:
    from pathlib import Path

# Les deux separateurs sont traites ensemble : le fichier vient d'une autre machine
# que celle qui le lit, ce qu'une classe `PurePath` liee a la plateforme courante ne
# couvrirait pas.
SEPARATORS: Final = ("\\", "/")

DIRECTIVE_PREFIX: Final = "#"


def read_playlist(path: Path) -> tuple[str, ...]:
    """Rend les noms de fichiers du M3U8, dans l'ordre du fichier.

    Lu en `utf-8-sig` : Rekordbox et VLC desktop posent un BOM, qui colle sinon
    `\\ufeff` au premier nom et le rend introuvable sur disque.

    Un fichier illisible en texte n'est ni un dump ni une playlist : la facade y
    aiguille tout ce qui n'a pas d'en-tete SQLite, l'erreur de decodage doit donc
    ressortir en erreur metier plutot qu'en `UnicodeDecodeError`.
    """
    try:
        content = path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError as error:
        raise UnsupportedPlaylistFormat(path) from error

    return tuple(
        _file_name(stripped)
        for line in content.splitlines()
        if (stripped := line.strip()) and not stripped.startswith(DIRECTIVE_PREFIX)
    )


def _file_name(entry: str) -> str:
    """Reduit une entree a son nom de fichier, quel que soit le separateur employe."""
    for separator in SEPARATORS:
        entry = entry.rpartition(separator)[2]

    return entry
```

- [ ] **Step 5: Lancer les tests pour les voir passer**

Run: `cd sidecar && uv run pytest tests/unit/test_playlists_m3u8.py -x -q`
Expected: PASS, 8 tests

- [ ] **Step 6: Vérifier le gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 7: Commit**

```bash
git add sidecar/src/tagger/playlists/m3u8.py sidecar/tests/fixtures/sample.m3u8 sidecar/tests/unit/test_playlists_m3u8.py
git commit -m "feat(playlists): parser les playlists M3U8"
```

---

## Task 7: Façade du package

Dernière tâche : elle assemble les deux lecteurs derrière une surface unique, celle que le sub-project 04 exposera au protocole NDJSON. Aucun appelant n'a à savoir lequel des deux modules travaille.

**Files:**
- Modify: `sidecar/src/tagger/playlists/__init__.py` (remplace le stub)
- Test: `sidecar/tests/unit/test_playlists_facade.py`

**Interfaces:**
- Consumes: `vlc.is_vlc_dump`, `vlc.list_playlists`, `vlc.read_playlist`, `m3u8.read_playlist`, `PlaylistFormat`, `UnsupportedPlaylistFormat`
- Produces (surface publique du package, consommée par les sub-projects 02 et 04) :
  - `detect_format(path: Path) -> PlaylistFormat`
  - `list_playlists(path: Path) -> tuple[PlaylistSummary, ...]`
  - `read_playlist(path: Path, playlist_name: str | None = None) -> tuple[str, ...]`

- [ ] **Step 1: Écrire les tests de la façade**

Créer `sidecar/tests/unit/test_playlists_facade.py` :

```python
"""Tests de la facade du package `playlists`."""

from typing import TYPE_CHECKING

import pytest
from vlc_dump import PLAYLIST_MAIN, TRACKS

if TYPE_CHECKING:
    from pathlib import Path

import tagger.playlists as playlists
from tagger.playlists.errors import UnsupportedPlaylistFormat
from tagger.playlists.models import PlaylistFormat


def test_detects_a_vlc_dump(vlc_dump: Path) -> None:
    detected = playlists.detect_format(vlc_dump)

    assert detected is PlaylistFormat.VLC_DUMP


def test_detects_an_m3u8_playlist(m3u8_playlist: Path) -> None:
    detected = playlists.detect_format(m3u8_playlist)

    assert detected is PlaylistFormat.M3U8


def test_routes_a_dump_to_the_sqlite_reader(vlc_dump: Path) -> None:
    names = playlists.read_playlist(vlc_dump, PLAYLIST_MAIN)

    assert set(names) == set(TRACKS)


def test_routes_a_playlist_file_to_the_text_parser(m3u8_playlist: Path) -> None:
    names = playlists.read_playlist(m3u8_playlist)

    assert "artist three - Zulu.flac" in names


def test_requires_a_playlist_name_for_a_dump(vlc_dump: Path) -> None:
    with pytest.raises(UnsupportedPlaylistFormat):
        playlists.read_playlist(vlc_dump)


def test_lists_no_playlist_for_a_text_file(m3u8_playlist: Path) -> None:
    listed = playlists.list_playlists(m3u8_playlist)

    assert listed == ()
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `cd sidecar && uv run pytest tests/unit/test_playlists_facade.py -x -q`
Expected: FAIL, `AttributeError: module 'tagger.playlists' has no attribute 'detect_format'`

- [ ] **Step 3: Écrire la façade**

Remplacer intégralement `sidecar/src/tagger/playlists/__init__.py` :

```python
"""Parsing des playlists : dump SQLite VLC et M3U8.

Surface publique du package. Le decoupage interne entre le lecteur de dump et le
parser texte ne fuit pas vers les appelants : ceux-ci passent un chemin, le format
est reconnu a l'en-tete du fichier (cf. `.claude/rules/python/imports-modules.md`).
"""

from typing import TYPE_CHECKING

from tagger.playlists import m3u8, vlc
from tagger.playlists.errors import (
    IncompatibleDumpSchema,
    PlaylistError,
    PlaylistNotFound,
    UnsupportedPlaylistFormat,
)
from tagger.playlists.models import PlaylistFormat, PlaylistSummary

if TYPE_CHECKING:
    from pathlib import Path

__all__ = [
    "IncompatibleDumpSchema",
    "PlaylistError",
    "PlaylistFormat",
    "PlaylistNotFound",
    "PlaylistSummary",
    "UnsupportedPlaylistFormat",
    "detect_format",
    "list_playlists",
    "read_playlist",
]


def detect_format(path: Path) -> PlaylistFormat:
    """Reconnait le format du fichier a son en-tete, jamais a son extension."""
    return PlaylistFormat.VLC_DUMP if vlc.is_vlc_dump(path) else PlaylistFormat.M3U8


def list_playlists(path: Path) -> tuple[PlaylistSummary, ...]:
    """Liste les playlists d'un fichier de playlist.

    Un M3U8 n'en contient qu'une et rend donc une liste vide, sans lever : cette
    commande sert aussi a faire reconnaitre le format par l'interface, qui n'a pas
    le droit de le deduire elle-meme. Lever ici transformerait un canal d'erreur en
    canal d'information, et un fichier illisible cesserait d'etre distinguable d'un
    M3U8 valide.
    """
    if detect_format(path) is not PlaylistFormat.VLC_DUMP:
        return ()

    return vlc.list_playlists(path)


def read_playlist(path: Path, playlist_name: str | None = None) -> tuple[str, ...]:
    """Rend les noms de fichiers de la playlist, quel que soit le format d'entree.

    `playlist_name` est requis pour un dump, qui porte toute la mediatheque, et
    ignore pour un M3U8, qui ne contient qu'une playlist.
    """
    if detect_format(path) is PlaylistFormat.VLC_DUMP:
        if playlist_name is None:
            raise UnsupportedPlaylistFormat(path)

        return vlc.read_playlist(path, playlist_name)

    return m3u8.read_playlist(path)
```

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `cd sidecar && uv run pytest tests/unit/test_playlists_facade.py -x -q`
Expected: PASS, 6 tests

- [ ] **Step 5: Vérifier le gate qualité complet**

Run: `just test && just lint && just typecheck`
Expected: 34 tests verts au minimum, couverture au-dessus de 80 %, Ruff et Mypy sans erreur

- [ ] **Step 6: Commit**

```bash
git add sidecar/src/tagger/playlists/__init__.py sidecar/tests/unit/test_playlists_facade.py
git commit -m "feat(playlists): exposer la facade du package"
```

---

## Vérification de l'état livré

L'incrément est complet quand, sur un dépôt propre :

```bash
just test && just lint && just typecheck
```

rend les trois gates verts, et que les scénarios du spec sont couverts : un dump de test rend ses playlists avec leur nombre de morceaux (Task 4), une playlist rend ses noms de fichiers dédupliqués et triés (Task 5), une base amputée échoue en nommant ce qui manque (Task 3), et un M3U8 issu d'une autre machine rend ses noms sans segment de chemin (Task 6).

Ce que ce sub-project ne fait pas, et qui appartient au suivant : chercher ces noms sur disque, départager les doublons, copier ou déplacer les fichiers.
