"""Traduction des evenements du pipeline, de l'arbitrage, du rattrapage et de l'ecriture en
evenements du protocole. Seule couche qui connaisse les deux cotes : `handlers` emet, `protocol`
decrit, aucun des deux ne projette l'autre.
"""

import logging
from collections import Counter
from typing import TYPE_CHECKING, assert_never

from tagger.protocol import (
    ArbitrationRequired,
    ArbitrationUpdated,
    CandidatePayload,
    Phase,
    Progress,
    RunFinished,
    RunStarted,
    TagsBeforePayload,
    TagValuePayload,
    TrackEntry,
    TrackNames,
    TrackResolved,
    TrackScores,
)
from tagger.reports.tagging import after_rows, tag_rows
from tagger.resolution.matching import credited_artists, full_title
from tagger.run import arbitration, models, url_recovery, writing

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable

    from tagger.protocol import Event, RunPhase
    from tagger.reports.extraction import ReportPaths
    from tagger.reports.tagging import ReportTagValue
    from tagger.resolution.matching import ScoredCandidate
    from tagger.resolution.scraper_client import TrackCandidate
    from tagger.run.arbitration import ArbitrationEvent
    from tagger.run.models import TaggingRun, TrackRecord
    from tagger.run.url_recovery import UrlRecoveryEvent
    from tagger.run.writing import WriteEvent
    from tagger.tags.files import TagSystem

logger = logging.getLogger(__name__)


type PipelineEvent = models.RunEvent | ArbitrationEvent | UrlRecoveryEvent | WriteEvent


def relay_into(emit: Callable[[Event], None]) -> Callable[[PipelineEvent], None]:
    return lambda event: emit(to_protocol_event(event))


# PLR0911 : une sortie par evenement traduit, le `match` ferme par `assert_never` etant
# ce qui rend un oubli visible au typage.
def to_protocol_event(event: PipelineEvent) -> Event:  # noqa: PLR0911
    """Traduit un evenement pipeline, arbitrage, rattrapage ou ecriture."""
    match event:
        case models.RunStarted():
            return RunStarted(
                event="run_started",
                run_id=event.run_id,
                folder=event.folder,
                tracks=tuple(_entry(record) for record in event.tracks),
            )
        case models.TrackResolved():
            return resolved_event(event.record)
        case models.ArbitrationRequired():
            return _arbitration_state(ArbitrationRequired, event.record)
        case arbitration.ArbitrationUpdated():
            return _arbitration_state(ArbitrationUpdated, event.record)
        case models.RunProgress():
            return Progress(
                event="progress",
                phase=Phase.TAGGING,
                processed=event.processed,
                total=event.total,
            )
        case url_recovery.UrlProgress():
            return Progress(
                event="progress",
                phase=Phase.URL_RECOVERY,
                processed=event.processed,
                total=event.total,
            )
        case writing.WriteProgress():
            return Progress(
                event="progress",
                phase=Phase.WRITE,
                processed=event.processed,
                total=event.total,
            )
        case _:
            assert_never(event)


def _entry(record: TrackRecord) -> TrackEntry:
    before = record.tags_before
    return TrackEntry(
        track_id=record.track_id,
        file_name=record.file_name,
        artist=record.identity.artist,
        title=record.identity.title,
        tags_before=None
        if before is None
        else tags_before_payload(
            before.system, before.comment, tag_rows(before.fields, before.system)
        ),
    )


def tags_before_payload(
    system: TagSystem, comment: str | None, rows: Iterable[ReportTagValue]
) -> TagsBeforePayload:
    return TagsBeforePayload(system=system, comment=comment, fields=payload_rows(rows))


def _tags_after(record: TrackRecord, candidate: TrackCandidate) -> tuple[TagValuePayload, ...]:
    return payload_rows(after_rows(record, candidate))


def payload_rows(rows: Iterable[ReportTagValue]) -> tuple[TagValuePayload, ...]:
    """Une seule projection des lignes pour l'ecran et le rapport, ici seulement convertie."""
    return tuple(TagValuePayload.model_validate(row, from_attributes=True) for row in rows)


def resolved_event(record: TrackRecord) -> TrackResolved:
    if record.state is None or record.resolution is None:
        logger.error("track without state track=%s", record.track_id)
        raise ValueError("track without state")
    candidate = record.candidate
    return TrackResolved(
        event="track_resolved",
        track_id=record.track_id,
        state=record.state,
        resolution=record.resolution,
        failure_reason=record.failure_reason,
        source=record.source,
        after=None if candidate is None else _names(candidate),
        scores=None if record.scored is None else _scores(record.scored),
        artwork_path=record.artwork,
        tags_after=None if candidate is None else _tags_after(record, candidate),
        restorable=record.restorable,
        source_url=None if candidate is None else candidate.url,
    )


def _arbitration_state(
    kind: type[ArbitrationRequired | ArbitrationUpdated], record: TrackRecord
) -> ArbitrationRequired | ArbitrationUpdated:
    pending = record.arbitration
    if pending is None:
        logger.error("track without arbitration track=%s", record.track_id)
        raise ValueError("track without arbitration")
    return kind(
        track_id=record.track_id,
        source=pending.source,
        beatport_unavailable=pending.beatport_unavailable,
        candidates=tuple(_candidate(scored) for scored in pending.candidates),
        empty_reason=pending.empty_reason,
        other_source=None if pending.other is None else pending.other.source,
    )


def _candidate(scored: ScoredCandidate) -> CandidatePayload:
    candidate = scored.candidate
    released = candidate.release.release_date if candidate.release else None
    return CandidatePayload(
        artist=credited_artists(candidate),
        title=full_title(candidate),
        label=None if candidate.label is None else candidate.label.name,
        year=None if released is None else released.year,
        scores=_scores(scored),
    )


def _names(candidate: TrackCandidate) -> TrackNames:
    """Ce que la source ecrira : regle de titre et d'artistes de l'ADR-011."""
    return TrackNames(artist=credited_artists(candidate), title=full_title(candidate))


def _scores(scored: ScoredCandidate) -> TrackScores:
    """Arrondis : l'ecran affiche « A 96 · T 92 »."""
    return rounded_scores(scored.artist_score, scored.title_score, scored.score)


def rounded_scores(artist: float | None, title: float, average: float) -> TrackScores:
    return TrackScores(
        artist=None if artist is None else round(artist),
        title=round(title),
        average=round(average),
    )


def run_finished_event(
    run: TaggingRun, phase: RunPhase, report: ReportPaths | None = None
) -> RunFinished:
    # Chaque compteur se lit sur le champ de son issue, jamais sur l'absence d'un autre : un
    # `state` laisse vide gonflerait en silence le compte des arbitrages.
    states = Counter(record.state for record in run.tracks)
    return RunFinished(
        event="run_finished",
        phase=phase,
        run_id=run.run_id,
        resolved=states[models.TrackState.RESOLVED],
        unresolved=states[models.TrackState.UNRESOLVED],
        written=states[models.TrackState.WRITTEN],
        write_error=states[models.TrackState.WRITE_ERROR],
        awaiting_arbitration=sum(1 for record in run.tracks if record.arbitration is not None),
        report_path=None if report is None else report.json_path,
    )
