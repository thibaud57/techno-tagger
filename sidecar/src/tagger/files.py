"""Lecture et ecriture des tags par mutagen, sur les quatre formats retenus.

Seul module du sidecar qui ouvre un fichier audio ; l'ecriture suit la confirmation (ADR-010).
"""

# TODO: implement, dump des tags d'origine avant reecriture (Feature 5).

import os
from dataclasses import dataclass
from enum import UNIQUE, StrEnum, auto, verify
from types import MappingProxyType
from typing import TYPE_CHECKING, ClassVar, Final, NamedTuple, Protocol
from urllib.parse import quote

import mutagen
from mutagen import MutagenError
from mutagen.flac import FLAC, Picture, VCFLACDict
from mutagen.id3 import APIC, ID3, TXXX, WOAS, Encoding, Frame, Frames, PictureType

from tagger.cache import ARTWORK_EXTENSIONS
from tagger.errors import TaggerError
from tagger.file_failures import FileFailureReason, file_failure_reason
from tagger.matching import credited_artists, full_title

if TYPE_CHECKING:
    from collections.abc import Iterable, Mapping, Sequence
    from pathlib import Path

    from tagger.scraper_client import TrackCandidate

AUDIO_EXTENSIONS: Final = frozenset({".mp3", ".wav", ".aif", ".aiff", ".flac"})


class TagKeys(NamedTuple):
    """Cles d'un meme champ dans les deux systemes de tags."""

    id3: str
    vorbis: str


@verify(UNIQUE)
class TagField(StrEnum):
    """Champ ecrit, cf. ADR-011 § Correspondance des champs."""

    ARTIST = auto()
    REMIXER = auto()
    TITLE = auto()
    ALBUM = auto()
    DATE = auto()
    ORIGINAL_DATE = auto()
    GENRE = auto()
    LABEL = auto()
    CATALOG_NUMBER = auto()
    BPM = auto()
    KEY = auto()
    ISRC = auto()
    TRACK_NUMBER = auto()
    URL = auto()
    SOURCE_ID = auto()
    SOURCE = auto()


# TPE2 n'y entre pas : le contrat ne rend pas d'artiste de sortie. Les dates sont en frames
# v2.4, celles de mutagen en memoire : `update_to_v23()` les ecrit en TYER et TORY.
TAG_FIELDS: Final[dict[TagField, TagKeys]] = {
    TagField.ARTIST: TagKeys(id3="TPE1", vorbis="ARTIST"),
    TagField.REMIXER: TagKeys(id3="TPE4", vorbis="REMIXER"),
    TagField.TITLE: TagKeys(id3="TIT2", vorbis="TITLE"),
    TagField.ALBUM: TagKeys(id3="TALB", vorbis="ALBUM"),
    TagField.DATE: TagKeys(id3="TDRC", vorbis="DATE"),
    TagField.ORIGINAL_DATE: TagKeys(id3="TDOR", vorbis="ORIGINALDATE"),
    TagField.GENRE: TagKeys(id3="TCON", vorbis="GENRE"),
    TagField.LABEL: TagKeys(id3="TPUB", vorbis="LABEL"),
    TagField.CATALOG_NUMBER: TagKeys(id3="TXXX:CATALOGNUMBER", vorbis="CATALOGNUMBER"),
    TagField.BPM: TagKeys(id3="TBPM", vorbis="BPM"),
    TagField.KEY: TagKeys(id3="TKEY", vorbis="KEY"),
    TagField.ISRC: TagKeys(id3="TSRC", vorbis="ISRC"),
    TagField.TRACK_NUMBER: TagKeys(id3="TRCK", vorbis="TRACKNUMBER"),
    TagField.URL: TagKeys(id3="WOAS", vorbis="URL"),
    TagField.SOURCE_ID: TagKeys(id3="TXXX:SOURCE_ID", vorbis="SOURCE_ID"),
    TagField.SOURCE: TagKeys(id3="TXXX:SOURCE", vorbis="SOURCE"),
}

IDENTITY_FIELDS: Final = {field: TAG_FIELDS[field] for field in (TagField.ARTIST, TagField.TITLE)}

# Valeurs a ecrire, un champ absent laissant le tag du fichier intact.
type TagValues = Mapping[TagField, str]

