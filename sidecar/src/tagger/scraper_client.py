"""Client de l'API techno-scraper, seule source de donnees du sidecar.

Couche anti-corruption : URL, routes, codes HTTP et noms de champs ne sortent pas
de ce module (ARCHITECTURE.md § Patterns Utilises). Contrat de reference :
techno-scraper 3.1.3, `src/technoscraper/shared/schemas.py`.
"""

import asyncio
import logging
from datetime import date
from enum import UNIQUE, StrEnum, auto, verify
from http import HTTPStatus
from typing import TYPE_CHECKING, ClassVar, Final, Literal, NamedTuple, Self

import httpx2
from pydantic import BaseModel, ConfigDict, ValidationError

from tagger.errors import TaggerError

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable, Mapping

logger = logging.getLogger(__name__)

API_BASE_URL: Final = "https://techno-scraper.empiricmind.fr"

# `q` est borne a 200 caracteres par l'API, qui rend 422 au-dela.
QUERY_MAX_LENGTH: Final = 200

# Miroir des semaphores de sortie de l'API, pas un reglage de performance local :
# emettre davantage ne fait qu'empiler des requetes qui sortent en 504 (ADR-017).
BEATPORT_CONCURRENCY: Final = 3
BANDCAMP_CONCURRENCY: Final = 2

# `read` au-dessus du budget de 90 s de l'API : on recoit son 504 structure plutot
# qu'un timeout local aveugle (ADR-017).
_TIMEOUT: Final = httpx2.Timeout(connect=10.0, read=100.0, write=10.0, pool=10.0)

# Deux nouvelles tentatives sur erreur reseau sans reponse, rien d'autre : un 503 a
# deja ete retente trois fois cote API, un 504 signale une file saturee, un 403 une
# cle a corriger (decision du 2026-09-19).
RETRY_DELAYS: Final = (1.0, 2.0)

# Aucune reponse recue : DNS, connexion refusee ou coupee, delai de connexion depasse.
# Un timeout de lecture, lui, survient apres 100 s et ne se retente pas.
_NETWORK_FAILURES: Final = (httpx2.NetworkError, httpx2.ConnectTimeout, httpx2.RemoteProtocolError)


@verify(UNIQUE)
class Source(StrEnum):
    """Origine d'un morceau, meme vocabulaire que le champ `source` de l'API."""

    BEATPORT = auto()
    BANDCAMP = auto()
    SOUNDCLOUD = auto()


type SearchSource = Literal[Source.BEATPORT, Source.BANDCAMP]


class _ApiModel(BaseModel):
    """Un champ ajoute par l'API reste ignore tant qu'un modele ne le declare pas."""

    model_config = ConfigDict(extra="ignore", frozen=True)


class Credit(_ApiModel):
    """Artiste, remixeur ou label : le sidecar n'en lit que le nom."""

    name: str


class ReleaseInfo(_ApiModel):
    """Sortie du morceau, qui porte date, catalogue et pochette."""

    id: str | None = None
    title: str | None = None
    catalog_number: str | None = None
    release_date: date | None = None
    artwork_url: str | None = None


class TrackCandidate(_ApiModel):
    """Morceau rendu par une source. Un champ nul : la source ne l'expose pas."""

    id: str | None = None
    title: str
    mix_name: str | None = None
    artists: tuple[Credit, ...] = ()
    remixers: tuple[Credit, ...] = ()
    release: ReleaseInfo | None = None
    label: Credit | None = None
    genre: str | None = None
    bpm: int | None = None
    key: str | None = None
    isrc: str | None = None
    track_number: int | None = None
    url: str | None = None
    source: Source


class _TrackPage(_ApiModel):
    items: tuple[TrackCandidate, ...] = ()


class _ApiResponse(NamedTuple):
    payload: object
    request_id: str


class ScraperError(TaggerError):
    """Echec d'un appel a techno-scraper, traduit depuis sa reponse.

    `request_id` est porte par la base et non par chaque feuille : c'est le seul
    lien entre une ligne de log du sidecar et la ligne correspondante cote API, et
    le pipeline le lit sur toute la famille sans savoir laquelle il a rattrapee.
    """

    code: ClassVar[str] = "scraper_error"

    def __init__(self, message: str, *, request_id: str, **params: object) -> None:
        super().__init__(message, request_id=request_id, **params)
        self.request_id = request_id


class ApiKeyRejectedError(ScraperError):
    """403 : cle absente ou invalide, a corriger dans les Settings."""

    code: ClassVar[str] = "api_key_rejected"

    def __init__(self, *, request_id: str) -> None:
        super().__init__("api key rejected", request_id=request_id)


class SourceUnavailableError(ScraperError):
    """La source n'a pas repondu : 5xx, erreur reseau ou timeout local.

    `reason` distingue dans le log un `parse_error` d'une source injoignable, les
    deux donnant le meme `failure_reason`. Il porte soit le `code` du corps
    d'erreur de l'API (`parse_error`, `source_unavailable`, `stale_content`,
    `quota_exceeded`, `request_timeout`, vide si le corps n'en a pas), soit, quand
    aucune reponse n'est arrivee, le motif local rendu par `_failure_reason`.
    """

    code: ClassVar[str] = "source_unavailable"

    def __init__(self, source: Source, *, status: int | None, reason: str, request_id: str) -> None:
        super().__init__(
            f"source unavailable: {source}",
            source=source,
            status=status,
            reason=reason,
            request_id=request_id,
        )
        self.source = source
        self.status = status
        self.reason = reason


