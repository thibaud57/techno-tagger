"""Tests du renommage d'un fichier ecrit, calcul du nom puis application sur le disque."""

from pathlib import Path
from typing import Final

import pytest
from audio_samples import held_open
from path_limits import folder_leaving
from rename_samples import rename_now

from tagger.core.file_failures import FileFailureReason
from tagger.tags.renaming import (
    MAX_PATH_LENGTH,
    OriginalNameTakenError,
    RenamedTrack,
    RenameError,
    TrackFileName,
    plan_rename,
    restore_name,
    track_file_name,
)

ARTIST: Final = "Adam Beyer"
TITLE: Final = "Your Mind (Extended Mix)"
TARGET: Final = "Adam Beyer - Your Mind (Extended Mix).mp3"
ORIGINAL_NAME: Final = "01 - untitled.mp3"
LONG_TITLE: Final = "Your Mind (Layton Giordani Extended Remix)"
# Hors du plan multilingue de base : deux unites UTF-16, comme NTFS et MAX_PATH le comptent.
FIRE: Final = "🔥"
EXTENDED_PREFIX: Final = "\\\\?\\"
# Un dossier de 300 caracteres ne laisse aucune place au nom.
NO_ROOM_PATH: Final = Path("C:/") / ("x" * 300) / "track.mp3"


def _file(folder: Path, name: str, content: bytes = b"audio") -> Path:
    path = folder / name
    path.write_bytes(content)
    return path


@pytest.mark.parametrize(
    ("artist", "title", "expected"),
    [
        ("QX/RT", "Down In Amber", "QX-RT - Down In Amber.mp3"),
        ("Someone", "Mind: Body (Who? Remix)", "Someone - Mind - Body (Who Remix).mp3"),
        ("Someone", '"Kick" *Edit*', "Someone - 'Kick' Edit.mp3"),
        ("A\\B", "C|D", "A-B - C-D.mp3"),
        ("Someone", "12:00 <Live>", "Someone - 12-00 Live.mp3"),
        ("Some\tone", "Bell\x07 Ring", "Some one - Bell Ring.mp3"),
        ("Mr. Zeff", "Slow Haze.", "Mr. Zeff - Slow Haze.mp3"),
        ("Adam  Beyer", "Your   Mind", "Adam Beyer - Your Mind.mp3"),
        ("Someone", "Re-", "Someone - Re-.mp3"),
    ],
    ids=[
        "slash",
        "colon-and-question-mark",
        "quotes-and-star",
        "backslash-and-pipe",
        "bare-colon-and-angles",
        "control-characters",
        "trailing-dot",
        "repeated-spaces",
        "trailing-hyphen",
    ],
)
def test_replaces_the_characters_windows_forbids_readably(
    artist: str, title: str, expected: str
) -> None:
    named = track_file_name(artist, title, ".mp3", room=255)

    assert named == TrackFileName(expected, truncated=False)


@pytest.mark.parametrize(
    ("suffix", "expected"), [(".MP3", ".mp3"), (".Flac", ".flac"), (".AIF", ".aif")]
)
def test_lowercases_the_extension(suffix: str, expected: str) -> None:
    named = track_file_name(ARTIST, "Your Mind", suffix, room=255)

    assert named == TrackFileName(f"Adam Beyer - Your Mind{expected}", truncated=False)


@pytest.mark.parametrize(
    ("title", "room", "copy", "expected"),
    [
        (LONG_TITLE, 30, 1, TrackFileName("Adam Beyer - Your Mind (La.mp3", truncated=True)),
        ("Your Mind", 17, 1, TrackFileName("Adam Beyer.mp3", truncated=True)),
        (LONG_TITLE, 30, 2, TrackFileName("Adam Beyer - Your Mind (2).mp3", truncated=True)),
        ("Your Mind", 255, 2, TrackFileName("Adam Beyer - Your Mind (2).mp3", truncated=False)),
        (FIRE * 4, 24, 1, TrackFileName(f"Adam Beyer - {FIRE * 3}.mp3", truncated=True)),
    ],
    ids=[
        "cut-title",
        "cut-loose-end",
        "cut-title-with-marker",
        "marker-before-extension",
        "emoji-counted-twice",
    ],
)
def test_fits_the_name_in_the_room(
    title: str, room: int, copy: int, expected: TrackFileName
) -> None:
    named = track_file_name(ARTIST, title, ".mp3", room=room, copy=copy)

    assert named == expected


