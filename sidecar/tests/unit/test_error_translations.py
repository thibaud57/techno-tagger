"""Chaque code d'erreur du sidecar a sa phrase dans les deux fichiers de langue."""

import importlib
import json
import pkgutil
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

import tagger
from tagger.errors import TaggerError
from tagger.extraction import DuplicateCriterion, ExtractionFailureReason
from tagger.protocol import API_KEY_MALFORMED, MALFORMED_COMMAND
from tagger.tagging import FailureReason

if TYPE_CHECKING:
    from enum import StrEnum

REPO = Path(__file__).parents[3]


def _codes(base: type[TaggerError]) -> set[str]:
    return {base.code}.union(*(_codes(sub) for sub in base.__subclasses__()))


@pytest.mark.parametrize("language", ["en", "fr"])
def test_every_error_code_has_a_translation(language: str) -> None:
    """Importe tous les modules : une erreur ajoutee ailleurs est couverte d'office."""
    for module in pkgutil.walk_packages(tagger.__path__, "tagger."):
        importlib.import_module(module.name)
    content = (REPO / "public" / "i18n" / f"{language}.json").read_text(encoding="utf-8")
    errors: dict[str, str] = json.loads(content)["errors"]

    missing = (_codes(TaggerError) | {MALFORMED_COMMAND, API_KEY_MALFORMED}) - errors.keys()

    assert not missing


@pytest.mark.parametrize("language", ["en", "fr"])
@pytest.mark.parametrize(
    ("reasons", "section"),
    [
        (FailureReason, ("tagging", "reason")),
        (ExtractionFailureReason, ("playlist", "report", "reason")),
        (DuplicateCriterion, ("playlist", "report", "criterion")),
    ],
    ids=["track-failure", "extraction-failure", "duplicate-criterion"],
)
def test_every_shown_reason_has_a_translation(
    language: str, reasons: type[StrEnum], section: tuple[str, ...]
) -> None:
    """Un motif ajoute cote sidecar sans sa phrase s'afficherait en cle brute."""
    content = (REPO / "public" / "i18n" / f"{language}.json").read_text(encoding="utf-8")
    translations: dict[str, object] = json.loads(content)
    for key in section:
        nested = translations[key]
        assert isinstance(nested, dict)
        translations = nested

    missing = {reason.value for reason in reasons} - translations.keys()

    assert not missing
