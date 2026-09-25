"""Cle X-API-Key de techno-scraper, rangee dans le trousseau de l'OS (ADR-012).

Seul module du sidecar a toucher le trousseau. La cle n'apparait dans aucun log,
aucun parametre d'erreur ni aucun evenement : l'interface n'apprend que son
existence, par l'evenement `version`.
"""

import logging
from typing import ClassVar, Final

import keyring
from keyring.errors import KeyringError, NoKeyringError, PasswordSetError

from tagger import APP_NAME
from tagger.errors import TaggerError

logger = logging.getLogger(__name__)

SERVICE: Final = APP_NAME
# Une seule entree : l'identifiant ne sert qu'a la retrouver dans le Credential Manager.
USERNAME: Final = "x-api-key"


class ApiKeyError(TaggerError):
    """Echec d'enregistrement de la cle, sans jamais porter la cle elle-meme."""

    code: ClassVar[str] = "api_key_error"


class ApiKeyNotStoredError(ApiKeyError):
    """Le trousseau a refuse l'ecriture."""

    code: ClassVar[str] = "api_key_not_stored"

    def __init__(self) -> None:
        super().__init__("api key not stored")


class KeyringUnavailableError(ApiKeyError):
    """Aucun backend de trousseau : le symptome du binaire fige mal empaquete."""

    code: ClassVar[str] = "keyring_unavailable"

    def __init__(self) -> None:
        super().__init__("no keyring backend")


class ApiKeyMissingError(ApiKeyError):
    """Aucune cle enregistree : rien ne peut etre demande a l'API."""

    code: ClassVar[str] = "api_key_missing"

    def __init__(self) -> None:
        super().__init__("no api key configured")


def read_api_key() -> str | None:
    """Cle enregistree, `None` au premier lancement ou si le trousseau est illisible.

    Un trousseau illisible ne bloque pas l'application : l'onglet Tagging dira qu'il
    manque la cle, ce qui oriente vers la bonne correction.
    """
    try:
        return keyring.get_password(SERVICE, USERNAME)
    except KeyringError:
        logger.warning("api key unreadable reason=keyring_error")
        return None


def store_api_key(key: str) -> None:
    """Range la cle, en remplacant la precedente."""
    try:
        keyring.set_password(SERVICE, USERNAME, key)
    except NoKeyringError as exc:
        raise KeyringUnavailableError from exc
    except PasswordSetError as exc:
        raise ApiKeyNotStoredError from exc
