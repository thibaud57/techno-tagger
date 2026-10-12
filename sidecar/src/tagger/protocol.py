"""Modeles Pydantic des commandes et des evenements du protocole NDJSON.

Seule interface publique du sidecar : tout le reste est appele depuis la boucle
de `__main__.py`. Les types TypeScript de `src/app/core/models/` sont maintenus
a la main en miroir de ce fichier.

Les commandes entrantes sont fermees (`extra="forbid"`) et strictes : un champ
inconnu ou mal type est une commande malformee, pas un detail a ignorer
(cf. ADR-022).
"""

from datetime import datetime
from enum import UNIQUE, StrEnum, auto, verify
from pathlib import Path
from typing import TYPE_CHECKING, Annotated, Final, Literal, Self, get_args

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    TypeAdapter,
    ValidationError,
    model_validator,
)

from tagger.extraction import DuplicateCriterion, ExtractionMode
from tagger.file_failures import FileFailureReason
from tagger.files import TagField, TagSystem
from tagger.matching import MatchingThresholds, check_thresholds
from tagger.playlists import PlaylistFormat
from tagger.scraper_client import SearchSource, Source
from tagger.tagging import FailureReason, Resolution, TrackFailureReason, TrackState

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


class CancelRun(Command):
    """Un dossier lance par erreur cesse de consommer le quota de l'API."""

    command: Literal["cancel_run"]


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


class ResolveArbitration(Command):
    """Choix d'un candidat de `source`, ou refus si `candidate` est nul ; rejete si `source`
    n'est plus la liste affichee (double clic apres bascule)."""

    command: Literal["resolve_arbitration"]
    track_id: str
    source: SearchSource
    candidate: Annotated[int, Field(ge=0)] | None


class SwitchArbitrationSource(Command):
    """Reaffiche la liste deja obtenue de `source`, sans appel reseau."""

    command: Literal["switch_arbitration_source"]
    track_id: str
    source: SearchSource


class ResolveByUrl(Command):
    """URL collee sur un morceau en fin de run ; sa forme est jugee par le client."""

    command: Literal["resolve_by_url"]
    track_id: str
    url: Annotated[str, Field(min_length=1)]


class CommitRun(Command):
    """Confirmation globale : le point de non-retour, seul geste qui ecrit des fichiers."""

    command: Literal["commit_run"]
    run_id: str


class RetryWrite(Command):
    """Rejoue l'ecriture des seuls morceaux en echec, sans reseau ni arbitrage."""

    command: Literal["retry_write"]
    run_id: str


class GetRollbackTarget(Command):
    """Dernier run annulable, pour que la confirmation des Reglages le nomme."""

    command: Literal["get_rollback_target"]


class Rollback(Command):
    """Restaure un run entier depuis son dump, ou son seul morceau `track_id`."""

    command: Literal["rollback"]
    run_id: str
    track_id: str | None = None


class GetInterruptedRun(Command):
    """Au lancement : un run interrompu attend-il ? Meme patron que `get_rollback_target`."""

    command: Literal["get_interrupted_run"]


class DiscardRun(Command):
    """Repartir de zero : le plan part, l'annonce suivante dit s'il en reste un autre."""

    command: Literal["discard_run"]
    run_id: str


class ResumeRun(Command):
    """Reprend le run interrompu annonce : decisions rendues, seuls les restants partent."""

    command: Literal["resume_run"]
    run_id: str


class ListRuns(Command):
    """Runs passes relisibles depuis leurs rapports."""

    command: Literal["list_runs"]


class LoadRun(Command):
    """Rouvre le recapitulatif d'un run passe depuis son rapport, sans rien rejouer."""

    command: Literal["load_run"]
    run_id: str


type AnyCommand = Annotated[
    GetVersion
    | Shutdown
    | CancelRun
    | ListPlaylists
    | ExtractPlaylist
    | SetApiKey
    | StartTagging
    | ResolveArbitration
    | SwitchArbitrationSource
    | ResolveByUrl
    | CommitRun
    | RetryWrite
    | GetRollbackTarget
    | Rollback
    | GetInterruptedRun
    | DiscardRun
    | ResumeRun
    | ListRuns
    | LoadRun,
    Field(discriminator="command"),
]

# `shutdown` sort de la boucle sans rien executer : l'exclure ici permet au `match`
# du dispatch de se fermer par `assert_never` sans laisser de cas non couvert.
type ExecutableCommand = (
    GetVersion
    | CancelRun
    | ListPlaylists
    | ExtractPlaylist
    | SetApiKey
    | StartTagging
    | ResolveArbitration
    | SwitchArbitrationSource
    | ResolveByUrl
    | CommitRun
    | RetryWrite
    | GetRollbackTarget
    | Rollback
    | GetInterruptedRun
    | DiscardRun
    | ResumeRun
    | ListRuns
    | LoadRun
)

