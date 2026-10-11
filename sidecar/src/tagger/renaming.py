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
    """Nom `Artiste - Titre.ext` tenant en `room` caracteres, extension et marqueur compris.

    `None` sans artiste ou titre, et quand l'extension et le marqueur de `copy` (au-dela de 1,
    ` (copy)` avant l'extension) ne laissent aucune place au nom : un nom hors limite ne se
    fabrique pas. La coupe entame le titre, l'artiste en dernier recours.
    """
    readable_artist, readable_title = _readable(artist), _readable_title(title)
    if not readable_artist or not readable_title:
        return None

    marker = f" ({copy})" if copy > 1 else ""
    extension = suffix.lower()
    available = room - len(extension) - len(marker)
    if available < 1:
        return None

    stem = f"{readable_artist}{_SEPARATOR}{readable_title}"
    if _length(stem) <= available:
        return TrackFileName(f"{stem}{marker}{extension}", truncated=False)

    cut = stem[:available]
    while _length(cut) > available:
        cut = cut[:-1]
    cut = cut.rstrip(_LOOSE_END) or stem[:available]
    return TrackFileName(f"{cut}{marker}{extension}", truncated=True)


@dataclass(frozen=True, slots=True)
class RenamePlan:
    """Renommage calcule, pas encore fait : la cible est connue avant que le fichier ne bouge.

    `source` porte le prefixe `\\\\?\\` que l'OS ouvre, `path` et `target` n'en ont pas.
    """

    path: Path
    source: Path
    target: Path
    truncated: bool

    def apply(self) -> RenamedTrack:
        """Renomme le fichier ; echoue (verrou, droits, fichier disparu) sans le deplacer."""
        try:
            self.source.rename(self.source.with_name(self.target.name))
        except OSError as error:
            raise RenameError(self.path, file_failure_reason(error)) from error
        return RenamedTrack(self.target, self.truncated)


def plan_rename(path: Path, artist: str | None, title: str | None) -> RenamePlan | None:
    """Cible du renommage, sans rien modifier sur le disque ; `None` quand le fichier garde son nom.

    Il le garde sans artiste ou titre, ou s'il porte deja le nom voulu. `path` doit etre absolu,
    la place restante se calcule sur `str(path.parent)`.
    """
    if not _readable(artist or "") or not _readable_title(title or ""):
        return None

    room = min(MAX_NAME_LENGTH, MAX_PATH_LENGTH - _length(str(path.parent)) - 1)
    # Dossier resolu une fois : chaque resolution est un appel disque, reseau sur un partage.
    source = extended_path(path)
    try:
        named = _free_name(path, source, artist or "", title or "", room)
    except OSError as error:
        raise RenameError(path, file_failure_reason(error)) from error
    if named is None:
        return None
    return RenamePlan(path, source, path.with_name(named.name), named.truncated)


def restore_name(current: Path, original: Path) -> None:
    """Rend au fichier son nom d'origine, refuse s'il est porte par un autre fichier.

    Jamais un nom approchant : les logiciels DJ retrouvent un fichier par son chemin exact.
    """
    # Chaines comparees : `Path` ignore la casse sous Windows, un changement de casse seule
    # passerait pour un nom deja rendu.
    if str(current) == str(original):
        return
    # Prefixes des le controle, comme `plan_rename` : au-dela de 259 caracteres, `exists`
    # sur le chemin nu ne verrait pas le fichier qui porte le nom.
    source, target = extended_path(current), extended_path(original)
    try:
        if _taken_by_another_file(target, source):
            raise OriginalNameTakenError(original)
        source.rename(target)
    except OSError as error:
        raise RenameError(current, file_failure_reason(error)) from error


def _free_name(
    path: Path, source: Path, artist: str, title: str, room: int
) -> TrackFileName | None:
    """Premier nom libre au motif, `None` quand le fichier garde le sien.

    Artiste et titre sont lisibles ici : un `None` de `track_file_name` veut dire que le nom
    ne tient pas dans la place, le marqueur d'une collision pouvant la depasser quand elle
    est minuscule.
    """
    copy = 1
    while True:
        named = track_file_name(artist, title, source.suffix, room, copy)
        if named is None:
            raise RenameError(path, FileFailureReason.PATH_TOO_LONG)
        if named.name == source.name:
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
