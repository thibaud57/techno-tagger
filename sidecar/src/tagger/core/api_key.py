"""Cle X-API-Key de techno-scraper, rangee dans le trousseau de l'OS (ADR-012).

Seul module du sidecar a toucher le trousseau. La cle n'apparait dans aucun log, parametre
d'erreur ni evenement : l'interface n'apprend que son existence (evenement `version`).
"""

from typing import ClassVar, Final

import keyring
from keyring.errors import KeyringError, NoKeyringError, PasswordSetError

# pywin32-ctypes ne livre ni stubs ni `py.typed` : l'import est non type, et la classe est
# ramenee a `type[Exception]` juste en dessous pour ne pas propager d'`Any`.
from win32ctypes.pywin32.pywintypes import error as win32_error  # type: ignore[import-untyped]

from tagger import APP_NAME
from tagger.core.errors import TaggerError

SERVICE: Final = APP_NAME
# Une seule entree : l'identifiant ne sert qu'a la retrouver dans le Credential Manager.
USERNAME: Final = "x-api-key"
# `WinVaultKeyring` laisse passer l'erreur Win32 brute d'un `CredRead` / `CredWrite` en echec
# (secret trop gros, strategie de securite qui bloque le Credential Manager), qui n'herite
# pas de `KeyringError` : sans elle, l'exception sortirait de la boucle et tuerait le sidecar.
_CREDENTIAL_MANAGER_ERROR: Final[type[Exception]] = win32_error


class ApiKeyError(TaggerError):
    """Echec d'enregistrement de la cle, sans jamais porter la cle elle-meme."""

    code: ClassVar[str] = "api_key_error"


class ApiKeyNotStoredError(ApiKeyError):
    """Le trousseau a refuse l'ecriture."""

    code: ClassVar[str] = "api_key_not_stored"

    def __init__(self) -> None:
        super().__init__("api key not stored")


class KeyringUnavailableError(ApiKeyError):
    """Trousseau inutilisable (aucun backend, ou lecture en echec) : jamais une cle absente."""

    code: ClassVar[str] = "keyring_unavailable"

    def __init__(self) -> None:
        super().__init__("no keyring backend")


class ApiKeyMissingError(ApiKeyError):
    code: ClassVar[str] = "api_key_missing"

    def __init__(self) -> None:
        super().__init__("no api key configured")


def read_api_key() -> str | None:
    """Cle enregistree, `None` au premier lancement seulement.

    Un trousseau illisible leve : le prendre pour une cle absente ferait ressaisir une cle
    qui existe peut-etre encore.
    """
    try:
        return keyring.get_password(SERVICE, USERNAME)
    except (KeyringError, _CREDENTIAL_MANAGER_ERROR) as exc:
        raise KeyringUnavailableError from exc


def store_api_key(key: str) -> None:
    try:
        keyring.set_password(SERVICE, USERNAME, key)
    except NoKeyringError as exc:
        raise KeyringUnavailableError from exc
    except (PasswordSetError, _CREDENTIAL_MANAGER_ERROR) as exc:
        raise ApiKeyNotStoredError from exc
