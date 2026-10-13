"""Regles du morceau et du run vivant qui ne demandent aucun reseau."""

from pathlib import Path

import pytest
from tagging_records import RECORD
from tagging_report_samples import HELD

from tagger.resolution.sources import ApiKeyRejectedRunError, _RejectionGuard
from tagger.run.tagging import FailureReason, LiveRun, TrackRecord


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


def test_resets_the_rejection_count_on_any_other_answer() -> None:
    guard = _RejectionGuard()
    guard.rejected()
    guard.rejected()
    guard.answered()

    guard.rejected()
    guard.rejected()

    with pytest.raises(ApiKeyRejectedRunError, match="repeated api key rejections"):
        guard.rejected()
