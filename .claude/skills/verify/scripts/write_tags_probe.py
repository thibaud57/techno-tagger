"""Ecrit les tags d'un candidat sur des fichiers des quatre formats, puis relit le disque.

Appelle `write_tags` comme la phase d'ecriture, sans passer par le protocole, dans un dossier
jetable. Usage, depuis la racine du depot :

    uv run --directory sidecar python <skill>/scripts/write_tags_probe.py <dossier> [format ...]

Les morceaux de `just demo` ne portent pas de vrai flux MPEG et mutagen refuse les MP3 :
chaque fichier est donc bati par `audio_samples`, comme dans les tests. Il recoit d'abord des
tags d'origine sales (des commentaires, un verso et un recto, une date complete en
v2.4 cote ID3, une frame Serato), puis la projection du candidat Beatport des fixtures
avec une pochette JPEG. La relecture se fait par `translate=False` : les frames telles
qu'ecrites sur le disque, pas la remontee en v2.4 de mutagen.
"""

import json
import sys
from pathlib import Path

import mutagen
from mutagen.flac import FLAC, Picture
from mutagen.id3 import APIC, COMM, PRIV, TDRC, TXXX, PictureType

HELPERS = Path(__file__).resolve().parents[4] / "sidecar" / "tests" / "helpers"
sys.path.insert(0, str(HELPERS))
from audio_samples import (  # noqa: E402
    write_blank_aiff,
    write_blank_flac,
    write_blank_mp3,
    write_blank_wav,
)
from scraper_responses import track_payload  # noqa: E402
from tagging_api import JPEG  # noqa: E402

from tagger.files import project_tags, write_tags  # noqa: E402
from tagger.scraper_client import TrackCandidate  # noqa: E402

BUILDERS = {
    "mp3": write_blank_mp3,
    "wav": write_blank_wav,
    "aiff": write_blank_aiff,
    "flac": write_blank_flac,
}


def emit(payload: dict[str, object]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")


def dirty(path: Path) -> None:
    audio = mutagen.File(path)
    if isinstance(audio, FLAC):
        audio["COMMENT"] = ["ripped by X"]
        audio["DESCRIPTION"] = ["320kbps"]
        audio["SERATO_PLAYCOUNT"] = ["12"]
        for kind, data in ((PictureType.COVER_BACK, b"back"), (PictureType.COVER_FRONT, b"old")):
            picture = Picture()
            picture.type, picture.mime, picture.data = kind, "image/png", data
            audio.add_picture(picture)
        audio.save()
        return
    if audio.tags is None:
        audio.add_tags()
    tags = audio.tags
    tags.add(COMM(encoding=3, lang="eng", desc="", text=["ripped by X"]))
    tags.add(TDRC(encoding=3, text=["2019-06-16"]))
    tags.add(TXXX(encoding=3, desc="SERATO_PLAYCOUNT", text=["12"]))
    tags.add(PRIV(owner="Serato", data=b"beatgrid"))
    tags.add(
        APIC(encoding=3, mime="image/png", type=PictureType.COVER_BACK, desc="b", data=b"back")
    )
    tags.add(APIC(encoding=3, mime="image/png", type=PictureType.COVER_FRONT, desc="f", data=b"o"))
    audio.save(v2_version=4)


def read_disk(path: Path) -> dict[str, object]:
    audio = mutagen.File(path)
    if isinstance(audio, FLAC):
        return {
            "tags": dict(audio.tags.as_dict()),
            "pictures": [(p.type, p.mime, len(p.data)) for p in audio.pictures],
        }
    on_disk = type(audio)(path, translate=False).tags
    return {
        "version": ".".join(map(str, on_disk.version)),
        "tags": {key: str(frame) for key, frame in on_disk.items() if not key.startswith("APIC")},
        "pictures": [(f.type, f.mime, len(f.data)) for f in on_disk.getall("APIC")],
        "comment_left": b"ripped by X" in path.read_bytes(),
    }


def main() -> int:
    formats = sys.argv[2:] or list(BUILDERS)
    if not sys.argv[1:] or not set(formats) <= set(BUILDERS):
        emit(
            {"error": True, "message": "usage : write_tags_probe.py <dossier> [mp3 wav aiff flac]"}
        )
        return 1
    folder = Path(sys.argv[1])
    folder.mkdir(parents=True, exist_ok=True)
    cover = folder / "cover.jpg"
    cover.write_bytes(JPEG)
    values = project_tags(TrackCandidate.model_validate(track_payload()))

    results = []
    for audio_format in formats:
        copy = BUILDERS[audio_format](folder / f"track.{audio_format}")
        dirty(copy)
        written = write_tags(copy, values, cover)
        results.append(
            {
                "file": copy.name,
                "written_fields": len(written.fields),
                "artwork": written.artwork,
                "disk": read_disk(copy),
            }
        )
    emit({"success": True, "values": dict(values), "results": results})
    return 0


if __name__ == "__main__":
    sys.exit(main())
