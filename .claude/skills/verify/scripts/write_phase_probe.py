"""Phase d'ecriture d'un run sur de vrais fichiers, hors protocole.

Enchaine `RunWriter` comme les handlers `commit_run` et `retry_write`, sans passer par le
protocole. Usage, depuis la racine du depot, `LOCALAPPDATA` pointe vers le scratchpad :

    LOCALAPPDATA=<scratch>/appdata PYTHONPATH=tests/helpers uv run --directory sidecar python <skill>/scripts/write_phase_probe.py <dossier>

Le dossier recoit cinq fichiers tagues « lior vance / dim orbit » : deux resolus (MP3, FLAC), un
troisieme resolu tenu par un lecteur pendant l'ecriture, un non resolu et un en attente
d'arbitrage. Le run part de `open_run`, comme en production ; seuls les etats sont poses a la
main. `write()` sous le verrou, puis `retry()` une fois le verrou leve. `write()` et `retry()` ne
rendent rien : le bilan se compte sur les etats des morceaux que la phase a regles (leurs
`TrackResolved`). Deux espions ne changent rien a l'appel : l'un sur `write_tags` relit le dump
au premier fichier ecrit, l'autre sur `RenamePlan.apply` relit le journal des renommages juste
avant que le premier fichier ne bouge.
"""

import asyncio
import json
import logging
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

from _probe import emit
from audio_samples import held_open, tag, write_blank_flac, write_blank_mp3
from scraper_responses import payload_candidate
from tagging_api import JPEG

from tagger import files, renaming, writing
from tagger.files import TagField, read_original_tags
from tagger.scraper_client import Source
from tagger.tag_dump import TagDump, dump_dir, dump_path, journal_path, load_dump
from tagger.tagging import (
    FailureReason,
    Resolution,
    TrackRecord,
    TrackResolved,
    TrackState,
    open_run,
)

RESOLVED = ("01 lior vance - dim orbit.mp3", "02 lior vance - dim orbit.flac")
LOCKED = "03 lior vance - dim orbit (copy).mp3"
UNRESOLVED = "04 nobody - nothing.mp3"
PENDING = "05 orla quenby - kelvorians.mp3"
BUILDERS = {".mp3": write_blank_mp3, ".flac": write_blank_flac}


def build(folder: Path) -> Path:
    for name in (*RESOLVED, LOCKED, UNRESOLVED, PENDING):
        path = BUILDERS[Path(name).suffix](folder / name)
        tag(path, artist=["lior vance"], title=["dim orbit"])
    cover = folder.parent / "cover.jpg"
    cover.write_bytes(JPEG)
    return cover


def states(live: object) -> dict[str, dict[str, object]]:
    return {
        record.track_id: {
            "state": record.state,
            "failure_reason": record.failure_reason,
            "restorable": record.restorable,
            "path": record.path.name,
            "written": None
            if record.written is None
            else {
                "fields": len(record.written.written.fields),
                "artwork": record.written.written.artwork,
                "truncated": record.written.truncated,
            },
        }
        for record in live.snapshot().tracks  # type: ignore[attr-defined]
    }


def summary(settled: list[TrackRecord]) -> dict[str, int]:
    """Ce que `WriteSummary` comptait : les morceaux regles par la phase, ecrits ou en echec."""
    counts = Counter(record.state for record in settled)
    return {"written": counts[TrackState.WRITTEN], "failed": counts[TrackState.WRITE_ERROR]}


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
    dump_file = dump_path(dumps, TagDump(run_id=live.run_id, created_at=created, folder=folder))
    journal = journal_path(dump_file)
    at_first_write: dict[str, object] = {}
    at_first_rename: dict[str, object] = {}
    written_paths: list[str] = []
    real_write = files.write_tags
    real_apply = renaming.RenamePlan.apply

    def spying_write(path: Path, *args: object) -> object:
        if not at_first_write:
            dump = load_dump(dump_file)
            at_first_write.update(
                entries=sorted(dump.entries),
                journal_present=journal.is_file(),
                originals_titles=sorted(
                    {entry.fields[TagField.TITLE][0] for entry in dump.entries.values()}
                ),
            )
        written_paths.append(path.name)
        return real_write(path, *args)  # type: ignore[arg-type]

    def spying_apply(plan: renaming.RenamePlan) -> renaming.RenamedTrack:
        if not at_first_rename:
            notes = [json.loads(line) for line in journal.read_text(encoding="utf-8").splitlines()]
            at_first_rename.update(
                source=plan.path.name,
                target=plan.target.name,
                noted_before_the_move=any(
                    Path(note["renamed_path"]) == plan.target for note in notes
                ),
                source_still_there=plan.path.exists(),
                target_exists=plan.target.exists(),
                journal_notes=len(notes),
            )
        return real_apply(plan)

    writing.write_tags = spying_write  # type: ignore[assignment]
    renaming.RenamePlan.apply = spying_apply  # type: ignore[method-assign]
    events: list[str] = []
    settled: list[TrackRecord] = []

    def on_event(event: writing.WriteEvent) -> None:
        events.append(type(event).__name__)
        if isinstance(event, TrackResolved):
            settled.append(event.record)

    writer = writing.RunWriter(live, dumps, on_event, now=lambda: created)

    with held_open(folder / LOCKED):
        await writer.write()
    write_summary = summary(settled)
    after_write = states(live)
    names_after_write = sorted(path.name for path in folder.iterdir())
    events_write, paths_write = list(events), list(written_paths)
    journal_after_write = journal.is_file()
    events.clear()
    settled.clear()
    written_paths.clear()

    await writer.retry()
    dump = load_dump(dump_file)
    return {
        "write": {
            "summary": write_summary,
            "tracks": after_write,
            "files": names_after_write,
            "events": events_write,
            "written_files": paths_write,
            "dump_at_first_write": at_first_write or None,
            "journal_at_first_rename": at_first_rename or None,
            "journal_left_after_phase": journal_after_write,
        },
        "retry": {
            "summary": summary(settled),
            "tracks": states(live),
            "files": sorted(path.name for path in folder.iterdir()),
            "events": list(events),
            "written_files": list(written_paths),
            "journal_left_after_phase": journal.is_file(),
        },
        "untouched_identical": {
            name: (folder / name).read_bytes() == content for name, content in untouched.items()
        },
        "dump": {
            "file": dump_file.name,
            "folder_kept": dump.folder == folder,
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
