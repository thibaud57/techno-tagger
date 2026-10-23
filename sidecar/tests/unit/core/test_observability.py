"""Le durcissement du SDK Sentry est la seule protection de la vie privee, il se
teste donc comme du code metier (cf. ADR-014).
"""

from typing import TYPE_CHECKING, Final, cast
from unittest.mock import patch

import httpx2
import pytest
from pydantic import TypeAdapter
from repo_files import read_json
from sentry_dsn import DSN

from tagger import APP_NAME, RELEASE
from tagger.core import observability as obs
from tagger.core.observability import (
    MASK,
    MESSAGE_MASK,
    PATH_MASK,
    _scrub,
    init_sentry,
)
from tagger.resolution.scraper_client import API_BASE_URL, ApiContractError

SEARCH_URL: Final = f"{API_BASE_URL}/beatport/search"
CONTRACT_ERROR_MODULE: Final = ApiContractError.__module__
PATH_MASK_CASES: Final = TypeAdapter(list[dict[str, str]]).validate_python(
    read_json("src/fixtures/path-masks.json")
)

if TYPE_CHECKING:
    from collections.abc import Mapping

    from sentry_sdk.types import Event, Hint


def _contract_entry(value: str) -> dict[str, object]:
    return {"type": ApiContractError.__name__, "module": CONTRACT_ERROR_MODULE, "value": value}


def _scrubbed(event: Mapping[str, object]) -> Event | None:
    return _scrub(cast("Event", event), cast("Hint", {}))


