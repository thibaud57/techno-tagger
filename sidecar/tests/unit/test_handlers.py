"""Tests de l'execution des commandes, sans passer par la boucle."""

from typing import TYPE_CHECKING

from tagger import __version__
from tagger.handlers import handle_extract_playlist, handle_get_version, handle_list_playlists
from tagger.protocol import ExtractPlaylist, ListPlaylists, Phase, Progress

if TYPE_CHECKING:
    from pathlib import Path


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