# La virgule fait basculer le scoring d'un artiste multiple sur token_sort_ratio.
_MULTI_VALUE_SEPARATOR: Final = ", "

# Tout l'ASCII reste tel quel, `%` compris : seuls les autres caracteres sont encodes.
_URL_SAFE: Final = "".join(map(chr, range(128)))

# Aucun commentaire ne survit a l'ecriture : ils portent surtout des traces de rip.
_ID3_COMMENT: Final = "COMM"
_VORBIS_COMMENTS: Final = ("COMMENT", "DESCRIPTION")

_ARTWORK_MIME: Final = {f".{extension}": mime for mime, extension in ARTWORK_EXTENSIONS.items()}


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


@dataclass(frozen=True, slots=True)
class WrittenTags:
    """Ce que l'ecriture a pose : le rapport compte les champs ecrits (ADR-011)."""

    fields: tuple[TagField, ...]
    artwork: bool


class _Artwork(NamedTuple):
    mime: str
    data: bytes


class _TypedPicture(Protocol):
    """Image ID3 (`APIC`) ou FLAC (`Picture`), toutes deux typees par `PictureType`."""

    type: int


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


class TagsWriteError(FilesError):
    """Tags non ecrits ; levee sans log, l'appelant connait le run et le morceau."""

    code: ClassVar[str] = "tags_write_failed"

    def __init__(self, path: Path, reason: FileFailureReason) -> None:
        super().__init__(f"tags not written: {path.name}", file=path.name, reason=reason)
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

    return IdentityTags(artist=values[TagField.ARTIST], title=values[TagField.TITLE])


def _id3_text(tags: ID3, frame_id: str) -> str:
    return _join(tags[frame_id].text) if frame_id in tags else ""


def _vorbis_text(tags: VCFLACDict, key: str) -> str:
    return _join(tags[key]) if key in tags else ""


def _join(values: Iterable[object]) -> str:
    cleaned = (str(value).strip() for value in values)
    return _MULTI_VALUE_SEPARATOR.join(value for value in cleaned if value)


def project_tags(candidate: TrackCandidate) -> TagValues:
    """Valeurs du candidat a ecrire, absentes et vides omises.

    Le remixeur n'entre jamais dans l'artiste ; la date se reduit a l'annee.
    """
    release = candidate.release
    year = release.release_date.year if release and release.release_date else None
    projected: dict[TagField, object] = {
        TagField.ARTIST: credited_artists(candidate),
        TagField.REMIXER: _join(credit.name for credit in candidate.remixers),
        TagField.TITLE: full_title(candidate),
        TagField.ALBUM: release.title if release else None,
        TagField.DATE: year,
        TagField.ORIGINAL_DATE: year,
        TagField.GENRE: candidate.genre,
        TagField.LABEL: candidate.label.name if candidate.label else None,
        TagField.CATALOG_NUMBER: release.catalog_number if release else None,
        # 0 vaut inconnu : ecrit, il ecraserait la valeur du fichier.
        TagField.BPM: candidate.bpm or None,
        TagField.KEY: candidate.key,
        TagField.ISRC: candidate.isrc,
        TagField.TRACK_NUMBER: candidate.track_number or None,
        # WOAS est de l'ASCII en ID3 : un caractere hors latin-1 ferait lever mutagen au save().
        TagField.URL: quote(candidate.url or "", safe=_URL_SAFE),
        TagField.SOURCE_ID: candidate.id,
        TagField.SOURCE: candidate.source,
    }
    return MappingProxyType(
        {
            field: text
            for field, value in projected.items()
            if value is not None and (text := str(value).strip())
        }
    )


