"""`stdout` porte le flux NDJSON lu par l'interface : un handler de log qui s'y
branche corrompt le protocole (cf. ARCHITECTURE.md § API).
"""

import logging
import sys
from logging.handlers import RotatingFileHandler
from typing import TYPE_CHECKING

from tagger.logger import setup_logging

if TYPE_CHECKING:
    from pathlib import Path


def test_no_handler_writes_to_stdout(tmp_path: Path) -> None:
    setup_logging(tmp_path)

    root = logging.getLogger()
    streams = [h.stream for h in root.handlers if isinstance(h, logging.StreamHandler)]
    assert streams
    assert sys.stdout not in streams


def test_a_second_call_closes_the_previous_handlers_without_duplicating_them(
    tmp_path: Path,
) -> None:
    """Deux handles sur le meme fichier tournant font echouer la rotation a 5 Mo :
    Windows refuse de renommer un fichier encore ouvert, et le log s'arrete la.
    """
    setup_logging(tmp_path)
    previous_handlers = list(logging.getLogger().handlers)
    previous_file_handler = next(h for h in previous_handlers if isinstance(h, RotatingFileHandler))

    setup_logging(tmp_path)

    assert len(logging.getLogger().handlers) == len(previous_handlers)
    # `close()` remet `stream` a None (logging.FileHandler.close) : un handler
    # simplement retire de `root.handlers` sans etre ferme le laisserait ouvert.
    assert previous_file_handler.stream is None
