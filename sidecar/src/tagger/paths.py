"""Racine des donnees de l'application sur la machine de l'utilisateur.

Source unique des chemins sous `appLocalDataDir()` : logs, cache, et plus tard
plans de run et dump des tags d'origine.
"""

import os
from pathlib import Path

from tagger import BUNDLE_IDENTIFIER


def app_data_dir() -> Path:
    """Ou `appLocalDataDir()` de Tauri resout sous Windows.

    Tauri compose ce dossier avec l'identifiant du bundle, pas avec le nom de
    l'application : le sidecar ecrirait sinon hors des scopes de la webview. Jamais
    le repertoire courant : pour une application installee, c'est celui d'ou
    l'utilisateur l'a lancee, donc n'importe ou sur son disque.
    """
    base = os.getenv("LOCALAPPDATA")
    root = Path(base) if base else Path.home() / "AppData" / "Local"
    return root / BUNDLE_IDENTIFIER
