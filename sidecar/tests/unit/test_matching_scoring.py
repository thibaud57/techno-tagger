"""Tests du scoring et du classement des candidats."""

from typing import TYPE_CHECKING

import pytest
from scraper_responses import track_candidate

from tagger.matching import (
    MatchingThresholds,
    Outcome,
    QueryOrigin,
    TrackQuery,
    classify,
)

if TYPE_CHECKING:
    from tagger.scraper_client import TrackCandidate

DIM_ORBIT = TrackQuery(artist="Lior Vance", title="Dim Orbit", origin=QueryOrigin.TAGS)


@pytest.mark.parametrize(
    ("tagged", "title", "mix_name", "credited"),
    [
        ("Lior Vance", "Dim Orbit", "KLVR Remix", ("Lior Vance", "Mara Quill", "KLVR")),
        ("Quorin", "Tamarin", "Original Mix", ("Quorin", "ZRVK")),
    ],
    ids=["other-artists", "label-credited-as-an-artist"],
)
def test_matches_a_candidate_crediting_more_than_the_tag(
    tagged: str, title: str, mix_name: str, credited: tuple[str, ...]
) -> None:
    """Un tag ne nomme qu'un artiste la ou la source credite tout le monde, label compris."""
    query = TrackQuery(tagged, f"{title} ({mix_name})", QueryOrigin.TAGS)

    classification = classify(query, [track_candidate(title, mix_name, artists=credited)])

    assert classification.outcome is Outcome.AUTO


def test_cleans_the_candidate_title_like_the_query_before_comparing() -> None:
    """techno-scraper garde un sous-titre que la requete retire : sans le meme `_clean` sur
    le candidat, la comparaison tomberait sous le plancher."""
    query = TrackQuery("Kovari", "SLTD (Silver Satin Remix)", QueryOrigin.TAGS)
    patt = track_candidate("SLTD (Slow Light Turns Dim)", "Silver Satin Remix", artists=("Kovari",))

    classification = classify(query, [patt])

    assert classification.outcome is Outcome.AUTO


def test_ignores_spacing_around_a_version_label() -> None:
    """Regression : « ( Original Mix ) » ne s'annulait pas et bloquait l'auto."""
    query = TrackQuery("Lior Vance", "Dim Orbit ( Original Mix )", QueryOrigin.TAGS)

    classification = classify(query, [track_candidate("Dim Orbit", "Original Mix")])

    assert classification.outcome is Outcome.AUTO


def test_keeps_every_version_group_of_a_title() -> None:
    """Regression : un second groupe ecrasait le premier, « (Live) » disparaissait."""
    query = TrackQuery("Lior Vance", "Dim Orbit (Live) (Dub)", QueryOrigin.TAGS)

    classification = classify(query, [track_candidate("Dim Orbit", "Live Dub")])

    assert classification.outcome is Outcome.AUTO


def test_guards_a_remix_named_outside_any_group() -> None:
    """Regression : sans parentheses, la garde ne voyait plus le remix demande."""
    query = TrackQuery("Lior Vance", "Dim Orbit Mara Quill Remix", QueryOrigin.TAGS)

    classification = classify(query, [track_candidate("Dim Orbit", "Original Mix")])

    assert classification.scored == ()


@pytest.mark.parametrize(
    ("tagged_title", "mix_name"),
    [
        ("Dim Orbit (Extended Mix feat. Wren Tolliver)", "Extended Mix"),
        ("Dim Orbit (Extended Mix feat. Radio Ember)", "Extended Mix"),
        ("Dim Orbit (Extended Mix with Wren Tolliver)", "Extended Mix with Wren Tolliver"),
        ("Dim Orbit (Lior Vance pres. Kestrel Remix)", "Lior Vance pres. Kestrel Remix"),
        ("Dim Orbit (Corin Hallwyn vs Swifty Q Remix)", "Corin Hallwyn vs Swifty Q Remix"),
    ],
    ids=["feat", "feat-guest-first-word-is-a-version", "with", "pres", "vs"],
)
def test_reads_the_version_of_a_group_that_also_names_a_guest(
    tagged_title: str, mix_name: str
) -> None:
    """Un credit de remix a deux noms reste une version, pas un morceau different.

    Regression : le groupe mixte etait laisse entier dans le titre pour ne pas emporter
    l'invite avec la version, ce qui perdait la version et collait au titre compare une
    parenthese jamais fermee. « X vs Y Remix » et « A pres. B Remix » sont des credits
    courants, le morceau partait donc en non resolu contre son propre candidat.
    """
    query = TrackQuery("Lior Vance", tagged_title, QueryOrigin.TAGS)

    classification = classify(query, [track_candidate("Dim Orbit", mix_name)])

    assert classification.outcome is Outcome.AUTO


