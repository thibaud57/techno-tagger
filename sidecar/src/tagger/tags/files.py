"""Lecture et ecriture des tags par mutagen, sur les quatre formats retenus.

Seul module du sidecar qui ouvre un fichier audio ; l'ecriture suit la confirmation (ADR-010).
"""

import os
from dataclasses import dataclass
from enum import UNIQUE, StrEnum, auto, verify
from types import MappingProxyType
from typing import TYPE_CHECKING, ClassVar, Final, Literal, NamedTuple, Protocol
from urllib.parse import quote

import mutagen
from mutagen import MutagenError
from mutagen.aiff import AIFF
from mutagen.flac import FLAC, Picture, VCFLACDict
from mutagen.id3 import APIC, ID3, TXXX, WOAS, Encoding, Frame, Frames, PictureType
from mutagen.mp3 import MP3
from mutagen.wave import WAVE

from tagger.core.errors import TaggerError
from tagger.core.file_failures import FileFailureReason, file_failure_reason
from tagger.core.paths import encodable_only, extended_path, is_utf8_encodable
from tagger.resolution.cache import ARTWORK_EXTENSIONS
from tagger.resolution.matching import credited_artists, full_title

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable, Mapping, Sequence
    from pathlib import Path

    from tagger.resolution.scraper_client import TrackCandidate

AUDIO_EXTENSIONS: Final = frozenset({".mp3", ".wav", ".aif", ".aiff", ".flac"})

# Contenu hors des quatre formats : pas de cause systeme, donc le motif generique, le seul qui
# ne pretende rien sur le fichier.
_UNREADABLE: Final = FileFailureReason.WRITE_FAILED


class TagKeys(NamedTuple):
    id3: str
    vorbis: str
    # Rekordbox lit INITIALKEY, VirtualDJ KEY (knowledges/rekordbox.md).
    vorbis_mirrors: tuple[str, ...] = ()


@verify(UNIQUE)
class TagField(StrEnum):
    """Champ ecrit, cf. ADR-011 § Correspondance des champs."""

    ARTIST = auto()
    REMIXER = auto()
    TITLE = auto()
    ALBUM = auto()
    DATE = auto()
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


# TPE2 n'y entre pas : le contrat ne rend pas d'artiste de sortie. La date est en frame v2.4,
# celle de mutagen en memoire : `update_to_v23()` l'ecrit en TYER.
# L'ordre est celui du detail avant / apres : l'interface l'affiche sans le retrier.
TAG_FIELDS: Final[Mapping[TagField, TagKeys]] = {
    TagField.ARTIST: TagKeys(id3="TPE1", vorbis="ARTIST"),
    TagField.TITLE: TagKeys(id3="TIT2", vorbis="TITLE"),
    TagField.REMIXER: TagKeys(id3="TPE4", vorbis="REMIXER"),
    TagField.GENRE: TagKeys(id3="TCON", vorbis="GENRE"),
    TagField.BPM: TagKeys(id3="TBPM", vorbis="BPM"),
    TagField.KEY: TagKeys(id3="TKEY", vorbis="KEY", vorbis_mirrors=("INITIALKEY",)),
    TagField.LABEL: TagKeys(id3="TPUB", vorbis="LABEL"),
    TagField.CATALOG_NUMBER: TagKeys(id3="TXXX:CATALOGNUMBER", vorbis="CATALOGNUMBER"),
    TagField.ISRC: TagKeys(id3="TSRC", vorbis="ISRC"),
    TagField.ALBUM: TagKeys(id3="TALB", vorbis="ALBUM"),
    TagField.TRACK_NUMBER: TagKeys(id3="TRCK", vorbis="TRACKNUMBER"),
    TagField.DATE: TagKeys(id3="TDRC", vorbis="DATE"),
    TagField.SOURCE: TagKeys(id3="TXXX:SOURCE", vorbis="SOURCE"),
    TagField.URL: TagKeys(id3="WOAS", vorbis="URL"),
    TagField.SOURCE_ID: TagKeys(id3="TXXX:SOURCE_ID", vorbis="SOURCE_ID"),
}

_VORBIS_MIRRORS: Final = tuple(name for keys in TAG_FIELDS.values() for name in keys.vorbis_mirrors)

# Valeurs a ecrire, un champ absent laissant le tag du fichier intact.
type TagValues = Mapping[TagField, str]

