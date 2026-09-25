"""Tests du rendu des noms ecrits dans les tags : titre avec sa version, artistes credites."""

import pytest
from scraper_responses import track_candidate

from tagger.matching import credited_artists, full_title


def test_appends_the_mix_name_to_the_title() -> None:
    """ADR-011 : avec `mix_name`, on rend « Titre (Mix Name) »."""
    candidate = track_candidate("Your Mind", "Extended Mix")

    rendered = full_title(candidate)

    assert rendered == "Your Mind (Extended Mix)"


def test_takes_the_title_as_is_when_the_source_carries_no_mix_name() -> None:
    """ADR-011 : sans lui (Bandcamp), les artistes ecrivent deja la version a la main."""
    candidate = track_candidate("Your Mind (Rework)", mix_name=None)

    rendered = full_title(candidate)

    assert rendered == "Your Mind (Rework)"


def test_leaves_a_title_that_already_names_its_mix() -> None:
    candidate = track_candidate("Your Mind (Extended Mix)", "Extended Mix")

    rendered = full_title(candidate)

    assert rendered == "Your Mind (Extended Mix)"


@pytest.mark.parametrize(
    ("title", "mix_name", "expected"),
    [
        ("Your Mind (Extended)", "Extended Mix", "Your Mind (Extended Mix)"),
        ("Your Mind [Extended]", "Extended Mix", "Your Mind (Extended Mix)"),
        ("Your Mind (Beyer)", "Beyer Remix", "Your Mind (Beyer Remix)"),
    ],
    ids=["parentheses", "brackets", "remixer-alone"],
)
def test_completes_a_group_that_names_the_mix_by_half(
    title: str, mix_name: str, expected: str
) -> None:
    """Un titre porteur d'une version partielle recevait la version entiere en plus.

    Le contrat separe titre et version des deux sources, donc ce titre-la en sort : le
    traitement evite un « Your Mind (Extended) (Extended Mix) » ecrit dans le tag.
    """
    candidate = track_candidate(title, mix_name)

    rendered = full_title(candidate)

    assert rendered == expected


@pytest.mark.parametrize(
    ("title", "mix_name"),
    [
        ("Extended Dreams", "Extended Mix"),
        ("Your Mind (Live)", "Extended Mix"),
        ("Your Mind (Dub)", "Dubplate Mix"),
        ("Your Mind (Dub)", "Sunset Dub Edit"),
    ],
    ids=["ordinary-word", "other-version", "fragment-of-a-word", "named-mid-version"],
)
def test_still_appends_the_mix_name_when_no_group_announces_it(title: str, mix_name: str) -> None:
    """La completion ne vaut que pour un groupe qui prefixe la version.

    Ailleurs, le mot est ordinaire, nomme une autre version, n'est qu'un fragment, ou
    figure au milieu de la version : ecraser le groupe perdrait ce que la source dit.
    """
    candidate = track_candidate(title, mix_name)

    rendered = full_title(candidate)

    assert rendered == f"{title} ({mix_name})"


def test_joins_the_credited_artists_and_leaves_the_remixers_to_the_mix() -> None:
    """Convention du contrat : `remixers[]` est exclu de `artists[]`, et la version les
    nomme deja dans le titre.
    """
    candidate = track_candidate(artists=("Adam Beyer", "Bart Skils"), remixers=("Layton Giordani",))

    credited = credited_artists(candidate)

    assert credited == "Adam Beyer, Bart Skils"
