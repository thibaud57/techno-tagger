"""Tests de la projection d'un candidat et de l'ecriture des tags, relus sur le fichier."""

import errno
import stat
from typing import TYPE_CHECKING, Final

import mutagen
import pytest
from audio_samples import (
    append_id3v1,
    held_open,
    locked_by_another_process,
    write_tagged_wavpack,
)
from mutagen import MutagenError
from mutagen.flac import FLAC, Picture
from mutagen.id3 import APIC, COMM, TDRC, TPE2, TXXX, Frames, PictureType
from mutagen.mp3 import MP3
from scraper_responses import (
    bandcamp_track_payload,
    payload_candidate,
    soundcloud_track_payload,
)
from tagging_api import JPEG

from tagger.file_failures import FileFailureReason
from tagger.files import (
    TAG_FIELDS,
    TagField,
    TagKeys,
    TagsWriteError,
    project_tags,
    write_tags,
)
from tagger.scraper_client import TrackCandidate

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path


def _credit(name: str) -> dict[str, object]:
    return {"id": name, "name": name, "kind": "artist", "social_links": []}


BEATPORT: Final = payload_candidate()
REMIX: Final = payload_candidate(
    artists=[_credit("Adam Beyer"), _credit("Bart Skils")],
    remixers=[_credit("Layton Giordani")],
    mix_name="Layton Giordani Remix",
)
BANDCAMP: Final = TrackCandidate.model_validate(
    bandcamp_track_payload(genre=None, bpm=None, key=None)
)
SOUNDCLOUD: Final = TrackCandidate.model_validate(soundcloud_track_payload())


def _read_back(path: Path) -> dict[TagField, str]:
    """Valeurs relues sous les cles de la table ; mutagen remonte TYER et TORY en TDRC et TDOR."""
    audio = mutagen.File(path)
    if isinstance(audio, FLAC):
        return {
            field: audio[keys.vorbis][0]
            for field, keys in TAG_FIELDS.items()
            if keys.vorbis in audio
        }
    return {
        field: str(audio.tags[keys.id3])
        for field, keys in TAG_FIELDS.items()
        if keys.id3 in audio.tags
    }


def _preset(path: Path, **frames_or_keys: str) -> None:
    """Pose des tags d'origine dans l'arrange : frames texte ID3 ou cles Vorbis."""
    audio = mutagen.File(path)
    if isinstance(audio, FLAC):
        for key, value in frames_or_keys.items():
            audio[key] = [value]
        audio.save()
        return
    if audio.tags is None:
        audio.add_tags()
    for frame_id, value in frames_or_keys.items():
        audio.tags.add(Frames[frame_id](encoding=3, text=[value]))
    audio.tags.update_to_v23()
    audio.save(v2_version=3)


def _add_pictures(path: Path, *pictures: tuple[int, bytes]) -> None:
    audio = mutagen.File(path)
    if isinstance(audio, FLAC):
        for kind, data in pictures:
            picture = Picture()
            picture.type = kind
            picture.mime = "image/png"
            picture.data = data
            audio.add_picture(picture)
        audio.save()
        return
    if audio.tags is None:
        audio.add_tags()
    for kind, data in pictures:
        audio.tags.add(APIC(encoding=3, mime="image/png", type=kind, desc=str(kind), data=data))
    audio.save(v2_version=3)


def _pictures(path: Path) -> list[tuple[int, str, bytes]]:
    audio = mutagen.File(path)
    if isinstance(audio, FLAC):
        return [(picture.type, picture.mime, picture.data) for picture in audio.pictures]
    return [(frame.type, frame.mime, frame.data) for frame in audio.tags.getall("APIC")]


def test_projects_every_field_a_beatport_candidate_carries() -> None:
    values = project_tags(BEATPORT)

    assert dict(values) == {
        TagField.ARTIST: "Adam Beyer",
        TagField.TITLE: "Your Mind (Extended Mix)",
        TagField.ALBUM: "Your Mind",
        TagField.DATE: "2023",
        TagField.ORIGINAL_DATE: "2023",
        TagField.GENRE: "Techno (Peak Time / Driving)",
        TagField.LABEL: "Drumcode",
        TagField.CATALOG_NUMBER: "DC287",
        TagField.BPM: "134",
        TagField.KEY: "4A",
        TagField.ISRC: "SE5RN2312001",
        TagField.TRACK_NUMBER: "1",
        TagField.URL: "https://www.beatport.com/track/your-mind/17492013",
        TagField.SOURCE_ID: "17492013",
        TagField.SOURCE: "beatport",
    }


