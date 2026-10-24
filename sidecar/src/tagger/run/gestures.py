"""Un geste a la fois par morceau, regle commune a l'arbitrage et au rattrapage par URL."""

from contextlib import contextmanager
from typing import TYPE_CHECKING, override

if TYPE_CHECKING:
    from collections.abc import Callable, Generator

    from tagger.core.errors import TaggerError
    from tagger.core.identifiers import TrackId


class InFlight:
    """Morceaux dont un geste est en vol : un second geste est refuse, jamais mis en file.

    Des clics rapides lanceraient sinon deux appels reseau sur le meme morceau.
    """

    def __init__(self, busy_error: Callable[[TrackId], TaggerError]) -> None:
        self._busy_error = busy_error
        self._track_ids: set[TrackId] = set()

    @override
    def __repr__(self) -> str:
        return f"InFlight(busy={self.count})"

    @property
    def count(self) -> int:
        return len(self._track_ids)

    def check(self, track_id: TrackId) -> None:
        """Leve l'erreur d'occupation du geste si le morceau est deja pris."""
        if track_id in self._track_ids:
            raise self._busy_error(track_id)

    @contextmanager
    def hold(self, track_id: TrackId) -> Generator[None]:
        """Marque le morceau occupe le temps d'un appel, annulation comprise."""
        self._track_ids.add(track_id)
        try:
            yield
        finally:
            self._track_ids.discard(track_id)
