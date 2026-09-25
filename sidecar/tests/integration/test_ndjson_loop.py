"""Protocole NDJSON de bout en bout, par injection de commandes sur `stdin`.

Aucune interface n'est lancee : le contrat se teste en ligne de commande, ce qui
est sa raison d'etre (ADR-005).
"""

import asyncio
import json
import logging
import threading
from pathlib import Path
from typing import TYPE_CHECKING, NoReturn

import keyring
import pytest
from memory_keyring import MemoryKeyring, RefusingKeyring
from ndjson_loop import drive, drive_raw

from tagger import __main__ as main
from tagger import handlers
from tagger.reports import ReportWriteError

if TYPE_CHECKING:
    from collections.abc import Callable

    from tagger.protocol import Event, ExtractPlaylist, StartTagging

# Large : il borne un deadlock, il ne cadence rien.
WAIT_TIMEOUT = 10
# Assez long pour que la boucle lise la commande suivante pendant que le run meurt.
STOP_DELAY = 0.2


def extract_command(
    library: Path, dump: Path, destination: Path, playlist_name: str = "test playlist"
) -> str:
    """Ligne `extract_playlist` prete a injecter."""
    payload = {
        "command": "extract_playlist",
        "source_folder": str(library),
        "destination_folder": str(destination),
        "playlist_path": str(dump),
        "playlist_name": playlist_name,
    }
    return json.dumps(payload) + "\n"


def test_answers_a_version_request() -> None:
    events = drive('{"command":"get_version"}\n')

    assert events[0]["event"] == "version"
    assert "api_key_configured" in events[0]


def test_lists_the_playlists_of_a_dump(vlc_dump: Path) -> None:
    events = drive(json.dumps({"command": "list_playlists", "playlist_path": str(vlc_dump)}) + "\n")

    assert events[0]["event"] == "playlists_listed"
    assert events[0]["playlists"]


def test_a_listed_dump_carries_its_format_and_its_identifiers(vlc_dump: Path) -> None:
    events = drive(json.dumps({"command": "list_playlists", "playlist_path": str(vlc_dump)}) + "\n")

    playlists = events[0]["playlists"]
    assert events[0]["playlist_format"] == "vlc_dump"
    assert isinstance(playlists, list)
    assert {entry["playlist_id"] for entry in playlists} == {1, 2}


def test_runs_a_full_extraction(vlc_dump: Path, music_library: Path, tmp_path: Path) -> None:
    events = drive(extract_command(music_library, vlc_dump, tmp_path / "work"))

    assert [event["event"] for event in events][-1] == "extraction_finished"
    assert any(event["event"] == "progress" for event in events)


def test_the_announced_report_exists(vlc_dump: Path, music_library: Path, tmp_path: Path) -> None:
    events = drive(extract_command(music_library, vlc_dump, tmp_path / "work"))

    finished = events[-1]
    assert Path(str(finished["report_path"])).is_file()


@pytest.mark.parametrize(
    "rejected",
    [
        '{"command":"list_playlists","playlist_path":"C:/x","extra":1}',
        "pas du json",
        '{"command":"unheard_of"}',
    ],
    ids=["undeclared_field", "not_json", "unknown_command"],
)
def test_a_rejected_line_does_not_stop_the_loop(rejected: str) -> None:
    events = drive(rejected + '\n{"command":"get_version"}\n')

    assert events[0]["event"] == "error"
    assert events[0]["code"] == "malformed_command"
    assert events[1]["event"] == "version"


def test_a_malformed_extraction_touches_no_file(
    vlc_dump: Path, music_library: Path, tmp_path: Path
) -> None:
    """La validation precede l'execution : le handler n'est jamais atteint, donc meme
    le dossier destination reste a creer.
    """
    destination = tmp_path / "work"
    command = json.loads(extract_command(music_library, vlc_dump, destination))

    events = drive(json.dumps({**command, "extra": 1}) + "\n")

    assert events[0]["code"] == "malformed_command"
    assert not destination.exists()


def test_an_unknown_command_is_named_in_its_error() -> None:
    events = drive('{"command":"unheard_of"}\n')

    params = events[0]["params"]
    assert isinstance(params, dict)
    assert params["command"] == "unheard_of"


