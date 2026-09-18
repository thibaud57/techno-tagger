"""Resolution des morceaux d'une playlist et extraction vers le dossier destination.

Le chemin stocke dans la playlist est ignore : la base vient du telephone quand les
fichiers sont sur le PC, seul le nom est cherche recursivement dans le dossier
source (ADR-019, ADR-020). Rien n'interrompt le run : introuvables, homonymes
departages et copies en echec sont consignes, jamais leves.
"""

import errno
import logging
from collections import defaultdict
from dataclasses import dataclass
from enum import UNIQUE, StrEnum, auto, verify
from typing import TYPE_CHECKING, ClassVar, Final, NamedTuple

from tagger.errors import TaggerError

if TYPE_CHECKING:
    from collections.abc import Callable, Sequence
    from pathlib import Path

logger = logging.getLogger(__name__)

# Codes d'erreur Windows, absents des autres plateformes.
WINDOWS_LOCK_ERRORS: Final = frozenset({32, 33})  # SHARING_VIOLATION, LOCK_VIOLATION
WINDOWS_PATH_TOO_LONG: Final = 206  # FILENAME_EXCED_RANGE


@verify(UNIQUE)
class ExtractionMode(StrEnum):
    """En `MOVE`, le morceau quitte la bibliotheque source."""

    COPY = auto()
    MOVE = auto()


@verify(UNIQUE)
class DuplicateCriterion(StrEnum):
    """Critere qui a departage deux homonymes, consigne dans le rapport."""

    LARGEST_FILE = auto()
    PATH_ORDER = auto()


@verify(UNIQUE)
class ExtractionFailureReason(StrEnum):
    """Motifs repris de la nomenclature d'ecriture d'ARCHITECTURE.md § Backend :
    une meme panne de systeme de fichiers porte le meme nom dans les deux rapports
    que produit un run.
    """

    PERMISSION_DENIED = auto()
    DISK_FULL = auto()
    PATH_TOO_LONG = auto()
    FILE_LOCKED = auto()
    FILE_MISSING = auto()
    WRITE_FAILED = auto()


@dataclass(frozen=True, slots=True)
class DiscardedCandidate:
    """Homonyme ecarte, avec de quoi le retrouver a la main depuis le rapport."""

    path: Path
    size: int


@dataclass(frozen=True, slots=True)
class DuplicateResolution:
    """Trace d'un choix automatique entre homonymes.

    Ce que la CLI d'origine faisait silencieusement, et qui est la vraie regression
    corrigee ici : le choix reste automatique, mais il devient verifiable.
    """

    file_name: str
    kept_path: Path
    kept_size: int
    discarded: tuple[DiscardedCandidate, ...]
    criterion: DuplicateCriterion


class PickedFile(NamedTuple):
    """Retour de `pick_file`."""

    path: Path
    resolution: DuplicateResolution | None


@dataclass(frozen=True, slots=True)
class ExtractionFailure:
    """Morceau trouve mais non transfere."""

    file_name: str
    reason: ExtractionFailureReason


@dataclass(frozen=True, slots=True)
class ExtractionResult:
    """Issue d'une extraction, en quatre categories exclusives plus les doublons.

    `extracted`, `already_present`, `missing` et `failures` partitionnent les
    morceaux demandes. `duplicates` est une annotation qui co-occurre avec eux :
    un morceau departage figure aussi dans `extracted`, `already_present` ou
    `failures`. `already_present` est distinct de `extracted` : relancer un run
    interrompu ne doit pas faire croire qu'il a recopie ce qui etait deja la.
    """

    extracted: tuple[str, ...]
    already_present: tuple[str, ...]
    missing: tuple[str, ...]
    duplicates: tuple[DuplicateResolution, ...]
    failures: tuple[ExtractionFailure, ...]


class ExtractionError(TaggerError):
    """Erreur portant sur le run entier, par opposition a un incident par morceau."""

    code: ClassVar[str] = "extraction_error"


class SourceFolderUnreadableError(ExtractionError):
    """Le dossier source n'existe pas ou n'est pas un dossier."""

    code: ClassVar[str] = "source_folder_unreadable"

    def __init__(self, path: Path) -> None:
        super().__init__(f"unreadable source folder: {path.name}", folder=path.name)


