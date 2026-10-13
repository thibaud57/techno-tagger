"""Tests des modeles internes du parsing de playlists.

Ne figent que les valeurs de conception propres au projet : le reste (frozen,
slots, unicite d'enum, egalite de dataclass...) est de la mecanique du langage
que Python garantit deja (cf. `.claude/rules/pytest/tests.md` § A eviter).
"""

import pytest

from tagger.playlists.models import PlaylistFormat


@pytest.mark.parametrize(
    ("playlist_format", "value"),
    [(PlaylistFormat.VLC_DUMP, "vlc_dump"), (PlaylistFormat.M3U8, "m3u8")],
    ids=["vlc-dump", "m3u8"],
)
def test_format_values_are_the_protocol_keys(playlist_format: PlaylistFormat, value: str) -> None:
    """Valeurs litterales de l'enum : elles sont des cles du protocole NDJSON, une
    regression ici doit donc etre visible.
    """
    assert playlist_format.value == value
