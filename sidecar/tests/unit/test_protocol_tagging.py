from dataclasses import replace
from pathlib import Path
from typing import TYPE_CHECKING

import pytest
from pydantic import ValidationError
from scraper_responses import track_candidate
from tagging_records import (
    MUSIC,
    RECORD,
    RUN_ID,
    awaiting,
    resolved,
    rolled_back_record,
    scored_candidate,
    unresolved,
    write_failed_record,
    written_record,
)

from tagger.protocol import (
    ArbitrationRequired,
    Progress,
    RunStarted,
    StartTagging,
    TrackNames,
    TrackResolved,
    parse_command,
)
from tagger.resolution.scraper_client import Source
from tagger.run import models
from tagger.run.models import FailureReason, PendingArbitration, Resolution
from tagger.tags.files import TAG_FIELDS, TagField
from tagger.translation import to_protocol_event

if TYPE_CHECKING:
    from tagger.run.models import SettledOutcome, TrackRecord

_RESOLVED = resolved(RECORD, scored=scored_candidate())


def test_accepts_a_start_tagging_command_without_thresholds() -> None:
    command = parse_command('{"command":"start_tagging","folder":"C:/Sets"}')

    assert isinstance(command, StartTagging)
    assert command.thresholds is None


def test_accepts_thresholds_sent_by_the_settings() -> None:
    command = parse_command(
        '{"command":"start_tagging","folder":"C:/Sets","thresholds":{"floor":75,"ceiling":95}}'
    )

    assert isinstance(command, StartTagging)
    assert command.thresholds is not None
    assert (command.thresholds.floor, command.thresholds.ceiling) == (75, 95)


@pytest.mark.parametrize(
    "thresholds",
    ['{"floor":95,"ceiling":90}', '{"floor":-1,"ceiling":90}', '{"floor":70,"ceiling":101}'],
    ids=["inverted", "negative", "over"],
)
def test_rejects_thresholds_out_of_bounds(thresholds: str) -> None:
    line = '{"command":"start_tagging","folder":"C:/Sets","thresholds":' + thresholds + "}"

    with pytest.raises(ValidationError, match="inconsistent thresholds"):
        parse_command(line)


def test_lists_every_track_of_a_started_run() -> None:
    event = to_protocol_event(models.RunStarted(RUN_ID, Path("D:/Sets"), (RECORD,)))

    assert isinstance(event, RunStarted)
    assert event.folder == Path("D:/Sets")
    assert event.tracks[0].track_id == "a.mp3"
    assert event.tracks[0].artist == "Adam Beyer"


def test_rounds_the_scores_of_a_resolved_track() -> None:
    event = to_protocol_event(models.TrackResolved(_RESOLVED))

    assert isinstance(event, TrackResolved)
    assert event.scores is not None
    assert (event.scores.artist, event.scores.title, event.scores.average) == (96, 92, 94)


@pytest.mark.parametrize(
    ("title", "mix_name", "expected"),
    [
        ("Your Mind", "Original Mix", "Your Mind (Original Mix)"),
        ("Your Mind", None, "Your Mind"),
    ],
    ids=["with-mix", "without-mix"],
)
def test_renders_the_artist_and_the_title_a_source_will_write(
    title: str, mix_name: str | None, expected: str
) -> None:
    record = resolved(RECORD, candidate=track_candidate(title, mix_name), scored=scored_candidate())

    event = to_protocol_event(models.TrackResolved(record))

    assert isinstance(event, TrackResolved)
    assert event.after is not None
    assert event.after == TrackNames(artist="Adam Beyer", title=expected)


def test_carries_no_tags_after_for_an_unresolved_track() -> None:
    record = unresolved(RECORD, FailureReason.NO_RESULT)

    event = to_protocol_event(models.TrackResolved(record))

    assert isinstance(event, TrackResolved)
    assert event.tags_after is None


@pytest.mark.parametrize(
    ("record", "recoverable"),
    [
        (unresolved(RECORD, FailureReason.NO_RESULT), True),
        (resolved(RECORD, Resolution.URL), True),
        (_RESOLVED, False),
        (resolved(RECORD, Resolution.ARBITRATION, scored=scored_candidate()), False),
        (written_record(_RESOLVED), False),
        (write_failed_record(_RESOLVED), False),
        (rolled_back_record(written_record(resolved(RECORD, Resolution.URL))), False),
    ],
    ids=[
        "unresolved",
        "resolved-by-url",
        "resolved-auto",
        "resolved-by-arbitration",
        "written",
        "write-failed",
        "rolled-back",
    ],
)
def test_resolved_event_says_whether_the_track_is_recoverable(
    record: TrackRecord[SettledOutcome], *, recoverable: bool
) -> None:
    event = to_protocol_event(models.TrackResolved(record))

    assert isinstance(event, TrackResolved)
    assert event.recoverable is recoverable


def test_deduces_the_tag_system_of_an_unreadable_file_from_its_extension() -> None:
    record = replace(_RESOLVED, path=MUSIC / "a.FLAC", tags_before=None)

    started = to_protocol_event(models.RunStarted(RUN_ID, Path("D:/Sets"), (record,)))
    settled = to_protocol_event(models.TrackResolved(record))

    assert isinstance(started, RunStarted)
    assert started.tracks[0].tags_before is None
    assert isinstance(settled, TrackResolved)
    assert settled.tags_after is not None
    rows = {row.field: row for row in settled.tags_after}
    assert list(rows) == list(TAG_FIELDS)
    assert rows[TagField.ARTIST].key == "ARTIST"
    assert rows[TagField.ARTIST].value == "Adam Beyer"
    assert rows[TagField.TITLE].value == "Your Mind (Original Mix)"
    assert rows[TagField.ALBUM].value is None
    assert rows[TagField.BPM].value is None


def test_reports_no_artist_score_for_a_query_without_artist() -> None:
    record = resolved(
        RECORD, source=Source.BANDCAMP, scored=scored_candidate(artist=None, title=100)
    )

    event = to_protocol_event(models.TrackResolved(record))

    assert isinstance(event, TrackResolved)
    assert event.scores is not None
    assert event.scores.artist is None


def test_carries_the_grey_zone_candidates_of_an_arbitration() -> None:
    record = awaiting(
        RECORD,
        PendingArbitration(Source.BANDCAMP, (scored_candidate(),), beatport_unavailable=True),
    )

    event = to_protocol_event(models.ArbitrationRequired(record))

    assert isinstance(event, ArbitrationRequired)
    assert event.beatport_unavailable is True
    assert event.candidates[0].title == "Your Mind (Original Mix)"


def test_maps_the_pipeline_progress_to_the_tagging_phase() -> None:
    event = to_protocol_event(models.RunProgress(processed=2, total=3))

    assert isinstance(event, Progress)
    assert event.phase == "tagging"
