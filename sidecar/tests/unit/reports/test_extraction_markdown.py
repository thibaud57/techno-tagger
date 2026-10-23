from dataclasses import replace
from typing import TYPE_CHECKING, Final

import pytest
from extraction_samples import CYRILLIC_TRACK

from tagger.reports.extraction import ReportContext, build_report, render_markdown

if TYPE_CHECKING:
    from tagger.playlists.extraction import ExtractionResult


def _rendered(result: ExtractionResult, context: ReportContext) -> str:
    return render_markdown(build_report(result, context))


def test_headings_are_in_english(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    rendered = _rendered(extraction_result, report_context)

    assert "# Extraction report" in rendered
    assert "## Summary" in rendered


CATEGORY_HEADINGS: Final = [
    "## Extracted",
    "## Already present",
    "## Missing",
    "## Duplicates resolved",
    "## Failures",
]


@pytest.mark.parametrize(
    "heading",
    CATEGORY_HEADINGS,
    ids=["extracted", "already-present", "missing", "duplicates", "failures"],
)
def test_shows_every_category_that_has_content(
    extraction_result: ExtractionResult, report_context: ReportContext, heading: str
) -> None:
    rendered = _rendered(extraction_result, report_context)

    assert heading in rendered


def test_a_resolved_duplicate_is_readable(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    rendered = _rendered(extraction_result, report_context)

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

    rendered = _rendered(without_duplicates, report_context)

    assert "## Duplicates resolved" not in rendered


def test_keeps_non_ascii_intact(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    rendered = _rendered(extraction_result, report_context)

    assert CYRILLIC_TRACK in rendered


def test_escapes_markdown_breaking_characters_in_a_playlist_sourced_name(
    extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    poisoned = replace(extraction_result, missing=("weird|name\nsplit.mp3",))

    rendered = _rendered(poisoned, report_context)

    assert "- weird\\|name split.mp3" in rendered


def test_an_empty_result_still_writes_a_report_with_no_detail_sections(
    empty_extraction_result: ExtractionResult, report_context: ReportContext
) -> None:
    rendered = _rendered(empty_extraction_result, report_context)

    assert "## Summary" in rendered
    assert not [heading for heading in CATEGORY_HEADINGS if heading in rendered]