def test_an_empty_line_produces_nothing() -> None:
    events = drive('\n{"command":"get_version"}\n')

    assert len(events) == 1


def test_a_business_error_becomes_an_error_event(
    vlc_dump: Path, music_library: Path, tmp_path: Path
) -> None:
    unknown_playlist = extract_command(
        music_library, vlc_dump, tmp_path / "work", "aucune playlist de ce nom"
    )

    events = drive(unknown_playlist)

    assert [(event["code"], event["command"]) for event in events] == [
        ("playlist_not_found", "extract_playlist")
    ]


@pytest.fixture
def extraction_waits_for_version(monkeypatch: pytest.MonkeyPatch) -> None:
    """L'extraction ne part qu'une fois `get_version` repondu : l'ordre est impose, pas
    espere. Si la boucle restait bloquee par la copie, la reponse ne viendrait jamais et
    l'attente expirerait.
    """
    answered = threading.Event()
    real_extract = handlers.handle_extract_playlist
    real_version = handlers.handle_get_version

    def blocked_extract(command: ExtractPlaylist, emit: Callable[[Event], None]) -> Event:
        assert answered.wait(timeout=WAIT_TIMEOUT), "la boucle est restee bloquee par la copie"
        return real_extract(command, emit)

    def answering_version() -> Event:
        version = real_version()
        answered.set()
        return version

    monkeypatch.setattr(main, "handle_extract_playlist", blocked_extract)
    monkeypatch.setattr(main, "handle_get_version", answering_version)


@pytest.mark.usefixtures("extraction_waits_for_version")
def test_answers_a_version_request_while_an_extraction_is_in_progress(
    vlc_dump: Path, music_library: Path, tmp_path: Path
) -> None:
    """La copie ne gele plus la lecture de stdin : une commande courte passe devant.

    Sans cela, fermer la fenetre pendant l'extraction d'une grosse bibliotheque
    laissait le `shutdown` dans le pipe jusqu'a la fin des transferts.
    """
    extraction = extract_command(music_library, vlc_dump, tmp_path / "work")

    events = drive(extraction + '{"command":"get_version"}\n')

    names = [event["event"] for event in events]
    assert names.index("version") < names.index("extraction_finished")


@pytest.mark.usefixtures("extraction_waits_for_version")
def test_refuses_a_second_extraction_while_one_is_in_progress(
    vlc_dump: Path, music_library: Path, tmp_path: Path
) -> None:
    """Regression : sans extraction retenue, la premiere finissait parfois avant la
    lecture de la seconde, et rien n'etait refuse.
    """
    extraction = extract_command(music_library, vlc_dump, tmp_path / "work")

    events = drive(extraction * 2 + '{"command":"get_version"}\n')

    refusals = [event for event in events if event["event"] == "error"]
    assert [event["code"] for event in refusals] == ["extraction_in_progress"]
    assert [event["event"] for event in events].count("extraction_finished") == 1


@pytest.fixture
def tagging_slow_to_stop(monkeypatch: pytest.MonkeyPatch) -> None:
    """Un run sans fin qui met du temps a mourir, comme le vrai dont la sortie du cache
    attend les telechargements en vol. Borne : une annulation perdue echoue, sans geler.
    """

    async def endless(command: StartTagging, emit: Callable[[Event], None]) -> Event:
        try:
            await asyncio.wait_for(asyncio.Event().wait(), timeout=WAIT_TIMEOUT)
        finally:
            await asyncio.sleep(STOP_DELAY)
        raise AssertionError("un run annule ne rend jamais son evenement de fin")

    monkeypatch.setattr(main, "handle_start_tagging", endless)


def _start(folder: Path) -> str:
    return json.dumps({"command": "start_tagging", "folder": str(folder)}) + "\n"


@pytest.mark.usefixtures("tagging_slow_to_stop")
def test_a_cancelled_run_leaves_the_loop_alive(tmp_path: Path) -> None:
    """`CancelledError` termine la tache sans remonter au TaskGroup, qui l'ignore."""
    events = drive(_start(tmp_path) + '{"command":"cancel_run"}\n{"command":"get_version"}\n')

    assert [event["event"] for event in events] == ["version"]


