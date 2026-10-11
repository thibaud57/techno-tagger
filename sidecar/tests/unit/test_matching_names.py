"""Tests du rendu des noms ecrits dans les tags : titre avec sa version, artistes credites."""

from scraper_responses import track_candidate

from tagger.matching import credited_artists, full_title


def test_appends_the_mix_name_to_the_title() -> None:
    """ADR-011 : avec `mix_name`, on rend « Titre (Mix Name) »."""
    candidate = track_candidate("Dim Orbit", "Extended Mix")

    rendered = full_title(candidate)

    assert rendered == "Dim Orbit (Extended Mix)"


def test_takes_the_title_as_is_when_the_source_carries_no_mix_name() -> None:
    """ADR-011 : sans `mix_name`, le titre s'ecrit tel quel, sous-titre compris."""
    candidate = track_candidate("SLTD (Slow Light Turns Dim)", mix_name=None)

    rendered = full_title(candidate)

    assert rendered == "SLTD (Slow Light Turns Dim)"


def test_joins_the_credited_artists_and_leaves_the_remixers_to_the_mix() -> None:
    """Convention du contrat : `remixers[]` est exclu de `artists[]`, et la version les
    nomme deja dans le titre.
    """
    candidate = track_candidate(artists=("Lior Vance", "Mara Quill"), remixers=("Kaelen Mirandor",))

    credited = credited_artists(candidate)

    assert credited == "Lior Vance, Mara Quill"
