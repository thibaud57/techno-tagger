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
from typing import TYPE_CHECKING, Annotated, Final, Literal, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    TypeAdapter,
    ValidationError,
    model_validator,
)

from tagger.extraction import DuplicateCriterion, ExtractionFailureReason, ExtractionMode
from tagger.matching import MatchingThresholds, check_thresholds
from tagger.playlists import PlaylistFormat
from tagger.scraper_client import Source
from tagger.tagging import FailureReason, Resolution, TrackState

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


class ThresholdsPayload(BaseModel):
    """Seuils envoyes par les Settings. Absents, le sidecar applique les siens."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    floor: float
    ceiling: float

    @model_validator(mode="after")
    def _within_bounds(self) -> Self:
        # Les bornes ne sont pas reecrites ici, `check_thresholds` les porte. Pydantic
        # enveloppe en `ValidationError` ce que leve un validateur, d'ou le
        # `malformed_command` des la validation plutot qu'une erreur en plein run.
        check_thresholds(self.floor, self.ceiling)
        return self

    def to_matching(self) -> MatchingThresholds:
        """Seuils du metier, deja valides a la construction de la commande."""
        return MatchingThresholds(floor=self.floor, ceiling=self.ceiling)


class StartTagging(Command):
    """Dossier a re-tagger, et seuils de matching quand les Settings en imposent."""

    command: Literal["start_tagging"]
    folder: Path
    thresholds: ThresholdsPayload | None = None


type AnyCommand = Annotated[
    GetVersion | Shutdown | ListPlaylists | ExtractPlaylist | SetApiKey | StartTagging,
    Field(discriminator="command"),
]

# `shutdown` sort de la boucle sans rien executer : l'exclure ici permet au `match`
# du dispatch de se fermer par `assert_never` sans laisser de cas non couvert.
type ExecutableCommand = GetVersion | ListPlaylists | ExtractPlaylist | SetApiKey | StartTagging

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


@verify(UNIQUE)
class RunPhase(StrEnum):
    """Phase que `run_finished` cloture : la boucle reseau, puis l'ecriture."""

    NETWORK = auto()
    WRITE = auto()


class TrackEntry(BaseModel):
    """Un morceau du run tel que la liste l'affiche avant toute resolution."""

    model_config = ConfigDict(frozen=True)

    track_id: str
    file_name: str
    artist: str
    title: str


class RunStarted(Event):
    """Toutes les lignes de la liste, des le depart : sans lui, l'ecran reste vide
    jusqu'a la premiere resolution.
    """

    event: Literal["run_started"]
    run_id: str
    tracks: tuple[TrackEntry, ...]


class TrackNames(BaseModel):
    """Artiste et titre qu'une source ecrira, calcules cote sidecar (ADR-011)."""

    model_config = ConfigDict(frozen=True)

    artist: str
    title: str


class TrackScores(BaseModel):
    """Scores arrondis pour l'affichage. `artist` nul : la requete n'en avait pas."""

    model_config = ConfigDict(frozen=True)

    artist: int | None
    title: int
    average: int


class TrackResolved(Event):
    """Etat d'un morceau en trois champs, jamais en une valeur plate."""

    event: Literal["track_resolved"]
    track_id: str
    state: TrackState
    resolution: Resolution
    failure_reason: FailureReason | None = None
    source: Source | None = None
    after: TrackNames | None = None
    scores: TrackScores | None = None
    artwork_path: Path | None = None


class CandidatePayload(BaseModel):
    """Un candidat en zone grise, avec ses scores."""

    model_config = ConfigDict(frozen=True)

    artist: str
    title: str
    scores: TrackScores


class ArbitrationRequired(Event):
    """Morceau en attente d'une decision humaine. La Feature 3 etendra la charge."""

    event: Literal["arbitration_required"]
    track_id: str
    source: Source
    beatport_unavailable: bool
    candidates: tuple[CandidatePayload, ...]


class RunFinished(Event):
    """Fin d'une phase du run. Les rapports arriveront avec la Feature 6."""

    event: Literal["run_finished"]
    phase: RunPhase
    run_id: str
    resolved: int
    unresolved: int
    awaiting_arbitration: int


class Error(Event):
    """Reserve a ce qui ne se rattache a aucun morceau. Le `message` est technique,
    destine aux logs ; l'interface traduit le `code`.

    `command` nomme celle qui a echoue, `None` quand la ligne recue etait trop
    malformee pour la designer. Le run de re-tagging tournant en tache de fond
    pendant que la boucle lit la suite, l'interface ne peut pas la deduire de la
    derniere commande envoyee : c'est au sidecar de la dire.
    """

    event: Literal["error"] = "error"
    code: str
    params: dict[str, object]
    message: str
    command: str | None = None


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

    # `command` reste nul : la ligne n'a pas valide, rien ne garantit qu'elle
    # designe une commande du contrat. Son nom eventuel est dans `params`.
    return Error(
        code=MALFORMED_COMMAND,
        params=params,
        message="command rejected by validation",
    )


def error_from_business(exc: TaggerError, command: str) -> Error:
    """Convertit une erreur metier en evenement, en gardant son code et ses params."""
    return Error(code=exc.code, params=dict(exc.params), message=str(exc), command=command)


def emit(event: Event) -> str:
    """Rend la ligne NDJSON d'un evenement.

    `model_dump_json()` produit une seule ligne, ce qu'exige le protocole : ne
    jamais y ajouter d'`indent`.
    """
    return event.model_dump_json()
