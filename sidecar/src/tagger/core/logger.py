"""Installe les handlers du sidecar : un fichier tournant, plus stderr.

Le fichier a un seul destinataire, l'auteur, quand un utilisateur l'envoie. D'ou
le logfmt plutot que du JSON par ligne : `grep 'reason=file_locked' tagger.log`
marche chez quelqu'un qui n'a pas jq. Le
prefixe est pose ici, les champs `cle=valeur` par les appelants (PRODUCTION.md
§ Logging).
"""

import logging
import sys
from logging.handlers import RotatingFileHandler
from typing import TYPE_CHECKING, Final

if TYPE_CHECKING:
    from pathlib import Path

# Lu aussi par `version` : l'interface revele ce fichier, le seul a joindre a un signalement.
LOG_FILE_NAME: Final = "tagger.log"

# Largeur 7 et non 5 : le plus long levelname est WARNING, et le padding ne tronque pas.
FORMAT: Final = "%(asctime)s %(levelname)-7s %(name)-16s %(message)s"

# 20 Mo au maximum sur le disque, rotation sur la taille et jamais sur le run.
MAX_BYTES: Final = 5 * 1024 * 1024
BACKUP_COUNT: Final = 3

# Ce que cette fonction a pose au dernier appel, et elle seule : le logger racine
# est un singleton de process, et deux handles sur un meme fichier tournant font
# echouer la rotation sous Windows, qui refuse de renommer un fichier ouvert.
_installed: list[logging.Handler] = []


def setup_logging(log_dir: Path, level: int = logging.INFO) -> None:
    root = logging.getLogger()

    for handler in _installed:
        root.removeHandler(handler)
        handler.close()
    _installed.clear()

    log_dir.mkdir(parents=True, exist_ok=True)
    formatter = logging.Formatter(FORMAT, datefmt="%Y-%m-%d %H:%M:%S")

    file_handler = RotatingFileHandler(
        log_dir / LOG_FILE_NAME,
        maxBytes=MAX_BYTES,
        backupCount=BACKUP_COUNT,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)

    # stderr et jamais stdout, qui porte le flux NDJSON. Une application
    # empaquetee n'ayant pas de console, le fichier reste la seule sortie utile.
    stderr_handler = logging.StreamHandler(sys.stderr)
    stderr_handler.setFormatter(formatter)

    root.setLevel(level)
    root.addHandler(file_handler)
    root.addHandler(stderr_handler)
    _installed.extend((file_handler, stderr_handler))
