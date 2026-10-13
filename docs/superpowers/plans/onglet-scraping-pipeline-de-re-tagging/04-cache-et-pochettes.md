# Cache disque des réponses et des pochettes : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mettre en cache disque les réponses de l'API et les pochettes téléchargées, avec expiration et plafond de taille.

**Architecture:** La racine des données de l'application sort de `__main__.log_dir()` vers `tagger/paths.py`. Dans `tagger/cache.py`, `DiskCache` stocke une entrée par fichier nommé `<sha256>.<epoch>.<extension>`, sans index : l'âge se lit dans le nom, le dernier usage dans le `mtime`. Au-dessus, `ResponseCache` sert le client techno-scraper et `ArtworkFetcher` télécharge les pochettes du CDN en pool de 6.

**Tech Stack:** Python 3.14 (`hashlib`, `json`, `os.utime`, `contextlib`, `asyncio`), httpx2 2.12 (`stream`, `MockTransport`), pytest + pytest-asyncio (mode strict). Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/onglet-scraping-pipeline-de-re-tagging/04-cache-et-pochettes-design.md`

## Global Constraints

- **Dépend du sub-project 02** : `tagger.scraper_client.TechnoScraperClient` existe, avec `_get(source, path, params) -> _ApiResponse(payload, request_id)` qui porte la boucle de nouvelle tentative et le sémaphore. Le helper de test `make_client(handler, *, sleep=no_sleep)` existe dans `sidecar/tests/helpers/scraper_responses.py`.
- **Racine** : `%LOCALAPPDATA%/<BUNDLE_IDENTIFIER>`, repli `Path.home() / "AppData" / "Local"`. Logs dans `logs/`, cache dans `cache/responses/` et `cache/artworks/`.
- **TTL** `timedelta(days=30)`, **plafond** `500 * 1000 * 1000` octets, **pool des pochettes** 6.
- **Nom d'entrée** : `<sha256 hex de la clé>.<epoch entier d'écriture>.<extension>`. Tout autre nom est ignoré et jamais supprimé, sauf les `.tmp`, purgés à l'ouverture.
- **Tolérance** : un `FileNotFoundError` équivaut toujours à un miss, le cache ne fait jamais échouer un appel (ADR-013).
- **Seules les réponses 2xx** sont mises en cache, résultat vide compris. Jamais une erreur.
- **Pochettes** : sans `X-API-Key`, extension tirée du `Content-Type` (`image/jpeg` → `jpg`, `image/png` → `png`, `image/webp` → `webp`), échec traduit en `ArtworkUnavailableError(reason)`, code `artwork_unavailable`, sans nouvelle tentative.
- **IO disque depuis le code asynchrone** toujours par `asyncio.to_thread`.
- **Tests** : noms en anglais, AAA séparé par des lignes vides, horloge injectée, écriture dans `tmp_path`, `MockTransport` pour tout HTTP.
- **Gate qualité vert à chaque commit** : `just test`, `just lint`, `just typecheck`. Commits `type(scope): description`, scope `cache`.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `sidecar/src/tagger/paths.py` | `app_data_dir()`, source unique de la racine des données. |
| `sidecar/src/tagger/__main__.py` | `log_dir()` dérivé de `app_data_dir()`. |
| `sidecar/src/tagger/cache.py` | `DiskCache`, `PendingWrite`, `ResponseCache`, `response_key`, `ArtworkFetcher`, `ArtworkUnavailableError`. |
| `sidecar/src/tagger/scraper_client.py` | Paramètre `cache`, lecture avant la requête et écriture après succès. |
| `sidecar/tests/helpers/fake_clock.py` | Horloge réglable partagée par les tests du cache. |
| `sidecar/tests/helpers/scraper_responses.py` | `make_client` accepte un `cache`. |
| `sidecar/tests/unit/test_paths.py` | Racine des données. |
| `public/i18n/fr.json`, `public/i18n/en.json` | Phrase du code `artwork_unavailable`, exigée par `test_error_translations.py`. |
| `docs/ARCHITECTURE.md` | Arborescence : `paths.py`. |
| `sidecar/tests/unit/test_cache_disk.py` | TTL, LRU, plafond, tolérances, réponses. |
| `sidecar/tests/unit/test_scraper_client_requests.py` | Réponses servies depuis le cache. |
| `sidecar/tests/unit/test_cache_artworks.py` | Téléchargement des pochettes. |