class DestinationFolderUnwritableError(ExtractionError):
    """Le dossier destination ne peut pas etre cree (chemin occupe, droits, lecteur absent)."""

    code: ClassVar[str] = "destination_folder_unwritable"

    def __init__(self, path: Path) -> None:
        super().__init__(f"unwritable destination folder: {path.name}", folder=path.name)


def pick_file(file_name: str, candidates: Sequence[Path]) -> PickedFile:
    """Retient un chemin parmi des homonymes et rend la trace du choix.

    Departage dans l'ordre : taille decroissante, puis ordre alphabetique
    du chemin a taille egale. Ce second critere n'est pas cosmetique : sans lui, deux
    runs sur le meme dossier pourraient retenir deux fichiers differents.

    Rend `None` en `resolution` quand il n'y avait qu'un candidat : il n'y a alors
    rien a consigner dans le rapport, et rien a mesurer non plus.
    """
    if len(candidates) == 1:
        return PickedFile(candidates[0], None)

    sized = sorted(
        ((path, path.stat().st_size) for path in candidates),
        key=lambda entry: (-entry[1], str(entry[0])),
    )
    kept_path, kept_size = sized[0]
    criterion = (
        DuplicateCriterion.PATH_ORDER
        if sized[1][1] == kept_size
        else DuplicateCriterion.LARGEST_FILE
    )
    logger.info("duplicate resolved track=%s reason=%s", file_name, criterion)

    return PickedFile(
        kept_path,
        DuplicateResolution(
            file_name=file_name,
            kept_path=kept_path,
            kept_size=kept_size,
            discarded=tuple(DiscardedCandidate(path=path, size=size) for path, size in sized[1:]),
            criterion=criterion,
        ),
    )


def build_source_index(
    source: Path, *, excluded: Path | None = None
) -> dict[str, tuple[Path, ...]]:
    """Indexe le dossier source en une passe : nom de fichier vers ses chemins.

    Une recherche par nom relirait l'arborescence autant de fois qu'il y a de
    morceaux, et devrait de toute facon la parcourir entierement pour reperer les
    homonymes a departager.

    Les cles sont en minuscules : la cible est Windows, dont le systeme de fichiers
    est insensible a la casse. `excluded` ecarte un sous-dossier de `source`, compare
    lexicalement : aucun appel systeme de plus par fichier.
    """
    if not source.is_dir():
        raise SourceFolderUnreadableError(source)

    grouped: defaultdict[str, list[Path]] = defaultdict(list)
    for path in source.rglob("*"):
        if excluded is not None and path.is_relative_to(excluded):
            continue
        if path.is_file():
            grouped[path.name.lower()].append(path)

    logger.info("source indexed with %d names source=%s", len(grouped), source.name)

    return {name: tuple(paths) for name, paths in grouped.items()}


def failure_reason(error: OSError) -> ExtractionFailureReason:
    """Traduit une erreur systeme en motif du vocabulaire du projet.

    Le code Windows se lit avant le type de l'exception : un fichier tenu par un
    lecteur audio leve `PermissionError` comme un vrai refus de droits, et seul
    `winerror` les distingue.
    """
    windows_code = getattr(error, "winerror", None)
    if windows_code in WINDOWS_LOCK_ERRORS:
        return ExtractionFailureReason.FILE_LOCKED
    if windows_code == WINDOWS_PATH_TOO_LONG or error.errno == errno.ENAMETOOLONG:
        return ExtractionFailureReason.PATH_TOO_LONG
    if isinstance(error, FileNotFoundError):
        return ExtractionFailureReason.FILE_MISSING
    if isinstance(error, PermissionError):
        return ExtractionFailureReason.PERMISSION_DENIED
    if error.errno == errno.ENOSPC:
        return ExtractionFailureReason.DISK_FULL

    return ExtractionFailureReason.WRITE_FAILED


class PreparedRun(NamedTuple):
    """Retour de `_prepare_run`."""

    source_index: dict[str, tuple[Path, ...]]
    extracts_in_place: bool


