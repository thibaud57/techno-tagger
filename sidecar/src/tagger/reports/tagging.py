"""Rapport de re-tagging d'un run (ADR-014) : JSON source de verite, relu par l'app pour
rouvrir un run passe et Markdown lisible hors application. En anglais, comme les logs.

Le rapport est permanent et se migre (ADR-018 option B) : la migration se posera dans un
`@model_validator(mode="before")` de `TaggingReport`, qui n'existe pas tant que la version 1
est la seule. Le plan de run, jetable, refuse au contraire une version inconnue.
"""

from collections import Counter
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, ClassVar, Final, Literal

from pydantic import AwareDatetime

from tagger.core.errors import TaggerError
from tagger.core.identifiers import RunId, TrackId
from tagger.core.models import StrictFrozenModel
from tagger.core.run_files import TIMESTAMP_FORMAT, read_versioned
from tagger.reports.common import (
    escape_markdown,
    format_instant,
    table_row,
    table_section,
    unused_report_paths,
    write_report_pair,
)
from tagger.resolution.matching import QueryOrigin, credited_artists, full_title
from tagger.resolution.scraper_client import Source
from tagger.run.models import Resolution, RolledBack, TrackFailureReason, TrackState, Written
from tagger.tags.files import (
    TagField,
    TagSystem,
    after_tags,
    project_tags,
    shown_key,
    tag_system_of,
)

if TYPE_CHECKING:
    from collections.abc import Mapping
    from datetime import datetime

    from tagger.reports.common import ReportPaths
    from tagger.resolution.matching import MatchingThresholds
    from tagger.resolution.scraper_client import TrackCandidate
    from tagger.run.models import TaggingRun, TrackRecord

SCHEMA_VERSION: Final = 1
REPORT_KIND: Final = "tagging"
FILE_STEM: Final = "tagging-report"


class ReportQuery(StrictFrozenModel):
    text: str
    origin: QueryOrigin


class ReportTagValue(StrictFrozenModel):
    field: TagField
    key: str
    value: str | None


class ReportScores(StrictFrozenModel):
    """Scores bruts du candidat retenu ; distincts de ceux du plan, jetable et jamais migre."""

    artist: float | None
    title: float
    average: float
    version_mismatch: bool
    number_mismatch: bool


class ReportThresholds(StrictFrozenModel):
    floor: float
    ceiling: float


class TaggingReportCounts(StrictFrozenModel):
    written: int
    write_error: int
    unresolved: int
    rolled_back: int
    # Jamais atteint, ou laisse en arbitrage a la confirmation : aucun `state`.
    not_processed: int


class TaggingReportTrack(StrictFrozenModel):
    """Ce que le run a fait d'un morceau : de quoi rouvrir son recapitulatif sans rien relire.

    Un morceau restaure par rollback n'a plus de decision : seuls son fichier et ses tags
    d'origine restent.
    """

    track_id: TrackId
    file_before: str
    file_after: str | None
    truncated: bool
    query: ReportQuery | None
    source: Source | None
    state: TrackState | None
    resolution: Resolution | None
    failure_reason: TrackFailureReason | None
    scores: ReportScores | None
    artist: str | None
    title: str | None
    url: str | None
    artwork_url: str | None
    # Systeme des tags d'origine, nul s'ils etaient illisibles : l'interface l'y lit.
    system: TagSystem | None
    tags_before: tuple[ReportTagValue, ...] | None
    comment_before: str | None
    tags_after: tuple[ReportTagValue, ...] | None
    fields_written: tuple[TagField, ...]
    artwork_written: bool


class TaggingReport(StrictFrozenModel):
    schema_version: int = SCHEMA_VERSION
    kind: Literal["tagging"] = REPORT_KIND
    generated_at: AwareDatetime
    run_id: RunId
    folder: Path
    thresholds: ReportThresholds
    counts: TaggingReportCounts
    tracks: tuple[TaggingReportTrack, ...]


class TaggingReportUnreadableError(TaggerError):
    """Rapport illisible ou d'une version future ; une version passee se migre, jamais refusee."""

    code: ClassVar[str] = "tagging_report_unreadable"

    def __init__(self, path: Path, found: int | str | None = None) -> None:
        super().__init__(
            f"unreadable tagging report: {path.name}",
            file=path.name,
            found=found,
            expected=SCHEMA_VERSION,
        )


