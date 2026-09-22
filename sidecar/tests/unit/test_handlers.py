"""Tests de l'execution des commandes, sans passer par la boucle."""

from typing import TYPE_CHECKING

import pytest
from pydantic import ValidationError

from tagger import __version__
from tagger.api_key import SERVICE, USERNAME
from tagger.cache import resolve_host
from tagger.handlers import (
    handle_extract_playlist,
    handle_get_version,
    handle_list_playlists,
    handle_set_api_key,
    tagging_transports,
)
from tagger.protocol import ExtractPlaylist, ListPlaylists, Phase, Progress, SetApiKey

if TYPE_CHECKING:
    from pathlib import Path

    from memory_keyring import MemoryKeyring


def extract_command(library: Path, dump: Path, destination: Path) -> ExtractPlaylist:
    """Commande `extract_playlist` sur la playlist de test du dump."""
    return ExtractPlaylist(
        command="extract_playlist",
        source_folder=library,
        destination_folder=destination,
        playlist_path=dump,
        playlist_name="test playlist",
    )


def test_reports_the_sidecar_version() -> None:
    """Version nue, pas `RELEASE` : l'interface la compare a `APP_VERSION`."""
    event = handle_get_version()

    assert event.version == __version__
    assert isinstance(event.api_key_configured, bool)


def test_lists_the_playlists_of_a_dump(vlc_dump: Path) -> None:
    event = handle_list_playlists(ListPlaylists(command="list_playlists", playlist_path=vlc_dump))

    assert [entry.name for entry in event.playlists]
    assert all(entry.track_count >= 0 for entry in event.playlists)


def test_extracts_and_writes_a_report(vlc_dump: Path, music_library: Path, tmp_path: Path) -> None:
    command = extract_command(music_library, vlc_dump, tmp_path / "work")

    event = handle_extract_playlist(command, lambda _: None)

    assert event.report_path.is_file()


def test_emits_progress_for_every_track(
    vlc_dump: Path, music_library: Path, tmp_path: Path
) -> None:
    seen: list[Progress] = []
    command = extract_command(music_library, vlc_dump, tmp_path / "work")

    handle_extract_playlist(command, seen.append)

    assert seen
    assert all(event.phase is Phase.EXTRACTION for event in seen)
    assert seen[-1].processed == seen[-1].total


def test_carries_the_five_categories(vlc_dump: Path, music_library: Path, tmp_path: Path) -> None:
    command = extract_command(music_library, vlc_dump, tmp_path / "work")

    event = handle_extract_playlist(command, lambda _: None)

    assert isinstance(event.extracted, tuple)
    assert isinstance(event.already_present, tuple)
    assert isinstance(event.missing, tuple)
    assert isinstance(event.duplicates, tuple)
    assert isinstance(event.failures, tuple)


def test_reports_whether_an_api_key_is_configured(memory_keyring: MemoryKeyring) -> None:
    memory_keyring.secrets[(SERVICE, USERNAME)] = "k3y-t0k3n"

    event = handle_get_version()

    assert event.api_key_configured is True


def test_answers_set_api_key_with_a_version_that_reports_the_key(
    memory_keyring: MemoryKeyring,
) -> None:
    command = SetApiKey(command="set_api_key", api_key="k3y-t0k3n")

    event = handle_set_api_key(command)

    assert event.event == "version"
    assert event.api_key_configured is True
    assert memory_keyring.secrets[(SERVICE, USERNAME)] == "k3y-t0k3n"


@pytest.mark.parametrize(
    "api_key", ["", "k3y t0k3n", "clé", "x" * 2561], ids=["empty", "space", "non-ascii", "too-long"]
)
def test_rejects_an_api_key_out_of_format(api_key: str) -> None:
    with pytest.raises(ValidationError):
        SetApiKey(command="set_api_key", api_key=api_key)


def test_never_shows_the_api_key_in_the_command_repr() -> None:
    command = SetApiKey(command="set_api_key", api_key="k3y-t0k3n")

    shown = repr(command)

    assert "k3y-t0k3n" not in shown


def test_leaves_the_tagging_transports_to_the_real_network() -> None:
    """Les tests remplacent ce seam en entier : sans ce garde, un resolveur factice
    pose en production ne ferait rien echouer.
    """
    transports = tagging_transports()

    assert transports.api is None
    assert transports.cdn is None
    assert transports.resolve is resolve_host
