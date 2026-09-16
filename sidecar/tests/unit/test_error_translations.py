"""Chaque code d'erreur du sidecar a sa phrase dans les deux fichiers de langue."""

import importlib
import json
import pkgutil
from pathlib import Path

import pytest

import tagger
from tagger.errors import TaggerError
from tagger.protocol import MALFORMED_COMMAND

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

    missing = (_codes(TaggerError) | {MALFORMED_COMMAND}) - errors.keys()

    assert not missing
