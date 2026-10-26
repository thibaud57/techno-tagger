"""Scenario de la demo web : modele, normalisation, assemblage et valeurs figees.

Le protocole n'a pas d'id de requete : le scenario associe chaque commande a ses lignes
de reponse. Une reponse est sans etat (cle de commande et rang d'appel de la session) ou
avec etat (cle de commande, issues des morceaux a decision et phase du run).
"""

import json
from collections import Counter
from collections.abc import Hashable, Iterable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, tzinfo
from enum import UNIQUE, StrEnum, auto, verify
from pathlib import Path, PureWindowsPath
from types import MappingProxyType
from typing import Final, Literal, Self, assert_never, override
from unittest.mock import patch

from pydantic import BaseModel, ConfigDict, Field, JsonValue

from tagger import handlers
from tagger.run import tagging, writing

type JsonObject = dict[str, JsonValue]

DEMO_VERSION: Final = "demo"
DEMO_ROOT: Final = PureWindowsPath(r"C:\Users\Demo")
PAST_RUN_ID: Final = "de0001"
PAST_RUN_AT: Final = datetime(2026, 8, 24, 20, 0, tzinfo=UTC)
VISITOR_RUN_ID: Final = "de0002"
VISITOR_RUN_AT: Final = datetime(2026, 10, 24, 20, 0, tzinfo=UTC)

# Prefixe que le sidecar pose sur un chemin long (`extended_path`).
_EXTENDED_PREFIX: Final = "\\\\?\\"

# Champs identifiants par commande, noms releves dans `protocol.ts` : une garde ferme la
# table sur les commandes du protocole. `start_tagging` se reconnait a son dossier, pas
# a ses seuils.
KEY_FIELDS: Final[Mapping[str, tuple[str, ...]]] = MappingProxyType(
    {
        "get_version": (),
        "shutdown": (),
        "cancel_run": (),
        "list_playlists": ("playlist_path",),
        "extract_playlist": ("mode", "playlist_name"),
        "set_api_key": (),
        "start_tagging": ("folder",),
        "resolve_arbitration": ("track_id", "source", "candidate"),
        "switch_arbitration_source": ("track_id", "source"),
        "resolve_by_url": ("track_id", "url"),
        "commit_run": ("run_id",),
        "retry_write": ("run_id",),
        "get_rollback_target": (),
        "get_cache_size": (),
        "clear_cache": (),
        "rollback": ("run_id", "track_id"),
        "get_interrupted_run": (),
        "discard_run": (),
        "resume_run": (),
        "list_runs": (),
        "load_run": ("run_id",),
        "prepare_feedback": (),
    }
)


@verify(UNIQUE)
class Outcome(StrEnum):
    PENDING = auto()
    FIRST_BEATPORT = auto()
    SECOND_BEATPORT = auto()
    BANDCAMP = auto()
    REFUSED = auto()
    RECOVERED_BY_URL = auto()
    UNRESOLVED = auto()


@verify(UNIQUE)
class Phase(StrEnum):
    IDLE = auto()
    NOT_WRITTEN = auto()
    WRITE_FAILED = auto()
    WRITTEN = auto()
    ROLLED_BACK_AFTER_RETRY = auto()
    ROLLED_BACK_WITHOUT_RETRY = auto()


class DemoRecordingError(Exception):
    """Deux enregistrements de la meme cle ont donne des reponses differentes."""


