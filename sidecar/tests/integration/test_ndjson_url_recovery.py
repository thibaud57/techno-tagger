from typing import TYPE_CHECKING

import pytest
from ndjson_loop import (
    arbitrate,
    cancelled_run,
    conversation,
    recover_by_url,
    resolved_run,
    start_command,
)
from scraper_responses import BANDCAMP_TRACK
from tagging_api import (
    BANDCAMP_TRACKS,
    ONE_TRACK,
    FakeApi,
    hold_on_beatport,
    knows_the_bandcamp_track,
    knows_your_mind,
)
from tagging_records import FIRST_TRACK

if TYPE_CHECKING:
    from pathlib import Path

    from tagging_api import Gate

pytestmark = [pytest.mark.asyncio, pytest.mark.usefixtures("_key")]


@pytest.fixture
def api(api: FakeApi) -> FakeApi:
    """L'URL Bandcamp collee designe un morceau connu de l'API."""
    knows_the_bandcamp_track(api)
    return api


async def test_resolves_a_track_by_url_end_to_end(unresolved_folder: Path) -> None:
    async with conversation() as talk:
        await resolved_run(talk, unresolved_folder)
        talk.send(**recover_by_url())
        resolved = await talk.expect("track_resolved", track_id=ONE_TRACK, resolution="url")
        progress = await talk.expect("progress", phase="url_recovery")

    assert (resolved["state"], resolved["source"], resolved["scores"]) == (
        "resolved",
        "bandcamp",
        None,
    )
    assert (progress["processed"], progress["total"]) == (1, 1)


async def test_reports_a_track_that_is_not_eligible_with_its_command_and_its_track(
    unresolved_folder: Path, api: FakeApi
) -> None:
    knows_your_mind(api)

    async with conversation() as talk:
        await resolved_run(talk, unresolved_folder)
        talk.send(**recover_by_url())
        error = await talk.expect("error")

    assert (error["code"], error["command"], error["params"]) == (
        "url_recovery_not_eligible",
        "resolve_by_url",
        {"track_id": ONE_TRACK},
    )


async def test_refuses_a_url_before_any_run() -> None:
    async with conversation() as talk:
        talk.send(**recover_by_url())
        error = await talk.expect("error")

    assert (error["code"], error["command"], error["params"]) == (
        "url_recovery_not_open",
        "resolve_by_url",
        {"track_id": ONE_TRACK},
    )


async def test_cancels_a_url_gesture_in_flight_when_a_new_run_starts(
    unresolved_folder: Path, empty_folder: Path, api: FakeApi
) -> None:
    fetch = api.gate(BANDCAMP_TRACKS, BANDCAMP_TRACK)

    async with conversation() as talk:
        await resolved_run(talk, unresolved_folder)
        talk.send(**recover_by_url())
        await fetch.wait_reached()
        talk.send(**start_command(empty_folder))
        talk.send(**recover_by_url())
        refused = await talk.expect("error")
        await talk.expect("run_finished")
        fetch.release.set()
        talk.send(command="get_version")
        await talk.expect("version")

    assert refused["code"] == "url_recovery_not_open"
    assert all(event.get("resolution") != "url" for event in talk.events)


async def test_opens_the_url_recovery_phase_once_the_network_phase_is_finished(
    unresolved_folder: Path,
) -> None:
    async with conversation() as talk:
        talk.send(**start_command(unresolved_folder))
        opened = await talk.expect("progress", phase="url_recovery")

    names = [event["event"] for event in talk.events]
    assert names[-2:] == ["run_finished", "progress"]
    assert (opened["processed"], opened["total"]) == (0, 1)


async def test_reports_a_client_error_with_its_command_and_its_track(
    unresolved_folder: Path,
) -> None:
    async with conversation() as talk:
        await resolved_run(talk, unresolved_folder)
        talk.send(**recover_by_url("https://www.youtube.com/watch?v=abc"))
        error = await talk.expect("error")

    assert (error["code"], error["command"], error["params"]) == (
        "unsupported_url",
        "resolve_by_url",
        {"track_id": ONE_TRACK},
    )


async def test_opens_the_url_recovery_phase_when_the_run_is_cancelled(
    two_tracks_folder: Path, basiel_gate: Gate
) -> None:
    """Un run interrompu garde son ecriture (spec F2 11), donc son rattrapage."""
    async with conversation() as talk:
        talk.send(**start_command(two_tracks_folder))
        await talk.expect("track_resolved", track_id=FIRST_TRACK, state="unresolved")
        await basiel_gate.wait_reached()
        opened = await cancelled_run(talk)
        talk.send(**recover_by_url(track_id=FIRST_TRACK))
        resolved = await talk.expect("track_resolved", track_id=FIRST_TRACK, resolution="url")

    assert (opened["processed"], opened["total"]) == (0, 1)
    assert resolved["state"] == "resolved"
    assert all(event["event"] != "run_finished" for event in talk.events)


async def test_emits_nothing_when_cancelling_a_finished_run(unresolved_folder: Path) -> None:
    async with conversation() as talk:
        talk.send(**start_command(unresolved_folder))
        await talk.expect("progress", phase="url_recovery")
        received = len(talk.events)
        talk.send(command="cancel_run")
        talk.send(command="get_version")
        await talk.expect("version")

    assert [event["event"] for event in talk.events[received:]] == ["version"]


async def test_reports_the_url_progress_after_a_late_arbitration_refusal(
    two_tracks_folder: Path, api: FakeApi
) -> None:
    """« Your Mind » attend un arbitrage, Bandcamp ne trouve rien : deux refus le rendent
    `unresolved` et le total du rattrapage passe de 1 a 2."""
    hold_on_beatport(api)

    async with conversation() as talk:
        talk.send(**start_command(two_tracks_folder))
        opened = await talk.expect("progress", phase="url_recovery")
        talk.send(**arbitrate("beatport", None, FIRST_TRACK))
        await talk.expect("arbitration_updated", track_id=FIRST_TRACK)
        talk.send(**arbitrate("bandcamp", None, FIRST_TRACK))
        await talk.expect("track_resolved", track_id=FIRST_TRACK, state="unresolved")
        grown = await talk.expect("progress", phase="url_recovery", total=2)

    assert (opened["total"], grown["processed"]) == (1, 0)


async def test_emits_no_url_progress_for_an_arbitration_during_the_network_phase(
    two_tracks_folder: Path, api: FakeApi, basiel_gate: Gate
) -> None:
    """Le total du rattrapage n'existe qu'une fois la phase reseau finie : un arbitrage
    resolu avant n'emet rien, l'ouverture de la phase s'en charge."""
    hold_on_beatport(api)

    async with conversation() as talk:
        talk.send(**start_command(two_tracks_folder))
        await talk.expect("arbitration_required", track_id=FIRST_TRACK)
        await basiel_gate.wait_reached()
        talk.send(**arbitrate("beatport", 0, FIRST_TRACK))
        await talk.expect("track_resolved", track_id=FIRST_TRACK, resolution="arbitration")
        basiel_gate.release.set()
        await talk.expect("run_finished")
        await talk.expect("progress", phase="url_recovery")

    finished = next(i for i, event in enumerate(talk.events) if event["event"] == "run_finished")
    progress = [
        i
        for i, event in enumerate(talk.events)
        if event["event"] == "progress" and event["phase"] == "url_recovery"
    ]
    assert len(progress) == 1
    assert progress[0] > finished
