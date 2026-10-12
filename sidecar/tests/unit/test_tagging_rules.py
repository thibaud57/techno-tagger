"""Regles du morceau et du run vivant qui ne demandent aucun reseau."""

from dataclasses import replace
from pathlib import Path

import pytest
from tagging_records import RECORD, scored_candidate

from tagger.scraper_client import Source
from tagger.tagging import FailureReason, LiveRun, PendingArbitration, TrackRecord

HELD = replace(
    RECORD,
    arbitration=PendingArbitration(
        Source.BEATPORT, (scored_candidate(),), beatport_unavailable=False
    ),
)


@pytest.mark.parametrize(
    ("record", "decided"),
    [
        (RECORD, False),
        (HELD, True),
        (RECORD.unresolved(FailureReason.NO_RESULT), True),
        (RECORD.unresolved(FailureReason.USER_REFUSED), True),
        (RECORD.unresolved(FailureReason.SOURCE_UNAVAILABLE), False),
    ],
    ids=["waiting", "on-hold", "no-result", "refused", "source-unavailable"],
)
def test_tells_a_decided_track_from_one_to_send_back_to_the_network(
    record: TrackRecord, decided: bool
) -> None:
    result = record.decided

    assert result is decided


def test_tells_the_observer_of_each_update() -> None:
    live = LiveRun("a3f9c1", Path("music"), [RECORD])
    seen: list[TrackRecord] = []
    live.observe(seen.append)
    updated = RECORD.unresolved(FailureReason.NO_RESULT)

    live.update(updated)

    assert seen == [updated]
