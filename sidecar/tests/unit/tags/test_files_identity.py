import stat
from typing import TYPE_CHECKING

import mutagen
import pytest
from audio_samples import (
    ALL_FORMATS,
    ID3_VORBIS_FORMATS,
    mutagen_refusing,
    tag,
    write_not_audio,
    write_tagged_wavpack,
)

from tagger.core.file_failures import FileFailureReason
from tagger.tags.files import IdentityTags, TagsUnreadableError, read_shown_tags

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path


@pytest.mark.parametrize("audio_format", ALL_FORMATS)
def test_reads_artist_and_title_from_the_tags(
    blank_audio: Callable[[str], Path], audio_format: str
) -> None:
    path = blank_audio(audio_format)
    tag(path, artist=["Adam Beyer"], title=["Your Mind"])

    identity = read_shown_tags(path).identity

    assert identity == IdentityTags(artist="Adam Beyer", title="Your Mind")


@pytest.mark.parametrize("audio_format", ID3_VORBIS_FORMATS)
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


@pytest.mark.parametrize("audio_format", ALL_FORMATS)
def test_returns_an_empty_identity_for_a_file_without_tags(
    blank_audio: Callable[[str], Path], audio_format: str
) -> None:
    path = blank_audio(audio_format)

    identity = read_shown_tags(path).identity

    assert identity == IdentityTags(artist="", title="")


@pytest.mark.parametrize(
    ("name", "build"),
    [
        ("broken.mp3", write_not_audio),
        ("notes.txt", write_not_audio),
        ("track.wav", write_tagged_wavpack),
    ],
    ids=["corrupt-mp3", "unknown", "wavpack"],
)
def test_raises_unreadable_when_the_content_matches_none_of_the_four_formats(
    tmp_path: Path, name: str, build: Callable[[Path], Path]
) -> None:
    """`read_shown_tags` est appelable hors du filtre de `list_audio_files` : un contenu
    que mutagen ne rattache a aucun format rend `unreadable`, il ne plante pas. Un WavPack
    sous extension `.wav` passe ce filtre : ses tags APEv2 existent sans que nous sachions
    les lire, il ne doit pas passer pour un fichier non tague.
    """
    path = build(tmp_path / name)

    with pytest.raises(TagsUnreadableError, match="unreadable tags") as error:
        read_shown_tags(path)

    assert error.value.reason is FileFailureReason.WRITE_FAILED
    assert error.value.params == {"file": name, "reason": FileFailureReason.WRITE_FAILED}


@pytest.mark.parametrize(
    ("read_only", "reason"),
    [(False, FileFailureReason.FILE_LOCKED), (True, FileFailureReason.PERMISSION_DENIED)],
    ids=["writable-file", "read-only-file"],
)
def test_tells_a_locked_file_from_a_read_only_one_when_the_read_is_refused(
    blank_audio: Callable[[str], Path],
    monkeypatch: pytest.MonkeyPatch,
    read_only: bool,
    reason: FileFailureReason,
) -> None:
    """Meme classement qu'a l'ecriture : seul un fichier inscriptible passe pour verrouille."""
    path = blank_audio("mp3")
    if read_only:
        path.chmod(stat.S_IREAD)

    monkeypatch.setattr(mutagen, "File", mutagen_refusing(PermissionError(13, "Permission denied")))

    with pytest.raises(TagsUnreadableError, match="unreadable tags") as error:
        read_shown_tags(path)

    assert error.value.reason is reason


@pytest.mark.parametrize("audio_format", ALL_FORMATS)
def test_leaves_the_file_bytes_unchanged_after_reading(
    blank_audio: Callable[[str], Path], audio_format: str
) -> None:
    path = blank_audio(audio_format)
    tag(path, artist=["Sara Landry"], title=["The Void"])
    before = path.read_bytes()

    read_shown_tags(path)

    assert path.read_bytes() == before
