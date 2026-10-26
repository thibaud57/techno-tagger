"""Run couvrant chaque issue, partage par les tests du rapport de re-tagging."""

from collections import Counter
from dataclasses import replace
from pathlib import Path
from typing import Final

from scraper_responses import ARTWORK_URL, BEATPORT_CANDIDATE, YOUR_MIND
from tagging_records import (
    CREATED,
    MUSIC,
    RUN_ID,
    awaiting,
    named,
    resolved,
    rolled_back_record,
    scored_candidate,
    unresolved,
    write_failed_record,
    written_record,
)

from tagger.core.file_failures import FileFailureReason
from tagger.core.identifiers import TrackId
from tagger.reports.tagging import (
    ReportQuery,
    ReportScores,
    ReportThresholds,
    TaggingReport,
    TaggingReportCounts,
    TaggingReportTrack,
    tag_rows,
)
from tagger.resolution.matching import QueryOrigin
from tagger.resolution.scraper_client import Source
from tagger.run.models import (
    FailureReason,
    Resolution,
    Resolved,
    ResolvedBy,
    TaggingRun,
    TrackFailureReason,
    TrackRecord,
    TrackState,
    Waiting,
    WriteOutcome,
)
from tagger.tags.files import ShownTags, TagField, TagSystem, WrittenTags

COMMENT: Final = "ripped from vinyl"
HOME_FOLDER: Final = Path(r"C:\Users\jane\Music\Private Party")
# Toute la table, absente comprise : `after_tags` lit chaque champ d'origine.
BEFORE: Final = ShownTags(
    system=TagSystem.ID3,
    fields=dict.fromkeys(TagField) | {TagField.ARTIST: "adam beyer", TagField.TITLE: "your mind"},
    comment=COMMENT,
)
WRITTEN_AS: Final = "Adam Beyer - Your Mind (Extended Mix).mp3"


def _record(name: str) -> TrackRecord[Waiting]:
    return replace(named(name), tags_before=BEFORE)


def _resolved(name: str, resolution: ResolvedBy, source: Source) -> TrackRecord[Resolved]:
    return resolved(
        _record(name),
        resolution,
        source=source,
        candidate=BEATPORT_CANDIDATE,
        scored=scored_candidate(candidate=BEATPORT_CANDIDATE),
    )


WRITTEN: Final = written_record(
    _resolved("a.mp3", Resolution.AUTO, Source.BEATPORT),
    WriteOutcome(WrittenTags((TagField.ARTIST, TagField.TITLE), artwork=True), truncated=True),
    path=MUSIC / WRITTEN_AS,
)
FAILED: Final = write_failed_record(
    _resolved("b.mp3", Resolution.ARBITRATION, Source.BANDCAMP), FileFailureReason.FILE_LOCKED
)
UNRESOLVED: Final = unresolved(_record("c.mp3"), FailureReason.NO_RESULT)
WAITING: Final = _record("d.mp3")
HELD: Final = awaiting(_record("e.mp3"))
# Ecrit puis restaure : le morceau perd sa source et son candidat, il garde sa voie.
ROLLED_BACK: Final = rolled_back_record(
    written_record(
        _resolved("f.mp3", Resolution.AUTO, Source.BEATPORT),
        WriteOutcome(WrittenTags((TagField.ARTIST,), artwork=False), truncated=False),
        path=MUSIC / "f - renamed.mp3",
    ),
    MUSIC / "f.mp3",
)
RUN: Final = TaggingRun(RUN_ID, MUSIC, (WRITTEN, FAILED, UNRESOLVED, WAITING, HELD, ROLLED_BACK))


def report_track(
    name: str,
    state: TrackState | None = TrackState.WRITTEN,
    resolution: Resolution | None = Resolution.AUTO,
    *,
    failure_reason: TrackFailureReason | None = None,
    file_after: str | None = None,
    average: float = 95.0,
    title: str = "Your Mind (Extended Mix)",
) -> TaggingReportTrack:
    """Morceau du rapport ; un non resolu n'a ni candidat ni score."""
    unresolved = state is TrackState.UNRESOLVED
    scores = ReportScores(
        artist=average,
        title=average,
        average=average,
        version_mismatch=False,
        number_mismatch=False,
    )
    return TaggingReportTrack(
        track_id=TrackId(name),
        file_before=name,
        file_after=file_after,
        truncated=False,
        query=ReportQuery(text=YOUR_MIND, origin=QueryOrigin.TAGS),
        source=None if unresolved else Source.BEATPORT,
        state=state,
        resolution=resolution,
        failure_reason=failure_reason,
        scores=None if unresolved else scores,
        artist=None if unresolved else "Adam Beyer",
        title=None if unresolved else title,
        url=None if unresolved else BEATPORT_CANDIDATE.url,
        artwork_url=None if unresolved else ARTWORK_URL,
        system=BEFORE.system,
        tags_before=tag_rows(BEFORE.fields, BEFORE.system),
        comment_before=BEFORE.comment,
        tags_after=None,
        fields_written=(),
        artwork_written=False,
    )


def report_of(*tracks: TaggingReportTrack, folder: Path = MUSIC) -> TaggingReport:
    states = Counter(track.state for track in tracks)
    return TaggingReport(
        generated_at=CREATED,
        run_id=RUN_ID,
        folder=folder,
        thresholds=ReportThresholds(floor=70, ceiling=90),
        counts=TaggingReportCounts(
            written=states[TrackState.WRITTEN],
            write_error=states[TrackState.WRITE_ERROR],
            unresolved=states[TrackState.UNRESOLVED],
            rolled_back=states[TrackState.ROLLED_BACK],
            not_processed=states[None],
        ),
        tracks=tracks,
    )
