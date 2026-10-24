"""Codes et cles de `params` que le sidecar peut emettre, de quoi verifier l'interface."""

import ast
import importlib
import inspect
import pkgutil
from annotationlib import Format
from pathlib import Path
from typing import Final

import tagger
from tagger.core.errors import TaggerError
from tagger.protocol import API_KEY_MALFORMED, MALFORMED_COMMAND, error_from_business

# `exc` et `command` sont les entrees de `error_from_business`, pas des cles de `params`.
_NOT_PARAMS: Final = frozenset({"exc", "command"})


def _codes(base: type[TaggerError]) -> set[str]:
    return {base.code}.union(*(_codes(sub) for sub in base.__subclasses__()))


def error_codes() -> frozenset[str]:
    """Importe tous les modules : une erreur ajoutee ailleurs est couverte d'office."""
    for module in pkgutil.walk_packages(tagger.__path__, "tagger."):
        importlib.import_module(module.name)

    return frozenset(_codes(TaggerError) | {MALFORMED_COMMAND, API_KEY_MALFORMED})


def _bases(node: ast.ClassDef) -> frozenset[str]:
    return frozenset(ast.unparse(base).rsplit(".", 1)[-1] for base in node.bases)


def _error_names(classes: list[ast.ClassDef], known: frozenset[str]) -> frozenset[str]:
    """Classes qui descendent de `TaggerError`, retrouvees par leurs bases (point fixe)."""
    grown = known | {node.name for node in classes if _bases(node) & known}

    return known if grown == known else _error_names(classes, grown)


def _super_init_keywords(node: ast.ClassDef) -> frozenset[str]:
    """Mots-cles passes a `super().__init__(...)`, hors `**params` qui n'en nomme aucun."""
    return frozenset(
        keyword.arg
        for call in ast.walk(node)
        if isinstance(call, ast.Call) and ast.unparse(call.func) == "super().__init__"
        for keyword in call.keywords
        if keyword.arg is not None
    )


def error_param_keys() -> frozenset[str]:
    """Cles de `params` des erreurs metier et de `error_from_business`."""
    classes = [
        node
        for root in tagger.__path__
        for path in sorted(Path(root).rglob("*.py"))
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8")))
        if isinstance(node, ast.ClassDef)
    ]
    names = _error_names(classes, frozenset({TaggerError.__name__}))
    declared = frozenset[str]().union(
        *(_super_init_keywords(node) for node in classes if node.name in names)
    )
    # `TaggerError` n'est importe que pour le typage dans `protocol.py` : sans lui, NameError.
    signature = inspect.signature(error_from_business, annotation_format=Format.FORWARDREF)
    joined = frozenset(signature.parameters) - _NOT_PARAMS

    return declared | joined
