"""Client de l'API techno-scraper, seule source de donnees du sidecar.

Couche anti-corruption : URL, routes, codes HTTP et noms de champs ne sortent pas
de ce module (ARCHITECTURE.md § Patterns Utilises). Contrat de reference :
techno-scraper 4.0.0, `src/technoscraper/shared/schemas.py`.
"""

import asyncio
import logging
import re
from datetime import date
from enum import UNIQUE, StrEnum, auto, verify
from http import HTTPStatus
from typing import TYPE_CHECKING, ClassVar, Final, Literal, NamedTuple, Self, assert_never
from urllib.parse import urlsplit

import httpx2
from pydantic import BaseModel, ConfigDict, RootModel, ValidationError

from tagger.errors import TaggerError

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable, Mapping

    from tagger.cache import ResponseCache

logger = logging.getLogger(__name__)

API_BASE_URL: Final = "https://techno-scraper.empiricmind.fr"

# `q` est borne a 200 caracteres par l'API, qui rend 422 au-dela.
QUERY_MAX_LENGTH: Final = 200

# Valeur de l'enumeration fermee de la gateway (5/10/25/50/100), defaut 25. Le scoring
# ne retient que les premiers rangs (mesure le 2026-09-20 : candidat retenu aux rangs 1 a 3
# sur dix recherches).
SEARCH_PAGE_SIZE: Final = 10

# Miroir des semaphores de sortie de l'API, pas un reglage de performance local :
# emettre davantage ne fait qu'empiler des requetes qui sortent en 504 (ADR-017).
BEATPORT_CONCURRENCY: Final = 3
BANDCAMP_CONCURRENCY: Final = 2
SOUNDCLOUD_CONCURRENCY: Final = 5

# `read` au-dessus du budget de 90 s de l'API : on recoit son 504 structure plutot
# qu'un timeout local aveugle.
_TIMEOUT: Final = httpx2.Timeout(connect=10.0, read=100.0, write=10.0, pool=10.0)

# Deux nouvelles tentatives sur erreur reseau sans reponse, rien d'autre : un 503 a
# deja ete retente trois fois cote API, un 504 signale une file saturee, un 403 une
# cle a corriger (decision du 2026-09-19).
RETRY_DELAYS: Final = (1.0, 2.0)

# Aucune reponse recue : DNS, connexion refusee ou coupee, delai de connexion depasse.
# Un timeout de lecture, lui, survient apres 100 s et ne se retente pas.
_NETWORK_FAILURES: Final = (httpx2.NetworkError, httpx2.ConnectTimeout, httpx2.RemoteProtocolError)

# Formes d'URL de morceau acceptees au rattrapage. Bandcamp recopie le pattern de
# `/bandcamp/tracks`, qui rend 422 sur une query, `http://` ou `/album/` ; Beatport
# n'a pas de route par URL, l'id se lit dans l'URL publique que l'API elle-meme rend.
_BEATPORT_HOSTS: Final = frozenset({"www.beatport.com", "beatport.com"})
_BEATPORT_TRACK_PATH: Final = re.compile(r"/track/[^/]+/(?P<id>\d+)")
_BANDCAMP_HOST: Final = re.compile(r"[a-z0-9][a-z0-9-]*\.bandcamp\.com")
_BANDCAMP_TRACK_PATH: Final = re.compile(r"/track/[\w-]+")

# SoundCloud rend 404 sur `www.`, `m.` et un `/` final (constat techno-scraper du
# 2026-09-30) ; un lien court se resout de son cote, parfois vers une playlist.
_SOUNDCLOUD_HOSTS: Final = frozenset({"soundcloud.com", "www.soundcloud.com", "m.soundcloud.com"})
_SOUNDCLOUD_TRACK_PATH: Final = re.compile(r"/[^/]+/[^/]+")
_SOUNDCLOUD_SHORT_HOST: Final = "on.soundcloud.com"
_SOUNDCLOUD_SHORT_PATH: Final = re.compile(r"/[^/]+")


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


class _ProfileEnvelope(_ApiModel):
    """`UserProfile` de `/soundcloud/resolve` : seule sa cle `profile` le distingue d'un `Track`."""

    profile: dict[str, object]


