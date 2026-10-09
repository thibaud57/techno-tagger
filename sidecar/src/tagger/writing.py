"""Ecriture d'un run confirme (use-case 5), hors protocole NDJSON : rendue par rappel.

Dump des tags d'origine de tous les morceaux vises avant le premier fichier (ADR-010), puis,
morceau par morceau, tags, pochette et renommage. Un echec reste local a son morceau.
Sequentielle : deux morceaux visant le meme nom ne se doublent pas.
"""

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, override

from tagger.file_failures import FileFailureReason, file_failure_reason
from tagger.files import (
    OriginalTags,
    TagField,
    TagsUnreadableError,
    TagsWriteError,
    UnreadableReason,
    project_tags,
    read_original_tags,
    write_tags,
)
from tagger.renaming import RenameError, rename_track
from tagger.tag_dump import (
    DumpEntry,
    TagDump,
    TagDumpError,
    dump_on_disk,
    record_renamed_path,
    save_entries,
)
from tagger.tagging import TrackResolved, TrackState, WriteOutcome

if TYPE_CHECKING:
    from collections.abc import Callable, Sequence
    from pathlib import Path

    from tagger.tagging import LiveRun, TrackRecord

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class WriteProgress:
    """Morceaux traites, ecrits ou en echec, sur morceaux vises par la phase."""

    processed: int
    total: int


@dataclass(frozen=True, slots=True)
class WriteSummary:
    """Bilan d'une phase d'ecriture ou de sa relance."""

    written: int
    failed: int


type WriteEvent = TrackResolved | WriteProgress


class RunWriter:
    """Ecrit les morceaux resolus d'un run, puis rejoue ses seuls echecs d'ecriture.

    Le dump cree au premier passage est garde pour les relances : l'origine reste celle
    d'avant la premiere ecriture.
    """

    def __init__(
        self,
        live: LiveRun,
        dump_folder: Path,
        on_event: Callable[[WriteEvent], None],
        *,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._live = live
        self._dump_folder = dump_folder
        self._on_event = on_event
        self._dump = TagDump(run_id=live.run_id, created_at=now())

    @override
    def __repr__(self) -> str:
        return f"RunWriter(run_id={self._live.run_id!r}, dumped={len(self._dump.entries)})"

    async def write(self) -> WriteSummary:
        """Ecrit les morceaux resolus ; non resolus et attentes d'arbitrage restent intacts."""
        return await self._apply(TrackState.RESOLVED)

    async def retry(self) -> WriteSummary:
        """Rejoue les seuls echecs d'ecriture, sans refaire ni reseau ni arbitrage."""
        return await self._apply(TrackState.WRITE_ERROR)

    async def _apply(self, state: TrackState) -> WriteSummary:
        targets = [record for record in self._live.snapshot().tracks if record.state is state]
        logger.info("write phase started run=%s", self._live.run_id)

        unreadable = await self._dump_originals(targets)
        settled: list[TrackRecord] = []
        for record in unreadable:
            self._settle(record, settled, len(targets))
        unreadable_ids = {record.track_id for record in unreadable}
        for record in targets:
            if record.track_id not in unreadable_ids:
                written = await asyncio.to_thread(self._write_one, record)
                self._settle(written, settled, len(targets))

        logger.info("write phase finished run=%s", self._live.run_id)
        written_count = sum(1 for record in settled if record.state is TrackState.WRITTEN)
        return WriteSummary(written=written_count, failed=len(settled) - written_count)

    async def _dump_originals(self, targets: Sequence[TrackRecord]) -> list[TrackRecord]:
        """Lit et enregistre l'origine des morceaux absents du dump, avant tout fichier.

        Rend les morceaux dont la lecture a echoue, en `write_error` mais pas encore regles :
        un dump impossible arrete la phase sans changer aucun morceau.
        """
        # Relu sur le disque : un rollback du run affiche a pu y consommer l'entree d'un echec
        # que la memoire garde, et la relance reecrirait ses tags sans origine sauvegardee.
        self._dump = await asyncio.to_thread(dump_on_disk, self._dump_folder, self._dump)
        unread = [record for record in targets if record.track_id not in self._dump.entries]
        reads = await asyncio.gather(
            *(asyncio.to_thread(read_original_tags, record.path) for record in unread),
            return_exceptions=True,
        )
        entries: dict[str, DumpEntry] = {}
        failed: list[TrackRecord] = []
        for record, read in zip(unread, reads, strict=True):
            match read:
                case OriginalTags():
                    entries[record.track_id] = DumpEntry.of(record.path, read)
                case TagsUnreadableError():
                    failed.append(record.write_failed(_unreadable_reason(read)))
                case _:
                    raise read
        if entries:
            self._dump = await asyncio.to_thread(
                save_entries, self._dump_folder, self._dump, entries
            )
        return failed

    def _write_one(self, record: TrackRecord) -> TrackRecord:
        candidate = record.candidate
        if candidate is None:
            raise ValueError("resolved track without candidate")
        values = project_tags(candidate)
        try:
            written = write_tags(record.path, values, record.artwork)
            renamed = rename_track(
                record.path,
                values.get(TagField.ARTIST),
                values.get(TagField.TITLE),
                lambda target: self._note_rename(record.track_id, target),
            )
        except (TagsWriteError, RenameError) as error:
            return record.write_failed(error.reason)
        outcome = WriteOutcome(written.fields, written.artwork, renamed.truncated)
        return record.written_to(renamed.path, outcome)

    def _note_rename(self, track_id: str, target: Path) -> None:
        """Note le chemin cible au dump avant que le fichier ne bouge.

        Une coupure entre les deux laisse un chemin que le rollback retrouve par l'ancien
        nom. Un dump qui ne se met pas a jour n'arrete rien : le morceau passe `written`, son
        rollback echouera en `file_missing`, faute de chemin renomme.
        """
        try:
            self._dump = record_renamed_path(self._dump_folder, self._dump, track_id, target)
        except TagDumpError, KeyError:  # KeyError : entree absente du dump relu sur disque
            logger.exception(
                "tag dump not updated after rename run=%s track=%d reason=rename_not_noted",
                self._live.run_id,
                self._live.position(track_id),
            )

    def _settle(self, record: TrackRecord, settled: list[TrackRecord], total: int) -> None:
        self._live.update(record)
        if record.state is TrackState.WRITE_ERROR:
            logger.error(
                "write failed run=%s track=%d reason=%s",
                self._live.run_id,
                self._live.position(record.track_id),
                record.failure_reason,
            )
        settled.append(record)
        self._on_event(TrackResolved(record))
        self._on_event(WriteProgress(len(settled), total))


def _unreadable_reason(error: TagsUnreadableError) -> FileFailureReason:
    """Motif d'une lecture en echec.

    `LOCKED` prime : un verrou est un `PermissionError` sans `winerror`, lu comme un refus.
    """
    if error.reason is UnreadableReason.LOCKED:
        return FileFailureReason.FILE_LOCKED
    cause = error.__cause__
    while cause is not None and not isinstance(cause, OSError):
        cause = cause.__cause__
    if isinstance(cause, OSError):
        return file_failure_reason(cause)
    return FileFailureReason.WRITE_FAILED
