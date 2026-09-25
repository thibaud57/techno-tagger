"""Tests des issues d'un morceau dans le pipeline de resolution."""

from typing import TYPE_CHECKING

import pytest
from audio_samples import write_blank_mp3
from scraper_responses import track_payload
from tagging_api import FakeApi, FakeCdn, failing, found, ok, run, tagged_mp3

from tagger.scraper_client import Source
from tagger.tagging import FailureReason, Resolution, TrackState

if TYPE_CHECKING:
    from pathlib import Path

pytestmark = pytest.mark.asyncio

QUERY = "Adam Beyer Your Mind"
ORIGINAL = track_payload(mix_name="Original Mix")
BANDCAMP_URL = "https://adambeyer.bandcamp.com/track/your-mind"
ON_BANDCAMP = track_payload(id="42", source="bandcamp", mix_name=None, url=BANDCAMP_URL)


def _music(tmp_path: Path) -> Path:
    folder = tmp_path / "music"
    tagged_mp3(folder, "your mind.mp3", "Adam Beyer", "Your Mind")
    return folder


async def test_validates_automatically_on_beatport_without_calling_bandcamp(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    api.on("/beatport/search", QUERY, found(ORIGINAL))
    api.on(
        "/beatport/tracks/17492013",
        "*",
        ok(track_payload(mix_name="Original Mix", isrc="REFETCHED")),
    )

    result = await run(_music(tmp_path), api)

    record = result.tracks[0]
    assert (record.state, record.resolution, record.source) == (
        TrackState.RESOLVED,
        Resolution.AUTO,
        Source.BEATPORT,
    )
    assert record.candidate is not None
    assert record.candidate.isrc == "REFETCHED"
    assert record.artwork is not None
    assert not any(path.startswith("/bandcamp") for path in api.paths())


async def test_validates_automatically_on_bandcamp_after_an_empty_beatport_search(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    api.on("/bandcamp/search", QUERY, found(ON_BANDCAMP))

    result = await run(_music(tmp_path), api)

    record = result.tracks[0]
    assert (record.state, record.resolution, record.source) == (
        TrackState.RESOLVED,
        Resolution.AUTO,
        Source.BANDCAMP,
    )


async def test_puts_a_grey_zone_track_on_hold_without_resolving_it(tmp_path: Path) -> None:
    api = FakeApi()
    extended = track_payload(id="1", mix_name="Extended Mix")
    radio = track_payload(id="2", mix_name="Radio Edit")
    api.on("/beatport/search", QUERY, found(extended, radio))

    result = await run(_music(tmp_path), api)

    record = result.tracks[0]
    assert record.state is None
    assert record.arbitration is not None
    assert record.arbitration.source is Source.BEATPORT
    assert [entry.candidate.id for entry in record.arbitration.candidates] == ["1", "2"]


@pytest.mark.parametrize(
    ("status", "api_code"),
    [(503, "source_unavailable"), (404, "not_found")],
    ids=["unavailable", "off_contract"],
)
async def test_sends_bandcamp_candidates_to_arbitration_when_beatport_is_unavailable(
    tmp_path: Path, status: int, api_code: str
) -> None:
    """Un 404 en recherche est une derive de l'API, traitee comme une panne de la source."""
    api = FakeApi()
    api.on("/beatport/search", "*", failing(status, api_code))
    api.on("/bandcamp/search", QUERY, found(ON_BANDCAMP))

    result = await run(_music(tmp_path), api)

    record = result.tracks[0]
    assert record.state is None
    assert record.arbitration is not None
    assert record.arbitration.source is Source.BANDCAMP
    assert record.arbitration.beatport_unavailable is True


async def test_marks_a_track_unknown_to_both_sources_as_no_result(tmp_path: Path) -> None:
    api = FakeApi()

    result = await run(_music(tmp_path), api)

    record = result.tracks[0]
    assert (record.state, record.resolution, record.failure_reason) == (
        TrackState.UNRESOLVED,
        Resolution.NONE,
        FailureReason.NO_RESULT,
    )


async def test_marks_a_track_whose_candidates_are_below_the_floor_as_below_threshold(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    stranger = track_payload(artists=[{"name": "Amelie Lens"}], title="Basiel")
    api.on("/beatport/search", QUERY, found(stranger))

    result = await run(_music(tmp_path), api)

    assert result.tracks[0].failure_reason is FailureReason.BELOW_THRESHOLD


async def test_marks_a_file_name_reduced_to_noise_as_empty_query_without_any_request(
    tmp_path: Path,
) -> None:
    folder = tmp_path / "music"
    folder.mkdir()
    write_blank_mp3(folder / "01 - [FREE DL].mp3")
    api = FakeApi()

    result = await run(folder, api)

    assert result.tracks[0].failure_reason is FailureReason.EMPTY_QUERY
    assert api.requests == []


@pytest.mark.parametrize(
    ("beatport", "bandcamp"),
    [
        ((503, "source_unavailable"), (504, "request_timeout")),
        ((404, "not_found"), (404, "not_found")),
    ],
    ids=["unavailable", "off_contract"],
)
async def test_marks_a_track_as_source_unavailable_when_both_sources_fail(
    tmp_path: Path, beatport: tuple[int, str], bandcamp: tuple[int, str]
) -> None:
    api = FakeApi()
    api.on("/beatport/search", "*", failing(*beatport))
    api.on("/bandcamp/search", "*", failing(*bandcamp))

    result = await run(_music(tmp_path), api)

    assert result.tracks[0].failure_reason is FailureReason.SOURCE_UNAVAILABLE


async def test_keeps_the_search_candidate_when_the_refetch_fails(tmp_path: Path) -> None:
    api = FakeApi()
    api.on("/beatport/search", QUERY, found(ORIGINAL))
    api.on("/beatport/tracks/17492013", "*", failing(503, "source_unavailable"))

    result = await run(_music(tmp_path), api)

    record = result.tracks[0]
    assert record.state is TrackState.RESOLVED
    assert record.candidate is not None
    assert record.candidate.isrc == ORIGINAL["isrc"]


async def test_resolves_a_track_without_artwork_when_the_cdn_refuses_it(tmp_path: Path) -> None:
    api = FakeApi()
    api.on("/beatport/search", QUERY, found(ORIGINAL))
    cdn = FakeCdn()
    release = ORIGINAL["release"]
    assert isinstance(release, dict)
    cdn.refused.add(str(release["artwork_url"]))

    result = await run(_music(tmp_path), api, cdn=cdn)

    record = result.tracks[0]
    assert record.state is TrackState.RESOLVED
    assert record.artwork is None


async def test_falls_back_on_the_file_name_when_the_tags_are_unreadable(tmp_path: Path) -> None:
    folder = tmp_path / "music"
    folder.mkdir()
    (folder / "Adam Beyer - Your Mind.mp3").write_bytes(b"not an audio file" * 16)
    api = FakeApi()
    api.on("/beatport/search", QUERY, found(ORIGINAL))

    result = await run(folder, api)

    record = result.tracks[0]
    assert record.state is TrackState.RESOLVED
    assert record.query is not None
    assert record.query.text == QUERY
