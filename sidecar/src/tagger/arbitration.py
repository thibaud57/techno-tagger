"""Arbitrage d'un morceau en zone grise (use-case 3, ADR-009).

Gestes sur un run vivant, pendant sa phase reseau comme apres. Ignore le protocole
NDJSON : les evenements sortent par un rappel, que le handler traduit.
"""

import logging
from contextlib import contextmanager
from dataclasses import dataclass, replace
from typing import TYPE_CHECKING, ClassVar, NamedTuple, override

from tagger.errors import TaggerError
from tagger.matching import classify
from tagger.scraper_client import (
    ApiContractError,
    ApiKeyRejectedError,
    Source,
    SourceUnavailableError,
)
from tagger.sources import ApiKeyRejectedRunError
from tagger.tagging import (
    FailureReason,
    PendingArbitration,
    Resolution,
    SourceList,
    TrackResolved,
)

if TYPE_CHECKING:
    from collections.abc import Callable, Generator

    from tagger.matching import TrackQuery
    from tagger.sources import RunSources
    from tagger.tagging import LiveRun, TrackRecord

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class ArbitrationUpdated:
    """La liste affichee d'un morceau en attente a change."""

    record: TrackRecord


type ArbitrationEvent = ArbitrationUpdated | TrackResolved


class ArbitrationError(TaggerError):
    """Geste d'arbitrage impossible sur ce morceau."""

    code: ClassVar[str] = "arbitration_error"

    def __init__(self, message: str, track_id: str) -> None:
        super().__init__(message, track_id=track_id)


class ArbitrationNotPendingError(ArbitrationError):
    """Morceau inconnu du run, deja tranche ou jamais traite."""

    code: ClassVar[str] = "arbitration_not_pending"

    def __init__(self, track_id: str) -> None:
        super().__init__("track not awaiting arbitration", track_id)


class ArbitrationCandidateUnknownError(ArbitrationError):
    """Source qui n'est pas affichee, index hors de la liste, ou liste jamais obtenue."""

    code: ClassVar[str] = "arbitration_candidate_unknown"

    def __init__(self, track_id: str) -> None:
        super().__init__("candidate not in the shown list", track_id)


class ArbitrationBusyError(ArbitrationError):
    """Un geste est deja en vol sur ce morceau."""

    code: ClassVar[str] = "arbitration_busy"

    def __init__(self, track_id: str) -> None:
        super().__init__("a gesture is already in flight for this track", track_id)


class _Pending(NamedTuple):
    record: TrackRecord
    arbitration: PendingArbitration
    query: TrackQuery
    position: int


