"""Tests des gestes d'arbitrage sur un run vivant."""

import asyncio
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

import pytest
from scraper_responses import BASIEL, YOUR_MIND, track_payload
from tagging_api import (
    ON_BANDCAMP,
    ONE_TRACK,
    ORIGINAL,
    FakeApi,
    basiel,
    beatport_down,
    cancelled,
    failing,
    found,
    hold_on_beatport,
    ok,
    one_track,
    opened_run,
    tagged_mp3,
    two_tracks,
)

from tagger.arbitration import (
    Arbitration,
    ArbitrationBusyError,
    ArbitrationCandidateUnknownError,
    ArbitrationNotPendingError,
    ArbitrationUpdated,
)
from tagger.matching import DEFAULT_THRESHOLDS
from tagger.scraper_client import Source
from tagger.tagging import FailureReason, Resolution, TrackResolved, TrackState, resolve_run

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator, Awaitable, Callable
    from pathlib import Path

    from tagging_api import OpenedRun, Reply

    from tagger.arbitration import ArbitrationEvent
    from tagger.tagging import PendingArbitration

    type Gesture = Callable[[Arbitration, str], Awaitable[None]]

pytestmark = pytest.mark.asyncio

COPIES = ("a.mp3", "b.mp3", "c.mp3")
STRANGER = basiel(id="43", source="bandcamp", mix_name=None)


def _copies(tmp_path: Path) -> Path:
    """Trois fichiers du meme morceau : trois arbitrages qui partagent la garde des 403."""
    folder = tmp_path / "music"
    for name in COPIES:
        tagged_mp3(folder, name, "Adam Beyer", "Your Mind")
    return folder


@asynccontextmanager
async def _arbitrating(
    folder: Path, api: FakeApi, events: list[ArbitrationEvent] | None = None
) -> AsyncGenerator[tuple[OpenedRun, Arbitration]]:
    """Run ouvert apres sa phase reseau, et l'arbitrage qui porte sur lui."""
    sink: list[ArbitrationEvent] = events if events is not None else []
    async with opened_run(folder, api) as opened:
        await resolve_run(opened.live, opened.sources, on_event=lambda _event: None)
        yield opened, Arbitration(opened.live, opened.sources, sink.append)


def _shown(opened: OpenedRun) -> PendingArbitration:
    record = opened.live.record(ONE_TRACK)
    assert record is not None
    assert record.arbitration is not None
    return record.arbitration


def _bandcamp_searches(api: FakeApi) -> int:
    return api.paths().count("/bandcamp/search")


async def _choose(arbitration: Arbitration, track_id: str) -> None:
    await arbitration.choose(track_id, Source.BEATPORT, 0)


async def _refuse(arbitration: Arbitration, track_id: str) -> None:
    await arbitration.refuse(track_id, Source.BEATPORT)


async def _show(arbitration: Arbitration, track_id: str) -> None:
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
        "/beatport/tracks/2",
        "*",
        ok(track_payload(id="2", mix_name="Radio Edit", isrc="REFETCHED")),
    )
    events: list[ArbitrationEvent] = []

    async with _arbitrating(one_track(tmp_path), api, events) as (opened, arbitration):
        await arbitration.choose(ONE_TRACK, Source.BEATPORT, 1)

        record = opened.live.record(ONE_TRACK)
    assert record is not None
    assert (record.state, record.resolution, record.source, record.arbitration) == (
        TrackState.RESOLVED,
        Resolution.ARBITRATION,
        Source.BEATPORT,
        None,
    )
    assert record.candidate is not None
    assert record.candidate.isrc == "REFETCHED"
    assert record.artwork is not None
    assert events == [TrackResolved(record)]


@each_gesture
@pytest.mark.parametrize("track_id", ["ghost.mp3", ONE_TRACK], ids=["unknown", "resolved"])
async def test_rejects_a_gesture_on_a_track_that_is_unknown_or_already_resolved(
    tmp_path: Path, gesture: Gesture, track_id: str
) -> None:
    api = FakeApi()
    api.on("/beatport/search", YOUR_MIND, found(ORIGINAL))

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
    refetch = api.gate("/beatport/tracks/2", "")

    async with _arbitrating(one_track(tmp_path), api) as (_opened, arbitration):
        first = asyncio.create_task(arbitration.choose(ONE_TRACK, Source.BEATPORT, 1), name="first")
        await refetch.reached.wait()
        calls = len(api.requests)

        with pytest.raises(ArbitrationBusyError, match="in flight"):
            await gesture(arbitration, ONE_TRACK)

        assert len(api.requests) == calls
        refetch.release.set()
        await first
    assert api.paths().count("/beatport/tracks/2") == 1


