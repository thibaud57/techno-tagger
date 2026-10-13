"""Tests de la lecture de l'artiste et du titre, sur les quatre formats."""

import stat
from typing import TYPE_CHECKING

import mutagen
import pytest
from audio_samples import tag, write_not_audio, write_tagged_wavpack
from mutagen import MutagenError

from tagger.core.file_failures import FileFailureReason
from tagger.tags.files import IdentityTags, TagsUnreadableError, read_shown_tags

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

    identity = read_shown_tags(path).identity

    assert identity == IdentityTags(artist="Adam Beyer", title="Your Mind")


@pytest.mark.parametrize("audio_format", ["mp3", "flac"], ids=["id3", "vorbis"])
def test_joins_multiple_artist_values_with_a_comma(
    blank_audio: Callable[[str], Path], audio_format: str
) -> None:
    path = blank_audio(audio_format)
    tag(path, artist=["Adam Beyer", "Bart Skils"], title=["Your Mind"])

    identity = read_shown_tags(path).identity

    assert identity.artist == "Adam Beyer, Bart Skils"


def test_strips_blanks_and_drops_empty_values(blank_audio: Callable[[str], Path]) -> None:
    path = blank_audio("flac")
    tag(path, artist=[" Adam Beyer ", "", "  "], title=["  Your Mind"])

    identity = read_shown_tags(path).identity

    assert identity == IdentityTags(artist="Adam Beyer", title="Your Mind")


@pytest.mark.parametrize(
    "audio_format", ["mp3", "wav", "aiff", "flac"], ids=["mp3", "wav", "aiff", "flac"]
)
def test_returns_an_empty_identity_for_a_file_without_tags(
    blank_audio: Callable[[str], Path], audio_format: str
) -> None:
    path = blank_audio(audio_format)

    identity = read_shown_tags(path).identity

    assert identity == IdentityTags(artist="", title="")


@pytest.mark.parametrize("name", ["broken.mp3", "notes.txt"], ids=["corrupt-mp3", "unknown"])
def test_raises_unreadable_when_the_content_matches_no_format(tmp_path: Path, name: str) -> None:
    """`read_shown_tags` est appelable hors du filtre de `list_audio_files` : un contenu
    que mutagen ne rattache a aucun format rend `unreadable`, il ne plante pas.
    """
    path = write_not_audio(tmp_path / name)

    with pytest.raises(TagsUnreadableError, match="unreadable tags") as error:
        read_shown_tags(path)

    assert error.value.reason is FileFailureReason.WRITE_FAILED
    assert error.value.params == {"file": name, "reason": FileFailureReason.WRITE_FAILED}


def test_raises_unreadable_when_the_container_is_not_one_of_the_four_formats(
    tmp_path: Path,
) -> None:
    """Un WavPack sous extension `.wav` passe le filtre de `list_audio_files` : ses
    tags APEv2 existent sans que nous sachions les lire, il ne doit pas passer pour
    un fichier non tague.
    """
    path = write_tagged_wavpack(tmp_path / "track.wav")

    with pytest.raises(TagsUnreadableError, match="unreadable tags") as error:
        read_shown_tags(path)

    assert error.value.reason is FileFailureReason.WRITE_FAILED


def test_raises_locked_when_the_read_fails_on_a_permission_error(
    blank_audio: Callable[[str], Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    path = blank_audio("mp3")

    def locked_file(_path: Path) -> None:
        raise MutagenError("file in use") from PermissionError(13, "Permission denied")

    monkeypatch.setattr(mutagen, "File", locked_file)

    with pytest.raises(TagsUnreadableError, match="unreadable tags") as error:
        read_shown_tags(path)

    assert error.value.reason is FileFailureReason.FILE_LOCKED


def test_keeps_permission_denied_when_a_read_only_file_refuses_the_read(
    blank_audio: Callable[[str], Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Meme classement qu'a l'ecriture : seul un fichier inscriptible passe pour verrouille."""
    path = blank_audio("mp3")
    path.chmod(stat.S_IREAD)

    def refused(_path: Path) -> None:
        raise MutagenError("refused") from PermissionError(13, "Permission denied")

    monkeypatch.setattr(mutagen, "File", refused)

    with pytest.raises(TagsUnreadableError) as error:
        read_shown_tags(path)

    assert error.value.reason is FileFailureReason.PERMISSION_DENIED


@pytest.mark.parametrize(
    "audio_format", ["mp3", "wav", "aiff", "flac"], ids=["mp3", "wav", "aiff", "flac"]
)
def test_leaves_the_file_bytes_unchanged_after_reading(
    blank_audio: Callable[[str], Path], audio_format: str
) -> None:
    path = blank_audio(audio_format)
    tag(path, artist=["Sara Landry"], title=["The Void"])
    before = path.read_bytes()

    read_shown_tags(path)

    assert path.read_bytes() == before
