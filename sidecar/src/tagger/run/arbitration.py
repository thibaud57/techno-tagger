"""Arbitrage en zone grise (use-case 3, ADR-009), hors protocole NDJSON : rendu par rappel."""

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING, ClassVar, NamedTuple, assert_never, override

from tagger.core.errors import TaggerError
from tagger.resolution.matching import Empty, GreyZone, rank
from tagger.resolution.scraper_client import (
    ApiContractError,
    ApiKeyRejectedError,
    Source,
    SourceUnavailableError,
)
from tagger.resolution.sources import ApiKeyRejectedRunError
from tagger.run.gestures import InFlight
from tagger.run.models import (
    AwaitingArbitration,
    FailureReason,
    PendingArbitration,
    Resolution,
    Resolved,
    Retained,
    SourceList,
    TrackResolved,
    Unresolved,
    holds,
)

if TYPE_CHECKING:
    from collections.abc import Callable

    from tagger.core.identifiers import TrackId
    from tagger.resolution.matching import TrackQuery
    from tagger.resolution.sources import RunSources
    from tagger.run.models import LiveRun, SettledOutcome, TrackRecord

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class ArbitrationUpdated:
    record: TrackRecord[AwaitingArbitration]


type ArbitrationEvent = ArbitrationUpdated | TrackResolved


class ArbitrationError(TaggerError):
    code: ClassVar[str] = "arbitration_error"

    def __init__(self, message: str, track_id: TrackId) -> None:
        super().__init__(message, track_id=track_id)


class ArbitrationNotPendingError(ArbitrationError):
    """Morceau inconnu du run, deja tranche ou jamais traite."""

    code: ClassVar[str] = "arbitration_not_pending"

    def __init__(self, track_id: TrackId) -> None:
        super().__init__("track not awaiting arbitration", track_id)


class ArbitrationCandidateUnknownError(ArbitrationError):
    """Source qui n'est pas affichee, index hors de la liste, ou liste jamais obtenue."""

    code: ClassVar[str] = "arbitration_candidate_unknown"

    def __init__(self, track_id: TrackId) -> None:
        super().__init__("candidate not in the shown list", track_id)


class ArbitrationBusyError(ArbitrationError):
    code: ClassVar[str] = "arbitration_busy"

    def __init__(self, track_id: TrackId) -> None:
        super().__init__("a gesture is already in flight for this track", track_id)


class _Pending(NamedTuple):
    record: TrackRecord[AwaitingArbitration]
    position: int


