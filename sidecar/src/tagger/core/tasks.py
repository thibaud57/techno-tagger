"""Outils asyncio partages par la session et les runs."""

import asyncio
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Iterable


async def cancel_all[Result](tasks: Iterable[asyncio.Task[Result]]) -> None:
    """Annule et attend les taches, erreurs comprises : un nettoyage ne doit pas lever."""
    pending = tuple(tasks)
    for task in pending:
        task.cancel()
    await asyncio.gather(*pending, return_exceptions=True)
