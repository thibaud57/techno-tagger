import errno
import stat
from typing import TYPE_CHECKING, Final

import mutagen
import pytest
from audio_samples import (
    ALL_FORMATS,
    ID3_VORBIS_FORMATS,
    append_id3v1,
    held_open,
    id3_as_written,
    locked_by_another_process,
    mutagen_refusing,
    preset_tags,
    write_not_audio,
    write_tagged_wavpack,
)
from cdn_doubles import JPEG, write_cover
from mutagen.flac import FLAC, Picture
from mutagen.id3 import APIC, COMM, TDRC, TPE2, TXXX, PictureType
from mutagen.mp3 import MP3
from scraper_responses import (
    BEATPORT_CANDIDATE,
    bandcamp_track_payload,
    payload_candidate,
    soundcloud_track_payload,
)

from tagger.core.file_failures import FileFailureReason
from tagger.resolution.scraper_client import TrackCandidate
from tagger.tags.files import (
    TAG_FIELDS,
    TagField,
    TagKeys,
    TagsWriteError,
    project_tags,
    write_tags,
)

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path


def _credit(name: str) -> dict[str, object]:
    return {"id": name, "name": name, "kind": "artist", "social_links": []}


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
    """Valeurs relues sous les cles de la table ; mutagen remonte TYER en TDRC."""
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


def _tag_with_a_full_date(path: Path, id3_version: int) -> None:
    """Fichier tague ailleurs en ID3 v2.3 ou v2.4, date complete comprise."""
    audio = mutagen.File(path)
    audio.add_tags()
    audio.tags.add(TDRC(encoding=3, text=["2019-06-16"]))
    if id3_version == 3:
        audio.tags.update_to_v23()
    audio.save(v2_version=id3_version)


def _pictures(path: Path) -> list[tuple[int, str, bytes]]:
    audio = mutagen.File(path)
    if isinstance(audio, FLAC):
        return [(picture.type, picture.mime, picture.data) for picture in audio.pictures]
    return [(frame.type, frame.mime, frame.data) for frame in audio.tags.getall("APIC")]


def test_projects_every_field_a_beatport_candidate_carries() -> None:
    values = project_tags(BEATPORT_CANDIDATE)

    assert dict(values) == {
        TagField.ARTIST: "Adam Beyer",
        TagField.TITLE: "Your Mind (Extended Mix)",
        TagField.ALBUM: "Your Mind",
        TagField.DATE: "2023",
        TagField.GENRE: "Techno (Peak Time / Driving)",
        TagField.LABEL: "Drumcode",
        TagField.CATALOG_NUMBER: "DC287",
        TagField.BPM: "134",
        TagField.KEY: "4A",
        TagField.ISRC: "ZZ0AA2300001",
        TagField.TRACK_NUMBER: "1",
        TagField.URL: "https://www.beatport.com/track/your-mind/99000101",
        TagField.SOURCE_ID: "99000101",
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


@pytest.mark.parametrize("audio_format", ID3_VORBIS_FORMATS)
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
        TagField.GENRE: TagKeys(id3="TCON", vorbis="GENRE"),
        TagField.LABEL: TagKeys(id3="TPUB", vorbis="LABEL"),
        TagField.CATALOG_NUMBER: TagKeys(id3="TXXX:CATALOGNUMBER", vorbis="CATALOGNUMBER"),
        TagField.BPM: TagKeys(id3="TBPM", vorbis="BPM"),
        TagField.KEY: TagKeys(id3="TKEY", vorbis="KEY", vorbis_mirrors=("INITIALKEY",)),
        TagField.ISRC: TagKeys(id3="TSRC", vorbis="ISRC"),
        TagField.TRACK_NUMBER: TagKeys(id3="TRCK", vorbis="TRACKNUMBER"),
        TagField.URL: TagKeys(id3="WOAS", vorbis="URL"),
        TagField.SOURCE_ID: TagKeys(id3="TXXX:SOURCE_ID", vorbis="SOURCE_ID"),
        TagField.SOURCE: TagKeys(id3="TXXX:SOURCE", vorbis="SOURCE"),
    } == TAG_FIELDS