class _Resolved(RootModel[TrackCandidate | _ProfileEnvelope]):
    """Reponse de `/soundcloud/resolve`, morceau ou profil selon l'URL."""


class _ApiResponse(NamedTuple):
    payload: object
    request_id: str


class _TrackUrl(NamedTuple):
    """Cible d'une URL de morceau : id Beatport, ou URL normalisee pour les autres."""

    source: Source
    reference: str


class ScraperError(TaggerError):
    """Echec d'un appel a techno-scraper, traduit depuis sa reponse.

    `request_id` vit sur la base : le pipeline le logue sans savoir laquelle des
    quatre il vient de rattraper.
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
    deux donnant le meme `failure_reason`. Il porte le `code` du corps d'erreur de
    l'API, ou le motif de `_failure_reason` quand aucune reponse n'est arrivee.
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


class UnsupportedTrackUrlError(TaggerError):
    """URL collee qui ne designe pas un morceau d'une source acceptee, refusee sans appel.

    Sans `params` : l'URL peut nommer l'artiste et le morceau.
    """

    code: ClassVar[str] = "unsupported_url"

    def __init__(self) -> None:
        super().__init__("unsupported track url")


class TechnoScraperClient:
    """Recherche, refetch et resolution d'URL de morceaux sur techno-scraper.

    Le transport et l'attente entre deux tentatives sont injectables : c'est ce
    qui rend le client testable sous `MockTransport` sans dormir.
    """

    def __init__(
        self,
        api_key: str,
        *,
        transport: httpx2.AsyncBaseTransport | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        cache: ResponseCache | None = None,
    ) -> None:
        self._http = httpx2.AsyncClient(
            base_url=API_BASE_URL,
            headers={"X-API-Key": api_key},
            timeout=_TIMEOUT,
            transport=transport,
        )
        self._sleep = sleep
        self._cache = cache
        self._semaphores: dict[Source, asyncio.Semaphore] = {
            Source.BEATPORT: asyncio.Semaphore(BEATPORT_CONCURRENCY),
            Source.BANDCAMP: asyncio.Semaphore(BANDCAMP_CONCURRENCY),
            Source.SOUNDCLOUD: asyncio.Semaphore(SOUNDCLOUD_CONCURRENCY),
        }

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *_exc_info: object) -> None:
        await self._http.aclose()

    async def search(self, source: SearchSource, query: str) -> tuple[TrackCandidate, ...]:
        """Premiere page de candidats, vide quand la source ne connait pas le morceau.

        `limit` reste constant a chaque appel et le client ne relit jamais de curseur :
        il ne peut donc declencher ni `cursor_limit_mismatch` ni `cursor_scope_mismatch`
        (`.claude/rules/techno-scraper/contrat.md`).
        """
        params = {
            "q": query[:QUERY_MAX_LENGTH],
            "type": "tracks",
            "limit": str(SEARCH_PAGE_SIZE),
        }
        try:
            return (await self._get(source, f"/{source}/search", params, _TrackPage)).items
        except TrackNotFoundError as exc:
            # Une recherche sans resultat rend 200 et une page vide : le 404 est reserve
            # au refetch d'un id ou d'une URL. Ici, c'est une derive de l'API.
            raise ApiContractError("not found on a search", request_id=exc.request_id) from exc

    async def fetch_beatport_track(self, track_id: str) -> TrackCandidate:
        """Metadonnees completes : seul `track_number` manque en recherche Beatport."""
        return await self._get(Source.BEATPORT, f"/beatport/tracks/{track_id}", {}, TrackCandidate)

    async def fetch_bandcamp_track(self, url: str) -> TrackCandidate:
        """Metadonnees completes : la recherche Bandcamp ne rend ni date ni label."""
        return await self._get(Source.BANDCAMP, "/bandcamp/tracks", {"url": url}, TrackCandidate)

    async def fetch_by_url(self, url: str) -> TrackCandidate:
        """Morceau designe par une URL collee par l'utilisateur.

        Leve `UnsupportedTrackUrlError` sans aucun appel quand l'URL ne designe pas un
        morceau d'une source acceptee : envoyee telle quelle, elle prendrait un 422 lu
        comme un contrat casse.
        """
        target = _parse_track_url(url)
        match target.source:
            case Source.BEATPORT:
                return await self.fetch_beatport_track(target.reference)
            case Source.BANDCAMP:
                return await self.fetch_bandcamp_track(target.reference)
            case Source.SOUNDCLOUD:
                return await self._resolve_soundcloud(target.reference)
            case unreachable:
                assert_never(unreachable)

    async def _resolve_soundcloud(self, url: str) -> TrackCandidate:
        """`tracks_cursor` n'est jamais envoye : sur un morceau, l'API le refuse en 400."""
        resolved = await self._get(
            Source.SOUNDCLOUD, "/soundcloud/resolve", {"url": url}, _Resolved
        )
        if isinstance(resolved.root, _ProfileEnvelope):
            raise UnsupportedTrackUrlError
        return resolved.root

    async def _request(self, source: Source, path: str, params: Mapping[str, str]) -> _ApiResponse:
        """Emet la requete avec nouvelle tentative et semaphore ; le cache n'est pas son affaire."""
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

    async def _get[M: BaseModel](
        self, source: Source, path: str, params: Mapping[str, str], model: type[M]
    ) -> M:
        """Point de passage unique de toute requete, cache et validation compris.

        Le cache est lu avant le semaphore : un hit ne prend aucune place du pool.
        Invariant : une reponse n'entre au cache qu'apres validation reussie, et une
        entree que le modele rejette est jetee puis rejouee en requete reelle, ce qui
        lui evite de rejouer la meme erreur pendant trente jours.
        """
        if self._cache is not None:
            cached = await asyncio.to_thread(self._cache.get, path, params)
            if cached is not None:
                try:
                    return _validate(model, _ApiResponse(cached.payload, ""))
                except ApiContractError:
                    await asyncio.to_thread(self._cache.discard, cached.entry)
        response = await self._request(source, path, params)
        validated = _validate(model, response)
        if self._cache is not None:
            await asyncio.to_thread(self._cache.put, path, params, response.payload)
        return validated


