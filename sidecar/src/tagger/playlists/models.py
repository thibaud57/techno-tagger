"""Modeles internes du parsing de playlists.

Dataclasses et non modeles pydantic : rien ne traverse ici de frontiere externe, la
validation des charges NDJSON appartenant a `protocol.py` (cf.
`.claude/rules/python/modeles-donnees.md`).
"""

from dataclasses import dataclass
from enum import UNIQUE, StrEnum, auto, verify
from typing import NamedTuple


@verify(UNIQUE)
class PlaylistFormat(StrEnum):
    """Formats d'entree acceptes par l'extraction."""

    VLC_DUMP = auto()
    M3U8 = auto()


@dataclass(frozen=True, slots=True)
class PlaylistSummary:
    """Une playlist du dump, telle que le selecteur de l'interface l'affiche."""

    playlist_id: int
    name: str
    track_count: int


class PlaylistListing(NamedTuple):
    """Retour de `list_playlists`, porteur du format qu'elle a deja reconnu."""

    playlist_format: PlaylistFormat
    playlists: tuple[PlaylistSummary, ...]
