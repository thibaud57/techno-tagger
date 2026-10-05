"""Tests du modele et de la traduction du rattrapage par URL sur le protocole NDJSON."""

import pytest
from pydantic import ValidationError

from tagger.arbitration import ArbitrationNotPendingError
from tagger.handlers import to_protocol_event
from tagger.protocol import Phase, Progress, ResolveByUrl, error_from_business, parse_command
from tagger.scraper_client import UnsupportedTrackUrlError
from tagger.url_recovery import UrlProgress

URL = "https://amelielens.bandcamp.com/track/basiel"


def _resolve(fields: str) -> str:
    return '{"command":"resolve_by_url",' + fields + "}"


def test_accepts_a_url_recovery_command() -> None:
    command = parse_command(_resolve(f'"track_id":"a.mp3","url":"{URL}"'))

    assert command == ResolveByUrl(command="resolve_by_url", track_id="a.mp3", url=URL)


@pytest.mark.parametrize(
    "fields",
    [
        '"track_id":"a.mp3"',
        '"track_id":"a.mp3","url":""',
        '"track_id":"a.mp3","url":42',
        f'"track_id":"a.mp3","url":"{URL}","source":"bandcamp"',
    ],
    ids=["missing-url", "empty-url", "numeric-url", "extra-field"],
)
def test_rejects_a_malformed_url_recovery_command(fields: str) -> None:
    with pytest.raises(ValidationError):
        parse_command(_resolve(fields))


def test_translates_the_url_progress_into_a_url_recovery_progress() -> None:
    event = to_protocol_event(UrlProgress(processed=1, total=3))

    assert event == Progress(event="progress", phase=Phase.URL_RECOVERY, processed=1, total=3)


@pytest.mark.parametrize(
    "error",
    [UnsupportedTrackUrlError(), ArbitrationNotPendingError("a.mp3")],
    ids=["client-error", "already-carried"],
)
def test_joins_the_track_to_the_error_of_a_gesture(
    error: UnsupportedTrackUrlError | ArbitrationNotPendingError,
) -> None:
    event = error_from_business(error, "resolve_by_url", "a.mp3")

    assert (event.command, event.params) == ("resolve_by_url", {"track_id": "a.mp3"})


def test_leaves_the_error_of_a_command_without_track_untouched() -> None:
    event = error_from_business(UnsupportedTrackUrlError(), "start_tagging")

    assert (event.code, event.params) == ("unsupported_url", {})
