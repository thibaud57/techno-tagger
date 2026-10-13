"""Registre local des rapports de re-tagging : les rapports vivent dans les dossiers de musique,
seul ce fichier dit ou les retrouver pour rouvrir un run passe.

Jamais purge : il suit des livrables permanents. Absent, corrompu ou d'une autre version, il se
lit vide et repart de zero, les rapports restant dans leurs dossiers. Un fichier que le systeme
refuse de lire n'est en revanche jamais reecrit : son contenu n'est pas en cause.
"""

import logging
from pathlib import Path
from typing import Final

from pydantic import AwareDatetime, BaseModel, ConfigDict, ValidationError

from tagger.core.paths import app_data_dir
from tagger.core.run_files import write_atomically

logger = logging.getLogger(__name__)

SCHEMA_VERSION: Final = 1


class IndexEntry(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    run_id: str
    written_at: AwareDatetime
    folder: Path
    report_path: Path


class ReportIndex(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    schema_version: int = SCHEMA_VERSION
    entries: tuple[IndexEntry, ...] = ()


def index_path() -> Path:
    return app_data_dir() / "reports.json"


def record_report(index: Path, entry: IndexEntry) -> None:
    """Inscrit le rapport d'un run ; une reecriture du meme run remplace son entree.

    Un registre qui n'a pas pu etre lu n'est pas reecrit : l'ecraser par une seule entree
    perdrait un historique intact.
    """
    known = _read(index)
    if known is None:
        return
    kept = tuple(item for item in known.entries if item.run_id != entry.run_id)
    updated = ReportIndex(entries=(*kept, entry))
    try:
        write_atomically(index, updated.model_dump_json(indent=2))
    except OSError as error:
        logger.error(  # noqa: TRY400  (une trace porterait le chemin complet)
            "report index not written run=%s reason=write_failed errno=%s",
            entry.run_id,
            error.errno,
        )


def list_reports(index: Path) -> tuple[IndexEntry, ...]:
    """Du plus recent au plus ancien ; un rapport deplace ou supprime n'est plus propose."""
    known = _read(index)
    if known is None:
        return ()
    entries = (entry for entry in known.entries if entry.report_path.is_file())
    return tuple(sorted(entries, key=lambda entry: entry.written_at, reverse=True))


def _read(index: Path) -> ReportIndex | None:
    """`None` : le systeme refuse de lire le fichier, sans que son contenu soit en cause."""
    try:
        content = index.read_bytes()
    except FileNotFoundError:
        return ReportIndex()
    except OSError:
        logger.warning("report index not read reason=read_failed")
        return None
    try:
        parsed = ReportIndex.model_validate_json(content)
    except ValidationError:
        parsed = None
    if parsed is None or parsed.schema_version != SCHEMA_VERSION:
        logger.error("report index unreadable reason=unreadable")
        return ReportIndex()
    return parsed