def build_tagging_report(
    run: TaggingRun, thresholds: MatchingThresholds, generated_at: datetime
) -> TaggingReport:
    # Chaque compteur se lit sur son `state`, jamais sur l'absence d'un autre
    # (cf. `run_finished_event`). Aucun `resolved` apres la confirmation : l'ecriture le
    # fait passer en written ou write_error.
    states = Counter(record.state for record in run.tracks)
    return TaggingReport(
        generated_at=generated_at,
        run_id=run.run_id,
        folder=run.folder,
        thresholds=ReportThresholds(floor=thresholds.floor, ceiling=thresholds.ceiling),
        counts=TaggingReportCounts(
            written=states[TrackState.WRITTEN],
            write_error=states[TrackState.WRITE_ERROR],
            unresolved=states[TrackState.UNRESOLVED],
            rolled_back=states[TrackState.ROLLED_BACK],
            not_processed=states[None],
        ),
        tracks=tuple(_track(record) for record in run.tracks),
    )


def load_tagging_report(path: Path) -> TaggingReport:
    """Relit un rapport ; une version future est refusee, un rapport plus ancien se migre ici."""
    return read_versioned(
        path, TaggingReport, SCHEMA_VERSION, TaggingReportUnreadableError, migrates=True
    )


_WAV_NOTE: Final = (
    "WAV tags are written as an ID3 chunk, which some DJ software does not read: "
    "check them in yours before relying on them."
)


def render_tagging_markdown(report: TaggingReport) -> str:
    """Rendu du JSON, jamais relu : une section par issue, une section vide est omise."""
    counts = report.counts
    by_state = _by_state(report.tracks)
    lines = [
        f"# Tagging report {escape_markdown(report.run_id)}",
        "",
        f"- Folder: {escape_markdown(report.folder)}",
        f"- Generated: {format_instant(report.generated_at)}",
        f"- Thresholds: floor {report.thresholds.floor:g}, ceiling {report.thresholds.ceiling:g}",
        f"- Written: {counts.written}, write errors: {counts.write_error}, "
        f"unresolved: {counts.unresolved}, rolled back: {counts.rolled_back}, "
        f"not processed: {counts.not_processed}",
        *table_section(
            "Written",
            ("Before", "After", "Source", "Route", "Score", "Fields", "Cover", "Truncated", "Page"),
            [
                table_row(
                    track.file_before,
                    track.file_after,
                    track.source,
                    track.resolution,
                    format_score(track),
                    len(track.fields_written),
                    _cover(track),
                    "yes" if track.truncated else "",
                    track.url or "",
                )
                for track in by_state[TrackState.WRITTEN]
            ],
        ),
        *table_section(
            "Write errors",
            ("File", "Source", "Reason"),
            [
                table_row(track.file_before, track.source, track.failure_reason)
                for track in by_state[TrackState.WRITE_ERROR]
            ],
        ),
        *table_section(
            "Unresolved",
            ("File", "Query", "Reason"),
            [
                table_row(
                    track.file_before,
                    "" if track.query is None else track.query.text,
                    track.failure_reason,
                )
                for track in by_state[TrackState.UNRESOLVED]
            ],
        ),
        *table_section(
            "Rolled back",
            ("File",),
            [table_row(track.file_before) for track in by_state[TrackState.ROLLED_BACK]],
        ),
        *table_section(
            "Not processed",
            ("File",),
            [table_row(track.file_before) for track in by_state[None]],
        ),
    ]
    if any(
        (track.file_after or "").lower().endswith(".wav") for track in by_state[TrackState.WRITTEN]
    ):
        lines += ["", "## WAV files", "", _WAV_NOTE]
    return "\n".join(lines) + "\n"


def report_paths(folder: Path, generated_at: datetime) -> ReportPaths:
    """Couple de noms du rapport d'un run, a choisir une seule fois : toute relance reecrit le meme.

    `generated_at` est en UTC, comme pour le rapport d'extraction.
    """
    return unused_report_paths(folder, FILE_STEM, generated_at.strftime(TIMESTAMP_FORMAT))


