"""Ce que le SDK envoie reellement : la seule preuve que rien de personnel ne part (ADR-014).

Le vrai `sentry_sdk.init`, appele par `init_sentry`, avec un transport qui retient l'enveloppe
au lieu de l'envoyer : aucun reseau, aucun quota. Les valeurs sensibles viennent des
constantes ci-dessous ou des helpers : le SDK joint cinq lignes de source par frame, un titre
ecrit pres d'une frame qui leve ferait echouer le test sur sa propre source. Pour la meme
raison, une valeur attendue ne s'asserte jamais par sa presence dans le texte de l'enveloppe :
on lit le champ de l'evenement.
"""

import functools
from pathlib import Path
from typing import TYPE_CHECKING, Final, override

import httpx2
import pytest
import sentry_sdk
from pydantic import ValidationError
from scraper_responses import (
    YOUR_MIND,
    make_client,
    recording,
    track_payload,
)
from sentry_sdk.transport import Transport

from tagger import APP_NAME, RELEASE
from tagger.core.file_failures import FileFailureReason
from tagger.core.observability import MESSAGE_MASK, capture_unexpected, init_sentry
from tagger.resolution.scraper_client import ApiContractError, Source
from tagger.tags.files import TagsWriteError

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator

    from sentry_sdk.envelope import Envelope
    from sentry_sdk.types import Event

DSN: Final = "https://key@o1.ingest.de.sentry.io/1"
API_KEY: Final = "tt-fake-0000-0000"
TRACK_ID: Final = "Albums/Nova Pulse - Your Mind.mp3"
TRACK_PATH: Final = Path(r"D:\Musique") / TRACK_ID
# Artiste, titre, label et nom de fichier des fixtures : aucun ne doit partir.
FRAGMENTS: Final = ("Beyer", "Your Mind", "Drumcode", "Nova Pulse", API_KEY)
# Entrees de `data_collection` resolu qui ne sont pas des categories de collecte : le drapeau
# `provided_by_user` (pose a True par le SDK quand l'option est passee) et `frame_context_lines`
# (lignes de ce depot public).
NOT_COLLECTING: Final = frozenset({"provided_by_user", "frame_context_lines"})


class _RetainingTransport(Transport):
    """Retient chaque enveloppe au lieu de l'envoyer."""

    def __init__(self) -> None:
        super().__init__()
        self.envelopes: list[Envelope] = []

    @override
    def capture_envelope(self, envelope: Envelope) -> None:
        self.envelopes.append(envelope)


@pytest.fixture
def sent(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[Envelope]]:
    transport = _RetainingTransport()
    monkeypatch.setattr(sentry_sdk, "init", functools.partial(sentry_sdk.init, transport=transport))
    init_sentry(DSN, RELEASE)

    yield transport.envelopes

    sentry_sdk.get_client().close()
    sentry_sdk.get_global_scope().set_client(None)
    assert not sentry_sdk.get_client().is_active()


def _rendered(envelopes: list[Envelope]) -> str:
    sentry_sdk.flush()
    return b"".join(envelope.serialize() for envelope in envelopes).decode("utf-8")


def _event(envelopes: list[Envelope]) -> Event:
    sentry_sdk.flush()
    event = envelopes[0].get_event()
    assert event is not None
    return event


def _entries(envelopes: list[Envelope]) -> dict[str, dict[str, object]]:
    """Entrees de `exception.values`, par nom de type."""
    return {entry["type"]: entry for entry in _event(envelopes)["exception"]["values"]}


def _frames(event: Event) -> list[dict[str, object]]:
    return [
        frame
        for entry in event["exception"]["values"]
        for frame in entry.get("stacktrace", {}).get("frames", [])
    ]


def _collects(value: object) -> bool:
    """Vrai si la valeur resolue d'une categorie laisse passer une donnee."""
    match value:
        case bool():
            return value
        case list():
            return bool(value)
        case {"mode": str() as mode}:
            return mode != "off"
        case dict():
            return any(_collects(item) for item in value.values())
        case _:
            return True


async def _broken_contract(requests: list[httpx2.Request], item: object) -> ApiContractError:
    response = httpx2.Response(200, json={"items": [item], "next_cursor": None})
    async with make_client(recording(requests, response)) as client:
        with pytest.raises(ApiContractError) as error:
            await client.search(Source.BEATPORT, YOUR_MIND)

    return error.value


