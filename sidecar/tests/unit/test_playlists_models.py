"""Tests des modeles internes du parsing de playlists.

Ne figent que les valeurs de conception propres au projet : le reste (frozen,
slots, unicite d'enum, egalite de dataclass...) est de la mecanique du langage
que Python garantit deja (cf. `.claude/rules/pytest/tests.md` § A eviter).
"""

from tagger.playlists.models import PlaylistFormat


class TestPlaylistFormat:
    """Valeurs litterales de l'enum : elles deviendront des cles du protocole
    NDJSON (sub-project 04), une regression ici doit donc etre visible.
    """

    def test_vlc_dump_value(self) -> None:
        assert PlaylistFormat.VLC_DUMP.value == "vlc_dump"

    def test_m3u8_value(self) -> None:
        assert PlaylistFormat.M3U8.value == "m3u8"
