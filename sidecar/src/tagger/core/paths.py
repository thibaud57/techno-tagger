"""Racine des donnees de l'application, source unique des chemins sous `appLocalDataDir()`."""

import os
from pathlib import Path
from typing import Final

from tagger import BUNDLE_IDENTIFIER

_EXTENDED_PREFIX: Final = "\\\\?\\"
_UNC_PREFIX: Final = "\\\\"


def app_data_dir() -> Path:
    """Racine de `appLocalDataDir()` de Tauri, composee avec l'identifiant du bundle.

    Pas le nom de l'application, sinon le sidecar ecrirait hors des scopes de la
    webview ; jamais le repertoire courant, arbitraire pour une app installee.
    """
    base = os.getenv("LOCALAPPDATA")
    root = Path(base) if base else Path.home() / "AppData" / "Local"
    return root / BUNDLE_IDENTIFIER


def log_dir() -> Path:
    # Recalcule et non recu de Tauri : le logger est arme avant la premiere lecture
    # de stdin, donc avant qu'aucune commande NDJSON ait pu porter le chemin. Un
    # argument de spawn demanderait d'ouvrir `args` dans le scope shell, ou un
    # argument non conforme est retire en silence.
    return app_data_dir() / "logs"


def extended_path(path: Path) -> Path:
    """Chemin prefixe `\\\\?\\`, qui leve la limite de 260 caracteres de l'API Win32.

    Le prefixe exige un chemin absolu et normalise. Seul le dossier est resolu : resoudre le
    nom rendrait la casse deja sur le disque, donc un renommage de casse seule resterait sans effet.
    """
    text = str(path.parent.resolve() / path.name)
    if text.startswith(_EXTENDED_PREFIX):
        return path
    if text.startswith(_UNC_PREFIX):
        return Path(f"{_EXTENDED_PREFIX}UNC\\{text.removeprefix(_UNC_PREFIX)}")
    return Path(f"{_EXTENDED_PREFIX}{text}")
