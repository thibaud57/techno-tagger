"""Tests du run : evenements, progression, garde des 403, incidents."""

from typing import TYPE_CHECKING
from unittest.mock import patch

import pytest
from scraper_responses import BASIEL, YOUR_MIND, track_payload
from tagging_api import (
    ORIGINAL,
    FakeApi,
    basiel,
    failing,
    found,
    one_track,
    run,
    tagged_mp3,
    three_tracks,
)

from tagger.files import TaggingFolderUnreadableError
from tagger.sources import ApiKeyRejectedRunError, _RejectionGuard
from tagger.tagging import (
    ArbitrationRequired,
    RunProgress,
    RunStarted,
    TrackResolved,
    TrackState,
)

if TYPE_CHECKING:
    from pathlib import Path

    from tagger.tagging import RunEvent

pytestmark = pytest.mark.asyncio


async def test_emits_run_started_first_with_every_track_and_its_identity(tmp_path: Path) -> None:
    events: list[RunEvent] = []

    await run(three_tracks(tmp_path), FakeApi(), events=events)

    first = events[0]
    assert isinstance(first, RunStarted)
    assert [record.track_id for record in first.tracks] == ["a.mp3", "b.mp3", "c.mp3"]
    assert first.tracks[1].identity.artist == "Amelie Lens"


async def test_counts_a_track_as_processed_once_resolved_unresolved_or_on_hold(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    api.on("/beatport/search", YOUR_MIND, found(ORIGINAL))
    api.on("/beatport/search", BASIEL, found(basiel(mix_name="Extended Mix")))
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
    for index in range(5):
        tagged_mp3(folder, f"{index}.mp3", "Adam Beyer", f"Track {index}")
    api = FakeApi()
    api.on("/beatport/search", "*", failing(403))
    events: list[RunEvent] = []

    with pytest.raises(ApiKeyRejectedRunError, match="repeated api key rejections"):
        await run(folder, api, events=events)

    resolved = [event for event in events if isinstance(event, TrackResolved)]
    assert all(event.record.state is not TrackState.RESOLVED for event in resolved)


async def test_resets_the_rejection_count_on_any_other_answer() -> None:
    guard = _RejectionGuard()
    guard.rejected()
    guard.rejected()
    guard.answered()

    guard.rejected()
    guard.rejected()

    with pytest.raises(ApiKeyRejectedRunError, match="repeated api key rejections"):
        guard.rejected()


async def test_reports_an_api_contract_error_to_sentry(tmp_path: Path) -> None:
    broken = track_payload()
    del broken["title"]
    api = FakeApi()
    api.on("/beatport/search", "*", found(broken))

    with patch("tagger.sources.sentry_sdk.capture_exception", autospec=True) as capture:
        await run(one_track(tmp_path), api)

    capture.assert_called_once()
