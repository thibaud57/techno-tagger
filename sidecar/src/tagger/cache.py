"""Cache disque des reponses API et des pochettes.

Le dossier est jetable a tout moment, y compris en plein run : seuls des appels
reseau sont a repayer (ADR-013). Aucun index : l'age d'une entree est dans son nom
(`<sha256 de la cle>.<epoch d'ecriture>.<extension>`), son dernier usage dans son
mtime, touche a chaque lecture. La date de creation Windows n'est pas utilisee : le
tunneling NTFS la recopie quand un fichier est recree sous le meme nom.
"""

import asyncio
import contextlib
import hashlib
import json
import logging
import os
import socket
import threading
import time
from dataclasses import dataclass
from datetime import timedelta
from ipaddress import ip_address
from typing import TYPE_CHECKING, BinaryIO, ClassVar, Final, NamedTuple, Self
from urllib.parse import urlsplit
from uuid import uuid4

import httpx2

from tagger.errors import TaggerError

if TYPE_CHECKING:
    from collections.abc import Callable, Generator, Mapping
    from pathlib import Path

logger = logging.getLogger(__name__)

# Injectable : les tests ne resolvent aucun nom, et l'appel bloque sinon la boucle.
type HostResolver = Callable[[str], list[str]]

CACHE_TTL: Final = timedelta(days=30)
CACHE_MAX_BYTES: Final = 500 * 1000 * 1000

# Pool du CDN des pochettes, distinct des semaphores de l'API (ADR-017).
ARTWORK_CONCURRENCY: Final = 6

# `read` court : un CDN sert un fichier statique, pas de budget de 90 s a couvrir
# comme l'API. Les autres phases alignees sur `scraper_client._TIMEOUT` : memes
# conditions reseau locales.
_ARTWORK_TIMEOUT: Final = httpx2.Timeout(connect=10.0, read=30.0, write=10.0, pool=10.0)

_ARTWORK_EXTENSIONS: Final = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}

# Une pochette vit sur un CDN public : quelques sauts suffisent, et la borne evite
# qu'une boucle de redirections ne tienne une place du pool jusqu'au timeout.
_ARTWORK_MAX_REDIRECTS: Final = 5

_HASH_LENGTH: Final = 64
_TMP_SUFFIX: Final = ".tmp"


def resolve_host(host: str) -> list[str]:
    """Adresses d'un hote, telles que la pile reseau les rendra a la connexion."""
    # `sockaddr[0]` est l'adresse en v4 comme en v6, le reste du tuple diffère.
    return [str(info[4][0]) for info in socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)]


@dataclass(frozen=True, slots=True)
class _Entry:
    path: Path
    key_hash: str
    written_at: int


@dataclass(frozen=True, slots=True)
class PendingWrite:
    """Ecriture ouverte : `file` est le `.tmp`, `path` l'entree une fois publiee."""

    file: BinaryIO
    temporary: Path
    path: Path
    key_hash: str


