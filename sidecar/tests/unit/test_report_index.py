"""Tests du registre des rapports de re-tagging."""

import json
from datetime import timedelta
from typing import TYPE_CHECKING

import pytest
from stubs import raising
from tagging_api import CREATED

from tagger import report_index
from tagger.report_index import IndexEntry, list_reports, record_report

if TYPE_CHECKING:
    from pathlib import Path


def _entry(tmp_path: Path, run_id: str, *, days_ago: int = 0) -> IndexEntry:
    report = tmp_path / "music" / f"tagging-report-{run_id}.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text("{}", encoding="utf-8")
    return IndexEntry(
        run_id=run_id,
        written_at=CREATED - timedelta(days=days_ago),
        folder=report.parent,
        report_path=report,
    )


def test_lists_the_reports_from_newest_to_oldest(tmp_path: Path) -> None:
    index = tmp_path / "reports.json"
    older, newer = _entry(tmp_path, "1b2c3d", days_ago=3), _entry(tmp_path, "a3f9c1")
    record_report(index, older)
    record_report(index, newer)

    listed = list_reports(index)

    assert listed == (newer, older)


def test_replaces_the_entry_of_a_run_written_again(tmp_path: Path) -> None:
    index = tmp_path / "reports.json"
    record_report(index, _entry(tmp_path, "a3f9c1", days_ago=1))
    again = _entry(tmp_path, "a3f9c1")

    record_report(index, again)

    assert list_reports(index) == (again,)


def test_leaves_out_a_report_that_no_longer_exists(tmp_path: Path) -> None:
    index = tmp_path / "reports.json"
    gone, kept = _entry(tmp_path, "1b2c3d", days_ago=3), _entry(tmp_path, "a3f9c1")
    record_report(index, gone)
    record_report(index, kept)
    gone.report_path.unlink()

    listed = list_reports(index)

    assert listed == (kept,)


def test_lists_nothing_without_an_index(tmp_path: Path) -> None:
    listed = list_reports(tmp_path / "reports.json")

    assert listed == ()


@pytest.mark.parametrize(
    "content",
    ["{not json", json.dumps({"schema_version": 2, "entries": []})],
    ids=["corrupt", "unknown-version"],
)
def test_starts_over_from_an_unreadable_index(
    tmp_path: Path, content: str, caplog: pytest.LogCaptureFixture
) -> None:
    index = tmp_path / "reports.json"
    index.write_text(content, encoding="utf-8")
    entry = _entry(tmp_path, "a3f9c1")

    record_report(index, entry)

    assert list_reports(index) == (entry,)
    assert "report index unreadable reason=unreadable" in caplog.messages


def test_logs_an_index_it_cannot_write_without_the_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    refusal = OSError(28, "No space left", "C:/private/profile/reports.json")
    monkeypatch.setattr(report_index, "write_atomically", raising(refusal))
    entry = _entry(tmp_path, "a3f9c1")

    record_report(tmp_path / "reports.json", entry)

    assert "report index not written run=a3f9c1 reason=write_failed errno=28" in caplog.messages
    assert "C:/private" not in caplog.text


def test_leaves_an_index_it_cannot_read_untouched(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    index = tmp_path / "reports.json"
    index.mkdir()
    entry = _entry(tmp_path, "a3f9c1")

    record_report(index, entry)

    assert index.is_dir()
    assert "report index not read reason=read_failed" in caplog.messages
