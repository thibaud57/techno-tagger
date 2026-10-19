"""Contenu d'un dossier, trie pour une comparaison stable."""

from pathlib import PurePath
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path


def _is_foreign_temporary(name: str) -> bool:
    """Un `NOM.EXT.tmp` tout en majuscules, que pose un instant un processus exterieur.

    Releve le 2026-10-19 sur un poste Windows muni d'un antivirus et de l'indexeur de recherche
    (lequel, non identifie) : `20261006T211403Z-A3F9C1.JSON.tmp` dans le dossier des dumps, `ADAM
    BEYER - YOUR MIND (EXTENDED MIX).MP3.tmp` dans celui des morceaux. Le sidecar ne les cree pas
    et ils disparaissent a la relecture. Ses `.tmp` remplacent l'extension (`with_suffix`,
    `<horodatage>-<run_id>.tmp`) : la casse seule ne suffit pas, un `run_id` sans lettre rend
    `20261006T211403Z-123456` tout en majuscules.
    """
    stem = name.removesuffix(".tmp")
    return name.endswith(".tmp") and stem.isupper() and PurePath(stem).suffix != ""


def files(folder: Path) -> list[Path]:
    """Enfants directs tries, sans les temporaires d'un processus exterieur ; absent : vide."""
    if not folder.exists():
        return []
    return sorted(path for path in folder.iterdir() if not _is_foreign_temporary(path.name))


def names(folder: Path) -> list[str]:
    return [path.name for path in files(folder)]
