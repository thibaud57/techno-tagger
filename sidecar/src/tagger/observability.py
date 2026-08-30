"""Initialisation de Sentry, durcie.

Sentry est actif d'office, sans ecran de consentement : sur un outil personnel,
une case a cocher ne protege rien. Ce qui protege, c'est ce que le SDK a le droit
d'envoyer, et les trois reglages ci-dessous sont a tester comme du code metier.
"""

import logging
from typing import TYPE_CHECKING, Any

import sentry_sdk
from sentry_sdk.integrations.logging import LoggingIntegration

if TYPE_CHECKING:
    from sentry_sdk.types import Event

logger = logging.getLogger(__name__)

# Fixe, sinon le SDK envoie le nom de la machine de l'utilisateur a chaque event.
SERVER_NAME = "techno-tagger"


def _scrub(event: Event, _hint: dict[str, Any]) -> Event | None:
    # TODO: implement, masquer le nom d'utilisateur de l'OS dans les chemins des
    # frames, et etendre a chaque nouveau champ portant une donnee locale.
    return event


def init_sentry(dsn: str | None, release: str) -> None:
    """Un DSN vide rend le SDK inerte : c'est ainsi qu'on coupe la remontee en
    developpement, sans brancher de condition ailleurs dans le code.
    """
    if not dsn:
        return

    try:
        sentry_sdk.init(
            dsn=dsn,
            release=release,
            environment="production",
            # Vaut True par defaut : le SDK joindrait les variables locales de
            # chaque frame, donc chemins, titres, voire la cle API.
            include_local_variables=False,
            server_name=SERVER_NAME,
            before_send=_scrub,
            # level=None coupe les breadcrumbs, qui partent des INFO par defaut
            # et embarqueraient chemins et titres dans le prochain event.
            integrations=[LoggingIntegration(level=None)],
        )
    except Exception:
        # Le SDK importe ses integrations par importlib sans intercepter
        # ImportError : init() peut tomber dans le binaire figé.
        logger.exception("initialisation de Sentry impossible")
