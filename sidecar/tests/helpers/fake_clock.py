"""Horloge reglable : TTL et LRU se testent sans attendre ni dormir."""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from datetime import timedelta


class FakeClock:
    """Instant courant en secondes epoch, avance a la main."""

    def __init__(self, now: float = 1_800_000_000.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now

    def advance(self, delta: timedelta) -> None:
        self.now += delta.total_seconds()
