"""Protocole NDJSON de bout en bout, par injection de commandes sur `stdin`.

Aucune interface n'est lancee : le contrat se teste en ligne de commande, ce qui
est sa raison d'etre (ADR-005).
"""

import asyncio
import io
import json
import logging
from pathlib import Path
from typing import NoReturn

import keyring
import pytest
from memory_keyring import MemoryKeyring, RefusingKeyring

from tagger import handlers
from tagger.__main__ import run_loop
from tagger.reports import ReportWriteError


def drive_raw(commands: str) -> str:
    """Injecte des commandes et rend la sortie brute, pour y chercher une fuite."""
    stdout = io.StringIO()
    asyncio.run(run_loop(io.StringIO(commands), stdout))

    return stdout.getvalue()


def drive(commands: str) -> list[dict[str, object]]:
    """Injecte des commandes et rend les evenements emis, un par ligne."""
    return [json.loads(line) for line in drive_raw(commands).splitlines() if line]


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

    events = drive(unknown_playlist + '{"command":"get_version"}\n')

    assert events[0]["event"] == "error"
    assert events[0]["code"] == "playlist_not_found"
    assert events[1]["event"] == "version"


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
    stdout = io.StringIO()
    command = json.dumps({"command": "list_playlists", "playlist_path": str(vlc_dump)})

    asyncio.run(run_loop(io.StringIO(command + "\n"), stdout))

    for line in stdout.getvalue().splitlines():
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
