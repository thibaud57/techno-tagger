"""Un crash survenu pendant le parsing doit deja etre traçable : logging et Sentry
sont donc armes avant que la boucle de commandes ne lise quoi que ce soit.
"""

import io
import sys
from pathlib import Path
from typing import TYPE_CHECKING
from unittest.mock import patch

from tagger import BUNDLE_IDENTIFIER, __main__

if TYPE_CHECKING:
    import pytest


def test_logging_et_sentry_sont_armes_avant_la_boucle() -> None:
    with (
        patch.object(__main__, "setup_logging", autospec=True) as setup,
        patch.object(__main__, "init_sentry", autospec=True) as sentry,
        patch("sys.stdin", io.StringIO("")),
    ):
        __main__.main()

    setup.assert_called_once()
    sentry.assert_called_once()


def test_les_flux_du_protocole_sont_forces_en_utf8(monkeypatch: pytest.MonkeyPatch) -> None:
    """Tauri lance le sidecar avec des pipes, que Windows ouvre en cp1252 : un seul
    titre hors latin-1 tuerait le run des la premiere ligne lue ou ecrite.
    """
    stdin = io.TextIOWrapper(io.BytesIO(b""), encoding="cp1252")
    stdout = io.TextIOWrapper(io.BytesIO(), encoding="cp1252")
    monkeypatch.setattr(sys, "stdin", stdin)
    monkeypatch.setattr(sys, "stdout", stdout)

    __main__._force_utf8_streams()

    assert stdin.encoding == "utf-8"
    assert stdout.encoding == "utf-8"


def test_le_dossier_de_logs_suit_l_identifiant_de_bundle(monkeypatch: pytest.MonkeyPatch) -> None:
    """Tauri compose `appLocalDataDir()` avec l'identifiant du bundle, pas avec le
    nom de l'application : le sidecar ecrirait sinon hors des scopes de la webview.
    """
    monkeypatch.setenv("LOCALAPPDATA", "C:/Users/x/AppData/Local")

    assert __main__.log_dir() == Path("C:/Users/x/AppData/Local") / BUNDLE_IDENTIFIER / "logs"
