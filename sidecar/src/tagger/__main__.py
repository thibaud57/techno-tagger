"""Point d'entree du sidecar : boucle de commandes NDJSON sur les flux standard.

stdin porte les commandes, stdout les evenements. stderr reste aux logs et n'est
jamais melange au protocole.
"""

import io
import os
import sys
from pathlib import Path

from tagger import BUNDLE_IDENTIFIER, RELEASE
from tagger.build_info import SENTRY_DSN
from tagger.logger import setup_logging
from tagger.observability import init_sentry


def log_dir() -> Path:
    """Ou `appLocalDataDir()` de Tauri resout sous Windows. Jamais le repertoire
    courant : pour une application installee, c'est celui d'ou l'utilisateur l'a
    lancee, donc n'importe ou sur son disque.
    """
    # TODO: implement, recevoir le chemin de Tauri plutot que le recalculer ici.
    base = os.getenv("LOCALAPPDATA")
    root = Path(base) if base else Path.home() / "AppData" / "Local"
    return root / BUNDLE_IDENTIFIER / "logs"


def _force_utf8_streams() -> None:
    """Sous Windows, stdin et stdout tombent en cp1252 des qu'ils sont des pipes,
    c'est-a-dire exactement comme Tauri lance le sidecar. Un titre cyrillique,
    japonais ou un emoji leverait alors UnicodeDecodeError ou UnicodeEncodeError
    en plein run. PEP 686 rend l'UTF-8 implicite en 3.15, pas en 3.14.
    """
    for stream in (sys.stdin, sys.stdout):
        # Un flux substitue (capture de test, redirection) n'est pas un
        # TextIOWrapper et n'a rien a reconfigurer : seul le cas reel compte ici.
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(encoding="utf-8", errors="strict")


def main() -> None:
    _force_utf8_streams()

    # Avant tout traitement : un crash du parsing doit deja pouvoir remonter, et
    # `logger.exception` doit avoir un handler autre que celui de dernier recours.
    setup_logging(log_dir())
    init_sentry(SENTRY_DSN, RELEASE)

    # Sans flush, stdout est bufferise des qu'il n'est plus un terminal : les
    # evenements partiraient par paquets en fin de run. Invisible en dev.
    for _line in sys.stdin:
        # TODO: implement, valider la commande contre son modele Pydantic
        # (protocol.py), la dispatcher, puis emettre les evenements produits.
        sys.stdout.flush()


if __name__ == "__main__":
    main()
