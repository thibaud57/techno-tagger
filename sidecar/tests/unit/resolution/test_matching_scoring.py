import re
from typing import TYPE_CHECKING, Final

import pytest
from repo_files import REPO
from scraper_responses import track_candidate
from tagging_records import QUERY, tags_query

from tagger.resolution.matching import (
    MatchingThresholds,
    Outcome,
    QueryOrigin,
    TrackQuery,
    classify,
)

if TYPE_CHECKING:
    from tagger.resolution.scraper_client import TrackCandidate

# Plafond a 100 : seul un score parfait valide d'office.
STRICT: Final = MatchingThresholds(floor=70, ceiling=100)
# `SCORE_SCALE` y recopie l'echelle des seuils : rien ne la derive cote TypeScript.
PROTOCOL_TS: Final = REPO / "src/app/core/sidecar/protocol.ts"


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
    query = tags_query(tagged, f"{title} ({mix_name})")

    classification = classify(query, [track_candidate(title, mix_name, artists=credited)])

    assert classification.outcome is Outcome.AUTO


@pytest.mark.parametrize(
    ("query", "candidate"),
    [
        # techno-scraper garde un sous-titre que la requete retire : sans le meme `_clean`
        # sur le candidat, la comparaison tomberait sous le plancher.
        pytest.param(
            tags_query("Sharam", "PATT (Green Velvet Remix)"),
            track_candidate("PATT (Party All The Time)", "Green Velvet Remix", artists=("Sharam",)),
            id="subtitle-cleaned",
        ),
        # Regression : « ( Original Mix ) » ne s'annulait pas et bloquait l'auto.
        pytest.param(
            tags_query("Adam Beyer", "Your Mind ( Original Mix )"),
            track_candidate("Your Mind", "Original Mix"),
            id="spacing-in-version",
        ),
        # Regression : un second groupe ecrasait le premier, « (Live) » disparaissait.
        pytest.param(
            tags_query("Adam Beyer", "Your Mind (Live) (Dub)"),
            track_candidate("Your Mind", "Live Dub"),
            id="two-version-groups",
        ),
        # « SOSA (UK) » est le nom de l'artiste, pas « SOSA » suivi de bruit.
        pytest.param(
            tags_query("SOSA (UK)", "Bugbeat (Extended Mix)"),
            track_candidate("Bugbeat", "Extended Mix", artists=("SOSA (UK)",)),
            id="regional-suffix",
        ),
        pytest.param(
            tags_query("Adam Beyer", "Club Premix"),
            track_candidate("Club Premix"),
            id="premix-not-remix",
        ),
    ],
)
def test_validates_automatically_whatever_the_formatting_of_the_tag(
    query: TrackQuery, candidate: TrackCandidate
) -> None:
    classification = classify(query, [candidate])

    assert classification.outcome is Outcome.AUTO


def test_guards_a_remix_named_outside_any_group() -> None:
    """Regression : sans parentheses, la garde ne voyait plus le remix demande."""
    query = tags_query("Adam Beyer", "Your Mind Bart Skils Remix")

    classification = classify(query, [track_candidate("Your Mind", "Original Mix")])

    assert classification.scored == ()


@pytest.mark.parametrize(
    ("tagged_title", "mix_name"),
    [
        ("Your Mind (Extended Mix feat. Roisin Murphy)", "Extended Mix"),
        ("Your Mind (Extended Mix feat. Radio Slave)", "Extended Mix"),
        ("Your Mind (Extended Mix with Roisin Murphy)", "Extended Mix with Roisin Murphy"),
        ("Your Mind (Adam Beyer pres. Drumcode Remix)", "Adam Beyer pres. Drumcode Remix"),
        ("Your Mind (Chris Liebing vs Speedy J Remix)", "Chris Liebing vs Speedy J Remix"),
    ],
    ids=["feat", "feat-guest-first-word-is-a-version", "with", "pres", "vs"],
)
def test_reads_the_version_of_a_group_that_also_names_a_guest(
    tagged_title: str, mix_name: str
) -> None:
    """Un credit de remix a deux noms reste une version, pas un morceau different.

    Regression : le groupe mixte restait entier dans le titre pour garder l'invite, la
    version se perdait et une parenthese jamais fermee mettait le morceau en non resolu
    face a son propre candidat.
    """
    query = tags_query("Adam Beyer", tagged_title)

    classification = classify(query, [track_candidate("Your Mind", mix_name)])

    assert classification.outcome is Outcome.AUTO


