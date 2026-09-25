"""Tests de la racine des donnees de l'application."""

from pathlib import Path
from typing import TYPE_CHECKING

from tagger import BUNDLE_IDENTIFIER
from tagger.paths import app_data_dir

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
