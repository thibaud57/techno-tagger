"""Rapports de run, ecrits dans le dossier destination.

Deux rapports distincts existent dans le projet, celui de l'extraction et celui du
re-tagging, chacun en JSON et en Markdown, tous deux en anglais quelle que soit la
langue de l'interface (cf. ARCHITECTURE.md § Donnees).

Le JSON porte un champ de version des sa premiere version : l'ajouter apres coup
laisserait une generation de rapports non identifiables, precisement le cas que le
mecanisme doit eviter (ADR-018). Aucune migration n'est ecrite tant qu'il n'existe
qu'une version, une migration sans version d'origine n'etant ni exercable ni
testable. Le Markdown, lui, n'est pas versionne : c'est un rendu, jamais relu par
l'application, regenerable depuis le JSON.
"""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, ClassVar, Final, Literal, NamedTuple

from pydantic import BaseModel

from tagger.errors import TaggerError
from tagger.extraction import DuplicateCriterion, ExtractionFailureReason, ExtractionMode

if TYPE_CHECKING:
    from tagger.extraction import ExtractionResult

logger = logging.getLogger(__name__)

SCHEMA_VERSION: Final = 1
REPORT_KIND: Final = "extraction"
FILE_STEM: Final = "extraction-report"
# Jamais `isoformat()` dans un nom de fichier : ses `:` sont interdits sous Windows.
TIMESTAMP_FORMAT: Final = "%Y%m%dT%H%M%SZ"


class ReportError(TaggerError):
    """Base des erreurs de rapport, comme `ExtractionError` et `PlaylistError`
    le sont pour leur propre domaine."""

    code: ClassVar[str] = "report_error"


class ReportWriteError(ReportError):
    """Le run a extrait ses fichiers mais son rapport n'a pas pu etre ecrit.

    Erreur metier et non `OSError` brute : la boucle NDJSON du sub-project 04
    n'intercepte que `TaggerError`, et un disque plein doit produire un evenement
    `error`, jamais un sidecar mort en silence.
    """

    code: ClassVar[str] = "report_write_failed"

    def __init__(self, path: Path) -> None:
        super().__init__(f"cannot write report: {path.name}", filename=path.name)


@dataclass(frozen=True, slots=True)
class ReportContext:
    """Ce qu'un rapport dit du run, en plus de son resultat.

    `playlist_name` vaut `None` pour un M3U8, qui ne contient qu'une playlist et
    n'en fait donc jamais choisir. `generated_at` est normalise en UTC a la
    construction : un aware dans un autre fuseau mentirait dans le stamp du nom de
    fichier (litteralement suffixe `Z`). Un naive est refuse plutot que
    reinterprete : `astimezone` le prendrait silencieusement pour l'heure locale de
    la machine hote.
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


class DiscardedEntry(BaseModel):
    """Homonyme ecarte, avec de quoi le retrouver a la main."""

    path: Path
    size: int


class DuplicateEntry(BaseModel):
    """Choix automatique entre homonymes, rendu verifiable (ADR-020)."""

    file_name: str
    kept_path: Path
    kept_size: int
    criterion: DuplicateCriterion
    discarded: tuple[DiscardedEntry, ...]


class FailureEntry(BaseModel):
    """Morceau trouve mais non transfere, et pourquoi."""

    file_name: str
    reason: ExtractionFailureReason


class ReportCounts(BaseModel):
    """Decomptes des cinq categories, lus sans parcourir les listes."""

    extracted: int
    already_present: int
    missing: int
    duplicates: int
    failures: int


class PlaylistRef(BaseModel):
    """Playlist du run. `name` vaut `None` pour un M3U8, qui n'en contient qu'une."""

    path: Path
    name: str | None


class ExtractionReport(BaseModel):
    """Rapport d'extraction, tel qu'il est ecrit sur le disque.

    `BaseModel` et non un `dict` serialise a la main : le rapport franchit une
    frontiere et il est permanent, donc relu par une version ulterieure de
    l'application. C'est ce modele qui portera la migration d'un `schema_version`
    anterieur, dans un `@model_validator(mode="before")` (ADR-018).
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
    """Assemble le rapport depuis le resultat d'extraction et le contexte du run."""
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
        duplicates=tuple(
            DuplicateEntry(
                file_name=duplicate.file_name,
                kept_path=duplicate.kept_path,
                kept_size=duplicate.kept_size,
                criterion=duplicate.criterion,
                discarded=tuple(
                    DiscardedEntry(path=candidate.path, size=candidate.size)
                    for candidate in duplicate.discarded
                ),
            )
            for duplicate in result.duplicates
        ),
        failures=tuple(
            FailureEntry(file_name=failure.file_name, reason=failure.reason)
            for failure in result.failures
        ),
    )


def render_json(result: ExtractionResult, context: ReportContext) -> str:
    """Rend le rapport JSON, destine a etre relu par l'application.

    `model_dump_json` garde les titres non-ASCII lisibles sans echappement, rend les
    `Path` en chaines et suit l'ordre de declaration des champs, ce qui rend deux
    rendus du meme resultat identiques. L'indentation est admise : la regle qui
    l'interdit vise le flux NDJSON, ou une ligne vaut un evenement.
    """
    return _render_json(build_report(result, context))


def _render_json(report: ExtractionReport) -> str:
    return report.model_dump_json(indent=2)


