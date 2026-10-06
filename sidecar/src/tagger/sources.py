"""Acces aux sources d'un run : une seule garde des 403, partagee par pipeline et arbitrage
(ARCHITECTURE.md § Cle API invalide ou revoquee).
"""

import logging
from typing import TYPE_CHECKING, ClassVar, Final, override

import sentry_sdk

from tagger.cache import ArtworkUnavailableError
from tagger.errors import TaggerError
from tagger.scraper_client import (
    ApiContractError,
    ApiKeyRejectedError,
    Source,
    SourceUnavailableError,
    TrackNotFoundError,
)

if TYPE_CHECKING:
    from collections.abc import Awaitable
    from pathlib import Path

    from tagger.cache import ArtworkFetcher
    from tagger.matching import MatchingThresholds, ScoredCandidate, TrackQuery
    from tagger.scraper_client import SearchSource, TechnoScraperClient, TrackCandidate

logger = logging.getLogger(__name__)

API_KEY_REJECTION_LIMIT: Final = 3


class ApiKeyRejectedRunError(TaggerError):
    """Run arrete apres trois 403 consecutifs : la cle est a corriger dans les Settings."""

    code: ClassVar[str] = "api_key_rejected"

    def __init__(self) -> None:
        super().__init__("run stopped after repeated api key rejections")


class _RejectionGuard:
    """Compte les 403 consecutifs, remis a zero par toute autre reponse de l'API."""

    def __init__(self) -> None:
        self._consecutive = 0

    def rejected(self) -> None:
        self._consecutive += 1
        if self._consecutive >= API_KEY_REJECTION_LIMIT:
            raise ApiKeyRejectedRunError()

    def answered(self) -> None:
        """Toute reponse de l'API qui n'est pas un 403 prouve que la cle est acceptee."""
        self._consecutive = 0


class RunSources:
    """Client, pochettes, seuils et garde d'un run. Ne possede aucune ressource."""

    def __init__(
        self,
        run_id: str,
        client: TechnoScraperClient,
        artworks: ArtworkFetcher,
        thresholds: MatchingThresholds,
    ) -> None:
        self.run_id = run_id
        self.thresholds = thresholds
        self._client = client
        self._artworks = artworks
        self._guard = _RejectionGuard()

    @override
    def __repr__(self) -> str:
        return f"RunSources(run_id={self.run_id!r})"

    async def search(self, source: SearchSource, query: TrackQuery) -> tuple[TrackCandidate, ...]:
        return await self._call(self._client.search(source, query.text))

    async def retained(
        self, position: int, source: Source, chosen: ScoredCandidate
    ) -> tuple[TrackCandidate, Path | None]:
        """Candidat recharge et sa pochette ; ni l'un ni l'autre ne fait echouer le morceau."""
        candidate = await self._refetch(position, source, chosen.candidate)
        return candidate, await self._artwork(position, candidate)

    async def from_url(self, position: int, url: str) -> tuple[TrackCandidate, Path | None]:
        """Morceau designe par une URL collee et sa pochette ; seule la pochette peut manquer.

        L'appel passe par `_call` : la garde des 403 du run compte aussi ces gestes.
        """
        candidate = await self._call(self._client.fetch_by_url(url))
        return candidate, await self._artwork(position, candidate)

    def log_source_failure(
        self,
        position: int,
        source: Source,
        exc: SourceUnavailableError | ApiContractError,
    ) -> None:
        # ApiContractError est deja loguee et remontee a Sentry par `_call` : rien a refaire ici.
        if isinstance(exc, SourceUnavailableError):
            logger.warning(
                "source unavailable run=%s track=%d source=%s status=%s reason=%s request_id=%s",
                self.run_id,
                position,
                source,
                exc.status,
                exc.reason,
                exc.request_id,
            )

    async def _refetch(
        self, position: int, source: Source, candidate: TrackCandidate
    ) -> TrackCandidate:
        """Metadonnees completes ; l'objet de recherche est garde si le refetch echoue."""
        try:
            match source:
                case Source.BEATPORT if candidate.id:
                    return await self._call(self._client.fetch_beatport_track(candidate.id))
                case Source.BANDCAMP if candidate.url:
                    return await self._call(self._client.fetch_bandcamp_track(candidate.url))
                case _:
                    return candidate
        except (
            ApiKeyRejectedError,
            SourceUnavailableError,
            TrackNotFoundError,
            ApiContractError,
        ) as exc:
            logger.warning(
                "refetch failed, search candidate kept run=%s track=%d source=%s reason=%s",
                self.run_id,
                position,
                source,
                exc.code,
            )
            return candidate

    async def _artwork(self, position: int, candidate: TrackCandidate) -> Path | None:
        url = candidate.release.artwork_url if candidate.release else None
        if url is None:
            return None
        try:
            return await self._artworks.fetch(url)
        except ArtworkUnavailableError as exc:
            logger.warning(
                "artwork unavailable run=%s track=%d reason=%s",
                self.run_id,
                position,
                exc.reason,
            )
            return None

    async def _call[T](self, request: Awaitable[T]) -> T:
        """Passe chaque appel par la garde des 403 et remonte un contrat casse a Sentry."""
        try:
            result = await request
        except ApiKeyRejectedError:
            self._guard.rejected()
            raise
        except ApiContractError as exc:
            self._guard.answered()
            logger.exception(
                "api contract broken run=%s request_id=%s", self.run_id, exc.request_id
            )
            sentry_sdk.capture_exception(exc)
            raise
        except SourceUnavailableError as exc:
            # Une erreur reseau n'est pas une reponse : elle ne remet pas la garde a zero.
            if exc.status is not None:
                self._guard.answered()
            raise
        except TrackNotFoundError:
            self._guard.answered()
            raise
        self._guard.answered()
        return result
