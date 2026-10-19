"""Fixtures partagees des tests du sidecar.

Aucun test ne consomme le quota de techno-scraper ni ne pollue le projet Sentry :
le client HTTP se mocke par le `MockTransport` natif d'httpx2, `respx` et
`pytest-httpx` ne supportant pas ce fork (cf. VERSIONS.md § Conflits Potentiels).

`unit/` teste un module isole, `integration/` fait dialoguer plusieurs modules,
protocole NDJSON de bout en bout compris. Ce fichier ne garde que les fixtures
servant aux deux, chaque dossier a son `conftest.py` pour les siennes. Les donnees
figees vivent dans `fixtures/`, les constructeurs partages dans `helpers/`,
importable a plat grace au `pythonpath` de la configuration pytest.
"""

import logging
from pathlib import Path
from typing import TYPE_CHECKING, Final
from unittest.mock import patch

import keyring
import pytest
from memory_keyring import MemoryKeyring
from vlc_dump import build_dump

from tagger.core.api_key import SERVICE, USERNAME

if TYPE_CHECKING:
    from collections.abc import Iterator
    from unittest.mock import MagicMock

    import httpx2

FIXTURES: Final = Path(__file__).parent / "fixtures"


@pytest.fixture(autouse=True)
def _isolate_root_logger() -> Iterator[None]:
    """`setup_logging` mute le logger racine, qui est un singleton de process : sans
    restauration, un test de logging deteriore le `caplog` de tous les suivants et
    laisse un handler de fichier ouvert, que Windows refuse ensuite de supprimer.
    """
    root = logging.getLogger()
    handlers, level = root.handlers[:], root.level

    yield

    for handler in root.handlers[:]:
        if handler not in handlers:
            handler.close()
    root.handlers[:] = handlers
    root.setLevel(level)


@pytest.fixture(autouse=True)
def memory_keyring() -> Iterator[MemoryKeyring]:
    """Trousseau en memoire pose pour chaque test, backend precedent restaure apres.

    Autouse : `get_version` lit le trousseau, et un test qui l'oublierait toucherait
    le Credential Manager de la machine qui fait tourner la suite.
    """
    previous = keyring.get_keyring()
    backend = MemoryKeyring()
    keyring.set_keyring(backend)

    yield backend

    keyring.set_keyring(previous)


@pytest.fixture
def captured_exceptions() -> Iterator[MagicMock]:
    """Remplace `sentry_sdk.capture_exception` : aucun test n'envoie d'evenement a Sentry."""
    with patch("sentry_sdk.capture_exception", autospec=True) as capture:
        yield capture


@pytest.fixture
def vlc_dump(tmp_path: Path) -> Path:
    """Dump `vlc_media.db` de test, bati sur le DDL reel de VLC Android.

    Construit dynamiquement pour couvrir des variantes de schema et puisque SQLite
    est binaire : le DDL seul, versionnable, vit dans `helpers/vlc_dump.py`.
    """
    return build_dump(tmp_path / "vlc_media.db")


@pytest.fixture
def m3u8_playlist() -> Path:
    """Playlist M3U8 d'exemple : BOM, directives, lignes vides, chemins Windows et
    POSIX, noms non-ASCII. Figee sur disque, le format etant du texte stable.
    """
    return FIXTURES / "sample.m3u8"


@pytest.fixture
def unreadable_binary_file(tmp_path: Path) -> Path:
    """Fichier binaire quelconque (en-tete JPEG) : ni dump SQLite ni playlist
    texte decodable, pour les tests de rejet de format.
    """
    binary = tmp_path / "cover.jpg"
    binary.write_bytes(b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x02\x03\xfe\xfd")
    return binary


@pytest.fixture
def music_library(tmp_path: Path) -> Path:
    """Arborescence source de test, morceaux repartis en sous-dossiers.

    Les tailles sont controlees : le departage des homonymes retient le plus gros
    fichier, et deux `gamma` de taille egale forcent le second critere, l'ordre
    alphabetique du chemin.
    """
    library = tmp_path / "library"
    files = {
        library / "albums" / "alpha.mp3": 1_000,
        library / "albums" / "beta.mp3": 5_000,
        library / "singles" / "beta.mp3": 12_000,
        library / "aaa" / "gamma.mp3": 3_000,
        library / "zzz" / "gamma.mp3": 3_000,
        library / "singles" / "DELTA.mp3": 2_000,
    }

    for path, size in files.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"\x00" * size)

    return library


@pytest.fixture
def _key(memory_keyring: MemoryKeyring) -> None:
    """Cle API deja enregistree dans le trousseau en memoire."""
    memory_keyring.secrets[(SERVICE, USERNAME)] = "k3y-t0k3n"


@pytest.fixture
def app_data(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Isole le dossier de donnees d'application sous `tmp_path`."""
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "appdata"))


@pytest.fixture
def requests() -> list[httpx2.Request]:
    """Journal des requetes emises, rempli par le handler du `MockTransport`.

    Une liste neuve par test : c'est la seule fenetre sur ce que le client a emis.
    """
    return []
