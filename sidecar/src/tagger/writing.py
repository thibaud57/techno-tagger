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

import sentry_sdk

from tagger.file_failures import FileFailureReason
from tagger.files import (
    OriginalTags,
    TagField,
    TagsUnreadableError,
    TagsWriteError,
    project_tags,
    read_original_tags,
    write_tags,
)
from tagger.renaming import RenamedTrack, RenameError, plan_rename
from tagger.tag_dump import (
    DumpEntry,
    TagDump,
    TagDumpError,
    TagDumpWriteError,
    dump_on_disk,
    record_renamed_path,
    rewrite_dump,
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
        self._dump = TagDump(run_id=live.run_id, created_at=now(), folder=live.folder)

    @override
    def __repr__(self) -> str:
        return f"RunWriter(run_id={self._live.run_id!r}, dumped={len(self._dump.entries)})"

    async def write(self) -> None:
        """Ecrit les morceaux resolus ; non resolus et attentes d'arbitrage restent intacts."""
        await self._apply(TrackState.RESOLVED)

    async def retry(self) -> None:
        """Rejoue les seuls echecs d'ecriture, sans refaire ni reseau ni arbitrage."""
        await self._apply(TrackState.WRITE_ERROR)

    async def _apply(self, state: TrackState) -> None:
        targets = [record for record in self._live.snapshot().tracks if record.state is state]
        logger.info("write phase started run=%s", self._live.run_id)

        unreadable = await self._dump_originals(targets)
        processed = 0
        for record in unreadable:
            processed += 1
            self._settle(record, processed, len(targets))
        unreadable_ids = {record.track_id for record in unreadable}
        for record in targets:
            if record.track_id not in unreadable_ids:
                written = await asyncio.to_thread(self._write_one, record)
                processed += 1
                self._settle(written, processed, len(targets))

        await asyncio.to_thread(self._rewrite_dump)
        logger.info("write phase finished run=%s", self._live.run_id)

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
                    failed.append(record.write_failed(read.reason, restorable=False))
                case Exception():
                    # Hors `TagsUnreadableError` : mutagen laisse passer `struct.error` ou
                    # `ValueError` sur un fichier corrompu, un seul morceau ne coupe pas la phase.
                    logger.error(
                        "original tags not read run=%s track=%d reason=write_failed",
                        self._live.run_id,
                        self._live.position(record.track_id),
                        exc_info=read,
                    )
                    # `LoggingIntegration` est coupee : le log ne part pas, le bug doit remonter.
                    sentry_sdk.capture_exception(read)
                    failed.append(
                        record.write_failed(FileFailureReason.WRITE_FAILED, restorable=False)
                    )
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
        noted = False

        try:
            written = write_tags(record.path, values, record.artwork)
            plan = plan_rename(record.path, values.get(TagField.ARTIST), values.get(TagField.TITLE))
            if plan is None:
                renamed = RenamedTrack(record.path, truncated=False)
            else:
                self._note_rename(record, plan.target)
                noted = True
                renamed = plan.apply()
        except (TagsWriteError, RenameError) as error:
            return self._failed(record, error.reason, noted=noted)
        except Exception as error:
            # Hors `TagsWriteError` : mutagen laisse passer `struct.error` ou `ValueError` sur
            # un fichier corrompu, un seul morceau ne coupe pas la phase. Pas de `BaseException` :
            # l'annulation doit passer.
            logger.exception(
                "write failed unexpectedly run=%s track=%d reason=write_failed",
                self._live.run_id,
                self._live.position(record.track_id),
            )
            # `LoggingIntegration` est coupee : le log ne part pas, le bug doit remonter.
            sentry_sdk.capture_exception(error)
            return self._failed(record, FileFailureReason.WRITE_FAILED, noted=noted)
        outcome = WriteOutcome(written, renamed.truncated)
        return record.written_to(renamed.path, outcome)

    def _rewrite_dump(self) -> None:
        """Reecrit le dump une fois la phase finie ; un echec laisse le journal, qui fait foi."""
        try:
            rewrite_dump(self._dump_folder, self._dump)
        except TagDumpWriteError:
            logger.warning("tag dump not rewritten run=%s reason=journal_kept", self._live.run_id)

    def _note_rename(self, record: TrackRecord, target: Path) -> None:
        """Note le chemin cible au dump avant que le fichier ne bouge.

        Une coupure entre les deux laisse un chemin que le rollback retrouve par l'ancien
        nom. Une note qui echoue refuse le renommage : un fichier renomme sans note ne se
        retrouverait plus au rollback, et ses tags d'origine seraient oublies avec lui.
        """
        try:
            self._dump = record_renamed_path(self._dump_folder, self._dump, record.track_id, target)
        except (TagDumpError, KeyError) as error:  # KeyError : entree absente du dump
            logger.exception(
                "tag dump not updated before rename run=%s track=%d reason=rename_not_noted",
                self._live.run_id,
                self._live.position(record.track_id),
            )
            raise RenameError(record.path, FileFailureReason.WRITE_FAILED) from error

    def _failed(
        self, record: TrackRecord, reason: FileFailureReason, *, noted: bool
    ) -> TrackRecord:
        """Morceau en `write_error` ; une note de renommage restee derriere est effacee.

        Le nom note n'est pas occupe : un morceau suivant peut le prendre, et le rollback
        rendrait alors le fichier de l'autre.
        """
        if noted:
            try:
                self._dump = record_renamed_path(
                    self._dump_folder, self._dump, record.track_id, None
                )
            except TagDumpError, KeyError:
                logger.exception(
                    "tag dump note kept run=%s track=%d reason=rename_note_kept",
                    self._live.run_id,
                    self._live.position(record.track_id),
                )
        # L'origine est au dump : `_write_one` ne tourne que pour les morceaux qui y sont.
        return record.write_failed(reason, restorable=True)

    def _settle(self, record: TrackRecord, processed: int, total: int) -> None:
        self._live.update(record)
        if record.state is TrackState.WRITE_ERROR:
            logger.error(
                "write failed run=%s track=%d reason=%s",
                self._live.run_id,
                self._live.position(record.track_id),
                record.failure_reason,
            )
        self._on_event(TrackResolved(record))
        self._on_event(WriteProgress(processed, total))