@pytest.mark.parametrize(
    ("query_title", "candidate_title", "mix_name"),
    [
        ("Dim Orbit (Extended Mix)", "Dim Orbit", "Extended Mix"),
        ("Dim Orbit [Extended Mix]", "Dim Orbit", "Extended Mix"),
    ],
    ids=["parentheses", "square-brackets"],
)
def test_matches_a_version_however_the_tag_writes_it(
    query_title: str, candidate_title: str, mix_name: str
) -> None:
    query = TrackQuery("Lior Vance", query_title, QueryOrigin.TAGS)

    classification = classify(query, [track_candidate(candidate_title, mix_name)])

    assert classification.outcome is Outcome.AUTO
    assert classification.retained[0].title_score == 100


def test_matches_an_original_mix_against_a_query_without_version() -> None:
    classification = classify(DIM_ORBIT, [track_candidate("Dim Orbit", "Original Mix")])

    assert classification.outcome is Outcome.AUTO
    assert classification.retained[0].version_mismatch is False


def test_keeps_other_versions_in_the_grey_zone_for_a_query_without_version() -> None:
    candidates = [
        track_candidate("Dim Orbit", "Extended Mix"),
        track_candidate("Dim Orbit", "Radio Edit"),
    ]

    classification = classify(DIM_ORBIT, candidates)

    assert classification.outcome is Outcome.GREY_ZONE
    assert all(scored.version_mismatch for scored in classification.retained)
    assert all(scored.score == 100 for scored in classification.retained)


@pytest.mark.parametrize(
    ("asked", "offered"),
    [
        ("Tolka Pt. 1", "Tolka Pt. 2"),
        ("Sequence 4", "Sequence 3"),
        ("Quiet Meridian", "Quiet Meridian 2"),
        ("X0000000X", "X0004000X"),
    ],
    ids=["other-part", "other-number", "number-added", "digits-inside-a-word"],
)
def test_keeps_titles_that_only_a_number_tells_apart_in_the_grey_zone(
    asked: str, offered: str
) -> None:
    """Regression : un chiffre coutait trop peu au score, le mauvais morceau passait en auto."""
    query = TrackQuery("Lior Vance", asked, QueryOrigin.TAGS)

    classification = classify(query, [track_candidate(offered)])

    assert classification.outcome is Outcome.GREY_ZONE
    assert classification.retained[0].number_mismatch is True


@pytest.mark.parametrize(
    ("asked", "offered", "mix_name"),
    [
        ("Sequence 04", "Sequence 4", "Original Mix"),
        ("Dim Orbit (2019 Remaster)", "Dim Orbit", "2019 Remaster"),
    ],
    ids=["leading-zero", "number-of-the-version"],
)
def test_validates_automatically_when_the_title_numbers_agree(
    asked: str, offered: str, mix_name: str
) -> None:
    query = TrackQuery("Lior Vance", asked, QueryOrigin.TAGS)

    classification = classify(query, [track_candidate(offered, mix_name)])

    assert classification.outcome is Outcome.AUTO


def test_validates_the_original_mix_automatically_when_an_extended_is_also_offered() -> None:
    extended = track_candidate("Dim Orbit", "Extended Mix", track_id="extended")
    original = track_candidate("Dim Orbit", "Original Mix", track_id="original")

    classification = classify(DIM_ORBIT, [extended, original])

    assert classification.outcome is Outcome.AUTO
    assert classification.retained[0].candidate.id == "original"