class _ScenarioModel(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class DemoPaths(_ScenarioModel):
    """Chemins de demo que renvoient les selecteurs de fichiers."""

    vlc_dump: str
    library: str
    destination: str


class _Reply(_ScenarioModel):
    """`sets` : issues que la reponse pose ; `enters` : phase qu'elle fait atteindre."""

    command: JsonObject
    sets: Mapping[str, Outcome] = Field(default_factory=dict)
    enters: Phase | None = None
    lines: tuple[int, ...]


class StatelessReply(_Reply):
    call: int = 1


class StatefulReply(_Reply):
    outcomes: Mapping[str, Outcome]
    phase: Phase


class Scenario(_ScenarioModel):
    schema_version: Literal[1]
    paths: DemoPaths
    key_fields: Mapping[str, tuple[str, ...]]
    initial_outcomes: Mapping[str, Outcome]
    lines: tuple[JsonObject, ...]
    stateless: tuple[StatelessReply, ...]
    stateful: tuple[StatefulReply, ...]


@dataclass(frozen=True, slots=True)
class ReplyState:
    outcomes: Mapping[str, Outcome]
    phase: Phase


@dataclass(frozen=True, slots=True)
class Exchange:
    """Une commande et les lignes emises en reponse, `state` nul pour une reponse sans etat."""

    command: JsonObject
    lines: tuple[JsonObject, ...]
    state: ReplyState | None
    sets: Mapping[str, Outcome] = MappingProxyType({})
    enters: Phase | None = None


def command_key(command: JsonObject) -> str:
    """Nom de la commande et ses champs identifiants, un champ absent valant `null`."""
    name = command["command"]
    identifying = {field: command.get(field) for field in KEY_FIELDS[str(name)]}

    return json.dumps({"command": name, **identifying}, sort_keys=True, ensure_ascii=False)


def outcomes_key(outcomes: Mapping[str, Outcome]) -> tuple[tuple[str, Outcome], ...]:
    """Forme hachable d'un etat des morceaux a decision, quel que soit l'ordre des cles."""
    return tuple(sorted(outcomes.items()))


def _rebase(text: str, recording_root: PureWindowsPath) -> str:
    """Un chemin sous la racine d'enregistrement passe sous `DEMO_ROOT`, le reste est intact."""
    try:
        relative = PureWindowsPath(text.removeprefix(_EXTENDED_PREFIX)).relative_to(recording_root)
    except ValueError:
        return text

    return str(DEMO_ROOT / relative)


def _overrides(node: JsonObject, covers_by_track: Mapping[str, str]) -> JsonObject:
    match node:
        case {"event": "version"}:
            return {"version": DEMO_VERSION}
        case {"track_id": str() as track_id, "artwork_path": str()} if track_id in covers_by_track:
            return {"artwork_path": covers_by_track[track_id]}
        case _:
            return {}


def _walk(
    value: JsonValue, recording_root: PureWindowsPath, covers_by_track: Mapping[str, str]
) -> JsonValue:
    match value:
        case dict():
            rewritten = {
                key: _walk(item, recording_root, covers_by_track) for key, item in value.items()
            }
            return rewritten | _overrides(value, covers_by_track)
        case list():
            return [_walk(item, recording_root, covers_by_track) for item in value]
        case str():
            return _rebase(value, recording_root)
        case _:
            return value


def normalize(
    message: JsonObject, *, recording_root: Path, covers_by_track: Mapping[str, str]
) -> JsonObject:
    """Retire d'une commande ou d'un evenement ce qui varie d'un enregistrement a l'autre.

    La version du sidecar change a chaque release, la racine temporaire et le chemin de
    cache d'une pochette dependent de la machine qui enregistre.
    """
    rewritten = _walk(message, PureWindowsPath(recording_root), covers_by_track)
    assert isinstance(rewritten, dict)

    return rewritten


def _merge[Ident: Hashable, Reply: BaseModel](
    table: dict[Ident, Reply], ident: Ident, reply: Reply
) -> None:
    # La commande entiere n'entre pas dans la comparaison : seuls ses champs cles identifient.
    known = table.setdefault(ident, reply)
    if known is not reply and known.model_dump(exclude={"command"}) != reply.model_dump(
        exclude={"command"}
    ):
        message = f"two different replies for {ident}"
        raise DemoRecordingError(message)


def _initial_outcomes(replies: Sequence[StatefulReply]) -> Mapping[str, Outcome]:
    """Avant le tagging, les issues courantes sont les issues de depart : il en faut une seule."""
    idle = {outcomes_key(r.outcomes): r.outcomes for r in replies if r.phase is Phase.IDLE}
    if len(idle) != 1:
        message = (
            "no reply in phase idle, the starting outcomes are unknown"
            if not idle
            else f"{len(idle)} different starting outcomes in phase idle: {sorted(idle)}"
        )
        raise DemoRecordingError(message)

    return next(iter(idle.values()))


def assemble(sessions: Iterable[Sequence[Exchange]], paths: DemoPaths) -> Scenario:
    """Fusionne les sessions en un scenario : rangs d'appel, lignes et reponses dedupliquees."""
    line_table: dict[str, tuple[int, JsonObject]] = {}
    stateless: dict[tuple[str, int], StatelessReply] = {}
    stateful: dict[tuple[str, Phase, tuple[tuple[str, Outcome], ...]], StatefulReply] = {}

    for session in sessions:
        ranks = Counter[str]()
        for exchange in session:
            key = command_key(exchange.command)
            indexes = tuple(
                line_table.setdefault(
                    json.dumps(line, sort_keys=True, ensure_ascii=False), (len(line_table), line)
                )[0]
                for line in exchange.lines
            )
            match exchange.state:
                case None:
                    ranks[key] += 1
                    _merge(
                        stateless,
                        (key, ranks[key]),
                        StatelessReply(
                            command=exchange.command,
                            call=ranks[key],
                            sets=exchange.sets,
                            enters=exchange.enters,
                            lines=indexes,
                        ),
                    )
                case ReplyState(outcomes=outcomes, phase=phase):
                    _merge(
                        stateful,
                        (key, phase, outcomes_key(outcomes)),
                        StatefulReply(
                            command=exchange.command,
                            outcomes=outcomes,
                            phase=phase,
                            sets=exchange.sets,
                            enters=exchange.enters,
                            lines=indexes,
                        ),
                    )
                case _:
                    assert_never(exchange.state)

    return Scenario(
        schema_version=1,
        paths=paths,
        key_fields=KEY_FIELDS,
        initial_outcomes=_initial_outcomes(tuple(stateful.values())),
        lines=tuple(line for _, line in line_table.values()),
        stateless=tuple(stateless.values()),
        stateful=tuple(stateful.values()),
    )


@dataclass(frozen=True, slots=True)
class _FrozenSecrets:
    run_id: str

    def token_hex(self, nbytes: int | None = None) -> str:
        return self.run_id


def _frozen_datetime(at: datetime) -> type[datetime]:
    class FrozenDatetime(datetime):
        @classmethod
        @override
        def now(cls, tz: tzinfo | None = None) -> Self:
            # Sans `tz`, `datetime.now()` rend un instant naif : la copie figee aussi.
            moment = at.replace(tzinfo=None) if tz is None else at.astimezone(tz)

            return cls.combine(moment.date(), moment.timetz())

    return FrozenDatetime


@contextmanager
def frozen_sources(*, at: datetime, run_id: str) -> Iterator[None]:
    """Fige le `run_id` et l'horloge du sidecar le temps d'une session, sans reecrire son code."""
    with (
        patch.object(tagging, "secrets", _FrozenSecrets(run_id)),
        patch.object(handlers, "datetime", _frozen_datetime(at)),
        patch.object(writing, "datetime", _frozen_datetime(at)),
    ):
        yield
