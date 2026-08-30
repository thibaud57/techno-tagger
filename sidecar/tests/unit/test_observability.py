"""Le durcissement du SDK Sentry est la seule protection de la vie privee, il se
teste donc comme du code metier (cf. ADR-014).
"""

from typing import TYPE_CHECKING, cast
from unittest.mock import patch

from tagger import APP_NAME
from tagger import observability as obs
from tagger.observability import MASK, _scrub, init_sentry

DSN = "https://key@o1.ingest.de.sentry.io/1"
RELEASE = "techno-tagger@1.0.0"

if TYPE_CHECKING:
    import pytest
    from sentry_sdk.types import Event, Hint


def test_dsn_vide_n_initialise_pas_le_sdk() -> None:
    with patch("sentry_sdk.init", autospec=True) as init:
        init_sentry("", RELEASE)

    init.assert_not_called()


def test_dsn_renseigne_pose_les_reglages_de_durcissement() -> None:
    with patch("sentry_sdk.init", autospec=True) as init:
        init_sentry(DSN, RELEASE)

    kwargs = init.call_args.kwargs
    assert kwargs["include_local_variables"] is False
    assert kwargs["server_name"] == APP_NAME
    assert kwargs["before_send"] is _scrub
    # Les deux canaux que level=None et sentry_logs_level=None doivent fermer :
    # sans eux, chemins et titres partent en breadcrumbs avec le prochain event.
    integration = kwargs["integrations"][0]
    assert integration._breadcrumb_handler is None
    assert integration._sentry_logs_handler is None
    assert kwargs["auto_enabling_integrations"] is False


def test_echec_d_initialisation_ne_remonte_pas(caplog: pytest.LogCaptureFixture) -> None:
    with patch(
        "sentry_sdk.init",
        autospec=True,
        side_effect=ImportError("backend absent du binaire fige"),
    ):
        init_sentry(DSN, RELEASE)

    assert "initialisation de Sentry impossible" in caplog.text


def test_le_scrubbing_masque_le_nom_d_utilisateur_a_toute_profondeur(
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
        "extra": {"tracks": 42},
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
        "extra": {"tracks": 42},
    }
