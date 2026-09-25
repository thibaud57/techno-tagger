"""Fichiers audio vierges minimaux des quatre formats, construits en octets.

Aucun binaire commite : comme le dump VLC, ce que les tests manipulent se
construit a l'execution. Les fichiers sont muets et sans tags, `tag` les
renseigne dans l'arrange.

Constructions validees le 2026-09-20 contre mutagen 1.48.1 : une montee de version qui
casse un de ces formats faits main se diagnostique en comparant d'abord ici.
"""

import struct
import wave
from typing import TYPE_CHECKING, Final

import mutagen
from mutagen.flac import FLAC
from mutagen.id3 import TIT2, TPE1

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

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


def tag(path: Path, *, artist: list[str], title: list[str]) -> None:
    """Pose artiste et titre avec mutagen, dans le systeme de tags du format."""
    audio = mutagen.File(path)
    if isinstance(audio, FLAC):
        audio["ARTIST"] = artist
        audio["TITLE"] = title
    else:
        if audio.tags is None:
            audio.add_tags()
        # Frame ID3 non annotee cote mutagen : son __init__ est (*args, **kwargs).
        audio.tags.add(TPE1(encoding=3, text=artist))  # type: ignore[no-untyped-call]
        audio.tags.add(TIT2(encoding=3, text=title))  # type: ignore[no-untyped-call]
    audio.save()
