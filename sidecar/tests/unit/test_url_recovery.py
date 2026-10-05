"""Tests du rattrapage par URL sur un run vivant, apres sa phase reseau."""

import asyncio
import logging
from contextlib import asynccontextmanager
from dataclasses import replace
from typing import TYPE_CHECKING

import pytest
from scraper_responses import (
    BANDCAMP_TRACK,
    YOUR_MIND,
    bandcamp_track_payload,
    track_candidate,
    track_payload,
)
from tagging_api import (
    ONE_TRACK,
    ORIGINAL,
    FakeApi,
    FakeCdn,
    cancelled,
    failing,
    found,
    ok,
    one_track,
    opened_run,
    three_tracks,
    two_tracks,
)
from tagging_records import scored_candidate

from tagger.scraper_client import (
    ApiContractError,
    ApiKeyRejectedError,
    Source,
    SourceUnavailableError,
    TrackNotFoundError,
    UnsupportedTrackUrlError,
)
from tagger.sources import ApiKeyRejectedRunError
from tagger.tagging import (
    FailureReason,
    PendingArbitration,
    Resolution,
    TrackResolved,
    TrackState,
    resolve_run,
)
from tagger.url_recovery import (
    UrlProgress,
    UrlRecovery,
    UrlRecoveryBusyError,
    UrlRecoveryNotEligibleError,
)

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator, Callable
    from pathlib import Path

    from tagging_api import OpenedRun

    from tagger.tagging import TrackRecord
    from tagger.url_recovery import UrlRecoveryEvent

pytestmark = pytest.mark.asyncio

BEATPORT_URL = "https://www.beatport.com/track/your-mind/22708005"
ON_BEATPORT = track_payload(id="22708005")


@asynccontextmanager
async def _recovering(
    folder: Path,
    api: FakeApi,
    events: list[UrlRecoveryEvent] | None = None,
    cdn: FakeCdn | None = None,
) -> AsyncGenerator[tuple[OpenedRun, UrlRecovery]]:
    """Run ouvert apres sa phase reseau et le rattrapage qui porte sur lui.

    Sans reponse enregistree, `FakeApi` rend des recherches vides : chaque morceau
    finit `unresolved`, motif `no_result`.
    """
    sink: list[UrlRecoveryEvent] = events if events is not None else []
    async with opened_run(folder, api, cdn=cdn) as opened:
        await resolve_run(opened.live, opened.sources, on_event=lambda _event: None)
        yield opened, UrlRecovery(opened.live, opened.sources, sink.append)


def _bandcamp_found(api: FakeApi) -> None:
    api.on("/bandcamp/tracks", BANDCAMP_TRACK, ok(bandcamp_track_payload()))


def _awaiting(record: TrackRecord) -> TrackRecord:
    """Morceau mis en zone grise : ni etat, ni motif, une liste a trancher."""
    return replace(
        record,
        state=None,
        resolution=None,
        failure_reason=None,
        arbitration=PendingArbitration(Source.BEATPORT, (scored_candidate(),), False),
    )


