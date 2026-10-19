"""Initialisation de Sentry, durcie.

Sentry est actif d'office, sans ecran de consentement : sur un outil personnel, une
case a cocher ne protege rien, seul compte ce que le SDK a le droit d'envoyer. Les
reglages ci-dessous et `_scrub` sont a tester sur l'enveloppe reellement construite
(`tests/unit/core/test_sentry_payload.py`).
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
MESSAGE_MASK: Final = "<message>"

# Lancee avec elle, l'application installee envoie un evenement de test par cote (PRODUCTION.md
# § Observabilite). Le DSN, grave au build, dit ou envoyer, elle dit d'envoyer maintenant.
SELFTEST_ENV: Final = "TECHNO_TAGGER_SENTRY_SELFTEST"
# Faux morceau du self-test, que le masquage doit effacer. Declare ici et non pres de la frame
# qui leve : le SDK joint cinq lignes de source par frame, un litteral voisin partirait avec.
_SELFTEST_PATH: Final = r"D:\Musique\Nova Pulse - Your Mind.mp3"

# Types dont le message ne porte aucune donnee de l'utilisateur, par nom qualifie : `core/`
# n'importe aucun package metier. Tout autre message part en `MESSAGE_MASK`, ceux du sidecar
# compris : ils portent `path.name` ou un `track_id`, chemin relatif du fichier qu'aucun motif
# de chemin absolu ne reconnait. Un type n'entre ici que si son message est construit sans
# chemin, sans nom de fichier et sans valeur recue de l'API (cf. ADR-014, mise a jour du
# 2026-10-15).
_SAFE_MESSAGE_TYPES: Final = frozenset({"tagger.resolution.scraper_client.ApiContractError"})

# httpx2 ecrit l'URL entiere, donc l'artiste et le titre, dans le message de
# `HTTPStatusError`, que le SDK recopie via la chaine `__cause__` : sans masquage le
# morceau part vers Sentry, ce que l'ADR-014 interdit. Le diagnostic tient au
# `request_id`. `?` est exclu du groupe `url`, sinon gourmand : il avale les `?`
# intermediaires et laisse passer tout ce qui precede le dernier.
_URL_QUERY: Final = re.compile(r"(?P<url>[a-z][\w+.-]*://[^\s'\"<>?]*)\?[^\s'\"<>]*", re.IGNORECASE)

# Debut d'un chemin : lettre de lecteur (`D:\`, `D:/`) ou partage UNC (`\\serveur\`).
_PATH_START: Final = r"(?:[A-Za-z]:[\\/]|\\\\[^\s\\/'\"<>]+[\\/])"

# Le nom du fichier porte l'artiste et le titre, donc un morceau. Un chemin ouvert par un
# guillemet court jusqu'au guillemet suivant : `repr()` entoure de `"` un chemin qui contient
# une apostrophe (« Don't Stop.mp3 »), de `'` les autres. Un chemin ouvert par `'` court jusqu'a
# la derniere apostrophe de la ligne (glouton, avec lookahead) : une apostrophe du nom, qu'elle
# precede une lettre ou une espace (« Guns N' Roses »), ne le ferme donc pas. Sans apostrophe
# fermante, il court jusqu'a la fin de ligne. Le texte entre deux apostrophes apres le chemin
# (`'D:\x.mp3' from user's folder`) est avale avec lui, sur-masquage accepte. Un chemin nu garde
# ses espaces et ses apostrophes et s'arrete a `"`, `<>`, a la fin de ligne, avant un champ
# logfmt de la liste fermee des cles de log (voir `gestion-erreurs.md`) et avant `: `
# (Windows interdit `:` dans un nom de fichier). Pas de `, ` ni de cle generique `[a-z_]+=` :
# un nom de fichier peut en contenir (« Artist A, Artist B », « vol=2 ») et la fin du nom
# partirait alors vers Sentry. Une phrase qui suit sans separateur est avalee, sens de panne
# accepte. Un chemin nu ne suit ni un caractere de mot, sinon `http://` serait pris pour `p:/`,
# ni un guillemet, que les deux premieres branches traitent. Residu accepte : un chemin ouvert
# par `'` sans guillemet fermant, au nom qui contient une apostrophe (`open 'D:\x\Don't Stop.mp3
# failed`), laisse la fin du nom apres la derniere apostrophe (`t Stop.mp3 failed`). `repr()`
# entoure ce nom de `"` et tout message hors de la liste fermee part en `<message>` de toute facon.
_WINDOWS_PATH: Final = re.compile(
    rf"(?<=\"){_PATH_START}[^\"\r\n]*"
    rf"|(?<='){_PATH_START}(?:[^\r\n]*(?=')|[^'\r\n]*)"
    rf"|(?<![\w'\"]){_PATH_START}"
    r"(?:(?!\s+(?:run|track|source|score|status|reason|request_id)=|:\s)[^\"<>\r\n])*"
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


def _keeps_message(entry: object) -> bool:
    """Vrai pour un type de `_SAFE_MESSAGE_TYPES`, juge sur `module` et `type` du SDK.

    A appeler avant `_mask_deep` : il remplace le nom de compte de l'OS jusque dans `module`,
    et un compte qui en est une sous-chaine (`client`) ferait perdre le message d'un type sur.
    """
    match entry:
        case {"module": str() as module, "type": str() as name}:
            return f"{module}.{name}" in _SAFE_MESSAGE_TYPES
        case _:
            return False


def _mask_message(entry: object) -> object:
    match entry:
        case {"value": _, **rest}:
            return {**rest, "value": MESSAGE_MASK}
        case _:
            return entry


def _mask_messages(exception: object) -> object:
    match exception:
        case {"values": list() as values, **rest}:
            return {
                **rest,
                "values": [
                    entry if _keeps_message(entry) else _mask_message(entry) for entry in values
                ],
            }
        case _:
            return exception


def _scrub_field(key: str, value: object) -> object:
    if key in _ENVELOPE_KEYS:
        return value
    if key == "exception":
        value = _mask_messages(value)
    return _mask_deep(value)


def _scrub(event: Event, _hint: Hint) -> Event | None:
    """Masque ce qui designe un morceau ou le compte de l'OS : chemins de frames, tags,
    contextes, et le message de toute exception hors de la liste fermee. Le parcours est
    recursif et sans liste de champs, pour qu'un nouveau champ soit couvert d'office.

    La liste se juge sur les champs de l'evenement, pas sur l'exception du `hint` : la regle
    couvre de la meme facon `capture_unexpected`, le crash attrape par l'excepthook du SDK et
    chaque membre d'un `ExceptionGroup`. Type, module et pile restent, seule `value` part.
    """
    masked = {key: _scrub_field(key, value) for key, value in event.items()}
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
            # Chaque categorie fermee, `stack_frame_variables` compris : des que
            # `data_collection` est pose, le SDK ne lit plus `include_local_variables`, collecte
            # toute categorie omise et n'installe plus son `EventScrubber` (lu dans
            # `data_collection.py`, `utils.py` et `client.py` de 2.71.0, le 2026-10-16) : aucune
            # donnee sensible dans `set_extra`, `set_context` ni `set_tag`. Les variables d'une
            # frame porteraient chemins, titres, voire la cle API. `frame_context_lines` garde
            # son defaut : des lignes de ce depot, public. Une categorie ajoutee par une montee
            # du SDK fait echouer `test_sentry_payload.py` au lieu de partir ouverte.
            data_collection={
                "user_info": False,
                "cookies": {"mode": "off"},
                "http_headers": {"request": {"mode": "off"}},
                "http_bodies": [],
                "url_query_params": {"mode": "off"},
                "graphql": {"document": False, "variables": False},
                "gen_ai": {"inputs": False, "outputs": False},
                "database_query_data": False,
                "queues": False,
                "stack_frame_variables": False,
            },
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


class SentrySelfTestError(Exception):
    """Evenement de test : pas une `TaggerError`, il n'atteint jamais l'interface."""


def selftest_requested() -> bool:
    """Seule la valeur `1` declenche : une autre, absente comprise, n'envoie rien."""
    return os.getenv(SELFTEST_ENV, "") == "1"


def send_selftest() -> None:
    """Remonte un evenement porteur de fausses donnees sensibles : son message doit arriver en
    `<message>`, sa frame sans variable. DSN vide : rien ne part, comme toute remontee."""
    try:
        _raise_selftest(_SELFTEST_PATH)
    except SentrySelfTestError as error:
        capture_unexpected(error)


def _raise_selftest(path: str) -> None:
    # `path` est la variable locale sensible de la frame : elle ne doit pas partir.
    raise SentrySelfTestError(f"sentry self test, must be masked: {path}")
