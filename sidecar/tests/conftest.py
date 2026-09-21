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

import keyring
import pytest
from audio_samples import BLANK_WRITERS
from extraction_samples import sample_context, sample_result
from memory_keyring import MemoryKeyring
from vlc_dump import build_dump

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator

    import httpx2

    from tagger.extraction import ExtractionResult
    from tagger.reports import ReportContext

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def requests() -> list[httpx2.Request]:
    """Journal des requetes emises, rempli par le handler du `MockTransport`.

    Une liste neuve par test : c'est la seule fenetre sur ce que le client a emis.
    """
    return []


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

    Autouse : `get_version` lit desormais le trousseau, et un test qui l'oublierait
    toucherait le Credential Manager de la machine qui fait tourner la suite.
    """
    previous = keyring.get_keyring()
    backend = MemoryKeyring()
    keyring.set_keyring(backend)

    yield backend

    keyring.set_keyring(previous)


@pytest.fixture
def vlc_dump(tmp_path: Path) -> Path:
    """Dump `vlc_media.db` de test, bati sur le DDL reel de VLC Android.

    Construit dynamiquement pour couvrir des variantes de schema et puisque SQLite
    est binaire : le DDL seul, versionnable, vit dans `helpers/vlc_dump.py`.
    """
    return build_dump(tmp_path / "vlc_media.db")


@pytest.fixture
def blank_audio(tmp_path: Path) -> Callable[[str], Path]:
    """Fabrique de fichiers audio vierges, `"mp3"`, `"wav"`, `"aiff"` ou `"flac"`.

    Construits en octets par `helpers/audio_samples.py` : aucun binaire commite.
    """

    def make(audio_format: str) -> Path:
        return BLANK_WRITERS[audio_format](tmp_path / f"track.{audio_format}")

    return make


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
def extraction_result(tmp_path: Path) -> ExtractionResult:
    """Resultat d'extraction couvrant les cinq categories."""
    return sample_result(tmp_path / "library")


@pytest.fixture
def report_context(tmp_path: Path) -> ReportContext:
    """Contexte de rapport pointant sur la meme arborescence."""
    return sample_context(tmp_path / "library", tmp_path / "work")
