"""Nom de fichier legal en NTFS mais sans equivalent UTF-8 : un surrogate isole."""

from typing import Final

UNENCODABLE_NAME: Final = "lone\ud800.mp3"
