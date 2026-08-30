"""Configuration du logger : logfmt dans un fichier tournant.

Le fichier a un seul destinataire, l'auteur, quand un utilisateur clique sur
« ouvrir le dossier de logs » et l'envoie. D'ou logfmt plutot que du JSON par
ligne : `grep 'status=403' tagger.log` marche chez quelqu'un qui n'a pas jq.
"""

import logging
import sys
from logging.handlers import RotatingFileHandler
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

# Jeu de cles fixe (run, track, source, score, status, reason) : une cle inventee
# au fil des commits rend un grep faux sans que rien ne casse.
FORMAT = "%(asctime)s %(levelname)-5s %(name)-16s %(message)s"

# 20 Mo au maximum sur le disque. Rotation sur la taille et jamais sur le run,
# qui peut donc etre a cheval sur deux fichiers : d'ou la cle `run` sur chaque ligne.
MAX_BYTES = 5 * 1024 * 1024
BACKUP_COUNT = 3


def setup_logging(log_dir: Path, level: int = logging.INFO) -> None:
    log_dir.mkdir(parents=True, exist_ok=True)
    formatter = logging.Formatter(FORMAT, datefmt="%Y-%m-%d %H:%M:%S")

    file_handler = RotatingFileHandler(
        log_dir / "tagger.log",
        maxBytes=MAX_BYTES,
        backupCount=BACKUP_COUNT,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)

    # stderr et jamais stdout, qui porte le flux NDJSON. Une application
    # empaquetee n'ayant pas de console, le fichier reste la seule sortie utile.
    stderr_handler = logging.StreamHandler(sys.stderr)
    stderr_handler.setFormatter(formatter)

    root = logging.getLogger()
    root.setLevel(level)
    root.addHandler(file_handler)
    root.addHandler(stderr_handler)
