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
    query = build_query("Lior Vance", title, "track.mp3")
    assert query is not None
    return query.title


def _artist(artist: str) -> str:
    query = build_query(artist, "Dim Orbit", "track.mp3")
    assert query is not None
    return query.artist


def test_builds_the_query_from_clean_tags() -> None:
    query = build_query("Lior Vance", "Dim Orbit", "track.mp3")

    assert query == TrackQuery(artist="Lior Vance", title="Dim Orbit", origin=QueryOrigin.TAGS)
    assert query.text == "Lior Vance Dim Orbit"


@pytest.mark.parametrize(
    "title",
    ["Dim Orbit [FREE DL]", "Dim Orbit (Free Download)", "Dim Orbit free_dl"],
    ids=["brackets", "parentheses", "bare"],
)
def test_removes_download_mentions_whatever_their_delimiter(title: str) -> None:
    cleaned = _title(title)

    assert cleaned == "Dim Orbit"


@pytest.mark.parametrize(
    "title",
    ["Dim Orbit (320kbps)", "Dim Orbit 320", "Dim Orbit FLAC", "Dim Orbit [wav]", "Dim Orbit mp3"],
    ids=["kbps", "bitrate", "flac", "wav", "mp3"],
)
def test_removes_encoding_markers_as_whole_words(title: str) -> None:
    cleaned = _title(title)

    assert cleaned == "Dim Orbit"


@pytest.mark.parametrize(
    "title", ["Dim Orbit [Kestrel]", "Dim Orbit [HARD TECHNO]"], ids=["label", "genre"]
)
def test_removes_a_free_group_such_as_a_label_or_a_genre(title: str) -> None:
    cleaned = _title(title)

    assert cleaned == "Dim Orbit"


@pytest.mark.parametrize("word", GUARD_WORDS)
def test_keeps_a_group_holding_a_version_mention(word: str) -> None:
    title = f"Dim Orbit (Special {word}) [FREE DL]"

    cleaned = _title(title)

    assert cleaned == f"Dim Orbit (Special {word})"


@pytest.mark.parametrize("word", INFLECTED_GUARD_WORDS)
def test_keeps_a_group_holding_an_inflected_version_mention(word: str) -> None:
    title = f"Dim Orbit ({word}) [Kestrel]"

    cleaned = _title(title)

    assert cleaned == f"Dim Orbit ({word})"


def test_keeps_a_dj_tool_marker() -> None:
    cleaned = _title("The Neon Signal (DJ Tool) [FOURTOFIVE]")

    assert cleaned == "The Neon Signal (DJ Tool)"


@pytest.mark.parametrize(
    "title",
    ["Dim Orbit (Mixture) [Kestrel]", "Dim Orbit (Introspective) [Kestrel]"],
    ids=["mix-inside-a-word", "intro-inside-a-word"],
)
def test_removes_a_group_whose_only_match_is_inside_a_longer_word(title: str) -> None:
    cleaned = _title(title)

    assert cleaned == "Dim Orbit"


@pytest.mark.parametrize("word", COLLABORATION_WORDS)
def test_keeps_a_group_holding_a_collaboration_mention(word: str) -> None:
    title = f"Dim Orbit ({word} Wren Tolliver) [Kestrel]"

    cleaned = _title(title)

    assert cleaned == f"Dim Orbit ({word} Wren Tolliver)"


@pytest.mark.parametrize(
    "title",
    ["Dim Orbit (VIP-Mix)", "Dim Orbit (Radio-Edit)"],
    ids=["vip-mix", "radio-edit"],
)
def test_keeps_a_group_holding_a_guard_word_welded_to_a_hyphen(title: str) -> None:
    cleaned = _title(title)

    assert cleaned == title


@pytest.mark.parametrize(
    ("title", "expected"),
    [
        ("Dim Orbit (Extended Mix", "Dim Orbit (Extended Mix"),
        ("Dim Orbit [Label (2023)]", "Dim Orbit [Label ]"),
    ],
    ids=["unclosed", "nested"],
)
def test_leaves_an_unclosed_or_nested_group_as_is(title: str, expected: str) -> None:
    cleaned = _title(title)

    assert cleaned == expected