def write_tags(path: Path, values: TagValues, artwork: Path | None) -> WrittenTags:
    """Ecrit les valeurs, une seule image et aucun commentaire, en place.

    Verrou, droits et fichier absent echouent avant toute ecriture sur le disque. Une
    pochette absente garde l'image du fichier : le cache est jetable (ADR-013).
    """
    picture = _read_artwork(artwork)
    try:
        audio = mutagen.File(path)
        if audio is None:
            raise TagsWriteError(path, FileFailureReason.WRITE_FAILED)
        if audio.tags is None:
            audio.add_tags()
        match audio, audio.tags:
            case FLAC() as flac, VCFLACDict() as comments:
                _write_vorbis(flac, comments, values, picture)
                flac.save()
            case _, ID3() as tags:
                _write_id3(tags, values, picture)
                # `save(v2_version=3)` seul laisse TDRC et TDOR sur le disque (mutagen 1.48.1).
                tags.update_to_v23()
                audio.save(v2_version=3)
            case _:
                # Conteneur hors des quatre formats : refuse avant toute ecriture.
                raise TagsWriteError(path, FileFailureReason.WRITE_FAILED)
    except (MutagenError, OSError) as exc:
        raise _write_failure(path, exc) from exc

    return WrittenTags(fields=tuple(values), artwork=picture is not None)


def _write_failure(path: Path, error: MutagenError | OSError) -> TagsWriteError:
    cause = error.__cause__ or error
    reason = (
        file_failure_reason(cause) if isinstance(cause, OSError) else FileFailureReason.WRITE_FAILED
    )
    # Le CRT ne remonte pas le code Windows d'un verrou : `PermissionError` sans `winerror`.
    # Un fichier en lecture seule, seule autre cause, n'est pas inscriptible. Limite : sous Windows
    # `os.access(W_OK)` ne lit que l'attribut lecture seule, un refus d'ACL ou l'acces aux dossiers
    # controles passe donc aussi en `file_locked`.
    if (
        reason is FileFailureReason.PERMISSION_DENIED
        and getattr(cause, "winerror", None) is None
        and os.access(path, os.W_OK)
    ):
        reason = FileFailureReason.FILE_LOCKED
    return TagsWriteError(path, reason)


def _write_id3(tags: ID3, values: TagValues, artwork: _Artwork | None) -> None:
    for field, value in values.items():
        frame_id = TAG_FIELDS[field].id3
        # Remplacement par cle exacte : un TXXX d'un autre logiciel reste en place.
        tags.setall(frame_id, [_id3_frame(frame_id, value)])
    tags.delall(_ID3_COMMENT)

    frames = tags.getall("APIC")
    kept = (
        _front_or_first(frames)
        if artwork is None
        else APIC(
            encoding=Encoding.UTF8,
            mime=artwork.mime,
            type=PictureType.COVER_FRONT,
            desc="Cover",
            data=artwork.data,
        )
    )
    tags.delall("APIC")
    if kept is not None:
        tags.add(kept)


def _id3_frame(frame_id: str, value: str) -> Frame:
    kind, _, description = frame_id.partition(":")
    if kind == "TXXX":
        return TXXX(encoding=Encoding.UTF8, desc=description, text=[value])
    if kind == "WOAS":
        return WOAS(url=value)
    return Frames[kind](encoding=Encoding.UTF8, text=[value])


def _write_vorbis(
    audio: FLAC, comments: VCFLACDict, values: TagValues, artwork: _Artwork | None
) -> None:
    for field, value in values.items():
        comments[TAG_FIELDS[field].vorbis] = [value]
    for key in _VORBIS_COMMENTS:
        if key in comments:
            del comments[key]

    pictures = audio.pictures
    kept = _front_or_first(pictures) if artwork is None else _flac_picture(artwork)
    audio.clear_pictures()
    if kept is not None:
        audio.add_picture(kept)


def _flac_picture(artwork: _Artwork) -> Picture:
    picture = Picture()
    picture.type = PictureType.COVER_FRONT
    picture.mime = artwork.mime
    picture.data = artwork.data
    return picture


def _front_or_first[P: _TypedPicture](pictures: Sequence[P]) -> P | None:
    """Recto du fichier, a defaut sa premiere image : une seule doit rester."""
    fronts = (picture for picture in pictures if picture.type == PictureType.COVER_FRONT)
    return next(fronts, pictures[0] if pictures else None)


def _read_artwork(artwork: Path | None) -> _Artwork | None:
    if artwork is None:
        return None
    mime = _ARTWORK_MIME.get(artwork.suffix.lower())
    if mime is None:
        return None
    try:
        return _Artwork(mime=mime, data=artwork.read_bytes())
    except OSError:
        return None
