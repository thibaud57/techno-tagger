"""Tests des modeles du run et de la traduction des evenements du pipeline."""

from dataclasses import replace
from typing import TYPE_CHECKING

import pytest
from pydantic import ValidationError
from scraper_responses import track_candidate
from tagging_records import RECORD, scored_candidate

from tagger import tagging
from tagger.handlers import to_protocol_event
from tagger.protocol import (
    ArbitrationRequired,
    Progress,
    RunStarted,
    StartTagging,
    TrackNames,
    TrackResolved,
    parse_command,
)
from tagger.scraper_client import Source, TrackCandidate
from tagger.tagging import PendingArbitration, Resolution, TrackRecord, TrackState

if TYPE_CHECKING:
    from tagger.matching import ScoredCandidate


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


def _record(
    *,
    state: TrackState | None = None,
    resolution: Resolution | None = None,
    source: Source | None = None,
    candidate: TrackCandidate | None = None,
    scored: ScoredCandidate | None = None,
    arbitration: PendingArbitration | None = None,
) -> TrackRecord:
    return replace(
        RECORD,
        state=state,
        resolution=resolution,
        source=source,
        candidate=candidate,
        scored=scored,
        arbitration=arbitration,
    )


def test_lists_every_track_of_a_started_run() -> None:
    event = to_protocol_event(tagging.RunStarted("a3f9c1", (_record(),)))

    assert isinstance(event, RunStarted)
    assert event.tracks[0].track_id == "a.mp3"
    assert event.tracks[0].artist == "Adam Beyer"


def test_rounds_the_scores_of_a_resolved_track() -> None:
    record = _record(
        state=TrackState.RESOLVED,
        resolution=Resolution.AUTO,
        source=Source.BEATPORT,
        candidate=track_candidate(),
        scored=scored_candidate(),
    )

    event = to_protocol_event(tagging.TrackResolved(record))

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
    record = _record(
        state=TrackState.RESOLVED,
        resolution=Resolution.AUTO,
        source=Source.BEATPORT,
        candidate=track_candidate(title, mix_name),
        scored=scored_candidate(),
    )

    event = to_protocol_event(tagging.TrackResolved(record))

    assert isinstance(event, TrackResolved)
    assert event.after is not None
    assert event.after == TrackNames(artist="Adam Beyer", title=expected)


def test_reports_no_artist_score_for_a_query_without_artist() -> None:
    record = _record(
        state=TrackState.RESOLVED,
        resolution=Resolution.AUTO,
        source=Source.BANDCAMP,
        candidate=track_candidate(),
        scored=scored_candidate(artist=None, title=100),
    )

    event = to_protocol_event(tagging.TrackResolved(record))

    assert isinstance(event, TrackResolved)
    assert event.scores is not None
    assert event.scores.artist is None


def test_carries_the_grey_zone_candidates_of_an_arbitration() -> None:
    record = _record(
        arbitration=PendingArbitration(
            Source.BANDCAMP, (scored_candidate(),), beatport_unavailable=True
        )
    )

    event = to_protocol_event(tagging.ArbitrationRequired(record))

    assert isinstance(event, ArbitrationRequired)
    assert event.beatport_unavailable is True
    assert event.candidates[0].title == "Your Mind (Original Mix)"


def test_maps_the_pipeline_progress_to_the_tagging_phase() -> None:
    event = to_protocol_event(tagging.RunProgress(2, 3))

    assert isinstance(event, Progress)
    assert event.phase == "tagging"
