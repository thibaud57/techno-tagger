"""Tests de la resolution d'une URL de morceau collee par l'utilisateur."""

import httpx2
import pytest
from scraper_responses import (
    BANDCAMP_TRACK,
    SOUNDCLOUD_TRACK,
    Handler,
    make_client,
    profile_payload,
    recording,
    soundcloud_track_payload,
    track_payload,
)

from tagger.scraper_client import Source, TrackNotFoundError, UnsupportedTrackUrlError

pytestmark = pytest.mark.asyncio


def _response(requests: list[httpx2.Request], body: dict[str, object]) -> Handler:
    """Un 200 qui porte le corps donne, chaque requete notee."""
    return recording(requests, httpx2.Response(200, json=body))


def _found(requests: list[httpx2.Request], source: Source) -> Handler:
    """Un 200 qui porte un `Track` de la source donnee."""
    return _response(requests, track_payload(source=source))


@pytest.mark.parametrize(
    "pasted",
    [
        "https://www.beatport.com/track/your-mind/22708005?utm_source=share",
        "https://beatport.com/track/your-mind/22708005",
    ],
    ids=["www-with-query", "bare-host"],
)
async def test_resolves_a_beatport_url_through_the_track_id_route(
    requests: list[httpx2.Request], pasted: str
) -> None:
    async with make_client(_found(requests, Source.BEATPORT)) as client:
        candidate = await client.fetch_by_url(pasted)

    assert [request.url.path for request in requests] == ["/beatport/tracks/22708005"]
    assert candidate.source is Source.BEATPORT


async def test_resolves_a_bandcamp_track_url_through_the_bandcamp_track_route(
    requests: list[httpx2.Request],
) -> None:
    async with make_client(_found(requests, Source.BANDCAMP)) as client:
        candidate = await client.fetch_by_url(BANDCAMP_TRACK)

    assert requests[0].url.path == "/bandcamp/tracks"
    assert dict(requests[0].url.params) == {"url": BANDCAMP_TRACK}
    assert candidate.source is Source.BANDCAMP


@pytest.mark.parametrize(
    "pasted",
    [
        f"{BANDCAMP_TRACK}?from=search#lyrics",
        f"{BANDCAMP_TRACK}/",
        f"  {BANDCAMP_TRACK} \n",
    ],
    ids=["query-and-fragment", "trailing-slash", "surrounding-spaces"],
)
async def test_drops_the_query_string_the_fragment_and_the_trailing_slash_before_sending(
    requests: list[httpx2.Request], pasted: str
) -> None:
    """Une query fait rendre 422 a `/bandcamp/tracks`, pris pour un contrat casse ; le slash
    final, tolere par Bandcamp, part quand meme pour envoyer une forme unique."""
    async with make_client(_found(requests, Source.BANDCAMP)) as client:
        await client.fetch_by_url(pasted)

    assert requests[0].url.params["url"] == BANDCAMP_TRACK


async def test_lowercases_the_host(requests: list[httpx2.Request]) -> None:
    async with make_client(_found(requests, Source.BANDCAMP)) as client:
        await client.fetch_by_url("https://AmelieLens.bandcamp.com/track/basiel")

    assert requests[0].url.params["url"] == BANDCAMP_TRACK


async def test_rewrites_an_http_url_to_https(requests: list[httpx2.Request]) -> None:
    async with make_client(_found(requests, Source.BANDCAMP)) as client:
        await client.fetch_by_url("http://amelielens.bandcamp.com/track/basiel")

    assert requests[0].url.params["url"] == BANDCAMP_TRACK


@pytest.mark.parametrize(
    "pasted",
    [
        "https://amelielens.bandcamp.com/album/basiel",
        "https://www.beatport.com/release/your-mind/4200000",
        "https://www.beatport.com/fr/track/your-mind/22708005",
        "https://www.youtube.com/watch?v=abc",
        "www.beatport.com/track/your-mind/22708005",
        "ftp://amelielens.bandcamp.com/track/basiel",
        "https://[beatport.com/track/your-mind/22708005",
        "",
    ],
    ids=[
        "bandcamp-album",
        "beatport-release",
        "beatport-language-prefix",
        "unknown-host",
        "missing-scheme",
        "other-scheme",
        "malformed",
        "empty",
    ],
)
async def test_refuses_an_url_that_is_not_a_track_without_sending_any_request(
    requests: list[httpx2.Request], pasted: str
) -> None:
    async with make_client(_found(requests, Source.BEATPORT)) as client:
        with pytest.raises(UnsupportedTrackUrlError):
            await client.fetch_by_url(pasted)

    assert requests == []