class Arbitration:
    """Gestes d'arbitrage sur un run vivant.

    Un second geste sur un morceau dont le premier est en vol est refuse, jamais mis
    en file : les clics rapides de la modale lanceraient sinon deux appels reseau.
    """

    def __init__(
        self,
        live: LiveRun,
        sources: RunSources,
        on_event: Callable[[ArbitrationEvent], None],
    ) -> None:
        self._live = live
        self._sources = sources
        self._on_event = on_event
        self._busy: set[str] = set()

    @override
    def __repr__(self) -> str:
        return f"Arbitration(run_id={self._live.run_id!r}, busy={len(self._busy)})"

    async def choose(self, track_id: str, source: Source, index: int) -> None:
        """Retient un candidat de la liste affichee : `resolved` / `arbitration`."""
        current = self._pending(track_id)
        shown = current.arbitration
        if source is not shown.source or not 0 <= index < len(shown.candidates):
            raise ArbitrationCandidateUnknownError(track_id)
        chosen = shown.candidates[index]
        with self._in_flight(track_id):
            try:
                candidate, artwork = await self._sources.retained(current.position, source, chosen)
            except ApiKeyRejectedRunError as exc:
                # Le 403 ne concerne que ce morceau : arreter le run revient au pipeline.
                logger.warning(
                    "refetch failed, search candidate kept run=%s track=%d source=%s reason=%s",
                    self._live.run_id,
                    current.position,
                    source,
                    exc.code,
                )
                candidate, artwork = chosen.candidate, None
        logger.info(
            "arbitration decided run=%s track=%d source=%s score=%.0f status=resolved",
            self._live.run_id,
            current.position,
            source,
            chosen.score,
        )
        self._settle(
            current.record.resolved(Resolution.ARBITRATION, source, candidate, chosen, artwork)
        )

    async def refuse(self, track_id: str, source: Source) -> None:
        """Refuse la liste `source` : Bandcamp apres Beatport, non resolu apres Bandcamp.

        `source` doit etre la liste affichee : un double clic arrive apres la bascule
        refuserait sinon Bandcamp sans que l'utilisateur l'ait vue.
        """
        current = self._pending(track_id)
        shown = current.arbitration
        if source is not shown.source:
            raise ArbitrationCandidateUnknownError(track_id)
        if shown.source is Source.BANDCAMP:
            self._give_up(current)
            return
        if shown.other is not None:
            self._show(current, shown.other)
            return
        with self._in_flight(track_id):
            answer = await self._ask_bandcamp(current.position, current.query)
        self._show(current, answer)

    def show(self, track_id: str, source: Source) -> None:
        """Reaffiche la liste deja obtenue de `source`, sans appel reseau."""
        current = self._pending(track_id)
        kept = current.arbitration.other
        if kept is None or kept.source is not source:
            raise ArbitrationCandidateUnknownError(track_id)
        self._show(current, kept)

    async def _ask_bandcamp(self, position: int, query: TrackQuery) -> SourceList:
        """Liste Bandcamp apres un refus, jamais validee seule : l'utilisateur decide."""
        try:
            found = await self._sources.search(Source.BANDCAMP, query)
        except ApiKeyRejectedError, ApiKeyRejectedRunError:
            # Le 403 ne concerne que ce morceau : arreter le run revient au pipeline.
            return SourceList(Source.BANDCAMP, (), FailureReason.SOURCE_UNAVAILABLE)
        except (SourceUnavailableError, ApiContractError) as exc:
            self._sources.log_source_failure(position, Source.BANDCAMP, exc)
            return SourceList(Source.BANDCAMP, (), FailureReason.SOURCE_UNAVAILABLE)
        retained = classify(query, found, self._sources.thresholds, allow_auto=False).retained
        if retained:
            return SourceList(Source.BANDCAMP, retained)
        reason = FailureReason.BELOW_THRESHOLD if found else FailureReason.NO_RESULT
        return SourceList(Source.BANDCAMP, (), reason)

    def _show(self, current: _Pending, kept: SourceList) -> None:
        """`kept` passe a l'affichage, la liste affichee est mise de cote."""
        shown = current.arbitration
        record = replace(
            current.record,
            arbitration=PendingArbitration(
                kept.source,
                kept.candidates,
                shown.beatport_unavailable,
                empty_reason=kept.empty_reason,
                other=SourceList(shown.source, shown.candidates, shown.empty_reason),
            ),
        )
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
        reason = current.arbitration.empty_reason or FailureReason.USER_REFUSED
        logger.info(
            "arbitration refused run=%s track=%d source=%s status=unresolved reason=%s",
            self._live.run_id,
            current.position,
            Source.BANDCAMP,
            reason,
        )
        self._settle(current.record.unresolved(reason))

    def _pending(self, track_id: str) -> _Pending:
        if track_id in self._busy:
            raise ArbitrationBusyError(track_id)
        record = self._live.record(track_id)
        if record is None or record.arbitration is None or record.query is None:
            raise ArbitrationNotPendingError(track_id)
        return _Pending(record, record.arbitration, record.query, self._live.position(track_id))

    @contextmanager
    def _in_flight(self, track_id: str) -> Generator[None]:
        """Marque le morceau occupe le temps d'un appel, annulation comprise."""
        self._busy.add(track_id)
        try:
            yield
        finally:
            self._busy.discard(track_id)

    def _settle(self, record: TrackRecord) -> None:
        self._live.update(record)
        self._on_event(TrackResolved(record))
