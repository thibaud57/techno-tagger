"""`protocol.ts`, maintenu a la main, porte les memes champs, valeurs et codes que `protocol.py`."""

from enum import StrEnum
from typing import Final, TypeAliasType, get_args

import pytest
from error_codes import error_codes, error_param_keys
from protocol_mirror import (
    ts_discriminant_owners,
    ts_discriminants,
    ts_error_param_keys,
    ts_interfaces,
    ts_string_constants,
    ts_union_members,
    ts_unions,
)
from pydantic import BaseModel

from tagger import protocol
from tagger.__main__ import BusyPhase
from tagger.core.file_failures import FileFailureReason
from tagger.playlists import PlaylistFormat
from tagger.playlists.extraction import DuplicateCriterion, ExtractionMode
from tagger.protocol import (
    ArbitrationState,
    CandidatePayload,
    Command,
    DiscardedCandidatePayload,
    DuplicatePayload,
    Event,
    FailurePayload,
    InterruptedRunPayload,
    PastRunPayload,
    Phase,
    PlaylistEntry,
    RollbackFailurePayload,
    RollbackRun,
    RunPhase,
    TagsBeforePayload,
    TagValuePayload,
    ThresholdsPayload,
    TrackEntry,
    TrackLoaded,
    TrackNames,
    TrackScores,
    UnreadablePlanPayload,
)
from tagger.resolution.scraper_client import SearchSource, Source
from tagger.run.models import FailureReason, Resolution, TrackState
from tagger.tags.files import TagField, TagSystem

INTERPRETED_CONSTANTS: Final = frozenset(
    {"PHASE_BUSY", "API_KEY_MISSING", "ARBITRATION_NOT_PENDING"}
)

# Cles dont l'interface route un refus : `error-params.ts` doit toutes les lire.
ROUTING_PARAMS: Final = frozenset({"track_id", "run_id", "phase"})

UNIONS: Final = {"event": "SidecarEvent", "command": "SidecarCommand"}

PAYLOADS: Final[dict[type[BaseModel], str]] = {
    ThresholdsPayload: "ThresholdsPayload",
    PlaylistEntry: "PlaylistEntry",
    DiscardedCandidatePayload: "DiscardedCandidate",
    DuplicatePayload: "DuplicateResolution",
    FailurePayload: "ExtractionFailure",
    TagValuePayload: "TagValue",
    TagsBeforePayload: "TagsBefore",
    TrackEntry: "TrackEntry",
    TrackNames: "TrackNames",
    TrackScores: "TrackScores",
    CandidatePayload: "CandidatePayload",
    ArbitrationState: "ArbitrationState",
    RollbackRun: "RollbackRun",
    RollbackFailurePayload: "RollbackFailure",
    InterruptedRunPayload: "InterruptedRun",
    UnreadablePlanPayload: "UnreadablePlan",
    PastRunPayload: "PastRun",
    TrackLoaded: "TrackLoaded",
}


# `name_taken` est un motif du rollback seul : `TrackFailureReason` ne le porte pas cote TypeScript.
_RESOLUTION_REASONS: Final = frozenset(FailureReason) - {FailureReason.NAME_TAKEN}

ENUMS: Final[dict[str, frozenset[StrEnum]]] = {
    "TrackState": frozenset(TrackState),
    "TrackResolution": frozenset(Resolution),
    "ResolutionFailureReason": _RESOLUTION_REASONS,
    "FileFailureReason": frozenset(FileFailureReason),
    "TrackFailureReason": _RESOLUTION_REASONS | frozenset(FileFailureReason),
    "RollbackFailureReason": frozenset({FailureReason.NAME_TAKEN}) | frozenset(FileFailureReason),
    "TrackSource": frozenset(Source),
    "ArbitrationSource": frozenset(get_args(SearchSource.__value__)),
    "Phase": frozenset(Phase),
    "RunPhase": frozenset(RunPhase),
    "BusyPhase": frozenset(BusyPhase),
    "TagField": frozenset(TagField),
    "TagSystem": frozenset(TagSystem),
    "DuplicateCriterion": frozenset(DuplicateCriterion),
    "ExtractionMode": frozenset(ExtractionMode),
    "PlaylistFormat": frozenset(PlaylistFormat),
}


def _models() -> list[type[BaseModel]]:
    return [
        member
        for member in vars(protocol).values()
        if isinstance(member, type)
        and issubclass(member, BaseModel)
        and member.__module__ == protocol.__name__
    ]


