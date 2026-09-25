"""Pilote la vraie boucle NDJSON contre le faux techno-scraper et rend un verdict JSON.

Boucle, client httpx2 sur une vraie socket, caches disque, trousseau, lecture des tags et
sortie NDJSON sont ceux de production : seule l'URL de l'API est detournee, constante du
module qu'aucune variable d'environnement ne redirige. Usage, depuis la racine du depot :

    uv run --directory sidecar python <skill>/scripts/drive.py <commandes.ndjson> [sortie.ndjson]

Une ligne `{"wait": 1.5}` du fichier de commandes n'est pas envoyee : elle retarde la
suivante. `stdin` est un vrai pipe alimente au fil de l'eau, sans quoi toutes les
commandes arriveraient d'un bloc et une annulation tomberait avant `run_started`.

Environnement : `LOCALAPPDATA` isole la racine des donnees (a purger entre deux runs, le
cache de reponses etant reel), `FAKE_DELAY` tient chaque requete en vol, `REJECT_ALL`
fait rendre 403 a tout.
"""

import asyncio
import io
import json
import os
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))


def emit(payload: dict[str, object]) -> None:
    """Le verdict sur stdout, comme le sidecar y ecrit ses evenements."""
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def fail(message: str) -> None:
    emit({"error": True, "message": message})
    sys.exit(1)


commands_path, *output_path = sys.argv[1:] or [""]
if not commands_path:
    fail("usage : uv run --directory sidecar python drive.py <commandes.ndjson> [sortie.ndjson]")

try:
    import fake_api

    from tagger import scraper_client
except ImportError as error:
    fail(f"{error} : lancer par `uv run --directory sidecar`, le paquet tagger en depend")

server = fake_api.serve()
scraper_client.API_BASE_URL = f"http://127.0.0.1:{server.server_address[1]}"

# Apres la reaffectation : le module lit la constante a l'import.
from tagger.__main__ import log_dir, run_loop  # noqa: E402
from tagger.logger import setup_logging  # noqa: E402

setup_logging(log_dir())

script: list[tuple[float, str]] = []
pending_delay = 0.0
try:
    source = Path(commands_path).read_text(encoding="utf-8")
except OSError as error:
    fail(f"fichier de commandes illisible : {error}")
for raw in source.splitlines():
    if not raw.strip():
        continue
    try:
        line = json.loads(raw)
    except json.JSONDecodeError as error:
        fail(f"commande invalide dans le fichier : {error} -> {raw[:120]}")
    if "wait" in line:
        pending_delay += float(line["wait"])
        continue
    script.append((pending_delay, raw))
    pending_delay = 0.0

read_fd, write_fd = os.pipe()
stdin = io.TextIOWrapper(os.fdopen(read_fd, "rb"), encoding="utf-8")
started = time.monotonic()
sent: list[dict[str, object]] = []


def feed() -> None:
    with os.fdopen(write_fd, "wb") as pipe:
        for delay, line in script:
            time.sleep(delay)
            pipe.write((line + "\n").encode())
            pipe.flush()
            at = round(time.monotonic() - started, 2)
            sent.append({"at": at, "command": json.loads(line)["command"]})


threading.Thread(target=feed, daemon=True).start()
stdout = io.StringIO()
with stdin:
    asyncio.run(run_loop(stdin, stdout))

raw_output = stdout.getvalue()
if output_path:
    Path(output_path[0]).write_text(raw_output, encoding="utf-8")

events = []
for line in raw_output.splitlines():
    if not line:
        continue
    try:
        # Chaque ligne doit se parser seule : une indentation casserait le protocole.
        events.append(json.loads(line))
    except json.JSONDecodeError:
        fail(f"ligne NDJSON invalide sur stdout : {line[:120]}")

kinds = [event["event"] for event in events]
emit(
    {
        "success": True,
        "elapsed": round(time.monotonic() - started, 2),
        "sent": sent,
        "events": [
            {key: event[key] for key in ("event", "code", "command", "run_id") if key in event}
            for event in events
        ],
        "counts": {kind: kinds.count(kind) for kind in ("run_started", "run_finished", "error")},
    }
)
