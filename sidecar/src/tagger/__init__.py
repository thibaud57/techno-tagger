"""Sidecar metier de techno-tagger."""

from tagger.build_info import VERSION

__version__ = VERSION

# Le paquet s'appelle `tagger`, l'application `techno-tagger` : ce nom ne se derive
# donc d'aucun manifeste lisible par le sidecar, il est fixe en dur pour matcher
# exactement celui de la webview. Deux noms differents, et une erreur de sidecar ne
# se croiserait avec aucune erreur de webview sur une meme livraison.
APP_NAME = "techno-tagger"
RELEASE = f"{APP_NAME}@{__version__}"

# Doit rester identique a `identifier` de tauri.conf.json : c'est lui, et non
# APP_NAME, que Tauri utilise pour composer `appLocalDataDir()`. Les deux cotes
# ecriraient sinon dans deux dossiers voisins, hors de portee des scopes fs.
BUNDLE_IDENTIFIER = "fr.empiricmind.techno-tagger"

__all__ = ["APP_NAME", "BUNDLE_IDENTIFIER", "RELEASE", "__version__"]
