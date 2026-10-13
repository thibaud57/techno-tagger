"""Renommage tel que l'ecriture le mene, partage par les tests de renommage et de rollback."""

from typing import TYPE_CHECKING, Final

from tagger.tags.renaming import RenamedTrack, plan_rename

if TYPE_CHECKING:
    from pathlib import Path

ORIGINAL_NAME: Final = "01 - untitled.mp3"


def rename_now(path: Path, artist: str | None, title: str | None) -> RenamedTrack:
    """Plan puis application ; un fichier qui garde son nom reste en place."""
    plan = plan_rename(path, artist, title)
    return RenamedTrack(path, truncated=False) if plan is None else plan.apply()
