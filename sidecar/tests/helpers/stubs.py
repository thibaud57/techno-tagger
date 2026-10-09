"""Remplacants de fonctions, partages par les tests unitaires et d'integration."""

from typing import TYPE_CHECKING, NoReturn

if TYPE_CHECKING:
    from collections.abc import Callable


def raising(error: BaseException) -> Callable[..., NoReturn]:
    """Remplacant d'une fonction qui leve toujours `error`."""

    def raise_error(*_args: object, **_kwargs: object) -> NoReturn:
        raise error

    return raise_error