# Recopie de `command` : un `Literal` ne se compose pas d'une union ; un test dedie la garde.
type CommandName = Literal[
    "get_version",
    "shutdown",
    "cancel_run",
    "list_playlists",
    "extract_playlist",
    "set_api_key",
    "start_tagging",
    "resolve_arbitration",
    "switch_arbitration_source",
    "resolve_by_url",
    "commit_run",
    "retry_write",
    "get_rollback_target",
    "rollback",
    "get_interrupted_run",
    "discard_run",
    "resume_run",
    "list_runs",
    "load_run",
]

_COMMAND_ADAPTER: Final = TypeAdapter[AnyCommand](AnyCommand)
_COMMAND_NAMES: Final[dict[str, CommandName]] = {
    name: name for name in get_args(CommandName.__value__)
}


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
    reason: FileFailureReason


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


class TagValuePayload(BaseModel):
    """Une ligne du detail, `value` nulle si le champ est absent."""

    model_config = ConfigDict(frozen=True)

    field: TagField
    key: str
    value: str | None


class TagsBeforePayload(BaseModel):
    """Tags d'origine lus a l'ouverture, dans l'ordre de la table."""

    model_config = ConfigDict(frozen=True)

    system: TagSystem
    comment: str | None
    fields: tuple[TagValuePayload, ...]


class TrackEntry(BaseModel):
    """Un morceau du run tel que la liste l'affiche avant toute resolution."""

    model_config = ConfigDict(frozen=True)

    track_id: str
    file_name: str
    artist: str
    title: str
    tags_before: TagsBeforePayload | None


class RunStarted(Event):
    """Toutes les lignes de la liste, des le depart : sans lui, l'ecran reste vide
    jusqu'a la premiere resolution.
    """

    event: Literal["run_started"]
    run_id: str
    folder: Path
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
    failure_reason: TrackFailureReason | None = None
    source: Source | None = None
    after: TrackNames | None = None
    scores: TrackScores | None = None
    artwork_path: Path | None = None
    # Nul pour un non resolu.
    tags_after: tuple[TagValuePayload, ...] | None = None
    # Vrai quand le dump du run porte l'origine du morceau : un rollback peut le rendre.
    restorable: bool = False
    # Lien vers la fiche source, donnee de navigation : jamais lu dans les lignes du detail.
    source_url: str | None = None


class CandidatePayload(BaseModel):
    """Un candidat en zone grise, son index de geste est sa position dans la liste ;
    `label`/`year` sont nuls sur Bandcamp et parfois sur Beatport."""

    model_config = ConfigDict(frozen=True)

    artist: str
    title: str
    label: str | None
    year: int | None
    scores: TrackScores


class ArbitrationState(Event):
    """Etat complet d'un arbitrage (remplace en bloc) ; `other_source` est reaffichable,
    `empty_reason` dit pourquoi la liste Bandcamp est vide."""

    track_id: str
    source: Source
    beatport_unavailable: bool
    candidates: tuple[CandidatePayload, ...]
    empty_reason: FailureReason | None
    other_source: Source | None


class ArbitrationRequired(ArbitrationState):
    event: Literal["arbitration_required"] = "arbitration_required"


class ArbitrationUpdated(ArbitrationState):
    """Liste affichee remplacee : bascule sur Bandcamp ou retour a Beatport."""

    event: Literal["arbitration_updated"] = "arbitration_updated"


class RunFinished(Event):
    """Fin d'une phase du run ; les compteurs se relisent sur l'etat de chaque morceau."""

    event: Literal["run_finished"]
    phase: RunPhase
    run_id: str
    resolved: int
    unresolved: int
    written: int
    write_error: int
    awaiting_arbitration: int
    # Le JSON du rapport en phase `write`, comme `extraction_finished.report_path` ; nul sinon.
    report_path: Path | None = None


class RollbackRun(BaseModel):
    """Dernier run annulable : de quoi le nommer dans la confirmation."""

    model_config = ConfigDict(frozen=True)

    run_id: str
    written_at: datetime
    folder: Path
    tracks: int


class RollbackTarget(Event):
    """`run` nul : rien a annuler, l'interface grise le bouton des Reglages."""

    event: Literal["rollback_target"]
    run: RollbackRun | None


class RollbackFailurePayload(BaseModel):
    model_config = ConfigDict(frozen=True)

    track_id: str
    file_name: str
    reason: TrackFailureReason


class RollbackFinished(Event):
    """Bilan d'un rollback ; un morceau en echec reste dans le dump, le suivant le retente."""

    event: Literal["rollback_finished"]
    run_id: str
    track_id: str | None
    restored: tuple[str, ...]
    failed: tuple[RollbackFailurePayload, ...]