@pytest.mark.parametrize(
    ("query_title", "candidate_title", "mix_name"),
    [
        ("Your Mind (Extended Mix)", "Your Mind", "Extended Mix"),
        ("Your Mind [Extended Mix]", "Your Mind", "Extended Mix"),
    ],
    ids=["parentheses", "square-brackets"],
)
def test_matches_a_version_however_the_tag_writes_it(
    query_title: str, candidate_title: str, mix_name: str
) -> None:
    query = tags_query("Adam Beyer", query_title)

    classification = classify(query, [track_candidate(candidate_title, mix_name)])

    assert classification.outcome is Outcome.AUTO
    assert classification.retained[0].title_score == 100


@pytest.mark.parametrize(
    "mix_name", ["Original Mix", None], ids=["original-mix", "source-without-mix-name"]
)
def test_matches_a_candidate_with_no_other_version_against_a_query_without_version(
    mix_name: str | None,
) -> None:
    classification = classify(QUERY, [track_candidate("Your Mind", mix_name)])

    assert classification.outcome is Outcome.AUTO
    assert classification.retained[0].version_mismatch is False


def test_keeps_other_versions_in_the_grey_zone_for_a_query_without_version() -> None:
    candidates = [
        track_candidate("Your Mind", "Extended Mix"),
        track_candidate("Your Mind", "Radio Edit"),
    ]

    classification = classify(QUERY, candidates)

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
    query = tags_query("Adam Beyer", asked)

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
    query = tags_query("Adam Beyer", asked)

    classification = classify(query, [track_candidate(offered, mix_name)])

    assert classification.outcome is Outcome.AUTO


def test_validates_the_original_mix_automatically_when_an_extended_is_also_offered() -> None:
    extended = track_candidate("Your Mind", "Extended Mix", track_id="extended")
    original = track_candidate("Your Mind", "Original Mix", track_id="original")

    classification = classify(QUERY, [extended, original])

    assert classification.outcome is Outcome.AUTO
    assert classification.retained[0].candidate.id == "original"


def test_never_validates_automatically_when_auto_is_not_allowed() -> None:
    classification = classify(QUERY, [track_candidate("Your Mind")], allow_auto=False)

    assert classification.outcome is Outcome.GREY_ZONE
    assert classification.retained[0].score == 100


def test_ignores_remixers_when_scoring_the_artist() -> None:
    candidate = track_candidate("Your Mind", "Original Mix", remixers=("Bart Skils",))

    classification = classify(QUERY, [candidate])

    assert classification.retained[0].artist_score == 100


