"""Initialisation de Sentry, durcie.

Sentry est actif d'office, sans ecran de consentement : sur un outil personnel, une
case a cocher ne protege rien, seul compte ce que le SDK a le droit d'envoyer. Les
reglages ci-dessous se testent comme du code metier.
"""

import logging
import os
import re
from pathlib import Path
from typing import TYPE_CHECKING, Final, cast

from tagger import APP_NAME
from tagger.core.build_info import ENVIRONMENT

if TYPE_CHECKING:
    from sentry_sdk.types import Event, Hint

logger = logging.getLogger(__name__)

MASK: Final = "<user>"
QUERY_MASK: Final = "<query>"
PATH_MASK: Final = "<path>"

# httpx2 ecrit l'URL entiere, donc l'artiste et le titre, dans le message de
# `HTTPStatusError`, que le SDK recopie via la chaine `__cause__` : sans masquage le
# morceau part vers Sentry, ce que l'ADR-014 interdit. Le diagnostic tient au
# `request_id`. `?` est exclu du groupe `url`, sinon gourmand : il avale les `?`
# intermediaires et laisse passer tout ce qui precede le dernier.
_URL_QUERY: Final = re.compile(r"(?P<url>[a-z][\w+.-]*://[^\s'\"<>?]*)\?[^\s'\"<>]*", re.IGNORECASE)

# Chemin de lecteur (`D:\...`, `D:/...`) ou UNC (`\\serveur\partage\...`) : le nom du
# fichier porte l'artiste et le titre, donc un morceau. Les espaces font partie du chemin
# (« Nova Pulse - Your Mind.mp3 »), qui s'arrete donc aux guillemets, `<>`, a la fin de
# ligne, avant un champ logfmt de la liste fermee des cles de log (voir
# `gestion-erreurs.md`) ou avant `: ` (Windows interdit `:` dans un nom de fichier).
# Ni `, ` ni cle generique `[a-z_]+=` comme borne : un nom de fichier peut en contenir
# (« Artist A, Artist B », « vol=2 ») et sa fin partirait alors vers Sentry.
# Une phrase qui suit sans separateur est avalee, sens de panne accepte. La lettre de
# lecteur ne doit pas suivre un caractere de mot, sinon `http://` serait pris pour `p:/`.
_WINDOWS_PATH: Final = re.compile(
    r"(?:(?<!\w)[A-Za-z]:[\\/]|\\\\[^\s\\/'\"<>]+[\\/])"
    r"(?:(?!\s+(?:run|track|source|score|status|reason|request_id)=|:\s)[^'\"<>\r\n])*"
)

# `USERNAME` sous Windows, `USER` sur les runners Linux de la CI.
_USERNAME: Final = os.getenv("USERNAME") or os.getenv("USER") or ""
# Les deux ecritures : le SDK rend des chemins Windows en `\`, les tracebacks de
# modules importes en `/`. Une seule des deux formes laisserait passer l'autre.
_HOME: Final = str(Path.home())
_HOME_FORMS: Final = {_HOME, _HOME.replace("\\", "/")}


def _mask(text: str) -> str:
    text = _URL_QUERY.sub(rf"\g<url>?{QUERY_MASK}", text)
    # Chemins d'abord : masquer le dossier personnel en premier retirerait la lettre de
    # lecteur, donc la fin du chemin (nom du morceau compris) echapperait au masque.
    text = _WINDOWS_PATH.sub(PATH_MASK, text)
    return _mask_account(text)


def _mask_account(text: str) -> str:
    for home in _HOME_FORMS:
        text = text.replace(home, MASK)
    # Le nom nu apres les chemins : il reste dans `C:\Users\<nom>\...` tronque, dans
    # un partage reseau ou dans un message d'erreur de l'OS. Sur-masquer est le sens
    # de panne acceptable ici, pas l'inverse.
    return text.replace(_USERNAME, MASK) if _USERNAME else text


# Sentry route et regroupe sur ces champs, qui ne portent aucune donnee de
# l'utilisateur. Les masquer casserait le tri des qu'un nom de compte est le
# substring d'une valeur : `dev` rendrait `environment` egal a `<user>elopment`.
_ENVELOPE_KEYS: Final = frozenset(
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


# Chemins de code d'une frame : ils ne portent aucun morceau, seulement le compte de l'OS.
# Le masque `<path>` y effacerait la trace de la pile qui sert a deboguer.
_CODE_PATH_KEYS: Final = frozenset({"abs_path", "filename", "module", "package"})


def _mask_deep(value: object) -> object:
    match value:
        case str():
            return _mask(value)
        case dict():
            # La cle aussi : un chemin sert de cle dans un `extra` ou un contexte que le
            # serializer du SDK preserve tel quel (`str_k = str(k)`).
            return {
                _mask(str(key)): (
                    _mask_account(item)
                    if key in _CODE_PATH_KEYS and isinstance(item, str)
                    else _mask_deep(item)
                )
                for key, item in value.items()
            }
        case list():
            return [_mask_deep(item) for item in value]
        case _:
            # Rien ne fuit ici : le SDK appelle `serialize()` avant `before_send`
            # (« annotated types do generally not surface in before_send »), tuple,
            # set et bytes y sont deja devenus list, str ou repr.
            return value


def _scrub(event: Event, _hint: Hint) -> Event | None:
    """Masque ce qui designe un morceau ou le compte de l'OS : chemins de frames, messages
    d'exception, tags, contextes. Le parcours est recursif et sans liste de champs, pour
    qu'un nouveau champ soit couvert d'office.
    """
    masked = {
        key: value if key in _ENVELOPE_KEYS else _mask_deep(value) for key, value in event.items()
    }
    # Mypy ne reconstruit pas un TypedDict a cles dynamiques (`Event(**masked)` est refuse) :
    # le dict garde exactement les cles de `event`, seules les valeurs sont masquees.
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
        # ci-dessus. Dans le `try` car c'est l'import qui peut manquer du binaire fige :
        # un sidecar muet au demarrage n'a aucun diagnostic.
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
            # Les trois canaux de la LoggingIntegration fermes, chacun embarquerait chemins
            # et titres dans un event : breadcrumbs (INFO par defaut), events issus d'un
            # `logger.error` (ERROR par defaut) et logs SDK. Ce dernier est inerte sans
            # `enable_logs`, mais l'activer le rouvrirait.
            integrations=[LoggingIntegration(level=None, event_level=None, sentry_logs_level=None)],
            # Sonde des integrations framework toutes absentes d'ici : du temps au
            # demarrage et autant de modules embarques par le hook au build.
            auto_enabling_integrations=False,
        )
    except Exception:
        # Le SDK importe ses integrations par importlib sans intercepter
        # ImportError : init() peut tomber dans le binaire fige.
        logger.exception("sentry initialization failed")


def capture_unexpected(error: BaseException) -> None:
    """Remonte a Sentry un bug que le site a deja logue.

    `LoggingIntegration` est coupee (cf. `init_sentry`) : le log ne part pas, le bug doit
    remonter par ici.
    """
    # Meme import differe que `init_sentry` : le SDK n'est paye que sur le chemin qui s'en sert.
    import sentry_sdk  # noqa: PLC0415

    sentry_sdk.capture_exception(error)
