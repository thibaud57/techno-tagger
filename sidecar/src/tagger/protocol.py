"""Modeles Pydantic des commandes et des evenements du protocole NDJSON.

Seule interface publique du sidecar : tout le reste est appele depuis la boucle
de `__main__.py`. Les types TypeScript de `src/app/core/models/` sont maintenus
a la main en miroir de ce fichier.

Les commandes entrantes sont fermees (`extra="forbid"`) et strictes : un champ
inconnu ou mal type est une commande malformee, pas un detail a ignorer
(cf. ADR-022).
"""

from enum import UNIQUE, StrEnum, auto, verify
from pathlib import Path
from typing import TYPE_CHECKING, Annotated, Final, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, TypeAdapter, ValidationError

from tagger.extraction import DuplicateCriterion, ExtractionFailureReason, ExtractionMode
from tagger.playlists import PlaylistFormat

if TYPE_CHECKING:
    from tagger.errors import TaggerError


class Command(BaseModel):
    """Base des commandes recues sur `stdin`.

    `strict=True` interdit la coercion lax sur ce qui vient de l'interface. En
    contrepartie, ces modeles ne se valident **que** depuis du JSON : en mode
    Python, une chaine n'est plus convertie en `Path` et la validation echoue sur
    `is_instance_of`. Toujours passer par `parse_command`, jamais par
    `model_validate` sur un dict.
    """

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class GetVersion(Command):
    """Emise au demarrage, avant toute autre commande."""

    command: Literal["get_version"]


class Shutdown(Command):
    """Emise a la fermeture de la fenetre. L'EOF sur `stdin` reste le filet si
    l'application est tuee.
    """

    command: Literal["shutdown"]


class ListPlaylists(Command):
    """Sans objet pour un M3U8, qui ne contient qu'une playlist."""

    command: Literal["list_playlists"]
    playlist_path: Path


class ExtractPlaylist(Command):
    """`playlist_name` n'est requis que pour un dump VLC, qui porte toute la
    mediatheque et fait donc choisir.
    """

    command: Literal["extract_playlist"]
    source_folder: Path
    destination_folder: Path
    playlist_path: Path
    playlist_name: str | None = None
    mode: ExtractionMode = ExtractionMode.COPY


# ASCII imprimable sans espace : contrainte du decodage latin-1 des en-tetes cote
# API (PRODUCTION.md § Regles). 2560 : plafond du Credential Manager.
_API_KEY_PATTERN: Final = r"^[\x21-\x7e]+$"
_API_KEY_MAX_LENGTH: Final = 2560


class SetApiKey(Command):
    """Seul passage de la cle dans le protocole : elle ne revient jamais vers la webview.

    Le format est controle, pas la validite : une cle revoquee arrete le run sur
    ses 403 (ARCHITECTURE.md § Cle API invalide ou revoquee).
    """

    command: Literal["set_api_key"]
    api_key: Annotated[
        str,
        StringConstraints(pattern=_API_KEY_PATTERN, max_length=_API_KEY_MAX_LENGTH),
        Field(repr=False),
    ]


type AnyCommand = Annotated[
    GetVersion | Shutdown | ListPlaylists | ExtractPlaylist | SetApiKey,
    Field(discriminator="command"),
]

# `shutdown` sort de la boucle sans rien executer : l'exclure ici permet au `match`
# du dispatch de se fermer par `assert_never` sans laisser de cas non couvert.
type ExecutableCommand = GetVersion | ListPlaylists | ExtractPlaylist | SetApiKey

_COMMAND_ADAPTER: Final = TypeAdapter[AnyCommand](AnyCommand)


def parse_command(line: str) -> AnyCommand:
    """Valide une ligne de `stdin` et rend la commande correspondante.

    Leve `ValidationError`, que la boucle convertit en evenement `error` : un
    message Pydantic ne remonte jamais jusqu'a l'ecran.
    """
    return _COMMAND_ADAPTER.validate_json(line)


@verify(UNIQUE)
class Phase(StrEnum):
    """Phases longues que couvre l'evenement `progress`."""

    EXTRACTION = auto()
    TAGGING = auto()
    URL_RECOVERY = auto()
    WRITE = auto()


class Event(BaseModel):
    """Base des evenements emis sur `stdout`.

    Ni `strict` ni `forbid` : ces modeles sont construits par le sidecar lui-meme,
    pas recus d'un tiers. Ce qui compte ici est la sortie, pas la validation.
    """

    model_config = ConfigDict(frozen=True)


