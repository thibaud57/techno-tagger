"""Contenu d'un dossier, trie pour une comparaison stable."""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path


def files(folder: Path) -> list[Path]:
    """Enfants directs tries ; un dossier absent est vide."""
    return sorted(folder.iterdir()) if folder.exists() else []


def names(folder: Path) -> list[str]:
    return [path.name for path in files(folder)]
