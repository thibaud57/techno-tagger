"""Issue de retour de matching (ADR-014) : URL de l'Issue Form du depot, pre-remplie d'un
resume du run borne a ce que Windows sait ouvrir, et export JSON nettoye a y joindre.

L'application ne pousse rien : l'utilisateur relit, joint ou non l'export, valide. Le depot est
public : seul ce que les listes fermees du resume et de l'export laissent passer en sort.
"""

from pathlib import PurePosixPath
from typing import TYPE_CHECKING, ClassVar, Final, Literal
from urllib.parse import quote_plus, urlencode

from pydantic import AwareDatetime, BaseModel, ConfigDict

from tagger import REPOSITORY_URL
from tagger.core.errors import TaggerError
from tagger.core.paths import app_data_dir
from tagger.core.run_files import PENDING_SUFFIX, purge_stamped, stamped_name, write_atomically
from tagger.reports.extraction import table_row
from tagger.reports.tagging import (
    ReportQuery,
    ReportScores,
    ReportTagValue,
    ReportThresholds,
    TaggingReport,
    TaggingReportCounts,
    TaggingReportTrack,
    format_score,
)
from tagger.resolution.scraper_client import Source
from tagger.run.models import Resolution, TrackFailureReason, TrackState
from tagger.tags.files import TagField

if TYPE_CHECKING:
    from datetime import datetime
    from pathlib import Path

# Formulaire `.github/ISSUE_TEMPLATE/matching-report.yml` et `id` de ses champs, gardes par un
# test qui relit le formulaire. Pas de `labels` dans l'URL : sans le droit de poser un label,
# GitHub rend une 404.
ISSUE_TEMPLATE: Final = "matching-report.yml"
VERSION_FIELD: Final = "version"
SUMMARY_FIELD: Final = "summary"
EXPORT_FIELD: Final = "export"

# `tauri-plugin-opener` ouvre l'URL par la crate `open` 5 (`shellexecute-on-windows`), donc par
# `ShellExecuteExW` (chaine verifiee le 2026-10-16). INTERNET_MAX_URL_LENGTH vaut 2083 dans
# WinINET.h (blog IEInternals, Microsoft, « URL Length Limits ») et Raymond Chen ecrit « around
# 2048 » (The Old New Thing, 2003-12-10) : on garde 2048. GitHub rend 414 des 8192 octets
# (mesure publiee, date non confirmee) : c'est Windows qui borne. Mesure sur l'URL entiere.
MAX_URL_LENGTH: Final = 2048

_HEADER: Final = ("File", "Query", "Route", "Score", "Match")
# Ni decision ni candidat : comptes dans la ligne de tete, jamais listes.
_UNLISTED: Final = frozenset({None, TrackState.ROLLED_BACK})

_SUFFIX: Final = ".json"
# Un temporaire laisse par une ecriture coupee porte le meme contenu : meme retention.
_RETAINED_SUFFIXES: Final = (_SUFFIX, PENDING_SUFFIX)


class FeedbackExportWriteError(TaggerError):
    """Export non ecrit : la preparation echoue, rien ne s'ouvre."""

    code: ClassVar[str] = "feedback_export_write_failed"

    def __init__(self, path: Path) -> None:
        super().__init__(f"feedback export not written: {path.name}", file=path.name)


