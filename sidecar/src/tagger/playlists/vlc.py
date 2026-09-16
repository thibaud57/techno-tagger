"""Lecture du dump `vlc_media.db` de VLC Android.

Format non documente, connu par observation seule : trois tables et six colonnes
sont attestees, tout le reste est non releve (cf.
`docs/knowledges/vlc-media-db.md`). Le schema est verifie avant tout traitement,
et un ecart nomme precisement ce qui manque (ADR-019).
"""

import contextlib
import sqlite3
from typing import TYPE_CHECKING, Final

from .errors import (
    IncompatibleDumpSchemaError,
    PlaylistNotFoundError,
    UnreadableDumpError,
    UnreadablePlaylistFileError,
)
from .models import PlaylistSummary

if TYPE_CHECKING:
    from pathlib import Path

# Les 16 premiers octets de toute base SQLite. Reconnaitre le format ici plutot
# qu'a l'extension : l'utilisateur choisit un chemin dans un dialogue, rien ne
# garantit le nom du fichier.
SQLITE_HEADER: Final = b"SQLite format 3\x00"


def is_vlc_dump(path: Path) -> bool:
    """Dit si le fichier est une base SQLite, d'apres son en-tete."""
    try:
        with path.open("rb") as handle:
            return handle.read(len(SQLITE_HEADER)) == SQLITE_HEADER
    except OSError as error:
        raise UnreadablePlaylistFileError(path) from error


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

    `Path.as_uri()` leve `ValueError` sur un chemin relatif (pas seulement
    `sqlite3.DatabaseError`) : capturee ici pour que l'appelant ne voie jamais que
    des erreurs metier, jamais une exception technique brute.
    """
    connection: sqlite3.Connection | None = None
    ready = False
    try:
        connection = sqlite3.connect(f"{dump_path.as_uri()}?mode=ro", uri=True)
        connection.create_collation("FILENAME", _collate_filename)
        _verify_schema(connection)
        ready = True
    except (sqlite3.DatabaseError, ValueError) as error:
        raise UnreadableDumpError(dump_path) from error
    finally:
        # `_verify_schema` peut lever `IncompatibleDumpSchemaError`, qui n'est pas une
        # erreur sqlite3 : sans ce filet la connexion deja ouverte resterait a la
        # charge du ramasse-miettes.
        if not ready and connection is not None:
            connection.close()

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
    """Leve `IncompatibleDumpSchemaError` en nommant tout ce qui manque.

    Un schema partiellement compatible est traite comme incompatible.
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

        pragma_query = f"PRAGMA table_info({table})"
        declared = {str(row[1]).lower() for row in connection.execute(pragma_query)}
        missing.extend(f"{table}.{column}" for column in columns if column.lower() not in declared)

    if missing:
        raise IncompatibleDumpSchemaError(missing)


# `count(DISTINCT ...)` et non `count(...)` : un morceau peut figurer deux fois dans
# une playlist, et le `DISTINCT` de l'extraction les fusionnerait. Les compteurs
# denormalises de `Playlist` sont ignores, releves a zero sur un dump reel.
# `p.name` n'est pas declare `NOT NULL` :
# sans le filtre, une playlist sans nom serait rendue avec `name="None"`, un
# `str(None)` plutot qu'une absence de nom.
LIST_PLAYLISTS_QUERY: Final = """
    SELECT p.id_playlist, p.name, count(DISTINCT pm.media_id)
    FROM Playlist p
    LEFT JOIN PlaylistMediaRelation pm ON pm.playlist_id = p.id_playlist
    WHERE p.name IS NOT NULL
    GROUP BY p.id_playlist, p.name
    ORDER BY p.name COLLATE NOCASE
"""


def list_playlists(dump_path: Path) -> tuple[PlaylistSummary, ...]:
    """Rend les playlists du dump, dans l'ordre ou le selecteur les affiche."""
    with contextlib.closing(connect(dump_path)) as connection:
        rows = connection.execute(LIST_PLAYLISTS_QUERY).fetchall()

    return tuple(
        PlaylistSummary(playlist_id=int(row[0]), name=str(row[1]), track_count=int(row[2]))
        for row in rows
    )


# Requete d'origine de la CLI, nom de playlist parametre et non plus code en dur.
# Le `CAST(... AS TEXT) COLLATE NOCASE` impose l'ordre independamment de la
# collation de colonne, ce qui rend le rapport lisible.
# `m.filename` n'est pas declare `NOT NULL` (cf. docs/knowledges/vlc-media-db.md
# § DDL) : sans le filtre, un media sans nom de fichier serait stringifie en
# "None" par `str(row[0])` plutot que d'etre exclu.
READ_PLAYLIST_QUERY: Final = """
    SELECT DISTINCT m.filename
    FROM Playlist p
    INNER JOIN PlaylistMediaRelation pm ON pm.playlist_id = p.id_playlist
    INNER JOIN Media m ON m.id_media = pm.media_id
    WHERE p.name = ? AND m.filename IS NOT NULL
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
    with contextlib.closing(connect(dump_path)) as connection:
        if connection.execute(PLAYLIST_EXISTS_QUERY, (playlist_name,)).fetchone() is None:
            raise PlaylistNotFoundError(playlist_name)

        rows = connection.execute(READ_PLAYLIST_QUERY, (playlist_name,)).fetchall()

    return tuple(str(row[0]) for row in rows)