# Versions ID3 qu'une ecriture vise : v2.3 (cible) ou v2.4 (restauration d'un fichier d'origine).
type Id3Target = Literal[3, 4]

# La virgule fait basculer le scoring d'un artiste multiple sur token_sort_ratio.
_MULTI_VALUE_SEPARATOR: Final = ", "

# Tout l'ASCII reste tel quel, `%` compris : seuls les autres caracteres sont encodes.
_URL_SAFE: Final = "".join(map(chr, range(128)))

# Aucun commentaire ne survit a l'ecriture : ils portent surtout des traces de rip.
_ID3_COMMENT: Final = "COMM"
_VORBIS_COMMENTS: Final = ("COMMENT", "DESCRIPTION")

_ARTWORK_MIME: Final[Mapping[str, str]] = {
    f".{extension}": mime for mime, extension in ARTWORK_EXTENSIONS.items()
}

_ID3_V23: Final = 3
# Seule version autre que la cible v2.3 qu'une restauration rend au fichier.
_ID3_V24: Final = 4
# L'ecriture passe en v2.3 : la date y porte cette cle, pas TDRC.
_ID3_V23_KEYS: Final[Mapping[TagField, str]] = {TagField.DATE: "TYER"}


@dataclass(frozen=True, slots=True, kw_only=True)
class IdentityTags:
    """Artiste et titre lus dans un fichier, chaine vide quand le tag est absent."""

    artist: str
    title: str


@verify(UNIQUE)
class TagSystem(StrEnum):
    """Systeme de tags : ID3 pour MP3, WAV et AIFF, Vorbis pour FLAC."""

    ID3 = auto()
    VORBIS = auto()


@dataclass(frozen=True, slots=True)
class OriginalTags:
    """Champs de la table tels que le fichier les porte, de quoi le restaurer.

    `id3_version` est la version lue (2 a 4), `None` sans tag ID3 et pour un FLAC ; seule
    une v2.4 est rendue telle quelle, toute autre repart en v2.3, que mutagen sait ecrire.
    `vorbis_mirrors` a `None` (hors FLAC, dump d'avant les miroirs) : la restauration les laisse.
    """

    system: TagSystem
    id3_version: int | None
    fields: Mapping[TagField, tuple[str, ...]]
    vorbis_mirrors: Mapping[str, tuple[str, ...]] | None = None


@dataclass(frozen=True, slots=True)
class ShownTags:
    """Champs affiches, `None` quand absents. Le dump relit le fichier lui-meme."""

    system: TagSystem
    fields: Mapping[TagField, str | None]
    comment: str | None

    @property
    def identity(self) -> IdentityTags:
        """Artiste et titre de la requete, la meme jointure que la colonne Avant."""
        return IdentityTags(
            artist=self.fields[TagField.ARTIST] or "", title=self.fields[TagField.TITLE] or ""
        )


@dataclass(frozen=True, slots=True)
class WrittenTags:
    """Ce que l'ecriture a pose : le rapport compte les champs ecrits."""

    fields: tuple[TagField, ...]
    artwork: bool


class _Artwork(NamedTuple):
    mime: str
    data: bytes


class _TypedPicture(Protocol):
    """Image ID3 (`APIC`) ou FLAC (`Picture`), toutes deux typees par `PictureType`."""

    type: int


class FilesError(TaggerError):
    code: ClassVar[str] = "files_error"


class TaggingFolderUnreadableError(FilesError):
    """Le dossier a re-tagger n'existe pas ou n'est pas un dossier."""

    code: ClassVar[str] = "tagging_folder_unreadable"

    def __init__(self, path: Path) -> None:
        super().__init__(f"unreadable tagging folder: {path.name}", folder=path.name)


class TagsUnreadableError(FilesError):
    """Tags illisibles ; levee sans log, le pipeline connait le run et le morceau."""

    code: ClassVar[str] = "tags_unreadable"

    def __init__(self, path: Path, reason: FileFailureReason) -> None:
        super().__init__(f"unreadable tags: {path.name}", file=path.name, reason=reason)
        self.reason = reason


class TagsWriteError(FilesError):
    """Tags non ecrits ; levee sans log, le pipeline connait le run et le morceau."""

    code: ClassVar[str] = "tags_write_failed"

    def __init__(self, path: Path, reason: FileFailureReason) -> None:
        super().__init__(f"tags not written: {path.name}", file=path.name, reason=reason)
        self.reason = reason


