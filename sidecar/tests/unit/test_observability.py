"""Le durcissement du SDK Sentry est la seule protection de la vie privee, il se
teste donc comme du code metier (cf. ADR-014).
"""

from typing import TYPE_CHECKING, cast
from unittest.mock import patch

import httpx2
import pytest

from tagger import APP_NAME, RELEASE
from tagger import observability as obs
from tagger.observability import MASK, QUERY_MASK, _scrub, init_sentry
from tagger.scraper_client import ApiContractError

DSN = "https://key@o1.ingest.de.sentry.io/1"

if TYPE_CHECKING:
    from sentry_sdk.types import Event, Hint


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
    assert kwargs["include_local_variables"] is False
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

    assert "initialisation de Sentry impossible" in caplog.text


def test_scrubbing_masks_the_username_at_any_depth(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Le parcours doit atteindre les frames comme les champs libres : c'est la
    seule barriere une fois `include_local_variables` desactive.
    """
    monkeypatch.setattr(obs, "_HOME_FORMS", {r"C:\Users\thibaud", "C:/Users/thibaud"})
    monkeypatch.setattr(obs, "_USERNAME", "thibaud")
    event = {
        "exception": {
            "values": [
                {
                    "value": "cannot open C:/Users/thibaud/Music/set.flac",
                    "stacktrace": {"frames": [{"abs_path": r"C:\Users\thibaud\app\run.py"}]},
                }
            ]
        },
        "tags": {"user": "thibaud"},
        "extra": {r"C:\Users\thibaud\Music": "locked", "tracks": 42},
    }

    scrubbed = _scrub(cast("Event", event), cast("Hint", {}))

    assert scrubbed == {
        "exception": {
            "values": [
                {
                    "value": f"cannot open {MASK}/Music/set.flac",
                    "stacktrace": {"frames": [{"abs_path": rf"{MASK}\app\run.py"}]},
                }
            ]
        },
        "tags": {"user": MASK},
        "extra": {rf"{MASK}\Music": "locked", "tracks": 42},
    }


def _chained_contract_error(query: str) -> ApiContractError:
    """La chaine d'exceptions reelle d'une reponse hors contrat sur une recherche.

    Le message de `HTTPStatusError` est ecrit par httpx2 et porte l'URL entiere : le
    fabriquer a la main ne prouverait rien sur ce que le SDK remonterait vraiment.
    """
    request = httpx2.Request(
        "GET",
        "https://techno-scraper.empiricmind.fr/beatport/search",
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


def test_scrubbing_strips_the_search_query_a_chained_error_carries() -> None:
    """Un titre de morceau ne part jamais vers Sentry (ADR-014) : le SDK recopie le
    message de chaque exception de la chaine `__cause__`, et celui d'httpx2 porte
    l'URL de la recherche, donc l'artiste et le titre lus dans le fichier.
    """
    error = _chained_contract_error("Adam Beyer Your Mind")
    assert error.__cause__ is not None
    event = {
        "exception": {
            "values": [
                {"type": "HTTPStatusError", "value": str(error.__cause__)},
                {"type": "ApiContractError", "value": str(error)},
            ]
        }
    }

    scrubbed = _scrub(cast("Event", event), cast("Hint", {}))

    rendered = str(scrubbed)
    # Par fragment d'un seul mot : l'URL encode les espaces, « Adam Beyer » n'y
    # apparaitrait de toute facon pas tel quel et l'assertion passerait a vide.
    assert "Beyer" not in rendered
    assert "Mind" not in rendered
    assert QUERY_MASK in rendered
    assert "techno-scraper.empiricmind.fr/beatport/search" in rendered


def test_scrubbing_strips_a_query_that_carries_a_second_question_mark() -> None:
    """Le motif d'URL ne s'arrete pas au dernier `?` de la chaine mais au premier.

    Une valeur de parametre peut en porter un (une URL de redirection, un `Location`
    recopie dans un message) : masquer depuis le dernier laisserait passer la
    recherche elle-meme, donc l'artiste et le titre que l'ADR-014 interdit d'envoyer.
    """
    message = "HTTPStatusError for https://api/beatport/search?q=Beyer+Mind&next=http://cdn?w=1"
    event = {"exception": {"values": [{"type": "HTTPStatusError", "value": message}]}}

    scrubbed = _scrub(cast("Event", event), cast("Hint", {}))

    rendered = str(scrubbed)
    assert "Beyer" not in rendered
    assert "Mind" not in rendered
    assert QUERY_MASK in rendered


def test_scrubbing_leaves_envelope_fields_intact(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(obs, "_HOME_FORMS", {r"C:\Users\dev"})
    monkeypatch.setattr(obs, "_USERNAME", "dev")
    event = {"environment": "development", "level": "error", "release": RELEASE}

    scrubbed = _scrub(cast("Event", event), cast("Hint", {}))

    assert scrubbed == event