class TrackNotFoundError(ScraperError):
    """404 sur un refetch : l'id ou l'URL ne designe aucun morceau."""

    code: ClassVar[str] = "track_not_found"

    def __init__(self, source: Source, *, request_id: str) -> None:
        super().__init__(f"track not found: {source}", source=source, request_id=request_id)


class ApiContractError(ScraperError):
    """Requete refusee ou reponse hors contrat : bug du sidecar ou derive de l'API."""

    code: ClassVar[str] = "api_contract_error"

    def __init__(self, detail: str, *, request_id: str) -> None:
        super().__init__(f"api contract broken: {detail}", request_id=request_id)


class TechnoScraperClient:
    """Recherche et refetch de morceaux sur techno-scraper.

    Le transport et l'attente entre deux tentatives sont injectables : c'est ce
    qui rend le client testable sous `MockTransport` sans dormir.
    """

    def __init__(
        self,
        api_key: str,
        *,
        transport: httpx2.AsyncBaseTransport | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._http = httpx2.AsyncClient(
            base_url=API_BASE_URL,
            headers={"X-API-Key": api_key},
            timeout=_TIMEOUT,
            transport=transport,
        )
        self._sleep = sleep
        self._semaphores: dict[Source, asyncio.Semaphore] = {
            Source.BEATPORT: asyncio.Semaphore(BEATPORT_CONCURRENCY),
            Source.BANDCAMP: asyncio.Semaphore(BANDCAMP_CONCURRENCY),
        }

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *_exc_info: object) -> None:
        await self._http.aclose()

    async def search(self, source: SearchSource, query: str) -> tuple[TrackCandidate, ...]:
        """Premiere page de candidats, vide quand la source ne connait pas le morceau."""
        params = {"q": query[:QUERY_MAX_LENGTH], "type": "tracks"}
        response = await self._get(source, f"/{source}/search", params)
        return _validate(_TrackPage, response).items

    async def fetch_beatport_track(self, track_id: str) -> TrackCandidate:
        """Metadonnees completes : les objets de recherche sont abreges."""
        response = await self._get(Source.BEATPORT, f"/beatport/tracks/{track_id}", {})
        return _validate(TrackCandidate, response)

    async def fetch_bandcamp_track(self, url: str) -> TrackCandidate:
        """Metadonnees completes : la recherche Bandcamp ne rend ni date ni label."""
        response = await self._get(Source.BANDCAMP, "/bandcamp/tracks", {"url": url})
        return _validate(TrackCandidate, response)

    async def _get(
        self, source: SearchSource, path: str, params: Mapping[str, str]
    ) -> _ApiResponse:
        """Point de passage unique de toute requete, ou le cache se branchera."""
        delays = iter(RETRY_DELAYS)
        while True:
            try:
                async with self._semaphores[source]:
                    response = await self._http.get(path, params=params)
            except httpx2.RequestError as exc:
                delay = next(delays, None) if isinstance(exc, _NETWORK_FAILURES) else None
                if delay is None:
                    raise SourceUnavailableError(
                        source, status=None, reason=_failure_reason(exc), request_id=""
                    ) from exc
                logger.warning("network error, retrying source=%s reason=network", source)
                await self._sleep(delay)
            else:
                return _translate(source, response)


def _translate(source: SearchSource, response: httpx2.Response) -> _ApiResponse:
    """Seul endroit ou un code HTTP de l'API est lu."""
    request_id = response.headers.get("X-Request-ID", "")
    try:
        response.raise_for_status()
    except httpx2.HTTPStatusError as exc:
        status = response.status_code
        if status == HTTPStatus.FORBIDDEN:
            raise ApiKeyRejectedError(request_id=request_id) from exc
        if status == HTTPStatus.NOT_FOUND:
            raise TrackNotFoundError(source, request_id=request_id) from exc
        if status >= HTTPStatus.INTERNAL_SERVER_ERROR:
            raise SourceUnavailableError(
                source, status=status, reason=_api_code(response), request_id=request_id
            ) from exc
        raise ApiContractError(f"status {status}", request_id=request_id) from exc
    try:
        payload = response.json()
    except ValueError as exc:
        raise ApiContractError("invalid json", request_id=request_id) from exc
    else:
        return _ApiResponse(payload, request_id)


def _validate[M: BaseModel](model: type[M], response: _ApiResponse) -> M:
    """Seul point de validation d'un corps de reponse."""
    try:
        return model.model_validate(response.payload)
    except ValidationError as exc:
        # `removeprefix` : le souligne d'un modele interne n'apprend rien a qui lit
        # le log, il signale une visibilite qui ne le concerne pas.
        shape = model.__name__.removeprefix("_")
        raise ApiContractError(shape, request_id=response.request_id) from exc


def _api_code(response: httpx2.Response) -> str:
    """Code du corps d'erreur de l'API, vide sur un 403 FastAPI ou un proxy HTML."""
    try:
        body = response.json()
    except ValueError:
        return ""
    code = body.get("code") if isinstance(body, dict) else None
    return code if isinstance(code, str) else ""


def _failure_reason(error: httpx2.RequestError) -> str:
    """Motif d'un echec sans reponse, lu dans le log et dans le rapport.

    `transport` couvre ce que ni le reseau ni le delai n'expliquent : proxy
    injoignable, protocole local casse, redirections en boucle. Rare, mais
    l'etiqueter `timeout` ferait chercher une lenteur la ou il n'y en a pas.
    """
    if isinstance(error, _NETWORK_FAILURES):
        return "network"
    if isinstance(error, httpx2.TimeoutException):
        return "timeout"
    return "transport"
