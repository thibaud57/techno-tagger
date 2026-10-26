from typing import TYPE_CHECKING

import pytest
from audio_samples import write_blank_mp3, write_not_audio
from cdn_doubles import FakeCdn
from scraper_responses import (
    ARTWORK_URL,
    BANDCAMP_SEARCH,
    BEATPORT_SEARCH,
    YOUR_MIND,
    failing,
    found,
    ok,
    track_payload,
)
from tagging_api import (
    ON_BANDCAMP,
    ORIGINAL,
    ORIGINAL_REFETCH,
    FakeApi,
    basiel,
    beatport_down,
    hold_on_beatport,
    knows_your_mind,
    must_be,
    one_track,
    run,
)

from tagger.resolution.scraper_client import Source
from tagger.run.models import (
    AwaitingArbitration,
    FailureReason,
    Resolution,
    Resolved,
    TrackState,
)

if TYPE_CHECKING:
    from pathlib import Path

pytestmark = pytest.mark.asyncio


async def test_validates_automatically_on_beatport_without_calling_bandcamp(tmp_path: Path) -> None:
    api = FakeApi()
    knows_your_mind(api)
    api.on(
        ORIGINAL_REFETCH,
        "*",
        ok(track_payload(mix_name="Original Mix", isrc="REFETCHED")),
    )

    result = await run(one_track(tmp_path), api)

    record = must_be(result.tracks[0], Resolved)
    retained = record.outcome.retained
    assert (record.state, retained.resolution, retained.source) == (
        TrackState.RESOLVED,
        Resolution.AUTO,
        Source.BEATPORT,
    )
    assert retained.candidate.isrc == "REFETCHED"
    assert retained.artwork is not None
    assert not any(path.startswith("/bandcamp") for path in api.paths())


async def test_validates_automatically_on_bandcamp_after_an_empty_beatport_search(
    tmp_path: Path,
) -> None:
    api = FakeApi()
    api.on(BANDCAMP_SEARCH, YOUR_MIND, found(ON_BANDCAMP))

    result = await run(one_track(tmp_path), api)

    record = must_be(result.tracks[0], Resolved)
    retained = record.outcome.retained
    assert (record.state, retained.resolution, retained.source) == (
        TrackState.RESOLVED,
        Resolution.AUTO,
        Source.BANDCAMP,
    )


async def test_puts_a_grey_zone_track_on_hold_without_resolving_it(tmp_path: Path) -> None:
    api = FakeApi()
    hold_on_beatport(api)

    result = await run(one_track(tmp_path), api)

    pending = must_be(result.tracks[0], AwaitingArbitration).outcome.pending
    assert pending.source is Source.BEATPORT
    assert [entry.candidate.id for entry in pending.candidates] == ["1", "2"]


@pytest.mark.parametrize(
    ("status", "api_code"),
    [(503, "source_unavailable"), (404, "not_found")],
    ids=["unavailable", "off-contract"],
)
async def test_sends_bandcamp_candidates_to_arbitration_when_beatport_is_unavailable(
    tmp_path: Path, status: int, api_code: str
) -> None:
    """Un 404 en recherche est une derive de l'API, traitee comme une panne de la source."""
    api = FakeApi()
    beatport_down(api, status, api_code)

    result = await run(one_track(tmp_path), api)

    pending = must_be(result.tracks[0], AwaitingArbitration).outcome.pending
    assert pending.source is Source.BANDCAMP
    assert pending.beatport_unavailable is True


async def test_marks_a_track_unknown_to_both_sources_as_no_result(tmp_path: Path) -> None:
    api = FakeApi()

    result = await run(one_track(tmp_path), api)

    record = result.tracks[0]
    assert (record.state, record.resolution, record.failure_reason) == (
        TrackState.UNRESOLVED,
        Resolution.NONE,
        FailureReason.NO_RESULT,
    )


@pytest.mark.parametrize("search", [BEATPORT_SEARCH, BANDCAMP_SEARCH], ids=["beatport", "bandcamp"])
async def test_marks_a_track_whose_candidates_are_below_the_floor_as_below_threshold(
    tmp_path: Path, search: str
) -> None:
    api = FakeApi()
    api.on(search, YOUR_MIND, found(basiel()))

    result = await run(one_track(tmp_path), api)

    assert result.tracks[0].failure_reason is FailureReason.BELOW_THRESHOLD


async def test_marks_a_file_name_reduced_to_noise_as_empty_query_without_any_request(
    music_folder: Path,
) -> None:
    write_blank_mp3(music_folder / "01 - [FREE DL].mp3")
    api = FakeApi()

    result = await run(music_folder, api)

    assert result.tracks[0].failure_reason is FailureReason.EMPTY_QUERY
    assert api.requests == []


@pytest.mark.parametrize(
    ("beatport", "bandcamp"),
    [
        ((503, "source_unavailable"), (504, "request_timeout")),
        ((404, "not_found"), (404, "not_found")),
    ],
    ids=["unavailable", "off-contract"],
)
async def test_marks_a_track_as_source_unavailable_when_both_sources_fail(
    tmp_path: Path, beatport: tuple[int, str], bandcamp: tuple[int, str]
) -> None:
    api = FakeApi()
    api.on(BEATPORT_SEARCH, "*", failing(*beatport))
    api.on(BANDCAMP_SEARCH, "*", failing(*bandcamp))

    result = await run(one_track(tmp_path), api)

    assert result.tracks[0].failure_reason is FailureReason.SOURCE_UNAVAILABLE


@pytest.mark.parametrize("bandcamp_candidates", [(), (basiel(),)], ids=["empty", "below-the-floor"])
async def test_marks_a_track_as_source_unavailable_when_beatport_is_down_and_bandcamp_finds_nothing(
    tmp_path: Path, bandcamp_candidates: tuple[dict[str, object], ...]
) -> None:
    """Beatport n'a pas repondu : rien n'est tranche, la reprise doit rejouer le morceau."""
    api = FakeApi()
    api.on(BEATPORT_SEARCH, "*", failing(504, "request_timeout"))
    api.on(BANDCAMP_SEARCH, "*", found(*bandcamp_candidates))

    result = await run(one_track(tmp_path), api)

    record = result.tracks[0]
    assert (record.state, record.failure_reason) == (
        TrackState.UNRESOLVED,
        FailureReason.SOURCE_UNAVAILABLE,
    )


async def test_keeps_the_search_candidate_when_the_refetch_fails(tmp_path: Path) -> None:
    api = FakeApi()
    knows_your_mind(api)
    api.on(ORIGINAL_REFETCH, "*", failing(503, "source_unavailable"))

    result = await run(one_track(tmp_path), api)

    retained = must_be(result.tracks[0], Resolved).outcome.retained
    assert retained.candidate.isrc == ORIGINAL["isrc"]


async def test_resolves_a_track_without_artwork_when_the_cdn_refuses_it(tmp_path: Path) -> None:
    api = FakeApi()
    knows_your_mind(api)
    cdn = FakeCdn()
    cdn.refused.add(ARTWORK_URL)

    result = await run(one_track(tmp_path), api, cdn=cdn)

    assert must_be(result.tracks[0], Resolved).outcome.retained.artwork is None


async def test_falls_back_on_the_file_name_when_the_tags_are_unreadable(music_folder: Path) -> None:
    write_not_audio(music_folder / "Adam Beyer - Your Mind.mp3")
    api = FakeApi()
    knows_your_mind(api)

    result = await run(music_folder, api)

    record = result.tracks[0]
    assert record.state is TrackState.RESOLVED
    assert record.query is not None
    assert record.query.text == YOUR_MIND