def test_keeps_the_remixer_out_of_the_artist() -> None:
    values = project_tags(REMIX)

    assert values[TagField.ARTIST] == "Adam Beyer, Bart Skils"
    assert values[TagField.TITLE] == "Your Mind (Layton Giordani Remix)"
    assert values[TagField.REMIXER] == "Layton Giordani"


def test_joins_several_remixers_apart_from_the_artists() -> None:
    candidate = payload_candidate(
        remixers=[_credit("Layton Giordani"), _credit("Charlotte de Witte")]
    )

    values = project_tags(candidate)

    assert values[TagField.REMIXER] == "Layton Giordani, Charlotte de Witte"
    assert values[TagField.ARTIST] == "Adam Beyer"


@pytest.mark.parametrize(
    ("url", "encoded"),
    [
        ("https://label.bandcamp.com/track/café", "https://label.bandcamp.com/track/caf%C3%A9"),
        (
            "https://label.bandcamp.com/track/東京",
            "https://label.bandcamp.com/track/%E6%9D%B1%E4%BA%AC",
        ),
        (
            "https://www.beatport.com/track/a%20b/1?x=1&y=2#top",
            "https://www.beatport.com/track/a%20b/1?x=1&y=2#top",
        ),
    ],
    ids=["accented", "cjk", "ascii-unchanged"],
)
def test_percent_encodes_the_non_ascii_characters_of_the_url(url: str, encoded: str) -> None:
    values = project_tags(payload_candidate(url=url))

    assert values[TagField.URL] == encoded


@pytest.mark.parametrize("audio_format", ["mp3", "flac"], ids=["id3", "vorbis"])
def test_writes_the_encoded_url_whatever_the_characters_of_the_source(
    blank_audio: Callable[[str], Path], audio_format: str
) -> None:
    path = blank_audio(audio_format)
    values = project_tags(payload_candidate(url="https://label.bandcamp.com/track/東京-café"))

    write_tags(path, values, None)

    assert _read_back(path)[TagField.URL] == (
        "https://label.bandcamp.com/track/%E6%9D%B1%E4%BA%AC-caf%C3%A9"
    )


def test_pins_the_field_table_of_the_adr() -> None:
    assert {
        TagField.ARTIST: TagKeys(id3="TPE1", vorbis="ARTIST"),
        TagField.REMIXER: TagKeys(id3="TPE4", vorbis="REMIXER"),
        TagField.TITLE: TagKeys(id3="TIT2", vorbis="TITLE"),
        TagField.ALBUM: TagKeys(id3="TALB", vorbis="ALBUM"),
        TagField.DATE: TagKeys(id3="TDRC", vorbis="DATE"),
        TagField.ORIGINAL_DATE: TagKeys(id3="TDOR", vorbis="ORIGINALDATE"),
        TagField.GENRE: TagKeys(id3="TCON", vorbis="GENRE"),
        TagField.LABEL: TagKeys(id3="TPUB", vorbis="LABEL"),
        TagField.CATALOG_NUMBER: TagKeys(id3="TXXX:CATALOGNUMBER", vorbis="CATALOGNUMBER"),
        TagField.BPM: TagKeys(id3="TBPM", vorbis="BPM"),
        TagField.KEY: TagKeys(id3="TKEY", vorbis="KEY"),
        TagField.ISRC: TagKeys(id3="TSRC", vorbis="ISRC"),
        TagField.TRACK_NUMBER: TagKeys(id3="TRCK", vorbis="TRACKNUMBER"),
        TagField.URL: TagKeys(id3="WOAS", vorbis="URL"),
        TagField.SOURCE_ID: TagKeys(id3="TXXX:SOURCE_ID", vorbis="SOURCE_ID"),
        TagField.SOURCE: TagKeys(id3="TXXX:SOURCE", vorbis="SOURCE"),
    } == TAG_FIELDS


def test_omits_the_fields_the_source_leaves_null() -> None:
    values = project_tags(BANDCAMP)

    assert {TagField.GENRE, TagField.BPM, TagField.KEY, TagField.REMIXER}.isdisjoint(values)
    assert values[TagField.SOURCE] == "bandcamp"


def test_omits_blank_values() -> None:
    values = project_tags(payload_candidate(genre="   ", key=""))

    assert {TagField.GENRE, TagField.KEY}.isdisjoint(values)


