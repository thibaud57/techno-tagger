"""Scenario de la demo enregistre sur le vrai sidecar : protocole, confidentialite, couverture."""

import getpass
import json
import re
import sys
from dataclasses import dataclass
from pathlib import PurePosixPath
from types import MappingProxyType
from typing import TYPE_CHECKING, Final, assert_never, get_args
from urllib.parse import urlparse

import pytest
from demo_catalogue import (
    COLD_MERIDIAN,
    GLASS_CORRIDOR,
    LOWLANDS,
    LOWLANDS_RECOVERY_URL,
    PLAYLIST_NAME,
    SUB_ROSA,
    TISHINA,
    TRACKS,
    ExtractionCase,
    TaggingCase,
    resolved_releases,
)
from demo_covers import cover_name, render_covers
from demo_recording import (
    DEMO_FOLDER,
    combinations,
    outcomes_of,
    record_scenario,
    write_demo_folder,
)
from demo_scenario import (
    DEMO_ROOT,
    KEY_FIELDS,
    PAST_RUN_AT,
    PAST_RUN_ID,
    VISITOR_RUN_AT,
    VISITOR_RUN_ID,
    DemoPaths,
    DemoRecordingError,
    JsonObject,
    Outcome,
    Phase,
    Scenario,
    StatefulReply,
    StatelessReply,
    command_key,
    outcomes_key,
)

import tagger
from tagger.protocol import Event, parse_command

if TYPE_CHECKING:
    from collections.abc import Iterable, Iterator, Mapping
    from pathlib import Path

    from pydantic import JsonValue

# Requetes recopiees plutot qu'importees de l'enregistreur : une requete qu'il oublierait
# manquerait au scenario sans que ces tests s'en apercoivent.
VISITOR_RUN: Final[JsonObject] = {"run_id": VISITOR_RUN_ID}
SETTINGS_QUERIES: Final[tuple[JsonObject, ...]] = (
    {"command": "list_runs"},
    {"command": "get_rollback_target"},
    {"command": "get_cache_size"},
)
PHASE_QUERIES: Final[tuple[JsonObject, ...]] = (
    *SETTINGS_QUERIES,
    {"command": "load_run", **VISITOR_RUN},
)
PHASES_AFTER_COMMIT: Final = (
    Phase.WRITE_FAILED,
    Phase.WRITTEN,
    Phase.ROLLED_BACK_AFTER_RETRY,
    Phase.ROLLED_BACK_WITHOUT_RETRY,
)
COPY: Final[JsonObject] = {
    "command": "extract_playlist",
    "mode": "copy",
    "playlist_name": PLAYLIST_NAME,
}
# Etat, resolution, source et motif du `track_resolved` de la phase reseau, par cas du catalogue.
RESOLVED_AS: Final[Mapping[TaggingCase, tuple[JsonValue, ...]]] = {
    TaggingCase.AUTO_BEATPORT: ("resolved", "auto", "beatport", None),
    TaggingCase.LOCKED_ON_WRITE: ("resolved", "auto", "beatport", None),
    TaggingCase.BANDCAMP_ONLY: ("resolved", "auto", "bandcamp", None),
    TaggingCase.NOT_FOUND: ("unresolved", "none", None, "no_result"),
}
# Source et nombre de candidats de l'`arbitration_required` de la phase reseau.
HELD_AS: Final[Mapping[TaggingCase, tuple[JsonValue, ...]]] = {
    TaggingCase.TWO_BEATPORT_MIXES: ("beatport", 2),
    TaggingCase.WRONG_BEATPORT: ("beatport", 1),
}

EMPTY_SCENARIO: Final = Scenario(
    schema_version=1,
    paths=DemoPaths(vlc_dump="a", library="b", destination="c"),
    key_fields=KEY_FIELDS,
    initial_outcomes={},
    lines=(),
    stateless=(),
    stateful=(),
)

type StateKey = tuple[str, Phase, tuple[tuple[str, Outcome], ...]]
# Issues posees, phase atteinte et lignes d'une reponse.
type ReplyContent = tuple[Mapping[str, Outcome], Phase | None, list[JsonObject]]


@dataclass(frozen=True, slots=True)
class Recorded:
    scenario: Scenario
    root: Path


@pytest.fixture(scope="module")
def recorded(tmp_path_factory: pytest.TempPathFactory) -> Recorded:
    """Un enregistrement pour tout le module : le scenario est gele, aucun test ne le modifie."""
    root = tmp_path_factory.mktemp("demo")
    return Recorded(scenario=record_scenario(root), root=root)