def list_audio_files(folder: Path) -> tuple[Path, ...]:
    """Fichiers audio du dossier, sous-dossiers compris, dans un ordre stable.

    Tri sur les segments du chemin relatif, casse ignoree : trier la chaine entiere ferait
    dependre l'ordre du separateur (l'antislash passe apres les chiffres, la barre oblique
    avant). `rglob` saute un sous-dossier illisible, comme pour la source de l'extraction. Un
    nom sans equivalent UTF-8 est ecarte avec un warning, `run_started` ne pouvant le porter.
    """
    if not folder.is_dir():
        raise TaggingFolderUnreadableError(folder)

    audio = (path for path in folder.rglob("*") if _is_audio(path))
    found = list(encodable_only(audio, "audio file"))
    # `rglob` avale l'OSError de son scandir : sans ce second controle, un support
    # debranche en cours de parcours rendrait une liste tronquee sans erreur.
    if not folder.is_dir():
        raise TaggingFolderUnreadableError(folder)

    return tuple(sorted(found, key=lambda path: _sort_key(path.relative_to(folder))))


def has_audio_files(folder: Path) -> bool:
    """S'arrete au premier fichier audio : un dossier de bibliotheque se parcourt entier sinon."""
    return any(_is_audio(path) and is_utf8_encodable(path) for path in folder.rglob("*"))


def _is_audio(path: Path) -> bool:
    return path.suffix.lower() in AUDIO_EXTENSIONS and path.is_file()


def _sort_key(relative: Path) -> tuple[str, ...]:
    return tuple(part.casefold() for part in relative.parts)


def read_shown_tags(path: Path) -> ShownTags:
    """Champs de la table et commentaire en une lecture, dont `identity` tire la requete.

    La colonne suit le conteneur retenu par mutagen, pas l'extension : a score egal
    `mutagen.File()` departage par nom de classe, un FLAC renomme `.mp3` ressort `unreadable`.
    """
    audio, tags = _load(path)
    match tags:
        case ID3() as id3:
            notes = [text for frame in id3.getall(_ID3_COMMENT) for text in frame.text]
            return _shown(TagSystem.ID3, _raw_fields(id3), notes)
        case VCFLACDict() as comments:
            notes = [text for key in _VORBIS_COMMENTS if key in comments for text in comments[key]]
            return _shown(TagSystem.VORBIS, _raw_fields(comments), notes)
        case None:
            system = TagSystem.VORBIS if isinstance(audio, FLAC) else TagSystem.ID3
            return _shown(system, {}, [])
        case _:
            # Conteneur hors des quatre formats (un WavPack sous `.wav`) : le prendre pour un
            # fichier sans tags masquerait l'echec que le pipeline doit loguer.
            raise TagsUnreadableError(path, _UNREADABLE)


def _shown(
    system: TagSystem, raw: Mapping[TagField, tuple[str, ...]], notes: Iterable[object]
) -> ShownTags:
    fields = {field: _shown_value(raw[field]) if field in raw else None for field in TAG_FIELDS}
    return ShownTags(system, MappingProxyType(fields), _shown_value(notes))


def _shown_value(values: Iterable[object]) -> str | None:
    return _join(values) or None


def read_original_tags(path: Path) -> OriginalTags:
    """Champs de la table avec toutes leurs valeurs.

    Ni jointes ni nettoyees : la restauration doit rendre le fichier tel qu'il etait.
    """
    match _load(path):
        case FLAC(), VCFLACDict() as comments:
            mirrors = {name: tuple(comments[name]) for name in _VORBIS_MIRRORS if name in comments}
            return OriginalTags(
                TagSystem.VORBIS,
                None,
                MappingProxyType(_raw_fields(comments)),
                MappingProxyType(mirrors),
            )
        case FLAC(), None:
            return OriginalTags(TagSystem.VORBIS, None, MappingProxyType({}), MappingProxyType({}))
        case MP3() | WAVE() | AIFF(), ID3() as tags:
            return OriginalTags(TagSystem.ID3, tags.version[1], MappingProxyType(_raw_fields(tags)))
        case MP3() | WAVE() | AIFF(), None:
            return OriginalTags(TagSystem.ID3, None, MappingProxyType({}))
        case _:
            raise TagsUnreadableError(path, _UNREADABLE)