def test_omits_a_zero_bpm_or_track_number() -> None:
    values = project_tags(payload_candidate(bpm=0, track_number=0))

    assert {TagField.BPM, TagField.TRACK_NUMBER}.isdisjoint(values)


def test_projects_what_a_soundcloud_candidate_carries() -> None:
    values = project_tags(SOUNDCLOUD)

    assert (values[TagField.ARTIST], values[TagField.TITLE]) == ("KASIA & Faithless", "Tarantula")
    assert values[TagField.SOURCE] == "soundcloud"
    assert {TagField.GENRE, TagField.BPM, TagField.KEY, TagField.ISRC}.isdisjoint(values)


def test_omits_the_release_fields_without_a_release() -> None:
    values = project_tags(payload_candidate(release=None))

    assert {
        TagField.ALBUM,
        TagField.DATE,
        TagField.ORIGINAL_DATE,
        TagField.CATALOG_NUMBER,
    }.isdisjoint(values)


@pytest.mark.parametrize(
    "audio_format",
    ["mp3", "wav", "aiff", "flac"],
    ids=["id3-mp3", "id3-wav", "id3-aiff", "vorbis-flac"],
)
@pytest.mark.parametrize(
    "candidate",
    [REMIX, BANDCAMP, SOUNDCLOUD],
    ids=["beatport-remix", "bandcamp", "soundcloud"],
)
def test_writes_the_same_values_on_every_format(
    blank_audio: Callable[[str], Path], audio_format: str, candidate: TrackCandidate
) -> None:
    path = blank_audio(audio_format)
    values = project_tags(candidate)

    written = write_tags(path, values, None)

    assert _read_back(path) == dict(values)
    assert written.fields == tuple(values)


@pytest.mark.parametrize(
    "audio_format", ["mp3", "wav", "aiff"], ids=["id3-mp3", "id3-wav", "id3-aiff"]
)
@pytest.mark.parametrize("version", [3, 4], ids=["from-v23", "from-v24"])
def test_saves_id3_v23_with_the_year_alone(
    blank_audio: Callable[[str], Path], audio_format: str, version: int
) -> None:
    path = blank_audio(audio_format)
    audio = mutagen.File(path)
    audio.add_tags()
    audio.tags.add(TDRC(encoding=3, text=["2019-06-16"]))
    if version == 3:
        audio.tags.update_to_v23()
    audio.save(v2_version=version)

    write_tags(path, project_tags(BEATPORT), None)

    # Rechargees sans la remontee en v2.4 : les frames telles qu'ecrites sur le disque.
    on_disk = type(mutagen.File(path))(path, translate=False).tags
    assert on_disk.version == (2, 3, 0)
    assert (str(on_disk["TYER"]), str(on_disk["TORY"])) == ("2023", "2023")
    assert {"TDRC", "TDOR", "TDAT"}.isdisjoint(on_disk.keys())


@pytest.mark.parametrize("audio_format", ["mp3", "flac"], ids=["id3", "vorbis"])
def test_keeps_accented_text_intact(blank_audio: Callable[[str], Path], audio_format: str) -> None:
    path = blank_audio(audio_format)
    values = project_tags(payload_candidate(title="Für Élise", mix_name="Señor Remix"))

    write_tags(path, values, None)

    assert _read_back(path)[TagField.TITLE] == "Für Élise (Señor Remix)"


def test_replaces_existing_vorbis_values_whatever_their_case_or_count(
    blank_audio: Callable[[str], Path],
) -> None:
    path = blank_audio("flac")
    audio = FLAC(path)
    audio["artist"] = ["Old One", "Old Two"]
    audio.save()

    write_tags(path, project_tags(BEATPORT), None)

    assert FLAC(path)["ARTIST"] == ["Adam Beyer"]


@pytest.mark.parametrize(
    ("audio_format", "preset"),
    [("mp3", {"TBPM": "130", "TKEY": "8A"}), ("flac", {"BPM": "130", "KEY": "8A"})],
    ids=["id3", "vorbis"],
)
def test_keeps_the_tags_the_source_leaves_null(
    blank_audio: Callable[[str], Path], audio_format: str, preset: dict[str, str]
) -> None:
    path = blank_audio(audio_format)
    _preset(path, **preset)

    write_tags(path, project_tags(BANDCAMP), None)

    read_back = _read_back(path)
    assert (read_back[TagField.BPM], read_back[TagField.KEY]) == ("130", "8A")