---

## Task 1: Racine des données de l'application

**Files:**
- Create: `sidecar/src/tagger/paths.py`
- Modify: `sidecar/src/tagger/__main__.py:42-53`
- Modify: `docs/ARCHITECTURE.md` (§ Organisation du Code, arborescence)
- Test: `sidecar/tests/unit/test_paths.py`

**Interfaces:**
- Produces: `app_data_dir() -> Path`

- [ ] **Step 1: Écrire le test**

Créer `sidecar/tests/unit/test_paths.py` :

```python
"""Tests de la racine des donnees de l'application."""

from pathlib import Path

import pytest

from tagger import BUNDLE_IDENTIFIER
from tagger.paths import app_data_dir


def test_puts_the_application_data_folder_under_the_bundle_identifier(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LOCALAPPDATA", "C:/Users/x/AppData/Local")

    folder = app_data_dir()

    assert folder == Path("C:/Users/x/AppData/Local") / BUNDLE_IDENTIFIER
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `cd sidecar && uv run pytest tests/unit/test_paths.py -x -q`
Expected: FAIL, `ModuleNotFoundError: No module named 'tagger.paths'`

- [ ] **Step 3: Extraire la racine**

Créer `sidecar/src/tagger/paths.py` :

```python
"""Racine des donnees de l'application sur la machine de l'utilisateur.

Source unique des chemins sous `appLocalDataDir()` : logs, cache, et plus tard
plans de run et dump des tags d'origine.
"""

import os
from pathlib import Path

from tagger import BUNDLE_IDENTIFIER


def app_data_dir() -> Path:
    """Ou `appLocalDataDir()` de Tauri resout sous Windows.

    Tauri compose ce dossier avec l'identifiant du bundle, pas avec le nom de
    l'application : le sidecar ecrirait sinon hors des scopes de la webview. Jamais
    le repertoire courant : pour une application installee, c'est celui d'ou
    l'utilisateur l'a lancee, donc n'importe ou sur son disque.
    """
    base = os.getenv("LOCALAPPDATA")
    root = Path(base) if base else Path.home() / "AppData" / "Local"
    return root / BUNDLE_IDENTIFIER
```

Dans `sidecar/src/tagger/__main__.py`, remplacer `log_dir()` par :

```python
def log_dir() -> Path:
    """Dossier des logs, sous la racine des donnees de l'application."""
    # Recalcule et non recu de Tauri : le logger est arme avant la premiere lecture
    # de stdin, donc avant qu'aucune commande NDJSON ait pu porter le chemin. Un
    # argument de spawn demanderait d'ouvrir `args` dans le scope shell, ou un
    # argument non conforme est retire en silence.
    return app_data_dir() / "logs"
```

Ajouter `from tagger.paths import app_data_dir` aux imports. Retirer `import os` et `BUNDLE_IDENTIFIER` de l'import `from tagger import ...` s'ils ne servent plus ailleurs dans le fichier (vérifier par une recherche avant de les retirer).

- [ ] **Step 4: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_paths.py tests/unit/test_main.py -x -q`
Expected: PASS, dont `test_the_log_folder_follows_the_bundle_identifier` inchangé

- [ ] **Step 5: Gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 6: Commit**

```bash
git add sidecar/src/tagger/paths.py sidecar/src/tagger/__main__.py sidecar/tests/unit/test_paths.py docs/ARCHITECTURE.md
git commit -m "refactor(sidecar): extraire la racine des donnees de l'application"
```

---

## Task 2: Cache disque et cache des réponses

**Files:**
- Modify: `sidecar/src/tagger/cache.py` (remplace le placeholder)
- Create: `sidecar/tests/helpers/fake_clock.py`
- Test: `sidecar/tests/unit/test_cache_disk.py`

**Interfaces:**
- Consumes: rien des autres tasks
- Produces:
  - `CACHE_TTL: Final = timedelta(days=30)`, `CACHE_MAX_BYTES: Final = 500 * 1000 * 1000`
  - `PendingWrite(file: BinaryIO, temporary: Path, path: Path, key_hash: str)`
  - `DiskCache(root: Path, *, ttl: timedelta = CACHE_TTL, max_bytes: int = CACHE_MAX_BYTES, clock: Callable[[], float] = time.time)` : propriété `size`, `get(key) -> Path | None`, `discard(path) -> None`, `begin(key, extension) -> PendingWrite`, `commit(pending) -> Path`, `abort(pending) -> None`, `writer(key, extension)` (context manager rendant un `BinaryIO`)
  - `response_key(path: str, params: Mapping[str, str]) -> str`
  - `ResponseCache(disk: DiskCache)` : `get(path, params) -> object | None`, `put(path, params, payload) -> None`
  - helper de test `FakeClock` : `now: float`, `__call__() -> float`, `advance(delta: timedelta) -> None`

