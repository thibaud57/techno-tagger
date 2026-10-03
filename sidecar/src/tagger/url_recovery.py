"""Rattrapage par URL en fin de run (use-case 4), hors protocole NDJSON : rendu par rappel."""

import logging
from contextlib import contextmanager
from dataclasses import dataclass
from typing import TYPE_CHECKING, ClassVar, override

from tagger.errors import TaggerError
from tagger.scraper_client import ScraperError
from tagger.tagging import Resolution, TrackResolved, TrackState

if TYPE_CHECKING:
    from collections.abc import Callable, Generator

    from tagger.sources import RunSources
    from tagger.tagging import LiveRun, TrackRecord

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class UrlProgress:
    """Morceaux rattrapes par URL sur morceaux a rattraper."""

    processed: int
    total: int


type UrlRecoveryEvent = TrackResolved | UrlProgress


class UrlRecoveryError(TaggerError):
    code: ClassVar[str] = "url_recovery_error"

    def __init__(self, message: str, track_id: str) -> None:
        super().__init__(message, track_id=track_id)


class UrlRecoveryNotEligibleError(UrlRecoveryError):
    """Morceau inconnu du run, resolu autrement que par URL, en arbitrage ou jamais traite."""

    code: ClassVar[str] = "url_recovery_not_eligible"

    def __init__(self, track_id: str) -> None:
        super().__init__("track not eligible for url recovery", track_id)


class UrlRecoveryBusyError(UrlRecoveryError):
    code: ClassVar[str] = "url_recovery_busy"

    def __init__(self, track_id: str) -> None:
        super().__init__("a url is already being resolved for this track", track_id)


class UrlRecovery:
    """Second geste refuse (pas mis en file) si le premier est deja en vol sur ce morceau :
    des clics rapides lanceraient sinon deux appels reseau."""

    def __init__(
        self,
        live: LiveRun,
        sources: RunSources,
        on_event: Callable[[UrlRecoveryEvent], None],
    ) -> None:
        self._live = live
        self._sources = sources
        self._on_event = on_event
        self._busy: set[str] = set()

    @override
    def __repr__(self) -> str:
        return f"UrlRecovery(run_id={self._live.run_id!r}, busy={len(self._busy)})"

    async def resolve(self, track_id: str, url: str) -> None:
        """Resout le morceau depuis `url` ; un echec laisse le morceau tel qu'il etait."""
        record = self._eligible(track_id)
        position = self._live.position(track_id)
        with self._in_flight(track_id):
            try:
                candidate, artwork = await self._sources.from_url(position, url)
            except TaggerError as exc:
                logger.warning(
                    "url recovery failed run=%s track=%d status=%s reason=%s request_id=%s",
                    self._live.run_id,
                    position,
                    record.state,
                    exc.code,
                    exc.request_id if isinstance(exc, ScraperError) else "",
                )
                raise
        logger.info(
            "url recovered run=%s track=%d source=%s status=resolved",
            self._live.run_id,
            position,
            candidate.source,
        )
        resolved = record.resolved(Resolution.URL, candidate.source, candidate, None, artwork)
        self._live.update(resolved)
        self._on_event(TrackResolved(resolved))
        self._on_event(self.progress())

    def progress(self) -> UrlProgress:
        """Calcule et non compte : une correction ne compte pas deux fois, un refus
        d'arbitrage tardif entre dans le total sans compteur a tenir en phase."""
        tracks = self._live.snapshot().tracks
        recovered = sum(1 for record in tracks if _recovered(record))
        waiting = sum(1 for record in tracks if record.state is TrackState.UNRESOLVED)
        return UrlProgress(processed=recovered, total=recovered + waiting)

    def _eligible(self, track_id: str) -> TrackRecord:
        """Non resolu, ou deja resolu par URL : recoller corrige un mauvais lien."""
        if track_id in self._busy:
            raise UrlRecoveryBusyError(track_id)
        record = self._live.record(track_id)
        if record is None or not (record.state is TrackState.UNRESOLVED or _recovered(record)):
            raise UrlRecoveryNotEligibleError(track_id)
        return record

    @contextmanager
    def _in_flight(self, track_id: str) -> Generator[None]:
        """Marque le morceau occupe le temps d'un appel, annulation comprise."""
        self._busy.add(track_id)
        try:
            yield
        finally:
            self._busy.discard(track_id)


def _recovered(record: TrackRecord) -> bool:
    return record.state is TrackState.RESOLVED and record.resolution is Resolution.URL
