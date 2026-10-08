"""Aller-retour dump, ecriture, restauration sur des fichiers des quatre formats.

`read_original_tags`, le dump d'un run et `restore_tags` ne sont pas encore cables au
protocole : ce script les enchaine comme le feront l'ecriture (sub-project 04) puis le
rollback (06). Usage, depuis la racine du depot, `LOCALAPPDATA` pointe vers le scratchpad :

    LOCALAPPDATA=<scratch>/appdata uv run --directory sidecar python <skill>/scripts/restore_probe.py <dossier>

Chaque fichier recoit des tags d'origine (deux artistes, date complete, BPM, URL, une frame
Serato hors table, un commentaire), puis : lecture d'origine, enregistrement dans le dump sous
`dump_dir()`, ecriture du candidat Beatport des fixtures avec pochette, chemin renomme consigne,
relecture du dump depuis le disque, restauration. Le disque est relu par `translate=False`
avant et apres : hors commentaires et images, que le dump ne garde pas, les frames doivent etre
identiques et la version ID3 la meme.
"""

import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import mutagen
from mutagen.flac import FLAC
from mutagen.id3 import COMM, TBPM, TDRC, TIT2, TPE1, TXXX, WOAS

HELPERS = Path(__file__).resolve().parents[4] / "sidecar" / "tests" / "helpers"
sys.path.insert(0, str(HELPERS))
from audio_samples import (  # noqa: E402
    write_blank_aiff,
    write_blank_flac,
    write_blank_mp3,
    write_blank_wav,
)
from scraper_responses import payload_candidate  # noqa: E402
from tagging_api import JPEG  # noqa: E402

from tagger.files import project_tags, read_original_tags, restore_tags, write_tags  # noqa: E402
from tagger.tag_dump import (  # noqa: E402
    DumpEntry,
    TagDump,
    dump_dir,
    dump_path,
    load_dump,
    record_renamed_path,
    save_entries,
)

CASES = {
    "mp3-v23": (write_blank_mp3, "mp3", 3),
    "mp3-v24": (write_blank_mp3, "mp3", 4),
    "wav": (write_blank_wav, "wav", 3),
    "aiff": (write_blank_aiff, "aiff", 3),
    "flac": (write_blank_flac, "flac", None),
}
# Ni commentaires ni images dans le dump : l'ecriture les retire, le rollback ne les rend pas.
NOT_RESTORED = ("APIC", "COMM", "COMMENT", "DESCRIPTION")


def emit(payload: dict[str, object]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")


def tag_origin(path: Path, id3_version: int | None) -> None:
    audio = mutagen.File(path)
    if isinstance(audio, FLAC):
        audio["ARTIST"] = ["adam beyer", "bart skils"]
        audio["TITLE"] = ["your mind"]
        audio["DATE"] = ["2019-06-16"]
        audio["BPM"] = ["130"]
        audio["SERATO_PLAYCOUNT"] = ["12"]
        audio["COMMENT"] = ["ripped by X"]
        audio.save()
        return
    audio.add_tags()
    tags = audio.tags
    tags.add(TPE1(encoding=3, text=["adam beyer", "bart skils"]))
    tags.add(TIT2(encoding=3, text=["your mind"]))
    tags.add(TDRC(encoding=3, text=["2019-06-16"]))
    tags.add(TBPM(encoding=3, text=["130"]))
    tags.add(WOAS(url="https://adambeyer.bandcamp.com/track/your-mind"))
    tags.add(TXXX(encoding=3, desc="SERATO_PLAYCOUNT", text=["12"]))
    tags.add(COMM(encoding=3, lang="eng", desc="", text=["ripped by X"]))
    if id3_version == 3:
        tags.update_to_v23()
    audio.save(v2_version=id3_version)


def read_disk(path: Path) -> dict[str, object]:
    audio = mutagen.File(path)
    if isinstance(audio, FLAC):
        return {
            "version": None,
            "tags": {k: v for k, v in audio.tags.as_dict().items() if k.upper() not in NOT_RESTORED},
        }
    on_disk = type(audio)(path, translate=False).tags
    return {
        "version": ".".join(map(str, on_disk.version)),
        "tags": {
            key: str(frame)
            for key, frame in on_disk.items()
            if not key.startswith(NOT_RESTORED)
        },
    }


def main() -> int:
    if len(sys.argv) != 2:
        emit({"error": True, "message": "usage : restore_probe.py <dossier>"})
        return 1
    folder = Path(sys.argv[1])
    folder.mkdir(parents=True, exist_ok=True)
    cover = folder / "cover.jpg"
    cover.write_bytes(JPEG)
    values = project_tags(payload_candidate())
    dump = TagDump(run_id="verify", created_at=datetime.now(UTC))
    dumps = dump_dir()

    paths = {}
    for name, (build, extension, id3_version) in CASES.items():
        paths[name] = build(folder / f"{name}.{extension}")
        tag_origin(paths[name], id3_version)
    before = {name: read_disk(path) for name, path in paths.items()}

    dump = save_entries(
        dumps, dump, {name: DumpEntry.of(path, read_original_tags(path)) for name, path in paths.items()}
    )
    for name, path in paths.items():
        write_tags(path, values, cover)
        dump = record_renamed_path(dumps, dump, name, path)
    written = {name: read_disk(path) for name, path in paths.items()}

    reloaded = load_dump(dump_path(dumps, dump))
    for name, entry in reloaded.entries.items():
        restore_tags(entry.renamed_path or entry.path, entry.original_tags())
    after = {name: read_disk(path) for name, path in paths.items()}

    results = {
        name: {
            "identical": before[name] == after[name],
            "version_before": before[name]["version"],
            "version_written": written[name]["version"],
            "version_after": after[name]["version"],
            "before": before[name]["tags"],
            "after": after[name]["tags"],
        }
        for name in paths
    }
    emit(
        {
            "success": True,
            "dump_file": str(dump_path(dumps, dump)),
            "entries": list(reloaded.entries),
            "results": results,
        }
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
