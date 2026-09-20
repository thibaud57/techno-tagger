"""Tests du scoring et du classement des candidats."""

import pytest

from tagger.matching import (
    MatchingThresholds,
    Outcome,
    QueryOrigin,
    TrackQuery,
    classify,
)
from tagger.scraper_client import Credit, Source, TrackCandidate

YOUR_MIND = TrackQuery(artist="Adam Beyer", title="Your Mind", origin=QueryOrigin.TAGS)


def _candidate(
    title: str,
    mix_name: str | None = "Original Mix",
    artists: tuple[str, ...] = ("Adam Beyer",),
    *,
    remixers: tuple[str, ...] = (),
    track_id: str = "1",
) -> TrackCandidate:
    return TrackCandidate(
        id=track_id,
        title=title,
        mix_name=mix_name,
        artists=tuple(Credit(name=name) for name in artists),
        remixers=tuple(Credit(name=name) for name in remixers),
        source=Source.BEATPORT,
    )


def test_compares_the_candidate_title_with_its_mix_name() -> None:
    query = TrackQuery("Adam Beyer", "Your Mind (Extended Mix)", QueryOrigin.TAGS)

    classification = classify(query, [_candidate("Your Mind", "Extended Mix")])

    assert classification.outcome is Outcome.AUTO
    assert classification.retained[0].title_score == 100


def test_does_not_repeat_a_mix_name_already_in_the_title() -> None:
    query = TrackQuery("Adam Beyer", "Your Mind (Extended Mix)", QueryOrigin.TAGS)

    classification = classify(query, [_candidate("Your Mind (Extended Mix)", "Extended Mix")])

    assert classification.retained[0].title_score == 100


def test_does_not_repeat_a_mix_name_written_in_another_case() -> None:
    query = TrackQuery("Adam Beyer", "Your Mind (Extended Mix)", QueryOrigin.TAGS)

    classification = classify(query, [_candidate("Your Mind (extended mix)", "Extended Mix")])

    assert classification.retained[0].title_score == 100


def test_reads_a_version_written_between_square_brackets() -> None:
    query = TrackQuery("Adam Beyer", "Your Mind [Extended Mix]", QueryOrigin.TAGS)

    classification = classify(query, [_candidate("Your Mind", "Extended Mix")])

    assert classification.outcome is Outcome.AUTO
    assert classification.retained[0].title_score == 100


def test_adds_original_mix_to_a_query_title_without_version() -> None:
    classification = classify(YOUR_MIND, [_candidate("Your Mind", "Original Mix")])

    assert classification.outcome is Outcome.AUTO
    assert classification.retained[0].via_bare_title is False


def test_keeps_a_candidate_matched_on_its_bare_title_in_the_grey_zone() -> None:
    candidates = [_candidate("Your Mind", "Extended Mix"), _candidate("Your Mind", "Radio Edit")]

    classification = classify(YOUR_MIND, candidates)

    assert classification.outcome is Outcome.GREY_ZONE
    assert all(scored.via_bare_title for scored in classification.retained)
    assert all(scored.score == 100 for scored in classification.retained)


def test_validates_the_original_mix_automatically_when_an_extended_is_also_offered() -> None:
    extended = _candidate("Your Mind", "Extended Mix", track_id="extended")
    original = _candidate("Your Mind", "Original Mix", track_id="original")

    classification = classify(YOUR_MIND, [extended, original])

    assert classification.outcome is Outcome.AUTO
    assert classification.retained[0].candidate.id == "original"


def test_compares_a_candidate_without_mix_name_to_the_query_title_without_suffix() -> None:
    bandcamp = _candidate("Your Mind", mix_name=None)

    classification = classify(YOUR_MIND, [bandcamp])

    assert classification.outcome is Outcome.AUTO
    assert classification.retained[0].via_bare_title is False


def test_never_validates_automatically_when_auto_is_not_allowed() -> None:
    classification = classify(YOUR_MIND, [_candidate("Your Mind")], allow_auto=False)

    assert classification.outcome is Outcome.GREY_ZONE
    assert classification.retained[0].score == 100


