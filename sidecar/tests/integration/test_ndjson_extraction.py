from pathlib import Path
from typing import TYPE_CHECKING

from ndjson_loop import drive, line, line_of, rows
from stubs import raising

from tagger import handlers
from tagger.reports.common import ReportWriteError

if TYPE_CHECKING:
    import pytest


def test_lists_the_playlists_of_a_dump(vlc_dump: Path) -> None:
    events = drive(line("list_playlists", playlist_path=str(vlc_dump)))

    assert events[0]["event"] == "playlists_listed"
    assert events[0]["playlist_format"] == "vlc_dump"
    assert {entry["playlist_id"] for entry in rows(events[0], "playlists")} == {1, 2}


def test_runs_a_full_extraction(extraction: dict[str, object]) -> None:
    events = drive(line_of(extraction))

    finished = events[-1]
    assert finished["event"] == "extraction_finished"
    assert any(event["event"] == "progress" for event in events)
    assert Path(str(finished["report_path"])).is_file()


def test_a_business_error_becomes_an_error_event(extraction: dict[str, object]) -> None:
    unknown_playlist = {**extraction, "playlist_name": "aucune playlist de ce nom"}

    events = drive(line_of(unknown_playlist))

    assert [(event["code"], event["command"]) for event in events] == [
        ("playlist_not_found", "extract_playlist")
    ]


def test_a_failed_report_write_becomes_an_error_event_without_extraction_finished(
    extraction: dict[str, object], monkeypatch: pytest.MonkeyPatch
) -> None:
    report = Path(str(extraction["destination_folder"])) / "extraction-report.json"
    monkeypatch.setattr(handlers, "write_extraction_report", raising(ReportWriteError(report)))

    events = drive(line_of(extraction))

    assert any(event["event"] == "progress" for event in events)
    assert events[-1]["event"] == "error"
    assert events[-1]["code"] == "report_write_failed"
    assert not any(event["event"] == "extraction_finished" for event in events)


def test_an_unreadable_file_becomes_an_error_event(unreadable_binary_file: Path) -> None:
    events = drive(line("list_playlists", playlist_path=str(unreadable_binary_file)))

    assert events[0]["event"] == "error"
    assert events[0]["code"] == "unsupported_playlist_format"


def test_lists_an_m3u8_as_empty_but_announces_its_format(m3u8_playlist: Path) -> None:
    events = drive(line("list_playlists", playlist_path=str(m3u8_playlist)))

    assert events[0]["event"] == "playlists_listed"
    assert events[0]["playlist_format"] == "m3u8"
    assert events[0]["playlists"] == []
