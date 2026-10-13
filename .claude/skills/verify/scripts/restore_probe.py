"""Aller-retour dump, ecriture, restauration sur des fichiers des quatre formats.

Enchaine `read_original_tags`, le dump d'un run et `restore_tags` comme l'ecriture puis le
rollback, sans passer par le protocole. Usage, depuis la racine du depot, `LOCALAPPDATA`
pointe vers le scratchpad :

    LOCALAPPDATA=<scratch>/appdata PYTHONPATH=tests/helpers uv run --directory sidecar python <skill>/scripts/restore_probe.py <dossier>

Chaque fichier recoit des tags d'origine (deux artistes, date complete, BPM, URL, une frame
Serato hors table, un commentaire), puis : lecture d'origine, enregistrement dans le dump sous
`dump_dir()`, ecriture du candidat Beatport des fixtures avec pochette, chemin renomme consigne
au journal voisin, relecture du dump depuis le disque (journal fusionne), reecriture du dump en
fin de phase (journal supprime), restauration. Le disque est relu par `translate=False` avant et
apres : hors commentaires et images, que le dump ne garde pas, les frames doivent etre
identiques et la version ID3 la meme.
"""

import sys
from datetime import UTC, datetime
from pathlib import Path

import mutagen
from _probe import emit, read_disk
from audio_samples import write_blank_aiff, write_blank_flac, write_blank_mp3, write_blank_wav
from mutagen.flac import FLAC
from mutagen.id3 import COMM, TBPM, TDRC, TIT2, TPE1, TXXX, WOAS
from scraper_responses import payload_candidate
from tagging_api import JPEG

from tagger.tags.files import project_tags, read_original_tags, restore_tags, write_tags
from tagger.tags.tag_dump import (
    DumpEntry,
    TagDump,
    dump_dir,
    dump_path,
    journal_path,
    load_dump,
    record_renamed_path,
    rewrite_dump,
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


def snapshot(path: Path) -> dict[str, object]:
    return read_disk(path, ignore=NOT_RESTORED, pictures=False)


def renamed_count(dump: TagDump) -> int:
    return sum(entry.renamed_path is not None for entry in dump.entries.values())


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


def main() -> int:
    if len(sys.argv) != 2:
        emit({"error": True, "message": "usage : restore_probe.py <dossier>"})
        return 1
    folder = Path(sys.argv[1])
    folder.mkdir(parents=True, exist_ok=True)
    cover = folder / "cover.jpg"
    cover.write_bytes(JPEG)
    values = project_tags(payload_candidate())
    dump = TagDump(run_id="verify", created_at=datetime.now(UTC), folder=folder)
    dumps = dump_dir()

    paths = {}
    for name, (build, extension, id3_version) in CASES.items():
        paths[name] = build(folder / f"{name}.{extension}")
        tag_origin(paths[name], id3_version)
    before = {name: snapshot(path) for name, path in paths.items()}

    dump = save_entries(
        dumps, dump, {name: DumpEntry.of(path, read_original_tags(path)) for name, path in paths.items()}
    )
    for name, path in paths.items():
        write_tags(path, values, cover)
        dump = record_renamed_path(dumps, dump, name, path)
    written = {name: snapshot(path) for name, path in paths.items()}

    dump_file = dump_path(dumps, dump)
    journal = journal_path(dump_file)
    # Les notes sont au seul journal : le fichier du dump n'a encore aucun `renamed_path`.
    file_before_rewrite = TagDump.model_validate_json(dump_file.read_text(encoding="utf-8"))
    journal_before_rewrite = journal.is_file()
    merged = load_dump(dump_file)
    rewrite_dump(dumps, merged)
    journal_after_rewrite = journal.is_file()
    file_after_rewrite = TagDump.model_validate_json(dump_file.read_text(encoding="utf-8"))

    reloaded = load_dump(dump_file)
    for name, entry in reloaded.entries.items():
        restore_tags(entry.renamed_path or entry.path, entry.original_tags())
    after = {name: snapshot(path) for name, path in paths.items()}

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
            "dump_file": str(dump_file),
            "folder_kept": reloaded.folder == folder,
            "entries": list(reloaded.entries),
            "journal": {
                "before_rewrite": journal_before_rewrite,
                "after_rewrite": journal_after_rewrite,
                "renamed_in_dump_file_before_rewrite": renamed_count(file_before_rewrite),
                "renamed_merged_at_load": renamed_count(merged),
                "renamed_in_dump_file_after_rewrite": renamed_count(file_after_rewrite),
            },
            "results": results,
        }
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