def render_markdown(result: ExtractionResult, context: ReportContext) -> str:
    """Rend le rapport lisible, en anglais.

    Construit sur le meme `ExtractionReport` que `render_json` : les decomptes et
    les listes viennent d'une unique passe sur `result`, jamais recalcules ici, pour
    qu'un changement de definition d'un decompte ne puisse pas desynchroniser les
    deux rendus. Une categorie sans contenu est omise : une section vide n'apprend
    rien, le tableau de synthese portant deja les cinq decomptes.
    """
    return _render_markdown(build_report(result, context))


def _render_markdown(report: ExtractionReport) -> str:
    counts = report.counts
    lines = [
        "# Extraction report",
        "",
        f"- Generated at: {_format_instant(report.generated_at)}",
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
    ]

    lines += _bullet_section("Extracted", report.extracted)
    lines += _bullet_section("Already present", report.already_present)
    lines += _bullet_section("Missing", report.missing)

    lines += _table_section(
        "Duplicates resolved",
        ("File", "Kept", "Size", "Criterion", "Discarded"),
        [
            _table_row(
                duplicate.file_name,
                duplicate.kept_path,
                duplicate.kept_size,
                duplicate.criterion,
                "; ".join(f"{item.path} ({item.size})" for item in duplicate.discarded),
            )
            for duplicate in report.duplicates
        ],
    )
    lines += _table_section(
        "Failures",
        ("File", "Reason"),
        [_table_row(failure.file_name, failure.reason) for failure in report.failures],
    )

    return "\n".join(lines) + "\n"


def _format_instant(instant: datetime) -> str:
    """ISO 8601 UTC suffixe `Z`, identique au rendu JSON de pydantic : les deux
    rapports d'un meme run doivent porter le meme horodatage a la lettre pres."""
    return instant.strftime("%Y-%m-%dT%H:%M:%SZ")


def _format_playlist(playlist: PlaylistRef) -> str:
    """Affiche le chemin complet, seul identifiant fiable de deux bibliotheques
    homonymes ; le nom est ajoute entre parentheses quand il existe. `is not None`
    et non une verite : un nom vide (playlist VLC sans nom, jamais NULL en base)
    ne doit pas se confondre avec l'absence de nom d'un M3U8.
    """
    if playlist.name is not None:
        return f"{playlist.name} ({playlist.path})"
    return str(playlist.path)


def _escape_markdown(value: object) -> str:
    """Neutralise ce qui casserait la structure Markdown dans une valeur venue de
    la playlist source : un nom introuvable n'est jamais confronte a un chemin
    Windows reel, rien ne garantit donc l'absence d'un `|` ou d'un retour ligne.
    """
    return str(value).replace("|", "\\|").replace("\r\n", " ").replace("\n", " ")


def _bullet_section(title: str, entries: tuple[str, ...]) -> list[str]:
    """Rend une section a puces, ou rien du tout si la categorie est vide."""
    if not entries:
        return []

    return ["", f"## {title}", "", *(f"- {_escape_markdown(entry)}" for entry in entries)]


def _table_section(title: str, header: tuple[str, ...], rows: list[str]) -> list[str]:
    """Rend une section en tableau, ou rien du tout si la categorie est vide."""
    if not rows:
        return []

    separator = " | ".join("---" for _ in header)
    return ["", f"## {title}", "", f"| {' | '.join(header)} |", f"| {separator} |", *rows]


def _table_row(*cells: object) -> str:
    """Assemble une ligne de tableau a partir des valeurs brutes : une cellule par
    colonne du header, jamais assemblees a la main au point d'appel, pour que les
    deux ne puissent pas diverger en nombre.
    """
    return f"| {' | '.join(_escape_markdown(cell) for cell in cells)} |"


class ReportPaths(NamedTuple):
    """Chemins des deux fichiers ecrits. Le JSON remonte a l'interface par
    l'evenement `extraction_finished`.
    """

    json_path: Path
    markdown_path: Path


def write_extraction_report(result: ExtractionResult, context: ReportContext) -> ReportPaths:
    """Depose le rapport dans le dossier destination et rend les deux chemins.

    Un couple de fichiers par run, horodate : le rapport est permanent et sert de
    base a la relecture d'un run passe (ADR-018), un nom fixe ecraserait donc
    exactement ce qu'il protege.

    Leve `ReportWriteError` si le disque refuse, en nommant le fichier ou le
    dossier reellement en cause : les morceaux sont deja extraits, seul le rapport
    manque, et l'appelant doit pouvoir dire ce qui a echoue.
    """
    stamp = context.generated_at.strftime(TIMESTAMP_FORMAT)
    json_path = context.destination_folder / f"{FILE_STEM}-{stamp}.json"
    markdown_path = context.destination_folder / f"{FILE_STEM}-{stamp}.md"

    try:
        context.destination_folder.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise ReportWriteError(context.destination_folder) from error

    # Construit une seule fois : `render_json`/`render_markdown` en repartiraient
    # chacun de zero, doublant la validation pydantic du rapport pour un run.
    report = build_report(result, context)
    _write_report_file(json_path, _render_json(report))
    try:
        _write_report_file(markdown_path, _render_markdown(report))
    except ReportWriteError:
        # Le JSON est deja durablement sur le disque (ADR-018) : sans cette trace,
        # rien ne le rattache plus au run qui l'a produit une fois l'erreur remontee.
        logger.warning("json report orphaned by a failed markdown write report=%s", json_path.name)
        raise

    return ReportPaths(json_path=json_path, markdown_path=markdown_path)


def _write_report_file(path: Path, content: str) -> None:
    """Ecrit un fichier de rapport, l'erreur nommant ce fichier et non l'autre."""
    try:
        path.write_text(content, encoding="utf-8")
    except OSError as error:
        raise ReportWriteError(path) from error
