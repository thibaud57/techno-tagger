"""Fixtures partagees des tests du sidecar.

Aucun test ne consomme le quota de techno-scraper ni ne pollue le projet Sentry :
le client HTTP se mocke par le `MockTransport` natif d'httpx2, `respx` et
`pytest-httpx` ne supportant pas ce fork (cf. VERSIONS.md § Conflits Potentiels).

`unit/` teste un module isole, `integration/` fait dialoguer plusieurs modules,
protocole NDJSON de bout en bout compris. Les donnees figees vivent dans
`fixtures/`, les constructeurs partages dans `helpers/`, importable a plat grace
au `pythonpath` de la configuration pytest.
"""

import logging
from pathlib import Path
from typing import TYPE_CHECKING

import pytest
from vlc_dump import build_dump

if TYPE_CHECKING:
    from collections.abc import Iterator

# TODO: implement — fixture de transport httpx2 mocke, fichiers audio des quatre
# formats.

FIXTURES = Path(__file__).parent / "fixtures"


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