@pytest.mark.parametrize(
    ("candidate", "omitted"),
    [
        (BANDCAMP, {TagField.GENRE, TagField.BPM, TagField.KEY, TagField.REMIXER}),
        (payload_candidate(genre="   ", key=""), {TagField.GENRE, TagField.KEY}),
        (payload_candidate(bpm=0, track_number=0), {TagField.BPM, TagField.TRACK_NUMBER}),
        (
            payload_candidate(release=None),
            {TagField.ALBUM, TagField.DATE, TagField.CATALOG_NUMBER},
        ),
    ],
    ids=["null-source", "blank-values", "zero-bpm-track", "no-release"],
)
def test_omits_the_fields_the_source_leaves_empty(
    candidate: TrackCandidate, omitted: set[TagField]
) -> None:
    values = project_tags(candidate)

    assert omitted.isdisjoint(values)


@pytest.mark.parametrize(
    ("candidate", "source"),
    [(BANDCAMP, "bandcamp"), (SOUNDCLOUD, "soundcloud")],
    ids=["bandcamp", "soundcloud"],
)
def test_names_the_source_the_candidate_came_from(candidate: TrackCandidate, source: str) -> None:
    values = project_tags(candidate)

    assert values[TagField.SOURCE] == source


def test_projects_what_a_soundcloud_candidate_carries() -> None:
    values = project_tags(SOUNDCLOUD)

    assert (values[TagField.ARTIST], values[TagField.TITLE]) == ("KASIA & Faithless", "Tarantula")
    assert {TagField.GENRE, TagField.BPM, TagField.KEY, TagField.ISRC}.isdisjoint(values)


@pytest.mark.parametrize("audio_format", ALL_FORMATS)
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


@pytest.mark.parametrize("audio_format", ALL_FORMATS[:3])
@pytest.mark.parametrize("version", [3, 4], ids=["from-v23", "from-v24"])
def test_saves_id3_v23_with_the_year_alone(
    blank_audio: Callable[[str], Path], audio_format: str, version: int
) -> None:
    path = blank_audio(audio_format)
    _tag_with_a_full_date(path, version)

    write_tags(path, project_tags(BEATPORT_CANDIDATE), None)

    on_disk = id3_as_written(path)
    assert on_disk.version == (2, 3, 0)
    assert str(on_disk["TYER"]) == "2023"
    # Une seule date au contrat, celle de la sortie : aucune annee d'origine n'est ecrite.
    assert {"TDRC", "TDOR", "TORY", "TDAT"}.isdisjoint(on_disk.keys())


@pytest.mark.parametrize("version", [3, 4], ids=["from-v23", "from-v24"])
def test_keeps_the_file_date_when_the_source_has_none(
    blank_audio: Callable[[str], Path], version: int
) -> None:
    path = blank_audio("mp3")
    _tag_with_a_full_date(path, version)

    write_tags(path, project_tags(payload_candidate(release=None)), None)

    on_disk = id3_as_written(path)
    assert str(on_disk["TYER"]) == "2019"
    assert str(on_disk["TDAT"]) == "1606"


@pytest.mark.parametrize("audio_format", ID3_VORBIS_FORMATS)
def test_keeps_accented_text_intact(blank_audio: Callable[[str], Path], audio_format: str) -> None:
    path = blank_audio(audio_format)
    values = project_tags(payload_candidate(title="Für Éline", mix_name="Señor Remix"))

    write_tags(path, values, None)

    assert _read_back(path)[TagField.TITLE] == "Für Éline (Señor Remix)"


@pytest.mark.parametrize(
    ("stale", "names", "expected"),
    [
        pytest.param(
            ("artist", ["Old One", "Old Two"]), ("ARTIST",), "Adam Beyer", id="case-and-count"
        ),
        pytest.param(
            ("KEY", ["stale"]), ("KEY", "INITIALKEY"), BEATPORT_CANDIDATE.key, id="key-mirror"
        ),
    ],
)
def test_replaces_existing_vorbis_values_under_every_name(
    blank_audio: Callable[[str], Path],
    stale: tuple[str, list[str]],
    names: tuple[str, ...],
    expected: str,
) -> None:
    path = blank_audio("flac")
    audio = FLAC(path)
    audio[stale[0]] = stale[1]
    audio.save()

    write_tags(path, project_tags(BEATPORT_CANDIDATE), None)

    assert [FLAC(path)[name] for name in names] == [[expected]] * len(names)


