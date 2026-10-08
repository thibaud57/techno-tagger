"""Dump des tags d'origine d'un run, de quoi les restaurer pendant 30 jours (ADR-010).

Un fichier par run, hors plan de run : un run rate se decouvre au lancement suivant.
Seuls les champs de la table y vont, ni images ni commentaires.
"""

import contextlib
import json
import logging
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import MappingProxyType
from typing import TYPE_CHECKING, ClassVar, Final, Self

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, ValidationError

from tagger.errors import TaggerError
from tagger.files import OriginalTags, TagField, TagSystem
from tagger.paths import app_data_dir
from tagger.reports import TIMESTAMP_FORMAT

if TYPE_CHECKING:
    from collections.abc import Mapping

logger = logging.getLogger(__name__)

SCHEMA_VERSION: Final = 1
RETENTION: Final = timedelta(days=30)
_SUFFIX: Final = ".json"
_PENDING_SUFFIX: Final = ".tmp"


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
    return app_data_dir() / "dumps"


def dump_path(folder: Path, dump: TagDump) -> Path:
    """Nom horodate : le dernier run et l'age d'un dump se lisent sans l'ouvrir."""
    stamp = dump.created_at.astimezone(UTC).strftime(TIMESTAMP_FORMAT)
    return folder / f"{stamp}-{dump.run_id}{_SUFFIX}"


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
    """Supprime les dumps passes la retention, que leur run ait ete ecrit ou non.

    Un temporaire laisse par une ecriture coupee porte les memes tags : meme retention.
    """
    if not folder.is_dir():
        return
    for path in folder.iterdir():
        if path.suffix not in (_SUFFIX, _PENDING_SUFFIX):
            continue
        created = _created_at(path)
        if created is None or now - created <= RETENTION:
            continue
        # Un dump verrouille (editeur, antivirus) ne doit pas bloquer la purge des suivants.
        try:
            path.unlink(missing_ok=True)
        except OSError:
            logger.warning(
                "tag dump not purged run=%s reason=unlink_failed", path.stem.partition("-")[2]
            )


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
    """Atomique : une coupure en cours d'ecriture ne laisse jamais un dump tronque."""
    pending = path.with_suffix(_PENDING_SUFFIX)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        pending.write_text(dump.model_dump_json(indent=2), encoding="utf-8")
        pending.replace(path)
    except OSError as exc:
        with contextlib.suppress(OSError):
            pending.unlink(missing_ok=True)
        raise TagDumpWriteError(path) from exc
