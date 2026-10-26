from typing import TYPE_CHECKING

import pytest
from run_plans import music
from scraper_responses import (
    BASIEL,
    BEATPORT_SEARCH,
    YOUR_MIND,
    failing,
    found,
    invalid_track_payload,
)
from stubs import ignore
from tagging_api import (
    ORIGINAL,
    FakeApi,
    basiel,
    must_record,
    one_track,
    opened_run,
    run,
    three_tracks,
    two_tracks,
)
from tagging_records import FIRST_TRACK, SECOND_TRACK, THIRD_TRACK, awaiting, unresolved

from tagger.resolution.sources import ApiKeyRejectedRunError
from tagger.run.models import (
    ArbitrationRequired,
    FailureReason,
    RunProgress,
    RunStarted,
    TrackResolved,
    TrackState,
)
from tagger.run.tagging import resolve_run
from tagger.tags.files import TaggingFolderUnreadableError

if TYPE_CHECKING:
    from pathlib import Path
    from unittest.mock import MagicMock

    from tagger.core.identifiers import TrackId
    from tagger.run.models import LiveRun, RunEvent

pytestmark = pytest.mark.asyncio


async def test_emits_run_started_first_with_every_track_and_its_identity(tmp_path: Path) -> None:
    events: list[RunEvent] = []

    await run(three_tracks(tmp_path), FakeApi(), events=events)

    first = events[0]
    assert isinstance(first, RunStarted)
    assert [record.track_id for record in first.tracks] == [FIRST_TRACK, SECOND_TRACK, THIRD_TRACK]
    assert first.tracks[1].identity.artist == "Amelie Lens"


async def test_counts_a_track_as_processed_once_resolved_unresolved_or_on_hold(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    api.on(BEATPORT_SEARCH, YOUR_MIND, found(ORIGINAL))
    api.on(BEATPORT_SEARCH, BASIEL, found(basiel(mix_name="Extended Mix")))
    events: list[RunEvent] = []

    await run(three_tracks(tmp_path), api, events=events)

    progress = [event for event in events if isinstance(event, RunProgress)]
    assert [(event.processed, event.total) for event in progress] == [(1, 3), (2, 3), (3, 3)]
    assert sum(isinstance(event, TrackResolved) for event in events) == 2
    assert sum(isinstance(event, ArbitrationRequired) for event in events) == 1


async def test_raises_a_tagging_folder_error_for_an_unreadable_folder_before_any_event(
    tmp_path: Path,
) -> None:
    events: list[RunEvent] = []

    with pytest.raises(TaggingFolderUnreadableError, match="unreadable tagging folder"):
        await run(tmp_path / "missing", FakeApi(), events=events)

    assert events == []


async def test_stops_the_run_after_three_consecutive_rejections_of_the_key(
    tmp_path: Path,
) -> None:
    folder = tmp_path / "music"
    music(folder, 5)
    api = FakeApi()
    api.on(BEATPORT_SEARCH, "*", failing(403))
    events: list[RunEvent] = []

    with pytest.raises(ApiKeyRejectedRunError, match="repeated api key rejections"):
        await run(folder, api, events=events)

    resolved = [event for event in events if isinstance(event, TrackResolved)]
    assert all(event.record.state is not TrackState.RESOLVED for event in resolved)


async def test_reports_an_api_contract_error_to_sentry(
    tmp_path: Path, captured_exceptions: MagicMock
) -> None:
    api = FakeApi()
    api.on(BEATPORT_SEARCH, "*", found(invalid_track_payload()))

    await run(one_track(tmp_path), api)

    captured_exceptions.assert_called_once()


def _hold(live: LiveRun, track_id: TrackId) -> None:
    record = must_record(live, track_id)
    live.update(awaiting(record))


def _refuse(live: LiveRun, track_id: TrackId, reason: FailureReason) -> None:
    record = must_record(live, track_id)
    live.update(unresolved(record, reason))


async def test_never_sends_a_decided_track_back_to_the_api(tmp_path: Path) -> None:
    api = FakeApi()
    events: list[RunEvent] = []

    async with opened_run(three_tracks(tmp_path), api) as (live, sources):
        _refuse(live, FIRST_TRACK, FailureReason.USER_REFUSED)
        _hold(live, SECOND_TRACK)

        await resolve_run(live, sources, on_event=events.append)

    assert api.searched() == {"Sara Landry The Void"}
    assert [event for event in events if isinstance(event, RunProgress)] == [
        RunProgress(processed=3, total=3)
    ]


async def test_sends_back_to_the_api_a_track_whose_source_did_not_answer(tmp_path: Path) -> None:
    api = FakeApi()

    async with opened_run(two_tracks(tmp_path), api) as (live, sources):
        _refuse(live, FIRST_TRACK, FailureReason.SOURCE_UNAVAILABLE)
        _refuse(live, SECOND_TRACK, FailureReason.NO_RESULT)

        await resolve_run(live, sources, on_event=ignore)

    assert api.searched() == {"Adam Beyer Your Mind"}