def _raw_fields(tags: ID3 | VCFLACDict) -> dict[TagField, tuple[str, ...]]:
    match tags:
        case ID3():
            return {
                field: _id3_values(tags, keys.id3)
                for field, keys in TAG_FIELDS.items()
                if keys.id3 in tags
            }
        case VCFLACDict():
            return {
                field: tuple(tags[keys.vorbis])
                for field, keys in TAG_FIELDS.items()
                if keys.vorbis in tags
            }


def _load(path: Path) -> tuple[object, object]:
    try:
        audio = mutagen.File(extended_path(path))
    except (MutagenError, OSError) as exc:
        raise TagsUnreadableError(path, failure_reason(path, exc)) from exc

    if audio is None:
        raise TagsUnreadableError(path, _UNREADABLE)
    return audio, audio.tags


def _id3_values(tags: ID3, frame_id: str) -> tuple[str, ...]:
    frame = tags[frame_id]
    if frame_id == "WOAS":
        return (str(frame.url),)
    return tuple(str(value) for value in frame.text)


def _join(values: Iterable[object]) -> str:
    cleaned = (str(value).strip() for value in values)
    return _MULTI_VALUE_SEPARATOR.join(value for value in cleaned if value)


def project_tags(candidate: TrackCandidate) -> TagValues:
    """Valeurs du candidat a ecrire, absentes et vides omises.

    Le remixeur n'entre jamais dans l'artiste ; la date se reduit a l'annee.
    """
    release = candidate.release
    projected: dict[TagField, object] = {
        TagField.ARTIST: credited_artists(candidate),
        TagField.REMIXER: _join(credit.name for credit in candidate.remixers),
        TagField.TITLE: full_title(candidate),
        TagField.ALBUM: release.title if release else None,
        TagField.DATE: candidate.release_year,
        TagField.GENRE: candidate.genre,
        TagField.LABEL: candidate.label_name,
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


def after_tags(projection: TagValues, before: ShownTags | None) -> Mapping[TagField, str | None]:
    """Valeur du candidat, sinon celle d'origine : un champ absent n'efface rien."""
    return MappingProxyType(
        {
            field: projection.get(field) or (None if before is None else _kept(before, field))
            for field in TAG_FIELDS
        }
    )


def _kept(before: ShownTags, field: TagField) -> str | None:
    value = before.fields[field]
    # `update_to_v23()` ne garde que l'annee dans TYER, le reste part en TDAT.
    if value and before.system is TagSystem.ID3 and field in _ID3_V23_KEYS and value[:4].isdigit():
        return value[:4]
    return value


def shown_key(field: TagField, system: TagSystem) -> str:
    """Cle affichee a cote du libelle : celle du fichier ecrit, `TXXX` par sa description."""
    keys = TAG_FIELDS[field]
    if system is TagSystem.VORBIS:
        return keys.vorbis
    key = _ID3_V23_KEYS.get(field, keys.id3)
    kind, _, description = key.partition(":")
    return description if kind == "TXXX" else key


def tag_system_of(path: Path) -> TagSystem:
    """Systeme d'un fichier dont les tags n'ont pas pu etre lus, deduit de l'extension."""
    return TagSystem.VORBIS if path.suffix.lower() == ".flac" else TagSystem.ID3


def write_tags(path: Path, values: TagValues, artwork: Path | None) -> WrittenTags:
    """Ecrit les valeurs, une seule image et aucun commentaire, en place.

    Verrou, droits et fichier absent echouent avant toute ecriture sur le disque. Une
    pochette absente garde l'image du fichier : le cache est jetable (ADR-013).
    """
    picture = _read_artwork(artwork)
    _edit_tags(
        path,
        lambda flac, comments: _write_vorbis(flac, comments, values, picture),
        lambda tags: _write_id3(tags, values, picture),
        _ID3_V23,
    )
    return WrittenTags(fields=tuple(values), artwork=picture is not None)


def restore_tags(path: Path, original: OriginalTags) -> None:
    """Rend au fichier les champs du dump, dans sa version ID3 d'origine.

    Un champ absent du dump est retire : l'ecriture l'a ajoute. Le reste n'est pas touche.
    """
    _edit_tags(
        path,
        lambda _, comments: _restore_vorbis(comments, original),
        lambda tags: _restore_id3(tags, original),
        _ID3_V24 if original.id3_version == _ID3_V24 else _ID3_V23,
    )


def _edit_tags(
    path: Path,
    edit_vorbis: Callable[[FLAC, VCFLACDict], None],
    edit_id3: Callable[[ID3], None],
    id3_version: Id3Target,
) -> None:
    try:
        audio = mutagen.File(extended_path(path))
        if audio is None:
            raise TagsWriteError(path, FileFailureReason.WRITE_FAILED)
        if audio.tags is None:
            audio.add_tags()
        match audio, audio.tags:
            case FLAC() as flac, VCFLACDict() as comments:
                edit_vorbis(flac, comments)
                flac.save()
            case _, ID3() as tags:
                edit_id3(tags)
                if id3_version == _ID3_V23:
                    # `save(v2_version=3)` seul laisse TDRC et TDOR sur le disque (mutagen 1.48.1).
                    tags.update_to_v23()
                audio.save(v2_version=id3_version)
            case _:
                # Conteneur hors des quatre formats : refuse avant toute ecriture.
                raise TagsWriteError(path, FileFailureReason.WRITE_FAILED)
    except (MutagenError, OSError) as exc:
        raise TagsWriteError(path, failure_reason(path, exc)) from exc


def _restore_id3(tags: ID3, original: OriginalTags) -> None:
    for field, keys in TAG_FIELDS.items():
        if field in original.fields:
            tags.setall(keys.id3, [_id3_frame(keys.id3, original.fields[field])])
        else:
            tags.delall(keys.id3)


def _restore_vorbis(comments: VCFLACDict, original: OriginalTags) -> None:
    for field, keys in TAG_FIELDS.items():
        if field in original.fields:
            comments[keys.vorbis] = list(original.fields[field])
        elif keys.vorbis in comments:
            del comments[keys.vorbis]
    if original.vorbis_mirrors is None:
        return
    for name in _VORBIS_MIRRORS:
        if name in original.vorbis_mirrors:
            comments[name] = list(original.vorbis_mirrors[name])
        elif name in comments:
            del comments[name]


def failure_reason(path: Path, error: MutagenError | OSError) -> FileFailureReason:
    """Motif d'un echec de lecture ou d'ecriture d'un fichier audio, `__cause__` compris.

    Piege Windows : un fichier tenu par un lecteur leve `PermissionError` sans `winerror`
    (le CRT ne remonte pas le code de verrou), indiscernable d'un refus de droits. Seule autre
    cause, un fichier en lecture seule n'est pas inscriptible : s'il l'est, c'est un verrou.
    Limite : sous Windows `os.access(W_OK)` ne lit que l'attribut lecture seule, un refus d'ACL
    ou l'acces aux dossiers controles passe donc aussi en `file_locked`.
    """
    cause = error.__cause__ or error
    reason = (
        file_failure_reason(cause) if isinstance(cause, OSError) else FileFailureReason.WRITE_FAILED
    )
    if (
        reason is FileFailureReason.PERMISSION_DENIED
        and getattr(cause, "winerror", None) is None
        and os.access(extended_path(path), os.W_OK)
    ):
        reason = FileFailureReason.FILE_LOCKED
    return reason


def _write_id3(tags: ID3, values: TagValues, artwork: _Artwork | None) -> None:
    for field, value in values.items():
        frame_id = TAG_FIELDS[field].id3
        # Remplacement par cle exacte : un TXXX d'un autre logiciel reste en place.
        tags.setall(frame_id, [_id3_frame(frame_id, (value,))])
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


def _id3_frame(frame_id: str, values: Sequence[str]) -> Frame:
    kind, _, description = frame_id.partition(":")
    if kind == "TXXX":
        return TXXX(encoding=Encoding.UTF8, desc=description, text=list(values))
    if kind == "WOAS":
        return WOAS(url=values[0])
    return Frames[kind](encoding=Encoding.UTF8, text=list(values))


def _write_vorbis(
    audio: FLAC, comments: VCFLACDict, values: TagValues, artwork: _Artwork | None
) -> None:
    for field, value in values.items():
        keys = TAG_FIELDS[field]
        for name in (keys.vorbis, *keys.vorbis_mirrors):
            comments[name] = [value]
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
