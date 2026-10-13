"""Tests de la lecture des tags pour l'ecran et des valeurs que l'ecriture laissera."""

from pathlib import Path
from types import MappingProxyType
from typing import TYPE_CHECKING, Final

import mutagen
import pytest
from mutagen.id3 import COMM, ID3, TBPM, TIT2, TPE1, WOAS

from tagger.tags.files import (
    TAG_FIELDS,
    ShownTags,
    TagField,
    TagSystem,
    after_tags,
    read_shown_tags,
    shown_key,
    tag_system_of,
    write_tags,
)

if TYPE_CHECKING:
    from collections.abc import Callable

URL: Final = "https://adambeyer.bandcamp.com/track/your-mind"


def _shown(system: TagSystem = TagSystem.ID3, **values: str) -> ShownTags:
    fields: dict[TagField, str | None] = dict.fromkeys(TAG_FIELDS)
    fields.update({TagField(name): value for name, value in values.items()})
    return ShownTags(system, MappingProxyType(fields), None)


def test_reads_every_field_of_the_table_in_order_with_its_comment(
    blank_audio: Callable[[str], Path],
) -> None:
    path = blank_audio("mp3")
    tags = ID3()
    tags.add(TPE1(encoding=3, text=["Adam Beyer", "Bart Skils"]))
    tags.add(TIT2(encoding=3, text=["Your Mind"]))
    tags.add(TBPM(encoding=3, text=["130"]))
    tags.add(WOAS(url=URL))
    tags.add(COMM(encoding=3, lang="eng", desc="", text=["Ripped by X"]))
    tags.save(path)

    shown = read_shown_tags(path)

    assert shown.system is TagSystem.ID3
    assert list(shown.fields) == list(TAG_FIELDS)
    assert shown.fields[TagField.ARTIST] == "Adam Beyer, Bart Skils"
    assert (shown.fields[TagField.BPM], shown.fields[TagField.URL]) == ("130", URL)
    assert shown.fields[TagField.ALBUM] is None
    assert shown.comment == "Ripped by X"
    assert (shown.identity.artist, shown.identity.title) == ("Adam Beyer, Bart Skils", "Your Mind")


def test_lists_the_fields_in_the_order_the_detail_shows_them() -> None:
    order = [field.value for field in TAG_FIELDS]

    assert order == [
        "artist",
        "title",
        "remixer",
        "genre",
        "bpm",
        "key",
        "label",
        "catalog_number",
        "isrc",
        "album",
        "track_number",
        "date",
        "source",
        "url",
        "source_id",
    ]


def test_reads_the_vorbis_comments_of_a_flac(blank_audio: Callable[[str], Path]) -> None:
    path = blank_audio("flac")
    audio = mutagen.File(path)
    audio["ARTIST"] = ["Adam Beyer"]
    audio["COMMENT"] = ["Ripped by X"]
    audio.save()

    shown = read_shown_tags(path)

    assert (shown.system, shown.fields[TagField.ARTIST], shown.comment) == (
        TagSystem.VORBIS,
        "Adam Beyer",
        "Ripped by X",
    )


def test_shows_every_id3_comment_frame(blank_audio: Callable[[str], Path]) -> None:
    path = blank_audio("mp3")
    tags = ID3()
    tags.add(COMM(encoding=3, lang="eng", desc="", text=["Ripped by X"]))
    tags.add(COMM(encoding=3, lang="eng", desc="iTunNORM", text=["000002CC 000002B1"]))
    tags.save(path)

    shown = read_shown_tags(path)

    assert shown.comment == "Ripped by X, 000002CC 000002B1"


def test_shows_every_vorbis_comment_key(blank_audio: Callable[[str], Path]) -> None:
    path = blank_audio("flac")
    audio = mutagen.File(path)
    audio["COMMENT"] = ["Ripped by X"]
    audio["DESCRIPTION"] = ["Bought on Y"]
    audio.save()

    shown = read_shown_tags(path)

    assert shown.comment == "Ripped by X, Bought on Y"


def test_reads_a_file_without_tags_as_empty(blank_audio: Callable[[str], Path]) -> None:
    shown = read_shown_tags(blank_audio("wav"))

    assert set(shown.fields.values()) == {None}
    assert shown.comment is None


@pytest.mark.parametrize(
    ("field", "system", "expected"),
    [
        (TagField.DATE, TagSystem.ID3, "TYER"),
        (TagField.CATALOG_NUMBER, TagSystem.ID3, "CATALOGNUMBER"),
        (TagField.SOURCE, TagSystem.ID3, "SOURCE"),
        (TagField.DATE, TagSystem.VORBIS, "DATE"),
    ],
    ids=["id3-date", "id3-txxx-catalog", "id3-txxx-source", "vorbis-date"],
)
def test_names_a_field_by_the_key_the_written_file_carries(
    field: TagField, system: TagSystem, expected: str
) -> None:
    key = shown_key(field, system)

    assert key == expected


def test_keeps_the_original_value_the_candidate_leaves_out() -> None:
    before = _shown(artist="adam beyer", bpm="130")

    after = after_tags({TagField.ARTIST: "Adam Beyer"}, before)

    assert list(after) == list(TAG_FIELDS)
    assert (after[TagField.ARTIST], after[TagField.BPM], after[TagField.KEY]) == (
        "Adam Beyer",
        "130",
        None,
    )


@pytest.mark.parametrize(
    ("system", "expected"),
    [(TagSystem.ID3, "2023"), (TagSystem.VORBIS, "2023-05-12")],
    ids=["id3-keeps-the-year", "vorbis-keeps-the-full-date"],
)
def test_keeps_the_file_date_as_the_written_file_will_hold_it(
    system: TagSystem, expected: str
) -> None:
    before = _shown(system, date="2023-05-12")

    after = after_tags({}, before)

    assert after[TagField.DATE] == expected


def test_names_the_frames_the_written_id3_file_carries(
    blank_audio: Callable[[str], Path],
) -> None:
    path = blank_audio("mp3")
    write_tags(
        path,
        {
            TagField.DATE: "2023",
            TagField.CATALOG_NUMBER: "DC287",
        },
        None,
    )

    frames = set(ID3(path, translate=False))

    assert {
        shown_key(TagField.DATE, TagSystem.ID3),
        f"TXXX:{shown_key(TagField.CATALOG_NUMBER, TagSystem.ID3)}",
    } <= frames


def test_shows_only_the_candidate_without_original_tags() -> None:
    after = after_tags({TagField.ARTIST: "Adam Beyer"}, None)

    assert (after[TagField.ARTIST], after[TagField.BPM]) == ("Adam Beyer", None)


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("track.flac", TagSystem.VORBIS),
        ("track.FLAC", TagSystem.VORBIS),
        ("track.aiff", TagSystem.ID3),
    ],
    ids=["flac", "uppercase-flac", "aiff"],
)
def test_tells_the_tag_system_from_the_extension(name: str, expected: TagSystem) -> None:
    system = tag_system_of(Path(name))

    assert system is expected
