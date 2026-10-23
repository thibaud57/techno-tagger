"""Ce que partagent les rapports d'extraction et de re-tagging."""

import logging
from typing import TYPE_CHECKING, ClassVar, NamedTuple

from tagger.core.errors import TaggerError
from tagger.core.run_files import write_atomically

if TYPE_CHECKING:
    from datetime import datetime
    from pathlib import Path

logger = logging.getLogger(__name__)


class ReportError(TaggerError):
    code: ClassVar[str] = "report_error"


class ReportWriteError(ReportError):
    """Le run a extrait ses fichiers mais son rapport n'a pas pu etre ecrit.

    Pas une `OSError` brute : la boucle NDJSON n'intercepte que `TaggerError`, et un
    disque plein doit donner un evenement `error`, pas un sidecar mort.
    """

    code: ClassVar[str] = "report_write_failed"

    def __init__(self, path: Path) -> None:
        super().__init__(f"cannot write report: {path.name}", filename=path.name)


class ReportPaths(NamedTuple):
    """Chemins des deux fichiers ecrits (le JSON remonte a l'interface)."""

    json_path: Path
    markdown_path: Path


def unused_report_paths(folder: Path, file_stem: str, stamp: str) -> ReportPaths:
    """Suffixe `-2`, `-3`... si ce couple horodate existe deja.

    L'horodatage est a la seconde : un run sans rien a extraire dure quelques millisecondes
    et, relance aussitot, ecraserait le rapport du premier.
    """
    stem, attempt = f"{file_stem}-{stamp}", 1
    while (folder / f"{stem}.json").exists() or (folder / f"{stem}.md").exists():
        attempt += 1
        stem = f"{file_stem}-{stamp}-{attempt}"

    return ReportPaths(json_path=folder / f"{stem}.json", markdown_path=folder / f"{stem}.md")


def format_instant(instant: datetime) -> str:
    """ISO 8601 UTC suffixe `Z`, comme le JSON de pydantic : les deux rapports concordent."""
    return instant.strftime("%Y-%m-%dT%H:%M:%SZ")


def escape_markdown(value: object) -> str:
    """Neutralise ce qui casserait le Markdown dans une valeur venue de la playlist source
    (un nom introuvable n'est jamais confronte a un chemin reel : `|` et retour ligne possibles).

    `splitlines()` plutot que des `replace` : il couvre aussi le `\\r` seul, que Markdown
    traite comme un saut de ligne.
    """
    return " ".join(str(value).replace("|", "\\|").splitlines())


def table_section(title: str, header: tuple[str, ...], rows: list[str]) -> list[str]:
    """Section en tableau, ou rien si la categorie est vide."""
    if not rows:
        return []

    separator = " | ".join("---" for _ in header)
    return ["", f"## {title}", "", f"| {' | '.join(header)} |", f"| {separator} |", *rows]


def table_row(*cells: object) -> str:
    """Ligne de tableau de valeurs brutes echappees, pour que les cellules suivent le header."""
    return f"| {' | '.join(escape_markdown(cell) for cell in cells)} |"


def write_report_pair(paths: ReportPaths, json_text: str, markdown_text: str) -> None:
    """Ecrit le JSON puis le Markdown, chacun atomiquement, l'erreur nommant le fichier refuse.

    Leve `ReportWriteError`. Le JSON reste sur le disque quand le Markdown echoue : la
    trace le nomme, en texte libre, aucune cle du jeu logfmt fixe ne portant un fichier.
    """
    _write_report_file(paths.json_path, json_text)
    try:
        _write_report_file(paths.markdown_path, markdown_text)
    except ReportWriteError:
        logger.warning("json report orphaned by a failed markdown write: %s", paths.json_path.name)
        raise


def _write_report_file(path: Path, content: str) -> None:
    try:
        write_atomically(path, content)
    except OSError as error:
        raise ReportWriteError(path) from error
