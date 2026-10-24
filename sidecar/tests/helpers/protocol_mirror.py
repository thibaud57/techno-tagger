"""Lecture de `protocol.ts` et `error-params.ts`, de quoi les comparer a `protocol.py`."""

import re
from functools import cache
from typing import TYPE_CHECKING, Final

from repo_files import REPO

if TYPE_CHECKING:
    from collections.abc import Mapping

_PROTOCOL_TS: Final = REPO / "src/app/core/sidecar/protocol.ts"
_ERROR_PARAMS_TS: Final = REPO / "src/app/core/sidecar/error-params.ts"
_TEXT_PARAM: Final = re.compile(r'\btextParam\(\s*event,\s*"(\w+)"\s*\)')
_INTERFACE: Final = re.compile(
    r"^export interface (\w+)(?: extends (\w+))? \{\n(.*?)^\}", re.DOTALL | re.MULTILINE
)
_FIELD: Final = re.compile(r"^  readonly (\w+)\??:", re.MULTILINE)
# Prettier garde deux `export type` consecutifs sans ligne vide : un alias s'arrete au suivant.
_ALIAS: Final = re.compile(
    r"^export type (\w+) =(.*?)(?=\n\s*\n|^export |^/\*\*|^//|\Z)", re.DOTALL | re.MULTILINE
)
_CONSTANT: Final = re.compile(r'^export const (\w+) =\s*"([^"]*)"', re.MULTILINE)
_ARRAY: Final = re.compile(r"^export const (\w+) = \[([^\]]*)\] as const$", re.MULTILINE)
_DERIVED: Final = re.compile(r"\s*\(typeof (\w+)\)\[number\]\s*")
_TOKEN: Final = r'"[a-z0-9_]+"|\w+'
_SCORE_SCALE: Final = re.compile(r"SCORE_SCALE = \{ min: (\d+), max: (\d+) \}")


@cache
def _source() -> str:
    return _PROTOCOL_TS.read_text(encoding="utf-8")


def _declared() -> dict[str, tuple[str | None, str]]:
    """Nom d'une interface vers son `extends` et le corps de ses champs."""
    return {name: (base or None, body) for name, base, body in _INTERFACE.findall(_source())}


def _fields(name: str, declared: Mapping[str, tuple[str | None, str]]) -> frozenset[str]:
    base, body = declared[name]
    own = frozenset(_FIELD.findall(body))

    return own if base is None else own | _fields(base, declared)


def ts_interfaces() -> dict[str, frozenset[str]]:
    """Champs de chaque interface, ceux de son `extends` compris."""
    declared = _declared()

    return {name: _fields(name, declared) for name in declared}


def ts_discriminant_owners(key: str) -> dict[str, list[str]]:
    """Valeur du discriminant `key` vers les interfaces qui la declarent (une seule si sain)."""
    literal = re.compile(rf'^  readonly {key}: "(\w+)"$', re.MULTILINE)
    pairs = [
        (found[1], name)
        for name, (_, body) in _declared().items()
        if (found := literal.search(body))
    ]

    return {value: [name for other, name in pairs if other == value] for value, _ in pairs}


def ts_discriminants(key: str) -> dict[str, str]:
    """Valeur du discriminant `key` vers l'interface qui la declare."""
    return {value: names[0] for value, names in ts_discriminant_owners(key).items()}


def ts_union_members(alias: str) -> frozenset[str]:
    """Interfaces que liste un alias d'union d'interfaces (`| A | B`)."""
    bodies = dict(_ALIAS.findall(_source()))
    assert alias in bodies, f"{alias} not found in protocol.ts"

    return frozenset(re.findall(r"\w+", bodies[alias]))


def ts_error_param_keys() -> frozenset[str]:
    """Cles de `params` lues par les accesseurs de `error-params.ts`, via `textParam`."""
    return frozenset(_TEXT_PARAM.findall(_ERROR_PARAMS_TS.read_text(encoding="utf-8")))


def _literals(name: str, alias_tokens: Mapping[str, list[str]]) -> frozenset[str] | None:
    parts = [
        frozenset({token.strip('"')})
        if token.startswith('"')
        else (_literals(token, alias_tokens) if token in alias_tokens else None)
        for token in alias_tokens[name]
    ]
    known = [part for part in parts if part is not None]

    return frozenset[str]().union(*known) if len(known) == len(parts) else None


def ts_unions() -> dict[str, frozenset[str]]:
    """Litteraux de chaque alias d'union de litteraux, ou derive d'un tableau `as const`."""
    source = _source()
    aliases = _ALIAS.findall(source)
    alias_tokens = {name: re.findall(_TOKEN, body) for name, body in aliases}
    resolved = {name: _literals(name, alias_tokens) for name in alias_tokens}
    arrays = {
        name: frozenset(re.findall(r'"([^"]*)"', body)) for name, body in _ARRAY.findall(source)
    }
    derived = {
        name: arrays[found[1]]
        for name, body in aliases
        if (found := _DERIVED.fullmatch(body)) and found[1] in arrays
    }

    return {name: literals for name, literals in resolved.items() if literals is not None} | derived


def ts_string_constants() -> dict[str, str]:
    return dict(_CONSTANT.findall(_source()))


def ts_score_scale() -> tuple[int, int]:
    """Bornes `(min, max)` de `SCORE_SCALE`, l'echelle des scores et des seuils."""
    scale = _SCORE_SCALE.search(_source())
    assert scale is not None, "SCORE_SCALE not found in protocol.ts"

    return int(scale[1]), int(scale[2])