def _write_failed() -> None:
    """Deux variables locales sensibles et inutilisees : elles ne doivent pas partir."""
    title = YOUR_MIND  # noqa: F841
    api_key = API_KEY  # noqa: F841
    raise TagsWriteError(TRACK_PATH, FileFailureReason.FILE_LOCKED)


def _unknown_track() -> None:
    track_id = TRACK_ID
    raise KeyError(track_id)


def _task_group_failed() -> None:
    raise ExceptionGroup(
        "unhandled errors in a TaskGroup",
        [TagsWriteError(TRACK_PATH, FileFailureReason.FILE_LOCKED)],
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "item",
    [
        track_payload(bpm=YOUR_MIND),
        track_payload(artists=[{"id": "1", "kind": YOUR_MIND}]),
        YOUR_MIND,
    ],
    ids=["field-of-wrong-type", "required-field-missing", "item-not-an-object"],
)
async def test_a_contract_break_sends_no_fragment_of_the_response(
    sent: list[Envelope], requests: list[httpx2.Request], item: object
) -> None:
    error = await _broken_contract(requests, item)

    capture_unexpected(error)

    rendered = _rendered(sent)
    assert not [fragment for fragment in FRAGMENTS if fragment in rendered]
    assert MESSAGE_MASK in [entry["value"] for entry in _event(sent)["exception"]["values"]]


@pytest.mark.asyncio
async def test_a_contract_break_keeps_the_failing_field_locations(
    sent: list[Envelope], requests: list[httpx2.Request]
) -> None:
    error = await _broken_contract(requests, track_payload(bpm=YOUR_MIND))

    capture_unexpected(error)

    contract = _entries(sent)[ApiContractError.__name__]
    assert contract["value"] == "api contract broken: TrackPage: items.*.bpm int_parsing"


@pytest.mark.asyncio
async def test_a_contract_break_keeps_the_type_module_and_stack_of_the_chained_error(
    sent: list[Envelope], requests: list[httpx2.Request]
) -> None:
    error = await _broken_contract(requests, track_payload(bpm=YOUR_MIND))

    capture_unexpected(error)

    chained = _entries(sent)[ValidationError.__name__]
    assert (chained["module"], chained["value"]) == (ValidationError.__module__, MESSAGE_MASK)
    assert chained["stacktrace"]


@pytest.mark.parametrize(
    ("raising", "error_type", "module"),
    [
        (_write_failed, TagsWriteError, TagsWriteError.__module__),
        (_unknown_track, KeyError, None),
    ],
    ids=["own-error-with-file-name", "key-error"],
)
def test_an_error_carrying_a_file_name_sends_its_shape_but_no_fragment(
    sent: list[Envelope],
    raising: Callable[[], None],
    error_type: type[Exception],
    module: str | None,
) -> None:
    with pytest.raises(error_type) as error:
        raising()

    capture_unexpected(error.value)

    rendered = _rendered(sent)
    entry = _entries(sent)[error_type.__name__]
    assert not [fragment for fragment in FRAGMENTS if fragment in rendered]
    assert (entry["module"], entry["value"]) == (module, MESSAGE_MASK)
    assert entry["stacktrace"]


def test_an_exception_group_sends_no_fragment_of_its_members(sent: list[Envelope]) -> None:
    with pytest.raises(ExceptionGroup) as error:
        _task_group_failed()

    capture_unexpected(error.value)

    rendered = _rendered(sent)
    values = [entry["value"] for entry in _event(sent)["exception"]["values"]]
    assert not [fragment for fragment in FRAGMENTS if fragment in rendered]
    assert values == [MESSAGE_MASK, MESSAGE_MASK]


def test_the_envelope_carries_no_frame_variable_and_a_fixed_server_name(
    sent: list[Envelope],
) -> None:
    with pytest.raises(TagsWriteError) as error:
        _write_failed()

    capture_unexpected(error.value)

    event = _event(sent)
    assert _frames(event)
    assert not [frame for frame in _frames(event) if "vars" in frame]
    assert event["server_name"] == APP_NAME


@pytest.mark.usefixtures("sent")
def test_the_resolved_data_collection_closes_every_category_but_source_context() -> None:
    """Sous `data_collection`, une categorie omise est collectee : une montee du SDK qui en
    ajoute une (`mcp` est annoncee dans getsentry/sentry-python#7750, ouverte au 2026-10-15)
    casse ce test au lieu de partir ouverte. La fermer dans `init_sentry`.
    """
    resolved = dict(sentry_sdk.get_client().options["data_collection"])

    opened = {
        name: value
        for name, value in resolved.items()
        if name not in NOT_COLLECTING and _collects(value)
    }

    assert opened == {}