async def test_leaves_a_track_awaiting_and_unchanged_when_its_gesture_is_cancelled(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    hold_on_beatport(api)
    refetch = api.gate("/beatport/tracks/2", "")

    async with _arbitrating(one_track(tmp_path), api) as (opened, arbitration):
        before = opened.live.record(ONE_TRACK)
        gesture = asyncio.create_task(
            arbitration.choose(ONE_TRACK, Source.BEATPORT, 1), name="gesture"
        )
        await refetch.reached.wait()

        await cancelled(gesture)

        assert opened.live.record(ONE_TRACK) == before
        await arbitration.choose(ONE_TRACK, Source.BEATPORT, 0)
        after = opened.live.record(ONE_TRACK)
        assert after is not None
        assert after.state is TrackState.RESOLVED


async def test_calls_bandcamp_once_and_shows_its_list_when_beatport_is_refused(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    hold_on_beatport(api)
    api.on("/bandcamp/search", YOUR_MIND, found(ON_BANDCAMP))
    events: list[ArbitrationEvent] = []

    async with _arbitrating(one_track(tmp_path), api, events) as (opened, arbitration):
        await arbitration.refuse(ONE_TRACK, Source.BEATPORT)

        record = opened.live.record(ONE_TRACK)
    assert record is not None
    assert record.arbitration is not None
    assert record.arbitration.source is Source.BANDCAMP
    assert [entry.candidate.id for entry in record.arbitration.candidates] == ["42"]
    assert events == [ArbitrationUpdated(record)]
    assert _bandcamp_searches(api) == 1


async def test_keeps_a_bandcamp_candidate_above_the_ceiling_in_the_list_after_a_refusal(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    hold_on_beatport(api)
    api.on("/bandcamp/search", YOUR_MIND, found(ON_BANDCAMP))

    async with _arbitrating(one_track(tmp_path), api) as (opened, arbitration):
        await arbitration.refuse(ONE_TRACK, Source.BEATPORT)

        record = opened.live.record(ONE_TRACK)
        assert record is not None
        assert record.state is None
        assert record.arbitration is not None
        assert record.arbitration.candidates[0].score >= DEFAULT_THRESHOLDS.ceiling


async def test_shows_the_beatport_list_again_without_calling_any_source(tmp_path: Path) -> None:
    api = FakeApi()
    hold_on_beatport(api)
    api.on("/bandcamp/search", YOUR_MIND, found(ON_BANDCAMP))
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
    hold_on_beatport(api)
    api.on("/bandcamp/search", YOUR_MIND, found(ON_BANDCAMP))

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
    hold_on_beatport(api)
    api.on("/bandcamp/search", YOUR_MIND, found(ON_BANDCAMP))
    events: list[ArbitrationEvent] = []

    async with _arbitrating(one_track(tmp_path), api, events) as (opened, arbitration):
        await arbitration.refuse(ONE_TRACK, Source.BEATPORT)

        await arbitration.refuse(ONE_TRACK, Source.BANDCAMP)

        record = opened.live.record(ONE_TRACK)
    assert record is not None
    assert (record.state, record.resolution, record.failure_reason, record.arbitration) == (
        TrackState.UNRESOLVED,
        Resolution.NONE,
        FailureReason.USER_REFUSED,
        None,
    )
    assert events[-1] == TrackResolved(record)


@pytest.mark.parametrize(
    ("reply", "reason"),
    [
        (None, FailureReason.NO_RESULT),
        (found(STRANGER), FailureReason.BELOW_THRESHOLD),
        (failing(503, "source_unavailable"), FailureReason.SOURCE_UNAVAILABLE),
    ],
    ids=["no-result", "below-threshold", "unavailable"],
)
async def test_keeps_the_bandcamp_reason_when_an_empty_list_is_passed(
    tmp_path: Path, reply: Reply | None, reason: FailureReason
) -> None:
    api = FakeApi()
    hold_on_beatport(api)
    if reply is not None:
        api.on("/bandcamp/search", YOUR_MIND, reply)

    async with _arbitrating(one_track(tmp_path), api) as (opened, arbitration):
        await arbitration.refuse(ONE_TRACK, Source.BEATPORT)
        shown = _shown(opened)
        assert (shown.candidates, shown.empty_reason) == ((), reason)

        await arbitration.refuse(ONE_TRACK, Source.BANDCAMP)

        record = opened.live.record(ONE_TRACK)
    assert record is not None
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

        record = opened.live.record(ONE_TRACK)
    assert record is not None
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

        record = opened.live.record(ONE_TRACK)
    assert record is not None
    assert record.failure_reason is FailureReason.USER_REFUSED
    assert len(api.requests) == calls


async def test_rejects_going_back_to_beatport_when_it_was_unavailable(tmp_path: Path) -> None:
    api = FakeApi()
    beatport_down(api)

    async with _arbitrating(one_track(tmp_path), api) as (_opened, arbitration):
        with pytest.raises(ArbitrationCandidateUnknownError, match="not in the shown list"):
            arbitration.show(ONE_TRACK, Source.BEATPORT)


async def test_leaves_the_bandcamp_list_empty_as_source_unavailable_when_the_key_is_rejected(
    tmp_path: Path,
) -> None:
    """Trois refus en 403 : le troisieme declenche la garde du run, absorbee ici."""
    api = FakeApi()
    hold_on_beatport(api)
    api.on("/bandcamp/search", "*", failing(403))

    async with _arbitrating(_copies(tmp_path), api) as (opened, arbitration):
        for name in COPIES:
            await arbitration.refuse(name, Source.BEATPORT)

        records = [opened.live.record(name) for name in COPIES]
    assert all(
        record is not None
        and record.arbitration is not None
        and record.arbitration.empty_reason is FailureReason.SOURCE_UNAVAILABLE
        for record in records
    )


async def test_keeps_the_search_candidate_when_the_key_is_rejected_on_choice(
    tmp_path: Path,
) -> None:
    """Deux refus en 403, puis un choix dont le refetch recoit le troisieme."""
    api = FakeApi()
    hold_on_beatport(api)
    api.on("/bandcamp/search", "*", failing(403))
    api.on("/beatport/tracks/2", "*", failing(403))
    events: list[ArbitrationEvent] = []

    async with _arbitrating(_copies(tmp_path), api, events) as (opened, arbitration):
        await arbitration.refuse("a.mp3", Source.BEATPORT)
        await arbitration.refuse("b.mp3", Source.BEATPORT)

        await arbitration.choose("c.mp3", Source.BEATPORT, 1)

        record = opened.live.record("c.mp3")
    assert record is not None
    assert (record.state, record.resolution, record.artwork) == (
        TrackState.RESOLVED,
        Resolution.ARBITRATION,
        None,
    )
    assert record.candidate is not None
    assert record.candidate.id == "2"
    assert events[-1] == TrackResolved(record)


async def test_refuses_one_track_while_another_refusal_waits_for_bandcamp(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    hold_on_beatport(api)
    api.on(
        "/beatport/search",
        BASIEL,
        found(basiel(id="3", mix_name="Extended Mix"), basiel(id="4", mix_name="Radio Edit")),
    )
    slow = api.gate("/bandcamp/search", YOUR_MIND)

    async with _arbitrating(two_tracks(tmp_path), api) as (opened, arbitration):
        first = asyncio.create_task(arbitration.refuse("a.mp3", Source.BEATPORT), name="first")
        await slow.reached.wait()

        await arbitration.refuse("b.mp3", Source.BEATPORT)

        other = opened.live.record("b.mp3")
        assert other is not None
        assert other.arbitration is not None
        assert other.arbitration.source is Source.BANDCAMP
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
    hold_on_beatport(api)
    api.on("/bandcamp/search", YOUR_MIND, found(ON_BANDCAMP))

    async with _arbitrating(one_track(tmp_path), api) as (opened, arbitration):
        await arbitration.refuse(ONE_TRACK, Source.BEATPORT)

        with pytest.raises(ArbitrationCandidateUnknownError, match="not in the shown list"):
            await arbitration.refuse(ONE_TRACK, Source.BEATPORT)

        record = opened.live.record(ONE_TRACK)
        assert record is not None
        assert record.state is None
        assert _shown(opened).source is Source.BANDCAMP


@pytest.mark.parametrize("refused", [False, True], ids=["before-refusal", "after-refusal"])
async def test_rejects_showing_the_list_already_shown(tmp_path: Path, refused: bool) -> None:
    api = FakeApi()
    hold_on_beatport(api)
    if refused:
        api.on("/bandcamp/search", YOUR_MIND, found(ON_BANDCAMP))
    events: list[ArbitrationEvent] = []

    async with _arbitrating(one_track(tmp_path), api, events) as (opened, arbitration):
        if refused:
            await arbitration.refuse(ONE_TRACK, Source.BEATPORT)
        shown_source = _shown(opened).source
        before = list(events)

        with pytest.raises(ArbitrationCandidateUnknownError, match="not in the shown list"):
            arbitration.show(ONE_TRACK, shown_source)

        assert events == before
        assert _shown(opened).source is shown_source


async def test_calls_bandcamp_again_after_a_cancelled_refusal(tmp_path: Path) -> None:
    """La requete annulee n'atteint jamais l'API simulee : seule la seconde est comptee."""
    api = FakeApi()
    hold_on_beatport(api)
    api.on("/bandcamp/search", YOUR_MIND, found(ON_BANDCAMP))
    slow = api.gate("/bandcamp/search", YOUR_MIND)

    async with _arbitrating(one_track(tmp_path), api) as (opened, arbitration):
        refusal = asyncio.create_task(
            arbitration.refuse(ONE_TRACK, Source.BEATPORT), name="refusal"
        )
        await slow.reached.wait()
        await cancelled(refusal)
        assert _shown(opened).source is Source.BEATPORT
        slow.release.set()

        await arbitration.refuse(ONE_TRACK, Source.BEATPORT)

        assert _shown(opened).source is Source.BANDCAMP
    assert _bandcamp_searches(api) == 1
