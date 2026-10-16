"""Cache disque rempli et relu, pour les tests de mesure et de vidage."""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path


def fill_cache(root: Path) -> int:
    """Une reponse (10 octets) et une pochette (20) : la somme prouve les deux dossiers.

    Rend la taille totale ecrite.
    """
    (root / "responses").mkdir(parents=True)
    (root / "artworks").mkdir()
    return (root / "responses" / "a.json").write_bytes(b"r" * 10) + (
        root / "artworks" / "b.jpg"
    ).write_bytes(b"p" * 20)


def cached_files(root: Path) -> list[Path]:
    return sorted(path for path in root.rglob("*") if path.is_file())