@pytest.fixture
def jane_home(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(obs, "_HOME_FORMS", {r"C:\Users\jane", "C:/Users/jane"})
    monkeypatch.setattr(obs, "_USERNAME", "jane")


def test_an_empty_dsn_does_not_initialise_the_sdk() -> None:
    with patch("sentry_sdk.init", autospec=True) as init:
        init_sentry("", RELEASE)

    init.assert_not_called()


def test_a_set_dsn_applies_the_hardening_settings() -> None:
    with (
        patch("sentry_sdk.init", autospec=True) as init,
        patch(
            "sentry_sdk.integrations.logging.LoggingIntegration", autospec=True
        ) as logging_integration,
    ):
        init_sentry(DSN, RELEASE)

    kwargs = init.call_args.kwargs
    assert "include_local_variables" not in kwargs
    assert kwargs["data_collection"]["stack_frame_variables"] is False
    assert kwargs["data_collection"]["user_info"] is False
    assert kwargs["server_name"] == APP_NAME
    assert kwargs["before_send"] is _scrub
    # On verifie l'appel a LoggingIntegration, pas les attributs prives de l'objet
    # que le SDK construit : ces trois arguments sont notre contrat, pas son rendu.
    logging_integration.assert_called_once_with(
        level=None, event_level=None, sentry_logs_level=None
    )
    assert kwargs["auto_enabling_integrations"] is False


def test_an_initialisation_failure_does_not_propagate(caplog: pytest.LogCaptureFixture) -> None:
    with patch(
        "sentry_sdk.init",
        autospec=True,
        side_effect=ImportError("backend absent du binaire fige"),
    ):
        init_sentry(DSN, RELEASE)

    assert "sentry initialization failed" in caplog.text


@pytest.mark.usefixtures("jane_home")
def test_scrubbing_masks_the_username_at_any_depth() -> None:
    """Le parcours doit atteindre les frames comme les champs libres : c'est la
    seule barriere une fois `include_local_variables` desactive.
    """
    event = {
        "exception": {
            "values": [
                {
                    **_contract_entry("cannot open C:/Users/jane/Music/set.flac"),
                    "stacktrace": {"frames": [{"abs_path": r"C:\Users\jane\app\run.py"}]},
                }
            ]
        },
        "tags": {"user": "jane"},
        "extra": {r"C:\Users\jane\Music": "locked", "tracks": 42},
    }

    scrubbed = _scrubbed(event)

    assert scrubbed == {
        "exception": {
            "values": [
                {
                    **_contract_entry(f"cannot open {PATH_MASK}"),
                    "stacktrace": {"frames": [{"abs_path": rf"{MASK}\app\run.py"}]},
                }
            ]
        },
        "tags": {"user": MASK},
        "extra": {PATH_MASK: "locked", "tracks": 42},
    }


@pytest.mark.usefixtures("jane_home")
def test_scrubbing_masks_the_track_under_the_home_folder_but_keeps_the_code_paths() -> None:
    """Le nom d'un morceau sous le dossier personnel ne sort pas, le chemin d'une frame garde
    sa trace : il ne porte que le compte de l'OS, masque, et sert a deboguer.
    """
    event = {
        "message": r"cannot open C:\Users\jane\Music\Nova Pulse - Your Mind.mp3",
        "frames": [{"abs_path": r"C:\Users\jane\AppData\Local\tagger\writing.py"}],
    }

    scrubbed = _scrubbed(event)

    assert scrubbed == {
        "message": f"cannot open {PATH_MASK}",
        "frames": [{"abs_path": rf"{MASK}\AppData\Local\tagger\writing.py"}],
    }


def _chained_contract_error(query: str) -> ApiContractError:
    """La chaine d'exceptions reelle d'une reponse hors contrat sur une recherche.

    Le message de `HTTPStatusError` est ecrit par httpx2 et porte l'URL entiere : le
    fabriquer a la main ne prouverait rien sur ce que le SDK remonterait vraiment.
    """
    request = httpx2.Request(
        "GET",
        SEARCH_URL,
        params={"q": query, "type": "tracks", "limit": "10"},
    )
    response = httpx2.Response(422, request=request)
    try:
        response.raise_for_status()
    except httpx2.HTTPStatusError as exc:
        error = ApiContractError("status 422", request_id="req-1")
        # Ce que `raise ... from exc` pose dans `scraper_client`, et ce que le SDK
        # remonte : `from` n'existe pas sur un `return`.
        error.__cause__ = exc
        return error
    pytest.fail("raise_for_status n'a pas leve sur un 422")


def test_scrubbing_leaves_no_search_query_from_a_chained_http_error() -> None:
    """Le message d'httpx2 porte l'URL de la recherche, donc l'artiste et le titre : hors de
    la liste fermee, il part en `<message>`. Le detail d'`ApiContractError` reste lisible.
    """
    error = _chained_contract_error("Adam Beyer Your Mind")
    assert error.__cause__ is not None
    event = {
        "exception": {
            "values": [
                {"type": "HTTPStatusError", "module": "httpx2", "value": str(error.__cause__)},
                _contract_entry(str(error)),
            ]
        }
    }

    scrubbed = _scrubbed(event)

    assert scrubbed == {
        "exception": {
            "values": [
                {"type": "HTTPStatusError", "module": "httpx2", "value": MESSAGE_MASK},
                _contract_entry("api contract broken: status 422"),
            ]
        }
    }


def test_scrubbing_leaves_envelope_fields_intact(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(obs, "_HOME_FORMS", {r"C:\Users\dev"})
    monkeypatch.setattr(obs, "_USERNAME", "dev")
    event = {"environment": "development", "level": "error", "release": RELEASE}

    scrubbed = _scrubbed(event)

    assert scrubbed == event


@pytest.mark.parametrize(
    ("message", "expected"),
    [(case["message"], case["expected"]) for case in PATH_MASK_CASES],
    ids=[case["case"] for case in PATH_MASK_CASES],
)
def test_scrubbing_masks_paths_and_queries_like_the_webview(message: str, expected: str) -> None:
    """Corpus partage avec `scrub.spec.ts` : le motif est recopie des deux cotes, seul ce
    corpus commun fait echouer la derive de l'un sans l'autre.
    """
    event = {"message": message}

    scrubbed = _scrubbed(event)

    assert scrubbed == {"message": expected}


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        (
            r"write failed D:\Music\Nova Pulse - Your Mind.mp3 run=abc reason=file_locked",
            f"write failed {PATH_MASK} run=abc reason=file_locked",
        ),
        (
            r"copy \\nas\share\Nova Pulse - Your Mind.mp3 status=error",
            f"copy {PATH_MASK} status=error",
        ),
        (
            r"skip D:\Music\Nova Pulse, Your Mind.mp3 reason=locked",
            f"skip {PATH_MASK} reason=locked",
        ),
        (
            r"skip D:\Music\Nova Pulse vol=2 - Your Mind.mp3 reason=locked",
            f"skip {PATH_MASK} reason=locked",
        ),
        (
            str(OSError(2, "No such file or directory", r"D:\Music\Nova Pulse - Don't Stop.mp3")),
            f'[Errno 2] No such file or directory: "{PATH_MASK}"',
        ),
    ],
    ids=[
        "logfmt-fields",
        "unc-field",
        "comma-in-name",
        "key-lookalike-in-name",
        "oserror-repr-with-apostrophe",
    ],
)
def test_scrubbing_stops_a_path_before_the_log_fields_without_leaking_the_name(
    message: str, expected: str
) -> None:
    """Le chemin garde ses espaces mais s'arrete avant `run=`, `reason=` ou `: `,
    sans jamais laisser une partie du nom de fichier.
    """
    event = {"message": message}

    scrubbed = _scrubbed(event)

    assert scrubbed == {"message": expected}
    assert not {"Nova", "Pulse", "Your", "Mind", "Don't", "Stop.mp3"} & set(
        str(scrubbed).replace(",", " ").replace('"', " ").split()
    )


