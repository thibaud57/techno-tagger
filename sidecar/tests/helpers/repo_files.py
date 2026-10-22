"""Fichiers du depot lus par les tests de coherence entre manifestes."""

import json
import tomllib
from pathlib import Path
from typing import Final

REPO: Final = Path(__file__).parents[3]


def _descend(node: object, keys: tuple[str | int, ...]) -> object:
    """Les `assert isinstance` narrowent les `object` que rendent les lecteurs (mypy strict)."""
    for key in keys:
        if isinstance(key, int):
            assert isinstance(node, list)
            node = node[key]
        else:
            assert isinstance(node, dict)
            node = node[key]
    return node


def read_json(path: str, *keys: str | int) -> object:
    return _descend(json.loads((REPO / path).read_text(encoding="utf-8")), keys)


def read_toml(path: str, *keys: str) -> object:
    return _descend(tomllib.loads((REPO / path).read_text(encoding="utf-8")), keys)
