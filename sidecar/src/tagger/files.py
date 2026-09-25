"""Lecture et ecriture des tags par mutagen, sur les quatre formats retenus.

Seul module du sidecar qui ouvre un fichier audio. L'ecriture arrivera avec la
confirmation globale du run (Feature 5).
"""

# TODO: implement, ecriture en ID3v2.3, regles de non-ecrasement sur null, dump des
# tags d'origine avant reecriture (Feature 5).

from dataclasses import dataclass
from enum import UNIQUE, StrEnum, auto, verify
from typing import TYPE_CHECKING, ClassVar, Final, NamedTuple

import mutagen
from mutagen import MutagenError
from mutagen.flac import VCFLACDict
from mutagen.id3 import ID3

from tagger.errors import TaggerError

if TYPE_CHECKING:
    from collections.abc import Iterable
    from pathlib import Path

AUDIO_EXTENSIONS: Final = frozenset({".mp3", ".wav", ".aif", ".aiff", ".flac"})


class TagKeys(NamedTuple):
    """Cles d'un meme champ dans les deux systemes de tags."""

    id3: str
    vorbis: str


# Champ vers ses cles, cf. ADR-011 § Correspondance des champs. La Feature 5 etend
# cette table ici et nulle part ailleurs.
IDENTITY_FIELDS: Final = {
    "artist": TagKeys(id3="TPE1", vorbis="ARTIST"),
    "title": TagKeys(id3="TIT2", vorbis="TITLE"),
}

# La virgule fait basculer le scoring d'un artiste multiple sur token_sort_ratio.
_MULTI_VALUE_SEPARATOR: Final = ", "


@verify(UNIQUE)
class UnreadableReason(StrEnum):
    """Motif d'une lecture en echec, repris dans le log du pipeline."""

    LOCKED = auto()
    UNREADABLE = auto()


@dataclass(frozen=True, slots=True)
class IdentityTags:
    """Artiste et titre lus dans un fichier, chaine vide quand le tag est absent."""

    artist: str
    title: str


class FilesError(TaggerError):
    """Erreur de lecture du dossier ou d'un fichier audio."""

    code: ClassVar[str] = "files_error"


class TaggingFolderUnreadableError(FilesError):
    """Le dossier a re-tagger n'existe pas ou n'est pas un dossier."""

    code: ClassVar[str] = "tagging_folder_unreadable"

    def __init__(self, path: Path) -> None:
        super().__init__(f"unreadable tagging folder: {path.name}", folder=path.name)


class TagsUnreadableError(FilesError):
    """Les tags d'un fichier n'ont pas pu etre lus.

    Levee et jamais loguee ici : le pipeline connait le run et le morceau.
    """

    code: ClassVar[str] = "tags_unreadable"

    def __init__(self, path: Path, reason: UnreadableReason) -> None:
        super().__init__(f"unreadable tags: {path.name}", file=path.name, reason=reason)
        self.reason = reason


def list_audio_files(folder: Path) -> tuple[Path, ...]:
    """Fichiers audio du dossier, sous-dossiers compris, dans un ordre stable.

    Le tri porte sur les segments du chemin relatif, casse ignoree : trier la chaine
    entiere ferait dependre l'ordre du separateur, l'antislash passant apres les
    chiffres quand la barre oblique passe avant. Meme parcours que le dossier source
    de l'extraction, ou un sous-dossier illisible est saute par `rglob` sans erreur.
    """
    if not folder.is_dir():
        raise TaggingFolderUnreadableError(folder)

    found = [
        path
        for path in folder.rglob("*")
        if path.suffix.lower() in AUDIO_EXTENSIONS and path.is_file()
    ]
    # `rglob` avale l'OSError de son scandir : sans ce second controle, un support
    # debranche en cours de parcours rendrait une liste tronquee sans erreur.
    if not folder.is_dir():
        raise TaggingFolderUnreadableError(folder)

    return tuple(sorted(found, key=lambda path: _sort_key(path.relative_to(folder))))


def _sort_key(relative: Path) -> tuple[str, ...]:
    return tuple(part.casefold() for part in relative.parts)


def read_identity(path: Path) -> IdentityTags:
    """Artiste et titre du fichier, sans jamais l'ecrire.

    La colonne se choisit sur le conteneur retenu par mutagen, pas sur l'extension.
    Un signal de contenu net l'emporte (l'en-tete RIFF/WAVE), mais a score egal
    `mutagen.File()` departage par nom de classe : un FLAC renomme `.mp3` part chez
    le parser MP3 et ressort en `unreadable`.
    """
    try:
        audio = mutagen.File(path)
    except (MutagenError, OSError) as exc:
        # Un fichier tenu par un lecteur audio remonte en PermissionError sous
        # l'erreur de mutagen : seul __cause__ le distingue d'une corruption.
        cause = exc.__cause__ or exc
        reason = (
            UnreadableReason.LOCKED
            if isinstance(cause, PermissionError)
            else UnreadableReason.UNREADABLE
        )
        raise TagsUnreadableError(path, reason) from exc

    if audio is None:
        raise TagsUnreadableError(path, UnreadableReason.UNREADABLE)

    match audio.tags:
        case ID3() as tags:
            values = {field: _id3_text(tags, keys.id3) for field, keys in IDENTITY_FIELDS.items()}
        case VCFLACDict() as tags:
            values = {
                field: _vorbis_text(tags, keys.vorbis) for field, keys in IDENTITY_FIELDS.items()
            }
        case None:
            values = dict.fromkeys(IDENTITY_FIELDS, "")
        case _:
            # Conteneur reconnu hors des quatre formats, un WavPack sous `.wav` par
            # exemple : ses tags existent, nous ne savons pas les lire. Le confondre
            # avec un fichier non tague effacerait ce que le pipeline doit loguer.
            raise TagsUnreadableError(path, UnreadableReason.UNREADABLE)

    return IdentityTags(artist=values["artist"], title=values["title"])


def _id3_text(tags: ID3, frame_id: str) -> str:
    return _join(tags[frame_id].text) if frame_id in tags else ""


def _vorbis_text(tags: VCFLACDict, key: str) -> str:
    return _join(tags[key]) if key in tags else ""


def _join(values: Iterable[object]) -> str:
    cleaned = (str(value).strip() for value in values)
    return _MULTI_VALUE_SEPARATOR.join(value for value in cleaned if value)
