import asyncio
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Final

import pytest
from audio_samples import tagged_mp3
from scraper_responses import (
    BANDCAMP_SEARCH,
    BASIEL,
    BEATPORT_SEARCH,
    BEATPORT_TRACKS,
    YOUR_MIND,
    failing,
    found,
    ok,
    track_payload,
)
from tagging_api import (
    ONE_TRACK,
    ORIGINAL,
    FakeApi,
    basiel,
    beatport_down,
    cancelled,
    hold_on_beatport,
    hold_with_bandcamp_fallback,
    must_be,
    must_record,
    must_record_as,
    networked_run,
    one_track,
    two_tracks,
)
from tagging_records import FIRST_TRACK, SECOND_TRACK, THIRD_TRACK, UNKNOWN_TRACK

from tagger.resolution.matching import DEFAULT_THRESHOLDS
from tagger.resolution.scraper_client import Source
from tagger.run.arbitration import (
    Arbitration,
    ArbitrationBusyError,
    ArbitrationCandidateUnknownError,
    ArbitrationNotPendingError,
    ArbitrationUpdated,
)
from tagger.run.models import (
    AwaitingArbitration,
    FailureReason,
    Resolution,
    Resolved,
    TrackResolved,
    TrackState,
    Unresolved,
)

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator, Awaitable, Callable
    from pathlib import Path

    from scraper_responses import Reply
    from tagging_api import OpenedRun

    from tagger.core.identifiers import TrackId
    from tagger.run.arbitration import ArbitrationEvent
    from tagger.run.models import PendingArbitration

    type Gesture = Callable[[Arbitration, TrackId], Awaitable[None]]

pytestmark = pytest.mark.asyncio

COPIES: Final = (FIRST_TRACK, SECOND_TRACK, THIRD_TRACK)
STRANGER: Final = basiel(id="43", source="bandcamp", mix_name=None)


def _copies(folder: Path) -> Path:
    """Trois fichiers du meme morceau : trois arbitrages qui partagent la garde des 403."""
    for name in COPIES:
        tagged_mp3(folder, name, "Adam Beyer", "Your Mind")
    return folder


@asynccontextmanager
async def _arbitrating(
    folder: Path, api: FakeApi, events: list[ArbitrationEvent] | None = None
) -> AsyncGenerator[tuple[OpenedRun, Arbitration]]:
    """Run ouvert apres sa phase reseau, et l'arbitrage qui porte sur lui."""
    sink: list[ArbitrationEvent] = events if events is not None else []
    async with networked_run(folder, api) as opened:
        yield opened, Arbitration(opened.live, opened.sources, sink.append)


def _shown(opened: OpenedRun) -> PendingArbitration:
    return must_record_as(opened.live, ONE_TRACK, AwaitingArbitration).outcome.pending


def _bandcamp_searches(api: FakeApi) -> int:
    return api.paths().count(BANDCAMP_SEARCH)


async def _choose(arbitration: Arbitration, track_id: TrackId) -> None:
    await arbitration.choose(track_id, Source.BEATPORT, 0)


async def _refuse(arbitration: Arbitration, track_id: TrackId) -> None:
    await arbitration.refuse(track_id, Source.BEATPORT)


async def _show(arbitration: Arbitration, track_id: TrackId) -> None:
    arbitration.show(track_id, Source.BANDCAMP)


each_gesture = pytest.mark.parametrize(
    "gesture", [_choose, _refuse, _show], ids=["choose", "refuse", "show"]
)


