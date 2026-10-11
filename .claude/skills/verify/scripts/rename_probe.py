r"""Renommage de vrais fichiers hors protocole : noms, collisions, casse, chemins longs, verrou.

Appelle `rename_track` comme l'ecriture, sans passer par le protocole. Usage, depuis la racine
du depot, `<dossier>` dans le scratchpad :

    uv run --directory sidecar python <skill>/scripts/rename_probe.py <dossier>

Chaque cas bat son propre sous-dossier, vide au depart. Le disque est relu sous le nouveau nom, et
le cas du chemin long se joue sur un fichier dont l'ancien chemin depasse 259 caracteres : seul le
prefixe `\\?\` de l'appel systeme le renomme, la relecture passe par lui aussi.
"""

import json
import shutil
import sys
from pathlib import Path

HELPERS = Path(__file__).resolve().parents[4] / "sidecar" / "tests" / "helpers"
sys.path.insert(0, str(HELPERS))
from audio_samples import held_open  # noqa: E402

from tagger.paths import extended_path  # noqa: E402
from tagger.renaming import MAX_PATH_LENGTH, RenameError, rename_track  # noqa: E402

PREFIX = "\\?\\"
ARTIST = "Lior Vance"
TITLE = "Dim Orbit (Extended Mix)"
TARGET = "Lior Vance - Dim Orbit (Extended Mix).mp3"
LONG_TITLE = "Dim Orbit (Kaelen Mirandor Extended Remix)"


def emit(payload: dict[str, object]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")


def case_folder(root: Path, name: str, length: int | None = None) -> Path:
    """Sous-dossier vide ; `length` fixe la longueur de son chemin (place laissee au nom)."""
    folder = root / (name if length is None else "x" * (length - len(str(root)) - 1))
    if folder.exists():
        shutil.rmtree(extended_path(folder))
    extended_path(folder).mkdir(parents=True)
    return folder


def make(folder: Path, name: str, content: bytes = b"audio") -> Path:
    path = folder / name
    extended_path(path).write_bytes(content)
    return path


def names(folder: Path) -> list[str]:
    return sorted(entry.name for entry in extended_path(folder).iterdir())


def prefix_free(path: Path) -> bool:
    return not str(path).startswith(PREFIX)


def main() -> int:
    if len(sys.argv) != 2:
        emit({"error": True, "message": "usage : rename_probe.py <dossier>"})
        return 1
    root = Path(sys.argv[1]).resolve()
    root.mkdir(parents=True, exist_ok=True)
    results: dict[str, dict[str, object]] = {}

    folder = case_folder(root, "simple")
    renamed = rename_track(make(folder, "lior vance - dim orbit.MP3"), ARTIST, TITLE)
    results["simple"] = {
        "ok": names(folder) == [TARGET] and renamed.path == folder / TARGET and prefix_free(renamed.path),
        "names": names(folder),
    }

    folder = case_folder(root, "forbidden")
    first = rename_track(make(folder, "a.flac"), "QX/RT", "Down In Amber")
    second = rename_track(make(folder, "b.wav"), "Someone", "Mind: Body (Who? Remix)")
    results["forbidden"] = {
        "ok": [first.path.name, second.path.name]
        == ["QX-RT - Down In Amber.flac", "Someone - Mind - Body (Who Remix).wav"],
        "names": names(folder),
    }

    folder = case_folder(root, "collision")
    make(folder, TARGET, b"existing")
    second = rename_track(make(folder, "second.mp3"), ARTIST, TITLE)
    third = rename_track(make(folder, "third.mp3"), ARTIST, TITLE)
    results["collision"] = {
        "ok": second.path.name.endswith("(Extended Mix) (2).mp3")
        and third.path.name.endswith("(Extended Mix) (3).mp3")
        and (folder / TARGET).read_bytes() == b"existing",
        "names": names(folder),
    }

    folder = case_folder(root, "case")
    renamed = rename_track(make(folder, TARGET.lower()), ARTIST, TITLE)
    results["case_only"] = {"ok": names(folder) == [TARGET] and renamed.path.name == TARGET, "names": names(folder)}

    folder = case_folder(root, "no-artist")
    renamed = rename_track(make(folder, "rip_0042.wav"), None, "Mothlight")
    results["no_artist"] = {"ok": names(folder) == ["rip_0042.wav"] and renamed.path.name == "rip_0042.wav", "names": names(folder)}

    folder = case_folder(root, "truncated", length=MAX_PATH_LENGTH - 40 - 1)
    renamed = rename_track(make(folder, "track.mp3"), ARTIST, LONG_TITLE)
    results["truncated"] = {
        "ok": renamed.truncated
        and len(renamed.path.name) == 40
        and len(str(renamed.path)) <= MAX_PATH_LENGTH
        and extended_path(renamed.path).is_file(),
        "name": renamed.path.name,
        "path_length": len(str(renamed.path)),
    }

    folder = case_folder(root, "emoji", length=MAX_PATH_LENGTH - 24 - 1)
    renamed = rename_track(make(folder, "track.mp3"), ARTIST, "🔥" * 8)
    units = len(str(renamed.path).encode("utf-16-le")) // 2
    results["emoji"] = {
        "ok": renamed.truncated and units <= MAX_PATH_LENGTH and extended_path(renamed.path).is_file(),
        "path_units": units,
        "path_code_points": len(str(renamed.path)),
    }

    folder = case_folder(root, "deep", length=MAX_PATH_LENGTH - 30 - 1)
    old_name = "a very long original ripped file name that keeps the path past the limit.mp3"
    old = make(folder, old_name)
    renamed = rename_track(old, ARTIST, LONG_TITLE)
    results["path_over_259"] = {
        "ok": len(str(old)) > MAX_PATH_LENGTH
        and renamed.truncated
        and extended_path(renamed.path).is_file()
        and not extended_path(old).exists()
        and prefix_free(renamed.path),
        "old_path_length": len(str(old)),
        "new_path_length": len(str(renamed.path)),
        "name": renamed.path.name,
    }

    folder = case_folder(root, "locked")
    held = make(folder, "track.mp3")
    reason = None
    with held_open(held):
        try:
            rename_track(held, ARTIST, TITLE)
        except RenameError as error:
            reason = str(error.reason)
    results["locked"] = {"ok": reason == "file_locked" and names(folder) == ["track.mp3"], "reason": reason, "names": names(folder)}

    failed = [name for name, result in results.items() if not result["ok"]]
    emit({"success": not failed, "failed": failed, "results": results})
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
