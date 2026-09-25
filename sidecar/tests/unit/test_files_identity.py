"""Tests de la lecture de l'artiste et du titre, sur les quatre formats."""

from typing import TYPE_CHECKING

import mutagen
import pytest
from audio_samples import tag, write_tagged_wavpack
from mutagen import MutagenError

from tagger.files import IdentityTags, TagsUnreadableError, UnreadableReason, read_identity

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path


@pytest.mark.parametrize(
    "audio_format",
    ["mp3", "wav", "aiff", "flac"],
    ids=["id3-mp3", "id3-wav", "id3-aiff", "vorbis-flac"],
)
def test_reads_artist_and_title_from_the_tags(
    blank_audio: Callable[[str], Path], audio_format: str
) -> None:
    path = blank_audio(audio_format)
    tag(path, artist=["Adam Beyer"], title=["Your Mind"])

    identity = read_identity(path)

    assert identity == IdentityTags(artist="Adam Beyer", title="Your Mind")


@pytest.mark.parametrize("audio_format", ["mp3", "flac"], ids=["id3", "vorbis"])
def test_joins_multiple_artist_values_with_a_comma(
    blank_audio: Callable[[str], Path], audio_format: str
) -> None:
    path = blank_audio(audio_format)
    tag(path, artist=["Adam Beyer", "Bart Skils"], title=["Your Mind"])

    identity = read_identity(path)

    assert identity.artist == "Adam Beyer, Bart Skils"


def test_strips_blanks_and_drops_empty_values(blank_audio: Callable[[str], Path]) -> None:
    path = blank_audio("flac")
    tag(path, artist=[" Adam Beyer ", "", "  "], title=["  Your Mind"])

    identity = read_identity(path)

    assert identity == IdentityTags(artist="Adam Beyer", title="Your Mind")


@pytest.mark.parametrize("audio_format", ["mp3", "wav", "aiff", "flac"])
def test_returns_an_empty_identity_for_a_file_without_tags(
    blank_audio: Callable[[str], Path], audio_format: str
) -> None:
    path = blank_audio(audio_format)

    identity = read_identity(path)

    assert identity == IdentityTags(artist="", title="")


def test_raises_unreadable_when_the_content_matches_no_format(tmp_path: Path) -> None:
    path = tmp_path / "broken.mp3"
    path.write_bytes(b"not an audio file" * 16)

    with pytest.raises(TagsUnreadableError, match="unreadable tags") as error:
        read_identity(path)

    assert error.value.reason is UnreadableReason.UNREADABLE
    assert error.value.params == {"file": "broken.mp3", "reason": UnreadableReason.UNREADABLE}


def test_raises_unreadable_when_mutagen_identifies_no_format_at_all(tmp_path: Path) -> None:
    """`read_identity` est appelable hors du filtre de `list_audio_files` : un contenu
    que mutagen ne rattache a aucun format rend `unreadable`, il ne plante pas.
    """
    path = tmp_path / "notes.txt"
    path.write_bytes(b"not an audio file" * 16)

    with pytest.raises(TagsUnreadableError, match="unreadable tags") as error:
        read_identity(path)

    assert error.value.reason is UnreadableReason.UNREADABLE


def test_raises_unreadable_when_the_container_is_not_one_of_the_four_formats(
    tmp_path: Path,
) -> None:
    """Un WavPack sous extension `.wav` passe le filtre de `list_audio_files` : ses
    tags APEv2 existent sans que nous sachions les lire, il ne doit pas passer pour
    un fichier non tague.
    """
    path = write_tagged_wavpack(tmp_path / "track.wav")

    with pytest.raises(TagsUnreadableError, match="unreadable tags") as error:
        read_identity(path)

    assert error.value.reason is UnreadableReason.UNREADABLE


def test_raises_locked_when_the_read_fails_on_a_permission_error(
    blank_audio: Callable[[str], Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    path = blank_audio("mp3")

    def locked_file(_path: Path) -> None:
        raise MutagenError("file in use") from PermissionError(13, "Permission denied")

    monkeypatch.setattr(mutagen, "File", locked_file)

    with pytest.raises(TagsUnreadableError, match="unreadable tags") as error:
        read_identity(path)

    assert error.value.reason is UnreadableReason.LOCKED


@pytest.mark.parametrize("audio_format", ["mp3", "wav", "aiff", "flac"])
def test_leaves_the_file_bytes_unchanged_after_reading(
    blank_audio: Callable[[str], Path], audio_format: str
) -> None:
    path = blank_audio(audio_format)
    tag(path, artist=["Sara Landry"], title=["The Void"])
    before = path.read_bytes()

    read_identity(path)

    assert path.read_bytes() == before
