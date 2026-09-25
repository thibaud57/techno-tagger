"""Protocole NDJSON d'un run de re-tagging, de bout en bout sur la boucle."""

import json
from typing import TYPE_CHECKING

import httpx2
import pytest
from ndjson_loop import drive
from scraper_responses import track_payload
from tagging_api import FakeApi, FakeCdn, failing, found, public_resolver, tagged_mp3

from tagger import handlers
from tagger.api_key import SERVICE, USERNAME

if TYPE_CHECKING:
    from pathlib import Path

    from memory_keyring import MemoryKeyring

QUERY = "Adam Beyer Your Mind"
ORIGINAL = track_payload(mix_name="Original Mix")


def start_tagging(folder: Path, **payload: object) -> str:
    return json.dumps({"command": "start_tagging", "folder": str(folder), **payload}) + "\n"


@pytest.fixture
def run_folder(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Trois morceaux, et un dossier de donnees d'application isole."""
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "appdata"))
    folder = tmp_path / "music"
    tagged_mp3(folder, "a.mp3", "Adam Beyer", "Your Mind")
    tagged_mp3(folder, "b.mp3", "Amelie Lens", "Basiel")
    tagged_mp3(folder, "c.mp3", "Sara Landry", "The Void")
    return folder


@pytest.fixture
def api(monkeypatch: pytest.MonkeyPatch) -> FakeApi:
    """API et CDN simules, poses a la place des transports de production.

    Le resolveur d'hote est aussi remplace : sans lui, `ArtworkFetcher` ferait un
    vrai `socket.getaddrinfo` sur l'hote du CDN simule avant chaque telechargement.
    """
    fake = FakeApi()
    cdn = FakeCdn()
    monkeypatch.setattr(
        handlers,
        "tagging_transports",
        lambda: handlers.TaggingTransports(
            httpx2.MockTransport(fake.handler), httpx2.MockTransport(cdn.handler), public_resolver
        ),
    )
    return fake


@pytest.fixture
def _key(memory_keyring: MemoryKeyring) -> None:
    memory_keyring.secrets[(SERVICE, USERNAME)] = "k3y-t0k3n"


@pytest.fixture
def api_knowing_your_mind(api: FakeApi) -> FakeApi:
    """API qui valide « Adam Beyer - Your Mind », recherche et refetch compris."""
    api.on("/beatport/search", QUERY, found(ORIGINAL))
    api.on("/beatport/tracks/17492013", "*", found(ORIGINAL))
    return api


@pytest.mark.usefixtures("_key")
def test_emits_the_whole_sequence_of_a_tagging_run(
    run_folder: Path, api_knowing_your_mind: FakeApi
) -> None:
    api_knowing_your_mind.on(
        "/beatport/search",
        "Amelie Lens Basiel",
        found(
            track_payload(artists=[{"name": "Amelie Lens"}], title="Basiel", mix_name="Club Mix")
        ),
    )

    events = drive(start_tagging(run_folder))

    tracks = events[0]["tracks"]
    assert events[0]["event"] == "run_started"
    assert isinstance(tracks, list)
    assert [track["track_id"] for track in tracks] == ["a.mp3", "b.mp3", "c.mp3"]
    assert {event["event"] for event in events[1:-1]} <= {
        "track_resolved",
        "arbitration_required",
        "progress",
    }
    assert events[-1] == {
        "event": "run_finished",
        "phase": "network",
        "run_id": events[0]["run_id"],
        "resolved": 1,
        "unresolved": 1,
        "awaiting_arbitration": 1,
    }


@pytest.mark.usefixtures("_key")
def test_describes_a_resolved_track_with_its_source_its_scores_and_its_artwork(
    run_folder: Path, api_knowing_your_mind: FakeApi
) -> None:
    events = drive(start_tagging(run_folder))

    resolved = next(
        event
        for event in events
        if event["event"] == "track_resolved" and event["track_id"] == "a.mp3"
    )
    assert resolved["state"] == "resolved"
    assert resolved["resolution"] == "auto"
    assert resolved["failure_reason"] is None
    assert resolved["source"] == "beatport"
    assert resolved["after"] == {"artist": "Adam Beyer", "title": "Your Mind (Original Mix)"}
    assert resolved["scores"] == {"artist": 100, "title": 100, "average": 100}
    assert str(resolved["artwork_path"]).endswith(".jpg")


@pytest.mark.usefixtures("_key")
def test_answers_a_version_request_while_a_run_is_in_progress(
    run_folder: Path, api: FakeApi
) -> None:
    events = drive(start_tagging(run_folder) + '{"command":"get_version"}\n')

    names = [event["event"] for event in events]
    assert names.index("version") < names.index("run_finished")


@pytest.mark.usefixtures("_key")
def test_refuses_a_second_tagging_run_while_one_is_in_progress(
    run_folder: Path, api: FakeApi
) -> None:
    events = drive(start_tagging(run_folder) * 2)

    errors = [event for event in events if event["event"] == "error"]
    assert [error["code"] for error in errors] == ["tagging_in_progress"]
    assert events[-1]["event"] == "run_finished"


def test_reports_a_missing_api_key_without_calling_the_api(run_folder: Path, api: FakeApi) -> None:
    events = drive(start_tagging(run_folder))

    assert [event["event"] for event in events] == ["error"]
    assert events[0]["code"] == "api_key_missing"
    assert api.requests == []


@pytest.mark.usefixtures("_key")
def test_reports_a_rejected_api_key_and_never_finishes_the_run(
    run_folder: Path, api: FakeApi
) -> None:
    api.on("/beatport/search", "*", failing(403))

    events = drive(start_tagging(run_folder))

    assert events[-1]["event"] == "error"
    assert events[-1]["code"] == "api_key_rejected"
    assert all(event["event"] != "run_finished" for event in events)


@pytest.mark.usefixtures("_key")
def test_refuses_thresholds_out_of_bounds(run_folder: Path, api: FakeApi) -> None:
    command = start_tagging(run_folder, thresholds={"floor": 95, "ceiling": 90})

    events = drive(command)

    assert [event["event"] for event in events] == ["error"]
    assert events[0]["code"] == "malformed_command"
    assert "95" not in json.dumps(events[0]["params"])
