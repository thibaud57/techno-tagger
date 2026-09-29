"""Tests des modeles et de la traduction de l'arbitrage sur le protocole NDJSON."""

import json
from dataclasses import replace
from datetime import date
from typing import TYPE_CHECKING

import pytest
from pydantic import ValidationError
from scraper_responses import track_candidate
from tagging_records import RECORD, scored_candidate

from tagger import arbitration, tagging
from tagger.handlers import to_protocol_event
from tagger.protocol import (
    ArbitrationRequired,
    ArbitrationUpdated,
    ResolveArbitration,
    parse_command,
)
from tagger.scraper_client import Credit, ReleaseInfo, Source
from tagger.tagging import FailureReason, PendingArbitration, SourceList, TrackRecord

if TYPE_CHECKING:
    from tagger.scraper_client import TrackCandidate


def _awaiting(pending: PendingArbitration) -> TrackRecord:
    return replace(RECORD, arbitration=pending)


def test_translates_an_update_with_the_other_source_and_the_empty_reason() -> None:
    pending = PendingArbitration(
        Source.BANDCAMP,
        (),
        beatport_unavailable=False,
        empty_reason=FailureReason.NO_RESULT,
        other=SourceList(Source.BEATPORT, (scored_candidate(),)),
    )

    event = to_protocol_event(arbitration.ArbitrationUpdated(_awaiting(pending)))

    assert isinstance(event, ArbitrationUpdated)
    assert (event.source, event.candidates, event.empty_reason, event.other_source) == (
        Source.BANDCAMP,
        (),
        FailureReason.NO_RESULT,
        Source.BEATPORT,
    )


@pytest.mark.parametrize(
    ("candidate", "expected"),
    [
        (
            track_candidate().model_copy(
                update={
                    "label": Credit(name="Drumcode"),
                    "release": ReleaseInfo(release_date=date(2023, 6, 16)),
                }
            ),
            ("Drumcode", 2023),
        ),
        (track_candidate(), (None, None)),
    ],
    ids=["full-release", "search-omits-them"],
)
def test_translates_the_label_and_the_release_year(
    candidate: TrackCandidate, expected: tuple[str | None, int | None]
) -> None:
    pending = PendingArbitration(
        Source.BEATPORT, (scored_candidate(candidate=candidate),), beatport_unavailable=False
    )

    event = to_protocol_event(tagging.ArbitrationRequired(_awaiting(pending)))

    assert isinstance(event, ArbitrationRequired)
    assert (event.candidates[0].label, event.candidates[0].year) == expected
    assert (event.empty_reason, event.other_source) == (None, None)


def _resolve(payload: str) -> str:
    return '{"command":"resolve_arbitration","track_id":"a.mp3",' + payload + "}"


@pytest.mark.parametrize("candidate", ["0", "null"], ids=["choice", "refusal"])
def test_accepts_a_choice_and_an_explicit_refusal(candidate: str) -> None:
    line = _resolve('"source":"beatport","candidate":' + candidate)

    command = parse_command(line)

    assert isinstance(command, ResolveArbitration)
    assert command.candidate == json.loads(candidate)


@pytest.mark.parametrize(
    "payload",
    [
        '"source":"beatport","candidate":-1',
        '"source":"soundcloud","candidate":0',
        '"source":"beatport"',
        '"source":"beatport","candidate":true',
    ],
    ids=["negative-index", "soundcloud", "missing-candidate", "boolean"],
)
def test_rejects_a_malformed_gesture(payload: str) -> None:
    with pytest.raises(ValidationError):
        parse_command(_resolve(payload))