@pytest.fixture(scope="module")
def scenario_text(recorded: Recorded) -> str:
    return recorded.scenario.model_dump_json()


@pytest.fixture(scope="module")
def answered(recorded: Recorded) -> Mapping[StateKey, StatefulReply]:
    """Reponses avec etat par cle d'etat, gelees comme le scenario."""
    return MappingProxyType(
        {
            state_key(reply.command, reply.phase, reply.outcomes): reply
            for reply in recorded.scenario.stateful
        }
    )


def event_models() -> dict[str, type[Event]]:
    """Classe d'evenement par valeur de son champ `event`, tiree des sous-classes d'`Event`."""

    def descendants(model: type[Event]) -> Iterator[type[Event]]:
        for subclass in model.__subclasses__():
            yield subclass
            yield from descendants(subclass)

    return {
        name: model
        for model in descendants(Event)
        if "event" in model.model_fields
        for name in get_args(model.model_fields["event"].annotation)
    }


def walk(values: Iterable[JsonValue]) -> Iterator[JsonObject]:
    """Chaque objet JSON imbrique dans `values`, a toute profondeur."""
    for value in values:
        match value:
            case dict():
                yield value
                yield from walk(value.values())
            case list():
                yield from walk(value)
            case _:
                pass


def rows(value: JsonValue) -> list[JsonObject]:
    """Liste d'objets d'une ligne, avec le narrowing qu'exige mypy strict."""
    assert isinstance(value, list)
    return [row for row in value if isinstance(row, dict)]


def strings(value: JsonValue) -> set[str]:
    assert isinstance(value, list)
    return {str(item) for item in value}


def lines_of(scenario: Scenario, reply: StatelessReply | StatefulReply) -> list[JsonObject]:
    return [scenario.lines[index] for index in reply.lines]


def stateless(scenario: Scenario, command: JsonObject, call: int = 1) -> list[JsonObject]:
    """Lignes de la reponse sans etat de rang `call` a `command`."""
    key = command_key(command)
    return next(
        lines_of(scenario, reply)
        for reply in scenario.stateless
        if command_key(reply.command) == key and reply.call == call
    )


def first_stateful(scenario: Scenario, command: JsonObject) -> list[JsonObject]:
    """Lignes de la premiere reponse avec etat a `command`, quel que soit l'etat."""
    key = command_key(command)
    return next(
        lines_of(scenario, reply)
        for reply in scenario.stateful
        if command_key(reply.command) == key
    )


def state_key(command: JsonObject, phase: Phase, outcomes: Mapping[str, Outcome]) -> StateKey:
    return command_key(command), phase, outcomes_key(outcomes)


def event_of(lines: Iterable[JsonObject], event: str, **fields: JsonValue) -> JsonObject:
    return next(
        line
        for line in lines
        if line["event"] == event and all(line.get(key) == value for key, value in fields.items())
    )


def post_commit_keys(outcomes: Mapping[str, Outcome]) -> tuple[StateKey, ...]:
    """Ecriture, relance, restauration et requetes de phase attendues pour une combinaison."""
    return (
        state_key({"command": "commit_run", **VISITOR_RUN}, Phase.NOT_WRITTEN, outcomes),
        state_key({"command": "retry_write", **VISITOR_RUN}, Phase.WRITE_FAILED, outcomes),
        state_key({"command": "rollback", **VISITOR_RUN}, Phase.WRITE_FAILED, outcomes),
        state_key({"command": "rollback", **VISITOR_RUN}, Phase.WRITTEN, outcomes),
        *(
            state_key(query, phase, outcomes)
            for query in PHASE_QUERIES
            for phase in PHASES_AFTER_COMMIT
        ),
    )


def extracted_as(case: ExtractionCase) -> set[str]:
    return {track.file_name for track in TRACKS if track.extraction is case}


def tagged_as[V](cases: Mapping[TaggingCase, V]) -> dict[str, V]:
    """Ce que `cases` annonce pour chaque morceau du catalogue dont le cas y figure."""
    return {
        track.file_name: cases[track.release.tagging]
        for track in TRACKS
        if track.release is not None and track.release.tagging in cases
    }


