"""Motifs d'echec d'un fichier, communs a l'extraction et a l'ecriture : meme panne, meme nom."""

import errno
from enum import UNIQUE, StrEnum, auto, verify
from typing import Final

# Codes d'erreur Windows, absents des autres plateformes.
WINDOWS_LOCK_ERRORS: Final = frozenset({32, 33})  # SHARING_VIOLATION, LOCK_VIOLATION
WINDOWS_PATH_TOO_LONG: Final = 206  # FILENAME_EXCED_RANGE


@verify(UNIQUE)
class FileFailureReason(StrEnum):
    """Motif d'un fichier qui n'a pas pu etre copie, deplace ou ecrit."""

    PERMISSION_DENIED = auto()
    DISK_FULL = auto()
    PATH_TOO_LONG = auto()
    FILE_LOCKED = auto()
    FILE_MISSING = auto()
    WRITE_FAILED = auto()


def file_failure_reason(error: OSError) -> FileFailureReason:
    """`winerror` prime sur le type : un verrou leve `PermissionError` comme un refus de droits."""
    windows_code = getattr(error, "winerror", None)
    if windows_code in WINDOWS_LOCK_ERRORS:
        return FileFailureReason.FILE_LOCKED
    if windows_code == WINDOWS_PATH_TOO_LONG or error.errno == errno.ENAMETOOLONG:
        return FileFailureReason.PATH_TOO_LONG
    if isinstance(error, FileNotFoundError):
        return FileFailureReason.FILE_MISSING
    if isinstance(error, PermissionError):
        return FileFailureReason.PERMISSION_DENIED
    if error.errno == errno.ENOSPC:
        return FileFailureReason.DISK_FULL

    return FileFailureReason.WRITE_FAILED