@pytest.mark.usefixtures("tagging_slow_to_stop")
def test_a_run_started_right_after_a_cancellation_is_not_refused(tmp_path: Path) -> None:
    """Regression : le run annule mourait encore quand la relance arrivait, qui repartait
    en `tagging_in_progress`, code que l'interface lit comme un run qui continue.
    """
    commands = _start(tmp_path) + '{"command":"cancel_run"}\n' + _start(tmp_path)

    events = drive(commands + '{"command":"shutdown"}\n')

    assert [event for event in events if event["event"] == "error"] == []


def test_waits_for_an_extraction_before_leaving_on_shutdown(
    vlc_dump: Path, music_library: Path, tmp_path: Path
) -> None:
    """`shutdown` annule un run de re-tagging mais attend une extraction.

    Le run ne tient que du reseau et de la memoire ; une copie coupee en vol
    laisserait un fichier a moitie ecrit dans la destination de l'utilisateur.
    """
    extraction = extract_command(music_library, vlc_dump, tmp_path / "work")

    events = drive(extraction + '{"command":"shutdown"}\n')

    assert [event["event"] for event in events].count("extraction_finished") == 1


def test_a_failed_report_write_becomes_an_error_event_without_extraction_finished(
    vlc_dump: Path, music_library: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def refuse(*_args: object, **_kwargs: object) -> NoReturn:
        raise ReportWriteError(tmp_path / "work" / "extraction-report.json")

    monkeypatch.setattr(handlers, "write_extraction_report", refuse)

    events = drive(extract_command(music_library, vlc_dump, tmp_path / "work"))

    assert any(event["event"] == "progress" for event in events)
    assert events[-1]["event"] == "error"
    assert events[-1]["code"] == "report_write_failed"
    assert not any(event["event"] == "extraction_finished" for event in events)


def test_an_unreadable_file_becomes_an_error_event(unreadable_binary_file: Path) -> None:
    events = drive(
        json.dumps({"command": "list_playlists", "playlist_path": str(unreadable_binary_file)})
        + "\n"
    )

    assert events[0]["event"] == "error"
    assert events[0]["code"] == "unsupported_playlist_format"


def test_lists_an_m3u8_as_empty_but_announces_its_format(m3u8_playlist: Path) -> None:
    events = drive(
        json.dumps({"command": "list_playlists", "playlist_path": str(m3u8_playlist)}) + "\n"
    )

    assert events[0]["event"] == "playlists_listed"
    assert events[0]["playlist_format"] == "m3u8"
    assert events[0]["playlists"] == []


@pytest.mark.parametrize(
    "stdin",
    ['{"command":"shutdown"}\n{"command":"get_version"}\n', ""],
    ids=["shutdown", "end_of_stream"],
)
def test_the_loop_ends_without_answering_anything_further(stdin: str) -> None:
    events = drive(stdin)

    assert events == []


def test_every_line_parses_on_its_own(vlc_dump: Path) -> None:
    command = json.dumps({"command": "list_playlists", "playlist_path": str(vlc_dump)})

    output = drive_raw(command + "\n")

    for line in output.splitlines():
        assert json.loads(line)


SECRET = "sk-live-9f8e7d6c5b4a"


def _set_api_key(api_key: str) -> str:
    return json.dumps({"command": "set_api_key", "api_key": api_key}) + "\n"


def test_never_echoes_the_api_key_on_stdout_nor_in_the_logs(
    memory_keyring: MemoryKeyring, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    commands = _set_api_key(SECRET) + _set_api_key(f"{SECRET} with-space")

    output = drive_raw(commands)

    assert SECRET not in output
    assert SECRET not in caplog.text
    assert [json.loads(line)["event"] for line in output.splitlines()] == ["version", "error"]


def test_never_echoes_the_api_key_when_the_keyring_refuses_it(
    caplog: pytest.LogCaptureFixture,
) -> None:
    keyring.set_keyring(RefusingKeyring())
    caplog.set_level(logging.DEBUG)

    output = drive_raw(_set_api_key(SECRET))

    assert SECRET not in output
    assert SECRET not in caplog.text
    assert json.loads(output)["code"] == "api_key_not_stored"
