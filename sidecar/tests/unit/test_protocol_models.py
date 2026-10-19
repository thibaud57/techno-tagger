import json
from pathlib import Path
from typing import TYPE_CHECKING, Final, get_args

import pytest
from mirrors import assert_same_fields
from pydantic import ValidationError

from tagger.core.file_failures import FileFailureReason
from tagger.playlists.errors import PlaylistNotFoundError
from tagger.playlists.extraction import (
    DiscardedCandidate,
    DuplicateResolution,
    ExtractionFailure,
    ExtractionMode,
    ExtractionResult,
)
from tagger.protocol import (
    AnyCommand,
    CancelRun,
    CommandName,
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
    ThresholdsPayload,
    TrackResolved,
    Version,
    emit,
    error_from_business,
    error_from_validation,
    parse_command,
)
from tagger.run.models import FailureReason, Resolution, TrackState

if TYPE_CHECKING:
    from _typeshed import DataclassInstance
    from pydantic import BaseModel


EXTRA_FIELD_LINE: Final = '{"command":"list_playlists","playlist_path":"C:/x","extra":1}'
UNKNOWN_COMMAND_LINE: Final = '{"command":"unheard_of"}'


@pytest.mark.parametrize(
    ("line", "model"),
    [
        ('{"command":"get_version"}', GetVersion),
        ('{"command":"shutdown"}', Shutdown),
        ('{"command":"cancel_run"}', CancelRun),
        ('{"command":"list_playlists","playlist_path":"C:/x/vlc_media.db"}', ListPlaylists),
        (
            '{"command":"extract_playlist","source_folder":"C:/lib",'
            '"destination_folder":"C:/work","playlist_path":"C:/x.m3u8"}',
            ExtractPlaylist,
        ),
    ],
    ids=["get-version", "shutdown", "cancel-run", "list-playlists", "extract-playlist"],
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
        (EXTRA_FIELD_LINE, "extra_forbidden"),
        ('{"command":"list_playlists"}', "missing"),
        ('{"command":"list_playlists","playlist_path":42}', "string_type"),
        (UNKNOWN_COMMAND_LINE, "union_tag_invalid"),
        ("pas du json", "json_invalid"),
        (
            '{"command":"extract_playlist","source_folder":"C:/lib",'
            '"destination_folder":"C:/work","playlist_path":"C:/x.m3u8","mode":"teleport"}',
            "enum",
        ),
    ],
    ids=[
        "undeclared-field",
        "missing-field",
        "wrong-type-not-coerced",
        "unknown-command",
        "not-json",
        "mode-outside-enum",
    ],
)
def test_rejects_a_malformed_line(line: str, error_type: str) -> None:
    """Le `type` part tel quel dans `params.errors` de l'evenement : il fait partie du contrat."""
    with pytest.raises(ValidationError) as excinfo:
        parse_command(line)

    assert excinfo.value.errors()[0]["type"] == error_type


def test_an_event_serialises_on_a_single_line() -> None:
    line = emit(
        Version(
            event="version",
            version="1.2.3",
            api_key_configured=True,
            sentry_selftest=False,
            default_thresholds=ThresholdsPayload(floor=65, ceiling=85),
            log_file=Path("C:/data/trace.log"),
        )
    )

    assert "\n" not in line
    assert json.loads(line)["version"] == "1.2.3"


@pytest.mark.parametrize(
    "reason",
    [FailureReason.NO_RESULT, FileFailureReason.FILE_LOCKED],
    ids=["track-reason", "file-reason"],
)
def test_a_failure_reason_serialises_as_its_plain_name(
    reason: FailureReason | FileFailureReason,
) -> None:
    event = TrackResolved(
        event="track_resolved",
        track_id="a.mp3",
        state=TrackState.WRITE_ERROR,
        resolution=Resolution.AUTO,
        failure_reason=reason,
    )

    sent = json.loads(emit(event))

    assert (sent["failure_reason"], sent["restorable"]) == (reason.value, False)


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
        parse_command(EXTRA_FIELD_LINE)

    event = error_from_validation(excinfo.value)

    assert event.code == "malformed_command"
    errors = event.params["errors"]
    assert isinstance(errors, list)
    first_error = errors[0]
    assert isinstance(first_error, dict)
    assert first_error["type"] == "extra_forbidden"


