"""Remplacants de fonctions, partages par les tests unitaires et d'integration."""

from pathlib import Path
from typing import TYPE_CHECKING, NoReturn

if TYPE_CHECKING:
    from collections.abc import Callable


def ignore(*_args: object) -> None:
    """Rappel d'un test qui n'observe pas ce qu'on lui passe."""


def raising(error: BaseException) -> Callable[..., NoReturn]:
    """Remplacant d'une fonction qui leve toujours `error`."""

    def raise_error(*_args: object, **_kwargs: object) -> NoReturn:
        raise error

    return raise_error


def unlink_except(locked: Path) -> Callable[..., None]:
    """Remplacant de `Path.unlink` qui refuse `locked` et supprime le reste pour de bon."""
    real_unlink = Path.unlink

    def unlink(self: Path, missing_ok: bool = False) -> None:
        if self == locked:
            raise PermissionError(13, "Permission denied")
        real_unlink(self, missing_ok=missing_ok)

    return unlink
