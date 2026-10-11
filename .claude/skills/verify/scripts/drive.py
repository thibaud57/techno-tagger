"""Pilote la vraie boucle NDJSON contre le faux techno-scraper, ou une gateway locale, et
rend un verdict JSON.

Boucle, client httpx2 sur une vraie socket, caches disque, trousseau, lecture des tags et
sortie NDJSON sont ceux de production : seule l'URL de l'API est detournee, constante du
module qu'aucune variable d'environnement du sidecar ne redirige, et la cle face a une
gateway locale. Usage, depuis la racine du depot :

    PYTHONPATH=tests/helpers uv run --directory sidecar python <skill>/scripts/drive.py <commandes.ndjson> [sortie.ndjson]

Une ligne `{"wait": 1.5}` du fichier de commandes n'est pas envoyee : elle retarde la
suivante. `stdin` est un vrai pipe alimente au fil de l'eau, sans quoi toutes les
commandes arriveraient d'un bloc et une annulation tomberait avant `run_started`.
`"$run_id"` dans une commande prend, a son envoi, le `run_id` du dernier `run_started` : il
est tire au hasard par le sidecar, le fichier ne peut pas le connaitre. Une ligne
`{"lock": "<fichier>", "for": 4}` tient ce fichier comme un lecteur audio pendant 4 s, sans
retarder la suivante (Windows seulement).

Environnement : `LOCALAPPDATA` isole la racine des donnees (a purger entre deux runs, le
cache de reponses etant reel), `FAKE_DELAY` tient chaque requete en vol, `REJECT_ALL`
fait rendre 403 a tout. `GATEWAY_URL` et `GATEWAY_KEY` visent a la place une vraie
gateway lancee en local (techno-scraper, `API_KEYS__VERIFY=<cle> just dev`) : la cle de test
remplace celle du trousseau, qui ne part donc jamais vers un serveur de developpement.
`BINARY` pointe le binaire fige (`src-tauri/binaries/tagger-*.exe`) : il est lance a la place
de la boucle en process et alimente par le meme pipe. Son URL d'API est figee a la
compilation, il parle donc a la vraie API avec la cle du trousseau.
"""

import asyncio
import io
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import override

from _probe import emit, fail

commands_path, *output_path = sys.argv[1:] or [""]
if not commands_path:
    fail(
        "usage : PYTHONPATH=tests/helpers uv run --directory sidecar python drive.py "
        "<commandes.ndjson> [sortie.ndjson]"
    )

try:
    import fake_api
    from audio_samples import held_open

    from tagger import scraper_client
except ImportError as error:
    fail(f"{error} : lancer par `PYTHONPATH=tests/helpers uv run --directory sidecar`")

binary = os.getenv("BINARY")
gateway_url = os.getenv("GATEWAY_URL")
if binary and (gateway_url or not Path(binary).is_file()):
    fail("BINARY vise un exe existant, sans GATEWAY_URL : son URL d'API est figee a la compilation")
if gateway_url:
    gateway_key = os.getenv("GATEWAY_KEY")
    if not gateway_key:
        fail("GATEWAY_URL pose sans GATEWAY_KEY : la cle du trousseau ne doit pas partir en dev")
    scraper_client.API_BASE_URL = gateway_url
elif not binary:
    server = fake_api.serve()
    scraper_client.API_BASE_URL = f"http://127.0.0.1:{server.server_address[1]}"

# Apres la reaffectation : le module lit la constante a l'import.
from tagger import handlers  # noqa: E402
from tagger.__main__ import log_dir, run_loop  # noqa: E402

if gateway_url:

    def _gateway_key() -> str | None:
        return gateway_key

    # `handlers` importe `read_api_key` par son nom : c'est ce nom qu'il faut remplacer, sans
    # quoi la cle du trousseau partirait vers la gateway de developpement.
    handlers.read_api_key = _gateway_key
from tagger.logger import setup_logging  # noqa: E402

if not binary:
    setup_logging(log_dir())

script: list[tuple[float, str | dict[str, object]]] = []
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
    script.append((pending_delay, line if "lock" in line else raw))
    pending_delay = 0.0


class _Outbox(io.StringIO):
    """stdout qui retient le dernier `run_id` annonce, pour les commandes `"$run_id"`."""

    def __init__(self) -> None:
        super().__init__()
        self.run_id: str | None = None

    @override
    def write(self, text: str, /) -> int:
        for line in text.splitlines():
            if '"run_started"' in line:
                self.run_id = json.loads(line)["run_id"]
        return super().write(text)


def hold(path: Path, seconds: float) -> None:
    with held_open(path):
        time.sleep(seconds)


stdout = _Outbox()
started = time.monotonic()
sent: list[dict[str, object]] = []


def feed(pipe: io.BufferedWriter) -> None:
    with pipe:
        for delay, item in script:
            time.sleep(delay)
            at = round(time.monotonic() - started, 2)
            if isinstance(item, dict):
                held = (Path(str(item["lock"])), float(str(item["for"])))
                threading.Thread(target=hold, args=held, daemon=True).start()
                sent.append({"at": at, "lock": str(item["lock"])})
                continue
            line = item.replace('"$run_id"', json.dumps(stdout.run_id))
            pipe.write((line + "\n").encode())
            pipe.flush()
            sent.append({"at": at, "command": json.loads(line)["command"]})


if binary:
    # S603 : le binaire est celui du depot, designe par l'environnement du pilote.
    process = subprocess.Popen([binary], stdin=subprocess.PIPE, stdout=subprocess.PIPE)  # noqa: S603
    if process.stdin is None or process.stdout is None:
        fail("pipes du binaire indisponibles")
    threading.Thread(target=feed, args=(process.stdin,), daemon=True).start()
    for event_line in io.TextIOWrapper(process.stdout, encoding="utf-8", newline="\n"):
        stdout.write(event_line)
    process.wait()
else:
    read_fd, write_fd = os.pipe()
    threading.Thread(target=feed, args=(os.fdopen(write_fd, "wb"),), daemon=True).start()
    with io.TextIOWrapper(os.fdopen(read_fd, "rb"), encoding="utf-8") as stdin:
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
    },
    indent=2,
)
