"""Regles du morceau et du run vivant qui ne demandent aucun reseau."""

from dataclasses import replace

import pytest
from tagging_records import (
    MUSIC,
    RECORD,
    RUN_ID,
    awaiting,
    resolved,
    rolled_back_record,
    scored_candidate,
    unresolved,
    write_failed_record,
    written_record,
)
from tagging_report_samples import BEFORE

from tagger.core.file_failures import FileFailureReason
from tagger.run.models import (
    FailureReason,
    LiveRun,
    Resolution,
    TrackFailureReason,
    TrackRecord,
    TrackState,
    Unresolved,
)

_RESOLVED = resolved(RECORD, Resolution.ARBITRATION, scored=scored_candidate())


@pytest.mark.parametrize(
    ("record", "decided"),
    [
        (RECORD, False),
        (awaiting(RECORD), True),
        (unresolved(RECORD, FailureReason.NO_RESULT), True),
        (unresolved(RECORD, FailureReason.USER_REFUSED), True),
        (unresolved(RECORD, FailureReason.SOURCE_UNAVAILABLE), False),
    ],
    ids=["waiting", "on-hold", "no-result", "refused", "source-unavailable"],
)
def test_tells_a_decided_track_from_one_to_send_back_to_the_network(
    record: TrackRecord, decided: bool
) -> None:
    result = record.decided

    assert result is decided


@pytest.mark.parametrize(
    ("record", "state", "resolution", "failure_reason", "restorable"),
    [
        (RECORD, None, None, None, False),
        (awaiting(RECORD), None, None, None, False),
        (
            unresolved(RECORD, FailureReason.NO_RESULT),
            TrackState.UNRESOLVED,
            Resolution.NONE,
            FailureReason.NO_RESULT,
            False,
        ),
        (_RESOLVED, TrackState.RESOLVED, Resolution.ARBITRATION, None, False),
        (written_record(_RESOLVED), TrackState.WRITTEN, Resolution.ARBITRATION, None, True),
        (
            write_failed_record(_RESOLVED, FileFailureReason.FILE_LOCKED, restorable=True),
            TrackState.WRITE_ERROR,
            Resolution.ARBITRATION,
            FileFailureReason.FILE_LOCKED,
            True,
        ),
        (
            write_failed_record(_RESOLVED, FileFailureReason.FILE_LOCKED, restorable=False),
            TrackState.WRITE_ERROR,
            Resolution.ARBITRATION,
            FileFailureReason.FILE_LOCKED,
            False,
        ),
        (
            rolled_back_record(written_record(_RESOLVED)),
            TrackState.ROLLED_BACK,
            Resolution.ARBITRATION,
            None,
            False,
        ),
    ],
    ids=[
        "waiting",
        "on-hold",
        "unresolved",
        "resolved",
        "written",
        "write-failed-restorable",
        "write-failed-origin-unread",
        "rolled-back",
    ],
)
def test_reads_the_flat_state_of_a_track_from_its_outcome(
    record: TrackRecord,
    state: TrackState | None,
    resolution: Resolution | None,
    failure_reason: TrackFailureReason | None,
    *,
    restorable: bool,
) -> None:
    result = (record.state, record.resolution, record.failure_reason, record.restorable)

    assert result == (state, resolution, failure_reason, restorable)


def test_keeps_the_displayed_tags_when_the_outcome_changes() -> None:
    shown = replace(RECORD, tags_before=BEFORE)

    changed = shown.with_outcome(Unresolved(None, FailureReason.EMPTY_QUERY))

    assert (changed.track_id, changed.path, changed.tags_before) == (
        shown.track_id,
        shown.path,
        BEFORE,
    )


def test_tells_the_observer_of_each_update() -> None:
    live = LiveRun(RUN_ID, MUSIC, [RECORD])
    seen: list[TrackRecord] = []
    live.observe(seen.append)
    updated = unresolved(RECORD, FailureReason.NO_RESULT)

    live.update(updated)

    assert seen == [updated]
