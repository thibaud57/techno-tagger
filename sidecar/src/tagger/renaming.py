"""Renommage d'un fichier ecrit en `{artist} - {title}.{ext}`, dans son dossier.

Le nom reste ouvrable par les logiciels qui ignorent les chemins longs : ce sont eux qui
fixent la limite de 259 caracteres (ARCHITECTURE.md § Robustesse).
"""

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, ClassVar, Final, NamedTuple

from tagger.errors import TaggerError
from tagger.file_failures import FileFailureReason, file_failure_reason
from tagger.paths import extended_path

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

# MAX_PATH de l'API Win32, terminateur nul deduit.
MAX_PATH_LENGTH: Final = 259
# Longueur maximale d'un nom sous NTFS.
MAX_NAME_LENGTH: Final = 255

_SEPARATOR: Final = " - "
_SPACES: Final = re.compile(r"\s+")
# Ordre significatif : tabulation en espace avant la purge des controles, `: ` avant le
# `:` isole, espaces resserres a nouveau apres les suppressions.
_READABLE_REPLACEMENTS: Final = (
    (_SPACES, " "),
    (re.compile(r"[\\/|]"), "-"),
    (re.compile(r":\s+"), " - "),
    (re.compile(r":"), "-"),
    (re.compile(r'"'), "'"),
    (re.compile(r"[?*<>\x00-\x1f]"), ""),
    (_SPACES, " "),
)
# Ce que Windows retire en silence en fin de nom.
_TRAILING: Final = " ."
# Ce qu'une coupe laisse en bout de nom sans rien signifier : un tiret final ne se retire
# qu'ici, hors coupe il appartient au titre (`Re-`).
_LOOSE_END: Final = f"{_TRAILING}-"


class TrackFileName(NamedTuple):
    """Nom calcule, et s'il a fallu couper le titre pour qu'il tienne."""

    name: str
    truncated: bool


@dataclass(frozen=True, slots=True)
class RenamedTrack:
    """Chemin du fichier apres renommage, sans prefixe `\\\\?\\`."""

    path: Path
    truncated: bool


class RenameError(TaggerError):
    """Fichier non renomme, il garde son nom ; levee sans log, l'appelant connait le run."""

    code: ClassVar[str] = "file_rename_failed"

    def __init__(self, path: Path, reason: FileFailureReason) -> None:
        super().__init__(f"file not renamed: {path.name}", file=path.name, reason=reason)
        self.reason = reason


class OriginalNameTakenError(TaggerError):
    """Un autre fichier porte le nom d'origine : le rendre l'ecraserait."""

    code: ClassVar[str] = "original_name_taken"

    def __init__(self, path: Path) -> None:
        super().__init__(f"original name taken: {path.name}", file=path.name)


def track_file_name(
    artist: str, title: str, suffix: str, room: int, copy: int = 1
) -> TrackFileName | None:
    """Nom `Artiste - Titre.ext` tenant en `room` caracteres, `None` sans artiste ou titre.

    `copy` au-dela de 1 ajoute ` (copy)` avant l'extension. La coupe entame le titre, l'artiste
    en dernier recours.
    """
    readable_artist, readable_title = _readable(artist), _readable_title(title)
    if not readable_artist or not readable_title:
        return None

    marker = f" ({copy})" if copy > 1 else ""
    extension = suffix.lower()
    stem = f"{readable_artist}{_SEPARATOR}{readable_title}"
    available = max(room - len(extension) - len(marker), 1)
    if _length(stem) <= available:
        return TrackFileName(f"{stem}{marker}{extension}", truncated=False)

    cut = stem[:available]
    while _length(cut) > available:
        cut = cut[:-1]
    cut = cut.rstrip(_LOOSE_END) or stem[:available]
    return TrackFileName(f"{cut}{marker}{extension}", truncated=True)


def rename_track(
    path: Path,
    artist: str | None,
    title: str | None,
    before_rename: Callable[[Path], None] | None = None,
) -> RenamedTrack:
    """Renomme le fichier dans son dossier ; sans artiste ou titre, il garde son nom.

    `before_rename(target)` part juste avant l'appel systeme, jamais si le nom est garde : le
    renommage peut encore echouer ensuite (fichier verrouille), l'appelant doit le gerer.
    `path` doit etre absolu, la place restante se calcule sur `str(path.parent)`.
    """
    if not _readable(artist or "") or not _readable_title(title or ""):
        return RenamedTrack(path, truncated=False)

    room = min(MAX_NAME_LENGTH, MAX_PATH_LENGTH - _length(str(path.parent)) - 1)
    if room <= len(path.suffix):
        raise RenameError(path, FileFailureReason.PATH_TOO_LONG)

    # Dossier resolu une fois : chaque resolution est un appel disque, reseau sur un partage.
    source = extended_path(path)
    try:
        named = _free_name(source, artist or "", title or "", room)
    except OSError as error:
        raise RenameError(path, file_failure_reason(error)) from error
    if named is None:
        return RenamedTrack(path, truncated=False)

    target = path.with_name(named.name)
    # Le prefixe leve la limite pour l'OS : le marqueur d'une collision peut depasser `room`
    # quand elle est minuscule, et plus rien ne refuserait le chemin.
    if _length(str(target)) > MAX_PATH_LENGTH:
        raise RenameError(path, FileFailureReason.PATH_TOO_LONG)
    if before_rename is not None:
        before_rename(target)
    try:
        source.rename(source.with_name(named.name))
    except OSError as error:
        raise RenameError(path, file_failure_reason(error)) from error
    return RenamedTrack(target, named.truncated)


def restore_name(current: Path, original: Path) -> None:
    """Rend au fichier son nom d'origine, refuse s'il est porte par un autre fichier.

    Jamais un nom approchant : les logiciels DJ retrouvent un fichier par son chemin exact.
    """
    # Chaines comparees : `Path` ignore la casse sous Windows, un changement de casse seule
    # passerait pour un nom deja rendu.
    if str(current) == str(original):
        return
    # Prefixes des le controle, comme `rename_track` : au-dela de 259 caracteres, `exists`
    # sur le chemin nu ne verrait pas le fichier qui porte le nom.
    source, target = extended_path(current), extended_path(original)
    try:
        if _taken_by_another_file(target, source):
            raise OriginalNameTakenError(original)
        source.rename(target)
    except OSError as error:
        raise RenameError(current, file_failure_reason(error)) from error


def _free_name(source: Path, artist: str, title: str, room: int) -> TrackFileName | None:
    """Premier nom libre au motif, `None` quand le fichier garde le sien."""
    copy = 1
    while True:
        named = track_file_name(artist, title, source.suffix, room, copy)
        if named is None or named.name == source.name:
            return None
        if not _taken_by_another_file(source.with_name(named.name), source):
            return named
        copy += 1


def _length(text: str) -> int:
    """Longueur en unites UTF-16, celles que comptent NTFS et `MAX_PATH` : un emoji en vaut deux."""
    return len(text.encode("utf-16-le")) // 2


def _readable(text: str) -> str:
    for pattern, replacement in _READABLE_REPLACEMENTS:
        text = pattern.sub(replacement, text)
    return text.strip()


def _readable_title(text: str) -> str:
    """Titre lisible sans point ni espace final, que Windows retire en silence du nom."""
    return _readable(text).rstrip(_TRAILING)


def _taken_by_another_file(target: Path, source: Path) -> bool:
    """Un nom qui ne differe que par la casse designe le meme fichier sous Windows."""
    return target.exists() and not target.samefile(source)
