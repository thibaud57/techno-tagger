"""Initialisation de Sentry, durcie.

Sentry est actif d'office, sans ecran de consentement : sur un outil personnel,
une case a cocher ne protege rien. Ce qui protege, c'est ce que le SDK a le droit
d'envoyer, et les reglages ci-dessous sont a tester comme du code metier.
"""

import logging
import os
import re
from pathlib import Path
from typing import TYPE_CHECKING, Final, cast

from tagger import APP_NAME
from tagger.build_info import ENVIRONMENT

if TYPE_CHECKING:
    from sentry_sdk.types import Event, Hint

logger = logging.getLogger(__name__)

MASK = "<user>"
QUERY_MASK = "<query>"

# Une recherche part en parametre d'URL, donc l'artiste et le titre du morceau, et
# httpx2 ecrit l'URL entiere dans le message de `HTTPStatusError`. Le SDK remonte la
# chaine `__cause__` d'une exception et recopie chaque message tel quel : sans ce
# masquage, un statut hors des cas traites emmenait le morceau vers Sentry, ce que
# l'ADR-014 interdit. Le diagnostic tient au `request_id`, jamais a la requete.
# `?` exclu du groupe `url` : gourmand, il avalait les `?` intermediaires et seul
# ce qui suivait le dernier etait masque, laissant passer la premiere requete.
_URL_QUERY: Final = re.compile(r"(?P<url>[a-z][\w+.-]*://[^\s'\"<>?]*)\?[^\s'\"<>]*", re.IGNORECASE)

# `USERNAME` sous Windows, `USER` sur les runners Linux de la CI.
_USERNAME = os.getenv("USERNAME") or os.getenv("USER") or ""
# Les deux ecritures : le SDK rend des chemins Windows en `\`, les tracebacks de
# modules importes en `/`. Une seule des deux formes laisserait passer l'autre.
_HOME = str(Path.home())
_HOME_FORMS = {_HOME, _HOME.replace("\\", "/")}


def _mask(text: str) -> str:
    text = _URL_QUERY.sub(rf"\g<url>?{QUERY_MASK}", text)
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
        # Importe ici et pas au sommet : le SDK tire plusieurs centaines de modules,
        # payes a chaque lancement alors que le chemin nominal en developpement sort
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
            # Sonde des integrations framework toutes absentes d'ici : du temps au
            # demarrage, et autant de modules embarques par le hook au build.
            auto_enabling_integrations=False,
        )
    except Exception:
        # Le SDK importe ses integrations par importlib sans intercepter
        # ImportError : init() peut tomber dans le binaire fige.
        logger.exception("initialisation de Sentry impossible")
