"""Constantes figees au packaging, et leurs valeurs de repli en developpement.

PyInstaller n'a pas d'equivalent au `--define` d'esbuild : `build.py` grave donc un
module `_build_info` a la racine de `tagger/`, gitignore parce qu'il porte le DSN. Ce
fichier-ci est la facade versionnee, seule importee par le reste du sidecar.

La version en fait partie : dans le binaire figee, `importlib.metadata` ne trouve
aucun `tagger.dist-info`, la spec ne collectant que celui de keyring. La lire ici
leverait `PackageNotFoundError` au demarrage, et seulement chez l'utilisateur.
"""

try:
    from tagger._build_info import ENVIRONMENT, SENTRY_DSN, VERSION
except ImportError:
    from importlib.metadata import version

    # Hors packaging : le paquet est installe en editable, la version est lisible.
    # La distribution porte le nom du package racine, pas celui de `tagger.core`.
    SENTRY_DSN = ""
    VERSION = version(__name__.partition(".")[0])
    ENVIRONMENT = "development"

__all__ = ["ENVIRONMENT", "SENTRY_DSN", "VERSION"]