class DiskCache:
    """Entrees par cle, expirees apres `CACHE_TTL`, evincees au-dela de `max_bytes`.

    Synchrone : le code asynchrone l'appelle par `asyncio.to_thread`. Un fichier ou
    un dossier disparu equivaut toujours a une entree absente.
    """

    def __init__(
        self,
        root: Path,
        *,
        max_bytes: int = CACHE_MAX_BYTES,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._root = root
        self._ttl = CACHE_TTL.total_seconds()
        self._max_bytes = max_bytes
        self._clock = clock
        # RLock : `commit` mute `_size` puis appelle `discard` et `_evict`, qui le
        # mutent aussi depuis le meme thread. Un Lock simple y ferait un interblocage.
        self._lock = threading.RLock()
        self._size = self._open()

    @property
    def size(self) -> int:
        """Taille totale des entrees publiees, en octets."""
        return self._size

    def get(self, key: str) -> Path | None:
        """Chemin de l'entree, ou `None` si elle est absente ou expiree."""
        entry = self._find(_hash(key))
        if entry is None:
            return None
        if self._expired(entry):
            self.discard(entry.path)
            return None
        now = self._clock()
        try:
            os.utime(entry.path, (now, now))
        except FileNotFoundError:
            return None
        except OSError:
            # Le mtime n'a pas pu etre rafraichi : l'entree reste servie, elle
            # paraitra seulement plus ancienne a la prochaine eviction.
            logger.warning("cache entry not touched reason=utime_failed")
        return entry.path

    def discard(self, path: Path) -> None:
        """Supprime une entree, sans erreur si elle a deja disparu ni si elle resiste.

        Sous Windows, un antivirus qui tient un fichier ouvert fait lever
        `PermissionError` a `unlink`. L'entree reste alors en place et sera reprise a
        l'eviction suivante : elle ne doit pas faire echouer l'appel en cours (ADR-013).
        """
        with self._lock:
            size = _size_of(path)
            if _unlink(path):
                self._size = max(0, self._size - size)

    def begin(self, key: str, extension: str) -> PendingWrite:
        """Ouvre une ecriture sur un `.tmp` : rien n'est visible avant `commit`."""
        key_hash = _hash(key)
        path = self._root / f"{key_hash}.{int(self._clock())}.{extension}"
        # Deux ecritures de la meme cle dans la meme seconde partagent `path`, jamais
        # leur `.tmp` : le dernier `commit` gagne, aucun octet ne s'interleave.
        temporary = path.with_name(f"{path.name}.{uuid4().hex}{_TMP_SUFFIX}")
        self._root.mkdir(parents=True, exist_ok=True)
        return PendingWrite(temporary.open("wb"), temporary, path, key_hash)

    def commit(self, pending: PendingWrite) -> Path:
        """Publie l'entree, remplace sa version anterieure, puis evince au besoin."""
        pending.file.close()
        now = self._clock()
        os.utime(pending.temporary, (now, now))
        with self._lock:
            previous = self._find(pending.key_hash)
            if previous is not None:
                self.discard(previous.path)
            pending.temporary.replace(pending.path)
            self._size += _size_of(pending.path)
            self._evict(keep=pending.path)
        return pending.path

    def abort(self, pending: PendingWrite) -> None:
        """Abandonne l'ecriture : le `.tmp` est supprime, rien n'est publie.

        Ne leve jamais : `abort` est appele depuis un `except`, et une erreur de
        nettoyage y remplacerait l'echec qu'on est en train de traiter. Un `.tmp`
        verrouille ferait sinon sortir un `OSError` brut la ou l'appelant attend une
        erreur metier, et le morceau echouerait pour un residu de cache (ADR-013).
        """
        with contextlib.suppress(OSError):
            pending.file.close()
        _unlink(pending.temporary)

    @contextlib.contextmanager
    def writer(self, key: str, extension: str) -> Generator[BinaryIO]:
        """Ecriture d'un bloc : publiee a la sortie, abandonnee sur toute erreur."""
        pending = self.begin(key, extension)
        published = False
        try:
            yield pending.file
            self.commit(pending)
            published = True
        finally:
            if not published:
                # `commit` est dans le `try` : sans lui, un echec avant la publication
                # laisserait un `.tmp` orphelin jusqu'au prochain demarrage.
                self.abort(pending)

    def _open(self) -> int:
        """Un seul parcours : `.tmp` orphelins et entrees expirees purges, taille comptee."""
        total = 0
        for scanned in self._scan():
            path = self._root / scanned.name
            if scanned.name.endswith(_TMP_SUFFIX):
                _unlink(path)
                continue
            entry = _parse(path)
            if entry is None:
                continue
            if self._expired(entry):
                _unlink(path)
                continue
            total += _size_of(scanned)
        return total

    def _find(self, key_hash: str) -> _Entry | None:
        entries = (_parse(path) for path in self._root.glob(f"{key_hash}.*"))
        return max(
            (entry for entry in entries if entry is not None),
            key=lambda entry: entry.written_at,
            default=None,
        )

    def _expired(self, entry: _Entry) -> bool:
        return self._clock() - entry.written_at > self._ttl

    def _evict(self, *, keep: Path) -> None:
        with self._lock:
            if self._size <= self._max_bytes:
                return
            # Taille recomptee avant d'evincer : un dossier vide par l'utilisateur
            # laisserait sinon un total perime qui evincerait toutes les entrees neuves.
            candidates: list[tuple[float, Path]] = []
            total = 0
            for scanned in self._scan():
                path = self._root / scanned.name
                if _parse(path) is None:
                    continue
                try:
                    stat = scanned.stat()
                except OSError:
                    continue
                total += stat.st_size
                if path != keep:
                    candidates.append((stat.st_mtime, path))
            self._size = total
            for _last_used, path in sorted(candidates):
                if self._size <= self._max_bytes:
                    break
                self.discard(path)

    def _scan(self) -> list[os.DirEntry[str]]:
        """`scandir` et non `iterdir` : l'enumeration porte deja type, taille et mtime,
        qu'un `Path.stat()` par fichier redemanderait au systeme. Le parcours de
        `_evict` se paie sous verrou a chaque ecriture, une fois le plafond atteint.
        """
        try:
            with os.scandir(self._root) as entries:
                return [entry for entry in entries if entry.is_file()]
        except OSError:
            return []


def response_key(path: str, params: Mapping[str, str]) -> str:
    """Route et parametres tries : l'ordre des parametres ne change pas la cle."""
    return json.dumps([path, sorted(params.items())], ensure_ascii=False)


class CachedResponse(NamedTuple):
    """Corps relu, et l'entree d'ou il sort : l'appelant la jette sans la rechercher."""

    payload: object
    entry: Path


class ResponseCache:
    """Reponses 2xx de techno-scraper, resultat vide compris (ADR-013)."""

    def __init__(self, disk: DiskCache) -> None:
        self._disk = disk

    def get(self, path: str, params: Mapping[str, str]) -> CachedResponse | None:
        """Corps JSON en cache, `None` si absent, expire ou illisible."""
        entry = self._disk.get(response_key(path, params))
        if entry is None:
            return None
        try:
            payload: object = json.loads(entry.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        except ValueError:
            self._disk.discard(entry)
            return None
        return CachedResponse(payload, entry)

    def put(self, path: str, params: Mapping[str, str], payload: object) -> None:
        """Un echec d'ecriture est logue puis avale : la reponse est deja en main."""
        try:
            with self._disk.writer(response_key(path, params), "json") as file:
                file.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
        except OSError:
            logger.warning("response not cached reason=write_failed")

    def discard(self, entry: Path) -> None:
        """Retire une reponse que le modele a jugee hors contrat."""
        self._disk.discard(entry)


class ArtworkUnavailableError(TaggerError):
    """La pochette n'a pas pu etre telechargee : le morceau continue sans elle.

    L'URL n'entre pas dans les params : elle designe une sortie, donc un titre.
    """

    code: ClassVar[str] = "artwork_unavailable"

    def __init__(self, reason: str) -> None:
        super().__init__(f"artwork unavailable: {reason}", reason=reason)
        self.reason = reason


class ArtworkFetcher:
    """Pochettes telechargees depuis le CDN de la source, une seule fois par URL.

    Sans nouvelle tentative : une pochette manquee se retente au run suivant.
    """

    def __init__(
        self,
        cache: DiskCache,
        *,
        transport: httpx2.AsyncBaseTransport | None = None,
        resolve: HostResolver = resolve_host,
    ) -> None:
        self._cache = cache
        self._resolve = resolve
        # Sans X-API-Key : `release.artwork_url` pointe le CDN, pas l'API. Les
        # redirections se suivent a la main : chaque saut doit repasser le controle
        # d'URL, qu'un `follow_redirects=True` sauterait.
        self._http = httpx2.AsyncClient(
            timeout=_ARTWORK_TIMEOUT, transport=transport, follow_redirects=False
        )
        self._semaphore = asyncio.Semaphore(ARTWORK_CONCURRENCY)
        # Deux morceaux d'une meme sortie portent la meme `artwork_url` : sans ce
        # registre, tous deux manquent le cache et telechargent la meme image.
        self._in_flight: dict[str, asyncio.Task[Path]] = {}

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *_exc_info: object) -> None:
        # `shield` detache les telechargements de l'annulation de leurs appelants : un
        # run avorte les laisse en vol, et fermer le client sous eux leverait dans une
        # tache que plus personne n'attend. Les solder d'abord, `gather` recuperant les
        # exceptions de celles qui etaient trop avancees pour s'annuler.
        pending = list(self._in_flight.values())
        for running in pending:
            running.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
        await self._http.aclose()

    async def fetch(self, url: str) -> Path:
        """Chemin de la pochette en cache, telechargee au premier appel."""
        cached = await asyncio.to_thread(self._cache.get, url)
        if cached is not None:
            return cached
        running = self._in_flight.get(url)
        if running is None:
            running = asyncio.create_task(self._fetch_once(url), name=f"artwork:{_hash(url)}")
            self._in_flight[url] = running
            running.add_done_callback(lambda _task: self._in_flight.pop(url, None))
        # `shield` : un appelant annule n'emporte pas le telechargement que les autres
        # attendent. La task se termine, et le prochain appel lira le cache.
        return await asyncio.shield(running)

    async def _fetch_once(self, url: str) -> Path:
        async with self._semaphore:
            try:
                return await self._download(url)
            except httpx2.RequestError as exc:
                raise ArtworkUnavailableError("network") from exc

    async def _download(self, url: str) -> Path:
        target = url
        for _hop in range(_ARTWORK_MAX_REDIRECTS + 1):
            await _check_artwork_url(target, self._resolve)
            async with self._http.stream("GET", target) as response:
                _check_connected_address(response)
                if response.is_redirect:
                    location = response.headers.get("Location", "")
                    if not location:
                        raise ArtworkUnavailableError("blocked_url")
                    target = str(response.url.join(location))
                    continue
                return await self._store(url, response)
        raise ArtworkUnavailableError("too_many_redirects")

    async def _store(self, key: str, response: httpx2.Response) -> Path:
        try:
            response.raise_for_status()
        except httpx2.HTTPStatusError as exc:
            raise ArtworkUnavailableError(f"status_{response.status_code}") from exc
        # Un type de media est insensible a la casse (RFC 9110) : un `image/JPEG`
        # designe bien un JPEG.
        content_type = response.headers.get("Content-Type", "").split(";")[0].strip().lower()
        extension = _ARTWORK_EXTENSIONS.get(content_type)
        if extension is None:
            raise ArtworkUnavailableError("not_an_image")
        try:
            pending = await asyncio.to_thread(self._cache.begin, key, extension)
        except OSError as exc:
            raise ArtworkUnavailableError("cache_write") from exc
        try:
            async for chunk in response.aiter_bytes():
                await asyncio.to_thread(pending.file.write, chunk)
            return await asyncio.to_thread(self._cache.commit, pending)
        except BaseException as exc:
            await asyncio.to_thread(self._cache.abort, pending)
            if isinstance(exc, OSError):
                raise ArtworkUnavailableError("cache_write") from exc
            raise


async def _check_artwork_url(url: str, resolve: HostResolver) -> None:
    """Refuse une URL de pochette qui ne designe pas un CDN public, avant d'emettre.

    `artwork_url` arrive dans une reponse de l'API : c'est la seule valeur du contrat
    qui declenche une requete vers une adresse libre. Une API detournee pointerait
    sinon la boucle locale ou le reseau de l'utilisateur, et les motifs d'echec rendus
    suffiraient a sonder ce qui y repond. Aucune liste blanche de domaines ici : les
    hotes des CDN ne sont documentes nulle part, en inventer une la ferait casser au
    premier changement de CDN sans rien apprendre a qui la lirait.

    L'hote est resolu puis juge sur ses adresses, et non sur sa forme : un nom de
    domaine dont l'enregistrement pointe la boucle locale passerait un controle qui ne
    regarderait que les adresses ecrites en clair. Le rebinding, ou le DNS rend une
    autre adresse entre ce controle et la connexion, est rattrape apres coup par
    `_check_connected_address` : seule la connexion TCP part alors, sans qu'aucune
    reponse ne soit lue.
    """
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ArtworkUnavailableError("blocked_url")
    try:
        address = ip_address(parsed.hostname)
    except ValueError:
        pass
    else:
        if not address.is_global:
            raise ArtworkUnavailableError("blocked_url")
        return
    try:
        resolved = await asyncio.to_thread(resolve, parsed.hostname)
    except OSError as exc:
        raise ArtworkUnavailableError("network") from exc
    if not resolved or not all(ip_address(found).is_global for found in resolved):
        raise ArtworkUnavailableError("blocked_url")


def _check_connected_address(response: httpx2.Response) -> None:
    """Refuse une reponse venue d'une adresse que le controle prealable aurait refusee.

    `_check_artwork_url` resout l'hote, mais httpx2 resout le sien a la connexion : un
    DNS qui rend une adresse publique au premier appel et une adresse interne au second
    passerait le garde. Relire l'adresse reellement connectee ferme ce rebinding pour le
    corps de la reponse, qui n'est alors ni lu ni mis en cache, et rend tous ces cas
    sous un `blocked_url` unique, qui n'apprend rien sur ce qui repond en interne.

    La connexion TCP, elle, a bien eu lieu : l'exclure demanderait d'epingler l'adresse
    validee jusque dans le transport, ce que httpx2 n'expose pas.
    """
    stream = response.extensions.get("network_stream")
    if stream is None:
        return
    connected = stream.get_extra_info("server_addr")
    if not connected:
        return
    try:
        address = ip_address(connected[0])
    except ValueError:
        raise ArtworkUnavailableError("blocked_url") from None
    if not address.is_global:
        raise ArtworkUnavailableError("blocked_url")


def _hash(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def _parse(path: Path) -> _Entry | None:
    """`<hash>.<epoch>.<extension>` ; tout autre nom est ignore et jamais supprime."""
    key_hash, _, rest = path.name.partition(".")
    written_at, _, extension = rest.partition(".")
    if len(key_hash) != _HASH_LENGTH or not written_at.isdigit() or not extension:
        return None
    if "." in extension:
        return None
    return _Entry(path, key_hash, int(written_at))


def _size_of(statable: Path | os.DirEntry[str]) -> int:
    """Zero sur un fichier illisible : sous-compter fait recompter, jamais echouer.

    Un `DirEntry` rend ici la taille deja portee par l'enumeration, sans redemander
    un `stat` au systeme ; un `Path` le redemande, faute de mieux.
    """
    try:
        return statable.stat().st_size
    except OSError:
        return 0


def _unlink(path: Path) -> bool:
    """Supprime une entree et dit si elle a cede, sans jamais lever (ADR-013)."""
    try:
        path.unlink(missing_ok=True)
    except OSError:
        logger.warning("cache entry not deleted reason=unlink_failed")
        return False
    return True
