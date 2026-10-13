"""Protocole NDJSON de l'arbitrage, de bout en bout sur la boucle."""

from typing import TYPE_CHECKING, Final

import pytest
from ndjson_loop import CHOOSE_ON_BEATPORT, Conversation, conversation, start_command
from scraper_responses import DIM_ORBIT, KELVOR
from tagging_api import (
    ON_BANDCAMP,
    ONE_TRACK,
    FakeApi,
    found,
    hold_on_beatport,
    two_tracks,
)

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

    from memory_keyring import MemoryKeyring
    from tagging_api import Gate

pytestmark = [pytest.mark.asyncio, pytest.mark.usefixtures("_key")]

REFUSE_BEATPORT: Final = {
    "command": "resolve_arbitration",
    "track_id": ONE_TRACK,
    "source": "beatport",
    "candidate": None,
}


@pytest.fixture
def api(api: FakeApi) -> FakeApi:
    """Extended et Radio Edit sur Beatport, la version attendue sur Bandcamp."""
    hold_on_beatport(api)
    api.on("/bandcamp/search", DIM_ORBIT, found(ON_BANDCAMP))
    return api


async def _refusal_in_flight(talk: Conversation, folder: Path, api: FakeApi) -> Gate:
    """Run termine, refus de Beatport envoye, appel Bandcamp retenu par la porte rendue."""
    slow = api.gate("/bandcamp/search", DIM_ORBIT)
    talk.send(**start_command(folder))
    await talk.expect("run_finished")
    talk.send(**REFUSE_BEATPORT)
    await slow.reached.wait()
    return slow


async def test_refuses_beatport_then_resolves_the_track_on_a_bandcamp_candidate(
    unresolved_folder: Path, api: FakeApi
) -> None:
    async with conversation() as talk:
        talk.send(**start_command(unresolved_folder))
        await talk.expect("run_finished")
        talk.send(**REFUSE_BEATPORT)
        switched = await talk.expect("arbitration_updated")
        talk.send(command="resolve_arbitration", track_id=ONE_TRACK, source="bandcamp", candidate=0)
        resolved = await talk.expect("track_resolved", track_id=ONE_TRACK)

    assert (switched["source"], switched["other_source"]) == ("bandcamp", "beatport")
    assert (resolved["state"], resolved["resolution"], resolved["source"]) == (
        "resolved",
        "arbitration",
        "bandcamp",
    )


async def test_shows_the_beatport_list_again_without_calling_the_api(
    unresolved_folder: Path, api: FakeApi
) -> None:
    async with conversation() as talk:
        talk.send(**start_command(unresolved_folder))
        await talk.expect("run_finished")
        talk.send(**REFUSE_BEATPORT)
        await talk.expect("arbitration_updated")
        calls = len(api.requests)
        talk.send(command="switch_arbitration_source", track_id=ONE_TRACK, source="beatport")
        back = await talk.expect("arbitration_updated")

    assert (back["source"], back["other_source"]) == ("beatport", "bandcamp")
    assert isinstance(back["candidates"], list)
    assert len(back["candidates"]) == 2
    assert len(api.requests) == calls


async def test_answers_an_awaiting_track_after_the_run_is_cancelled(
    tmp_path: Path, app_data: None, api: FakeApi
) -> None:
    folder = two_tracks(tmp_path)
    slow = api.gate("/beatport/search", KELVOR)

    async with conversation() as talk:
        talk.send(**start_command(folder))
        await talk.expect("arbitration_required", track_id="a.mp3")
        await slow.reached.wait()
        talk.send(command="cancel_run")
        talk.send(command="resolve_arbitration", track_id="a.mp3", source="beatport", candidate=0)
        resolved = await talk.expect("track_resolved", track_id="a.mp3")

    assert resolved["resolution"] == "arbitration"


