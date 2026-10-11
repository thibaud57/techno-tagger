"""Phase d'ecriture d'un run sur de vrais fichiers, hors protocole.

Enchaine `RunWriter` comme les handlers `commit_run` et `retry_write`, sans passer par le
protocole. Usage, depuis la racine du depot, `LOCALAPPDATA` pointe vers le scratchpad :

    LOCALAPPDATA=<scratch>/appdata uv run --directory sidecar python <skill>/scripts/write_phase_probe.py <dossier>

Le dossier recoit cinq fichiers tagues « adam beyer / your mind » : deux resolus (MP3, FLAC), un
troisieme resolu tenu par un lecteur pendant l'ecriture, un non resolu et un en attente
d'arbitrage. Le run part de `open_run`, comme en production ; seuls les etats sont poses a la
main. `write()` sous le verrou, puis `retry()` une fois le verrou leve. Un espion sur
`write_tags` relit le dump du disque au premier fichier ecrit, sans rien changer a l'appel.
"""

import asyncio
import json
import logging
import sys
from datetime import UTC, datetime
from pathlib import Path

HELPERS = Path(__file__).resolve().parents[4] / "sidecar" / "tests" / "helpers"
sys.path.insert(0, str(HELPERS))
from audio_samples import held_open, tag, write_blank_flac, write_blank_mp3  # noqa: E402
from scraper_responses import payload_candidate  # noqa: E402
from tagging_api import JPEG  # noqa: E402

from tagger import files, writing  # noqa: E402
from tagger.files import TagField, read_original_tags  # noqa: E402
from tagger.scraper_client import Source  # noqa: E402
from tagger.tag_dump import TagDump, dump_dir, dump_path, load_dump  # noqa: E402
from tagger.tagging import FailureReason, Resolution, open_run  # noqa: E402

RESOLVED = ("01 adam beyer - your mind.mp3", "02 adam beyer - your mind.flac")
LOCKED = "03 adam beyer - your mind (copy).mp3"
UNRESOLVED = "04 nobody - nothing.mp3"
PENDING = "05 amelie lens - basielians.mp3"
BUILDERS = {".mp3": write_blank_mp3, ".flac": write_blank_flac}


def emit(payload: dict[str, object]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, default=str) + "\n")


def build(folder: Path) -> Path:
    for name in (*RESOLVED, LOCKED, UNRESOLVED, PENDING):
        path = BUILDERS[Path(name).suffix](folder / name)
        tag(path, artist=["adam beyer"], title=["your mind"])
    cover = folder.parent / "cover.jpg"
    cover.write_bytes(JPEG)
    return cover


def states(live: object) -> dict[str, dict[str, object]]:
    return {
        record.track_id: {
            "state": record.state,
            "failure_reason": record.failure_reason,
            "path": record.path.name,
            "written": None
            if record.written is None
            else {
                "fields": len(record.written.fields),
                "artwork": record.written.artwork,
                "truncated": record.written.truncated,
            },
        }
        for record in live.snapshot().tracks  # type: ignore[attr-defined]
    }


async def run(folder: Path) -> dict[str, object]:
    cover = build(folder)
    untouched = {name: (folder / name).read_bytes() for name in (UNRESOLVED, PENDING)}
    live = await open_run(folder, on_event=lambda _event: None)
    candidate = payload_candidate()
    for record in live.snapshot().tracks:
        if record.track_id in (*RESOLVED, LOCKED):
            live.update(record.resolved(Resolution.AUTO, Source.BEATPORT, candidate, None, cover))
        elif record.track_id == UNRESOLVED:
            live.update(record.unresolved(FailureReason.NO_RESULT))

    created = datetime.now(UTC)
    dumps = dump_dir()
    dump_file = dump_path(dumps, TagDump(run_id=live.run_id, created_at=created))
    at_first_write: list[list[str]] = []
    written_paths: list[str] = []
    real_write = files.write_tags

    def spying_write(path: Path, *args: object) -> object:
        if not at_first_write:
            at_first_write.append(sorted(load_dump(dump_file).entries))
        written_paths.append(path.name)
        return real_write(path, *args)  # type: ignore[arg-type]

    writing.write_tags = spying_write  # type: ignore[assignment]
    events: list[str] = []
    writer = writing.RunWriter(
        live, dumps, lambda event: events.append(type(event).__name__), now=lambda: created
    )

    with held_open(folder / LOCKED):
        first = await writer.write()
    after_write = states(live)
    names_after_write = sorted(path.name for path in folder.iterdir())
    events_write, paths_write = list(events), list(written_paths)
    events.clear()
    written_paths.clear()

    second = await writer.retry()
    dump = load_dump(dump_file)
    return {
        "write": {
            "summary": first,
            "tracks": after_write,
            "files": names_after_write,
            "events": events_write,
            "written_files": paths_write,
            "dump_at_first_write": at_first_write[0] if at_first_write else None,
        },
        "retry": {
            "summary": second,
            "tracks": states(live),
            "files": sorted(path.name for path in folder.iterdir()),
            "events": list(events),
            "written_files": list(written_paths),
        },
        "untouched_identical": {
            name: (folder / name).read_bytes() == content for name, content in untouched.items()
        },
        "dump": {
            "file": dump_file.name,
            "entries": {
                track_id: {
                    "origin_title": entry.fields.get(TagField.TITLE),
                    "renamed_path": None if entry.renamed_path is None else entry.renamed_path.name,
                }
                for track_id, entry in dump.entries.items()
            },
        },
        "titles_on_disk": {
            path.name: read_original_tags(path).fields.get(TagField.TITLE)
            for path in sorted(folder.iterdir())
        },
    }


def main() -> int:
    if len(sys.argv) != 2:
        emit({"error": True, "message": "usage : write_phase_probe.py <dossier>"})
        return 1
    folder = Path(sys.argv[1])
    folder.mkdir(parents=True, exist_ok=True)
    if any(folder.iterdir()):
        emit({"error": True, "message": f"dossier non vide, en choisir un neuf : {folder}"})
        return 1
    logging.basicConfig(level=logging.INFO, stream=sys.stderr, format="%(levelname)s %(message)s")
    emit({"success": True, **asyncio.run(run(folder))})
    return 0


if __name__ == "__main__":
    sys.exit(main())
