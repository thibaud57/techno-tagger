"""Tests du rendu Markdown du rapport d'extraction."""

from dataclasses import replace
from typing import TYPE_CHECKING

from extraction_samples import CYRILLIC_TRACK

from tagger.reports import ReportContext, render_markdown

if TYPE_CHECKING:
    from tagger.extraction import ExtractionResult


def test_headings_are_in_english(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    rendered = render_markdown(extraction_result, report_context)

    assert "# Extraction report" in rendered
    assert "## Summary" in rendered


def test_shows_every_category_that_has_content(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    rendered = render_markdown(extraction_result, report_context)

    for heading in (
        "## Extracted",
        "## Already present",
        "## Missing",
        "## Duplicates resolved",
        "## Failures",
    ):
        assert heading in rendered


def test_a_resolved_duplicate_is_readable(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    rendered = render_markdown(extraction_result, report_context)

    assert "beta.mp3" in rendered
    assert "largest_file" in rendered
    assert "12000" in rendered
    assert "5000" in rendered
    assert "albums" in rendered
    assert "- Mode: copy" in rendered
    assert "file_locked" in rendered


def test_omits_a_category_with_nothing_in_it(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    without_duplicates = replace(extraction_result, duplicates=())

    rendered = render_markdown(without_duplicates, report_context)

    assert "## Duplicates resolved" not in rendered


def test_keeps_non_ascii_intact(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    rendered = render_markdown(extraction_result, report_context)

    assert CYRILLIC_TRACK in rendered


def test_escapes_markdown_breaking_characters_in_a_playlist_sourced_name(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    poisoned = replace(extraction_result, missing=("weird|name\nsplit.mp3",))

    rendered = render_markdown(poisoned, report_context)

    assert "- weird\\|name split.mp3" in rendered


def test_an_empty_result_still_writes_a_report_with_no_detail_sections(
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

    rendered = render_markdown(empty, report_context)

    assert "## Summary" in rendered
    assert "## Extracted" not in rendered
    assert "## Already present" not in rendered
    assert "## Missing" not in rendered
    assert "## Duplicates resolved" not in rendered
    assert "## Failures" not in rendered
