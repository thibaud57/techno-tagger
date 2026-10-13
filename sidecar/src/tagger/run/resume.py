"""Reprise d'un run interrompu (use-case 6) : detection au lancement et reconstruction depuis
son plan. Hors protocole NDJSON : les evenements sortent par un rappel.
"""

import asyncio
import copy
import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

from tagger.core.errors import RunNotFoundError
from tagger.core.run_files import created_at_of, run_id_of
from tagger.run.models import (
    ArbitrationRequired,
    LiveRun,
    RunProgress,
    RunStarted,
    TrackResolved,
    TrackState,
)
from tagger.run.plan import (
    RunPlanUnreadableError,
    discard_plan,
    find_plan,
    load_plan,
    plans_newest_first,
)
from tagger.run.tagging import read_identities
from tagger.tags.files import TaggingFolderUnreadableError, has_audio_files, list_audio_files
from tagger.tags.tag_dump import find_dump

if TYPE_CHECKING:
    from collections.abc import Callable, Collection
    from datetime import datetime
    from pathlib import Path

    from tagger.resolution.sources import RunSources
    from tagger.run.models import RunEvent, TrackRecord
    from tagger.run.plan import RunPlan

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True, kw_only=True)
class InterruptedRun:
    """Run a proposer a la reprise, resume tire du plan."""

    run_id: str
    started_at: datetime
    folder: Path
    processed: int
    total: int
    # Disque debranche, dossier deplace ou vide : seule l'option de repartir de zero reste.
    folder_missing: bool


@dataclass(frozen=True, slots=True)
class UnreadablePlan:
    """Plan illisible ou d'une autre version : jamais repris, son erreur dit pourquoi (ADR-018)."""

    run_id: str
    started_at: datetime
    error: RunPlanUnreadableError


type DetectedPlan = InterruptedRun | UnreadablePlan


def detect_interrupted(
    plans: Path, dumps: Path, *, active_run_id: str | None = None
) -> DetectedPlan | None:
    """Le plan le plus recent a proposer ; un plus ancien attend le lancement suivant.

    `active_run_id` : le run ouvert dans la session n'est pas interrompu, son plan est ignore.

    Un plan dont le run a un dump a vu des fichiers bouger : la reprise affirmerait qu'aucun
    n'a ete touche. Il est traite comme termine, la restauration des Reglages couvre le cas.
    Un plan confirme part a la purge, un dump sans confirmation est ecarte ici.
    """
    for path, started_at in _stamped(plans):
        if run_id_of(path) == active_run_id:
            continue
        try:
            plan = load_plan(path)
        except RunPlanUnreadableError as error:
            return UnreadablePlan(run_id_of(path), started_at, error)
        if _files_written(plan, dumps):
            if not plan.committed:
                logger.warning("run plan dropped run=%s reason=files_written", plan.run_id)
                discard_plan(path)
            continue
        return InterruptedRun(
            run_id=plan.run_id,
            started_at=plan.started_at,
            folder=plan.folder,
            processed=plan.processed_count(),
            total=len(plan.tracks),
            folder_missing=_folder_missing(plan.folder),
        )
    return None


def load_resumable(plans: Path, dumps: Path, run_id: str) -> RunPlan:
    """Plan a rouvrir, valide avant qu'on abandonne le run affiche : `run_not_found` s'il manque
    ou a vu des fichiers bouger."""
    path = find_plan(plans, run_id)
    if path is None:
        raise RunNotFoundError(run_id)
    plan = load_plan(path)
    if _files_written(plan, dumps):
        raise RunNotFoundError(run_id)
    return plan


async def reopen_run(
    plan: RunPlan, sources: RunSources, *, on_event: Callable[[RunEvent], None]
) -> LiveRun:
    """Reconstruit le run quitte sur le dossier tel qu'il est, puis rejoue ses evenements.

    Memes evenements qu'un run vivant : l'interface ne distingue pas une reprise. La phase
    reseau qui suit (`resolve_run`) ne traite que les morceaux sans decision.
    """
    paths = await asyncio.to_thread(list_audio_files, plan.folder)
    if not paths:
        raise TaggingFolderUnreadableError(plan.folder)
    reread = await read_identities(plan.run_id, plan.folder, paths)
    _log_missing(plan, {record.track_id for record in reread})
    records = [_decided_or_waiting(plan, record) for record in reread]

    on_event(RunStarted(plan.run_id, plan.folder, tuple(records)))
    records = await _with_artworks(records, sources)
    for record in records:
        if record.arbitration is not None:
            on_event(ArbitrationRequired(record))
        elif record.state is not None:
            on_event(TrackResolved(record))
    on_event(RunProgress(sum(record.decided for record in records), len(records)))
    return LiveRun(plan.run_id, plan.folder, records)


def _files_written(plan: RunPlan, dumps: Path) -> bool:
    """Plan confirme ou dont le run a un dump : la regle unique du plan qui ne se reprend pas."""
    return plan.committed or find_dump(dumps, plan.run_id) is not None


def _stamped(plans: Path) -> list[tuple[Path, datetime]]:
    """Plans du plus recent au plus ancien, avec la date lue sur leur nom."""
    return [
        (path, created)
        for path in plans_newest_first(plans)
        if (created := created_at_of(path)) is not None
    ]


def _folder_missing(folder: Path) -> bool:
    """Un dossier vide vaut un dossier introuvable : `reopen_run` n'aurait rien a rouvrir."""
    return not (folder.is_dir() and has_audio_files(folder))


def _decided_or_waiting(plan: RunPlan, record: TrackRecord) -> TrackRecord:
    """Decision du plan posee sur le morceau ; fichier nouveau ou source muette : en attente."""
    track = plan.tracks.get(record.track_id)
    return record if track is None or not track.processed else track.applied_to(record)


def _log_missing(plan: RunPlan, on_disk: Collection[str]) -> None:
    """Fichier disparu depuis le plan : il sort du run, sa decision avec lui."""
    for position, track_id in enumerate(plan.tracks, start=1):
        if track_id not in on_disk:
            logger.warning(
                "track dropped run=%s track=%d reason=file_missing", plan.run_id, position
            )


async def _with_artworks(records: list[TrackRecord], sources: RunSources) -> list[TrackRecord]:
    """Pochettes des morceaux resolus, cache d'abord : le plan n'en garde aucune (ADR-013)."""
    async with asyncio.TaskGroup() as group:
        fetches = {
            record.track_id: group.create_task(
                sources.artwork(position, record.candidate), name=f"artwork:{position}"
            )
            for position, record in enumerate(records, start=1)
            if record.state is TrackState.RESOLVED and record.candidate is not None
        }
    return [
        copy.replace(record, artwork=fetches[record.track_id].result())
        if record.track_id in fetches
        else record
        for record in records
    ]
