"""Sidecar metier de techno-tagger."""

from typing import Final

from tagger.core.build_info import VERSION

__version__ = VERSION

# Le paquet s'appelle `tagger`, l'application `techno-tagger` : ce nom ne se derive
# d'aucun manifeste lisible par le sidecar, d'ou la valeur en dur. Elle doit egaler celle
# de la webview, sinon les erreurs du sidecar et de la webview d'une meme livraison ne
# se rattachent pas a la meme release.
APP_NAME: Final = "techno-tagger"
RELEASE: Final = f"{APP_NAME}@{__version__}"

# Doit rester identique a `identifier` de tauri.conf.json : c'est lui, et non
# APP_NAME, que Tauri utilise pour composer `appLocalDataDir()`. Les deux cotes
# ecriraient sinon dans deux dossiers voisins, hors de portee des scopes fs.
BUNDLE_IDENTIFIER: Final = "fr.empiricmind.techno-tagger"

__all__ = ["APP_NAME", "BUNDLE_IDENTIFIER", "RELEASE", "__version__"]