@pytest.mark.parametrize(
    ("artist", "title"),
    [
        ("", "Tarantula"),
        ("Adam Beyer", ""),
        ("???", "Tarantula"),
        ("Adam Beyer", "*"),
        ("Adam Beyer", "..."),
    ],
    ids=[
        "no-artist",
        "no-title",
        "artist-of-forbidden-characters",
        "title-of-forbidden-characters",
        "title-of-dots",
    ],
)
def test_names_nothing_without_an_artist_and_a_title(artist: str, title: str) -> None:
    named = track_file_name(artist, title, ".mp3", room=255)

    assert named is None


@pytest.mark.parametrize(
    ("room", "copy"),
    [(4, 1), (3, 1), (8, 2), (5, 2)],
    ids=[
        "extension-fills-the-room",
        "extension-overflows",
        "marker-fills-the-room",
        "marker-overflows",
    ],
)
def test_names_nothing_when_the_extension_and_the_marker_leave_no_room(
    room: int, copy: int
) -> None:
    named = track_file_name(ARTIST, TITLE, ".mp3", room=room, copy=copy)

    assert named is None


def test_plans_the_target_without_touching_the_disk(tmp_path: Path) -> None:
    path = _file(tmp_path, "adam beyer - your mind.MP3")

    plan = plan_rename(path, ARTIST, TITLE)

    assert plan is not None
    assert (plan.target, plan.truncated) == (tmp_path / TARGET, False)
    assert [entry.name for entry in tmp_path.iterdir()] == [path.name]


def test_renames_the_file_in_its_folder_when_the_plan_is_applied(tmp_path: Path) -> None:
    path = _file(tmp_path, "adam beyer - your mind.MP3")

    renamed = rename_now(path, ARTIST, TITLE)

    assert renamed == RenamedTrack(tmp_path / TARGET, truncated=False)
    assert [entry.name for entry in tmp_path.iterdir()] == [TARGET]


