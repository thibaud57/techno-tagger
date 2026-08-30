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
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from collections.abc import Iterator

# TODO: implement — fixture de transport httpx2 mocke, fichiers audio des quatre
# formats, base vlc_media.db de test, playlists M3U8 d'exemple.


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
