"""Scenario de la demo : normalisation, cle de commande, assemblage et valeurs figees."""

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Final

import pytest
from demo_scenario import (
    DEMO_ROOT,
    DEMO_VERSION,
    KEY_FIELDS,
    VISITOR_RUN_AT,
    VISITOR_RUN_ID,
    DemoPaths,
    DemoRecordingError,
    Exchange,
    JsonObject,
    Outcome,
    Phase,
    ReplyState,
    assemble,
    command_key,
    frozen_sources,
    normalize,
)
from protocol_mirror import ts_discriminant_owners

from tagger import handlers
from tagger.run import tagging

if TYPE_CHECKING:
    from pathlib import Path

PATHS: Final = DemoPaths(vlc_dump="a", library="b", destination="c")
START: Final[JsonObject] = {"command": "start_tagging", "folder": "x"}
RUN_STARTED: Final[JsonObject] = {
    "event": "run_started",
    "run_id": "de0002",
    "folder": "x",
    "tracks": [],
}
IDLE: Final = Exchange(
    {"command": "list_runs"}, (), ReplyState({"t.mp3": Outcome.PENDING}, Phase.IDLE)
)


def test_replaces_the_sidecar_version_with_the_demo_version(tmp_path: Path) -> None:
    line: JsonObject = {"event": "version", "version": "9.9.9", "log_file": str(tmp_path / "x.log")}

    normalized = normalize(line, recording_root=tmp_path, covers_by_track={})

    assert normalized["version"] == DEMO_VERSION


@pytest.mark.parametrize(
    "value",
    ["Kaltwerk - Stahlregen.flac", "beatport", "https://beatport.example/track/a/1"],
    ids=["file-name", "source", "url"],
)
def test_leaves_strings_outside_the_recording_root_untouched(tmp_path: Path, value: str) -> None:
    message: JsonObject = {"event": "x", "v": value}

    normalized = normalize(message, recording_root=tmp_path, covers_by_track={})

    assert normalized["v"] == value


def test_rewrites_paths_under_the_recording_root_to_the_demo_prefix(tmp_path: Path) -> None:
    message: JsonObject = {
        "event": "x",
        "folder": str(tmp_path / "Musique" / "Extraction"),
        "nested": [{"path": str(tmp_path)}],
    }

    normalized = normalize(message, recording_root=tmp_path, covers_by_track={})

    assert normalized == {
        "event": "x",
        "folder": str(DEMO_ROOT / "Musique" / "Extraction"),
        "nested": [{"path": str(DEMO_ROOT)}],
    }


def test_rewrites_extended_length_paths_to_the_demo_prefix(tmp_path: Path) -> None:
    message: JsonObject = {"event": "x", "folder": "\\\\?\\" + str(tmp_path / "Musique")}

    normalized = normalize(message, recording_root=tmp_path, covers_by_track={})

    assert normalized["folder"] == str(DEMO_ROOT / "Musique")


def test_maps_an_artwork_cache_path_to_its_cover_file(tmp_path: Path) -> None:
    message: JsonObject = {
        "event": "track_resolved",
        "track_id": "t.mp3",
        "artwork_path": str(tmp_path / "c" / "ab12"),
    }

    normalized = normalize(
        message, recording_root=tmp_path, covers_by_track={"t.mp3": "artworks/CH012.svg"}
    )

    assert normalized["artwork_path"] == "artworks/CH012.svg"


def test_keys_a_command_on_its_identifying_fields_only() -> None:
    recorded: JsonObject = {"command": "start_tagging", "folder": r"C:\Users\Demo\Musique"}
    sent: JsonObject = {**recorded, "thresholds": {"floor": 70, "ceiling": 90}}
    rollback: JsonObject = {"command": "rollback", "run_id": "de0002"}

    assert command_key(sent) == command_key(recorded)
    assert command_key(rollback) == command_key({**rollback, "track_id": None})


def test_lists_every_protocol_command_in_the_key_fields_table() -> None:
    commands = set(ts_discriminant_owners("command"))

    assert set(KEY_FIELDS) == commands


def test_restarts_call_ranks_in_each_session() -> None:
    first = Exchange(START, (RUN_STARTED,), None)
    second = Exchange(START, (RUN_STARTED,), None)

    scenario = assemble([[IDLE, first], [IDLE, second]], PATHS)

    assert [reply.call for reply in scenario.stateless] == [1]


def test_refuses_two_different_replies_for_the_same_key() -> None:
    command: JsonObject = {"command": "get_version"}
    sessions = [
        [IDLE, Exchange(command, ({"event": "version", "version": "a"},), None)],
        [IDLE, Exchange(command, ({"event": "version", "version": "b"},), None)],
    ]

    with pytest.raises(DemoRecordingError, match="get_version"):
        assemble(sessions, PATHS)


def test_takes_the_starting_outcomes_from_the_idle_state() -> None:
    running = Exchange(
        {"command": "list_runs"}, (), ReplyState({"t.mp3": Outcome.REFUSED}, Phase.NOT_WRITTEN)
    )

    scenario = assemble([[IDLE, running]], PATHS)

    assert scenario.initial_outcomes == {"t.mp3": Outcome.PENDING}


def test_refuses_a_recording_without_an_idle_state() -> None:
    sessions = [[Exchange(START, (RUN_STARTED,), None)]]

    with pytest.raises(DemoRecordingError, match="no reply in phase idle"):
        assemble(sessions, PATHS)


def test_refuses_two_different_starting_outcomes() -> None:
    other = Exchange(
        {"command": "list_runs"}, (), ReplyState({"t.mp3": Outcome.UNRESOLVED}, Phase.IDLE)
    )

    with pytest.raises(DemoRecordingError, match="2 different starting outcomes"):
        assemble([[IDLE], [other]], PATHS)


def _drawn_sources() -> tuple[str, datetime]:
    # Les modules importent `secrets` et `datetime` sans les reexporter : mypy les refuse,
    # alors que c'est precisement ces attributs que le harnais remplace.
    run_id = tagging.secrets.token_hex(3)  # type: ignore[attr-defined]
    now = handlers.datetime.now(UTC)  # type: ignore[attr-defined]

    return run_id, now


def test_freezes_the_run_id_and_the_clock_inside_a_session_only() -> None:
    with frozen_sources(at=VISITOR_RUN_AT, run_id=VISITOR_RUN_ID):
        inside = _drawn_sources()

    assert inside == (VISITOR_RUN_ID, VISITOR_RUN_AT)
    assert _drawn_sources()[0] != VISITOR_RUN_ID