- [ ] **Step 1: Écrire l'horloge de test**

Créer `sidecar/tests/helpers/fake_clock.py` :

```python
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
```

- [ ] **Step 2: Écrire les tests du cache disque**

Créer `sidecar/tests/unit/test_cache_disk.py` :

```python
"""Tests du cache disque : TTL, LRU, plafond, tolerances, reponses."""

import shutil
from datetime import timedelta
from pathlib import Path

import pytest
from fake_clock import FakeClock

from tagger.cache import DiskCache, ResponseCache, response_key

TEN_BYTES = b"0123456789"


def _write(cache: DiskCache, key: str, data: bytes = TEN_BYTES) -> None:
    with cache.writer(key, "bin") as file:
        file.write(data)


def _files(root: Path) -> list[Path]:
    return sorted(root.iterdir()) if root.exists() else []


def test_returns_a_written_entry_before_it_expires(tmp_path: Path) -> None:
    clock = FakeClock()
    cache = DiskCache(tmp_path, clock=clock)
    _write(cache, "a")
    clock.advance(timedelta(days=29))

    entry = cache.get("a")

    assert entry is not None
    assert entry.read_bytes() == TEN_BYTES


def test_touches_the_last_use_of_an_entry_on_read(tmp_path: Path) -> None:
    clock = FakeClock()
    cache = DiskCache(tmp_path, clock=clock)
    _write(cache, "a")
    clock.advance(timedelta(days=1))

    entry = cache.get("a")

    assert entry is not None
    assert entry.stat().st_mtime == clock.now


def test_deletes_and_misses_an_expired_entry(tmp_path: Path) -> None:
    clock = FakeClock()
    cache = DiskCache(tmp_path, clock=clock)
    _write(cache, "a")
    clock.advance(timedelta(days=31))

    entry = cache.get("a")

    assert entry is None
    assert _files(tmp_path) == []


def test_evicts_the_least_recently_read_entries_above_the_ceiling(tmp_path: Path) -> None:
    clock = FakeClock()
    cache = DiskCache(tmp_path, max_bytes=30, clock=clock)
    for key in ("a", "b", "c"):
        _write(cache, key)
        clock.advance(timedelta(seconds=1))
    cache.get("a")
    clock.advance(timedelta(seconds=1))

    _write(cache, "d")

    assert cache.get("b") is None
    assert all(cache.get(key) is not None for key in ("a", "c", "d"))


def test_never_evicts_the_entry_just_written(tmp_path: Path) -> None:
    cache = DiskCache(tmp_path, max_bytes=5, clock=FakeClock())

    _write(cache, "a")

    assert cache.get("a") is not None


def test_computes_the_total_size_of_existing_entries_on_open(tmp_path: Path) -> None:
    clock = FakeClock()
    first = DiskCache(tmp_path, clock=clock)
    _write(first, "a", b"x" * 10)
    _write(first, "b", b"x" * 20)

    reopened = DiskCache(tmp_path, clock=clock)

    assert reopened.size == 30


def test_removes_orphan_temporary_files_on_open(tmp_path: Path) -> None:
    orphan = tmp_path / "left-by-a-crash.tmp"
    orphan.write_bytes(b"partial")

    DiskCache(tmp_path, clock=FakeClock())

    assert not orphan.exists()


def test_replaces_the_previous_version_of_a_key(tmp_path: Path) -> None:
    clock = FakeClock()
    cache = DiskCache(tmp_path, clock=clock)
    _write(cache, "a", b"first")
    clock.advance(timedelta(days=1))

    _write(cache, "a", b"second")

    assert [path.read_bytes() for path in _files(tmp_path)] == [b"second"]
    assert cache.size == len(b"second")


def test_misses_without_error_once_the_folder_is_deleted_then_recreates_it(
    tmp_path: Path,
) -> None:
    root = tmp_path / "cache"
    cache = DiskCache(root, max_bytes=30, clock=FakeClock())
    _write(cache, "a")
    shutil.rmtree(root)

    entry = cache.get("a")
    _write(cache, "b")

    assert entry is None
    assert cache.get("b") is not None


def test_publishes_nothing_when_the_writer_fails(tmp_path: Path) -> None:
    cache = DiskCache(tmp_path, clock=FakeClock())

    with pytest.raises(RuntimeError), cache.writer("a", "bin") as file:
        file.write(b"partial")
        raise RuntimeError("interrupted")

    assert _files(tmp_path) == []


def test_ignores_and_keeps_a_foreign_file(tmp_path: Path) -> None:
    foreign = tmp_path / "readme.txt"
    foreign.write_text("not an entry", encoding="utf-8")
    cache = DiskCache(tmp_path, max_bytes=5, clock=FakeClock())

    _write(cache, "a")

    assert foreign.exists()


def test_round_trips_a_response_whatever_the_parameter_order(tmp_path: Path) -> None:
    responses = ResponseCache(DiskCache(tmp_path, clock=FakeClock()))
    responses.put("/beatport/search", {"type": "tracks", "q": "x"}, {"items": []})

    payload = responses.get("/beatport/search", {"q": "x", "type": "tracks"})

    assert payload == {"items": []}


def test_deletes_and_misses_an_unreadable_json_response(tmp_path: Path) -> None:
    disk = DiskCache(tmp_path, clock=FakeClock())
    with disk.writer(response_key("/beatport/search", {"q": "x"}), "json") as file:
        file.write(b"{not json")
    responses = ResponseCache(disk)

    payload = responses.get("/beatport/search", {"q": "x"})

    assert payload is None
    assert _files(tmp_path) == []
```

