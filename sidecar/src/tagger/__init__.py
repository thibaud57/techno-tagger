"""Sidecar metier de techno-tagger."""

from typing import Final

from tagger.core.build_info import VERSION

__version__ = VERSION

# En dur : le paquet s'appelle `tagger` et aucun manifeste lisible par le sidecar ne porte
# `techno-tagger`. Doit egaler la valeur de la webview, sinon les erreurs des deux cotes
# d'une meme livraison ne se rattachent pas a la meme release.
APP_NAME: Final = "techno-tagger"
RELEASE: Final = f"{APP_NAME}@{__version__}"

# Doit egaler `identifier` de tauri.conf.json : Tauri en compose `appLocalDataDir()`,
# pas APP_NAME. Sinon les deux cotes ecrivent dans deux dossiers voisins.
BUNDLE_IDENTIFIER: Final = "fr.empiricmind.techno-tagger"

# Copie de `repository` dans src-tauri/Cargo.toml, que le sidecar ne lit pas.
REPOSITORY_URL: Final = "https://github.com/thibaud57/techno-tagger"

__all__ = ["APP_NAME", "BUNDLE_IDENTIFIER", "RELEASE", "REPOSITORY_URL", "__version__"]