@pytest.mark.parametrize(
    ("artist", "expected"),
    [
        ("Velmora x Orla Quenby", "Velmora, Orla Quenby"),
        ("Lior Vance X Mara Quill", "Lior Vance, Mara Quill"),
        ("Orla Quenby × Velmora", "Orla Quenby, Velmora"),  # noqa: RUF001
        ("Lior Vance;Mara Quill", "Lior Vance, Mara Quill"),
        ("Lior Vance / Mara Quill", "Lior Vance, Mara Quill"),
        ("Lumen and Grains", "Lumen, Grains"),
        ("Lior Vance vs. Mara Quill", "Lior Vance, Mara Quill"),
        ("Lior Vance feat. Wren Tolliver", "Lior Vance, Wren Tolliver"),
        ("Lior Vance ft. Wren Tolliver", "Lior Vance, Wren Tolliver"),
        ("Lior Vance featuring Wren Tolliver", "Lior Vance, Wren Tolliver"),
    ],
    ids=[
        "x",
        "upper-x",
        "times",
        "semicolon",
        "slash",
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


@pytest.mark.parametrize(
    ("artist", "expected"),
    [
        ("ZENO (UK)", "ZENO (UK)"),
        ("Valdor (ES)", "Valdor (ES)"),
        ("Lior Vance [Kestrel]", "Lior Vance"),
        ("Lior Vance [FREE DL]", "Lior Vance"),
    ],
    ids=["regional-suffix", "another-suffix", "label", "download-noise"],
)
def test_keeps_parentheses_of_an_artist_name_but_drops_brackets(artist: str, expected: str) -> None:
    """Une parenthese designe l'artiste, un crochet porte un label ou du bruit."""
    normalised = _artist(artist)

    assert normalised == expected


@pytest.mark.parametrize("artist", ["Kay-Q", "Zed Marlo", "Torvex", "Elk & Ivo"])
def test_never_splits_a_name_without_spaced_separator(artist: str) -> None:
    normalised = _artist(artist)

    assert normalised == artist


def test_falls_back_on_the_raw_tag_when_cleaning_empties_it() -> None:
    query = build_query("Lior Vance", "[FREE DL]", "track.mp3")

    assert query == TrackQuery(artist="Lior Vance", title="[FREE DL]", origin=QueryOrigin.TAGS)


def test_falls_back_on_the_file_name_when_a_tag_has_no_letter() -> None:
    query = build_query("", "Dim Orbit", "lior vance - dim orbit.mp3")

    assert query == TrackQuery(artist="lior vance", title="dim orbit", origin=QueryOrigin.FILENAME)


def test_replaces_underscores_in_a_file_name_without_spaces() -> None:
    query = build_query("", "", "lior_vance_-_dim_orbit.mp3")

    assert query is not None
    assert (query.artist, query.title) == ("lior vance", "dim orbit")


def test_strips_a_leading_track_number_and_the_noise_of_a_file_name() -> None:
    query = build_query("", "", "05 oswald duskhaven - lose your step (320kbps).mp3")

    assert query is not None
    assert (query.artist, query.title) == ("oswald duskhaven", "lose your step")


@pytest.mark.parametrize(
    ("file_name", "artist"),
    [("999999999 - Title.mp3", "999999999"), ("707 Fable - Estuary.mp3", "707 Fable")],
    ids=["nine-digits", "three-digits"],
)
def test_keeps_a_numeric_artist_that_is_not_a_track_number(file_name: str, artist: str) -> None:
    query = build_query("", "", file_name)

    assert query is not None
    assert query.artist == artist


def test_splits_the_file_name_on_the_first_spaced_dash() -> None:
    query = build_query("", "", "Kay-Q - Title.flac")

    assert query is not None
    assert (query.artist, query.title) == ("Kay-Q", "Title")


def test_puts_the_whole_file_name_in_the_title_without_a_spaced_dash() -> None:
    query = build_query("", "", "10-tide-glow.mp3")

    assert query == TrackQuery(artist="", title="tide-glow", origin=QueryOrigin.FILENAME)


@pytest.mark.parametrize(
    "file_name", ["01 - [FREE DL].mp3", "320kbps.mp3"], ids=["free-dl", "bitrate"]
)
def test_returns_no_query_for_a_file_name_reduced_to_noise(file_name: str) -> None:
    query = build_query("", "", file_name)

    assert query is None
