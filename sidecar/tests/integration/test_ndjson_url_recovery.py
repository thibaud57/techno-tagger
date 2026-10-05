"""Protocole NDJSON du rattrapage par URL, de bout en bout sur la boucle."""

from typing import TYPE_CHECKING

import pytest
from ndjson_loop import conversation
from scraper_responses import (
    BANDCAMP_TRACK,
    BASIEL,
    YOUR_MIND,
    bandcamp_track_payload,
)
from tagging_api import (
    ONE_TRACK,
    ORIGINAL,
    FakeApi,
    found,
    hold_on_beatport,
    ok,
    one_track,
    two_tracks,
)

if TYPE_CHECKING:
    from pathlib import Path

pytestmark = [pytest.mark.asyncio, pytest.mark.usefixtures("_key")]


@pytest.fixture
def folder(tmp_path: Path, app_data: None) -> Path:
    """Un morceau que ni Beatport ni Bandcamp ne trouvent : il finit `unresolved`."""
    return one_track(tmp_path)


@pytest.fixture
def empty(tmp_path: Path) -> Path:
    """Dossier sans morceau : le run qui le vise se termine aussitot."""
    folder = tmp_path / "empty"
    folder.mkdir()
    return folder


@pytest.fixture
def api(api: FakeApi) -> FakeApi:
    """L'URL Bandcamp collee designe un morceau connu de l'API."""
    api.on("/bandcamp/tracks", BANDCAMP_TRACK, ok(bandcamp_track_payload()))
    return api


def _start(folder: Path) -> dict[str, object]:
    return {"command": "start_tagging", "folder": str(folder)}


def _recover(url: str = BANDCAMP_TRACK, track_id: str = ONE_TRACK) -> dict[str, object]:
    return {"command": "resolve_by_url", "track_id": track_id, "url": url}


async def test_resolves_a_track_by_url_end_to_end(folder: Path, api: FakeApi) -> None:
    async with conversation() as talk:
        talk.send(**_start(folder))
        await talk.expect("run_finished")
        talk.send(**_recover())
        resolved = await talk.expect("track_resolved", track_id=ONE_TRACK, resolution="url")
        progress = await talk.expect("progress", phase="url_recovery")

    assert (resolved["state"], resolved["source"], resolved["scores"]) == (
        "resolved",
        "bandcamp",
        None,
    )
    assert (progress["processed"], progress["total"]) == (1, 1)


async def test_reports_a_track_that_is_not_eligible_with_its_command_and_its_track(
    folder: Path, api: FakeApi
) -> None:
    api.on("/beatport/search", YOUR_MIND, found(ORIGINAL))

    async with conversation() as talk:
        talk.send(**_start(folder))
        await talk.expect("run_finished")
        talk.send(**_recover())
        error = await talk.expect("error")

    assert (error["code"], error["command"], error["params"]) == (
        "url_recovery_not_eligible",
        "resolve_by_url",
        {"track_id": ONE_TRACK},
    )


async def test_refuses_a_url_before_any_run() -> None:
    async with conversation() as talk:
        talk.send(**_recover())
        error = await talk.expect("error")

    assert (error["code"], error["command"], error["params"]) == (
        "url_recovery_not_open",
        "resolve_by_url",
        {"track_id": ONE_TRACK},
    )


async def test_refuses_a_url_while_the_network_phase_is_running(folder: Path, api: FakeApi) -> None:
    slow = api.gate("/beatport/search", YOUR_MIND)

    async with conversation() as talk:
        talk.send(**_start(folder))
        await slow.reached.wait()
        talk.send(**_recover())
        error = await talk.expect("error")
        slow.release.set()
        await talk.expect("run_finished")

    assert error["code"] == "url_recovery_not_open"


async def test_cancels_a_url_gesture_in_flight_when_a_new_run_starts(
    folder: Path, empty: Path, api: FakeApi
) -> None:
    fetch = api.gate("/bandcamp/tracks", BANDCAMP_TRACK)

    async with conversation() as talk:
        talk.send(**_start(folder))
        await talk.expect("run_finished")
        talk.send(**_recover())
        await fetch.reached.wait()
        talk.send(**_start(empty))
        talk.send(**_recover())
        refused = await talk.expect("error")
        await talk.expect("run_finished")
        fetch.release.set()
        talk.send(command="get_version")
        await talk.expect("version")

    assert refused["code"] == "url_recovery_not_open"
    assert all(event.get("resolution") != "url" for event in talk.events)


