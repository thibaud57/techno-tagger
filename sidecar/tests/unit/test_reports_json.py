"""Tests du rendu JSON du rapport d'extraction."""

import json
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import TYPE_CHECKING

import pytest
from extraction_samples import CYRILLIC_TRACK, EXPECTED_STAMP, GENERATED_AT

from tagger.reports import (
    REPORT_KIND,
    SCHEMA_VERSION,
    ReportContext,
    ReportWriteError,
    render_json,
    write_extraction_report,
)

if TYPE_CHECKING:
    from tagger.extraction import ExtractionResult


def test_carries_its_schema_version(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    payload = json.loads(render_json(extraction_result, report_context))

    assert payload["schema_version"] == SCHEMA_VERSION


def test_distinguishes_the_extraction_report_from_the_tagging_one(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    payload = json.loads(render_json(extraction_result, report_context))

    assert payload["kind"] == REPORT_KIND


def test_carries_the_five_categories(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    payload = json.loads(render_json(extraction_result, report_context))

    assert set(payload) >= {
        "extracted",
        "already_present",
        "missing",
        "duplicates",
        "failures",
    }


def test_counts_match_the_categories(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    payload = json.loads(render_json(extraction_result, report_context))

    assert payload["counts"] == {
        "extracted": 2,
        "already_present": 1,
        "missing": 1,
        "duplicates": 1,
        "failures": 1,
    }


def test_an_empty_result_still_reports_zero_counts(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    empty = replace(
        extraction_result,
        extracted=(),
        already_present=(),
        missing=(),
        duplicates=(),
        failures=(),
    )

    payload = json.loads(render_json(empty, report_context))

    assert payload["counts"] == {
        "extracted": 0,
        "already_present": 0,
        "missing": 0,
        "duplicates": 0,
        "failures": 0,
    }


def test_a_resolved_duplicate_is_verifiable(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    payload = json.loads(render_json(extraction_result, report_context))

    duplicate = payload["duplicates"][0]
    assert duplicate["kept_size"] == 12_000
    assert duplicate["criterion"] == "largest_file"
    assert len(duplicate["discarded"]) == 1
    assert duplicate["discarded"][0]["size"] == 5_000
    assert "albums" in duplicate["discarded"][0]["path"]


def test_writes_full_paths(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    payload = json.loads(render_json(extraction_result, report_context))

    assert payload["duplicates"][0]["kept_path"].endswith("beta.mp3")
    assert "singles" in payload["duplicates"][0]["kept_path"]


def test_keeps_non_ascii_readable(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    rendered = render_json(extraction_result, report_context)

    assert CYRILLIC_TRACK in rendered


def test_carries_the_generation_instant_in_full_iso(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    payload = json.loads(render_json(extraction_result, report_context))

    assert payload["generated_at"] == "2026-09-08T22:15:00Z"


def test_is_deterministic(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    first = render_json(extraction_result, report_context)
    second = render_json(extraction_result, report_context)

    assert first == second


def test_writes_both_files_in_the_destination(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    paths = write_extraction_report(extraction_result, report_context)

    assert paths.json_path.is_file()
    assert paths.markdown_path.is_file()


def test_file_names_carry_the_generation_stamp(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    paths = write_extraction_report(extraction_result, report_context)

    assert paths.json_path.name == f"extraction-report-{EXPECTED_STAMP}.json"
    assert paths.markdown_path.name == f"extraction-report-{EXPECTED_STAMP}.md"


def test_file_names_avoid_characters_windows_forbids(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    paths = write_extraction_report(extraction_result, report_context)

    forbidden = set('<>:"/\\|?*')
    assert not forbidden & set(paths.json_path.name)


def test_file_name_uses_the_utc_instant_not_the_local_one(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    non_utc = replace(
        report_context,
        generated_at=datetime(2026, 9, 8, 22, 15, 0, tzinfo=timezone(timedelta(hours=2))),
    )

    paths = write_extraction_report(extraction_result, non_utc)

    assert paths.json_path.name == "extraction-report-20260908T201500Z.json"


def test_a_second_run_does_not_overwrite_the_first(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    first = write_extraction_report(extraction_result, report_context)

    later = replace(report_context, generated_at=GENERATED_AT + timedelta(minutes=1))
    second = write_extraction_report(extraction_result, later)

    assert first.json_path.is_file()
    assert second.json_path != first.json_path
    assert first.markdown_path.is_file()
    assert second.markdown_path.is_file()
    assert second.markdown_path != first.markdown_path


def test_rejects_a_naive_generated_at(report_context: ReportContext) -> None:
    with pytest.raises(ValueError, match="timezone-aware"):
        # Naive intentionnel : c'est precisement ce que le constructeur doit refuser.
        replace(report_context, generated_at=datetime(2026, 9, 8, 22, 15, 0))  # noqa: DTZ001


def test_a_refused_mkdir_names_the_destination_folder_not_a_report_file(
    extraction_result: ExtractionResult,
    report_context: ReportContext,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def refuse(self: Path, *args: object, **kwargs: object) -> None:
        raise OSError(13, "Permission denied")

    monkeypatch.setattr(Path, "mkdir", refuse)

    with pytest.raises(ReportWriteError) as raised:
        write_extraction_report(extraction_result, report_context)

    assert raised.value.params["filename"] == report_context.destination_folder.name


def test_creates_the_destination_folder(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    assert not report_context.destination_folder.exists()

    write_extraction_report(extraction_result, report_context)

    assert report_context.destination_folder.is_dir()


def test_written_json_is_the_rendered_json(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    paths = write_extraction_report(extraction_result, report_context)

    assert paths.json_path.read_text(encoding="utf-8") == render_json(
        extraction_result, report_context
    )


@pytest.mark.parametrize(
    "error",
    [PermissionError(13, "Permission denied"), OSError(28, "No space left on device")],
    ids=["permission_denied", "disk_full"],
)
def test_a_refused_write_becomes_a_business_error_naming_the_report(
    extraction_result: ExtractionResult,
    report_context: ReportContext,
    monkeypatch: pytest.MonkeyPatch,
    error: OSError,
) -> None:
    def refuse(self: Path, data: str, encoding: str | None = None) -> int:
        raise error

    monkeypatch.setattr(Path, "write_text", refuse)

    with pytest.raises(ReportWriteError) as raised:
        write_extraction_report(extraction_result, report_context)

    assert raised.value.code == "report_write_failed"
    reported = str(raised.value.params["filename"])
    assert reported.endswith(".json")
    assert "/" not in reported
    assert "\\" not in reported


def test_a_refused_markdown_write_names_the_markdown_file_not_the_json(
    extraction_result: ExtractionResult,
    report_context: ReportContext,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original_write_text = Path.write_text

    def refuse_markdown_only(self: Path, data: str, encoding: str | None = None) -> int:
        if self.suffix == ".md":
            raise OSError(28, "No space left on device")
        return original_write_text(self, data, encoding=encoding)

    monkeypatch.setattr(Path, "write_text", refuse_markdown_only)

    with pytest.raises(ReportWriteError) as raised:
        write_extraction_report(extraction_result, report_context)

    reported = str(raised.value.params["filename"])
    assert reported.endswith(".md")
