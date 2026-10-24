from typing import TYPE_CHECKING

import pytest
from ndjson_loop import (
    CHOOSE_ON_BEATPORT,
    REFUSE_BEATPORT,
    SWITCH_TO_BEATPORT,
    arbitrate,
    conversation,
    resolved_run,
    rows,
    start_command,
)
from scraper_responses import YOUR_MIND
from tagging_api import BANDCAMP_SEARCH, ONE_TRACK, FakeApi, hold_with_bandcamp_fallback
from tagging_records import FIRST_TRACK

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable
    from pathlib import Path

    from memory_keyring import MemoryKeyring
    from ndjson_loop import Conversation
    from tagging_api import Gate

pytestmark = [pytest.mark.asyncio, pytest.mark.usefixtures("_key")]


@pytest.fixture
def api(api: FakeApi) -> FakeApi:
    """Extended et Radio Edit sur Beatport, la version attendue sur Bandcamp."""
    hold_with_bandcamp_fallback(api)
    return api


async def _refusal_in_flight(talk: Conversation, folder: Path, api: FakeApi) -> Gate:
    """Run termine, refus de Beatport envoye, appel Bandcamp retenu par la porte rendue."""
    slow = api.gate(BANDCAMP_SEARCH, YOUR_MIND)
    await resolved_run(talk, folder)
    talk.send(**REFUSE_BEATPORT)
    await slow.wait_reached()
    return slow


async def test_refuses_beatport_then_resolves_the_track_on_a_bandcamp_candidate(
    unresolved_folder: Path,
) -> None:
    async with conversation() as talk:
        await resolved_run(talk, unresolved_folder)
        talk.send(**REFUSE_BEATPORT)
        switched = await talk.expect("arbitration_updated")
        talk.send(**arbitrate("bandcamp", 0))
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
        await resolved_run(talk, unresolved_folder)
        talk.send(**REFUSE_BEATPORT)
        await talk.expect("arbitration_updated")
        calls = len(api.requests)
        talk.send(**SWITCH_TO_BEATPORT)
        back = await talk.expect("arbitration_updated")

    assert (back["source"], back["other_source"]) == ("beatport", "bandcamp")
    assert len(rows(back, "candidates")) == 2
    assert len(api.requests) == calls


async def test_answers_an_awaiting_track_after_the_run_is_cancelled(
    two_tracks_folder: Path, basiel_gate: Gate
) -> None:
    async with conversation() as talk:
        talk.send(**start_command(two_tracks_folder))
        await talk.expect("arbitration_required", track_id=FIRST_TRACK)
        await basiel_gate.wait_reached()
        talk.send(command="cancel_run")
        talk.send(**arbitrate("beatport", 0, FIRST_TRACK))
        resolved = await talk.expect("track_resolved", track_id=FIRST_TRACK)

    assert resolved["resolution"] == "arbitration"


async def test_keeps_the_current_run_arbitrable_when_a_second_run_is_refused(
    two_tracks_folder: Path, basiel_gate: Gate
) -> None:
    async with conversation() as talk:
        talk.send(**start_command(two_tracks_folder))
        await talk.expect("arbitration_required", track_id=FIRST_TRACK)
        await basiel_gate.wait_reached()
        talk.send(**start_command(two_tracks_folder))
        await talk.expect("error", code="phase_busy", params={"phase": "tagging"})
        talk.send(**arbitrate("beatport", 0, FIRST_TRACK))
        resolved = await talk.expect("track_resolved", track_id=FIRST_TRACK)
        basiel_gate.release.set()

    assert resolved["resolution"] == "arbitration"


async def _no_run(
    _talk: Conversation, _folder: Path, _empty: Path, _keyring: MemoryKeyring
) -> None:
    pass


async def _replaced_by_an_empty_run(
    talk: Conversation, folder: Path, empty: Path, _keyring: MemoryKeyring
) -> None:
    await resolved_run(talk, folder)
    talk.send(**start_command(empty))
    await talk.expect("run_finished")


async def _failed_to_open(
    talk: Conversation, folder: Path, _empty: Path, keyring: MemoryKeyring
) -> None:
    await resolved_run(talk, folder)
    keyring.secrets.clear()
    talk.send(**start_command(folder))
    await talk.expect("error", code="api_key_missing")


@pytest.mark.parametrize(
    "arrange",
    [_no_run, _replaced_by_an_empty_run, _failed_to_open],
    ids=["before-any-run", "run-replaced", "new-run-failed-to-open"],
)
async def test_leaves_no_arbitrable_run(
    unresolved_folder: Path,
    empty_folder: Path,
    memory_keyring: MemoryKeyring,
    arrange: Callable[[Conversation, Path, Path, MemoryKeyring], Awaitable[None]],
) -> None:
    async with conversation() as talk:
        await arrange(talk, unresolved_folder, empty_folder, memory_keyring)
        talk.send(**CHOOSE_ON_BEATPORT)
        error = await talk.expect("error", code="arbitration_not_pending")

    assert (error["command"], error["params"]) == ("resolve_arbitration", {"track_id": ONE_TRACK})


async def test_reports_a_rejected_gesture_with_its_command_and_its_track(
    unresolved_folder: Path,
) -> None:
    async with conversation() as talk:
        await resolved_run(talk, unresolved_folder)
        talk.send(**SWITCH_TO_BEATPORT)
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


async def _shut_down(talk: Conversation, _empty: Path) -> None:
    talk.shut_down()


async def _hang_up(talk: Conversation, _empty: Path) -> None:
    talk.hang_up()


async def _start_another_run(talk: Conversation, empty: Path) -> None:
    talk.send(**start_command(empty))
    await talk.expect("run_finished")


@pytest.mark.parametrize(
    "leave",
    [_shut_down, _hang_up, _start_another_run],
    ids=["shutdown", "end-of-input", "new-run"],
)
async def test_drops_a_refusal_in_flight_when_the_session_or_the_run_ends(
    unresolved_folder: Path,
    empty_folder: Path,
    api: FakeApi,
    leave: Callable[[Conversation, Path], Awaitable[None]],
) -> None:
    async with conversation() as talk:
        await _refusal_in_flight(talk, unresolved_folder, api)
        await leave(talk, empty_folder)

    assert all(event["event"] != "arbitration_updated" for event in talk.events)