def test_matches_a_candidate_whose_source_carries_no_mix_name() -> None:
    bandcamp = track_candidate("Dim Orbit", mix_name=None)

    classification = classify(DIM_ORBIT, [bandcamp])

    assert classification.outcome is Outcome.AUTO
    assert classification.retained[0].version_mismatch is False


def test_never_validates_automatically_when_auto_is_not_allowed() -> None:
    classification = classify(DIM_ORBIT, [track_candidate("Dim Orbit")], allow_auto=False)

    assert classification.outcome is Outcome.GREY_ZONE
    assert classification.retained[0].score == 100


def test_ignores_remixers_when_scoring_the_artist() -> None:
    candidate = track_candidate("Dim Orbit", "Original Mix", remixers=("Mara Quill",))

    classification = classify(DIM_ORBIT, [candidate])

    assert classification.retained[0].artist_score == 100


@pytest.mark.parametrize(
    ("tagged_title", "tagged_artist"),
    [
        ("Cairn", "ZRVK, Teodor Hale"),
        ("Cairn feat. ZRVK", "Teodor Hale"),
        ("Cairn (feat. ZRVK)", "ZRVK, Teodor Hale"),
        ("Cairn feat. Dubmoor", "Teodor Hale"),
        ("Cairn feat. Radio Ember", "Teodor Hale"),
        ("Cairn feat. Mixmoth", "Teodor Hale"),
    ],
    ids=[
        "tag-omits-it",
        "tag-repeats-it",
        "tag-parenthesises-it",
        "guest-named-like-a-version-dub",
        "guest-named-like-a-version-radio",
        "guest-named-like-a-version-mix",
    ],
)
def test_ignores_a_featuring_the_tag_writes_into_the_title(
    tagged_title: str, tagged_artist: str
) -> None:
    """techno-scraper sort l'invite du titre et le credite, un tag peut l'y laisser en plus
    du champ artiste. Regression : la coupe s'arretait devant un nom commencant par un mot
    de version (« Dubmoor ») et en laissait la fin dans le titre."""
    query = TrackQuery(tagged_artist, tagged_title, QueryOrigin.TAGS)
    biome = track_candidate("Cairn", artists=("ZRVK", "Teodor Hale"))

    classification = classify(query, [biome])

    assert classification.outcome is Outcome.AUTO


def test_matches_an_artist_carrying_a_regional_suffix() -> None:
    """« ZENO (UK) » est le nom de l'artiste, pas « ZENO » suivi de bruit."""
    query = TrackQuery("ZENO (UK)", "Fernlit (Extended Mix)", QueryOrigin.TAGS)
    sosa = track_candidate("Fernlit", "Extended Mix", artists=("ZENO (UK)",))

    classification = classify(query, [sosa])

    assert classification.outcome is Outcome.AUTO


@pytest.mark.parametrize(
    ("tagged", "credited"),
    [
        ("Lucian Verdelle, Pixel & Moss", ("Lucian Verdelle", "Pixel & Moss")),
        ("Lior Vance & Mara Quill", ("Lior Vance", "Mara Quill")),
    ],
    ids=["ampersand-belongs-to-a-duo", "ampersand-joins-two-artists"],
)
def test_reads_an_ampersand_the_way_the_source_credits_it(
    tagged: str, credited: tuple[str, ...]
) -> None:
    """La chaine seule ne dit pas si « A & B » est un duo : la source tranche."""
    query = TrackQuery(tagged, "Voyage", QueryOrigin.TAGS)

    classification = classify(query, [track_candidate("Voyage", artists=credited)])

    assert classification.outcome is Outcome.AUTO


def test_matches_several_artists_whatever_their_order() -> None:
    query = TrackQuery("Lior Vance, Mara Quill", "Dim Orbit", QueryOrigin.TAGS)
    candidate = track_candidate("Dim Orbit", artists=("Mara Quill", "Lior Vance"))

    classification = classify(query, [candidate])

    assert classification.scored[0].artist_score == 100


def test_scores_a_swapped_artist_name_below_a_perfect_match() -> None:
    query = TrackQuery("Vance Lior", "Dim Orbit", QueryOrigin.TAGS)

    classification = classify(query, [track_candidate("Dim Orbit")])

    artist_score = classification.scored[0].artist_score
    assert artist_score is not None
    assert artist_score < 100