async def test_resolves_a_track_by_arbitration_with_the_refetched_candidate_and_its_artwork(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    hold_on_beatport(api)
    api.on(
        f"{BEATPORT_TRACKS}/2",
        "*",
        ok(track_payload(id="2", mix_name="Radio Edit", isrc="REFETCHED")),
    )
    events: list[ArbitrationEvent] = []

    async with _arbitrating(one_track(tmp_path), api, events) as (opened, arbitration):
        await arbitration.choose(ONE_TRACK, Source.BEATPORT, 1)

        record = must_record(opened.live, ONE_TRACK)
    resolved = must_be(record, Resolved)
    retained = resolved.outcome.retained
    assert (record.state, record.resolution, retained.source) == (
        TrackState.RESOLVED,
        Resolution.ARBITRATION,
        Source.BEATPORT,
    )
    assert retained.candidate.isrc == "REFETCHED"
    assert retained.artwork is not None
    assert events == [TrackResolved(resolved)]


@each_gesture
@pytest.mark.parametrize("track_id", [UNKNOWN_TRACK, ONE_TRACK], ids=["unknown", "resolved"])
async def test_rejects_a_gesture_on_a_track_that_is_unknown_or_already_resolved(
    tmp_path: Path, gesture: Gesture, track_id: TrackId
) -> None:
    api = FakeApi()
    api.on(BEATPORT_SEARCH, YOUR_MIND, found(ORIGINAL))

    async with _arbitrating(one_track(tmp_path), api) as (_opened, arbitration):
        with pytest.raises(ArbitrationNotPendingError, match="not awaiting"):
            await gesture(arbitration, track_id)


@pytest.mark.parametrize(
    ("source", "index"),
    [(Source.BANDCAMP, 0), (Source.BEATPORT, 2), (Source.BEATPORT, -1)],
    ids=["hidden-source", "past-the-end", "negative"],
)
async def test_rejects_a_candidate_outside_the_shown_list_or_from_a_hidden_source(
    tmp_path: Path, source: Source, index: int
) -> None:
    api = FakeApi()
    hold_on_beatport(api)

    async with _arbitrating(one_track(tmp_path), api) as (opened, arbitration):
        before = opened.live.record(ONE_TRACK)

        with pytest.raises(ArbitrationCandidateUnknownError, match="not in the shown list"):
            await arbitration.choose(ONE_TRACK, source, index)

        assert opened.live.record(ONE_TRACK) == before


@each_gesture
async def test_rejects_a_second_gesture_while_the_first_one_is_in_flight(
    tmp_path: Path, gesture: Gesture
) -> None:
    api = FakeApi()
    hold_on_beatport(api)
    refetch = api.gate(f"{BEATPORT_TRACKS}/2", "")

    async with _arbitrating(one_track(tmp_path), api) as (_opened, arbitration):
        first = asyncio.create_task(arbitration.choose(ONE_TRACK, Source.BEATPORT, 1), name="first")
        await refetch.wait_reached()
        calls = len(api.requests)

        with pytest.raises(ArbitrationBusyError, match="in flight"):
            await gesture(arbitration, ONE_TRACK)

        assert len(api.requests) == calls
        refetch.release.set()
        await first
    assert api.paths().count(f"{BEATPORT_TRACKS}/2") == 1


async def test_leaves_a_track_awaiting_and_unchanged_when_its_gesture_is_cancelled(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    hold_on_beatport(api)
    refetch = api.gate(f"{BEATPORT_TRACKS}/2", "")

    async with _arbitrating(one_track(tmp_path), api) as (opened, arbitration):
        before = opened.live.record(ONE_TRACK)
        gesture = asyncio.create_task(
            arbitration.choose(ONE_TRACK, Source.BEATPORT, 1), name="gesture"
        )
        await refetch.wait_reached()

        await cancelled(gesture)

        assert opened.live.record(ONE_TRACK) == before
        await arbitration.choose(ONE_TRACK, Source.BEATPORT, 0)
        after = must_record(opened.live, ONE_TRACK)
        assert after.state is TrackState.RESOLVED


async def test_calls_bandcamp_once_and_shows_its_list_when_beatport_is_refused(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    hold_with_bandcamp_fallback(api)
    events: list[ArbitrationEvent] = []

    async with _arbitrating(one_track(tmp_path), api, events) as (opened, arbitration):
        await arbitration.refuse(ONE_TRACK, Source.BEATPORT)

        record = must_record_as(opened.live, ONE_TRACK, AwaitingArbitration)
    pending = record.outcome.pending
    assert pending.source is Source.BANDCAMP
    assert [entry.candidate.id for entry in pending.candidates] == ["42"]
    assert events == [ArbitrationUpdated(record)]
    assert _bandcamp_searches(api) == 1


async def test_keeps_a_bandcamp_candidate_above_the_ceiling_in_the_list_after_a_refusal(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    hold_with_bandcamp_fallback(api)

    async with _arbitrating(one_track(tmp_path), api) as (opened, arbitration):
        await arbitration.refuse(ONE_TRACK, Source.BEATPORT)

        shown = _shown(opened)
        assert shown.candidates[0].score >= DEFAULT_THRESHOLDS.ceiling


async def test_shows_the_beatport_list_again_without_calling_any_source(tmp_path: Path) -> None:
    api = FakeApi()
    hold_with_bandcamp_fallback(api)
    events: list[ArbitrationEvent] = []

    async with _arbitrating(one_track(tmp_path), api, events) as (opened, arbitration):
        await arbitration.refuse(ONE_TRACK, Source.BEATPORT)
        calls = len(api.requests)

        arbitration.show(ONE_TRACK, Source.BEATPORT)

        shown = _shown(opened)
        assert shown.source is Source.BEATPORT
        assert [entry.candidate.id for entry in shown.candidates] == ["1", "2"]
        assert isinstance(events[-1], ArbitrationUpdated)
    assert len(api.requests) == calls


async def test_shows_the_known_bandcamp_list_again_on_a_second_refusal_without_calling_it(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    hold_with_bandcamp_fallback(api)

    async with _arbitrating(one_track(tmp_path), api) as (opened, arbitration):
        await arbitration.refuse(ONE_TRACK, Source.BEATPORT)
        arbitration.show(ONE_TRACK, Source.BEATPORT)

        await arbitration.refuse(ONE_TRACK, Source.BEATPORT)

        assert _shown(opened).source is Source.BANDCAMP
    assert _bandcamp_searches(api) == 1


async def test_leaves_a_track_unresolved_as_user_refused_when_bandcamp_is_refused(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    hold_with_bandcamp_fallback(api)
    events: list[ArbitrationEvent] = []

    async with _arbitrating(one_track(tmp_path), api, events) as (opened, arbitration):
        await arbitration.refuse(ONE_TRACK, Source.BEATPORT)

        await arbitration.refuse(ONE_TRACK, Source.BANDCAMP)

        record = must_record_as(opened.live, ONE_TRACK, Unresolved)
    assert (record.state, record.resolution, record.failure_reason) == (
        TrackState.UNRESOLVED,
        Resolution.NONE,
        FailureReason.USER_REFUSED,
    )
    assert events[-1] == TrackResolved(record)


@pytest.mark.parametrize(
    ("reply", "reason"),
    [
        (found(), FailureReason.NO_RESULT),
        (found(STRANGER), FailureReason.BELOW_THRESHOLD),
        (failing(503, "source_unavailable"), FailureReason.SOURCE_UNAVAILABLE),
    ],
    ids=["no-result", "below-threshold", "unavailable"],
)
async def test_keeps_the_bandcamp_reason_when_an_empty_list_is_passed(
    tmp_path: Path, reply: Reply, reason: FailureReason
) -> None:
    api = FakeApi()
    hold_on_beatport(api)
    api.on(BANDCAMP_SEARCH, YOUR_MIND, reply)

    async with _arbitrating(one_track(tmp_path), api) as (opened, arbitration):
        await arbitration.refuse(ONE_TRACK, Source.BEATPORT)
        shown = _shown(opened)
        assert (shown.candidates, shown.empty_reason) == ((), reason)

        await arbitration.refuse(ONE_TRACK, Source.BANDCAMP)

        record = must_record(opened.live, ONE_TRACK)
    assert (record.state, record.failure_reason) == (TrackState.UNRESOLVED, reason)


async def test_keeps_the_bandcamp_reason_of_an_empty_list_across_a_return_to_beatport(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    hold_on_beatport(api)

    async with _arbitrating(one_track(tmp_path), api) as (opened, arbitration):
        await arbitration.refuse(ONE_TRACK, Source.BEATPORT)
        arbitration.show(ONE_TRACK, Source.BEATPORT)
        await arbitration.refuse(ONE_TRACK, Source.BEATPORT)

        await arbitration.refuse(ONE_TRACK, Source.BANDCAMP)

        record = must_record(opened.live, ONE_TRACK)
    assert (record.state, record.failure_reason) == (TrackState.UNRESOLVED, FailureReason.NO_RESULT)
    assert _bandcamp_searches(api) == 1


async def test_refuses_a_track_without_calling_anything_when_beatport_was_unavailable(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    beatport_down(api)

    async with _arbitrating(one_track(tmp_path), api) as (opened, arbitration):
        calls = len(api.requests)

        await arbitration.refuse(ONE_TRACK, Source.BANDCAMP)

        record = must_record(opened.live, ONE_TRACK)
    assert record.failure_reason is FailureReason.USER_REFUSED
    assert len(api.requests) == calls


async def test_rejects_going_back_to_beatport_when_it_was_unavailable(tmp_path: Path) -> None:
    api = FakeApi()
    beatport_down(api)

    async with _arbitrating(one_track(tmp_path), api) as (_opened, arbitration):
        with pytest.raises(ArbitrationCandidateUnknownError, match="not in the shown list"):
            arbitration.show(ONE_TRACK, Source.BEATPORT)


async def test_leaves_the_bandcamp_list_empty_as_source_unavailable_when_the_key_is_rejected(
    music_folder: Path,
) -> None:
    """Trois refus en 403 : le troisieme declenche la garde du run, absorbee ici."""
    api = FakeApi()
    hold_on_beatport(api)
    api.on(BANDCAMP_SEARCH, "*", failing(403))

    async with _arbitrating(_copies(music_folder), api) as (opened, arbitration):
        for name in COPIES:
            await arbitration.refuse(name, Source.BEATPORT)

        records = [opened.live.record(name) for name in COPIES]
    assert all(
        record is not None
        and isinstance(record.outcome, AwaitingArbitration)
        and record.outcome.pending.empty_reason is FailureReason.SOURCE_UNAVAILABLE
        for record in records
    )


async def test_keeps_the_search_candidate_when_the_key_is_rejected_on_choice(
    music_folder: Path,
) -> None:
    """Deux refus en 403, puis un choix dont le refetch recoit le troisieme."""
    api = FakeApi()
    hold_on_beatport(api)
    api.on(BANDCAMP_SEARCH, "*", failing(403))
    api.on(f"{BEATPORT_TRACKS}/2", "*", failing(403))
    events: list[ArbitrationEvent] = []

    async with _arbitrating(_copies(music_folder), api, events) as (opened, arbitration):
        await arbitration.refuse(FIRST_TRACK, Source.BEATPORT)
        await arbitration.refuse(SECOND_TRACK, Source.BEATPORT)

        await arbitration.choose(THIRD_TRACK, Source.BEATPORT, 1)

        record = must_record_as(opened.live, THIRD_TRACK, Resolved)
    retained = record.outcome.retained
    assert (record.state, retained.resolution, retained.artwork) == (
        TrackState.RESOLVED,
        Resolution.ARBITRATION,
        None,
    )
    assert retained.candidate.id == "2"
    assert events[-1] == TrackResolved(record)


async def test_refuses_one_track_while_another_refusal_waits_for_bandcamp(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    hold_on_beatport(api)
    api.on(
        BEATPORT_SEARCH,
        BASIEL,
        found(basiel(id="3", mix_name="Extended Mix"), basiel(id="4", mix_name="Radio Edit")),
    )
    slow = api.gate(BANDCAMP_SEARCH, YOUR_MIND)

    async with _arbitrating(two_tracks(tmp_path), api) as (opened, arbitration):
        first = asyncio.create_task(arbitration.refuse(FIRST_TRACK, Source.BEATPORT), name="first")
        await slow.wait_reached()

        await arbitration.refuse(SECOND_TRACK, Source.BEATPORT)

        other = must_record_as(opened.live, SECOND_TRACK, AwaitingArbitration)
        assert other.outcome.pending.source is Source.BANDCAMP
        assert not first.done()
        slow.release.set()
        await first


async def test_rejects_choosing_in_an_empty_bandcamp_list(tmp_path: Path) -> None:
    api = FakeApi()
    hold_on_beatport(api)

    async with _arbitrating(one_track(tmp_path), api) as (opened, arbitration):
        await arbitration.refuse(ONE_TRACK, Source.BEATPORT)

        with pytest.raises(ArbitrationCandidateUnknownError, match="not in the shown list"):
            await arbitration.choose(ONE_TRACK, Source.BANDCAMP, 0)

        assert _shown(opened).source is Source.BANDCAMP


async def test_rejects_a_refusal_of_a_list_that_is_no_longer_shown(tmp_path: Path) -> None:
    api = FakeApi()
    hold_with_bandcamp_fallback(api)

    async with _arbitrating(one_track(tmp_path), api) as (opened, arbitration):
        await arbitration.refuse(ONE_TRACK, Source.BEATPORT)

        with pytest.raises(ArbitrationCandidateUnknownError, match="not in the shown list"):
            await arbitration.refuse(ONE_TRACK, Source.BEATPORT)

        record = must_record(opened.live, ONE_TRACK)
        assert record.state is None
        assert _shown(opened).source is Source.BANDCAMP


@pytest.mark.parametrize(
    "refusals", [(), (Source.BEATPORT,)], ids=["before-refusal", "after-refusal"]
)
async def test_rejects_showing_the_list_already_shown(
    tmp_path: Path, refusals: tuple[Source, ...]
) -> None:
    api = FakeApi()
    hold_with_bandcamp_fallback(api)
    events: list[ArbitrationEvent] = []

    async with _arbitrating(one_track(tmp_path), api, events) as (opened, arbitration):
        for source in refusals:
            await arbitration.refuse(ONE_TRACK, source)
        shown_source = _shown(opened).source
        before = list(events)

        with pytest.raises(ArbitrationCandidateUnknownError, match="not in the shown list"):
            arbitration.show(ONE_TRACK, shown_source)

        assert events == before
        assert _shown(opened).source is shown_source


async def test_calls_bandcamp_again_after_a_cancelled_refusal(tmp_path: Path) -> None:
    """La requete annulee n'atteint jamais l'API simulee : seule la seconde est comptee."""
    api = FakeApi()
    hold_with_bandcamp_fallback(api)
    slow = api.gate(BANDCAMP_SEARCH, YOUR_MIND)

    async with _arbitrating(one_track(tmp_path), api) as (opened, arbitration):
        refusal = asyncio.create_task(
            arbitration.refuse(ONE_TRACK, Source.BEATPORT), name="refusal"
        )
        await slow.wait_reached()
        await cancelled(refusal)
        assert _shown(opened).source is Source.BEATPORT
        slow.release.set()

        await arbitration.refuse(ONE_TRACK, Source.BEATPORT)

        assert _shown(opened).source is Source.BANDCAMP
    assert _bandcamp_searches(api) == 1