def test_leaves_the_id3_frames_outside_the_table_alone(
    blank_audio: Callable[[str], Path],
) -> None:
    path = blank_audio("mp3")
    audio = mutagen.File(path)
    audio.add_tags()
    audio.tags.add(TPE2(encoding=3, text=["Drumcode"]))
    audio.tags.add(TXXX(encoding=3, desc="SERATO_PLAYCOUNT", text=["12"]))
    audio.save(v2_version=3)

    write_tags(path, project_tags(BEATPORT), None)

    tags = mutagen.File(path).tags
    assert (str(tags["TPE2"]), str(tags["TXXX:SERATO_PLAYCOUNT"])) == ("Drumcode", "12")


def test_leaves_the_vorbis_keys_outside_the_table_alone(
    blank_audio: Callable[[str], Path],
) -> None:
    path = blank_audio("flac")
    _preset(path, ALBUMARTIST="Drumcode", SERATO_PLAYCOUNT="12")

    write_tags(path, project_tags(BEATPORT), None)

    audio = FLAC(path)
    assert (audio["ALBUMARTIST"], audio["SERATO_PLAYCOUNT"]) == (["Drumcode"], ["12"])


def test_removes_every_id3_comment(blank_audio: Callable[[str], Path]) -> None:
    path = blank_audio("mp3")
    audio = mutagen.File(path)
    audio.add_tags()
    audio.tags.add(COMM(encoding=3, lang="eng", desc="", text=["ripped by X"]))
    audio.tags.add(COMM(encoding=3, lang="fra", desc="note", text=["320kbps"]))
    audio.save(v2_version=3)

    write_tags(path, project_tags(BEATPORT), None)

    assert not mutagen.File(path).tags.getall("COMM")


def test_removes_every_vorbis_comment(blank_audio: Callable[[str], Path]) -> None:
    path = blank_audio("flac")
    _preset(path, COMMENT="ripped by X", DESCRIPTION="320kbps")

    write_tags(path, project_tags(BEATPORT), None)

    audio = FLAC(path)
    assert "COMMENT" not in audio
    assert "DESCRIPTION" not in audio


def test_clears_the_comment_of_an_id3v1_tag(blank_audio: Callable[[str], Path]) -> None:
    path = blank_audio("mp3")
    append_id3v1(path, comment="ripped by X")

    write_tags(path, project_tags(BEATPORT), None)

    assert b"ripped by X" not in path.read_bytes()


@pytest.mark.parametrize("audio_format", ["mp3", "flac"], ids=["id3", "vorbis"])
def test_replaces_every_picture_with_the_given_cover(
    blank_audio: Callable[[str], Path], tmp_path: Path, audio_format: str
) -> None:
    path = blank_audio(audio_format)
    _add_pictures(path, (PictureType.COVER_BACK, b"back"), (PictureType.COVER_FRONT, b"old front"))
    cover = tmp_path / "cover.jpg"
    cover.write_bytes(JPEG)

    written = write_tags(path, project_tags(BEATPORT), cover)

    assert _pictures(path) == [(PictureType.COVER_FRONT, "image/jpeg", JPEG)]
    assert written.artwork


@pytest.mark.parametrize("audio_format", ["mp3", "flac"], ids=["id3", "vorbis"])
def test_writing_twice_still_leaves_a_single_cover(
    blank_audio: Callable[[str], Path], tmp_path: Path, audio_format: str
) -> None:
    path = blank_audio(audio_format)
    cover = tmp_path / "cover.jpg"
    cover.write_bytes(JPEG)
    write_tags(path, project_tags(BEATPORT), cover)

    write_tags(path, project_tags(BEATPORT), cover)

    assert _pictures(path) == [(PictureType.COVER_FRONT, "image/jpeg", JPEG)]


def test_tags_the_cover_with_the_mime_of_its_extension(
    blank_audio: Callable[[str], Path], tmp_path: Path
) -> None:
    path = blank_audio("mp3")
    cover = tmp_path / "cover.png"
    cover.write_bytes(b"\x89PNG")

    write_tags(path, project_tags(BEATPORT), cover)

    assert _pictures(path) == [(PictureType.COVER_FRONT, "image/png", b"\x89PNG")]


@pytest.mark.parametrize("audio_format", ["mp3", "flac"], ids=["id3", "vorbis"])
def test_keeps_only_the_front_cover_without_artwork(
    blank_audio: Callable[[str], Path], audio_format: str
) -> None:
    path = blank_audio(audio_format)
    _add_pictures(path, (PictureType.COVER_BACK, b"back"), (PictureType.COVER_FRONT, b"front"))

    written = write_tags(path, project_tags(BEATPORT), None)

    assert _pictures(path) == [(PictureType.COVER_FRONT, "image/png", b"front")]
    assert not written.artwork