def _by_discriminant(base: type[BaseModel], key: str) -> dict[str, type[BaseModel]]:
    """Modeles de `base` qui portent le `Literal` `key`, par la valeur de ce `Literal`."""
    return {
        _only_literal(model, key): model
        for model in _models()
        if issubclass(model, base) and key in model.model_fields
    }


def _only_literal(model: type[BaseModel], key: str) -> str:
    (value,) = get_args(model.model_fields[key].annotation)
    assert isinstance(value, str)

    return value


def _enums_in(annotation: object) -> frozenset[type[StrEnum]]:
    """Enums atteignables depuis une annotation : `Literal`, alias `type` ou generique."""
    if isinstance(annotation, TypeAliasType):
        return _enums_in(annotation.__value__)

    if isinstance(annotation, StrEnum):
        return frozenset({type(annotation)})

    if isinstance(annotation, type) and issubclass(annotation, StrEnum):
        return frozenset({annotation})

    return frozenset[type[StrEnum]]().union(*(_enums_in(arg) for arg in get_args(annotation)))


MESSAGES: Final = {
    "event": _by_discriminant(Event, "event"),
    "command": _by_discriminant(Command, "command"),
}
MESSAGE_CASES: Final = [(key, name) for key, models in MESSAGES.items() for name in models]


@pytest.mark.parametrize(
    ("key", "name"), MESSAGE_CASES, ids=[f"{key}-{name}" for key, name in MESSAGE_CASES]
)
def test_every_message_mirrors_its_fields(key: str, name: str) -> None:
    interface = ts_discriminants(key).get(name)
    assert interface is not None, f"{key} {name} has no TypeScript mirror"

    assert ts_interfaces()[interface] == frozenset(MESSAGES[key][name].model_fields)


@pytest.mark.parametrize("key", MESSAGES, ids=MESSAGES)
def test_no_discriminant_exists_on_the_interface_side_only(key: str) -> None:
    assert ts_discriminants(key).keys() == MESSAGES[key].keys()


@pytest.mark.parametrize("key", MESSAGES, ids=MESSAGES)
def test_no_discriminant_is_declared_by_two_interfaces(key: str) -> None:
    shared = {
        value: names for value, names in ts_discriminant_owners(key).items() if len(names) > 1
    }

    assert not shared


@pytest.mark.parametrize("key", UNIONS, ids=UNIONS)
def test_every_message_interface_is_a_member_of_its_union(key: str) -> None:
    carriers = {name for names in ts_discriminant_owners(key).values() for name in names}

    assert ts_union_members(UNIONS[key]) == carriers


@pytest.mark.parametrize("model", PAYLOADS, ids=[model.__name__ for model in PAYLOADS])
def test_every_payload_mirrors_its_fields(model: type[BaseModel]) -> None:
    assert ts_interfaces()[PAYLOADS[model]] == frozenset(model.model_fields)


def test_every_payload_model_has_a_mirror() -> None:
    nested = {
        model
        for model in _models()
        if not issubclass(model, Command)
        and model is not Event
        and "event" not in model.model_fields
    }

    assert nested == PAYLOADS.keys()


@pytest.mark.parametrize("union", ENUMS, ids=ENUMS)
def test_every_enum_mirrors_its_values(union: str) -> None:
    assert ts_unions()[union] == frozenset(member.value for member in ENUMS[union])


def test_every_enum_used_by_a_protocol_model_is_mirrored() -> None:
    fields = [field for model in _models() for field in model.model_fields.values()]
    used = frozenset[type[StrEnum]]().union(*(_enums_in(field.annotation) for field in fields))
    mirrored = frozenset(type(member) for members in ENUMS.values() for member in members)

    unmirrored = used - mirrored

    assert not unmirrored


def test_every_interpreted_error_constant_is_an_error_code_of_the_sidecar() -> None:
    constants = ts_string_constants()
    unknown = set(constants.values()) - error_codes()

    assert constants.keys() >= INTERPRETED_CONSTANTS
    assert not unknown


def test_the_interface_reads_every_param_it_routes_a_refusal_on() -> None:
    assert ts_error_param_keys() >= ROUTING_PARAMS


def test_every_error_param_the_interface_reads_is_one_the_sidecar_can_emit() -> None:
    unknown = ts_error_param_keys() - error_param_keys()

    assert not unknown
