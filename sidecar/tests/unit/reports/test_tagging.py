import json
from dataclasses import replace
from typing import TYPE_CHECKING, Final

import pytest
from fs_listing import names
from scraper_responses import BEATPORT_CANDIDATE, payload_candidate
from stubs import refusing_suffix
from tagging_records import CREATED, UNREADABLE_CONTENTS
from tagging_report_samples import RUN, WRITTEN, WRITTEN_AS

from tagger.core.file_failures import FileFailureReason
from tagger.core.run_files import write_atomically
from tagger.reports import tagging as tagging_report
from tagger.reports.extraction import ReportWriteError
from tagger.reports.tagging import (
    TaggingReportCounts,
    TaggingReportUnreadableError,
    build_tagging_report,
    load_tagging_report,
    render_tagging_markdown,
    report_paths,
    write_tagging_report,
)
from tagger.resolution.matching import DEFAULT_THRESHOLDS
from tagger.resolution.scraper_client import Source
from tagger.run.models import Resolution, TrackState, WriteOutcome
from tagger.tags.files import TagField, TagSystem, WrittenTags

if TYPE_CHECKING:
    from pathlib import Path

    from tagger.reports.tagging import TaggingReport
    from tagger.run.models import TaggingRun, TrackRecord


@pytest.fixture
def report() -> TaggingReport:
    return build_tagging_report(RUN, DEFAULT_THRESHOLDS, CREATED)


def _markdown(run: TaggingRun) -> str:
    return render_tagging_markdown(build_tagging_report(run, DEFAULT_THRESHOLDS, CREATED))


def test_records_the_files_of_a_written_track(report: TaggingReport) -> None:
    written = report.tracks[0]

    assert (written.file_before, written.file_after, written.truncated) == (
        "a.mp3",
        WRITTEN_AS,
        True,
    )


def test_records_the_decision_behind_a_written_track(report: TaggingReport) -> None:
    written = report.tracks[0]

    assert written.query is not None
    assert written.query.text == "Adam Beyer Your Mind"
    assert (written.source, written.state, written.resolution) == (
        Source.BEATPORT,
        TrackState.WRITTEN,
        Resolution.AUTO,
    )
    assert written.scores is not None
    assert (written.scores.artist, written.scores.title) == (96.4, 91.6)
    assert written.url == BEATPORT_CANDIDATE.url


def test_records_the_tags_of_a_written_track(report: TaggingReport) -> None:
    written = report.tracks[0]

    assert (written.artist, written.title) == ("Adam Beyer", "Your Mind (Extended Mix)")
    assert written.fields_written == (TagField.ARTIST, TagField.TITLE)
    assert written.artwork_written
    assert (written.system, written.comment_before) == (TagSystem.ID3, "ripped from vinyl")
    assert written.tags_before is not None
    assert written.tags_after is not None


def test_keeps_the_reason_of_a_failed_write_and_leaves_the_file_name(
    report: TaggingReport,
) -> None:
    failed = report.tracks[1]
    assert (failed.state, failed.failure_reason, failed.file_after) == (
        TrackState.WRITE_ERROR,
        FileFailureReason.FILE_LOCKED,
        None,
    )


def test_reports_a_restored_track_without_its_decision(report: TaggingReport) -> None:
    restored = report.tracks[5]
    assert (restored.state, restored.file_before, restored.file_after) == (
        TrackState.ROLLED_BACK,
        "f.mp3",
        None,
    )
    assert restored.tags_before is not None
    assert restored.system is TagSystem.ID3
    assert (
        restored.resolution,
        restored.source,
        restored.query,
        restored.scores,
        restored.url,
        restored.tags_after,
    ) == (None, None, None, None, None, None)
    assert restored.fields_written == ()


def test_leaves_the_system_empty_when_the_origin_was_unreadable() -> None:
    unreadable = replace(WRITTEN, tags_before=None)
    run = replace(RUN, tracks=(unreadable,))

    report = build_tagging_report(run, DEFAULT_THRESHOLDS, CREATED)

    track = report.tracks[0]
    assert (track.system, track.tags_before, track.comment_before) == (None, None, None)
    assert track.tags_after is not None
    assert {row.key for row in track.tags_after} >= {"TPE1", "TIT2"}


def test_counts_each_outcome_on_its_state(report: TaggingReport) -> None:
    assert report.counts == TaggingReportCounts(
        written=1, write_error=1, unresolved=1, rolled_back=1, not_processed=2
    )


def test_reloads_the_report_it_wrote(tmp_path: Path, report: TaggingReport) -> None:
    path = tmp_path / "tagging-report.json"
    path.write_text(report.model_dump_json(indent=2), encoding="utf-8")

    reloaded = load_tagging_report(path)

    assert reloaded == report


def test_refuses_a_report_of_a_future_version(tmp_path: Path) -> None:
    path = tmp_path / "tagging-report.json"
    path.write_text(json.dumps({"schema_version": 2}), encoding="utf-8")

    with pytest.raises(TaggingReportUnreadableError) as refused:
        load_tagging_report(path)

    assert (refused.value.code, refused.value.params) == (
        "tagging_report_unreadable",
        {"file": path.name, "found": 2, "expected": 1},
    )


