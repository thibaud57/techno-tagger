"""Tests de la construction de la requete : nettoyage, gardes, repli."""

import pytest

from tagger.matching import QueryOrigin, TrackQuery, build_query

GUARD_WORDS = [
    "mix",
    "remix",
    "edit",
    "version",
    "dub",
    "extended",
    "radio",
    "rework",
    "bootleg",
    "vip",
    "live",
    "instrumental",
    "acapella",
    "reprise",
    "re-edit",
    "remaster",
    "tool",
    "loop",
    "intro",
    "outro",
]
INFLECTED_GUARD_WORDS = ["remastered", "reworked", "remixed", "edited", "tools", "edits"]
COLLABORATION_WORDS = ["feat.", "ft.", "featuring", "with", "pres.", "vs."]


def _title(title: str) -> str:
    query = build_query("Adam Beyer", title, "track.mp3")
    assert query is not None
    return query.title


def _artist(artist: str) -> str:
    query = build_query(artist, "Your Mind", "track.mp3")
    assert query is not None
    return query.artist


def test_builds_the_query_from_clean_tags() -> None:
    query = build_query("Adam Beyer", "Your Mind", "track.mp3")

    assert query == TrackQuery(artist="Adam Beyer", title="Your Mind", origin=QueryOrigin.TAGS)
    assert query.text == "Adam Beyer Your Mind"


@pytest.mark.parametrize(
    "title",
    ["Your Mind [FREE DL]", "Your Mind (Free Download)", "Your Mind free_dl"],
    ids=["brackets", "parentheses", "bare"],
)
def test_removes_download_mentions_whatever_their_delimiter(title: str) -> None:
    cleaned = _title(title)

    assert cleaned == "Your Mind"


@pytest.mark.parametrize(
    "title",
    ["Your Mind (320kbps)", "Your Mind 320", "Your Mind FLAC", "Your Mind [wav]", "Your Mind mp3"],
    ids=["kbps", "bitrate", "flac", "wav", "mp3"],
)
def test_removes_encoding_markers_as_whole_words(title: str) -> None:
    cleaned = _title(title)

    assert cleaned == "Your Mind"


@pytest.mark.parametrize(
    "title", ["Your Mind [Drumcode]", "Your Mind [HARD TECHNO]"], ids=["label", "genre"]
)
def test_removes_a_free_group_such_as_a_label_or_a_genre(title: str) -> None:
    cleaned = _title(title)

    assert cleaned == "Your Mind"


@pytest.mark.parametrize("word", GUARD_WORDS)
def test_keeps_a_group_holding_a_version_mention(word: str) -> None:
    title = f"Your Mind (Special {word}) [FREE DL]"

    cleaned = _title(title)

    assert cleaned == f"Your Mind (Special {word})"


@pytest.mark.parametrize("word", INFLECTED_GUARD_WORDS)
def test_keeps_a_group_holding_an_inflected_version_mention(word: str) -> None:
    title = f"Your Mind ({word}) [Drumcode]"

    cleaned = _title(title)

    assert cleaned == f"Your Mind ({word})"


def test_keeps_a_dj_tool_marker() -> None:
    cleaned = _title("The Techno Code (DJ Tool) [NINETOZERO]")

    assert cleaned == "The Techno Code (DJ Tool)"


@pytest.mark.parametrize(
    "title",
    ["Your Mind (Mixture) [Drumcode]", "Your Mind (Introspective) [Drumcode]"],
    ids=["mix-inside-a-word", "intro-inside-a-word"],
)
def test_removes_a_group_whose_only_match_is_inside_a_longer_word(title: str) -> None:
    cleaned = _title(title)

    assert cleaned == "Your Mind"


@pytest.mark.parametrize("word", COLLABORATION_WORDS)
def test_keeps_a_group_holding_a_collaboration_mention(word: str) -> None:
    title = f"Your Mind ({word} Roisin Murphy) [Drumcode]"

    cleaned = _title(title)

    assert cleaned == f"Your Mind ({word} Roisin Murphy)"


@pytest.mark.parametrize(
    "title",
    ["Your Mind (VIP-Mix)", "Your Mind (Radio-Edit)"],
    ids=["vip-mix", "radio-edit"],
)
def test_keeps_a_group_holding_a_guard_word_welded_to_a_hyphen(title: str) -> None:
    cleaned = _title(title)

    assert cleaned == title


