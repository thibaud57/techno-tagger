"""Fichiers du rapport de re-tagging, dans le dossier du run."""

from typing import TYPE_CHECKING

from tagger.tagging_report import FILE_STEM, load_tagging_report

if TYPE_CHECKING:
    from pathlib import Path

    from tagger.tagging_report import TaggingReport


def report_files(folder: Path) -> list[Path]:
    """Fichiers du rapport, JSON avant Markdown."""
    return sorted(folder.glob(f"{FILE_STEM}-*"))


def report_json(folder: Path) -> Path:
    """Le JSON unique du dossier ; echoue s'il y en a zero ou plusieurs."""
    (json_path,) = folder.glob(f"{FILE_STEM}-*.json")
    return json_path


def only_report(folder: Path) -> tuple[Path, TaggingReport]:
    """Le JSON unique du dossier et le rapport relu."""
    json_path = report_json(folder)
    return json_path, load_tagging_report(json_path)
