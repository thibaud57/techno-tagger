"""Fichiers audio vierges minimaux des quatre formats, construits en octets.

Aucun binaire commite : comme le dump VLC, ce que les tests manipulent se
construit a l'execution. Les fichiers sont muets et sans tags, `tag` les
renseigne dans l'arrange.

Constructions validees le 2026-09-20 contre mutagen 1.48.1 : une montee de version qui
casse un de ces formats faits main se diagnostique en comparant d'abord ici.
"""

import ctypes
import struct
import wave
from contextlib import contextmanager
from ctypes import wintypes
from typing import TYPE_CHECKING, Final, NoReturn

import mutagen
import pytest
from mutagen import MutagenError
from mutagen.flac import FLAC
from mutagen.id3 import TIT2, TPE1, Frames
from stubs import raising

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator
    from pathlib import Path

    from mutagen.id3 import ID3
    from stubs import Replacement

# MPEG-1 Layer III, 128 kbit/s, 44,1 kHz, mono, sans CRC ni padding : une trame
# fait 144 * 128000 / 44100 = 417 octets. Plusieurs trames, mutagen se
# synchronisant sur une suite de trames coherente.
_MP3_FRAME_HEADER: Final = b"\xff\xfb\x90\xc0"
_MP3_FRAME_LENGTH: Final = 417
_MP3_FRAME_COUNT: Final = 8

# 44100 Hz en flottant etendu 80 bits, seul format de frequence du chunk COMM.
_AIFF_RATE_44100: Final = b"\x40\x0e\xac\x44\x00\x00\x00\x00\x00\x00"

# WavPack : en-tete de 32 octets. La frequence est un index dans la table RATES de
# mutagen, loge sur les bits 23 a 26 des flags ; les deux bits de poids faible y
# codent (octets par echantillon - 1).
_WAVPACK_BLOCK_LENGTH: Final = 32
_WAVPACK_RATE_INDEX_44100: Final = 9
_WAVPACK_BYTES_PER_SAMPLE_16: Final = 1
_WAVPACK_VERSION: Final = 0x0410

# APEv2 : blocs de 32 octets, preambule compris. Le tag s'ecrit avec son en-tete et
# son pied, les deux drapeaux que mutagen attend pour le relire.
_APE_VERSION: Final = 2000
_APE_BLOCK_LENGTH: Final = 32
_APE_HAS_HEADER: Final = 1 << 31
_APE_IS_HEADER: Final = 1 << 29


def write_blank_mp3(path: Path) -> Path:
    """Suite de trames MPEG silencieuses, sans tag ID3."""
    frame = _MP3_FRAME_HEADER + b"\x00" * (_MP3_FRAME_LENGTH - len(_MP3_FRAME_HEADER))
    path.write_bytes(frame * _MP3_FRAME_COUNT)
    return path


def write_not_audio(path: Path) -> Path:
    """Octets que mutagen ne rattache a aucun format, quelle que soit l'extension."""
    path.write_bytes(b"not an audio file" * 16)
    return path