async def test_opens_the_url_recovery_phase_once_the_network_phase_is_finished(
    folder: Path, api: FakeApi
) -> None:
    async with conversation() as talk:
        talk.send(**_start(folder))
        opened = await talk.expect("progress", phase="url_recovery")

    names = [event["event"] for event in talk.events]
    assert names[-2:] == ["run_finished", "progress"]
    assert (opened["processed"], opened["total"]) == (0, 1)


async def test_reports_a_client_error_with_its_command_and_its_track(
    folder: Path, api: FakeApi
) -> None:
    async with conversation() as talk:
        talk.send(**_start(folder))
        await talk.expect("run_finished")
        talk.send(**_recover("https://www.youtube.com/watch?v=abc"))
        error = await talk.expect("error")

    assert (error["code"], error["command"], error["params"]) == (
        "unsupported_url",
        "resolve_by_url",
        {"track_id": ONE_TRACK},
    )


async def test_opens_the_url_recovery_phase_when_the_run_is_cancelled(
    tmp_path: Path, app_data: None, api: FakeApi
) -> None:
    """Un run interrompu garde son ecriture (spec F2 11), donc son rattrapage."""
    folder = two_tracks(tmp_path)
    slow = api.gate("/beatport/search", BASIEL)

    async with conversation() as talk:
        talk.send(**_start(folder))
        await talk.expect("track_resolved", track_id="a.mp3", state="unresolved")
        await slow.reached.wait()
        talk.send(command="cancel_run")
        opened = await talk.expect("progress", phase="url_recovery")
        talk.send(**_recover(track_id="a.mp3"))
        resolved = await talk.expect("track_resolved", track_id="a.mp3", resolution="url")

    assert (opened["processed"], opened["total"]) == (0, 1)
    assert resolved["state"] == "resolved"
    assert all(event["event"] != "run_finished" for event in talk.events)


async def test_emits_nothing_when_cancelling_a_finished_run(folder: Path, api: FakeApi) -> None:
    async with conversation() as talk:
        talk.send(**_start(folder))
        await talk.expect("progress", phase="url_recovery")
        received = len(talk.events)
        talk.send(command="cancel_run")
        talk.send(command="get_version")
        await talk.expect("version")

    assert [event["event"] for event in talk.events[received:]] == ["version"]


async def test_reports_the_url_progress_after_a_late_arbitration_refusal(
    tmp_path: Path, app_data: None, api: FakeApi
) -> None:
    """« Your Mind » attend un arbitrage, Bandcamp ne trouve rien : deux refus le rendent
    `unresolved` et le total du rattrapage passe de 1 a 2."""
    hold_on_beatport(api)
    folder = two_tracks(tmp_path)

    async with conversation() as talk:
        talk.send(**_start(folder))
        opened = await talk.expect("progress", phase="url_recovery")
        talk.send(
            command="resolve_arbitration", track_id="a.mp3", source="beatport", candidate=None
        )
        await talk.expect("arbitration_updated", track_id="a.mp3")
        talk.send(
            command="resolve_arbitration", track_id="a.mp3", source="bandcamp", candidate=None
        )
        await talk.expect("track_resolved", track_id="a.mp3", state="unresolved")
        grown = await talk.expect("progress", phase="url_recovery", total=2)

    assert (opened["total"], grown["processed"]) == (1, 0)


async def test_emits_no_url_progress_for_an_arbitration_during_the_network_phase(
    tmp_path: Path, app_data: None, api: FakeApi
) -> None:
    """Le total du rattrapage n'existe qu'une fois la phase reseau finie : un arbitrage
    resolu avant n'emet rien, l'ouverture de la phase s'en charge."""
    hold_on_beatport(api)
    folder = two_tracks(tmp_path)
    slow = api.gate("/beatport/search", BASIEL)

    async with conversation() as talk:
        talk.send(**_start(folder))
        await talk.expect("arbitration_required", track_id="a.mp3")
        await slow.reached.wait()
        talk.send(command="resolve_arbitration", track_id="a.mp3", source="beatport", candidate=0)
        await talk.expect("track_resolved", track_id="a.mp3", resolution="arbitration")
        slow.release.set()
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