@pytest.mark.parametrize(
    ("tagged_title", "tagged_artist"),
    [
        ("Biome", "BCCO, Tommy Sharp"),
        ("Biome feat. BCCO", "Tommy Sharp"),
        ("Biome (feat. BCCO)", "BCCO, Tommy Sharp"),
        ("Biome feat. Dubfire", "Tommy Sharp"),
        ("Biome feat. Radio Slave", "Tommy Sharp"),
        ("Biome feat. Mixhell", "Tommy Sharp"),
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
    de version (« Dubfire ») et en laissait la fin dans le titre."""
    query = tags_query(tagged_artist, tagged_title)
    biome = track_candidate("Biome", artists=("BCCO", "Tommy Sharp"))

    classification = classify(query, [biome])

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
    query = tags_query(tagged, "Voyage")

    classification = classify(query, [track_candidate("Voyage", artists=credited)])

    assert classification.outcome is Outcome.AUTO


def test_matches_several_artists_whatever_their_order() -> None:
    query = tags_query("Adam Beyer, Bart Skils", "Your Mind")
    candidate = track_candidate("Your Mind", artists=("Bart Skils", "Adam Beyer"))

    classification = classify(query, [candidate])

    assert classification.scored[0].artist_score == 100


def test_scores_a_swapped_artist_name_below_a_perfect_match() -> None:
    query = tags_query("Beyer Adam", "Your Mind")

    classification = classify(query, [track_candidate("Your Mind")])

    artist_score = classification.scored[0].artist_score
    assert artist_score is not None
    assert artist_score < 100


def test_drops_a_candidate_without_remix_when_the_query_holds_one() -> None:
    query = tags_query("Adam Beyer", "Your Mind (Bart Skils Remix)")
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
    classification = classify(QUERY, [candidate])

    assert classification.outcome is Outcome.EMPTY
    assert classification.retained == ()


@pytest.mark.parametrize(
    ("title", "expected"),
    [("Your Mind", Outcome.AUTO), ("Your Mindset", Outcome.GREY_ZONE)],
    ids=["at-the-ceiling", "below-the-ceiling"],
)
def test_validates_automatically_only_from_the_ceiling(title: str, expected: Outcome) -> None:
    classification = classify(QUERY, [track_candidate(title)], STRICT)

    assert classification.outcome is expected


def test_returns_grey_zone_candidates_sorted_by_score() -> None:
    mindset = track_candidate("Your Mindset", track_id="mindset")
    minds = track_candidate("Your Minds", track_id="minds")

    classification = classify(QUERY, [mindset, minds], STRICT)

    assert [scored.candidate.id for scored in classification.retained] == ["minds", "mindset"]


def test_keeps_the_first_candidate_on_a_tie() -> None:
    first = track_candidate("Your Mind", track_id="first")
    second = track_candidate("Your Mind", track_id="second")

    classification = classify(QUERY, [first, second])

    assert classification.retained[0].candidate.id == "first"


def test_scores_the_title_only_for_a_query_without_artist() -> None:
    query = TrackQuery(artist="", title="Your Mind", origin=QueryOrigin.FILENAME)

    classification = classify(query, [track_candidate("Your Mind", artists=("Someone Else",))])

    assert classification.outcome is Outcome.AUTO
    assert classification.retained[0].artist_score is None


def test_records_every_candidate_it_scored() -> None:
    candidates = [
        track_candidate("Your Mind", track_id="match"),
        track_candidate("Totally Different", track_id="other-title"),
        track_candidate("Your Mind", artists=("Adam Port",), track_id="other-artist"),
    ]

    classification = classify(QUERY, candidates)

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


def test_accepts_the_whole_score_scale_the_interface_mirrors() -> None:
    low, high = _mirrored_score_scale()

    thresholds = MatchingThresholds(floor=low, ceiling=high)

    assert (thresholds.floor, thresholds.ceiling) == (low, high)


@pytest.mark.parametrize(("below", "above"), [(1, 0), (0, 1)], ids=["below", "above"])
def test_rejects_thresholds_beyond_the_score_scale_the_interface_mirrors(
    below: int, above: int
) -> None:
    low, high = _mirrored_score_scale()

    with pytest.raises(ValueError, match="inconsistent thresholds"):
        MatchingThresholds(floor=low - below, ceiling=high + above)


def _mirrored_score_scale() -> tuple[int, int]:
    source = PROTOCOL_TS.read_text(encoding="utf-8")
    scale = re.search(r"SCORE_SCALE = \{ min: (\d+), max: (\d+) \}", source)
    assert scale is not None
    return int(scale[1]), int(scale[2])