async def test_resolves_an_unresolved_track_by_url_with_the_fetched_candidate_and_its_artwork(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    _bandcamp_found(api)

    async with _recovering(one_track(tmp_path), api) as (opened, recovery):
        await recovery.resolve(ONE_TRACK, BANDCAMP_TRACK)

        record = opened.live.record(ONE_TRACK)
    assert record is not None
    assert (record.state, record.resolution, record.source) == (
        TrackState.RESOLVED,
        Resolution.URL,
        Source.BANDCAMP,
    )
    assert (record.failure_reason, record.scored) == (None, None)
    assert record.candidate is not None
    assert record.candidate.id == "7"
    assert record.artwork is not None


async def test_emits_the_resolved_track_then_the_url_progress(tmp_path: Path) -> None:
    api = FakeApi()
    _bandcamp_found(api)
    events: list[UrlRecoveryEvent] = []

    async with _recovering(one_track(tmp_path), api, events) as (opened, recovery):
        await recovery.resolve(ONE_TRACK, BANDCAMP_TRACK)

        record = opened.live.record(ONE_TRACK)
    assert record is not None
    assert events == [TrackResolved(record), UrlProgress(processed=1, total=1)]


@pytest.mark.parametrize(
    ("second_url", "source", "candidate_id"),
    [(BEATPORT_URL, Source.BEATPORT, "22708005"), (BANDCAMP_TRACK, Source.BANDCAMP, "7")],
    ids=["other-source", "same-url"],
)
async def test_replaces_a_track_already_resolved_by_url(
    tmp_path: Path, second_url: str, source: Source, candidate_id: str
) -> None:
    api = FakeApi()
    _bandcamp_found(api)
    api.on("/beatport/tracks/22708005", "*", ok(ON_BEATPORT))

    async with _recovering(one_track(tmp_path), api) as (opened, recovery):
        await recovery.resolve(ONE_TRACK, BANDCAMP_TRACK)

        await recovery.resolve(ONE_TRACK, second_url)

        record = opened.live.record(ONE_TRACK)
        progress = recovery.progress()
    assert record is not None
    assert (record.resolution, record.source) == (Resolution.URL, source)
    assert record.candidate is not None
    assert record.candidate.id == candidate_id
    assert progress == UrlProgress(processed=1, total=1)


async def test_counts_recovered_tracks_over_tracks_to_recover(tmp_path: Path) -> None:
    api = FakeApi()
    _bandcamp_found(api)

    async with _recovering(three_tracks(tmp_path), api) as (_opened, recovery):
        before = recovery.progress()
        await recovery.resolve("a.mp3", BANDCAMP_TRACK)
        after = recovery.progress()

    assert (before, after) == (UrlProgress(0, 3), UrlProgress(1, 3))


async def test_grows_the_total_when_a_late_refusal_leaves_a_track_unresolved(
    tmp_path: Path,
) -> None:
    """Un refus d'arbitrage apres la phase reseau entre dans le total au prochain calcul."""
    api = FakeApi()
    _bandcamp_found(api)

    async with _recovering(three_tracks(tmp_path), api) as (opened, recovery):
        late = opened.live.record("c.mp3")
        assert late is not None
        opened.live.update(_awaiting(late))
        await recovery.resolve("a.mp3", BANDCAMP_TRACK)
        before = recovery.progress()

        opened.live.update(_awaiting(late).unresolved(FailureReason.USER_REFUSED))

        after = recovery.progress()
    assert (before, after) == (UrlProgress(1, 2), UrlProgress(1, 3))


async def test_counts_zero_over_zero_when_nothing_is_left_to_recover(tmp_path: Path) -> None:
    api = FakeApi()
    api.on("/beatport/search", YOUR_MIND, found(ORIGINAL))

    async with _recovering(one_track(tmp_path), api) as (_opened, recovery):
        progress = recovery.progress()

    assert progress == UrlProgress(0, 0)


def _resolved_by(resolution: Resolution) -> Callable[[TrackRecord], TrackRecord]:
    return lambda record: record.resolved(
        resolution, Source.BEATPORT, track_candidate(), scored_candidate(), None
    )


def _not_processed(record: TrackRecord) -> TrackRecord:
    """Morceau jamais atteint par un run interrompu : ni etat, ni attente."""
    return replace(record, state=None, resolution=None, failure_reason=None)


@pytest.mark.parametrize(
    "into",
    [
        _resolved_by(Resolution.AUTO),
        _resolved_by(Resolution.ARBITRATION),
        _awaiting,
        _not_processed,
    ],
    ids=["auto", "arbitration", "awaiting-arbitration", "not-processed"],
)
async def test_refuses_a_track_that_is_not_eligible_without_any_request(
    tmp_path: Path, into: Callable[[TrackRecord], TrackRecord]
) -> None:
    api = FakeApi()
    _bandcamp_found(api)

    async with _recovering(one_track(tmp_path), api) as (opened, recovery):
        record = opened.live.record(ONE_TRACK)
        assert record is not None
        opened.live.update(into(record))
        calls = len(api.requests)

        with pytest.raises(UrlRecoveryNotEligibleError) as refusal:
            await recovery.resolve(ONE_TRACK, BANDCAMP_TRACK)

        assert len(api.requests) == calls
    assert refusal.value.params == {"track_id": ONE_TRACK}


async def test_refuses_a_track_unknown_to_the_run(tmp_path: Path) -> None:
    async with _recovering(one_track(tmp_path), FakeApi()) as (_opened, recovery):
        with pytest.raises(UrlRecoveryNotEligibleError):
            await recovery.resolve("unknown.mp3", BANDCAMP_TRACK)


async def test_refuses_a_second_gesture_in_flight_on_the_same_track(tmp_path: Path) -> None:
    api = FakeApi()
    _bandcamp_found(api)
    fetch = api.gate("/bandcamp/tracks", BANDCAMP_TRACK)

    async with _recovering(one_track(tmp_path), api) as (opened, recovery):
        first = asyncio.create_task(recovery.resolve(ONE_TRACK, BANDCAMP_TRACK), name="first")
        await fetch.reached.wait()
        calls = len(api.requests)

        with pytest.raises(UrlRecoveryBusyError) as refusal:
            await recovery.resolve(ONE_TRACK, BEATPORT_URL)

        assert len(api.requests) == calls
        fetch.release.set()
        await first
        record = opened.live.record(ONE_TRACK)
    assert refusal.value.params == {"track_id": ONE_TRACK}
    assert record is not None
    assert record.source is Source.BANDCAMP


async def test_releases_the_track_when_the_gesture_is_cancelled(tmp_path: Path) -> None:
    api = FakeApi()
    _bandcamp_found(api)
    fetch = api.gate("/bandcamp/tracks", BANDCAMP_TRACK)

    async with _recovering(one_track(tmp_path), api) as (opened, recovery):
        before = opened.live.record(ONE_TRACK)
        gesture = asyncio.create_task(recovery.resolve(ONE_TRACK, BANDCAMP_TRACK), name="gesture")
        await fetch.reached.wait()

        await cancelled(gesture)

        assert opened.live.record(ONE_TRACK) == before
        fetch.release.set()
        await recovery.resolve(ONE_TRACK, BANDCAMP_TRACK)
        after = opened.live.record(ONE_TRACK)
    assert after is not None
    assert after.resolution is Resolution.URL


ARTWORK = "https://geo-media.beatport.com/image_size/500x500/cover.jpg"


@pytest.mark.parametrize(
    ("status", "url", "error"),
    [
        (None, "https://www.youtube.com/watch?v=abc", UnsupportedTrackUrlError),
        (None, BANDCAMP_TRACK, TrackNotFoundError),
        (503, BANDCAMP_TRACK, SourceUnavailableError),
    ],
    ids=["unsupported-url", "track-not-found", "source-unavailable"],
)
async def test_keeps_the_track_untouched_and_emits_nothing_when_the_url_fails(
    tmp_path: Path, status: int | None, url: str, error: type[Exception]
) -> None:
    """Sans reponse enregistree, `FakeApi` rend 404 sur `/bandcamp/tracks`."""
    api = FakeApi()
    if status is not None:
        api.on("/bandcamp/tracks", BANDCAMP_TRACK, failing(status, "source_unavailable"))
    events: list[UrlRecoveryEvent] = []

    async with _recovering(one_track(tmp_path), api, events) as (opened, recovery):
        before = opened.live.record(ONE_TRACK)

        with pytest.raises(error):
            await recovery.resolve(ONE_TRACK, url)

        assert opened.live.record(ONE_TRACK) == before
    assert before is not None
    assert before.failure_reason is FailureReason.NO_RESULT
    assert events == []


async def test_keeps_the_previous_url_when_a_correction_fails(tmp_path: Path) -> None:
    api = FakeApi()
    _bandcamp_found(api)

    async with _recovering(one_track(tmp_path), api) as (opened, recovery):
        await recovery.resolve(ONE_TRACK, BANDCAMP_TRACK)
        before = opened.live.record(ONE_TRACK)

        with pytest.raises(TrackNotFoundError):
            await recovery.resolve(ONE_TRACK, BEATPORT_URL)

        assert opened.live.record(ONE_TRACK) == before


async def test_logs_the_state_the_track_keeps_when_a_correction_fails(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    """Un grep sur `status=unresolved` ne doit pas remonter un morceau toujours rattrape."""
    api = FakeApi()
    _bandcamp_found(api)
    caplog.set_level(logging.WARNING, logger="tagger.url_recovery")

    async with _recovering(one_track(tmp_path), api) as (_opened, recovery):
        await recovery.resolve(ONE_TRACK, BANDCAMP_TRACK)
        with pytest.raises(TrackNotFoundError):
            await recovery.resolve(ONE_TRACK, BEATPORT_URL)

    failures = [
        record.getMessage() for record in caplog.records if record.name == "tagger.url_recovery"
    ]
    assert len(failures) == 1
    assert "status=resolved" in failures[0]


async def test_resolves_the_track_without_artwork_when_the_artwork_download_fails(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    _bandcamp_found(api)
    cdn = FakeCdn()
    cdn.refused.add(ARTWORK)

    async with _recovering(one_track(tmp_path), api, cdn=cdn) as (opened, recovery):
        await recovery.resolve(ONE_TRACK, BANDCAMP_TRACK)

        record = opened.live.record(ONE_TRACK)
    assert record is not None
    assert (record.state, record.artwork) == (TrackState.RESOLVED, None)


async def test_stops_on_the_third_consecutive_api_key_rejection_across_gestures(
    tmp_path: Path,
) -> None:
    """La garde des 403 est celle du run : les gestes URL la partagent."""
    api = FakeApi()
    api.on("/bandcamp/tracks", "*", failing(403))

    async with _recovering(three_tracks(tmp_path), api) as (_opened, recovery):
        for track_id in ("a.mp3", "b.mp3"):
            with pytest.raises(ApiKeyRejectedError):
                await recovery.resolve(track_id, BANDCAMP_TRACK)

        with pytest.raises(ApiKeyRejectedRunError):
            await recovery.resolve("c.mp3", BANDCAMP_TRACK)


async def test_releases_the_track_after_a_failed_gesture(tmp_path: Path) -> None:
    api = FakeApi()
    broken = bandcamp_track_payload() | {"title": None}
    api.on("/bandcamp/tracks", BANDCAMP_TRACK, ok(broken))

    async with _recovering(one_track(tmp_path), api) as (opened, recovery):
        with pytest.raises(ApiContractError):
            await recovery.resolve(ONE_TRACK, BANDCAMP_TRACK)
        _bandcamp_found(api)

        await recovery.resolve(ONE_TRACK, BANDCAMP_TRACK)

        record = opened.live.record(ONE_TRACK)
    assert record is not None
    assert record.resolution is Resolution.URL


async def test_never_logs_the_pasted_url(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    """Le slug nomme l'artiste et le morceau : rien de l'URL dans les logs du module."""
    api = FakeApi()
    _bandcamp_found(api)
    caplog.set_level(logging.INFO, logger="tagger.url_recovery")

    async with _recovering(two_tracks(tmp_path), api) as (_opened, recovery):
        await recovery.resolve("a.mp3", BANDCAMP_TRACK)
        with pytest.raises(TrackNotFoundError):
            await recovery.resolve("b.mp3", "https://amelielens.bandcamp.com/track/unknown")

    ours = [
        record.getMessage() for record in caplog.records if record.name == "tagger.url_recovery"
    ]
    assert len(ours) == 2
    assert not any("bandcamp.com" in message for message in ours)