def _translate(source: Source, response: httpx2.Response) -> _ApiResponse:
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
        # Le souligne d'un modele interne n'apprend rien a qui lit le log.
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

    `transport` couvre le reste (proxy injoignable, protocole local casse) :
    l'etiqueter `timeout` ferait chercher une lenteur la ou il n'y en a pas.
    """
    if isinstance(error, _NETWORK_FAILURES):
        return "network"
    if isinstance(error, httpx2.TimeoutException):
        return "timeout"
    return "transport"


def _parse_track_url(pasted: str) -> _TrackUrl:
    """Source et cible d'une URL collee, normalisee comme l'attend sa route.

    Query, fragment et `/` final tombent, `hostname` rend l'hote en minuscules et
    `http` devient `https`. La casse du chemin est conservee.
    """
    try:
        parts = urlsplit(pasted.strip())
    except ValueError:
        raise UnsupportedTrackUrlError from None
    host = parts.hostname or ""
    path = parts.path.rstrip("/")
    if parts.scheme in {"http", "https"}:
        if host in _BEATPORT_HOSTS and (match := _BEATPORT_TRACK_PATH.fullmatch(path)):
            return _TrackUrl(Source.BEATPORT, match.group("id"))
        if _BANDCAMP_HOST.fullmatch(host) and _BANDCAMP_TRACK_PATH.fullmatch(path):
            return _TrackUrl(Source.BANDCAMP, f"https://{host}{path}")
        if host in _SOUNDCLOUD_HOSTS and _SOUNDCLOUD_TRACK_PATH.fullmatch(path):
            return _TrackUrl(Source.SOUNDCLOUD, f"https://soundcloud.com{path}")
        if host == _SOUNDCLOUD_SHORT_HOST and _SOUNDCLOUD_SHORT_PATH.fullmatch(path):
            return _TrackUrl(Source.SOUNDCLOUD, f"https://{host}{path}")
    raise UnsupportedTrackUrlError
