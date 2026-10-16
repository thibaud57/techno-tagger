"""Remplacants de fonctions, partages par les tests unitaires et d'integration."""

from pathlib import Path
from typing import TYPE_CHECKING, Concatenate, NoReturn

if TYPE_CHECKING:
    from collections.abc import Callable


def ignore(*_args: object) -> None:
    """Rappel d'un test qui n'observe pas ce qu'on lui passe."""


def raising(error: BaseException) -> Callable[..., NoReturn]:
    """Remplacant d'une fonction qui leve toujours `error`."""

    def raise_error(*_args: object, **_kwargs: object) -> NoReturn:
        raise error

    return raise_error


def locked_file() -> Callable[..., NoReturn]:
    """Remplacant de `Path.unlink` ou `Path.replace` quand un antivirus tient le fichier."""
    return raising(PermissionError(13, "locked by another process"))


def failing_when[**P, R](
    real: Callable[P, R], error: BaseException, predicate: Callable[..., bool]
) -> Callable[P, R]:
    """Remplacant de `real` qui leve `error` quand `predicate` approuve les arguments."""

    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        if predicate(*args, **kwargs):
            raise error
        return real(*args, **kwargs)

    return wrapper


def failing_first[**P, R](real: Callable[P, R], error: BaseException) -> Callable[P, R]:
    """Remplacant de `real` qui leve `error` au premier appel, puis delegue."""
    calls = 0

    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise error
        return real(*args, **kwargs)

    return wrapper


def refusing_suffix[**P, R](
    real: Callable[Concatenate[Path, P], R], suffix: str, error: BaseException
) -> Callable[Concatenate[Path, P], R]:
    """Remplacant d'une ecriture dont le chemin vient en premier : refuse `suffix`."""

    def wrapper(path: Path, /, *args: P.args, **kwargs: P.kwargs) -> R:
        if path.suffix == suffix:
            raise error
        return real(path, *args, **kwargs)

    return wrapper


def spying[T, **P, R](
    real: Callable[Concatenate[T, P], R], calls: list[T]
) -> Callable[Concatenate[T, P], R]:
    """Remplacant de `real` qui note son premier argument dans `calls`, puis delegue."""

    def wrapper(first: T, /, *args: P.args, **kwargs: P.kwargs) -> R:
        calls.append(first)
        return real(first, *args, **kwargs)

    return wrapper


def unlink_except(locked: Path) -> Callable[..., None]:
    """Remplacant de `Path.unlink` qui refuse `locked` et supprime le reste pour de bon."""
    real_unlink = Path.unlink

    def unlink(self: Path, missing_ok: bool = False) -> None:
        if self == locked:
            raise PermissionError(13, "Permission denied")
        real_unlink(self, missing_ok=missing_ok)

    return unlink