class _FeedbackModel(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class FeedbackTrack(_FeedbackModel):
    """Liste fermee : un champ ajoute a `TaggingReportTrack` n'en sort pas sans decision.

    Ecartes : `track_id` (chemin relatif, sous-dossiers compris), `artwork_url`, `system` et
    `comment_before`, texte libre de l'utilisateur.
    """

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
    tags_before: tuple[ReportTagValue, ...] | None
    tags_after: tuple[ReportTagValue, ...] | None
    fields_written: tuple[TagField, ...]
    artwork_written: bool


class FeedbackExport(_FeedbackModel):
    """Le run tel qu'il part dans une issue publique : ni `folder` (chemin absolu, compte de
    l'OS) ni `run_id`, que porte deja le nom du fichier. Jamais relu par l'application.
    """

    kind: Literal["matching-feedback"] = "matching-feedback"
    release: str
    generated_at: AwareDatetime
    thresholds: ReportThresholds
    counts: TaggingReportCounts
    tracks: tuple[FeedbackTrack, ...]


def feedback_export(report: TaggingReport, release: str) -> FeedbackExport:
    return FeedbackExport(
        release=release,
        generated_at=report.generated_at,
        thresholds=report.thresholds,
        counts=report.counts,
        tracks=tuple(_export_track(track) for track in report.tracks),
    )


def feedback_dir() -> Path:
    return app_data_dir() / "feedback"


def export_path(folder: Path, report: TaggingReport) -> Path:
    """Meme nom pour le meme run : un nouveau clic reecrit l'export au lieu d'en ajouter un.

    Le nom porte la date du run : l'export d'un run de plus de 30 jours est purge au demarrage
    suivant (accepte le 2026-10-16, il ne sert qu'au glisser-deposer qui suit le clic).
    """
    return folder / stamped_name(report.generated_at, report.run_id, _SUFFIX)


def write_feedback_export(folder: Path, report: TaggingReport, release: str) -> Path:
    """Ecrit l'export, lisible pour etre relu. Leve `FeedbackExportWriteError`."""
    path = export_path(folder, report)
    try:
        write_atomically(path, feedback_export(report, release).model_dump_json(indent=2))
    except (OSError, ValueError) as error:
        # `ValueError` : un nom de fichier Windows invalide en UTF-16 ne se serialise pas.
        raise FeedbackExportWriteError(path) from error
    return path


def purge_feedback_exports(folder: Path, now: datetime) -> None:
    purge_stamped(folder, _RETAINED_SUFFIXES, now, "feedback export not purged")


def _file_name(relative: str) -> str:
    """Nom du fichier seul : un sous-dossier du run peut nommer autre chose qu'un morceau."""
    return PurePosixPath(relative).name


def feedback_issue_url(report: TaggingReport, release: str, export_name: str) -> str:
    """URL de l'Issue Form pre-remplie, au plus `MAX_URL_LENGTH` caracteres une fois encodee.

    Encodage de formulaire (espaces en `+`), le plus court : un caractere sur trois du resume
    est une espace. Le resume vient en dernier, il prend le budget que le reste laisse.
    """
    counts = report.counts
    fixed = {
        "template": ISSUE_TEMPLATE,
        "title": (
            f"Matching report: {counts.written} written, {counts.unresolved} unresolved ({release})"
        ),
        VERSION_FIELD: release,
        EXPORT_FIELD: f"Drop {export_name} here",
    }
    base = f"{REPOSITORY_URL}/issues/new?{urlencode(fixed)}&{SUMMARY_FIELD}="
    return base + _quote(_summary(report, MAX_URL_LENGTH - len(base)))


def _summary(report: TaggingReport, budget: int) -> str:
    """Resume Markdown dont la forme encodee tient dans `budget` caracteres.

    La longueur encodee d'une concatenation est la somme de celles de ses lignes : chacune
    s'encode une fois, et le remplissage s'arrete a la premiere qui ne tient plus, sans caser une
    ligne plus courte apres elle.
    """
    counts = _counts_line(report)
    rows = [_row(track) for track in sorted(_listed(report), key=_rank)]
    if not rows:
        return counts
    head = "\n".join(
        [counts, "", f"| {' | '.join(_HEADER)} |", f"| {' | '.join('---' for _ in _HEADER)} |"]
    )
    costs = [_encoded_length("\n" + row) for row in rows]
    used = _encoded_length(head)
    if used + sum(costs) <= budget:
        return head + "".join("\n" + row for row in rows)
    kept = 0
    for cost in costs:
        if used + cost + _encoded_length(_omitted(len(rows) - kept - 1)) > budget:
            break
        used += cost
        kept += 1
    return head + "".join("\n" + row for row in rows[:kept]) + _omitted(len(rows) - kept)


def _quote(text: str) -> str:
    # `replace` : un nom de fichier Windows peut porter un surrogate isole, que `strict` refuse.
    return quote_plus(text, errors="replace")


def _encoded_length(text: str) -> int:
    return len(_quote(text))


def _omitted(count: int) -> str:
    return f"\n\n_{count} more tracks in the attached export._"


def _counts_line(report: TaggingReport) -> str:
    counts, thresholds = report.counts, report.thresholds
    return (
        f"Written {counts.written}, write errors {counts.write_error}, "
        f"unresolved {counts.unresolved}, rolled back {counts.rolled_back}, "
        f"not processed {counts.not_processed}. "
        f"Thresholds: floor {thresholds.floor:g}, ceiling {thresholds.ceiling:g}."
    )


def _listed(report: TaggingReport) -> list[TaggingReportTrack]:
    return [track for track in report.tracks if track.state not in _UNLISTED]


def _rank(track: TaggingReportTrack) -> tuple[int, float]:
    """Ce qui apprend le plus sur le matching d'abord (l'ecart entre nom de fichier, requete et
    candidat) ; un morceau valide haut la main n'apprend presque rien. Tri stable : a rang egal,
    l'ordre du rapport.
    """
    if track.state is TrackState.UNRESOLVED:
        return (0, 0.0)
    if track.resolution is Resolution.URL:
        return (1, 0.0)
    if track.resolution is Resolution.ARBITRATION:
        return (2, 0.0)
    if track.state is TrackState.WRITE_ERROR:
        return (3, 0.0)
    return (4, 0.0 if track.scores is None else track.scores.average)


def _row(track: TaggingReportTrack) -> str:
    query = "" if track.query is None else f"{_code(track.query.text)} ({track.query.origin})"
    match = _code(" - ".join(part for part in (track.artist, track.title) if part))
    file = _code(_file_name(track.file_before))
    return table_row(file, query, _route(track), format_score(track), match)


def _code(text: str) -> str:
    """Code span : dans une issue publique, `@pseudo` et `#12` y restent inertes.

    Un backtick interne fermerait le span, il devient une apostrophe. `table_row` echappe ensuite
    le `|` et aplatit les retours a la ligne, ce que GFM accepte dans un code span de tableau.
    """
    if not text:
        return ""
    return "`" + text.replace("`", "'") + "`"


def _route(track: TaggingReportTrack) -> str:
    """Voie de resolution puis motif d'echec : c'est lui qui dit pourquoi le morceau a coince."""
    parts = [
        str(part)
        for part in (track.resolution, track.failure_reason)
        if part is not None and part is not Resolution.NONE
    ]
    return ", ".join(parts)


def _export_track(track: TaggingReportTrack) -> FeedbackTrack:
    return FeedbackTrack(
        file_before=_file_name(track.file_before),
        file_after=None if track.file_after is None else _file_name(track.file_after),
        truncated=track.truncated,
        query=track.query,
        source=track.source,
        state=track.state,
        resolution=track.resolution,
        failure_reason=track.failure_reason,
        scores=track.scores,
        artist=track.artist,
        title=track.title,
        url=track.url,
        tags_before=track.tags_before,
        tags_after=track.tags_after,
        fields_written=track.fields_written,
        artwork_written=track.artwork_written,
    )
