"""`stdout` porte le flux NDJSON lu par l'interface : un handler de log qui s'y
branche corrompt le protocole (cf. ARCHITECTURE.md § API).
"""

import logging
import sys
from typing import TYPE_CHECKING

from tagger.logger import setup_logging

if TYPE_CHECKING:
    from pathlib import Path


def test_aucun_handler_n_ecrit_sur_stdout(tmp_path: Path) -> None:
    setup_logging(tmp_path)

    root = logging.getLogger()
    streams = [h.stream for h in root.handlers if isinstance(h, logging.StreamHandler)]
    assert streams
    assert sys.stdout not in streams


def test_un_second_appel_ne_duplique_pas_les_handlers(tmp_path: Path) -> None:
    """Deux handles sur le meme fichier tournant font echouer la rotation a 5 Mo :
    Windows refuse de renommer un fichier encore ouvert, et le log s'arrete la.
    """
    setup_logging(tmp_path)
    apres_un_appel = list(logging.getLogger().handlers)

    setup_logging(tmp_path)

    assert len(logging.getLogger().handlers) == len(apres_un_appel)
