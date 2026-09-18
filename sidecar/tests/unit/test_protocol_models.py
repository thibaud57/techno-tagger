"""Tests des modeles du protocole NDJSON."""

import json
from dataclasses import fields
from pathlib import Path
from typing import TYPE_CHECKING

import pytest
from pydantic import ValidationError

from tagger.errors import TaggerError
from tagger.extraction import (
    DiscardedCandidate,
    DuplicateResolution,
    ExtractionFailure,
    ExtractionMode,
    ExtractionResult,
)
from tagger.protocol import (
    DiscardedCandidatePayload,
    DuplicatePayload,
    ExtractionFinished,
    ExtractPlaylist,
    FailurePayload,
    GetVersion,
    ListPlaylists,
    Phase,
    Progress,
    Shutdown,
    Version,
    emit,
    error_from_business,
    error_from_validation,
    parse_command,
)

if TYPE_CHECKING:
    from _typeshed import DataclassInstance
    from pydantic import BaseModel


@pytest.mark.parametrize(
    ("line", "model"),
    [
        ('{"command":"get_version"}', GetVersion),
        ('{"command":"shutdown"}', Shutdown),
        ('{"command":"list_playlists","playlist_path":"C:/x/vlc_media.db"}', ListPlaylists),
        (
            '{"command":"extract_playlist","source_folder":"C:/lib",'
            '"destination_folder":"C:/work","playlist_path":"C:/x.m3u8"}',
            ExtractPlaylist,
        ),
    ],
    ids=["get_version", "shutdown", "list_playlists", "extract_playlist"],
)
def test_routes_a_line_to_its_command_model(line: str, model: type[BaseModel]) -> None:
    command = parse_command(line)

    assert isinstance(command, model)


def test_converts_a_json_string_into_a_path() -> None:
    command = parse_command('{"command":"list_playlists","playlist_path":"C:/x/vlc_media.db"}')

    assert isinstance(command, ListPlaylists)
    assert command.playlist_path.name == "vlc_media.db"


def test_defaults_the_mode_to_copy() -> None:
    command = parse_command(
        '{"command":"extract_playlist","source_folder":"C:/lib",'
        '"destination_folder":"C:/work","playlist_path":"C:/x.m3u8"}'
    )

    assert isinstance(command, ExtractPlaylist)
    assert command.mode is ExtractionMode.COPY


@pytest.mark.parametrize(
    ("line", "error_type"),
    [
        ('{"command":"list_playlists","playlist_path":"C:/x","extra":1}', "extra_forbidden"),
        ('{"command":"list_playlists"}', "missing"),
        ('{"command":"list_playlists","playlist_path":42}', "string_type"),
        ('{"command":"unheard_of"}', "union_tag_invalid"),
        ("pas du json", "json_invalid"),
        (
            '{"command":"extract_playlist","source_folder":"C:/lib",'
            '"destination_folder":"C:/work","playlist_path":"C:/x.m3u8","mode":"teleport"}',
            "enum",
        ),
    ],
    ids=[
        "undeclared_field",
        "missing_field",
        "wrong_type_not_coerced",
        "unknown_command",
        "not_json",
        "mode_outside_enum",
    ],
)
def test_rejects_a_malformed_line(line: str, error_type: str) -> None:
    with pytest.raises(ValidationError) as excinfo:
        parse_command(line)

    assert excinfo.value.errors()[0]["type"] == error_type


def test_commands_are_frozen() -> None:
    command = parse_command('{"command":"list_playlists","playlist_path":"C:/x"}')

    with pytest.raises(ValidationError):
        command.playlist_path = "C:/y"  # type: ignore[union-attr,misc]


def test_an_event_serialises_on_a_single_line() -> None:
    line = emit(Version(event="version", version="1.2.3", api_key_configured=True))

    assert "\n" not in line
    assert json.loads(line)["version"] == "1.2.3"


def test_progress_matches_the_shape_protocol_ts_mirrors() -> None:
    line = emit(Progress(event="progress", phase=Phase.EXTRACTION, processed=1, total=3))

    assert json.loads(line) == {
        "event": "progress",
        "phase": "extraction",
        "processed": 1,
        "total": 3,
    }


def test_extraction_finished_carries_the_five_categories_and_its_report() -> None:
    line = emit(
        ExtractionFinished(
            event="extraction_finished",
            extracted=("a.mp3",),
            already_present=("b.mp3",),
            missing=("c.mp3",),
            duplicates=(),
            failures=(),
            report_path=Path("C:/work/extraction-report-20260908T221500Z.json"),
        )
    )

    payload = json.loads(line)
    assert set(payload) == {
        "event",
        "extracted",
        "already_present",
        "missing",
        "duplicates",
        "failures",
        "report_path",
    }
    assert payload["report_path"].endswith(".json")


def test_a_validation_error_becomes_a_structured_event() -> None:
    with pytest.raises(ValidationError) as excinfo:
        parse_command('{"command":"list_playlists","playlist_path":"C:/x","extra":1}')

    event = error_from_validation(excinfo.value)

    assert event.code == "malformed_command"
    errors = event.params["errors"]
    assert isinstance(errors, list)
    first_error = errors[0]
    assert isinstance(first_error, dict)
    assert first_error["type"] == "extra_forbidden"


def test_an_unknown_command_is_named_in_the_error_params() -> None:
    with pytest.raises(ValidationError) as excinfo:
        parse_command('{"command":"unheard_of"}')

    event = error_from_validation(excinfo.value)

    assert event.params["command"] == "unheard_of"


def test_a_malformed_known_command_names_no_command() -> None:
    with pytest.raises(ValidationError) as excinfo:
        parse_command('{"command":"list_playlists","playlist_path":"C:/x","extra":1}')

    event = error_from_validation(excinfo.value)

    assert "command" not in event.params


def test_a_business_error_keeps_its_code_and_params() -> None:
    class BoomError(TaggerError):
        code = "playlist_not_found"

    event = error_from_business(BoomError("playlist not found: x", playlist_name="x"))

    assert event.code == "playlist_not_found"
    assert event.params == {"playlist_name": "x"}


@pytest.mark.parametrize(
    ("payload", "domain", "wire_only"),
    [
        (ExtractionFinished, ExtractionResult, frozenset({"event", "report_path"})),
        (DuplicatePayload, DuplicateResolution, frozenset()),
        (DiscardedCandidatePayload, DiscardedCandidate, frozenset()),
        (FailurePayload, ExtractionFailure, frozenset()),
    ],
    ids=["extraction_finished", "duplicate", "discarded_candidate", "failure"],
)
def test_an_extraction_payload_carries_every_field_the_extraction_records(
    payload: type[BaseModel], domain: type[DataclassInstance], wire_only: frozenset[str]
) -> None:
    carried = set(payload.model_fields) - wire_only

    assert carried == {field.name for field in fields(domain)}
