"""Racine des donnees de l'application sur la machine de l'utilisateur.

Source unique des chemins sous `appLocalDataDir()` : logs, cache, et plus tard
plans de run et dump des tags d'origine.
"""

import os
from pathlib import Path

from tagger import BUNDLE_IDENTIFIER


def app_data_dir() -> Path:
    """Racine de `appLocalDataDir()` de Tauri, composee avec l'identifiant du bundle.

    Pas le nom de l'application, sinon le sidecar ecrirait hors des scopes de la
    webview ; jamais le repertoire courant, arbitraire pour une app installee.
    """
    base = os.getenv("LOCALAPPDATA")
    root = Path(base) if base else Path.home() / "AppData" / "Local"
    return root / BUNDLE_IDENTIFIER