@pytest.mark.parametrize("audio_format", ["mp3", "flac"], ids=["id3", "vorbis"])
def test_keeps_the_first_picture_when_none_is_a_front_cover(
    blank_audio: Callable[[str], Path], audio_format: str
) -> None:
    path = blank_audio(audio_format)
    _add_pictures(path, (PictureType.COVER_BACK, b"back"), (PictureType.LEAFLET_PAGE, b"leaflet"))

    write_tags(path, project_tags(BEATPORT), None)

    assert _pictures(path) == [(PictureType.COVER_BACK, "image/png", b"back")]


@pytest.mark.parametrize(
    "cover_state", ["purged", "unreadable", "foreign"], ids=["purged", "unreadable", "foreign"]
)
def test_treats_a_cover_the_cache_cannot_give_as_absent(
    blank_audio: Callable[[str], Path], tmp_path: Path, cover_state: str
) -> None:
    path = blank_audio("mp3")
    _add_pictures(path, (PictureType.COVER_FRONT, b"front"))
    cover = tmp_path / ("cover.gif" if cover_state == "foreign" else "cover.jpg")
    if cover_state == "unreadable":
        cover.mkdir()
    elif cover_state == "foreign":
        cover.write_bytes(b"GIF89a")

    written = write_tags(path, project_tags(BEATPORT), cover)

    assert _pictures(path) == [(PictureType.COVER_FRONT, "image/png", b"front")]
    assert not written.artwork
    assert _read_back(path)[TagField.TITLE] == "Your Mind (Extended Mix)"


def test_maps_a_windows_sharing_violation_to_file_locked(
    blank_audio: Callable[[str], Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    path = blank_audio("mp3")

    monkeypatch.setattr(mutagen, "File", locked_by_another_process)

    with pytest.raises(TagsWriteError, match="tags not written") as error:
        write_tags(path, project_tags(BEATPORT), None)

    assert error.value.reason is FileFailureReason.FILE_LOCKED


def test_reports_a_file_held_by_another_program_as_locked(
    blank_audio: Callable[[str], Path],
) -> None:
    path = blank_audio("mp3")
    before = path.read_bytes()

    with held_open(path), pytest.raises(TagsWriteError) as error:
        write_tags(path, project_tags(BEATPORT), None)

    assert error.value.reason is FileFailureReason.FILE_LOCKED
    assert path.read_bytes() == before


def test_keeps_permission_denied_for_a_read_only_file(
    blank_audio: Callable[[str], Path],
) -> None:
    path = blank_audio("mp3")
    path.chmod(stat.S_IREAD)

    with pytest.raises(TagsWriteError) as error:
        write_tags(path, project_tags(BEATPORT), None)

    assert error.value.reason is FileFailureReason.PERMISSION_DENIED


def test_names_a_full_disk_met_while_saving(
    blank_audio: Callable[[str], Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    path = blank_audio("mp3")

    def full_disk(_self: MP3, *_args: object, **_kwargs: object) -> None:
        raise MutagenError("no space") from OSError(errno.ENOSPC, "No space left on device")

    monkeypatch.setattr(MP3, "save", full_disk)

    with pytest.raises(TagsWriteError) as error:
        write_tags(path, project_tags(BEATPORT), None)

    assert error.value.reason is FileFailureReason.DISK_FULL
    assert error.value.params == {"file": "track.mp3", "reason": FileFailureReason.DISK_FULL}


def test_refuses_a_container_outside_the_four_formats(tmp_path: Path) -> None:
    path = write_tagged_wavpack(tmp_path / "track.wav")
    before = path.read_bytes()

    with pytest.raises(TagsWriteError) as error:
        write_tags(path, project_tags(BEATPORT), None)

    assert error.value.reason is FileFailureReason.WRITE_FAILED
    assert path.read_bytes() == before


@pytest.mark.parametrize("name", ["notes.mp3", "notes.txt"], ids=["corrupt-mp3", "unknown"])
def test_refuses_a_file_that_is_not_audio(tmp_path: Path, name: str) -> None:
    path = tmp_path / name
    path.write_bytes(b"not an audio file" * 16)

    with pytest.raises(TagsWriteError) as error:
        write_tags(path, project_tags(BEATPORT), None)

    assert error.value.reason is FileFailureReason.WRITE_FAILED
