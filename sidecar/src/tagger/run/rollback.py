"""Rollback d'un run ou d'un morceau depuis son dump (ADR-010), hors protocole : rendu par rappel.

Nom d'origine puis tags, chaque etape rejouable : un fichier verrouille echoue au renommage,
avant que ses tags bougent. La pochette posee par l'ecriture reste et les commentaires qu'elle a
retires ne reviennent pas : le dump ne garde aucune image (ADR-011).
"""

import asyncio
import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING, ClassVar

from tagger.core.errors import TaggerError
from tagger.core.file_failures import FileFailureReason
from tagger.core.paths import extended_path
from tagger.run.models import FailureReason
from tagger.tags.files import TagsWriteError, restore_tags
from tagger.tags.renaming import OriginalNameTakenError, RenameError, restore_name
from tagger.tags.tag_dump import (
    TagDumpUnreadableError,
    TagDumpWriteError,
    dumps_newest_first,
    find_dump,
    load_dump,
    remove_entries,
)

if TYPE_CHECKING:
    from collections.abc import Callable, Sequence
    from datetime import datetime
    from pathlib import Path

    from tagger.run.models import TrackFailureReason
    from tagger.tags.tag_dump import DumpEntry, TagDump

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class RollbackTarget:
    """Dernier run annulable, de quoi le nommer dans la confirmation."""

    run_id: str
    written_at: datetime
    folder: Path
    tracks: int


@dataclass(frozen=True, slots=True, kw_only=True)
class RollbackFailure:
    """Morceau laisse en l'etat ; `file_name` est son nom actuel, celui que l'utilisateur voit."""

    track_id: str
    file_name: str
    reason: TrackFailureReason


@dataclass(frozen=True, slots=True)
class RollbackSummary:
    """Bilan d'un rollback ; un echec reste dans le dump, sauf `file_missing` (cf. `_forget`).

    `forgotten` : morceaux en `file_missing` effectivement retires du dump, sans restauration.
    """

    run_id: str
    restored: tuple[str, ...]
    failed: tuple[RollbackFailure, ...]
    forgotten: tuple[str, ...] = ()


class RollbackUnavailableError(TaggerError):
    """Rien a restaurer : dump purge ou jamais ecrit, morceau deja restaure ou jamais ecrit."""

    code: ClassVar[str] = "rollback_unavailable"

    def __init__(self, run_id: str, track_id: str | None = None) -> None:
        super().__init__("nothing to roll back", run_id=run_id, track_id=track_id)


def find_rollback_target(folder: Path) -> RollbackTarget | None:
    """Le plus recent dump qui a encore des morceaux ; un dump illisible est saute."""
    for path in dumps_newest_first(folder):
        try:
            dump = load_dump(path)
        except TagDumpUnreadableError:
            logger.warning("tag dump skipped reason=unreadable")
            continue
        if dump.entries:
            return RollbackTarget(
                run_id=dump.run_id,
                written_at=dump.created_at,
                folder=dump.folder,
                tracks=len(dump.entries),
            )
    return None


async def roll_back(
    folder: Path,
    run_id: str,
    track_id: str | None,
    on_restored: Callable[[str, Path], None],
) -> RollbackSummary:
    """Restaure un run ou son seul morceau ; `on_restored` rend chaque morceau et son chemin."""
    dump = await asyncio.to_thread(_load_run, folder, run_id)
    entries = _targets(dump, track_id)
    logger.info("rollback started run=%s", run_id)
    restored: list[str] = []
    failed: list[RollbackFailure] = []
    # Ordre inverse de l'ecriture : l'ancien nom d'un morceau peut etre le nom final d'un
    # morceau ecrit apres.
    for target_id, entry in reversed(list(entries.items())):
        failure = await asyncio.to_thread(_restore_one, target_id, entry)
        if failure is None:
            restored.append(target_id)
            on_restored(target_id, entry.path)
        else:
            logger.error("rollback failed run=%s reason=%s", run_id, failure.reason)
            failed.append(failure)
    forgotten = await asyncio.to_thread(_forget, folder, dump, restored, failed)
    logger.info("rollback finished run=%s", run_id)
    return RollbackSummary(run_id, tuple(restored), tuple(failed), forgotten)


def _load_run(folder: Path, run_id: str) -> TagDump:
    path = find_dump(folder, run_id)
    if path is None:
        raise RollbackUnavailableError(run_id)
    return load_dump(path)


def _targets(dump: TagDump, track_id: str | None) -> dict[str, DumpEntry]:
    if track_id is None:
        return dict(dump.entries)
    entry = dump.entries.get(track_id)
    if entry is None:
        raise RollbackUnavailableError(dump.run_id, track_id)
    return {track_id: entry}


def _restore_one(track_id: str, entry: DumpEntry) -> RollbackFailure | None:
    current = _located(entry)
    if current is None:
        missing = entry.renamed_path or entry.path
        return RollbackFailure(
            track_id=track_id, file_name=missing.name, reason=FileFailureReason.FILE_MISSING
        )
    try:
        restore_name(current, entry.path)
    except OriginalNameTakenError:
        return RollbackFailure(
            track_id=track_id, file_name=current.name, reason=FailureReason.NAME_TAKEN
        )
    except RenameError as error:
        return RollbackFailure(track_id=track_id, file_name=current.name, reason=error.reason)
    try:
        restore_tags(entry.path, entry.original_tags())
    except TagsWriteError as error:
        return RollbackFailure(track_id=track_id, file_name=entry.path.name, reason=error.reason)
    return None


def _located(entry: DumpEntry) -> Path | None:
    """Sous son nouveau nom, sinon sous l'ancien : rollback interrompu, renommage jamais fait."""
    for candidate in (entry.renamed_path, entry.path):
        if candidate is not None and extended_path(candidate).is_file():
            return candidate
    return None


def _forget(
    folder: Path,
    dump: TagDump,
    restored: Sequence[str],
    failed: Sequence[RollbackFailure],
) -> tuple[str, ...]:
    """Retire du dump les morceaux restaures et ceux dont le fichier a disparu : rien a leur rendre.

    Rend ces derniers, vide si le dump n'a pas pu etre reecrit : leur entree y reste alors.

    Un `file_missing` dont le dossier d'origine a disparu reste dans le dump : un disque externe
    debranche ou une lettre changee ferait perdre pour toujours les tags d'origine. Un dump non
    reecrit ne perd rien : le prochain rollback rejoue les morceaux restaures.
    """
    gone = [
        failure.track_id
        for failure in failed
        if failure.reason is FileFailureReason.FILE_MISSING
        and extended_path(dump.entries[failure.track_id].path.parent).is_dir()
    ]
    forgotten = {*restored, *gone}
    if not forgotten:
        return ()
    try:
        remove_entries(folder, dump, forgotten)
    except TagDumpWriteError:
        logger.warning("tag dump not updated after rollback run=%s", dump.run_id)
        return ()
    return tuple(gone)
