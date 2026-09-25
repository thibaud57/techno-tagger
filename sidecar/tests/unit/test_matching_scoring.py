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

YOUR_MIND = TrackQuery(artist="Adam Beyer", title="Your Mind", origin=QueryOrigin.TAGS)


@pytest.mark.parametrize(
    ("tagged", "title", "mix_name", "credited"),
    [
        ("Adam Beyer", "Your Mind", "HNTR Remix", ("Adam Beyer", "Bart Skils", "HNTR")),
        ("Mython", "Abilene", "Original Mix", ("Mython", "BCCO")),
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
    """Regression : un nettoyage applique d'un seul cote faussait la comparaison."""
    query = TrackQuery("Sharam", "PATT (Green Velvet Remix)", QueryOrigin.TAGS)
    patt = track_candidate("PATT (Party All The Time)", "Green Velvet Remix", artists=("Sharam",))

    classification = classify(query, [patt])

    assert classification.outcome is Outcome.AUTO


def test_ignores_spacing_around_a_version_label() -> None:
    """Regression : « ( Original Mix ) » ne s'annulait pas et bloquait l'auto."""
    query = TrackQuery("Adam Beyer", "Your Mind ( Original Mix )", QueryOrigin.TAGS)

    classification = classify(query, [track_candidate("Your Mind", "Original Mix")])

    assert classification.outcome is Outcome.AUTO


def test_keeps_every_version_group_of_a_title() -> None:
    """Regression : un second groupe ecrasait le premier, « (Live) » disparaissait."""
    query = TrackQuery("Adam Beyer", "Your Mind (Live) (Dub)", QueryOrigin.TAGS)

    classification = classify(query, [track_candidate("Your Mind", "Live Dub")])

    assert classification.outcome is Outcome.AUTO


def test_guards_a_remix_named_outside_any_group() -> None:
    """Regression : sans parentheses, la garde ne voyait plus le remix demande."""
    query = TrackQuery("Adam Beyer", "Your Mind Bart Skils Remix", QueryOrigin.TAGS)

    classification = classify(query, [track_candidate("Your Mind", "Original Mix")])

    assert classification.scored == ()


@pytest.mark.parametrize(
    ("tagged_title", "mix_name"),
    [
        ("Your Mind (Extended Mix feat. Roisin Murphy)", "Extended Mix"),
        ("Your Mind (Extended Mix with Roisin Murphy)", "Extended Mix with Roisin Murphy"),
        ("Your Mind (Adam Beyer pres. Drumcode Remix)", "Adam Beyer pres. Drumcode Remix"),
        ("Your Mind (Chris Liebing vs Speedy J Remix)", "Chris Liebing vs Speedy J Remix"),
    ],
    ids=["feat", "with", "pres", "vs"],
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
    query = TrackQuery("Adam Beyer", tagged_title, QueryOrigin.TAGS)

    classification = classify(query, [track_candidate("Your Mind", mix_name)])

    assert classification.outcome is Outcome.AUTO


@pytest.mark.parametrize(
    ("query_title", "candidate_title", "mix_name"),
    [
        ("Your Mind (Extended Mix)", "Your Mind", "Extended Mix"),
        ("Your Mind (Extended Mix)", "Your Mind (Extended Mix)", "Extended Mix"),
        ("Your Mind (Extended Mix)", "Your Mind (extended mix)", "Extended Mix"),
        ("Your Mind [Extended Mix]", "Your Mind", "Extended Mix"),
    ],
    ids=["mix-name-field", "inside-the-title", "another-case", "square-brackets"],
)
def test_matches_a_version_however_the_source_writes_it(
    query_title: str, candidate_title: str, mix_name: str
) -> None:
    query = TrackQuery("Adam Beyer", query_title, QueryOrigin.TAGS)

    classification = classify(query, [track_candidate(candidate_title, mix_name)])

    assert classification.outcome is Outcome.AUTO
    assert classification.retained[0].title_score == 100


def test_matches_an_original_mix_against_a_query_without_version() -> None:
    classification = classify(YOUR_MIND, [track_candidate("Your Mind", "Original Mix")])

    assert classification.outcome is Outcome.AUTO
    assert classification.retained[0].version_mismatch is False


def test_keeps_other_versions_in_the_grey_zone_for_a_query_without_version() -> None:
    candidates = [
        track_candidate("Your Mind", "Extended Mix"),
        track_candidate("Your Mind", "Radio Edit"),
    ]

    classification = classify(YOUR_MIND, candidates)

    assert classification.outcome is Outcome.GREY_ZONE
    assert all(scored.version_mismatch for scored in classification.retained)
    assert all(scored.score == 100 for scored in classification.retained)


@pytest.mark.parametrize(
    ("asked", "offered"),
    [
        ("Klonk Pt. 1", "Klonk Pt. 2"),
        ("Sequence 4", "Sequence 3"),
        ("Minimal Nation", "Minimal Nation 2"),
        ("X0000000X", "X0004000X"),
    ],
    ids=["other-part", "other-number", "number-added", "digits-inside-a-word"],
)
def test_keeps_titles_that_only_a_number_tells_apart_in_the_grey_zone(
    asked: str, offered: str
) -> None:
    """Regression : un chiffre coutait trop peu au score, le mauvais morceau passait en auto."""
    query = TrackQuery("Adam Beyer", asked, QueryOrigin.TAGS)

    classification = classify(query, [track_candidate(offered)])

    assert classification.outcome is Outcome.GREY_ZONE
    assert classification.retained[0].number_mismatch is True


@pytest.mark.parametrize(
    ("asked", "offered", "mix_name"),
    [
        ("Sequence 04", "Sequence 4", "Original Mix"),
        ("Your Mind (2019 Remaster)", "Your Mind", "2019 Remaster"),
    ],
    ids=["leading-zero", "number-of-the-version"],
)
def test_validates_automatically_when_the_title_numbers_agree(
    asked: str, offered: str, mix_name: str
) -> None:
    query = TrackQuery("Adam Beyer", asked, QueryOrigin.TAGS)

    classification = classify(query, [track_candidate(offered, mix_name)])

    assert classification.outcome is Outcome.AUTO


def test_validates_the_original_mix_automatically_when_an_extended_is_also_offered() -> None:
    extended = track_candidate("Your Mind", "Extended Mix", track_id="extended")
    original = track_candidate("Your Mind", "Original Mix", track_id="original")

    classification = classify(YOUR_MIND, [extended, original])

    assert classification.outcome is Outcome.AUTO
    assert classification.retained[0].candidate.id == "original"


def test_matches_a_candidate_whose_source_carries_no_mix_name() -> None:
    bandcamp = track_candidate("Your Mind", mix_name=None)

    classification = classify(YOUR_MIND, [bandcamp])

    assert classification.outcome is Outcome.AUTO
    assert classification.retained[0].version_mismatch is False


def test_never_validates_automatically_when_auto_is_not_allowed() -> None:
    classification = classify(YOUR_MIND, [track_candidate("Your Mind")], allow_auto=False)

    assert classification.outcome is Outcome.GREY_ZONE
    assert classification.retained[0].score == 100


def test_ignores_remixers_when_scoring_the_artist() -> None:
    candidate = track_candidate("Your Mind", "Original Mix", remixers=("Bart Skils",))

    classification = classify(YOUR_MIND, [candidate])

    assert classification.retained[0].artist_score == 100


@pytest.mark.parametrize(
    ("tagged_title", "tagged_artist"),
    [
        ("Biome", "BCCO, Tommy Sharp"),
        ("Biome feat. BCCO", "Tommy Sharp"),
        ("Biome (feat. BCCO)", "BCCO, Tommy Sharp"),
    ],
    ids=["tag-omits-it", "tag-repeats-it", "tag-parenthesises-it"],
)
def test_ignores_a_featuring_the_source_writes_into_the_title(
    tagged_title: str, tagged_artist: str
) -> None:
    """Beatport ecrit l'invite dans le titre en plus de le crediter (« Biome feat. BCCO »)."""
    query = TrackQuery(tagged_artist, tagged_title, QueryOrigin.TAGS)
    biome = track_candidate("Biome feat. BCCO", artists=("BCCO", "Tommy Sharp"))

    classification = classify(query, [biome])

    assert classification.outcome is Outcome.AUTO


def test_matches_an_artist_carrying_a_regional_suffix() -> None:
    """« SOSA (UK) » est le nom de l'artiste, pas « SOSA » suivi de bruit."""
    query = TrackQuery("SOSA (UK)", "Bugbeat (Extended Mix)", QueryOrigin.TAGS)
    sosa = track_candidate("Bugbeat", "Extended Mix", artists=("SOSA (UK)",))

    classification = classify(query, [sosa])

    assert classification.outcome is Outcome.AUTO


@pytest.mark.parametrize(
    ("tagged", "credited"),
    [
        ("Hernan Cattaneo, Hicky & Kalo", ("Hernan Cattaneo", "Hicky & Kalo")),
        ("Adam Beyer & Bart Skils", ("Adam Beyer", "Bart Skils")),
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
    query = TrackQuery("Adam Beyer, Bart Skils", "Your Mind", QueryOrigin.TAGS)
    candidate = track_candidate("Your Mind", artists=("Bart Skils", "Adam Beyer"))

    classification = classify(query, [candidate])

    assert classification.scored[0].artist_score == 100


def test_scores_a_swapped_artist_name_below_a_perfect_match() -> None:
    query = TrackQuery("Beyer Adam", "Your Mind", QueryOrigin.TAGS)

    classification = classify(query, [track_candidate("Your Mind")])

    artist_score = classification.scored[0].artist_score
    assert artist_score is not None
    assert artist_score < 100


def test_does_not_take_remix_as_a_substring_of_a_larger_word() -> None:
    query = TrackQuery("Adam Beyer", "Club Premix", QueryOrigin.TAGS)

    classification = classify(query, [track_candidate("Club Premix")])

    assert classification.outcome is Outcome.AUTO


def test_drops_a_candidate_without_remix_when_the_query_holds_one() -> None:
    query = TrackQuery("Adam Beyer", "Your Mind (Bart Skils Remix)", QueryOrigin.TAGS)
    original = track_candidate("Your Mind", "Original Mix", track_id="original")
    remix = track_candidate("Your Mind", "Bart Skils Remix", track_id="remix")

    classification = classify(query, [original, remix])

    assert [scored.candidate.id for scored in classification.scored] == ["remix"]
    assert classification.outcome is Outcome.AUTO


@pytest.mark.parametrize(
    "candidate",
    [
        track_candidate("Totally Different"),
        track_candidate("Your Mind", artists=("Adam Port",)),
        track_candidate("Waypoint", "Original Mix"),
        track_candidate("Your Mind Tonight"),
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
    classification = classify(YOUR_MIND, [candidate])

    assert classification.outcome is Outcome.EMPTY
    assert classification.retained == ()


@pytest.mark.parametrize(
    ("title", "expected"),
    [("Your Mind", Outcome.AUTO), ("Your Mindset", Outcome.GREY_ZONE)],
    ids=["at-the-ceiling", "below-the-ceiling"],
)
def test_validates_automatically_only_from_the_ceiling(title: str, expected: Outcome) -> None:
    thresholds = MatchingThresholds(floor=70, ceiling=100)

    classification = classify(YOUR_MIND, [track_candidate(title)], thresholds)

    assert classification.outcome is expected


def test_returns_grey_zone_candidates_sorted_by_score() -> None:
    thresholds = MatchingThresholds(floor=70, ceiling=100)
    mindset = track_candidate("Your Mindset", track_id="mindset")
    minds = track_candidate("Your Minds", track_id="minds")

    classification = classify(YOUR_MIND, [mindset, minds], thresholds)

    assert [scored.candidate.id for scored in classification.retained] == ["minds", "mindset"]


def test_keeps_the_first_candidate_on_a_tie() -> None:
    first = track_candidate("Your Mind", track_id="first")
    second = track_candidate("Your Mind", track_id="second")

    classification = classify(YOUR_MIND, [first, second])

    assert classification.retained[0].candidate.id == "first"


def test_scores_the_title_only_for_a_query_without_artist() -> None:
    query = TrackQuery("", "Your Mind", QueryOrigin.FILENAME)

    classification = classify(query, [track_candidate("Your Mind", artists=("Someone Else",))])

    assert classification.outcome is Outcome.AUTO
    assert classification.retained[0].artist_score is None


def test_records_every_scoredtrack_candidate() -> None:
    candidates = [
        track_candidate("Your Mind", track_id="match"),
        track_candidate("Totally Different", track_id="other-title"),
        track_candidate("Your Mind", artists=("Adam Port",), track_id="other-artist"),
    ]

    classification = classify(YOUR_MIND, candidates)

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