def test_leaves_a_correctly_named_file_alone(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = _file(tmp_path, TARGET)
    renames: list[Path] = []
    monkeypatch.setattr(Path, "rename", lambda source, _target: renames.append(source))

    plan = plan_rename(path, ARTIST, TITLE)

    assert plan is None
    assert renames == []


def test_fixes_the_case_without_a_copy_marker(tmp_path: Path) -> None:
    path = _file(tmp_path, "adam beyer - your mind (extended mix).mp3")

    renamed = rename_now(path, ARTIST, TITLE)

    assert renamed.path == tmp_path / TARGET
    assert [entry.name for entry in tmp_path.iterdir()] == [TARGET]


def test_adds_a_copy_marker_on_collision(tmp_path: Path) -> None:
    _file(tmp_path, TARGET, b"existing")
    second = _file(tmp_path, "second.mp3")
    third = _file(tmp_path, "third.mp3")

    renamed = [rename_now(second, ARTIST, TITLE), rename_now(third, ARTIST, TITLE)]

    assert [track.path.name for track in renamed] == [
        "Adam Beyer - Your Mind (Extended Mix) (2).mp3",
        "Adam Beyer - Your Mind (Extended Mix) (3).mp3",
    ]
    assert (tmp_path / TARGET).read_bytes() == b"existing"


def test_renames_through_the_extended_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = _file(tmp_path, "track.mp3")
    calls: list[tuple[str, str]] = []
    monkeypatch.setattr(
        Path, "rename", lambda source, target: calls.append((str(source), str(target)))
    )

    renamed = rename_now(path, ARTIST, TITLE)

    assert len(calls) == 1
    assert all(argument.startswith(EXTENDED_PREFIX) for argument in calls[0])
    assert not str(renamed.path).startswith(EXTENDED_PREFIX)


def test_cuts_a_name_that_would_exceed_the_path_limit(tmp_path: Path) -> None:
    folder = folder_leaving(tmp_path, room=40)
    path = _file(folder, "track.mp3")

    renamed = rename_now(path, ARTIST, LONG_TITLE)

    assert renamed.truncated
    assert len(renamed.path.name) == 40
    assert len(str(renamed.path)) <= MAX_PATH_LENGTH
    assert renamed.path.is_file()


def test_keeps_the_copy_marker_within_the_path_limit(tmp_path: Path) -> None:
    folder = folder_leaving(tmp_path, room=40)
    rename_now(_file(folder, "first.mp3"), ARTIST, LONG_TITLE)

    renamed = rename_now(_file(folder, "second.mp3"), ARTIST, LONG_TITLE)

    assert renamed.path.name.endswith(" (2).mp3")
    assert len(str(renamed.path)) <= MAX_PATH_LENGTH


@pytest.mark.parametrize(
    ("artist", "title"),
    [(None, "Tarantula"), ("Adam Beyer", None), ("???", "Tarantula")],
    ids=["no-artist", "no-title", "artist-of-forbidden-characters"],
)
def test_keeps_the_name_without_an_artist_or_a_title(
    tmp_path: Path, artist: str | None, title: str | None
) -> None:
    path = _file(tmp_path, "rip_0042.wav")

    plan = plan_rename(path, artist, title)

    assert plan is None
    assert path.is_file()


def test_keeps_the_name_without_an_artist_even_when_the_folder_leaves_no_room() -> None:
    plan = plan_rename(NO_ROOM_PATH, None, "Tarantula")

    assert plan is None


def test_raises_path_too_long_when_the_folder_leaves_no_room() -> None:
    with pytest.raises(RenameError, match="file not renamed") as error:
        plan_rename(NO_ROOM_PATH, ARTIST, TITLE)

    assert error.value.reason is FileFailureReason.PATH_TOO_LONG


def test_raises_path_too_long_when_the_copy_marker_overflows_a_tiny_room(tmp_path: Path) -> None:
    folder = folder_leaving(tmp_path, room=6)
    rename_now(_file(folder, "first.mp3"), ARTIST, TITLE)
    second = _file(folder, "second.mp3")

    with pytest.raises(RenameError) as error:
        plan_rename(second, ARTIST, TITLE)

    assert error.value.reason is FileFailureReason.PATH_TOO_LONG
    assert second.is_file()


def test_raises_file_locked_and_keeps_the_name_of_a_held_file(tmp_path: Path) -> None:
    path = _file(tmp_path, "track.mp3")

    plan = plan_rename(path, ARTIST, TITLE)
    assert plan is not None

    with held_open(path), pytest.raises(RenameError) as error:
        plan.apply()

    assert error.value.params == {"file": "track.mp3", "reason": FileFailureReason.FILE_LOCKED}
    assert [entry.name for entry in tmp_path.iterdir()] == ["track.mp3"]


@pytest.mark.parametrize("present", [(), (TARGET,)], ids=["free-target", "taken-target"])
def test_raises_file_missing_for_a_vanished_file(tmp_path: Path, present: tuple[str, ...]) -> None:
    """Une cible deja prise force la comparaison au fichier source, absent lui aussi."""
    for name in present:
        _file(tmp_path, name)
    path = tmp_path / "gone.mp3"

    with pytest.raises(RenameError) as error:
        rename_now(path, ARTIST, TITLE)

    assert error.value.reason is FileFailureReason.FILE_MISSING


def test_keeps_a_name_already_suffixed_by_a_previous_run(tmp_path: Path) -> None:
    _file(tmp_path, TARGET)
    path = _file(tmp_path, "Adam Beyer - Your Mind (Extended Mix) (2).mp3")

    plan = plan_rename(path, ARTIST, TITLE)

    assert plan is None


def test_gives_the_file_back_its_original_name(tmp_path: Path) -> None:
    current = _file(tmp_path, TARGET)

    restore_name(current, tmp_path / ORIGINAL_NAME)

    assert [entry.name for entry in tmp_path.iterdir()] == [ORIGINAL_NAME]


def test_gives_back_a_name_that_differs_only_by_case(tmp_path: Path) -> None:
    current = _file(tmp_path, "Adam Beyer - Your Mind.mp3")

    restore_name(current, tmp_path / "adam beyer - your mind.mp3")

    assert [entry.name for entry in tmp_path.iterdir()] == ["adam beyer - your mind.mp3"]


def test_refuses_an_original_name_taken_by_another_file(tmp_path: Path) -> None:
    current = _file(tmp_path, TARGET)
    _file(tmp_path, ORIGINAL_NAME, b"newcomer")

    with pytest.raises(OriginalNameTakenError) as error:
        restore_name(current, tmp_path / ORIGINAL_NAME)

    assert error.value.params == {"file": ORIGINAL_NAME}
    assert current.read_bytes() == b"audio"
    assert (tmp_path / ORIGINAL_NAME).read_bytes() == b"newcomer"


def test_reports_a_vanished_file_instead_of_leaking_an_os_error(tmp_path: Path) -> None:
    _file(tmp_path, ORIGINAL_NAME, b"newcomer")

    with pytest.raises(RenameError) as error:
        restore_name(tmp_path / TARGET, tmp_path / ORIGINAL_NAME)

    assert error.value.reason is FileFailureReason.FILE_MISSING
