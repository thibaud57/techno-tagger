"""Dump des tags d'origine d'un run, de quoi les restaurer le temps de la retention (ADR-010).

Un fichier par run, hors plan de run : un run rate se decouvre au lancement suivant.
Seuls les champs de la table y vont, ni images ni commentaires.

Les renommages ne reecrivent pas le dump : chacun s'ajoute a un journal voisin, force sur le
disque avant que le fichier ne bouge ; `load_dump` le fusionne. Le dump complet n'est reecrit
qu'une fois par phase.
"""

import contextlib
import logging
import os
from pathlib import Path
from types import MappingProxyType
from typing import TYPE_CHECKING, ClassVar, Final, Self

from pydantic import AwareDatetime, Field, ValidationError

from tagger.core.errors import TaggerError
from tagger.core.models import StrictFrozenModel
from tagger.core.paths import app_data_dir
from tagger.core.run_files import (
    PENDING_SUFFIX,
    find_by_run_id,
    newest_first,
    purge_stamped,
    read_versioned,
    stamped_name,
    unlink_logged,
    write_atomically,
)
from tagger.tags.files import OriginalTags, TagField, TagSystem

if TYPE_CHECKING:
    from collections.abc import Collection, Mapping
    from datetime import datetime

logger = logging.getLogger(__name__)

SCHEMA_VERSION: Final = 1
_SUFFIX: Final = ".json"
_JOURNAL_SUFFIX: Final = ".renames.ndjson"
# Les trois sortes de fichiers qu'un run laisse : la retention les emporte ensemble.
_RETAINED_SUFFIXES: Final = (_SUFFIX, PENDING_SUFFIX, ".ndjson")


class DumpEntry(StrictFrozenModel):
    """Etat d'origine d'un morceau, avec son emplacement apres renommage."""

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


class TagDump(StrictFrozenModel):
    """Dump d'un run tel qu'il est ecrit sur le disque, entrees par `track_id`."""

    schema_version: int = SCHEMA_VERSION
    run_id: str
    created_at: AwareDatetime
    # Dossier du run : celui que le rollback annonce, plutot que deduit des chemins.
    folder: Path
    entries: dict[str, DumpEntry] = Field(default_factory=dict)


class _RenameNote(StrictFrozenModel):
    """Une ligne du journal : ou trouver le fichier d'un morceau, `None` pour l'oublier."""

    track_id: str
    renamed_path: Path | None


class TagDumpError(TaggerError):
    code: ClassVar[str] = "tag_dump_error"


class TagDumpWriteError(TagDumpError):
    """Le dump n'a pas pu etre ecrit : sans lui, aucun fichier ne doit l'etre."""

    code: ClassVar[str] = "tag_dump_write_failed"

    def __init__(self, path: Path) -> None:
        super().__init__(f"tag dump not written: {path.name}", file=path.name)


class TagDumpEntryMissingError(TagDumpError):
    """Le dump ne porte pas le morceau a noter : un bug de l'appelant, pas une panne de disque.

    Pas de `track_id` en param : c'est un chemin relatif, donc un titre.
    """

    def __init__(self) -> None:
        super().__init__("tag dump holds no entry for the track")


class TagDumpUnreadableError(TagDumpError):
    """Dump illisible ou d'une version de schema inconnue, jamais migre (ADR-018)."""

    code: ClassVar[str] = "tag_dump_unreadable"

    def __init__(self, path: Path, found: int | str | None = None) -> None:
        super().__init__(
            f"unreadable tag dump: {path.name}",
            file=path.name,
            found=found,
            expected=SCHEMA_VERSION,
        )


def dump_dir() -> Path:
    return app_data_dir() / "dumps"


def dump_path(folder: Path, dump: TagDump) -> Path:
    """Nom horodate : le dernier run et l'age d'un dump se lisent sans l'ouvrir."""
    return folder / stamped_name(dump.created_at, dump.run_id, _SUFFIX)


def journal_path(dump_file: Path) -> Path:
    """Journal des renommages voisin d'un dump, ecarte du glob des dumps par son suffixe."""
    return dump_file.with_suffix(_JOURNAL_SUFFIX)


def find_dump(folder: Path, run_id: str) -> Path | None:
    return find_by_run_id(folder, _SUFFIX, run_id)


def dumps_newest_first(folder: Path) -> list[Path]:
    return newest_first(folder, _SUFFIX)


def dump_on_disk(folder: Path, dump: TagDump) -> TagDump:
    """Le dump tel que le disque le porte, journal fusionne, vide s'il n'y est pas encore."""
    path = dump_path(folder, dump)
    if path.is_file():
        return load_dump(path)
    return dump.model_copy(update={"entries": {}})


def save_entries(folder: Path, dump: TagDump, entries: Mapping[str, DumpEntry]) -> TagDump:
    """Ajoute les entrees absentes du disque, dans l'ordre d'ecriture que le rollback inverse.

    Le disque fait foi : un rollback a pu y consommer des entrees que l'appelant garde en
    memoire. Une entree presente n'est jamais remplacee, l'origine d'une relance reste la premiere.
    """
    base = dump_on_disk(folder, dump)
    added = {track_id: entry for track_id, entry in entries.items() if track_id not in base.entries}
    merged = base.model_copy(update={"entries": {**base.entries, **added}})
    _write(dump_path(folder, merged), merged)
    return merged