class InterruptedRunPayload(BaseModel):
    """Run a proposer a la reprise ; `folder_missing` ne laisse que l'option de repartir de zero."""

    model_config = ConfigDict(frozen=True)

    kind: Literal["interrupted"] = "interrupted"
    run_id: str
    started_at: datetime
    folder: Path
    processed: int
    total: int
    folder_missing: bool


class UnreadablePlanPayload(BaseModel):
    """Plan d'une autre version ou illisible : les deux versions font le message (ADR-018).

    `found` est nul quand le plan n'a pas de version lisible (JSON corrompu) : l'interface dit
    alors « illisible » et non « version null ».
    """

    model_config = ConfigDict(frozen=True)

    kind: Literal["unreadable"] = "unreadable"
    run_id: str
    started_at: datetime
    found: int | str | None
    expected: int


class InterruptedRunEvent(Event):
    """`run` nul : rien a reprendre."""

    event: Literal["interrupted_run"]
    run: (
        Annotated[InterruptedRunPayload | UnreadablePlanPayload, Field(discriminator="kind")] | None
    )


class PastRunPayload(BaseModel):
    model_config = ConfigDict(frozen=True)

    run_id: str
    written_at: datetime
    folder: Path
    report_path: Path


class RunsListed(Event):
    event: Literal["runs_listed"]
    runs: tuple[PastRunPayload, ...]


class TrackLoaded(BaseModel):
    """Morceau d'un run passe, relu dans son rapport : ce que le recapitulatif affiche.

    Sans `restorable` : un run passe se lit sans geste, la restauration reste aux Reglages.
    """

    model_config = ConfigDict(frozen=True)

    track_id: str
    file_name: str
    file_after: str | None
    artist: str
    title: str
    state: TrackState | None
    resolution: Resolution | None
    failure_reason: TrackFailureReason | None
    source: Source | None
    after: TrackNames | None
    scores: TrackScores | None
    # Meme forme que dans `run_started` : l'interface hydrate un run passe comme un run vivant.
    tags_before: TagsBeforePayload | None
    tags_after: tuple[TagValuePayload, ...] | None
    source_url: str | None
    artwork_path: Path | None


class RunLoaded(Event):
    event: Literal["run_loaded"]
    run_id: str
    folder: Path
    generated_at: datetime
    tracks: tuple[TrackLoaded, ...]


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
    command: CommandName | None = None


MALFORMED_COMMAND: Final = "malformed_command"
API_KEY_MALFORMED: Final = "api_key_malformed"
# Les champs du contrat saisis a la main : leur refus dit quoi corriger, quand une autre
# commande mal formee ne peut venir que d'un defaut de l'application. Une table plutot
# qu'une branche, pour que le prochain champ tape par l'utilisateur soit une ligne ici.
# Cle typee comme `loc`, qui porte un index numerique des qu'une erreur vise un element
# de liste : la restreindre a deux chaines obligerait a un `cast()`.
_TYPED_BY_HAND: Final[dict[tuple[int | str, ...], str]] = {
    ("set_api_key", "api_key"): API_KEY_MALFORMED
}

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
    command: CommandName | None = None
    code = MALFORMED_COMMAND
    for error in exc.errors():
        loc = error["loc"]
        details.append({"loc": list(loc), "type": error["type"]})
        code = _TYPED_BY_HAND.get(loc[:2], code)
        # `loc` vide : le discriminant de la ligne elle-meme, pas celui d'une union
        # imbriquee qu'un futur modele pourrait declarer.
        if error["type"] == UNKNOWN_COMMAND_ERROR and not loc:
            params["command"] = error.get("ctx", {}).get("tag")
        # Un champ refuse sur une commande connue : Pydantic ouvre `loc` par son
        # discriminant. La nommer rend l'erreur a l'ecran qui l'a envoyee, sans quoi
        # aucun ne l'affiche (une cle API collee avec un espace se perdait ainsi).
        elif loc and isinstance(loc[0], str):
            command = _COMMAND_NAMES.get(loc[0], command)

    return Error(
        code=code,
        params=params,
        message="command rejected by validation",
        command=command,
    )


def error_from_business(
    exc: TaggerError, command: CommandName, track_id: str | None = None
) -> Error:
    """Convertit une erreur metier en evenement, en gardant son code et ses params.

    `track_id` : le morceau d'un geste, que les erreurs du client ne portent pas et sans
    lequel l'interface ne saurait sur quelle ligne afficher l'erreur.
    """
    params = dict(exc.params)
    if track_id is not None:
        params["track_id"] = track_id
    return Error(code=exc.code, params=params, message=str(exc), command=command)


def emit(event: Event) -> str:
    """Rend la ligne NDJSON d'un evenement.

    `model_dump_json()` produit une seule ligne, ce qu'exige le protocole : ne
    jamais y ajouter d'`indent`.
    """
    return event.model_dump_json()
