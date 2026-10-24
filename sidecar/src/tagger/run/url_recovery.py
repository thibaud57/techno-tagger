"""Rattrapage par URL en fin de run (use-case 4), hors protocole NDJSON : rendu par rappel."""

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING, ClassVar, override

from tagger.core.errors import TaggerError
from tagger.resolution.scraper_client import ScraperError
from tagger.run.gestures import InFlight
from tagger.run.models import Resolution, Resolved, Retained, TrackResolved

if TYPE_CHECKING:
    from collections.abc import Callable

    from tagger.core.identifiers import TrackId
    from tagger.resolution.sources import RunSources
    from tagger.run.models import LiveRun, TrackRecord

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True, kw_only=True)
class UrlProgress:
    """Morceaux rattrapes par URL sur morceaux a rattraper."""

    processed: int
    total: int


type UrlRecoveryEvent = TrackResolved | UrlProgress


class UrlRecoveryError(TaggerError):
    code: ClassVar[str] = "url_recovery_error"

    def __init__(self, message: str, track_id: TrackId) -> None:
        super().__init__(message, track_id=track_id)


class UrlRecoveryNotEligibleError(UrlRecoveryError):
    """Morceau inconnu du run, resolu autrement que par URL, en arbitrage ou jamais traite."""

    code: ClassVar[str] = "url_recovery_not_eligible"

    def __init__(self, track_id: TrackId) -> None:
        super().__init__("track not eligible for url recovery", track_id)


class UrlRecoveryBusyError(UrlRecoveryError):
    code: ClassVar[str] = "url_recovery_busy"

    def __init__(self, track_id: TrackId) -> None:
        super().__init__("a url is already being resolved for this track", track_id)


class UrlRecoveryNotOpenError(UrlRecoveryError):
    """Aucun run courant, ou sa phase reseau tourne encore : le rattrapage vient apres."""

    code: ClassVar[str] = "url_recovery_not_open"

    def __init__(self, track_id: TrackId) -> None:
        super().__init__("url recovery is not open", track_id)


class UrlRecovery:
    """Rattrapage d'un morceau non resolu par une URL saisie, un geste a la fois par morceau."""

    def __init__(
        self,
        live: LiveRun,
        sources: RunSources,
        on_event: Callable[[UrlRecoveryEvent], None],
    ) -> None:
        self._live = live
        self._sources = sources
        self._on_event = on_event
        self._in_flight = InFlight(UrlRecoveryBusyError)

    @override
    def __repr__(self) -> str:
        return f"UrlRecovery(run_id={self._live.run_id!r}, busy={self._in_flight.count})"

    async def resolve(self, track_id: TrackId, url: str) -> None:
        """Resout le morceau depuis `url` ; un echec laisse le morceau tel qu'il etait."""
        record = self._eligible(track_id)
        position = self._live.position(track_id)
        with self._in_flight.hold(track_id):
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
        retained = Retained(Resolution.URL, candidate.source, candidate, None, artwork)
        resolved = record.with_outcome(Resolved(record.query, retained))
        self._live.update(resolved)
        self._on_event(TrackResolved(resolved))
        self._on_event(self.progress())

    def progress(self) -> UrlProgress:
        """Calcule et non compte : une correction ne compte pas deux fois, un refus
        d'arbitrage tardif entre dans le total sans compteur a tenir en phase."""
        tracks = self._live.snapshot().tracks
        recovered = sum(
            1
            for record in tracks
            if isinstance(record.outcome, Resolved) and record.outcome.retained.by_url
        )
        return UrlProgress(processed=recovered, total=sum(record.recoverable for record in tracks))

    def _eligible(self, track_id: TrackId) -> TrackRecord:
        """Non resolu, ou deja resolu par URL : recoller corrige un mauvais lien."""
        self._in_flight.check(track_id)
        record = self._live.record(track_id)
        if record is None or not record.recoverable:
            raise UrlRecoveryNotEligibleError(track_id)
        return record
