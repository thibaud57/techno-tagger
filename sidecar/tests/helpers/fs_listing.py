"""Contenu d'un dossier, trie pour une comparaison stable."""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path


def _is_foreign_temporary(name: str) -> bool:
    """Un `NOM.EXT.tmp` tout en majuscules, que pose un instant un processus exterieur.

    Releve le 2026-10-19 sur un poste Windows muni d'un antivirus et de l'indexeur de recherche,
    sans identifier lequel : `20261006T211403Z-A3F9C1.JSON.tmp` dans le dossier des dumps, `ADAM
    BEYER - YOUR MIND (EXTENDED MIX).MP3.tmp` dans celui des morceaux. Aucune operation du
    sidecar ne les cree et ils ont disparu quand le dossier est relu. Les `.tmp` du code sont en
    minuscules (`<horodatage>-<run_id>.tmp`) : un vrai reste ne passe pas ce filtre.
    """
    return name.endswith(".tmp") and name.removesuffix(".tmp").isupper()


def files(folder: Path) -> list[Path]:
    """Enfants directs tries, sans les temporaires d'un processus exterieur ; absent : vide."""
    if not folder.exists():
        return []
    return sorted(path for path in folder.iterdir() if not _is_foreign_temporary(path.name))


def names(folder: Path) -> list[str]:
    return [path.name for path in files(folder)]