def test_an_unknown_command_is_named_in_the_error_params() -> None:
    with pytest.raises(ValidationError) as excinfo:
        parse_command(UNKNOWN_COMMAND_LINE)

    event = error_from_validation(excinfo.value)

    assert event.params["command"] == "unheard_of"


def test_a_malformed_known_command_names_no_command() -> None:
    with pytest.raises(ValidationError) as excinfo:
        parse_command(EXTRA_FIELD_LINE)

    event = error_from_validation(excinfo.value)

    assert "command" not in event.params


def test_a_business_error_keeps_its_code_and_params_and_names_its_command() -> None:
    event = error_from_business(PlaylistNotFoundError("x"), "list_playlists")

    assert event.code == "playlist_not_found"
    assert event.params == {"playlist_name": "x"}
    assert event.command == "list_playlists"


def test_command_name_lists_every_command() -> None:
    """Une commande ajoutee sans sa valeur ici ne casserait qu'au premier appel de
    `error_from_business`, loin de l'endroit ou elle a ete declaree.
    """
    declared = {
        get_args(model.model_fields["command"].annotation)[0]
        for model in get_args(get_args(AnyCommand.__value__)[0])
    }

    assert declared == set(get_args(CommandName.__value__))


def test_an_api_key_pasted_with_a_space_says_what_to_fix() -> None:
    """Regression : ce refus sortait en erreur interne, la ou la cle seule est a corriger."""
    with pytest.raises(ValidationError) as excinfo:
        parse_command('{"command":"set_api_key","api_key":"abc def"}')

    event = error_from_validation(excinfo.value)

    assert event.code == "api_key_malformed"
    assert event.command == "set_api_key"


def test_a_refused_value_never_travels_with_its_error() -> None:
    """La cle refusee est un secret : rien en aval ne la masquerait. Le scrubbing Sentry
    de la webview n'efface que des chemins et `loc` plus `type` suffisent aux logs.
    """
    with pytest.raises(ValidationError) as excinfo:
        parse_command('{"command":"set_api_key","api_key":"sk live do-not-leak"}')

    event = error_from_validation(excinfo.value)

    assert "do-not-leak" not in event.model_dump_json()


@pytest.mark.parametrize(
    ("line", "command"),
    [(EXTRA_FIELD_LINE, "list_playlists"), (UNKNOWN_COMMAND_LINE, None)],
    ids=["known-command", "unknown-command"],
)
def test_a_validation_error_names_the_command_only_when_the_line_designates_one(
    line: str, command: str | None
) -> None:
    """L'interface n'attribue une erreur a un ecran que si le sidecar l'a nommee. Regression :
    une commande connue refusee sur un champ n'etait nommee nulle part, aucun ecran n'affichait
    son erreur ; une ligne inconnue ne designe aucune commande du contrat.
    """
    with pytest.raises(ValidationError) as excinfo:
        parse_command(line)

    event = error_from_validation(excinfo.value)

    assert event.command == command


@pytest.mark.parametrize(
    ("payload", "domain", "wire_only"),
    [
        (ExtractionFinished, ExtractionResult, frozenset({"event", "report_path"})),
        (DuplicatePayload, DuplicateResolution, frozenset()),
        (DiscardedCandidatePayload, DiscardedCandidate, frozenset()),
        (FailurePayload, ExtractionFailure, frozenset()),
    ],
    ids=["extraction-finished", "duplicate", "discarded-candidate", "failure"],
)
def test_an_extraction_payload_carries_every_field_the_extraction_records(
    payload: type[BaseModel], domain: type[DataclassInstance], wire_only: frozenset[str]
) -> None:
    assert_same_fields(payload, domain, wire_only)
