"""Chaque code d'erreur du sidecar a sa phrase dans les deux fichiers de langue."""

from typing import TYPE_CHECKING, Final

import pytest
from error_codes import error_codes
from repo_files import read_json

from tagger.__main__ import BusyPhase
from tagger.core.file_failures import FileFailureReason
from tagger.playlists.extraction import DuplicateCriterion
from tagger.run.models import FailureReason

if TYPE_CHECKING:
    from enum import StrEnum

LANGUAGES: Final = ["en", "fr"]
SHARED_REASONS: Final = {reason.value for reason in FileFailureReason}
RETRY_CONTEXTS: Final = {"write", "rollback", "extraction"}


def _section(language: str, path: tuple[str, ...]) -> dict[str, object]:
    section = read_json(f"public/i18n/{language}.json", *path)
    assert isinstance(section, dict)

    return section


@pytest.mark.parametrize("language", LANGUAGES, ids=LANGUAGES)
def test_every_error_code_has_a_translation(language: str) -> None:
    errors = _section(language, ("errors",))

    missing = error_codes() - errors.keys()

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
