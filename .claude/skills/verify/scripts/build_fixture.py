"""Batit une fixture de test sous un dossier jetable, et rend son chemin en JSON.

Le script vit dans le skill, sa sortie dans le scratchpad : jamais un mp3 dans le depot,
jamais une vraie bibliotheque touchee. Usage, depuis la racine du depot :

    uv run --directory sidecar python <skill>/scripts/build_fixture.py <dossier> [option]

Sans option : trois morceaux dont deux que le faux serveur connait, un introuvable et un
fichier non audio. `--unique N` : N titres inedits, chacun payant son aller-retour vers
l'API, pour qu'un run dure assez longtemps qu'une commande concurrente parte pendant.
Un suffixe par appel les rend inedits d'une passe a l'autre, le cache de reponses etant
reel : relancer sur les memes titres rendrait un run instantane et un faux vert.
`--vlc-dump` : un dump `vlc_media.db`, playlists « test playlist » et « other playlist ».
La fixture complete de l'onglet Playlist, homonymes et echecs de transfert compris, est
celle de `just demo`.
"""

import json
import shutil
import sys
import uuid
from pathlib import Path


def emit(payload: dict[str, object]) -> None:
    """Le resultat sur stdout, en JSON, pour qu'un appelant le lise sans le parser a l'oeil."""
    sys.stdout.write(json.dumps(payload) + "\n")


def fail(message: str) -> None:
    emit({"error": True, "message": message})
    sys.exit(1)


# Depuis l'emplacement du script et non du repertoire courant : .claude/skills/verify/scripts.
HELPERS = Path(__file__).resolve().parents[4] / "sidecar" / "tests" / "helpers"
sys.path.insert(0, str(HELPERS))
try:
    from audio_samples import tag, write_blank_mp3
    from vlc_dump import build_dump
except ImportError as error:
    fail(f"{error} : les helpers de test sont attendus dans {HELPERS}")

args = sys.argv[1:]
if not args or args[0].startswith("--"):
    fail("usage : build_fixture.py <dossier> [--unique N | --vlc-dump]")

root = Path(args[0])
if root.exists():
    shutil.rmtree(root)
root.mkdir(parents=True)

if "--vlc-dump" in args:
    dump = root / "vlc_media.db"
    build_dump(dump)
    emit({"success": True, "folder": root.as_posix(), "dump": dump.as_posix()})
    sys.exit(0)

if "--unique" in args:
    try:
        count = int(args[args.index("--unique") + 1])
    except IndexError, ValueError:
        fail("--unique attend un nombre entier de morceaux apres lui")
    run = uuid.uuid4().hex[:6]
    tracks = [("Verify Probe", f"Untitled {run} {n:02d}") for n in range(1, count + 1)]
else:
    tracks = [
        ("Adam Beyer", "Your Mind"),
        ("Amelie Lens", "Basiel"),
        ("Nobody", "Nothing Here At All"),
    ]

for index, (artist, title) in enumerate(tracks, start=1):
    path = root / f"{index:02d} {artist.lower()} - {title.lower()}.mp3"
    write_blank_mp3(path)
    tag(path, artist=artist, title=title)
if "--unique" not in args:
    (root / "notes.txt").write_text("pas un fichier audio", encoding="utf-8")

emit({"success": True, "folder": root.as_posix(), "tracks": len(tracks)})