def test_every_recorded_command_parses_and_every_line_validates(recorded: Recorded) -> None:
    models = event_models()
    commands = {
        json.dumps(reply.command, sort_keys=True)
        for reply in (*recorded.scenario.stateless, *recorded.scenario.stateful)
    }

    for command in commands:
        parse_command(command)
    for line in recorded.scenario.lines:
        models[str(line["event"])].model_validate(line)


def test_no_line_leaks_the_recording_root_or_the_os_user(
    recorded: Recorded, scenario_text: str
) -> None:
    windows_paths = re.findall(r"[A-Z]:\\\\[^\"]*", scenario_text)

    # Du JSON : les antislashs y sont doubles, la racine se compare sous cette forme.
    assert json.dumps(str(recorded.root))[1:-1] not in scenario_text
    assert f"Users\\\\{getpass.getuser()}" not in scenario_text
    assert windows_paths
    assert all(path.startswith(str(DEMO_ROOT).replace("\\", "\\\\")) for path in windows_paths)


def test_every_timestamp_and_run_id_is_one_of_the_frozen_values(
    recorded: Recorded, scenario_text: str
) -> None:
    instants = set(re.findall(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", scenario_text)) | set(
        re.findall(r"\d{8}T\d{6}", scenario_text)
    )
    run_ids = {str(line["run_id"]) for line in walk(recorded.scenario.lines) if "run_id" in line}

    assert instants <= {
        at.strftime(fmt)
        for at in (PAST_RUN_AT, VISITOR_RUN_AT)
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y%m%dT%H%M%S")
    }
    assert run_ids == {PAST_RUN_ID, VISITOR_RUN_ID}


def test_every_url_is_on_a_reserved_domain(scenario_text: str) -> None:
    hosts = {urlparse(url).hostname for url in re.findall(r"https?://[^\"\\\s]+", scenario_text)}

    assert hosts
    assert all(host is not None and host.endswith(".example") for host in hosts)


def test_starts_with_the_past_run_listed_and_nothing_to_restore(
    recorded: Recorded, answered: Mapping[StateKey, StatefulReply]
) -> None:
    scenario = recorded.scenario
    initial = {
        SUB_ROSA.file_name: Outcome.PENDING,
        TISHINA.file_name: Outcome.PENDING,
        LOWLANDS.file_name: Outcome.UNRESOLVED,
    }

    version = stateless(scenario, {"command": "get_version"})
    interrupted = stateless(scenario, {"command": "get_interrupted_run"})
    listed, target, size = (
        lines_of(scenario, answered[state_key(query, Phase.IDLE, initial)])
        for query in SETTINGS_QUERIES
    )

    assert scenario.initial_outcomes == initial
    assert [line["event"] for line in version] == ["version"]
    assert [(line["event"], line["run"]) for line in interrupted] == [("interrupted_run", None)]
    assert [run["run_id"] for run in rows(event_of(listed, "runs_listed")["runs"])] == [PAST_RUN_ID]
    assert event_of(target, "rollback_target")["run"] is None
    assert [line["event"] for line in size] == ["cache_size"]


def test_every_combination_has_its_post_commit_replies(
    answered: Mapping[StateKey, StatefulReply],
) -> None:
    recovery: JsonObject = {
        "command": "resolve_by_url",
        "track_id": LOWLANDS.file_name,
        "url": LOWLANDS_RECOVERY_URL,
    }

    after_commit = {
        key for combination in combinations() for key in post_commit_keys(outcomes_of(combination))
    }
    recovered = {
        state_key(recovery, Phase.NOT_WRITTEN, outcomes_of(combination))
        for combination in combinations()
        if combination.lowlands is Outcome.UNRESOLVED
    }

    assert len(recovered) == 16
    assert not (after_commit | recovered) - answered.keys()


def gesture_commands(track_id: str, outcome: Outcome) -> tuple[JsonObject, ...]:
    """Commandes de l'interface menant a `outcome` : un refus de Beatport repasse par le lien
    « Revenir a Beatport », puis refuse de nouveau."""

    def arbitrate(source: str, candidate: int | None) -> JsonObject:
        return {
            "command": "resolve_arbitration",
            "track_id": track_id,
            "source": source,
            "candidate": candidate,
        }

    switch: JsonObject = {
        "command": "switch_arbitration_source",
        "track_id": track_id,
        "source": "beatport",
    }
    via_bandcamp = (arbitrate("beatport", None), switch)
    return {
        Outcome.FIRST_BEATPORT: (arbitrate("beatport", 0),),
        Outcome.SECOND_BEATPORT: (arbitrate("beatport", 1),),
        Outcome.BANDCAMP: (*via_bandcamp, arbitrate("bandcamp", 0)),
        Outcome.REFUSED: (*via_bandcamp, arbitrate("bandcamp", None)),
    }[outcome]


def test_every_decision_gesture_has_its_reply_in_every_state_of_the_other_tracks(
    answered: Mapping[StateKey, StatefulReply],
) -> None:
    issues: dict[str, frozenset[Outcome]] = {
        SUB_ROSA.file_name: frozenset(c.sub_rosa for c in combinations()),
        TISHINA.file_name: frozenset(c.tishina for c in combinations()),
    }
    lowlands_issues = {c.lowlands for c in combinations()}

    expected = {
        state_key(
            command,
            Phase.NOT_WRITTEN,
            {track: Outcome.PENDING, other: other_outcome, LOWLANDS.file_name: lowlands},
        )
        for track, other in (
            (SUB_ROSA.file_name, TISHINA.file_name),
            (TISHINA.file_name, SUB_ROSA.file_name),
        )
        for outcome in issues[track] - {Outcome.PENDING}
        for command in gesture_commands(track, outcome)
        for other_outcome in issues[other]
        for lowlands in lowlands_issues
    }

    assert not expected - answered.keys()


def test_every_intermediate_arbitration_state_answers_the_settings_queries(
    answered: Mapping[StateKey, StatefulReply],
) -> None:
    expected = {
        state_key(query, Phase.NOT_WRITTEN, outcomes_of(combination))
        for combination in combinations()
        for query in SETTINGS_QUERIES
    }

    assert len(expected) == 32 * len(SETTINGS_QUERIES)
    assert not expected - answered.keys()


def test_every_catalogue_track_ends_as_its_case_announces(recorded: Recorded) -> None:
    scenario = recorded.scenario
    refusal: JsonObject = {
        "command": "resolve_arbitration",
        "track_id": TISHINA.file_name,
        "source": "beatport",
        "candidate": None,
    }
    glass_corridor: JsonObject = {"track_id": GLASS_CORRIDOR.file_name}

    first = event_of(stateless(scenario, COPY), "extraction_finished")
    second = event_of(stateless(scenario, COPY, call=2), "extraction_finished")
    tagging = stateless(
        scenario, {"command": "start_tagging", "folder": scenario.paths.destination}
    )
    resolved = {
        line["track_id"]: tuple(
            line.get(field) for field in ("state", "resolution", "source", "failure_reason")
        )
        for line in tagging
        if line["event"] == "track_resolved"
    }
    held = {
        line["track_id"]: (line["source"], len(rows(line["candidates"])))
        for line in tagging
        if line["event"] == "arbitration_required"
    }
    refused = event_of(first_stateful(scenario, refusal), "arbitration_updated")
    committed = event_of(
        first_stateful(scenario, {"command": "commit_run", **VISITOR_RUN}),
        "track_resolved",
        **glass_corridor,
    )
    retried = event_of(
        first_stateful(scenario, {"command": "retry_write", **VISITOR_RUN}),
        "track_resolved",
        **glass_corridor,
    )

    assert extracted_as(ExtractionCase.EXTRACTED) <= strings(first["extracted"])
    assert extracted_as(ExtractionCase.ALREADY_PRESENT) <= strings(second["already_present"])
    assert extracted_as(ExtractionCase.DUPLICATE) <= {
        str(row["file_name"]) for row in rows(first["duplicates"])
    }
    assert extracted_as(ExtractionCase.MISSING) <= strings(first["missing"])
    assert [(row["file_name"], row["reason"]) for row in rows(first["failures"])] == [
        (COLD_MERIDIAN.file_name, "file_locked")
    ]
    assert {track_id: resolved[track_id] for track_id in tagged_as(RESOLVED_AS)} == tagged_as(
        RESOLVED_AS
    )
    assert {track_id: held[track_id] for track_id in tagged_as(HELD_AS)} == tagged_as(HELD_AS)
    assert (refused["source"], bool(refused["candidates"])) == ("bandcamp", True)
    assert (committed["state"], committed["failure_reason"]) == ("write_error", "file_locked")
    assert retried["state"] == "written"


def files_under(folder: Path) -> dict[str, Path]:
    """Fichiers de `folder` par chemin relatif, en `/` quel que soit l'OS."""
    return {
        path.relative_to(folder).as_posix(): path for path in folder.rglob("*") if path.is_file()
    }


def replies_by_key(scenario: Scenario) -> dict[str, ReplyContent]:
    """Contenu de chaque reponse par cle lisible : rang d'appel sans etat, phase et issues avec.

    Les lignes y figurent par leur contenu : un index decale ne nomme aucune commande.
    """
    replies: tuple[StatelessReply | StatefulReply, ...] = (
        *scenario.stateless,
        *scenario.stateful,
    )
    return {
        reply_key(reply): (reply.sets, reply.enters, lines_of(scenario, reply)) for reply in replies
    }


def reply_key(reply: StatelessReply | StatefulReply) -> str:
    match reply:
        case StatelessReply():
            return f"{command_key(reply.command)} call {reply.call}"
        case StatefulReply():
            return (
                f"{command_key(reply.command)} {reply.phase} {dict(outcomes_key(reply.outcomes))}"
            )
        case _:
            assert_never(reply)


def scenario_differences(written: Path, committed: Path) -> list[str]:
    """Champs d'en-tete et cles des reponses qui different entre deux `scenario.json`."""
    ours, theirs = (
        Scenario.model_validate_json(path.read_text(encoding="utf-8"))
        for path in (written, committed)
    )
    replies = {"lines", "stateless", "stateful"}
    head, committed_head = ours.model_dump(exclude=replies), theirs.model_dump(exclude=replies)
    ours_replies, theirs_replies = replies_by_key(ours), replies_by_key(theirs)
    differing = [
        *(field for field in sorted(head) if head[field] != committed_head[field]),
        *(
            key
            for key in sorted(ours_replies.keys() | theirs_replies.keys())
            if ours_replies.get(key) != theirs_replies.get(key)
        ),
    ]
    # Meme contenu, autre texte : ordre des lignes ou mise en forme.
    return [f"scenario.json: {item}" for item in differing] or ["scenario.json"]


def folder_differences(written: Path, committed: Path) -> list[str]:
    """Chemins absents du dossier versionne, en trop ou differents ; pour `scenario.json`, la
    reponse en cause, que le message d'echec nomme."""
    ours, theirs = files_under(written), files_under(committed)
    return [
        *(f"absent: {name}" for name in sorted(ours.keys() - theirs.keys())),
        *(f"en trop: {name}" for name in sorted(theirs.keys() - ours.keys())),
        *(
            difference
            for name in sorted(ours.keys() & theirs.keys())
            if ours[name].read_text(encoding="utf-8") != theirs[name].read_text(encoding="utf-8")
            for difference in (
                scenario_differences(ours[name], theirs[name])
                if name == "scenario.json"
                else [f"different: {name}"]
            )
        ),
    ]


def test_re_recording_yields_the_committed_demo_folder(recorded: Recorded, tmp_path: Path) -> None:
    write_demo_folder(tmp_path, recorded.scenario, render_covers(TRACKS))

    differences = folder_differences(tmp_path, DEMO_FOLDER)

    message = (
        f"scenario de demo perime, lance `just record-demo` puis commite : "
        f"{len(differences)} differences, les 10 premieres : {differences[:10]}"
    )
    assert not differences, message


def test_rewrites_the_demo_folder_entirely(tmp_path: Path) -> None:
    (tmp_path / "artworks").mkdir()
    (tmp_path / "artworks" / "ZZ999.svg").write_text("<svg/>", encoding="utf-8")

    write_demo_folder(tmp_path, EMPTY_SCENARIO, {})

    assert not (tmp_path / "artworks" / "ZZ999.svg").exists()


def test_every_resolved_release_has_a_cover_and_every_cover_belongs_to_a_release(
    recorded: Recorded,
) -> None:
    names = {path.name for path in (DEMO_FOLDER / "artworks").iterdir()}
    referenced = {
        PurePosixPath(str(line["artwork_path"])).name
        for line in walk(recorded.scenario.lines)
        if line.get("artwork_path")
    }

    assert names == {cover_name(release) for _, release in resolved_releases()}
    assert referenced <= names


def test_the_scenario_never_carries_the_sidecar_version() -> None:
    text = (DEMO_FOLDER / "scenario.json").read_text(encoding="utf-8")

    assert f'"{tagger.__version__}"' not in text


def test_refuses_to_record_outside_windows(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(sys, "platform", "linux")

    with pytest.raises(DemoRecordingError, match="Windows"):
        record_scenario(tmp_path)