@pytest.mark.parametrize(
    ("title", "expected"),
    [
        ("Your Mind (Extended Mix", "Your Mind (Extended Mix"),
        ("Your Mind [Label (2023)]", "Your Mind [Label ]"),
    ],
    ids=["unclosed", "nested"],
)
def test_leaves_an_unclosed_or_nested_group_as_is(title: str, expected: str) -> None:
    cleaned = _title(title)

    assert cleaned == expected


@pytest.mark.parametrize(
    ("artist", "expected"),
    [
        ("Farrago x Amelie Lens", "Farrago, Amelie Lens"),
        ("Adam Beyer X Bart Skils", "Adam Beyer, Bart Skils"),
        ("Amelie Lens × Farrago", "Amelie Lens, Farrago"),  # noqa: RUF001
        ("Adam Beyer;Bart Skils", "Adam Beyer, Bart Skils"),
        ("Adam Beyer / Bart Skils", "Adam Beyer, Bart Skils"),
        ("Chase & Status", "Chase, Status"),
        ("Chase and Status", "Chase, Status"),
        ("Adam Beyer vs. Bart Skils", "Adam Beyer, Bart Skils"),
        ("Adam Beyer feat. Roisin Murphy", "Adam Beyer, Roisin Murphy"),
        ("Adam Beyer ft. Roisin Murphy", "Adam Beyer, Roisin Murphy"),
        ("Adam Beyer featuring Roisin Murphy", "Adam Beyer, Roisin Murphy"),
    ],
    ids=[
        "x",
        "upper-x",
        "times",
        "semicolon",
        "slash",
        "ampersand",
        "and",
        "vs",
        "feat",
        "ft",
        "featuring",
    ],
)
def test_normalises_artist_separators_to_a_comma(artist: str, expected: str) -> None:
    normalised = _artist(artist)

    assert normalised == expected


@pytest.mark.parametrize("artist", ["Jay-Z", "Jax Jones", "Axwell"])
def test_never_splits_a_name_without_spaced_separator(artist: str) -> None:
    normalised = _artist(artist)

    assert normalised == artist


def test_falls_back_on_the_raw_tag_when_cleaning_empties_it() -> None:
    query = build_query("Adam Beyer", "[FREE DL]", "track.mp3")

    assert query == TrackQuery(artist="Adam Beyer", title="[FREE DL]", origin=QueryOrigin.TAGS)


def test_falls_back_on_the_file_name_when_a_tag_has_no_letter() -> None:
    query = build_query("", "Your Mind", "adam beyer - your mind.mp3")

    assert query == TrackQuery(artist="adam beyer", title="your mind", origin=QueryOrigin.FILENAME)


def test_replaces_underscores_in_a_file_name_without_spaces() -> None:
    query = build_query("", "", "adam_beyer_-_your_mind.mp3")

    assert query is not None
    assert (query.artist, query.title) == ("adam beyer", "your mind")


def test_strips_a_leading_track_number_and_the_noise_of_a_file_name() -> None:
    query = build_query("", "", "05 reinier zonneveld - move your body (320kbps).mp3")

    assert query is not None
    assert (query.artist, query.title) == ("reinier zonneveld", "move your body")


@pytest.mark.parametrize(
    ("file_name", "artist"),
    [("999999999 - Title.mp3", "999999999"), ("808 State - Pacific.mp3", "808 State")],
    ids=["nine-digits", "three-digits"],
)
def test_keeps_a_numeric_artist_that_is_not_a_track_number(file_name: str, artist: str) -> None:
    query = build_query("", "", file_name)

    assert query is not None
    assert query.artist == artist


def test_splits_the_file_name_on_the_first_spaced_dash() -> None:
    query = build_query("", "", "Jay-Z - Title.flac")

    assert query is not None
    assert (query.artist, query.title) == ("Jay-Z", "Title")


def test_puts_the_whole_file_name_in_the_title_without_a_spaced_dash() -> None:
    query = build_query("", "", "10-sama-rise.mp3")

    assert query == TrackQuery(artist="", title="sama-rise", origin=QueryOrigin.FILENAME)


@pytest.mark.parametrize(
    "file_name", ["01 - [FREE DL].mp3", "320kbps.mp3"], ids=["free-dl", "bitrate"]
)
def test_returns_no_query_for_a_file_name_reduced_to_noise(file_name: str) -> None:
    query = build_query("", "", file_name)

    assert query is None
