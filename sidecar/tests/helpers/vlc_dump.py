"""Construction de dumps `vlc_media.db` de test, a partir du DDL reel de VLC Android.

Le DDL ci-dessous est un releve verbatim sur un dump reel le 2026-09-08 (version de
VLC Android non notee), archive dans `docs/knowledges/vlc-media-db.md`. Ne pas le
"nettoyer" : `Media.filename TEXT COLLATE FILENAME` est une collation propre a VLC
qu'un `sqlite3` standard ne connait pas, et sans elle la fixture ne reproduirait pas
le piege que le lecteur doit contourner (cf. ADR-019 § Verification sur un dump reel).

Construit dynamiquement pour couvrir des variantes de schema (`omit_table`, `omit_column`),
et puisque SQLite est un format binaire qui ne diffe pas proprement dans git. Un vrai
dump reel, lui, n'entre jamais dans le depot (mediatheque personnelle, depot public).
"""

import sqlite3
from typing import TYPE_CHECKING, Final

from tagger.playlists.vlc import _collate_filename

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