class Arbitration:
    """Choix ou refus d'un candidat par l'utilisateur, un geste a la fois par morceau."""

    def __init__(
        self,
        live: LiveRun,
        sources: RunSources,
        on_event: Callable[[ArbitrationEvent], None],
    ) -> None:
        self._live = live
        self._sources = sources
        self._on_event = on_event
        self._in_flight = InFlight(ArbitrationBusyError)

    @override
    def __repr__(self) -> str:
        return f"Arbitration(run_id={self._live.run_id!r}, busy={self._in_flight.count})"

    async def choose(self, track_id: TrackId, source: Source, index: int) -> None:
        current = self._pending(track_id)
        shown = current.record.outcome.pending
        if source is not shown.source or not 0 <= index < len(shown.candidates):
            raise ArbitrationCandidateUnknownError(track_id)
        chosen = shown.candidates[index]
        with self._in_flight.hold(track_id):
            try:
                candidate, artwork = await self._sources.retained(current.position, source, chosen)
            except ApiKeyRejectedRunError as exc:
                # Le 403 ne concerne que ce morceau : arreter le run revient au pipeline.
                self._sources.log_refetch_failed(current.position, source, exc.code)
                candidate, artwork = chosen.candidate, None
        logger.info(
            "arbitration decided run=%s track=%d source=%s score=%.0f status=resolved",
            self._live.run_id,
            current.position,
            source,
            chosen.score,
        )
        retained = Retained(Resolution.ARBITRATION, source, candidate, chosen, artwork)
        self._settle(current.record.with_outcome(Resolved(current.record.outcome.query, retained)))

    async def refuse(self, track_id: TrackId, source: Source) -> None:
        """Refuse `source` : Bandcamp apres Beatport, non resolu apres Bandcamp ; `source` doit
        matcher la liste affichee, sinon un double clic en pleine bascule la validerait a tort.
        """
        current = self._pending(track_id)
        shown = current.record.outcome.pending
        if source is not shown.source:
            raise ArbitrationCandidateUnknownError(track_id)
        if shown.source is Source.BANDCAMP:
            self._give_up(current)
            return
        if shown.other is not None:
            self._show(current, shown.other)
            return
        with self._in_flight.hold(track_id):
            answer = await self._ask_bandcamp(current.position, current.record.outcome.query)
        self._show(current, answer)

    def show(self, track_id: TrackId, source: Source) -> None:
        """Reaffiche la liste deja obtenue de `source`, sans appel reseau."""
        current = self._pending(track_id)
        kept = current.record.outcome.pending.other
        if kept is None or kept.source is not source:
            raise ArbitrationCandidateUnknownError(track_id)
        self._show(current, kept)

    async def _ask_bandcamp(self, position: int, query: TrackQuery) -> SourceList:
        """Liste Bandcamp apres un refus, jamais validee seule : l'utilisateur decide."""
        try:
            found = await self._sources.search(Source.BANDCAMP, query)
        except ApiKeyRejectedError, ApiKeyRejectedRunError:
            return SourceList(Source.BANDCAMP, (), FailureReason.SOURCE_UNAVAILABLE)
        except (SourceUnavailableError, ApiContractError) as exc:
            self._sources.log_source_failure(position, Source.BANDCAMP, exc)
            return SourceList(Source.BANDCAMP, (), FailureReason.SOURCE_UNAVAILABLE)
        ranking = rank(query, found, self._sources.thresholds)
        match ranking:
            case GreyZone(candidates=candidates):
                return SourceList(Source.BANDCAMP, candidates)
            case Empty(had_candidates=had_candidates):
                reason = (
                    FailureReason.BELOW_THRESHOLD if had_candidates else FailureReason.NO_RESULT
                )
                return SourceList(Source.BANDCAMP, (), reason)
            case _:
                assert_never(ranking)

    def _show(self, current: _Pending, kept: SourceList) -> None:
        """`kept` passe a l'affichage, la liste affichee est mise de cote."""
        outcome = current.record.outcome
        shown = outcome.pending
        pending = PendingArbitration(
            kept.source,
            kept.candidates,
            shown.beatport_unavailable,
            empty_reason=kept.empty_reason,
            other=SourceList(shown.source, shown.candidates, shown.empty_reason),
        )
        record = current.record.with_outcome(AwaitingArbitration(outcome.query, pending))
        logger.info(
            "arbitration switched run=%s track=%d source=%s status=grey_zone",
            self._live.run_id,
            current.position,
            kept.source,
        )
        self._live.update(record)
        self._on_event(ArbitrationUpdated(record))

    def _give_up(self, current: _Pending) -> None:
        """Bandcamp refuse, ou passe sur une liste vide dont le motif est garde."""
        outcome = current.record.outcome
        reason = outcome.pending.empty_reason or FailureReason.USER_REFUSED
        logger.info(
            "arbitration refused run=%s track=%d source=%s status=unresolved reason=%s",
            self._live.run_id,
            current.position,
            Source.BANDCAMP,
            reason,
        )
        self._settle(current.record.with_outcome(Unresolved(outcome.query, reason)))

    def _pending(self, track_id: TrackId) -> _Pending:
        self._in_flight.check(track_id)
        record = self._live.record(track_id)
        if record is None or not holds(record, AwaitingArbitration):
            raise ArbitrationNotPendingError(track_id)
        return _Pending(record, self._live.position(track_id))

    def _settle(self, record: TrackRecord[SettledOutcome]) -> None:
        self._live.update(record)
        self._on_event(TrackResolved(record))