def test_does_not_take_remix_as_a_substring_of_a_larger_word() -> None:
    query = TrackQuery("Lior Vance", "Club Premix", QueryOrigin.TAGS)

    classification = classify(query, [track_candidate("Club Premix")])

    assert classification.outcome is Outcome.AUTO


def test_drops_a_candidate_without_remix_when_the_query_holds_one() -> None:
    query = TrackQuery("Lior Vance", "Dim Orbit (Mara Quill Remix)", QueryOrigin.TAGS)
    original = track_candidate("Dim Orbit", "Original Mix", track_id="original")
    remix = track_candidate("Dim Orbit", "Mara Quill Remix", track_id="remix")

    classification = classify(query, [original, remix])

    assert [scored.candidate.id for scored in classification.scored] == ["remix"]
    assert classification.outcome is Outcome.AUTO


@pytest.mark.parametrize(
    "candidate",
    [
        track_candidate("Totally Different"),
        track_candidate("Dim Orbit", artists=("Lior Pike",)),
        track_candidate("Waypoint", "Original Mix"),
        track_candidate("Dim Orbit Tonight"),
    ],
    ids=[
        "title-below-floor",
        "artist-below-floor",
        "shares-only-its-version",
        "starts-like-the-query",
    ],
)
def test_rejects_a_candidate_that_is_not_the_track(candidate: TrackCandidate) -> None:
    """Un titre qui ne partage que sa version ou son debut n'est pas le morceau."""
    classification = classify(DIM_ORBIT, [candidate])

    assert classification.outcome is Outcome.EMPTY
    assert classification.retained == ()


@pytest.mark.parametrize(
    ("title", "expected"),
    [("Dim Orbit", Outcome.AUTO), ("Dim Orbitset", Outcome.GREY_ZONE)],
    ids=["at-the-ceiling", "below-the-ceiling"],
)
def test_validates_automatically_only_from_the_ceiling(title: str, expected: Outcome) -> None:
    thresholds = MatchingThresholds(floor=70, ceiling=100)

    classification = classify(DIM_ORBIT, [track_candidate(title)], thresholds)

    assert classification.outcome is expected


def test_returns_grey_zone_candidates_sorted_by_score() -> None:
    thresholds = MatchingThresholds(floor=70, ceiling=100)
    mindset = track_candidate("Dim Orbitset", track_id="mindset")
    minds = track_candidate("Dim Orbits", track_id="minds")

    classification = classify(DIM_ORBIT, [mindset, minds], thresholds)

    assert [scored.candidate.id for scored in classification.retained] == ["minds", "mindset"]


def test_keeps_the_first_candidate_on_a_tie() -> None:
    first = track_candidate("Dim Orbit", track_id="first")
    second = track_candidate("Dim Orbit", track_id="second")

    classification = classify(DIM_ORBIT, [first, second])

    assert classification.retained[0].candidate.id == "first"


def test_scores_the_title_only_for_a_query_without_artist() -> None:
    query = TrackQuery("", "Dim Orbit", QueryOrigin.FILENAME)

    classification = classify(query, [track_candidate("Dim Orbit", artists=("Someone Else",))])

    assert classification.outcome is Outcome.AUTO
    assert classification.retained[0].artist_score is None


def test_records_every_scoredtrack_candidate() -> None:
    candidates = [
        track_candidate("Dim Orbit", track_id="match"),
        track_candidate("Totally Different", track_id="other-title"),
        track_candidate("Dim Orbit", artists=("Lior Pike",), track_id="other-artist"),
    ]

    classification = classify(DIM_ORBIT, candidates)

    assert [scored.candidate.id for scored in classification.scored] == [
        "match",
        "other-title",
        "other-artist",
    ]


@pytest.mark.parametrize(
    ("floor", "ceiling"), [(95, 90), (-1, 90), (70, 101)], ids=["inverted", "negative", "over"]
)
def test_rejects_inconsistent_thresholds(floor: float, ceiling: float) -> None:
    with pytest.raises(ValueError, match="inconsistent thresholds"):
        MatchingThresholds(floor=floor, ceiling=ceiling)