async def test_keeps_the_current_run_arbitrable_when_a_second_run_is_refused(
    tmp_path: Path, app_data: None, api: FakeApi
) -> None:
    folder = two_tracks(tmp_path)
    slow = api.gate("/beatport/search", KELVOR)

    async with conversation() as talk:
        talk.send(**start_command(folder))
        await talk.expect("arbitration_required", track_id="a.mp3")
        await slow.reached.wait()
        talk.send(**start_command(folder))
        await talk.expect("error", code="phase_busy", params={"phase": "tagging"})
        talk.send(command="resolve_arbitration", track_id="a.mp3", source="beatport", candidate=0)
        resolved = await talk.expect("track_resolved", track_id="a.mp3")
        slow.release.set()

    assert resolved["resolution"] == "arbitration"


async def test_drops_the_arbitrations_of_a_run_replaced_by_a_new_one(
    unresolved_folder: Path, empty_folder: Path, api: FakeApi
) -> None:
    async with conversation() as talk:
        talk.send(**start_command(unresolved_folder))
        await talk.expect("run_finished")
        talk.send(**start_command(empty_folder))
        await talk.expect("run_finished")
        talk.send(**CHOOSE_ON_BEATPORT)
        error = await talk.expect("error")

    assert (error["code"], error["command"], error["params"]) == (
        "arbitration_not_pending",
        "resolve_arbitration",
        {"track_id": ONE_TRACK},
    )


async def test_reports_a_rejected_gesture_with_its_command_and_its_track(
    unresolved_folder: Path, api: FakeApi
) -> None:
    async with conversation() as talk:
        talk.send(**start_command(unresolved_folder))
        await talk.expect("run_finished")
        talk.send(command="switch_arbitration_source", track_id=ONE_TRACK, source="beatport")
        error = await talk.expect("error")

    assert (error["code"], error["command"], error["params"]) == (
        "arbitration_candidate_unknown",
        "switch_arbitration_source",
        {"track_id": ONE_TRACK},
    )


async def test_answers_another_command_while_a_refusal_waits_for_bandcamp(
    unresolved_folder: Path, api: FakeApi
) -> None:
    async with conversation() as talk:
        slow = await _refusal_in_flight(talk, unresolved_folder, api)
        talk.send(command="get_version")
        await talk.expect("version")
        slow.release.set()
        await talk.expect("arbitration_updated")

    names = [event["event"] for event in talk.events]
    assert names.index("version") < names.index("arbitration_updated")


async def test_rejects_a_gesture_before_any_run() -> None:
    async with conversation() as talk:
        talk.send(**CHOOSE_ON_BEATPORT)
        error = await talk.expect("error")

    assert (error["code"], error["command"]) == ("arbitration_not_pending", "resolve_arbitration")


@pytest.mark.parametrize(
    "leave",
    [lambda talk: talk.send(command="shutdown"), Conversation.hang_up],
    ids=["shutdown", "end-of-input"],
)
async def test_shuts_down_without_waiting_for_a_refusal_in_flight(
    unresolved_folder: Path, api: FakeApi, leave: Callable[[Conversation], None]
) -> None:
    async with conversation() as talk:
        await _refusal_in_flight(talk, unresolved_folder, api)
        leave(talk)

    assert all(event["event"] != "arbitration_updated" for event in talk.events)


async def test_cancels_a_refusal_in_flight_when_a_new_run_starts(
    unresolved_folder: Path, empty_folder: Path, api: FakeApi
) -> None:
    async with conversation() as talk:
        await _refusal_in_flight(talk, unresolved_folder, api)
        talk.send(**start_command(empty_folder))
        await talk.expect("run_finished")

    assert all(event["event"] != "arbitration_updated" for event in talk.events)


async def test_leaves_no_arbitrable_run_when_a_new_one_fails_to_open(
    unresolved_folder: Path, api: FakeApi, memory_keyring: MemoryKeyring
) -> None:
    async with conversation() as talk:
        talk.send(**start_command(unresolved_folder))
        await talk.expect("run_finished")
        memory_keyring.secrets.clear()
        talk.send(**start_command(unresolved_folder))
        await talk.expect("error", code="api_key_missing")
        talk.send(**CHOOSE_ON_BEATPORT)
        refused = await talk.expect("error", code="arbitration_not_pending")

    assert refused["command"] == "resolve_arbitration"