def record_renamed_path(
    folder: Path, dump: TagDump, track_id: str, renamed: Path | None
) -> TagDump:
    """Retient ou trouver le fichier apres son renommage, `None` l'oublie (renommage rate).

    La note est ecrite et forcee sur le disque au journal avant le retour : l'appelant ne
    deplace le fichier qu'ensuite. Le dump recu fait foi, sans relecture du disque. L'entree
    passe en fin de dump : un morceau renomme en relance peut prendre un nom libere par un
    morceau ecrit avant lui, le rollback qui inverse l'ordre doit le rendre en premier.
    """
    if track_id not in dump.entries:
        raise TagDumpEntryMissingError
    note = _RenameNote(track_id=track_id, renamed_path=renamed)
    _append(journal_path(dump_path(folder, dump)), note.model_dump_json())
    entries = dict(dump.entries)
    _note_renamed(entries, note)
    return dump.model_copy(update={"entries": entries})


def rewrite_dump(folder: Path, dump: TagDump) -> None:
    """Reecrit le dump avec les renommages notes, puis supprime le journal devenu inutile.

    Sans journal, le disque porte deja ce dump : rien a faire.
    """
    path = dump_path(folder, dump)
    if journal_path(path).exists():
        _write(path, dump)


def remove_entries(folder: Path, dump: TagDump, track_ids: Collection[str]) -> TagDump:
    """Retire les morceaux restaures ; un dump vide est supprime, plus rien n'y est a annuler."""
    kept = {key: entry for key, entry in dump.entries.items() if key not in track_ids}
    updated = dump.model_copy(update={"entries": kept})
    path = dump_path(folder, updated)
    if kept:
        _write(path, updated)
    else:
        try:
            path.unlink(missing_ok=True)
        except OSError as exc:
            raise TagDumpWriteError(path) from exc
        _drop_journal(path)
    return updated


def load_dump(path: Path) -> TagDump:
    """Relit un dump et fusionne son journal ; un schema inconnu est refuse, jamais migre.

    Le journal est lu avec le dump : un rollback apres une coupure entre une note
    et la reecriture finale retrouve quand meme le fichier renomme.
    """
    dump = read_versioned(path, TagDump, SCHEMA_VERSION, TagDumpUnreadableError)
    journal = journal_path(path)
    try:
        raw = journal.read_bytes()
    except FileNotFoundError:
        return dump
    except OSError as exc:
        raise TagDumpUnreadableError(journal) from exc
    return _replay(dump, raw.decode("utf-8", errors="replace"))


def purge_dumps(folder: Path, now: datetime) -> None:
    """Supprime les dumps passes la retention, que leur run ait ete ecrit ou non.

    Un temporaire laisse par une ecriture coupee porte les memes tags : meme retention. Le
    journal d'un run suit le sien, y compris quand son dump a deja disparu.
    """
    purge_stamped(folder, _RETAINED_SUFFIXES, now, "tag dump not purged")


def _replay(dump: TagDump, journal: str) -> TagDump:
    """Applique les notes dans l'ordre : la derniere d'un morceau gagne.

    Une ligne illisible est ecartee : la derniere, tronquee par une coupure de courant, n'a
    jamais precede un renommage. Une note d'un morceau absent du dump ne dit plus rien.
    """
    entries = dict(dump.entries)
    for line in journal.splitlines():
        if not line.strip():
            continue
        try:
            note = _RenameNote.model_validate_json(line)
        except ValidationError:
            logger.warning("tag dump journal line skipped run=%s reason=unreadable", dump.run_id)
            continue
        if note.track_id in entries:
            _note_renamed(entries, note)
    return dump.model_copy(update={"entries": entries})


def _note_renamed(entries: dict[str, DumpEntry], note: _RenameNote) -> None:
    """Pose la note et deplace l'entree en fin de dict, ce que `record_renamed_path` documente."""
    entries[note.track_id] = entries.pop(note.track_id).model_copy(
        update={"renamed_path": note.renamed_path}
    )


def _append(path: Path, line: str) -> None:
    """Ajoute une ligne au journal et la force sur le disque : une coupure ensuite la retrouve."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("ab") as journal:
            start = journal.seek(0, os.SEEK_END)
            try:
                journal.write(f"{line}\n".encode())
                journal.flush()
                os.fsync(journal.fileno())
            except OSError:
                # Une ligne a moitie ecrite collerait la note suivante a son reste, perdue.
                with contextlib.suppress(OSError):
                    journal.truncate(start)
                raise
    except OSError as exc:
        raise TagDumpWriteError(path) from exc


def _drop_journal(dump_file: Path) -> None:
    """Un journal qui reste est sans danger : relu apres le dump, il rend les memes notes."""
    unlink_logged(journal_path(dump_file), "tag dump journal not removed")


def _write(path: Path, dump: TagDump) -> None:
    """Atomique et durable : une coupure, meme apres le retour, ne laisse jamais un dump tronque.

    Ecrit le dump complet, journal compris : celui-ci n'a plus rien a dire et part ensuite.
    """
    try:
        write_atomically(path, dump.model_dump_json(indent=2), durable=True)
    except OSError as exc:
        raise TagDumpWriteError(path) from exc
    _drop_journal(path)
