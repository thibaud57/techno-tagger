"""Lecture des logs captures par `caplog`, pour les tests qui gardent la vie privee des logs."""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Iterable

    import pytest


def messages_of(caplog: pytest.LogCaptureFixture, logger: str) -> list[str]:
    """Messages du seul logger `logger` : ceux des autres modules ne disent rien du test."""
    return [record.getMessage() for record in caplog.records if record.name == logger]


def leaked(messages: Iterable[str], secrets: Iterable[str]) -> list[str]:
    """Messages qui portent l'un des `secrets`, pour asserter qu'aucun ne fuit."""
    return [message for message in messages for secret in secrets if secret in message]
