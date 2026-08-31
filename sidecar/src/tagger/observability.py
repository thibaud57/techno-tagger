"""Initialisation de Sentry, durcie.

Sentry est actif d'office, sans ecran de consentement : sur un outil personnel,
une case a cocher ne protege rien. Ce qui protege, c'est ce que le SDK a le droit
d'envoyer, et les reglages ci-dessous sont a tester comme du code metier.
"""

import logging
import os
from pathlib import Path
from typing import TYPE_CHECKING, cast

from tagger import APP_NAME
from tagger.build_info import ENVIRONMENT

if TYPE_CHECKING:
    from sentry_sdk.types import Event, Hint

logger = logging.getLogger(__name__)

MASK = "<user>"

# `USERNAME` sous Windows, `USER` sur les runners Linux de la CI.
_USERNAME = os.getenv("USERNAME") or os.getenv("USER") or ""
# Les deux ecritures : le SDK rend des chemins Windows en `\`, les tracebacks de
# modules importes en `/`. Une seule des deux formes laisserait passer l'autre.
_HOME = str(Path.home())
_HOME_FORMS = {_HOME, _HOME.replace("\\", "/")}


def _mask(text: str) -> str:
    for home in _HOME_FORMS:
        text = text.replace(home, MASK)
    # Le nom nu apres les chemins : il reste dans `C:\Users\<nom>\...` tronque, dans
    # un partage reseau ou dans un message d'erreur de l'OS. Sur-masquer est le sens
    # de panne acceptable ici, pas l'inverse.
    return text.replace(_USERNAME, MASK) if _USERNAME else text


# Sentry route et regroupe sur ces champs, qui ne portent aucune donnee de
# l'utilisateur. Les masquer casserait le tri des qu'un nom de compte est le
# substring d'une valeur : `dev` rendrait `environment` egal a `<user>elopment`.
_ENVELOPE_KEYS = frozenset(
    {
        "environment",
        "event_id",
        "level",
        "logger",
        "modules",
        "platform",
        "release",
        "sdk",
        "server_name",
        "timestamp",
    }
)


def _mask_deep(value: object) -> object:
    match value:
        case str():
            return _mask(value)
        case dict():
            # La cle aussi : un chemin sert de cle dans un `extra` ou un contexte, et
            # le serializer du SDK la preserve telle quelle (`str_k = str(k)`).
            return {_mask(str(key)): _mask_deep(item) for key, item in value.items()}
        case list():
            return [_mask_deep(item) for item in value]
        case _:
            # Rien ne fuit ici : le SDK appelle `serialize()` avant `before_send`
            # (« annotated types do generally not surface in before_send »), tuple,
            # set et bytes y sont deja devenus list, str ou repr.
            return value


def _scrub(event: Event, _hint: Hint) -> Event | None:
    """Masque le nom d'utilisateur de l'OS partout ou il peut se glisser : chemins
    de frames, messages d'exception, tags, contextes. Le parcours est recursif et
    sans liste de champs, pour qu'un nouveau champ soit couvert d'office.
    """
    masked = {
        key: value if key in _ENVELOPE_KEYS else _mask_deep(value) for key, value in event.items()
    }
    return cast("Event", masked)


def init_sentry(dsn: str, release: str) -> None:
    """Un DSN vide rend le SDK inerte : c'est ainsi qu'on coupe la remontee en
    developpement, sans brancher de condition ailleurs dans le code.
    """
    if not dsn:
        return

    try:
        # Importe ici et pas au sommet : le SDK tire 290 modules pour ~140 ms, payes
        # a chaque lancement alors que le chemin nominal en developpement sort
        # ci-dessus. Dans le `try` car c'est precisement l'import qui peut manquer
        # du binaire fige, et un sidecar muet au demarrage n'a aucun diagnostic.
        import sentry_sdk  # noqa: PLC0415
        from sentry_sdk.integrations.logging import LoggingIntegration  # noqa: PLC0415

        sentry_sdk.init(
            dsn=dsn,
            release=release,
            environment=ENVIRONMENT,
            # Vaut True par defaut : le SDK joindrait les variables locales de
            # chaque frame, donc chemins, titres, voire la cle API.
            include_local_variables=False,
            # Sans valeur fixe, c'est le nom de machine de l'utilisateur qui part.
            server_name=APP_NAME,
            before_send=_scrub,
            # Les trois canaux de la LoggingIntegration fermes : chacun embarquerait
            # chemins et titres dans un event. Defauts ouverts, INFO pour les
            # breadcrumbs et ERROR pour les events issus d'un `logger.error`. Le
            # troisieme est inerte sans `enable_logs`, mais un ajout futur le rouvre.
            integrations=[LoggingIntegration(level=None, event_level=None, sentry_logs_level=None)],
            # Sonde une quarantaine d'integrations framework absentes d'ici : 90 ms
            # au demarrage, et autant de modules embarques par le hook au build.
            auto_enabling_integrations=False,
        )
    except Exception:
        # Le SDK importe ses integrations par importlib sans intercepter
        # ImportError : init() peut tomber dans le binaire fige.
        logger.exception("initialisation de Sentry impossible")