- [ ] **Step 3: Vérifier que les tests échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_cache_disk.py -x -q`
Expected: FAIL, `ImportError: cannot import name 'DiskCache' from 'tagger.cache'`

- [ ] **Step 4: Implémenter le cache disque**

Remplacer tout le contenu de `sidecar/src/tagger/cache.py` :

```python
"""Cache disque des reponses API et des pochettes.

Le dossier est jetable a tout moment, y compris en plein run : seuls des appels
reseau sont a repayer (ADR-013). Aucun index : l'age d'une entree est dans son nom
(`<sha256 de la cle>.<epoch d'ecriture>.<extension>`), son dernier usage dans son
mtime, touche a chaque lecture. La date de creation Windows n'est pas utilisee : le
tunneling NTFS la recopie quand un fichier est recree sous le meme nom.
"""

import contextlib
import hashlib
import json
import logging
import os
import time
from dataclasses import dataclass
from datetime import timedelta
from typing import TYPE_CHECKING, BinaryIO, Final
from uuid import uuid4

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator, Mapping
    from pathlib import Path

logger = logging.getLogger(__name__)

CACHE_TTL: Final = timedelta(days=30)
CACHE_MAX_BYTES: Final = 500 * 1000 * 1000

_HASH_LENGTH: Final = 64
_TMP_SUFFIX: Final = ".tmp"


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
    """Entrees par cle, expirees apres `ttl`, evincees au-dela de `max_bytes`.

    Synchrone : le code asynchrone l'appelle par `asyncio.to_thread`. Un fichier ou
    un dossier disparu equivaut toujours a une entree absente.
    """

    def __init__(
        self,
        root: Path,
        *,
        ttl: timedelta = CACHE_TTL,
        max_bytes: int = CACHE_MAX_BYTES,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._root = root
        self._ttl = ttl.total_seconds()
        self._max_bytes = max_bytes
        self._clock = clock
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
        return entry.path

    def discard(self, path: Path) -> None:
        """Supprime une entree, sans erreur si elle a deja disparu."""
        size = _size_of(path)
        path.unlink(missing_ok=True)
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
        previous = self._find(pending.key_hash)
        if previous is not None:
            self.discard(previous.path)
        pending.temporary.replace(pending.path)
        self._size += _size_of(pending.path)
        self._evict(keep=pending.path)
        return pending.path

    def abort(self, pending: PendingWrite) -> None:
        """Abandonne l'ecriture : le `.tmp` est supprime, rien n'est publie."""
        pending.file.close()
        pending.temporary.unlink(missing_ok=True)

    @contextlib.contextmanager
    def writer(self, key: str, extension: str) -> Iterator[BinaryIO]:
        """Ecriture d'un bloc : publiee a la sortie, abandonnee sur toute erreur."""
        pending = self.begin(key, extension)
        try:
            yield pending.file
        except BaseException:
            self.abort(pending)
            raise
        self.commit(pending)

    def _open(self) -> int:
        """Un seul parcours : `.tmp` orphelins et entrees expirees purges, taille comptee."""
        total = 0
        for path in self._scan():
            if path.name.endswith(_TMP_SUFFIX):
                path.unlink(missing_ok=True)
                continue
            entry = _parse(path)
            if entry is None:
                continue
            if self._expired(entry):
                path.unlink(missing_ok=True)
                continue
            total += _size_of(path)
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
        if self._size <= self._max_bytes:
            return
        # Taille recomptee avant d'evincer : un dossier vide par l'utilisateur
        # laisserait sinon un total perime qui evincerait toutes les entrees neuves.
        candidates: list[tuple[float, Path]] = []
        total = 0
        for path in self._scan():
            if _parse(path) is None:
                continue
            try:
                stat = path.stat()
            except FileNotFoundError:
                continue
            total += stat.st_size
            if path != keep:
                candidates.append((stat.st_mtime, path))
        self._size = total
        for _last_used, path in sorted(candidates):
            if self._size <= self._max_bytes:
                break
            self.discard(path)

    def _scan(self) -> list[Path]:
        try:
            return [path for path in self._root.iterdir() if path.is_file()]
        except FileNotFoundError:
            return []


def response_key(path: str, params: Mapping[str, str]) -> str:
    """Route et parametres tries : l'ordre des parametres ne change pas la cle."""
    return json.dumps([path, sorted(params.items())], ensure_ascii=False)


class ResponseCache:
    """Reponses 2xx de techno-scraper, resultat vide compris (ADR-013)."""

    def __init__(self, disk: DiskCache) -> None:
        self._disk = disk

    def get(self, path: str, params: Mapping[str, str]) -> object | None:
        """Corps JSON en cache, `None` si absent, expire ou illisible."""
        entry = self._disk.get(response_key(path, params))
        if entry is None:
            return None
        try:
            return json.loads(entry.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        except ValueError:
            self._disk.discard(entry)
            return None

    def put(self, path: str, params: Mapping[str, str], payload: object) -> None:
        """Un echec d'ecriture est logue puis avale : la reponse est deja en main."""
        try:
            with self._disk.writer(response_key(path, params), "json") as file:
                file.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
        except OSError:
            logger.warning("response not cached reason=write_failed")


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


def _size_of(path: Path) -> int:
    try:
        return path.stat().st_size
    except FileNotFoundError:
        return 0
```

`UnicodeDecodeError` hérite de `ValueError` : un fichier binaire à la place du JSON est traité comme un JSON illisible.

- [ ] **Step 5: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_cache_disk.py -x -q`
Expected: PASS, 13 tests

- [ ] **Step 6: Gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 7: Commit**

```bash
git add sidecar/src/tagger/cache.py sidecar/tests/helpers/fake_clock.py sidecar/tests/unit/test_cache_disk.py
git commit -m "feat(cache): cache disque a TTL et eviction LRU sans index"
```

---

## Task 3: Réponses de l'API servies depuis le cache

**Files:**
- Modify: `sidecar/src/tagger/scraper_client.py` (`__init__`, `_get`)
- Modify: `sidecar/tests/helpers/scraper_responses.py` (`make_client`)
- Test: `sidecar/tests/unit/test_scraper_client_requests.py`

**Interfaces:**
- Consumes: `ResponseCache.get(path, params)`, `ResponseCache.put(path, params, payload)`, `DiskCache` (Task 2) ; `TechnoScraperClient._get` (sub-project 02)
- Produces: `TechnoScraperClient(..., cache: ResponseCache | None = None)` ; `make_client(handler, *, sleep=no_sleep, cache=None)`

- [ ] **Step 1: Étendre le helper de test**

Dans `sidecar/tests/helpers/scraper_responses.py`, remplacer `make_client` :

```python
def make_client(
    handler: Handler,
    *,
    sleep: Callable[[float], Awaitable[None]] = no_sleep,
    cache: ResponseCache | None = None,
) -> TechnoScraperClient:
    """Client branche sur un `MockTransport`, sans aucun appel reseau reel."""
    return TechnoScraperClient(
        TEST_API_KEY, transport=httpx2.MockTransport(handler), sleep=sleep, cache=cache
    )
```

Ajouter `from tagger.cache import ResponseCache` sous `if TYPE_CHECKING:`.

- [ ] **Step 2: Écrire les tests du client avec cache**

Ajouter à la fin de `sidecar/tests/unit/test_scraper_client_requests.py` (et `from pathlib import Path`, `from tagger.cache import DiskCache, ResponseCache`, `from tagger.scraper_client import SourceUnavailableError` aux imports) :

```python
def _cache(root: Path) -> ResponseCache:
    return ResponseCache(DiskCache(root))


async def test_serves_a_repeated_search_from_the_cache_without_a_request(tmp_path: Path) -> None:
    requests: list[httpx2.Request] = []
    handler = _recording(requests, page_payload(track_payload()))

    async with make_client(handler, cache=_cache(tmp_path)) as client:
        first = await client.search(Source.BEATPORT, "Adam Beyer Your Mind")
        second = await client.search(Source.BEATPORT, "Adam Beyer Your Mind")

    assert second == first
    assert len(requests) == 1


async def test_caches_an_empty_result(tmp_path: Path) -> None:
    requests: list[httpx2.Request] = []

    async with make_client(_recording(requests, page_payload()), cache=_cache(tmp_path)) as client:
        await client.search(Source.BANDCAMP, "unknown track")
        second = await client.search(Source.BANDCAMP, "unknown track")

    assert second == ()
    assert len(requests) == 1


async def test_never_caches_an_error_response(tmp_path: Path) -> None:
    requests: list[httpx2.Request] = []

    def unavailable_then_found(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        if len(requests) == 1:
            return httpx2.Response(503, json={"code": "source_unavailable"})
        return httpx2.Response(200, json=page_payload(track_payload()))

    async with make_client(unavailable_then_found, cache=_cache(tmp_path)) as client:
        with pytest.raises(SourceUnavailableError):
            await client.search(Source.BEATPORT, "Adam Beyer Your Mind")
        candidates = await client.search(Source.BEATPORT, "Adam Beyer Your Mind")

    assert len(candidates) == 1
    assert len(requests) == 2
```

- [ ] **Step 3: Vérifier que les tests échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_scraper_client_requests.py -x -q`
Expected: FAIL, `TypeError: TechnoScraperClient.__init__() got an unexpected keyword argument 'cache'`

- [ ] **Step 4: Brancher le cache dans le client**

Dans `sidecar/src/tagger/scraper_client.py`, ajouter `from tagger.cache import ResponseCache` sous `if TYPE_CHECKING:`, puis le paramètre au constructeur :

```python
    def __init__(
        self,
        api_key: str,
        *,
        transport: httpx2.AsyncBaseTransport | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        cache: ResponseCache | None = None,
    ) -> None:
```

et `self._cache = cache` après `self._sleep = sleep`.

Renommer la méthode `_get` actuelle en `_request` (corps inchangé : boucle de nouvelle tentative, sémaphore, traduction), puis ajouter le nouveau `_get` :

```python
    async def _get(
        self, source: SearchSource, path: str, params: Mapping[str, str]
    ) -> _ApiResponse:
        """Point de passage unique de toute requete, cache compris.

        Le cache est lu avant le semaphore : un hit ne prend aucune place du pool.
        Seule une reponse traduite sans erreur est ecrite, jamais une erreur.
        """
        if self._cache is not None:
            cached = await asyncio.to_thread(self._cache.get, path, params)
            if cached is not None:
                return _ApiResponse(cached, "")
        response = await self._request(source, path, params)
        if self._cache is not None:
            await asyncio.to_thread(self._cache.put, path, params, response.payload)
        return response
```

- [ ] **Step 5: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_scraper_client_requests.py tests/unit/test_scraper_client_errors.py tests/unit/test_scraper_client_concurrency.py -x -q`
Expected: PASS, 25 tests

- [ ] **Step 6: Gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 7: Commit**

```bash
git add sidecar/src/tagger/scraper_client.py sidecar/tests/helpers/scraper_responses.py sidecar/tests/unit/test_scraper_client_requests.py
git commit -m "feat(cache): servir les reponses techno-scraper depuis le cache disque"
```

---

## Task 4: Téléchargement des pochettes

**Files:**
- Modify: `sidecar/src/tagger/cache.py`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json` (`errors.artwork_unavailable`)
- Test: `sidecar/tests/unit/test_cache_artworks.py`

**Interfaces:**
- Consumes: `DiskCache.get`, `begin`, `commit`, `abort`, `PendingWrite` (Task 2)
- Produces:
  - `ARTWORK_CONCURRENCY: Final = 6`
  - `ArtworkUnavailableError(reason: str)`, code `artwork_unavailable`, attribut `reason` (`network`, `status_<code>`, `not_an_image`, `cache_write`)
  - `ArtworkFetcher(cache: DiskCache, *, transport: httpx2.AsyncBaseTransport | None = None)`, context manager asynchrone, `async fetch(url: str) -> Path`

- [ ] **Step 1: Écrire les tests des pochettes**

Créer `sidecar/tests/unit/test_cache_artworks.py` :

```python
"""Tests du telechargement des pochettes depuis le CDN de la source."""

import asyncio
from pathlib import Path

import httpx2
import pytest

from tagger.cache import ArtworkFetcher, ArtworkUnavailableError, DiskCache

pytestmark = pytest.mark.asyncio

URL = "https://geo-media.beatport.com/image_size/500x500/cover.jpg"
IMAGE = b"\xff\xd8\xff\xe0" + b"\x00" * 64


def _image(content_type: str = "image/jpeg") -> httpx2.Response:
    return httpx2.Response(200, content=IMAGE, headers={"Content-Type": content_type})


async def test_downloads_an_artwork_once_and_serves_it_from_the_cache(tmp_path: Path) -> None:
    requests: list[httpx2.Request] = []

    def cdn(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        return _image()

    async with ArtworkFetcher(DiskCache(tmp_path), transport=httpx2.MockTransport(cdn)) as fetcher:
        first = await fetcher.fetch(URL)
        second = await fetcher.fetch(URL)

    assert second == first
    assert first.read_bytes() == IMAGE
    assert len(requests) == 1


@pytest.mark.parametrize(
    ("content_type", "suffix"),
    [("image/jpeg", ".jpg"), ("image/png", ".png"), ("image/webp", ".webp")],
    ids=["jpeg", "png", "webp"],
)
async def test_names_the_file_after_the_content_type(
    tmp_path: Path, content_type: str, suffix: str
) -> None:
    transport = httpx2.MockTransport(lambda _request: _image(content_type))

    async with ArtworkFetcher(DiskCache(tmp_path), transport=transport) as fetcher:
        artwork = await fetcher.fetch(URL)

    assert artwork.suffix == suffix


@pytest.mark.parametrize(
    ("response", "reason"),
    [
        (httpx2.Response(404), "status_404"),
        (httpx2.Response(200, content=b"<html>", headers={"Content-Type": "text/html"}),
         "not_an_image"),
    ],
    ids=["error-status", "not-an-image"],
)
async def test_raises_artwork_unavailable_and_publishes_nothing(
    tmp_path: Path, response: httpx2.Response, reason: str
) -> None:
    transport = httpx2.MockTransport(lambda _request: response)

    async with ArtworkFetcher(DiskCache(tmp_path), transport=transport) as fetcher:
        with pytest.raises(ArtworkUnavailableError) as error:
            await fetcher.fetch(URL)

    assert error.value.reason == reason
    assert list(tmp_path.iterdir()) == []


async def test_raises_artwork_unavailable_on_a_network_error(tmp_path: Path) -> None:
    def unreachable(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("unreachable", request=request)

    transport = httpx2.MockTransport(unreachable)
    async with ArtworkFetcher(DiskCache(tmp_path), transport=transport) as fetcher:
        with pytest.raises(ArtworkUnavailableError) as error:
            await fetcher.fetch(URL)

    assert error.value.reason == "network"


async def test_never_keeps_more_than_six_downloads_in_flight(tmp_path: Path) -> None:
    in_flight = {"current": 0, "peak": 0}

    async def slow_cdn(_request: httpx2.Request) -> httpx2.Response:
        in_flight["current"] += 1
        in_flight["peak"] = max(in_flight["peak"], in_flight["current"])
        await asyncio.sleep(0.01)
        in_flight["current"] -= 1
        return _image()

    transport = httpx2.MockTransport(slow_cdn)
    async with (
        ArtworkFetcher(DiskCache(tmp_path), transport=transport) as fetcher,
        asyncio.TaskGroup() as group,
    ):
        for index in range(12):
            group.create_task(fetcher.fetch(f"{URL}?v={index}"), name=f"artwork:{index}")

    assert in_flight["peak"] == 6


async def test_sends_no_api_key_to_the_cdn(tmp_path: Path) -> None:
    requests: list[httpx2.Request] = []

    def cdn(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        return _image()

    async with ArtworkFetcher(DiskCache(tmp_path), transport=httpx2.MockTransport(cdn)) as fetcher:
        await fetcher.fetch(URL)

    assert "X-API-Key" not in requests[0].headers
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `cd sidecar && uv run pytest tests/unit/test_cache_artworks.py -x -q`
Expected: FAIL, `ImportError: cannot import name 'ArtworkFetcher' from 'tagger.cache'`

- [ ] **Step 3: Implémenter le téléchargement**

Dans `sidecar/src/tagger/cache.py`, compléter les imports :

```python
import asyncio
import contextlib
import hashlib
import json
import logging
import os
import time
from dataclasses import dataclass
from datetime import timedelta
from typing import TYPE_CHECKING, BinaryIO, ClassVar, Final, Self
from uuid import uuid4

import httpx2

from tagger.errors import TaggerError
```

Ajouter après `CACHE_MAX_BYTES` :

```python
# Pool du CDN des pochettes, distinct des semaphores de l'API (ADR-017).
ARTWORK_CONCURRENCY: Final = 6

_ARTWORK_EXTENSIONS: Final = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
```

Ajouter avant `_hash` :

```python
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
        self, cache: DiskCache, *, transport: httpx2.AsyncBaseTransport | None = None
    ) -> None:
        self._cache = cache
        # Sans X-API-Key : `release.artwork_url` pointe le CDN, pas l'API.
        self._http = httpx2.AsyncClient(transport=transport, follow_redirects=True)
        self._semaphore = asyncio.Semaphore(ARTWORK_CONCURRENCY)

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *_exc_info: object) -> None:
        await self._http.aclose()

    async def fetch(self, url: str) -> Path:
        """Chemin de la pochette en cache, telechargee au premier appel."""
        cached = await asyncio.to_thread(self._cache.get, url)
        if cached is not None:
            return cached
        async with self._semaphore:
            try:
                return await self._download(url)
            except httpx2.RequestError as exc:
                raise ArtworkUnavailableError("network") from exc

    async def _download(self, url: str) -> Path:
        async with self._http.stream("GET", url) as response:
            if not response.is_success:
                raise ArtworkUnavailableError(f"status_{response.status_code}")
            content_type = response.headers.get("Content-Type", "").split(";")[0].strip()
            extension = _ARTWORK_EXTENSIONS.get(content_type)
            if extension is None:
                raise ArtworkUnavailableError("not_an_image")
            try:
                pending = await asyncio.to_thread(self._cache.begin, url, extension)
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
```

Le `except BaseException` nettoie aussi sur une annulation (`CancelledError`) avant de la relever, comme l'exige `.claude/rules/python/asyncio.md`.

- [ ] **Step 4: Vérifier que les tests passent**

Run: `cd sidecar && uv run pytest tests/unit/test_cache_artworks.py tests/unit/test_cache_disk.py -x -q`
Expected: PASS, 22 tests (9 de pochettes, paramétrages compris, plus les 13 de la Task 2)

- [ ] **Step 5: Gate qualité**

Run: `just test && just lint && just typecheck`
Expected: tout vert

- [ ] **Step 6: Traduire les nouveaux codes d'erreur**

`sidecar/tests/unit/test_error_translations.py` parcourt toutes les sous-classes de `TaggerError`, bases abstraites comprises, et exige une entrée `errors.<code>` dans les deux langues. Dans le bloc `errors` de `public/i18n/fr.json`, ajouter :

```json
    "artwork_unavailable": "La pochette n'a pas pu être téléchargée.",
```

et dans `public/i18n/en.json`, au même endroit :

```json
    "artwork_unavailable": "The artwork could not be downloaded.",
```

- [ ] **Step 7: Commit**

```bash
git add sidecar/src/tagger/cache.py sidecar/tests/unit/test_cache_artworks.py public/i18n/fr.json public/i18n/en.json
git commit -m "feat(cache): telecharger les pochettes vers le cache en pool de six"
```