class Version(Event):
    """`api_key_configured` parce que seul le sidecar lit le trousseau : c'est ici
    que l'interface apprend qu'une cle existe, avant tout run (ADR-012).
    """

    event: Literal["version"]
    version: str
    api_key_configured: bool


class PlaylistEntry(BaseModel):
    """Une playlist du dump, telle que le selecteur l'affiche."""

    model_config = ConfigDict(frozen=True)

    playlist_id: int
    name: str
    track_count: int


class PlaylistsListed(Event):
    """Porte le format reconnu autant que les playlists.

    L'interface doit savoir s'il faut proposer un selecteur, et reconnaitre un
    format cote TypeScript serait une regle metier au mauvais endroit. Un M3U8
    rend donc une liste vide et son format, jamais une erreur.
    """

    event: Literal["playlists_listed"]
    playlist_format: PlaylistFormat
    playlists: tuple[PlaylistEntry, ...]


class Progress(Event):
    event: Literal["progress"]
    phase: Phase
    processed: int
    total: int


class DiscardedCandidatePayload(BaseModel):
    model_config = ConfigDict(frozen=True)

    path: Path
    size: int


class DuplicatePayload(BaseModel):
    model_config = ConfigDict(frozen=True)

    file_name: str
    kept_path: Path
    kept_size: int
    criterion: DuplicateCriterion
    discarded: tuple[DiscardedCandidatePayload, ...]


class FailurePayload(BaseModel):
    model_config = ConfigDict(frozen=True)

    file_name: str
    reason: ExtractionFailureReason


class ExtractionFinished(Event):
    """Categories plus fines que celles d'ARCHITECTURE.md : un transfert peut
    echouer sans que le morceau soit introuvable, et un fichier deja present n'a
    pas ete extrait.
    """

    event: Literal["extraction_finished"]
    extracted: tuple[str, ...]
    already_present: tuple[str, ...]
    missing: tuple[str, ...]
    duplicates: tuple[DuplicatePayload, ...]
    failures: tuple[FailurePayload, ...]
    report_path: Path


class Error(Event):
    """Reserve a ce qui ne se rattache a aucun morceau. Le `message` est technique,
    destine aux logs ; l'interface traduit le `code`.
    """

    event: Literal["error"] = "error"
    code: str
    params: dict[str, object]
    message: str


MALFORMED_COMMAND: Final = "malformed_command"

# Type Pydantic d'une valeur de discriminant hors union : la commande est inconnue.
UNKNOWN_COMMAND_ERROR: Final = "union_tag_invalid"


def error_from_validation(exc: ValidationError) -> Error:
    """Convertit un refus de validation en evenement structure.

    Seuls `loc` et `type` sont retenus : ils suffisent a situer le champ fautif
    dans les logs, et le message de Pydantic n'a pas vocation a etre lu par
    l'utilisateur. Une commande inconnue est en plus nommee sous `command` :
    Pydantic ne la porte que dans `ctx`, que `loc` et `type` laissent de cote.
    `ctx` n'est pas recopie en entier, il peut porter des objets que le JSON ne
    serialise pas (l'exception d'un validateur).
    """
    details: list[dict[str, object]] = []
    params: dict[str, object] = {"errors": details}
    for error in exc.errors():
        details.append({"loc": list(error["loc"]), "type": error["type"]})
        # `loc` vide : le discriminant de la ligne elle-meme, pas celui d'une union
        # imbriquee qu'un futur modele pourrait declarer.
        if error["type"] == UNKNOWN_COMMAND_ERROR and not error["loc"]:
            params["command"] = error.get("ctx", {}).get("tag")

    return Error(
        code=MALFORMED_COMMAND,
        params=params,
        message="command rejected by validation",
    )


def error_from_business(exc: TaggerError) -> Error:
    """Convertit une erreur metier en evenement, en gardant son code et ses params."""
    return Error(code=exc.code, params=dict(exc.params), message=str(exc))


def emit(event: Event) -> str:
    """Rend la ligne NDJSON d'un evenement.

    `model_dump_json()` produit une seule ligne, ce qu'exige le protocole : ne
    jamais y ajouter d'`indent`.
    """
    return event.model_dump_json()
