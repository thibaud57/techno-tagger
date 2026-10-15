from pathlib import Path
from typing import TYPE_CHECKING

from tagger import BUNDLE_IDENTIFIER
from tagger.core.paths import app_data_dir, extended_path, log_dir

if TYPE_CHECKING:
    import pytest


def test_puts_the_application_data_folder_under_the_bundle_identifier(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LOCALAPPDATA", "C:/Users/x/AppData/Local")

    folder = app_data_dir()

    assert folder == Path("C:/Users/x/AppData/Local") / BUNDLE_IDENTIFIER


def test_falls_back_under_the_home_folder_without_localappdata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Un environnement ampute de `LOCALAPPDATA` ne doit pas ecrire dans le courant."""
    monkeypatch.delenv("LOCALAPPDATA", raising=False)
    monkeypatch.setattr(Path, "home", lambda: Path("C:/Users/x"))

    folder = app_data_dir()

    assert folder == Path("C:/Users/x/AppData/Local") / BUNDLE_IDENTIFIER


def test_puts_the_log_folder_under_the_application_data_folder(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Tauri compose `appLocalDataDir()` avec l'identifiant du bundle, pas avec le
    nom de l'application : le sidecar ecrirait sinon hors des scopes de la webview.
    """
    monkeypatch.setenv("LOCALAPPDATA", "C:/Users/x/AppData/Local")

    folder = log_dir()

    assert folder == Path("C:/Users/x/AppData/Local") / BUNDLE_IDENTIFIER / "logs"


def test_prefixes_a_path_beyond_the_win32_limit(tmp_path: Path) -> None:
    deep = "y" * 300
    path = tmp_path / deep / "track.mp3"

    extended = extended_path(path)

    assert str(extended) == f"\\\\?\\{tmp_path.resolve()}\\{deep}\\track.mp3"


def test_prefixes_a_network_share_as_unc(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(Path, "resolve", lambda self, strict=False: self)
    path = Path("\\\\nas\\music\\track.mp3")

    extended = extended_path(path)

    assert str(extended) == "\\\\?\\UNC\\nas\\music\\track.mp3"


def test_leaves_an_already_prefixed_path_alone(tmp_path: Path) -> None:
    path = extended_path(tmp_path / "track.mp3")

    extended = extended_path(path)

    assert extended == path
