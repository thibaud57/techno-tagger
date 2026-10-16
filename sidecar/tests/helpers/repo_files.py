"""Fichiers du depot lus par les tests de coherence entre manifestes."""

import json
from pathlib import Path
from typing import Final

REPO: Final = Path(__file__).parents[3]


def read_json(path: str, *keys: str) -> object:
    """Valeur d'un JSON du depot, descendue par `keys`.

    Les `assert isinstance` sont le narrowing qu'exige mypy strict, `json.loads` ne
    rendant que des `object`.
    """
    node: object = json.loads((REPO / path).read_text(encoding="utf-8"))
    for key in keys:
        assert isinstance(node, dict)
        node = node[key]
    return node
