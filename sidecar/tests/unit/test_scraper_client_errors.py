"""Tests de la traduction des reponses et de la nouvelle tentative reseau."""

import httpx2
import pytest
from scraper_responses import Handler, make_client, page_payload, recording, track_payload

from tagger.scraper_client import (
    ApiContractError,
    ApiKeyRejectedError,
    ScraperError,
    Source,
    SourceUnavailableError,
    TrackNotFoundError,
)

pytestmark = pytest.mark.asyncio


def _raising(requests: list[httpx2.Request], error: type[httpx2.TransportError]) -> Handler:
    def handler(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        raise error("transport failure", request=request)

    return handler


@pytest.mark.parametrize(
    ("status", "body", "expected"),
    [
        (403, {"detail": "Invalid API key"}, ApiKeyRejectedError),
        (400, {"code": "cursor_out_of_range"}, ApiContractError),
        (422, {"detail": []}, ApiContractError),
        (500, {"code": "internal_error"}, SourceUnavailableError),
        (502, {"code": "parse_error"}, SourceUnavailableError),
        (503, {"code": "source_unavailable"}, SourceUnavailableError),
        (504, {"code": "request_timeout"}, SourceUnavailableError),
    ],
    ids=[
        "key-rejected",
        "bad-request",
        "unprocessable",
        "api-crashed",
        "parse-error",
        "source-down",
        "api-timeout",
    ],
)
async def test_translates_each_status_without_retrying(
    requests: list[httpx2.Request],
    status: int,
    body: dict[str, object],
    expected: type[ScraperError],
) -> None:
    """La table de traduction du spec, ligne par ligne. Aucun statut recu ne se retente."""
    async with make_client(recording(requests, httpx2.Response(status, json=body))) as client:
        with pytest.raises(expected):
            await client.search(Source.BEATPORT, "Adam Beyer Your Mind")

    assert len(requests) == 1


async def test_raises_track_not_found_on_a_404_refetch(requests: list[httpx2.Request]) -> None:
    response = httpx2.Response(404, json={"code": "not_found", "provider": "beatport"})

    async with make_client(recording(requests, response)) as client:
        with pytest.raises(TrackNotFoundError):
            await client.fetch_beatport_track("999999999")

    assert len(requests) == 1


async def test_raises_api_contract_error_on_a_response_that_does_not_validate(
    requests: list[httpx2.Request],
) -> None:
    item = track_payload()
    del item["title"]
    response = httpx2.Response(200, json=page_payload(item))

    async with make_client(recording(requests, response)) as client:
        with pytest.raises(ApiContractError):
            await client.search(Source.BEATPORT, "Adam Beyer Your Mind")


async def test_carries_the_status_the_api_code_and_the_request_id(
    requests: list[httpx2.Request],
) -> None:
    response = httpx2.Response(
        504, json={"code": "request_timeout"}, headers={"X-Request-ID": "req-42"}
    )

    async with make_client(recording(requests, response)) as client:
        with pytest.raises(SourceUnavailableError) as error:
            await client.search(Source.BANDCAMP, "Amelie Lens Basiel")

    assert error.value.source is Source.BANDCAMP
    assert error.value.status == 504
    assert error.value.reason == "request_timeout"
    assert error.value.request_id == "req-42"


async def test_leaves_the_reason_empty_when_the_error_body_is_not_json(
    requests: list[httpx2.Request],
) -> None:
    response = httpx2.Response(503, text="<html><body>Bad Gateway</body></html>")

    async with make_client(recording(requests, response)) as client:
        with pytest.raises(SourceUnavailableError) as error:
            await client.search(Source.BEATPORT, "Adam Beyer Your Mind")

    assert error.value.reason == ""
    assert error.value.status == 503


@pytest.mark.parametrize(
    ("failure", "reason", "attempts"),
    [
        (httpx2.ConnectError, "network", 3),
        (httpx2.ReadTimeout, "timeout", 1),
        (httpx2.ProxyError, "transport", 1),
    ],
    ids=["network-retried", "timeout-not-retried", "transport-not-retried"],
)
async def test_reports_each_failure_that_got_no_response(
    requests: list[httpx2.Request],
    failure: type[httpx2.TransportError],
    reason: str,
    attempts: int,
) -> None:
    """Seule l'erreur reseau se retente, et le motif dit laquelle des trois a eu lieu."""
    async with make_client(_raising(requests, failure)) as client:
        with pytest.raises(SourceUnavailableError) as error:
            await client.search(Source.BEATPORT, "Adam Beyer Your Mind")

    assert error.value.reason == reason
    assert error.value.status is None
    assert len(requests) == attempts


async def test_returns_the_result_when_a_network_error_is_followed_by_a_success(
    requests: list[httpx2.Request],
) -> None:
    def flaky(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        if len(requests) < 3:
            raise httpx2.ConnectError("connection refused", request=request)
        return httpx2.Response(200, json=page_payload(track_payload()))

    async with make_client(flaky) as client:
        candidates = await client.search(Source.BEATPORT, "Adam Beyer Your Mind")

    assert len(candidates) == 1


async def test_waits_one_then_two_seconds_between_attempts(
    requests: list[httpx2.Request],
) -> None:
    waited: list[float] = []

    async def recording_sleep(delay: float) -> None:
        waited.append(delay)

    client = make_client(_raising(requests, httpx2.ConnectError), sleep=recording_sleep)
    async with client:
        with pytest.raises(SourceUnavailableError):
            await client.search(Source.BEATPORT, "Adam Beyer Your Mind")

    assert waited == [1.0, 2.0]
