"""Tests de la lecture des tags d'origine et de leur restauration, sur les quatre formats."""

from types import MappingProxyType
from typing import TYPE_CHECKING

import mutagen
import pytest
from audio_samples import locked_by_another_process, write_tagged_wavpack
from mutagen.flac import FLAC
from mutagen.id3 import TBPM, TDRC, TIT2, TPE1, TXXX, WOAS
from scraper_responses import payload_candidate
from tagging_api import JPEG

from tagger.file_failures import FileFailureReason
from tagger.files import (
    OriginalTags,
    TagField,
    TagsUnreadableError,
    TagsWriteError,
    TagSystem,
    project_tags,
    read_original_tags,
    restore_tags,
    write_tags,
)

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

BEATPORT = payload_candidate()
ORIGINAL_URL = "https://liorvance.bandcamp.com/track/dim-orbit"
TAGGED_FIELDS = MappingProxyType(
    {
        TagField.ARTIST: ("lior vance", "mara quill"),
        TagField.TITLE: ("dim orbit",),
        TagField.DATE: ("2019-06-16",),
        TagField.BPM: ("130",),
        TagField.URL: (ORIGINAL_URL,),
    }
)


def _tag(path: Path, id3_version: int = 3) -> None:
    """Tags d'un fichier tague ailleurs : deux artistes, titre, date complete, BPM, URL."""
    audio = mutagen.File(path)
    if isinstance(audio, FLAC):
        audio["ARTIST"] = ["lior vance", "mara quill"]
        audio["TITLE"] = ["dim orbit"]
        audio["DATE"] = ["2019-06-16"]
        audio["BPM"] = ["130"]
        audio["URL"] = [ORIGINAL_URL]
        audio.save()
        return
    audio.add_tags()
    audio.tags.add(TPE1(encoding=3, text=["lior vance", "mara quill"]))
    audio.tags.add(TIT2(encoding=3, text=["dim orbit"]))
    audio.tags.add(TDRC(encoding=3, text=["2019-06-16"]))
    audio.tags.add(TBPM(encoding=3, text=["130"]))
    audio.tags.add(WOAS(url=ORIGINAL_URL))
    if id3_version == 3:
        audio.tags.update_to_v23()
    audio.save(v2_version=id3_version)


@pytest.mark.parametrize(
    ("audio_format", "id3_version"),
    [("mp3", 3), ("mp3", 4), ("wav", 3), ("aiff", 3), ("flac", 3)],
    ids=["mp3-v23", "mp3-v24", "wav", "aiff", "flac"],
)
def test_restores_exactly_the_original_fields_after_a_write(
    blank_audio: Callable[[str], Path], audio_format: str, id3_version: int
) -> None:
    path = blank_audio(audio_format)
    _tag(path, id3_version)
    original = read_original_tags(path)
    write_tags(path, project_tags(BEATPORT), None)

    restore_tags(path, original)

    assert read_original_tags(path) == original


@pytest.mark.parametrize(
    ("audio_format", "id3_version", "expected"),
    [
        (
            "mp3",
            4,
            OriginalTags(
                TagSystem.ID3,
                4,
                TAGGED_FIELDS,
            ),
        ),
        (
            "flac",
            3,
            OriginalTags(
                TagSystem.VORBIS,
                None,
                TAGGED_FIELDS,
            ),
        ),
    ],
    ids=["id3-v24", "vorbis"],
)
def test_reads_every_value_of_the_original_fields(
    blank_audio: Callable[[str], Path],
    audio_format: str,
    id3_version: int,
    expected: OriginalTags,
) -> None:
    path = blank_audio(audio_format)
    _tag(path, id3_version)

    original = read_original_tags(path)

    assert original == expected


@pytest.mark.parametrize("id3_version", [3, 4], ids=["v23", "v24"])
def test_saves_the_file_back_in_its_original_id3_version(
    blank_audio: Callable[[str], Path], id3_version: int
) -> None:
    path = blank_audio("mp3")
    _tag(path, id3_version)
    original = read_original_tags(path)
    write_tags(path, project_tags(BEATPORT), None)

    restore_tags(path, original)

    # Rechargees sans la remontee en v2.4 : les frames telles qu'ecrites sur le disque.
    on_disk = type(mutagen.File(path))(path, translate=False).tags
    assert on_disk.version == (2, id3_version, 0)
    expected_dates = {"TYER", "TDAT"} if id3_version == 3 else {"TDRC"}
    assert expected_dates <= on_disk.keys()


@pytest.mark.parametrize("audio_format", ["mp3", "flac"], ids=["id3", "vorbis"])
def test_restores_an_untagged_file_without_any_field_of_the_table(
    blank_audio: Callable[[str], Path], audio_format: str
) -> None:
    path = blank_audio(audio_format)
    original = read_original_tags(path)
    write_tags(path, project_tags(BEATPORT), None)

    restore_tags(path, original)

    assert original.fields == {}
    assert read_original_tags(path).fields == {}


def test_restores_an_untagged_file_the_write_never_reached(
    blank_audio: Callable[[str], Path],
) -> None:
    path = blank_audio("wav")
    original = read_original_tags(path)

    restore_tags(path, original)

    assert read_original_tags(path).fields == {}


def _not_audio(path: Path) -> Path:
    path.write_bytes(b"not an audio file" * 16)
    return path


@pytest.mark.parametrize(
    ("name", "build"),
    [("track.wav", write_tagged_wavpack), ("notes.txt", _not_audio)],
    ids=["wavpack", "unknown"],
)
def test_refuses_to_restore_a_file_outside_the_four_formats(
    tmp_path: Path, name: str, build: Callable[[Path], Path]
) -> None:
    path = build(tmp_path / name)
    original = OriginalTags(TagSystem.ID3, 3, MappingProxyType({}))

    with pytest.raises(TagsWriteError) as error:
        restore_tags(path, original)

    assert error.value.reason is FileFailureReason.WRITE_FAILED


def test_leaves_pictures_and_foreign_tags_alone(
    blank_audio: Callable[[str], Path], tmp_path: Path
) -> None:
    path = blank_audio("mp3")
    audio = mutagen.File(path)
    audio.add_tags()
    audio.tags.add(TXXX(encoding=3, desc="SERATO_PLAYCOUNT", text=["12"]))
    audio.save(v2_version=3)
    original = read_original_tags(path)
    cover = tmp_path / "cover.jpg"
    cover.write_bytes(JPEG)
    write_tags(path, project_tags(BEATPORT), cover)

    restore_tags(path, original)

    tags = mutagen.File(path).tags
    assert str(tags["TXXX:SERATO_PLAYCOUNT"]) == "12"
    assert [frame.data for frame in tags.getall("APIC")] == [JPEG]


def test_raises_file_locked_when_restoring_a_locked_file(
    blank_audio: Callable[[str], Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    path = blank_audio("mp3")
    original = read_original_tags(path)

    monkeypatch.setattr(mutagen, "File", locked_by_another_process)

    with pytest.raises(TagsWriteError) as error:
        restore_tags(path, original)

    assert error.value.reason is FileFailureReason.FILE_LOCKED


def test_refuses_to_read_a_container_outside_the_four_formats(tmp_path: Path) -> None:
    path = write_tagged_wavpack(tmp_path / "track.wav")

    with pytest.raises(TagsUnreadableError, match="unreadable tags"):
        read_original_tags(path)
