from types import MappingProxyType
from typing import TYPE_CHECKING, Final

import mutagen
import pytest
from audio_samples import (
    BLANK_WRITERS,
    id3_as_written,
    locked_by_another_process,
    write_not_audio,
    write_tagged_wavpack,
)
from mutagen.flac import FLAC
from mutagen.id3 import TBPM, TDRC, TIT2, TPE1, TXXX, WOAS
from path_limits import folder_beyond_the_limit
from scraper_responses import BEATPORT_CANDIDATE
from tagging_api import JPEG, write_cover

from tagger.core.file_failures import FileFailureReason
from tagger.core.paths import extended_path
from tagger.tags.files import (
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
from tagger.tags.renaming import MAX_PATH_LENGTH

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

ORIGINAL_URL: Final = "https://adambeyer.bandcamp.com/track/your-mind"
TAGGED_FIELDS: Final = MappingProxyType(
    {
        TagField.ARTIST: ("adam beyer", "bart skils"),
        TagField.TITLE: ("your mind",),
        TagField.DATE: ("2019-06-16",),
        TagField.BPM: ("130",),
        TagField.URL: (ORIGINAL_URL,),
    }
)


def _tag(path: Path, id3_version: int = 3) -> None:
    """Tags d'un fichier tague ailleurs : deux artistes, titre, date complete, BPM, URL."""
    audio = mutagen.File(path)
    if isinstance(audio, FLAC):
        audio["ARTIST"] = ["adam beyer", "bart skils"]
        audio["TITLE"] = ["your mind"]
        audio["DATE"] = ["2019-06-16"]
        audio["BPM"] = ["130"]
        audio["URL"] = [ORIGINAL_URL]
        audio.save()
        return
    audio.add_tags()
    audio.tags.add(TPE1(encoding=3, text=["adam beyer", "bart skils"]))
    audio.tags.add(TIT2(encoding=3, text=["your mind"]))
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
    write_tags(path, project_tags(BEATPORT_CANDIDATE), None)

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
    write_tags(path, project_tags(BEATPORT_CANDIDATE), None)

    restore_tags(path, original)

    on_disk = id3_as_written(path)
    assert on_disk.version == (2, id3_version, 0)
    expected_dates = {"TYER", "TDAT"} if id3_version == 3 else {"TDRC"}
    assert expected_dates <= on_disk.keys()


@pytest.mark.parametrize("audio_format", ["mp3", "flac"], ids=["id3", "vorbis"])
def test_restores_an_untagged_file_without_any_field_of_the_table(
    blank_audio: Callable[[str], Path], audio_format: str
) -> None:
    path = blank_audio(audio_format)
    original = read_original_tags(path)
    write_tags(path, project_tags(BEATPORT_CANDIDATE), None)

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


@pytest.mark.parametrize(
    ("name", "build"),
    [("track.wav", write_tagged_wavpack), ("notes.txt", write_not_audio)],
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
    cover = write_cover(tmp_path)
    write_tags(path, project_tags(BEATPORT_CANDIDATE), cover)

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


def test_restores_the_tags_of_a_file_beyond_the_path_limit(tmp_path: Path) -> None:
    path = folder_beyond_the_limit(tmp_path) / "track.mp3"
    BLANK_WRITERS["mp3"](extended_path(path))
    _tag(extended_path(path))
    original = read_original_tags(path)
    write_tags(path, project_tags(BEATPORT_CANDIDATE), None)

    restore_tags(path, original)

    assert len(str(path)) > MAX_PATH_LENGTH
    assert read_original_tags(path) == original


@pytest.mark.parametrize(
    "operation",
    [read_original_tags, lambda path: write_tags(path, project_tags(BEATPORT_CANDIDATE), None)],
    ids=["read", "write"],
)
def test_opens_the_audio_file_through_the_extended_path(
    blank_audio: Callable[[str], Path],
    monkeypatch: pytest.MonkeyPatch,
    operation: Callable[[Path], object],
) -> None:
    """Sans prefixe, mutagen echoue au-dela de 259 caracteres sur un Windows sans
    `LongPathsEnabled` : l'ouverture doit passer par `extended_path`.
    """
    path = blank_audio("mp3")
    opened: list[str] = []
    real_file = mutagen.File

    def recording_file(target: Path) -> object:
        opened.append(str(target))
        return real_file(target)

    monkeypatch.setattr(mutagen, "File", recording_file)

    operation(path)

    assert opened == [str(extended_path(path))]