def test_joins_candidate_artists_without_remixers() -> None:
    candidate = _candidate("Your Mind", "Original Mix", remixers=("Bart Skils",))

    classification = classify(YOUR_MIND, [candidate])

    assert classification.retained[0].artist_score == 100


def test_uses_token_sort_ratio_for_several_artists() -> None:
    query = TrackQuery("Adam Beyer, Bart Skils", "Your Mind", QueryOrigin.TAGS)
    candidate = _candidate("Your Mind", artists=("Bart Skils", "Adam Beyer"))

    classification = classify(query, [candidate])

    assert classification.scored[0].artist_score == 100


def test_uses_ratio_for_a_single_artist() -> None:
    query = TrackQuery("Beyer Adam", "Your Mind", QueryOrigin.TAGS)

    classification = classify(query, [_candidate("Your Mind")])

    artist_score = classification.scored[0].artist_score
    assert artist_score is not None
    assert artist_score < 100


def test_does_not_take_remix_as_a_substring_of_a_larger_word() -> None:
    query = TrackQuery("Adam Beyer", "Club Premix", QueryOrigin.TAGS)

    classification = classify(query, [_candidate("Club Premix")])

    assert classification.outcome is Outcome.AUTO


def test_drops_a_candidate_without_remix_when_the_query_holds_one() -> None:
    query = TrackQuery("Adam Beyer", "Your Mind (Bart Skils Remix)", QueryOrigin.TAGS)
    original = _candidate("Your Mind", "Original Mix", track_id="original")
    remix = _candidate("Your Mind", "Bart Skils Remix", track_id="remix")

    classification = classify(query, [original, remix])

    assert [scored.candidate.id for scored in classification.scored] == ["remix"]
    assert classification.outcome is Outcome.AUTO


@pytest.mark.parametrize(
    "candidate",
    [
        _candidate("Totally Different"),
        _candidate("Your Mind", artists=("Adam Port",)),
    ],
    ids=["title-below-floor", "artist-below-floor"],
)
def test_rejects_a_candidate_below_the_floor_on_either_score(candidate: TrackCandidate) -> None:
    classification = classify(YOUR_MIND, [candidate])

    assert classification.outcome is Outcome.EMPTY
    assert classification.retained == ()


def test_validates_automatically_at_the_ceiling() -> None:
    thresholds = MatchingThresholds(floor=70, ceiling=100)

    classification = classify(YOUR_MIND, [_candidate("Your Mind")], thresholds)

    assert classification.outcome is Outcome.AUTO


def test_does_not_validate_automatically_below_the_ceiling() -> None:
    thresholds = MatchingThresholds(floor=70, ceiling=100)

    classification = classify(YOUR_MIND, [_candidate("Your Mind Tonight")], thresholds)

    assert classification.outcome is Outcome.GREY_ZONE


def test_returns_grey_zone_candidates_sorted_by_score() -> None:
    thresholds = MatchingThresholds(floor=70, ceiling=100)
    tonight = _candidate("Your Mind Tonight", track_id="tonight")
    mindset = _candidate("Your Mindset", track_id="mindset")

    classification = classify(YOUR_MIND, [tonight, mindset], thresholds)

    assert [scored.candidate.id for scored in classification.retained] == ["mindset", "tonight"]


def test_keeps_the_first_candidate_on_a_tie() -> None:
    first = _candidate("Your Mind", track_id="first")
    second = _candidate("Your Mind", track_id="second")

    classification = classify(YOUR_MIND, [first, second])

    assert classification.retained[0].candidate.id == "first"


def test_scores_the_title_only_for_a_query_without_artist() -> None:
    query = TrackQuery("", "Your Mind", QueryOrigin.FILENAME)

    classification = classify(query, [_candidate("Your Mind", artists=("Someone Else",))])

    assert classification.outcome is Outcome.AUTO
    assert classification.retained[0].artist_score is None


def test_records_every_scored_candidate() -> None:
    candidates = [
        _candidate("Your Mind", track_id="match"),
        _candidate("Totally Different", track_id="other-title"),
        _candidate("Your Mind", artists=("Adam Port",), track_id="other-artist"),
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