@pytest.mark.parametrize(
    ("audio_format", "preset"),
    [
        pytest.param("mp3", {"TBPM": "130", "TKEY": "8A"}, id="id3-mp3"),
        pytest.param("flac", {"BPM": "130", "KEY": "8A"}, id="vorbis-flac"),
    ],
)
def test_keeps_the_tags_the_source_leaves_null(
    blank_audio: Callable[[str], Path], audio_format: str, preset: dict[str, str]
) -> None:
    path = blank_audio(audio_format)
    preset_tags(path, **preset)

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

    write_tags(path, project_tags(BEATPORT_CANDIDATE), None)

    tags = mutagen.File(path).tags
    assert (str(tags["TPE2"]), str(tags["TXXX:SERATO_PLAYCOUNT"])) == ("Drumcode", "12")


def test_leaves_the_vorbis_keys_outside_the_table_alone(
    blank_audio: Callable[[str], Path],
) -> None:
    path = blank_audio("flac")
    preset_tags(path, ALBUMARTIST="Drumcode", SERATO_PLAYCOUNT="12")

    write_tags(path, project_tags(BEATPORT_CANDIDATE), None)

    audio = FLAC(path)
    assert (audio["ALBUMARTIST"], audio["SERATO_PLAYCOUNT"]) == (["Drumcode"], ["12"])


def test_removes_every_id3_comment(blank_audio: Callable[[str], Path]) -> None:
    path = blank_audio("mp3")
    audio = mutagen.File(path)
    audio.add_tags()
    audio.tags.add(COMM(encoding=3, lang="eng", desc="", text=["ripped by X"]))
    audio.tags.add(COMM(encoding=3, lang="fra", desc="note", text=["320kbps"]))
    audio.save(v2_version=3)

    write_tags(path, project_tags(BEATPORT_CANDIDATE), None)

    assert not mutagen.File(path).tags.getall("COMM")


def test_removes_every_vorbis_comment(blank_audio: Callable[[str], Path]) -> None:
    path = blank_audio("flac")
    preset_tags(path, COMMENT="ripped by X", DESCRIPTION="320kbps")

    write_tags(path, project_tags(BEATPORT_CANDIDATE), None)

    audio = FLAC(path)
    assert "COMMENT" not in audio
    assert "DESCRIPTION" not in audio


def test_clears_the_comment_of_an_id3v1_tag(blank_audio: Callable[[str], Path]) -> None:
    path = blank_audio("mp3")
    append_id3v1(path, comment="ripped by X")

    write_tags(path, project_tags(BEATPORT_CANDIDATE), None)

    assert b"ripped by X" not in path.read_bytes()


@pytest.mark.parametrize("audio_format", ID3_VORBIS_FORMATS)
def test_replaces_every_picture_with_the_given_cover(
    blank_audio: Callable[[str], Path], tmp_path: Path, audio_format: str
) -> None:
    path = blank_audio(audio_format)
    _add_pictures(path, (PictureType.COVER_BACK, b"back"), (PictureType.COVER_FRONT, b"old front"))
    cover = write_cover(tmp_path)

    written = write_tags(path, project_tags(BEATPORT_CANDIDATE), cover)

    assert _pictures(path) == [(PictureType.COVER_FRONT, "image/jpeg", JPEG)]
    assert written.artwork


@pytest.mark.parametrize("audio_format", ID3_VORBIS_FORMATS)
def test_writing_twice_still_leaves_a_single_cover(
    blank_audio: Callable[[str], Path], tmp_path: Path, audio_format: str
) -> None:
    path = blank_audio(audio_format)
    cover = write_cover(tmp_path)
    write_tags(path, project_tags(BEATPORT_CANDIDATE), cover)

    write_tags(path, project_tags(BEATPORT_CANDIDATE), cover)

    assert _pictures(path) == [(PictureType.COVER_FRONT, "image/jpeg", JPEG)]


def test_tags_the_cover_with_the_mime_of_its_extension(
    blank_audio: Callable[[str], Path], tmp_path: Path
) -> None:
    path = blank_audio("mp3")
    cover = tmp_path / "cover.png"
    cover.write_bytes(b"\x89PNG")

    write_tags(path, project_tags(BEATPORT_CANDIDATE), cover)

    assert _pictures(path) == [(PictureType.COVER_FRONT, "image/png", b"\x89PNG")]


