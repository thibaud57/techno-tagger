"""Protocole NDJSON de l'arbitrage, de bout en bout sur la boucle."""

from typing import TYPE_CHECKING

import pytest
from ndjson_loop import conversation
from scraper_responses import BASIEL, YOUR_MIND
from tagging_api import (
    ON_BANDCAMP,
    ONE_TRACK,
    FakeApi,
    found,
    hold_on_beatport,
    one_track,
    two_tracks,
)

if TYPE_CHECKING:
    from pathlib import Path

    from memory_keyring import MemoryKeyring
    from ndjson_loop import Conversation
    from tagging_api import Gate

pytestmark = [pytest.mark.asyncio, pytest.mark.usefixtures("_key")]

REFUSE_BEATPORT = {
    "command": "resolve_arbitration",
    "track_id": ONE_TRACK,
    "source": "beatport",
    "candidate": None,
}
CHOOSE_ON_BEATPORT = {
    "command": "resolve_arbitration",
    "track_id": ONE_TRACK,
    "source": "beatport",
    "candidate": 0,
}


@pytest.fixture
def folder(tmp_path: Path, app_data: None) -> Path:
    """Un morceau en zone grise."""
    return one_track(tmp_path)


@pytest.fixture
def empty(tmp_path: Path) -> Path:
    """Dossier sans morceau : le run qui le vise se termine aussitot."""
    folder = tmp_path / "empty"
    folder.mkdir()
    return folder


@pytest.fixture
def api(api: FakeApi) -> FakeApi:
    """Extended et Radio Edit sur Beatport, la version attendue sur Bandcamp."""
    hold_on_beatport(api)
    api.on("/bandcamp/search", YOUR_MIND, found(ON_BANDCAMP))
    return api


def _start(folder: Path) -> dict[str, object]:
    return {"command": "start_tagging", "folder": str(folder)}


async def _refusal_in_flight(talk: Conversation, folder: Path, api: FakeApi) -> Gate:
    """Run termine, refus de Beatport envoye, appel Bandcamp retenu par la porte rendue."""
    slow = api.gate("/bandcamp/search", YOUR_MIND)
    talk.send(**_start(folder))
    await talk.expect("run_finished")
    talk.send(**REFUSE_BEATPORT)
    await slow.reached.wait()
    return slow


async def test_refuses_beatport_then_resolves_the_track_on_a_bandcamp_candidate(
    folder: Path, api: FakeApi
) -> None:
    async with conversation() as talk:
        talk.send(**_start(folder))
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
    folder: Path, api: FakeApi
) -> None:
    async with conversation() as talk:
        talk.send(**_start(folder))
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
    slow = api.gate("/beatport/search", BASIEL)

    async with conversation() as talk:
        talk.send(**_start(folder))
        await talk.expect("arbitration_required", track_id="a.mp3")
        await slow.reached.wait()
        talk.send(command="cancel_run")
        talk.send(command="resolve_arbitration", track_id="a.mp3", source="beatport", candidate=0)
        resolved = await talk.expect("track_resolved", track_id="a.mp3")

    assert resolved["resolution"] == "arbitration"


async def test_drops_the_arbitrations_of_a_run_replaced_by_a_new_one(
    folder: Path, empty: Path, api: FakeApi
) -> None:
    async with conversation() as talk:
        talk.send(**_start(folder))
        await talk.expect("run_finished")
        talk.send(**_start(empty))
        await talk.expect("run_finished")
        talk.send(**CHOOSE_ON_BEATPORT)
        error = await talk.expect("error")

    assert (error["code"], error["command"], error["params"]) == (
        "arbitration_not_pending",
        "resolve_arbitration",
        {"track_id": ONE_TRACK},
    )


async def test_reports_a_rejected_gesture_with_its_command_and_its_track(
    folder: Path, api: FakeApi
) -> None:
    async with conversation() as talk:
        talk.send(**_start(folder))
        await talk.expect("run_finished")
        talk.send(command="switch_arbitration_source", track_id=ONE_TRACK, source="beatport")
        error = await talk.expect("error")

    assert (error["code"], error["command"], error["params"]) == (
        "arbitration_candidate_unknown",
        "switch_arbitration_source",
        {"track_id": ONE_TRACK},
    )


async def test_answers_another_command_while_a_refusal_waits_for_bandcamp(
    folder: Path, api: FakeApi
) -> None:
    async with conversation() as talk:
        slow = await _refusal_in_flight(talk, folder, api)
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


async def test_shuts_down_without_waiting_for_a_refusal_in_flight(
    folder: Path, api: FakeApi
) -> None:
    async with conversation() as talk:
        await _refusal_in_flight(talk, folder, api)
        talk.send(command="shutdown")

    assert all(event["event"] != "arbitration_updated" for event in talk.events)


async def test_cancels_a_refusal_in_flight_when_a_new_run_starts(
    folder: Path, empty: Path, api: FakeApi
) -> None:
    async with conversation() as talk:
        await _refusal_in_flight(talk, folder, api)
        talk.send(**_start(empty))
        await talk.expect("run_finished")

    assert all(event["event"] != "arbitration_updated" for event in talk.events)


async def test_leaves_no_arbitrable_run_when_a_new_one_fails_to_open(
    folder: Path, api: FakeApi, memory_keyring: MemoryKeyring
) -> None:
    async with conversation() as talk:
        talk.send(**_start(folder))
        await talk.expect("run_finished")
        memory_keyring.secrets.clear()
        talk.send(**_start(folder))
        await talk.expect("error", code="api_key_missing")
        talk.send(**CHOOSE_ON_BEATPORT)
        refused = await talk.expect("error", code="arbitration_not_pending")

    assert refused["command"] == "resolve_arbitration"