def _prepare_run(file_names: Sequence[str], source: Path, destination: Path) -> PreparedRun:
    """Indexe la source puis cree la destination, dans cet ordre.

    L'ordre est la garantie : un dossier source illisible leve avant qu'aucun dossier
    n'ait ete cree, donc un run impossible ne laisse rien derriere lui.
    """
    resolved_source, resolved_destination = source.resolve(), destination.resolve()

    # Extraire dans le dossier source lui-meme n'extrait rien : en mode deplacement
    # cela relocaliserait la bibliotheque a sa propre racine. Chaque morceau trouve
    # y est deja, aucun transfert n'a lieu.
    extracts_in_place = resolved_source == resolved_destination

    # Une destination posee dans la source ne doit pas entrer dans l'index : au second
    # run, chaque morceau deja extrait deviendrait l'homonyme de son original.
    nested = not extracts_in_place and resolved_destination.is_relative_to(resolved_source)
    excluded = source / resolved_destination.relative_to(resolved_source) if nested else None
    index = build_source_index(source, excluded=excluded)

    if file_names and not extracts_in_place:
        # Non emballee, l'`OSError` sortirait de la boucle NDJSON et tuerait le sidecar.
        try:
            destination.mkdir(parents=True, exist_ok=True)
        except OSError as error:
            raise DestinationFolderUnwritableError(destination) from error

    return PreparedRun(source_index=index, extracts_in_place=extracts_in_place)


def extract(
    file_names: Sequence[str],
    source: Path,
    destination: Path,
    mode: ExtractionMode = ExtractionMode.COPY,
    on_progress: Callable[[int, int], None] | None = None,
) -> ExtractionResult:
    """Extrait les morceaux nommes du dossier source vers le dossier destination.

    Copie par defaut : la bibliotheque source doit rester intacte pendant que le
    re-tagging reecrit les fichiers de destination. Seuls un dossier source illisible
    et un dossier destination impossible a creer levent, et avant tout transfert.
    """
    index, extracts_in_place = _prepare_run(file_names, source, destination)

    extracted: list[str] = []
    already_present: list[str] = []
    missing: list[str] = []
    duplicates: list[DuplicateResolution] = []
    failures: list[ExtractionFailure] = []
    # Un nom demande deux fois par la playlist ne porte qu'une seule ambiguite sur le
    # disque : le rapport ne la consigne qu'une fois.
    resolved_names: set[str] = set()
    # Noms deja transferes par ce run. En mode deplacement, l'original a quitte la
    # source : redepartager ses homonymes ferait echouer le `stat()` du candidat
    # deplace, et le morceau sortirait a la fois extrait et en echec.
    transferred: set[str] = set()

    total = len(file_names)
    for processed, file_name in enumerate(file_names, start=1):
        key = file_name.lower()
        candidates = index.get(key)
        if not candidates:
            logger.info("track missing track=%s status=missing", file_name)
            missing.append(file_name)
        elif key in transferred:
            already_present.append(file_name)
        else:
            # L'index est un instantane : un homonyme disparu depuis fait echouer le
            # `stat()` du departage comme le transfert, et se consigne de la meme facon.
            try:
                kept_path, resolution = pick_file(file_name, candidates)
                if resolution is not None and key not in resolved_names:
                    resolved_names.add(key)
                    duplicates.append(resolution)

                target = destination / kept_path.name
                if extracts_in_place or target.exists():
                    already_present.append(file_name)
                else:
                    # `Path.copy` et `Path.move` existent depuis 3.14 : pas de `shutil`.
                    if mode is ExtractionMode.MOVE:
                        kept_path.move(target)
                    else:
                        kept_path.copy(target)
                    extracted.append(file_name)
                    transferred.add(key)
            except OSError as error:
                reason = failure_reason(error)
                logger.warning("transfer failed track=%s reason=%s", file_name, reason)
                failures.append(ExtractionFailure(file_name=file_name, reason=reason))

        if on_progress is not None:
            on_progress(processed, total)

    return ExtractionResult(
        extracted=tuple(extracted),
        already_present=tuple(already_present),
        missing=tuple(missing),
        duplicates=tuple(duplicates),
        failures=tuple(failures),
    )
