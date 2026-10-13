"""Chaque code d'erreur du sidecar a sa phrase dans les deux fichiers de langue."""

import importlib
import json
import pkgutil
from pathlib import Path
from typing import TYPE_CHECKING, Final

import pytest

import tagger
from tagger.__main__ import Phase as BusyPhase
from tagger.core.errors import TaggerError
from tagger.core.file_failures import FileFailureReason
from tagger.playlists.extraction import DuplicateCriterion
from tagger.protocol import API_KEY_MALFORMED, MALFORMED_COMMAND
from tagger.run.models import FailureReason

if TYPE_CHECKING:
    from enum import StrEnum

REPO: Final = Path(__file__).parents[3]
LANGUAGES: Final = ["en", "fr"]
SHARED_REASONS: Final = {reason.value for reason in FileFailureReason}
RETRY_CONTEXTS: Final = {"write", "rollback", "extraction"}


def _translations(language: str) -> dict[str, object]:
    content = (REPO / "public" / "i18n" / f"{language}.json").read_text(encoding="utf-8")
    translations: dict[str, object] = json.loads(content)

    return translations


def _section(language: str, path: tuple[str, ...]) -> dict[str, object]:
    section = _translations(language)
    for key in path:
        nested = section[key]
        assert isinstance(nested, dict)
        section = nested

    return section


def _codes(base: type[TaggerError]) -> set[str]:
    return {base.code}.union(*(_codes(sub) for sub in base.__subclasses__()))


@pytest.mark.parametrize("language", LANGUAGES, ids=LANGUAGES)
def test_every_error_code_has_a_translation(language: str) -> None:
    """Importe tous les modules : une erreur ajoutee ailleurs est couverte d'office."""
    for module in pkgutil.walk_packages(tagger.__path__, "tagger."):
        importlib.import_module(module.name)
    errors = _section(language, ("errors",))

    missing = (_codes(TaggerError) | {MALFORMED_COMMAND, API_KEY_MALFORMED}) - errors.keys()

    assert not missing


@pytest.mark.parametrize("language", LANGUAGES, ids=LANGUAGES)
def test_every_busy_phase_has_a_sentence(language: str) -> None:
    """`phase_busy` se traduit par la phase qui tourne : le geste qui repare en depend."""
    sentences = _section(language, ("errors", "phase_busy"))

    missing = {phase.value for phase in BusyPhase} - sentences.keys()

    assert not missing


@pytest.mark.parametrize("language", LANGUAGES, ids=LANGUAGES)
@pytest.mark.parametrize(
    ("reasons", "section"),
    [
        (FileFailureReason, ("reason",)),
        (set(FailureReason) - {FailureReason.NAME_TAKEN}, ("tagging", "reason")),
        ({FailureReason.NAME_TAKEN}, ("rollback", "reason")),
        (DuplicateCriterion, ("playlist", "report", "criterion")),
    ],
    ids=["file-failure", "resolution-failure", "rollback-only-failure", "duplicate-criterion"],
)
def test_every_shown_reason_has_a_translation(
    language: str, reasons: type[StrEnum] | set[FailureReason], section: tuple[str, ...]
) -> None:
    """Un motif ajoute cote sidecar sans sa phrase s'afficherait en cle brute."""
    translations = _section(language, section)

    missing = {reason.value for reason in reasons} - translations.keys()

    assert not missing


@pytest.mark.parametrize("language", LANGUAGES, ids=LANGUAGES)
@pytest.mark.parametrize(
    "section",
    [("tagging", "reason"), ("rollback", "reason"), ("playlist", "report")],
    ids=["tagging", "rollback", "playlist"],
)
def test_a_shared_file_reason_is_worded_once(language: str, section: tuple[str, ...]) -> None:
    """Un motif de fichier repete dans le jeu d'une phase divergerait du jeu commun."""
    translations = _section(language, section)

    repeated = SHARED_REASONS & translations.keys()

    assert not repeated


@pytest.mark.parametrize("language", LANGUAGES, ids=LANGUAGES)
def test_every_retry_context_has_a_sentence(language: str) -> None:
    """Le geste qui repare nomme ce qu'on relance : une cle de contexte par phase."""
    contexts = _section(language, ("reason", "retry"))

    assert contexts.keys() == RETRY_CONTEXTS


@pytest.mark.parametrize("language", LANGUAGES, ids=LANGUAGES)
def test_every_fix_names_a_shared_reason_and_takes_the_retry(language: str) -> None:
    """Un geste sans motif commun ne s'afficherait jamais, un sans `{{retry}}` perdrait sa suite."""
    fixes = _section(language, ("reason", "fix"))

    assert fixes.keys() <= SHARED_REASONS
    assert all("{{retry}}" in str(sentence) for sentence in fixes.values())