async def test_keeps_the_pasted_url_out_of_the_refusal(requests: list[httpx2.Request]) -> None:
    """L'URL peut nommer l'artiste et le morceau : aucun titre ne part sans geste manuel."""
    async with make_client(_found(requests, Source.BEATPORT)) as client:
        with pytest.raises(UnsupportedTrackUrlError) as refusal:
            await client.fetch_by_url("https://www.youtube.com/watch?v=adam-beyer-your-mind")

    assert refusal.value.code == "unsupported_url"
    assert refusal.value.params == {}


async def test_raises_track_not_found_when_the_api_answers_404_for_a_well_formed_url(
    requests: list[httpx2.Request],
) -> None:
    body = {"code": "not_found", "provider": "bandcamp", "request_id": "r-404"}

    async with make_client(recording(requests, httpx2.Response(404, json=body))) as client:
        with pytest.raises(TrackNotFoundError):
            await client.fetch_by_url(BANDCAMP_TRACK)


def _soundcloud(requests: list[httpx2.Request], body: dict[str, object]) -> Handler:
    return _response(requests, body)


async def test_resolves_a_soundcloud_track_url_through_the_resolve_route_without_a_tracks_cursor(
    requests: list[httpx2.Request],
) -> None:
    async with make_client(_soundcloud(requests, soundcloud_track_payload())) as client:
        candidate = await client.fetch_by_url(SOUNDCLOUD_TRACK)

    assert requests[0].url.path == "/soundcloud/resolve"
    assert dict(requests[0].url.params) == {"url": SOUNDCLOUD_TRACK}
    assert candidate.source is Source.SOUNDCLOUD
    assert candidate.title == "Tarantula"


async def test_sends_a_soundcloud_short_link_to_the_resolve_route(
    requests: list[httpx2.Request],
) -> None:
    """Le code du lien court garde sa casse : seul l'hote passe en minuscules."""
    async with make_client(_soundcloud(requests, soundcloud_track_payload())) as client:
        await client.fetch_by_url("https://On.SoundCloud.com/AbC123xYz?si=share")

    assert requests[0].url.params["url"] == "https://on.soundcloud.com/AbC123xYz"


@pytest.mark.parametrize(
    "pasted",
    [
        "https://www.soundcloud.com/drumcode/kasia-faithless-tarantula-2",
        "https://m.soundcloud.com/drumcode/kasia-faithless-tarantula-2/?si=abc#t=1:23",
    ],
    ids=["www", "mobile-with-query-and-slash"],
)
async def test_rewrites_the_www_and_mobile_soundcloud_hosts(
    requests: list[httpx2.Request], pasted: str
) -> None:
    """SoundCloud rend 404 sur `www.`, `m.` et un `/` final."""
    async with make_client(_soundcloud(requests, soundcloud_track_payload())) as client:
        await client.fetch_by_url(pasted)

    assert requests[0].url.params["url"] == SOUNDCLOUD_TRACK


@pytest.mark.parametrize(
    "pasted",
    [
        "https://soundcloud.com/drumcode/sets/drumcode-radio",
        "https://soundcloud.com/drumcode",
        "https://on.soundcloud.com/",
    ],
    ids=["playlist", "profile", "short-link-without-code"],
)
async def test_refuses_a_soundcloud_url_that_is_not_a_track_without_sending_any_request(
    requests: list[httpx2.Request], pasted: str
) -> None:
    async with make_client(_soundcloud(requests, soundcloud_track_payload())) as client:
        with pytest.raises(UnsupportedTrackUrlError):
            await client.fetch_by_url(pasted)

    assert requests == []


async def test_refuses_a_soundcloud_url_that_resolves_to_a_profile(
    requests: list[httpx2.Request],
) -> None:
    """Un lien court peut viser un compte : c'est un refus de saisie, pas un contrat casse."""
    async with make_client(_soundcloud(requests, profile_payload())) as client:
        with pytest.raises(UnsupportedTrackUrlError):
            await client.fetch_by_url("https://on.soundcloud.com/AbC123xYz")
