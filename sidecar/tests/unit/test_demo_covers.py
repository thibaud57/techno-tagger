"""Pochettes generees de la demo : stables, une par sortie, au motif de leur label."""

import pytest
from demo_catalogue import TRACKS, Motif, resolved_releases
from demo_covers import cover_name, render_cover, render_covers


def test_renders_the_same_cover_twice_for_the_same_release() -> None:
    track, release = resolved_releases()[0]

    first, second = render_cover(release, track.title), render_cover(release, track.title)

    assert first == second


def test_names_one_cover_per_resolved_release_after_its_reference() -> None:
    covers = render_covers(TRACKS)

    assert set(covers) == {cover_name(release) for _, release in resolved_releases()}
    assert cover_name(resolved_releases()[0][1]) == f"{resolved_releases()[0][1].reference}.svg"


@pytest.mark.parametrize(
    ("motif", "element"),
    [
        (Motif.RINGS, "<circle"),
        (Motif.WAVES, "<path"),
        (Motif.GRID, "<line"),
        (Motif.DOTS, "<circle"),
    ],
    ids=["rings", "waves", "grid", "dots"],
)
def test_draws_every_release_of_a_label_with_that_labels_motif(motif: Motif, element: str) -> None:
    releases = [
        (track, release) for track, release in resolved_releases() if release.label.motif is motif
    ]

    covers = [render_cover(release, track.title) for track, release in releases]

    assert releases
    assert all(element in cover for cover in covers)
