"""Garde de coherence entre un modele du fil et la dataclass metier qu'il reflete."""

from dataclasses import fields
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Collection

    from _typeshed import DataclassInstance
    from pydantic import BaseModel


def assert_same_fields(
    model: type[BaseModel],
    domain: type[DataclassInstance],
    wire_only: Collection[str] = (),
) -> None:
    """`wire_only` : champs du fil que le metier ne porte pas (evenement, chemin du rapport)."""
    assert set(model.model_fields) - set(wire_only) == {field.name for field in fields(domain)}