@pytest.mark.parametrize(
    "content",
    [*UNREADABLE_CONTENTS, pytest.param(json.dumps({"schema_version": 1}), id="invalid-model")],
)
def test_refuses_an_unreadable_report(tmp_path: Path, content: str) -> None:
    path = tmp_path / "tagging-report.json"
    path.write_text(content, encoding="utf-8")

    with pytest.raises(TaggingReportUnreadableError):
        load_tagging_report(path)


def _section(markdown: str, title: str) -> str:
    """Texte d'une section `## <title>`, jusqu'a la suivante."""
    _, _, tail = markdown.partition(f"## {title}\n")
    return tail.split("\n## ", 1)[0]


def test_renders_each_track_in_the_section_of_its_outcome() -> None:
    markdown = _markdown(RUN)

    assert WRITTEN_AS in _section(markdown, "Written")
    assert "b.mp3" in _section(markdown, "Write errors")
    assert "c.mp3" in _section(markdown, "Unresolved")
    assert "f.mp3" in _section(markdown, "Rolled back")
    not_processed = _section(markdown, "Not processed")
    assert "d.mp3" in not_processed
    assert "e.mp3" in not_processed


def test_leaves_out_an_empty_section() -> None:
    markdown = _markdown(replace(RUN, tracks=(WRITTEN,)))

    assert "## Unresolved" not in markdown
    assert "## Write errors" not in markdown
    assert "## Rolled back" not in markdown


def test_flags_the_route_and_the_truncation_of_a_written_track() -> None:
    markdown = _markdown(RUN)

    written = _section(markdown, "Written")
    assert "| auto |" in written
    assert "| yes |" in written


_COVERS: Final = {"written", "missing", "none"}
_WITHOUT_COVER: Final = WriteOutcome(
    WrittenTags((TagField.ARTIST,), artwork=False), truncated=False
)


@pytest.mark.parametrize(
    ("track", "cover"),
    [
        (WRITTEN, "written"),
        (replace(WRITTEN, written=_WITHOUT_COVER), "missing"),
        (
            replace(WRITTEN, written=_WITHOUT_COVER, candidate=payload_candidate(release=None)),
            "none",
        ),
    ],
    ids=["written-with-cover", "cover-not-written", "no-cover-offered"],
)
def test_flags_the_cover_of_a_written_track(track: TrackRecord, cover: str) -> None:
    markdown = _markdown(replace(RUN, tracks=(track,)))

    written = _section(markdown, "Written")
    assert f"| {cover} |" in written
    assert not [other for other in _COVERS - {cover} if f"| {other} |" in written]


def test_escapes_a_value_that_would_break_a_table() -> None:
    piped = replace(WRITTEN, track_id="a | b\nc.mp3")

    markdown = _markdown(replace(RUN, tracks=(piped,)))

    assert "a \\| b c.mp3" in markdown


def test_warns_about_wav_files_once_one_is_written() -> None:
    wav = replace(WRITTEN, path=RUN.folder / "Adam Beyer - Your Mind.wav")

    markdown = _markdown(replace(RUN, tracks=(wav,)))

    assert "## WAV files" in markdown


def test_writes_the_json_and_markdown_reports_in_the_folder(tmp_path: Path) -> None:
    run = replace(RUN, folder=tmp_path)
    paths = report_paths(tmp_path, CREATED)

    write_tagging_report(run, DEFAULT_THRESHOLDS, CREATED, paths)

    assert paths.json_path == tmp_path / "tagging-report-20261006T211403Z.json"
    assert paths.markdown_path.read_text(encoding="utf-8").startswith("# Tagging report")
    assert load_tagging_report(paths.json_path).run_id == RUN.run_id


def test_rewrites_the_same_pair_of_files(tmp_path: Path) -> None:
    run = replace(RUN, folder=tmp_path)
    paths = report_paths(tmp_path, CREATED)
    write_tagging_report(run, DEFAULT_THRESHOLDS, CREATED, paths)

    write_tagging_report(run, DEFAULT_THRESHOLDS, CREATED, paths)

    assert names(tmp_path) == [
        "tagging-report-20261006T211403Z.json",
        "tagging-report-20261006T211403Z.md",
    ]


def test_names_the_next_free_pair_when_one_already_exists(tmp_path: Path) -> None:
    (tmp_path / "tagging-report-20261006T211403Z.json").write_text("{}", encoding="utf-8")

    paths = report_paths(tmp_path, CREATED)

    assert paths.json_path.name == "tagging-report-20261006T211403Z-2.json"
    assert paths.markdown_path.name == "tagging-report-20261006T211403Z-2.md"


def test_logs_a_json_left_without_its_markdown(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    refusal = OSError(28, "No space left on device")
    monkeypatch.setattr(
        tagging_report, "write_atomically", refusing_suffix(write_atomically, ".md", refusal)
    )
    run = replace(RUN, folder=tmp_path)
    paths = report_paths(tmp_path, CREATED)

    with pytest.raises(ReportWriteError):
        write_tagging_report(run, DEFAULT_THRESHOLDS, CREATED, paths)

    assert paths.json_path.is_file()
    assert "json report orphaned by a failed markdown write run=a3f9c1" in caplog.messages
