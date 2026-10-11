"""Socle des sondes `/verify` : verdict JSON sur stdout et relecture du disque.

Les helpers de test (`audio_samples`, `scraper_responses`...) s'importent par `PYTHONPATH`,
posé sur la commande documentee dans SKILL.md : le cwd de `uv run --directory sidecar` est
`sidecar/`, d'ou le chemin `tests/helpers`.
"""

import json
import sys
from typing import TYPE_CHECKING, NoReturn

if TYPE_CHECKING:
    from pathlib import Path


def emit(payload: dict[str, object], *, indent: int | None = None) -> None:
    """Le verdict sur stdout, une ligne par defaut : un appelant le parse sans le lire a l'oeil."""
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, indent=indent, default=str) + "\n")


def fail(message: str) -> NoReturn:
    emit({"error": True, "message": message})
    sys.exit(1)


def read_disk(
    path: Path, *, ignore: tuple[str, ...] = (), pictures: bool = True
) -> dict[str, object]:
    """Tags tels qu'ecrits sur le disque : `translate=False`, pas la remontee en v2.4 de mutagen.

    `ignore` ecarte les cles qui commencent par l'un de ces prefixes (les images d'un ID3 sont
    toujours rendues a part), `pictures=False` omet leur releve.
    """
    # Importe ici : `drive.py` et `build_fixture.py` n'ont pas besoin de mutagen pour emettre.
    import mutagen  # noqa: PLC0415
    from mutagen.flac import FLAC  # noqa: PLC0415

    skipped = tuple(prefix.upper() for prefix in ignore)
    audio = mutagen.File(path)
    if isinstance(audio, FLAC):
        snapshot: dict[str, object] = {
            "version": None,
            "tags": {
                key: value
                for key, value in audio.tags.as_dict().items()
                if not key.upper().startswith(skipped)
            },
        }
        if pictures:
            snapshot["pictures"] = [(p.type, p.mime, len(p.data)) for p in audio.pictures]
        return snapshot

    on_disk = type(audio)(path, translate=False).tags
    snapshot = {
        "version": ".".join(map(str, on_disk.version)),
        "tags": {
            key: str(frame)
            for key, frame in on_disk.items()
            if not key.upper().startswith((*skipped, "APIC"))
        },
    }
    if pictures:
        snapshot["pictures"] = [(f.type, f.mime, len(f.data)) for f in on_disk.getall("APIC")]
    return snapshot