@pytest.mark.parametrize("audio_format", ID3_VORBIS_FORMATS)
@pytest.mark.parametrize(
    ("pictures", "kept"),
    [
        (
            [(PictureType.COVER_BACK, b"back"), (PictureType.COVER_FRONT, b"front")],
            (PictureType.COVER_FRONT, b"front"),
        ),
        (
            [(PictureType.COVER_BACK, b"back"), (PictureType.LEAFLET_PAGE, b"leaflet")],
            (PictureType.COVER_BACK, b"back"),
        ),
    ],
    ids=["front-cover", "first-picture-without-front-cover"],
)
def test_keeps_a_single_picture_without_artwork(
    blank_audio: Callable[[str], Path],
    audio_format: str,
    pictures: list[tuple[int, bytes]],
    kept: tuple[int, bytes],
) -> None:
    path = blank_audio(audio_format)
    _add_pictures(path, *pictures)

    written = write_tags(path, project_tags(BEATPORT_CANDIDATE), None)

    assert _pictures(path) == [(kept[0], "image/png", kept[1])]
    assert not written.artwork


@pytest.mark.parametrize(
    ("name", "prepare"),
    [
        ("cover.jpg", lambda _cover: None),
        ("cover.jpg", lambda cover: cover.mkdir()),
        ("cover.gif", lambda cover: cover.write_bytes(b"GIF89a")),
    ],
    ids=["purged", "unreadable", "foreign"],
)
def test_treats_a_cover_the_cache_cannot_give_as_absent(
    blank_audio: Callable[[str], Path],
    tmp_path: Path,
    name: str,
    prepare: Callable[[Path], object],
) -> None:
    path = blank_audio("mp3")
    _add_pictures(path, (PictureType.COVER_FRONT, b"front"))
    cover = tmp_path / name
    prepare(cover)

    written = write_tags(path, project_tags(BEATPORT_CANDIDATE), cover)

    assert _pictures(path) == [(PictureType.COVER_FRONT, "image/png", b"front")]
    assert not written.artwork
    assert _read_back(path)[TagField.TITLE] == "Your Mind (Extended Mix)"


def test_maps_a_windows_sharing_violation_to_file_locked(
    blank_audio: Callable[[str], Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    path = blank_audio("mp3")

    monkeypatch.setattr(mutagen, "File", locked_by_another_process)

    with pytest.raises(TagsWriteError, match="tags not written") as error:
        write_tags(path, project_tags(BEATPORT_CANDIDATE), None)

    assert error.value.reason is FileFailureReason.FILE_LOCKED


def test_reports_a_file_held_by_another_program_as_locked(
    blank_audio: Callable[[str], Path],
) -> None:
    path = blank_audio("mp3")
    before = path.read_bytes()

    with held_open(path), pytest.raises(TagsWriteError) as error:
        write_tags(path, project_tags(BEATPORT_CANDIDATE), None)

    assert error.value.reason is FileFailureReason.FILE_LOCKED
    assert path.read_bytes() == before


def test_keeps_permission_denied_for_a_read_only_file(
    blank_audio: Callable[[str], Path],
) -> None:
    path = blank_audio("mp3")
    path.chmod(stat.S_IREAD)

    with pytest.raises(TagsWriteError) as error:
        write_tags(path, project_tags(BEATPORT_CANDIDATE), None)

    assert error.value.reason is FileFailureReason.PERMISSION_DENIED


def test_names_a_full_disk_met_while_saving(
    blank_audio: Callable[[str], Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    path = blank_audio("mp3")

    monkeypatch.setattr(
        MP3, "save", mutagen_refusing(OSError(errno.ENOSPC, "No space left on device"))
    )

    with pytest.raises(TagsWriteError) as error:
        write_tags(path, project_tags(BEATPORT_CANDIDATE), None)

    assert error.value.reason is FileFailureReason.DISK_FULL
    assert error.value.params == {"file": "track.mp3", "reason": FileFailureReason.DISK_FULL}


@pytest.mark.parametrize(
    ("name", "build"),
    [
        ("notes.mp3", write_not_audio),
        ("notes.txt", write_not_audio),
        ("track.wav", write_tagged_wavpack),
    ],
    ids=["corrupt-mp3", "unknown", "wavpack"],
)
def test_refuses_a_file_outside_the_four_formats(
    tmp_path: Path, name: str, build: Callable[[Path], Path]
) -> None:
    path = build(tmp_path / name)
    before = path.read_bytes()

    with pytest.raises(TagsWriteError) as error:
        write_tags(path, project_tags(BEATPORT_CANDIDATE), None)

    assert error.value.reason is FileFailureReason.WRITE_FAILED
    assert path.read_bytes() == before
