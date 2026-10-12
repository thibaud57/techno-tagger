"""Dump des tags d'origine d'un run, de quoi les restaurer pendant 30 jours (ADR-010).

Un fichier par run, hors plan de run : un run rate se decouvre au lancement suivant.
Seuls les champs de la table y vont, ni images ni commentaires.

Les renommages ne reecrivent pas le dump : chacun s'ajoute a un journal voisin, force sur le
disque avant que le fichier ne bouge, et `load_dump` le fusionne. Le dump complet n'est reecrit
qu'une fois par phase.
"""

import contextlib
import logging
import os
from pathlib import Path
from types import MappingProxyType
from typing import TYPE_CHECKING, ClassVar, Final, Self

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, ValidationError

from tagger.errors import TaggerError
from tagger.files import OriginalTags, TagField, TagSystem
from tagger.paths import app_data_dir
from tagger.run_files import (
    PENDING_SUFFIX,
    exact_version,
    find_by_run_id,
    newest_first,
    purge_stamped,
    read_versioned,
    stamped_name,
    write_atomically,
)

if TYPE_CHECKING:
    from collections.abc import Collection, Mapping
    from datetime import datetime

logger = logging.getLogger(__name__)

SCHEMA_VERSION: Final = 1
_SUFFIX: Final = ".json"
_JOURNAL_SUFFIX: Final = ".renames.ndjson"
# Les trois sortes de fichiers qu'un run laisse, et que la retention emporte ensemble.
_RETAINED_SUFFIXES: Final = (_SUFFIX, PENDING_SUFFIX, ".ndjson")


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
    created_at: AwareDatetime
    # Dossier du run : celui que le rollback annonce, plutot que deduit des chemins.
    folder: Path
    entries: dict[str, DumpEntry] = Field(default_factory=dict)


class _RenameNote(BaseModel):
    """Une ligne du journal : ou trouver le fichier d'un morceau, `None` pour l'oublier."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    track_id: str
    renamed_path: Path | None


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
    """Dumps du plus recent au plus ancien."""
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
        raise KeyError(track_id)
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
        _drop_journal(path, updated)
    return updated


def load_dump(path: Path) -> TagDump:
    """Relit un dump et fusionne son journal ; une version de schema inconnue est refusee.

    Jamais migre. Le journal est lu avec le dump : un rollback apres une coupure entre une note
    et la reecriture finale retrouve quand meme le fichier renomme.
    """
    dump = _read_dump(path)
    journal = journal_path(path)
    try:
        raw = journal.read_bytes()
    except FileNotFoundError:
        return dump
    except OSError as exc:
        raise TagDumpUnreadableError(journal) from exc
    return _replay(dump, raw.decode("utf-8", errors="replace"))


def _read_dump(path: Path) -> TagDump:
    return read_versioned(path, TagDump, exact_version(SCHEMA_VERSION), TagDumpUnreadableError)


def purge_dumps(folder: Path, now: datetime) -> None:
    """Supprime les dumps passes la retention, que leur run ait ete ecrit ou non.

    Un temporaire laisse par une ecriture coupee porte les memes tags : meme retention. Le
    journal d'un run suit le sien, y compris quand son dump a deja disparu.
    """
    purge_stamped(folder, _RETAINED_SUFFIXES, now, "tag dump not purged")


def _replay(dump: TagDump, journal: str) -> TagDump:
    """Applique les notes dans l'ordre : la derniere d'un morceau gagne.

    Une ligne illisible est ecartee : la derniere, tronquee par une coupure de courant, n'a
    jamais precede un renommage, et une note d'un morceau absent du dump ne dit plus rien.
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


def _drop_journal(dump_file: Path, dump: TagDump) -> None:
    """Un journal qui reste est sans danger : relu apres le dump, il rend les memes notes."""
    try:
        journal_path(dump_file).unlink(missing_ok=True)
    except OSError:
        logger.warning("tag dump journal not removed run=%s reason=unlink_failed", dump.run_id)


def _write(path: Path, dump: TagDump) -> None:
    """Atomique : une coupure en cours d'ecriture ne laisse jamais un dump tronque.

    Ecrit le dump complet, journal compris : celui-ci n'a plus rien a dire et part ensuite.
    """
    try:
        write_atomically(path, dump.model_dump_json(indent=2))
    except OSError as exc:
        raise TagDumpWriteError(path) from exc
    _drop_journal(path, dump)
