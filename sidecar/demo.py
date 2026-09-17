"""Construit une bibliotheque de demonstration pour piloter l'application a la main.

Ce n'est pas une fixture de test : les tests ecrivent des fichiers d'un kilo-octet dans
`tmp_path`, ici on ecrit des dizaines de megaoctets dans `demo-data/`, ignore par git, pour
voir l'ecran tel qu'il sera en vrai. L'arborescence produit les cinq categories du rapport
en un seul run.

    uv run python demo.py            # construit et affiche les chemins a choisir
    uv run python demo.py --lock N   # tient un morceau verrouille N secondes
    uv run python demo.py --clean    # efface l'arborescence

Rien ne s'accumule : chaque construction repart de zero.

Le verrou reproduit un lecteur audio qui joue le fichier : c'est la seule facon d'obtenir
un vrai `file_locked` plutot que de le simuler.
"""

import argparse
import ctypes
import shutil
import sys
import time
from ctypes import wintypes
from pathlib import Path
from typing import Final

sys.path.insert(0, str(Path(__file__).parent / "tests" / "helpers"))

from vlc_dump import build_dump

# Noms inventes mais realistes, et qui couvrent ce qui casse en vrai : accents, cyrillique,
# apostrophes, parentheses, casse melangee, et les quatre extensions acceptees. Aucun
# deux-points : Windows en fait un flux alternatif NTFS, le fichier n'existe pas.
TRACKS: Final[tuple[str, ...]] = (
    "Kobosil - Bang.mp3",
    "Amelie Lens - Higher (Original Mix).wav",
    "Charlotte de Witte - Doppler.flac",
    "I Hate Models - Daydream.mp3",
    "SNTS - The Rustle Of Leaves.aiff",
    "Dax J - Escape The System.mp3",
    "Rebekah - Anxiety.wav",
    "Perc - Look What Your Love Has Done To Me.mp3",
    "Regal - Still Raving.flac",
    "Héctor Oaks - As We Were.wav",
    "Blawan - Why They Hide Their Bodies.mp3",
    "Surgeon - Klonk.aiff",
    "Oscar Mulero - Perfect Peace.mp3",
    "Ancient Methods - Дорога.flac",
    "Setaoc Mass - Kondo.mp3",
    "Antigone - Kirlian.wav",
    "Klangkuenstler - Cocaine.mp3",
    "Nico Moreno - Hardcore Vibes.mp3",
    "Jeff Mills - The Bells.aiff",
    "Robert Hood - Minimal Nation.flac",
    "Shlømo - Blissful Nights.mp3",
    "Randomer - Sun Bear.wav",
    "Rødhåd - Kinder Der Ringstrasse.mp3",
    "Milo Spykers - Time To Go.flac",
    "Trym - Sequence 4.mp3",
    "Lady Starlight - Pattern Recognition.aiff",
    "Paula Temple - Deathvox.wav",
    "999999999 - X0000000X.mp3",
    "Under Black Helmet - Numb.flac",
    "Kas.st - The Wall.mp3",
)

# Positions dans TRACKS, et non des noms : un renommage ne peut pas laisser un cas oriente
# vers un morceau disparu. Chaque cas alimente une categorie du rapport.
MISSING: Final = (7, 13, 22)  # absents de la bibliotheque
DUPLICATED: Final = (0, 16, 17)  # homonyme plus petit dans un sous-dossier
ALREADY_PRESENT: Final = (4, 18)  # deja poses en destination
LOCKED: Final = 9  # tenu par un autre process au moment du run


def build(root: Path, size_mb: int) -> None:
    """Ecrit l'arborescence complete, en repartant de zero."""
    library = root / "Bibliotheque"
    destination = root / "Extraction"
    dump = root / "vlc_media.db"
    for folder in (library, destination):
        if folder.exists():
            shutil.rmtree(folder)
    # Le dump se recree de zero : SQLite refuse un `CREATE TABLE` sur une table qui existe.
    dump.unlink(missing_ok=True)
    (library / "Doublons").mkdir(parents=True)
    destination.mkdir(parents=True)

    chunk = b"\0" * (1024 * 1024)
    for index, name in enumerate(TRACKS):
        if index in MISSING:
            continue
        with (library / name).open("wb") as handle:
            for _ in range(size_mb):
                handle.write(chunk)

    # Homonyme plus petit : le sidecar doit garder le plus volumineux et consigner l'ecarte.
    for index in DUPLICATED:
        (library / "Doublons" / TRACKS[index]).write_bytes(b"\0" * 400_000)

    for index in ALREADY_PRESENT:
        shutil.copyfile(library / TRACKS[index], destination / TRACKS[index])

    build_dump(dump, tracks=TRACKS)
    (root / "set-du-samedi.m3u8").write_text(
        "#EXTM3U\n" + "\n".join(f"../Bibliotheque/{name}" for name in TRACKS) + "\n",
        encoding="utf-8",
    )

    written = sum(path.stat().st_size for path in library.rglob("*") if path.is_file())
    print(f"Bibliotheque : {library}")
    print(f"Destination  : {destination}")
    print(f"Dump VLC     : {dump}")
    print(f"Playlist M3U8: {root / 'set-du-samedi.m3u8'}")
    print()
    print(f"{len(TRACKS)} morceaux, {written / 1e9:.2f} Go")
    print(
        f"attendu : {len(TRACKS) - len(MISSING) - len(ALREADY_PRESENT) - 1} extraits, "
        f"{len(ALREADY_PRESENT)} deja presents, {len(MISSING)} introuvables, "
        f"{len(DUPLICATED)} doublons, 1 echec si le verrou tourne"
    )
    print()
    print(f"verrou : uv run python demo.py --lock 180   ({TRACKS[LOCKED]})")


def lock(path: Path, seconds: int) -> int:
    """Tient le fichier en exclusivite, comme un lecteur audio qui le joue.

    `open()` de Python partage le fichier en lecture : seul `CreateFileW` avec un mode de
    partage nul provoque le refus que l'extraction doit rencontrer.
    """
    create_file = ctypes.windll.kernel32.CreateFileW
    create_file.restype = wintypes.HANDLE
    handle = create_file(str(path), 0x80000000, 0, None, 3, 0, None)
    if handle == ctypes.c_void_p(-1).value:
        print(f"verrou impossible, code {ctypes.GetLastError()}", flush=True)
        return 1

    print(f"verrouille {seconds}s : {path}", flush=True)
    time.sleep(seconds)
    ctypes.windll.kernel32.CloseHandle(handle)
    print("relache", flush=True)

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "demo-data",
        help="ou ecrire l'arborescence",
    )
    parser.add_argument("--size-mb", type=int, default=40, help="taille d'un morceau")
    parser.add_argument("--lock", type=int, metavar="SECONDES", help="verrouiller un morceau")
    parser.add_argument("--clean", action="store_true", help="effacer l'arborescence")
    args = parser.parse_args()

    if args.lock is not None:
        return lock(args.root / "Bibliotheque" / TRACKS[LOCKED], args.lock)

    if args.clean:
        shutil.rmtree(args.root, ignore_errors=True)
        print(f"efface : {args.root}")

        return 0

    args.root.mkdir(parents=True, exist_ok=True)
    build(args.root, args.size_mb)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
