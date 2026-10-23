import httpx2
import pytest
from scraper_responses import (
    BANDCAMP_TRACK,
    SOUNDCLOUD_TRACK,
    Handler,
    answering,
    make_client,
    profile_payload,
    recording,
    soundcloud_track_payload,
    track_payload,
)

from tagger.resolution.scraper_client import Source, TrackNotFoundError, UnsupportedTrackUrlError

pytestmark = pytest.mark.asyncio


def _found(requests: list[httpx2.Request], source: Source) -> Handler:
    """Un 200 qui porte un `Track` de la source donnee."""
    return answering(requests, track_payload(source=source))


@pytest.mark.parametrize(
    "pasted",
    [
        "https://www.beatport.com/track/your-mind/99000202?utm_source=share",
        "https://beatport.com/track/your-mind/99000202",
        "https://www.beatport.com/fr/track/your-mind/99000202",
        "https://www.beatport.com/de/track/your-mind/99000202",
        "https://www.beatport.com/es/track/your-mind/99000202",
        "https://www.beatport.com/pt-br/track/your-mind/99000202/",
    ],
    ids=["www-with-query", "bare-host", "fr", "de", "es", "pt-br"],
)
async def test_resolves_a_beatport_url_through_the_track_id_route(
    requests: list[httpx2.Request], pasted: str
) -> None:
    async with make_client(_found(requests, Source.BEATPORT)) as client:
        candidate = await client.fetch_by_url(pasted)

    assert [request.url.path for request in requests] == ["/beatport/tracks/99000202"]
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
        "https://Jane-Doe.bandcamp.com/track/basiel",
        "http://jane-doe.bandcamp.com/track/basiel",
    ],
    ids=[
        "query-and-fragment",
        "trailing-slash",
        "surrounding-spaces",
        "uppercase-host",
        "http-scheme",
    ],
)
async def test_sends_a_bandcamp_url_in_its_single_normalised_form(
    requests: list[httpx2.Request], pasted: str
) -> None:
    """Une query fait rendre 422 a `/bandcamp/tracks`, pris pour un contrat casse ; le slash
    final, tolere par Bandcamp, part quand meme pour envoyer une forme unique."""
    async with make_client(_found(requests, Source.BANDCAMP)) as client:
        await client.fetch_by_url(pasted)

    assert requests[0].url.params["url"] == BANDCAMP_TRACK


@pytest.mark.parametrize(
    "pasted",
    [
        "https://jane-doe.bandcamp.com/album/basiel",
        "https://www.beatport.com/release/your-mind/9900030",
        "https://www.beatport.com/french/track/your-mind/99000202",
        "https://www.youtube.com/watch?v=abc",
        "www.beatport.com/track/your-mind/99000202",
        "ftp://jane-doe.bandcamp.com/track/basiel",
        "https://[beatport.com/track/your-mind/99000202",
        "",
        "https://soundcloud.com/acme-records/sets/acme-radio",
        "https://soundcloud.com/acme-records",
        "https://on.soundcloud.com/",
    ],
    ids=[
        "bandcamp-album",
        "beatport-release",
        "beatport-unknown-prefix",
        "unknown-host",
        "missing-scheme",
        "other-scheme",
        "malformed",
        "empty",
        "soundcloud-playlist",
        "soundcloud-profile",
        "soundcloud-short-link-without-code",
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


async def test_resolves_a_soundcloud_track_url_through_the_resolve_route_without_a_tracks_cursor(
    requests: list[httpx2.Request],
) -> None:
    async with make_client(answering(requests, soundcloud_track_payload())) as client:
        candidate = await client.fetch_by_url(SOUNDCLOUD_TRACK)

    assert requests[0].url.path == "/soundcloud/resolve"
    assert dict(requests[0].url.params) == {"url": SOUNDCLOUD_TRACK}
    assert candidate.source is Source.SOUNDCLOUD
    assert candidate.title == "Tarantula"


@pytest.mark.parametrize(
    ("pasted", "sent"),
    [
        ("https://www.soundcloud.com/acme-records/kasia-faithless-tarantula-2", SOUNDCLOUD_TRACK),
        (
            "https://m.soundcloud.com/acme-records/kasia-faithless-tarantula-2/?si=abc#t=1:23",
            SOUNDCLOUD_TRACK,
        ),
        ("https://On.SoundCloud.com/AbC123xYz?si=share", "https://on.soundcloud.com/AbC123xYz"),
    ],
    ids=["www", "mobile-with-query-and-slash", "short-link-keeping-the-code-case"],
)
async def test_sends_a_soundcloud_url_in_its_single_normalised_form(
    requests: list[httpx2.Request], pasted: str, sent: str
) -> None:
    """SoundCloud rend 404 sur `www.`, `m.` et un `/` final. Le code d'un lien court garde sa
    casse : seul l'hote passe en minuscules.
    """
    async with make_client(answering(requests, soundcloud_track_payload())) as client:
        await client.fetch_by_url(pasted)

    assert requests[0].url.params["url"] == sent


async def test_refuses_a_soundcloud_url_that_resolves_to_a_profile(
    requests: list[httpx2.Request],
) -> None:
    """Un lien court peut viser un compte : c'est un refus de saisie, pas un contrat casse."""
    async with make_client(answering(requests, profile_payload())) as client:
        with pytest.raises(UnsupportedTrackUrlError):
            await client.fetch_by_url("https://on.soundcloud.com/AbC123xYz")