def write_tagging_report(
    run: TaggingRun,
    thresholds: MatchingThresholds,
    generated_at: datetime,
    paths: ReportPaths,
) -> None:
    """Ecrit le couple JSON et Markdown aux noms deja choisis, ecrasant celui d'une relance.

    Leve `ReportWriteError` en nommant le fichier refuse.
    """
    report = build_tagging_report(run, thresholds, generated_at)
    write_report_pair(paths, report.model_dump_json(indent=2), render_tagging_markdown(report))


def _by_state(
    tracks: tuple[TaggingReportTrack, ...],
) -> dict[TrackState | None, list[TaggingReportTrack]]:
    grouped: dict[TrackState | None, list[TaggingReportTrack]] = {
        TrackState.WRITTEN: [],
        TrackState.WRITE_ERROR: [],
        TrackState.UNRESOLVED: [],
        TrackState.ROLLED_BACK: [],
        None: [],
    }
    for track in tracks:
        grouped.setdefault(track.state, []).append(track)
    return grouped


def format_score(track: TaggingReportTrack) -> str:
    """« 94 (A 96 · T 92) » comme a l'ecran ; vide pour une URL collee, jamais scoree."""
    scores = track.scores
    if scores is None:
        return ""
    artist = "-" if scores.artist is None else f"{scores.artist:.0f}"
    return f"{scores.average:.0f} (A {artist} · T {scores.title:.0f})"


def _cover(track: TaggingReportTrack) -> str:
    """`missing` : la source proposait une pochette que l'ecriture n'a pas posee."""
    if track.artwork_written:
        return "written"
    return "none" if track.artwork_url is None else "missing"


def tag_rows(
    values: Mapping[TagField, str | None], system: TagSystem
) -> tuple[ReportTagValue, ...]:
    """Lignes du detail dans l'ordre de la table, avec la cle du fichier ecrit."""
    return tuple(
        ReportTagValue(field=field, key=shown_key(field, system), value=value)
        for field, value in values.items()
    )


def after_rows(record: TrackRecord, candidate: TrackCandidate) -> tuple[ReportTagValue, ...]:
    """Colonne Apres : sans origine lisible, le systeme se deduit de l'extension."""
    before = record.tags_before
    system = tag_system_of(record.path) if before is None else before.system
    return tag_rows(after_tags(project_tags(candidate), before), system)


def _track(record: TrackRecord) -> TaggingReportTrack:
    outcome, retained = record.outcome, record.retained
    candidate = None if retained is None else retained.candidate
    scored = None if retained is None else retained.scored
    written = outcome.written if isinstance(outcome, Written) else None
    query, before = record.query, record.tags_before
    return TaggingReportTrack(
        track_id=record.track_id,
        file_before=record.track_id,
        # Le renommage garde le dossier : seul le nom change, `path` peut porter le prefixe `\\?\`.
        file_after=None
        if written is None
        else (PurePosixPath(record.track_id).parent / record.path.name).as_posix(),
        truncated=written is not None and written.truncated,
        query=None if query is None else ReportQuery(text=query.text, origin=query.origin),
        source=None if retained is None else retained.source,
        state=record.state,
        # Comme l'ecran, le rapport masque la voie d'un morceau restaure, que le run vivant garde.
        resolution=None if isinstance(outcome, RolledBack) else record.resolution,
        failure_reason=record.failure_reason,
        scores=None
        if scored is None
        else ReportScores(
            artist=scored.artist_score,
            title=scored.title_score,
            average=scored.score,
            version_mismatch=scored.version_mismatch,
            number_mismatch=scored.number_mismatch,
        ),
        artist=None if candidate is None else credited_artists(candidate),
        title=None if candidate is None else full_title(candidate),
        url=None if candidate is None else candidate.url,
        artwork_url=None if candidate is None else candidate.artwork_url,
        system=None if before is None else before.system,
        tags_before=None if before is None else tag_rows(before.fields, before.system),
        comment_before=None if before is None else before.comment,
        tags_after=None if candidate is None else after_rows(record, candidate),
        fields_written=() if written is None else written.written.fields,
        artwork_written=written is not None and written.written.artwork,
    )