@pytest.mark.parametrize(
    ("type_name", "module", "value"),
    [
        ("TagsWriteError", "tagger.tags.files", "tags not written: Nova Pulse - Your Mind.mp3"),
        ("KeyError", None, "'Albums/Nova Pulse - Your Mind.mp3'"),
        ("ValidationError", "pydantic_core._pydantic_core", "input_value='Your Mind'"),
    ],
    ids=["own-error-with-file-name", "key-error-on-track-id", "pydantic-input-value"],
)
def test_scrubbing_masks_the_message_of_an_exception_outside_the_closed_list(
    type_name: str, module: str | None, value: str
) -> None:
    """Le texte libre ne permet pas de reconnaitre un titre : seul un type declare sans
    donnee garde son message. Type, module et pile partent toujours. Le SDK pose `module` a
    `None` pour un builtin.
    """
    entry: dict[str, object] = {
        "type": type_name,
        "module": module,
        "value": value,
        "stacktrace": {"frames": []},
    }
    event = {"exception": {"values": [entry]}}

    scrubbed = _scrubbed(event)

    assert scrubbed == {"exception": {"values": [{**entry, "value": MESSAGE_MASK}]}}


@pytest.mark.usefixtures("jane_home")
def test_scrubbing_keeps_the_message_of_a_closed_list_type_with_paths_masked() -> None:
    event = {"exception": {"values": [_contract_entry(r"TrackPage under C:\Users\jane\x.json")]}}

    scrubbed = _scrubbed(event)

    assert scrubbed == {"exception": {"values": [_contract_entry(f"TrackPage under {PATH_MASK}")]}}


def test_scrubbing_masks_a_closed_list_name_raised_from_another_module() -> None:
    entry = {"type": ApiContractError.__name__, "module": "vendor.client", "value": "Your Mind"}
    event = {"exception": {"values": [entry]}}

    scrubbed = _scrubbed(event)

    assert scrubbed == {"exception": {"values": [{**entry, "value": MESSAGE_MASK}]}}


def test_scrubbing_keeps_a_closed_list_message_when_the_account_name_is_part_of_its_module(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Le masquage du compte de l'OS reecrit `module` : la liste se juge avant lui."""
    monkeypatch.setattr(obs, "_USERNAME", "client")
    entry = _contract_entry("api contract broken: TrackPage: items.*.bpm int_parsing")
    event = {"exception": {"values": [entry]}}

    scrubbed = _scrubbed(event)

    module = CONTRACT_ERROR_MODULE.removesuffix("client") + MASK
    assert scrubbed == {"exception": {"values": [{**entry, "module": module}]}}
