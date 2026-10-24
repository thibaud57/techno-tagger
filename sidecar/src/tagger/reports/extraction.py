"""Rapport d'extraction, ecrit dans le dossier destination en JSON et en Markdown, tous
deux en anglais quelle que soit la langue de l'interface (ARCHITECTURE.md § Donnees).

Le JSON porte un champ de version des la premiere version : l'ajouter apres coup laisserait
des rapports non identifiables (ADR-018). Pas de migration tant qu'il n'existe qu'une version.
Le Markdown n'est pas versionne : rendu regenerable depuis le JSON, jamais relu.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Final, Literal

from tagger.core.file_failures import FileFailureReason
from tagger.core.models import StrictFrozenModel
from tagger.core.run_files import TIMESTAMP_FORMAT
from tagger.playlists.extraction import DuplicateCriterion, ExtractionMode
from tagger.reports.common import (
    ReportPaths,
    ReportWriteError,
    escape_markdown,
    format_instant,
    table_row,
    table_section,
    unused_report_paths,
    write_report_pair,
)

if TYPE_CHECKING:
    from tagger.playlists.extraction import ExtractionResult

SCHEMA_VERSION: Final = 1
REPORT_KIND: Final = "extraction"
FILE_STEM: Final = "extraction-report"


@dataclass(frozen=True, slots=True, kw_only=True)
class ReportContext:
    """Ce qu'un rapport dit du run, en plus de son resultat.

    `playlist_name` vaut `None` pour un M3U8. `generated_at` est normalise en UTC : le stamp
    du nom de fichier est suffixe `Z`. Un naive est refuse, `astimezone` le prendrait pour
    l'heure locale de la machine.
    """

    source_folder: Path
    destination_folder: Path
    playlist_path: Path
    playlist_name: str | None
    mode: ExtractionMode
    generated_at: datetime

    def __post_init__(self) -> None:
        if self.generated_at.tzinfo is None:
            raise ValueError("generated_at must be timezone-aware")
        object.__setattr__(self, "generated_at", self.generated_at.astimezone(UTC))


class DiscardedEntry(StrictFrozenModel):
    """Homonyme ecarte, avec de quoi le retrouver a la main."""

    path: Path
    size: int


class DuplicateEntry(StrictFrozenModel):
    """Choix automatique entre homonymes, rendu verifiable (ADR-020)."""

    file_name: str
    kept_path: Path
    kept_size: int
    criterion: DuplicateCriterion
    discarded: tuple[DiscardedEntry, ...]


class FailureEntry(StrictFrozenModel):
    """Morceau trouve mais non transfere, avec le motif."""

    file_name: str
    reason: FileFailureReason


class ReportCounts(StrictFrozenModel):
    """Decomptes des categories, lus sans parcourir les listes."""

    extracted: int
    already_present: int
    missing: int
    duplicates: int
    failures: int


class PlaylistRef(StrictFrozenModel):
    """Playlist du run. `name` vaut `None` pour un M3U8, qui n'en contient qu'une."""

    path: Path
    name: str | None


class ExtractionReport(StrictFrozenModel):
    """Rapport d'extraction, tel qu'il est ecrit sur le disque.

    Un modele et non un `dict` : le rapport est permanent, relu par une version ulterieure.
    Il portera la migration d'un `schema_version` anterieur, dans un
    `@model_validator(mode="before")`.
    """

    schema_version: int = SCHEMA_VERSION
    kind: Literal["extraction"] = REPORT_KIND
    generated_at: datetime
    source_folder: Path
    destination_folder: Path
    playlist: PlaylistRef
    mode: ExtractionMode
    counts: ReportCounts
    extracted: tuple[str, ...]
    already_present: tuple[str, ...]
    missing: tuple[str, ...]
    duplicates: tuple[DuplicateEntry, ...]
    failures: tuple[FailureEntry, ...]


def build_report(result: ExtractionResult, context: ReportContext) -> ExtractionReport:
    return ExtractionReport(
        generated_at=context.generated_at,
        source_folder=context.source_folder,
        destination_folder=context.destination_folder,
        playlist=PlaylistRef(path=context.playlist_path, name=context.playlist_name),
        mode=context.mode,
        counts=ReportCounts(
            extracted=len(result.extracted),
            already_present=len(result.already_present),
            missing=len(result.missing),
            duplicates=len(result.duplicates),
            failures=len(result.failures),
        ),
        extracted=result.extracted,
        already_present=result.already_present,
        missing=result.missing,
        # Meme recopie que `extraction_finished`, dont les schemas evoluent separement.
        duplicates=tuple(
            DuplicateEntry.model_validate(duplicate, from_attributes=True)
            for duplicate in result.duplicates
        ),
        failures=tuple(
            FailureEntry.model_validate(failure, from_attributes=True)
            for failure in result.failures
        ),
    )


def render_markdown(report: ExtractionReport) -> str:
    """Rapport lisible, en anglais.

    Rendu du meme `ExtractionReport` que le JSON : decomptes et listes ne sont jamais
    recalcules ici, sinon les deux rendus pourraient diverger. Une categorie vide est omise,
    le tableau de synthese portant les decomptes.
    """
    counts = report.counts
    lines = [
        "# Extraction report",
        "",
        f"- Generated at: {format_instant(report.generated_at)}",
        f"- Source folder: {report.source_folder}",
        f"- Destination folder: {report.destination_folder}",
        f"- Playlist: {_format_playlist(report.playlist)}",
        f"- Mode: {report.mode}",
        "",
        "## Summary",
        "",
        "| Category | Count |",
        "| --- | --- |",
        f"| Extracted | {counts.extracted} |",
        f"| Already present | {counts.already_present} |",
        f"| Missing | {counts.missing} |",
        f"| Duplicates resolved | {counts.duplicates} |",
        f"| Failures | {counts.failures} |",
        *_bullet_section("Extracted", report.extracted),
        *_bullet_section("Already present", report.already_present),
        *_bullet_section("Missing", report.missing),
        *table_section(
            "Duplicates resolved",
            ("File", "Kept", "Size", "Criterion", "Discarded"),
            [
                table_row(
                    duplicate.file_name,
                    duplicate.kept_path,
                    duplicate.kept_size,
                    duplicate.criterion,
                    "; ".join(f"{item.path} ({item.size})" for item in duplicate.discarded),
                )
                for duplicate in report.duplicates
            ],
        ),
        *table_section(
            "Failures",
            ("File", "Reason"),
            [table_row(failure.file_name, failure.reason) for failure in report.failures],
        ),
    ]

    return "\n".join(lines) + "\n"


def _format_playlist(playlist: PlaylistRef) -> str:
    """Nom quand il existe, suivi du chemin complet (seul identifiant fiable de deux
    bibliotheques homonymes). `is not None` et non une verite : un nom vide (playlist VLC
    sans nom, jamais NULL en base) ne se confond pas avec l'absence de nom d'un M3U8.
    """
    if playlist.name is not None:
        return f"{playlist.name} ({playlist.path})"
    return str(playlist.path)


def _bullet_section(title: str, entries: tuple[str, ...]) -> list[str]:
    """Section a puces, ou rien si la categorie est vide."""
    if not entries:
        return []

    return ["", f"## {title}", "", *(f"- {escape_markdown(entry)}" for entry in entries)]


def write_extraction_report(result: ExtractionResult, context: ReportContext) -> ReportPaths:
    """Depose le rapport dans le dossier destination et rend les deux chemins.

    Couple horodate par run : le rapport est permanent, un nom fixe ecraserait le precedent.

    Leve `ReportWriteError` en nommant le fichier ou le dossier en cause : les morceaux sont
    deja extraits, seul le rapport manque.
    """
    paths = unused_report_paths(
        context.destination_folder, FILE_STEM, context.generated_at.strftime(TIMESTAMP_FORMAT)
    )

    try:
        context.destination_folder.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise ReportWriteError(context.destination_folder) from error

    # Construit une seule fois : un rendu chacun doublerait la validation pydantic.
    report = build_report(result, context)
    write_report_pair(paths, report.model_dump_json(indent=2), render_markdown(report))

    return paths