def write_blank_wav(path: Path) -> Path:
    """RIFF/WAVE mono 16 bits, un centieme de seconde de silence."""
    with wave.open(str(path), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(44_100)
        audio.writeframes(b"\x00\x00" * 441)
    return path


def write_blank_aiff(path: Path) -> Path:
    """FORM/AIFF ecrit a la main : `aifc` a quitte la stdlib en 3.13."""
    frames = 441
    comm = struct.pack(">hLh", 1, frames, 16) + _AIFF_RATE_44100
    ssnd = struct.pack(">LL", 0, 0) + b"\x00\x00" * frames
    chunks = (
        b"COMM"
        + struct.pack(">L", len(comm))
        + comm
        + b"SSND"
        + struct.pack(">L", len(ssnd))
        + ssnd
    )
    path.write_bytes(b"FORM" + struct.pack(">L", 4 + len(chunks)) + b"AIFF" + chunks)
    return path


def write_blank_flac(path: Path) -> Path:
    """Signature `fLaC` et bloc STREAMINFO seul : mutagen n'a besoin d'aucune trame."""
    sample_rate, channels, bits_per_sample, total_samples = 44_100, 1, 16, 0
    packed = (
        (sample_rate << 44) | ((channels - 1) << 41) | ((bits_per_sample - 1) << 36) | total_samples
    )
    streaminfo = (
        struct.pack(">HH", 4096, 4096) + b"\x00" * 6 + struct.pack(">Q", packed) + b"\x00" * 16
    )
    last_block_streaminfo = bytes([0x80]) + len(streaminfo).to_bytes(3, "big")
    path.write_bytes(b"fLaC" + last_block_streaminfo + streaminfo)
    return path


def write_tagged_wavpack(path: Path) -> Path:
    """Fichier WavPack tague en APEv2, conteneur hors des quatre formats retenus.

    Mutagen le reconnait a son en-tete meme sous extension `.wav`. Ses tags sont
    renseignes a dessein, pour qu'il ne puisse pas passer pour non tague.
    """
    frames = 441
    flags = (_WAVPACK_RATE_INDEX_44100 << 23) | _WAVPACK_BYTES_PER_SAMPLE_16
    header = (
        b"wvpk"
        + struct.pack("<I", _WAVPACK_BLOCK_LENGTH)
        + struct.pack("<H", _WAVPACK_VERSION)
        + bytes([0, 0])
        + struct.pack("<III", frames, 0, frames)
        + struct.pack("<II", flags, 0)
    )
    path.write_bytes(header + _ape_tag({"Artist": "Sara Landry", "Title": "The Void"}))
    return path


def _ape_tag(items: dict[str, str]) -> bytes:
    body = b""
    for key, value in items.items():
        encoded = value.encode("utf-8")
        body += struct.pack("<II", len(encoded), 0) + key.encode("ascii") + b"\x00" + encoded
    size = len(body) + _APE_BLOCK_LENGTH

    def block(flags: int) -> bytes:
        header = struct.pack("<IIII", _APE_VERSION, size, len(items), flags)
        return b"APETAGEX" + header + b"\x00" * 8

    return block(_APE_HAS_HEADER | _APE_IS_HEADER) + body + block(_APE_HAS_HEADER)


BLANK_WRITERS: Final[dict[str, Callable[[Path], Path]]] = {
    "mp3": write_blank_mp3,
    "wav": write_blank_wav,
    "aiff": write_blank_aiff,
    "flac": write_blank_flac,
}


# Les quatre formats, un id par systeme de tags et conteneur ; mp3 et flac suffisent
# quand seul le systeme de tags (ID3 ou Vorbis) change le comportement.
ALL_FORMATS: Final = [
    pytest.param("mp3", id="id3-mp3"),
    pytest.param("wav", id="id3-wav"),
    pytest.param("aiff", id="id3-aiff"),
    pytest.param("flac", id="vorbis-flac"),
]
ID3_VORBIS_FORMATS: Final = [ALL_FORMATS[0], ALL_FORMATS[3]]


def tag(path: Path, *, artist: list[str], title: list[str]) -> None:
    """Pose artiste et titre avec mutagen, dans le systeme de tags du format."""
    audio = mutagen.File(path)
    if isinstance(audio, FLAC):
        audio["ARTIST"] = artist
        audio["TITLE"] = title
    else:
        if audio.tags is None:
            audio.add_tags()
        audio.tags.add(TPE1(encoding=3, text=artist))
        audio.tags.add(TIT2(encoding=3, text=title))
    audio.save()


def preset_tags(path: Path, **frames_or_keys: str) -> None:
    """Pose des tags d'origine dans l'arrange : frames texte ID3 ou cles Vorbis."""
    audio = mutagen.File(path)
    if isinstance(audio, FLAC):
        for key, value in frames_or_keys.items():
            audio[key] = [value]
        audio.save()
        return
    if audio.tags is None:
        audio.add_tags()
    for frame_id, value in frames_or_keys.items():
        audio.tags.add(Frames[frame_id](encoding=3, text=[value]))
    audio.tags.update_to_v23()
    audio.save(v2_version=3)


def id3_as_written(path: Path) -> ID3:
    """Frames telles qu'ecrites sur le disque : rechargees sans la remontee en v2.4 de mutagen."""
    tags: ID3 = type(mutagen.File(path))(path, translate=False).tags
    return tags


def append_id3v1(path: Path, *, comment: str) -> None:
    """Ajoute en fin de MP3 un tag ID3v1 de 128 octets portant un commentaire."""
    fields = (b"Old Title", b"Old Artist", b"Old Album")
    body = b"".join(field.ljust(30, b"\0") for field in fields)
    tail = b"2001" + comment.encode("latin-1").ljust(30, b"\0") + bytes([255])
    with path.open("ab") as audio:
        audio.write(b"TAG" + body + tail)


_GENERIC_READ: Final = 0x80000000
_FILE_SHARE_READ: Final = 1
_OPEN_EXISTING: Final = 3
_INVALID_HANDLE: Final = wintypes.HANDLE(-1).value


@contextmanager
def held_open(path: Path) -> Iterator[None]:
    """Tient le fichier comme un lecteur audio : lisible, plus inscriptible (Windows seulement)."""
    kernel32 = ctypes.windll.kernel32
    kernel32.CreateFileW.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.LPVOID,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.HANDLE,
    ]
    kernel32.CreateFileW.restype = wintypes.HANDLE
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel32.CreateFileW(
        str(path), _GENERIC_READ, _FILE_SHARE_READ, None, _OPEN_EXISTING, 0, None
    )
    if handle == _INVALID_HANDLE:
        raise ctypes.WinError()
    try:
        yield
    finally:
        kernel32.CloseHandle(handle)


def mutagen_refusing(os_error: OSError) -> Replacement[NoReturn]:
    """Remplacant d'une fonction de mutagen qui echoue sur `os_error`, enveloppee comme lui."""
    refusal = MutagenError("file in use")
    refusal.__cause__ = os_error
    return raising(refusal)


# Le verrou d'un lecteur audio, que Windows rend en erreur 32.
locked_by_another_process: Final = mutagen_refusing(
    OSError(32, "The process cannot access the file", None, 32)
)


def tagged_audio(folder: Path, name: str, artist: str, title: str) -> Path:
    """Fichier vierge au format de l'extension de `name`, tague, dans le dossier du run."""
    folder.mkdir(parents=True, exist_ok=True)
    path = BLANK_WRITERS[name.rsplit(".", 1)[1]](folder / name)
    tag(path, artist=[artist], title=[title])
    return path


def tagged_mp3(folder: Path, name: str, artist: str, title: str) -> Path:
    """Cas courant de `tagged_audio` : un MP3."""
    return tagged_audio(folder, name, artist, title)
