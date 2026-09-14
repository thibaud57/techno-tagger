"""Point d'entree du sidecar : boucle de commandes NDJSON sur les flux standard.

stdin porte les commandes, stdout les evenements. stderr reste aux logs et n'est
jamais melange au protocole.
"""

import asyncio
import io
import logging
import os
import sys
from pathlib import Path
from typing import TYPE_CHECKING, assert_never

from pydantic import ValidationError

from tagger import BUNDLE_IDENTIFIER, RELEASE
from tagger.build_info import SENTRY_DSN
from tagger.errors import TaggerError
from tagger.handlers import handle_extract_playlist, handle_get_version, handle_list_playlists
from tagger.logger import setup_logging
from tagger.observability import init_sentry
from tagger.protocol import (
    ExecutableCommand,
    ExtractPlaylist,
    GetVersion,
    ListPlaylists,
    Progress,
    Shutdown,
    emit,
    error_from_business,
    error_from_validation,
    parse_command,
)

if TYPE_CHECKING:
    from typing import TextIO

logger = logging.getLogger(__name__)


def log_dir() -> Path:
    """Ou `appLocalDataDir()` de Tauri resout sous Windows. Jamais le repertoire
    courant : pour une application installee, c'est celui d'ou l'utilisateur l'a
    lancee, donc n'importe ou sur son disque.
    """
    # Recalcule et non recu de Tauri : le logger est arme avant la premiere lecture
    # de stdin, donc avant qu'aucune commande NDJSON ait pu porter le chemin. Un
    # argument de spawn demanderait d'ouvrir `args` dans le scope shell, ou un
    # argument non conforme est retire en silence.
    base = os.getenv("LOCALAPPDATA")
    root = Path(base) if base else Path.home() / "AppData" / "Local"
    return root / BUNDLE_IDENTIFIER / "logs"


def _force_utf8_streams() -> None:
    """Sous Windows, stdin et stdout tombent en cp1252 des qu'ils sont des pipes,
    c'est-a-dire exactement comme Tauri lance le sidecar. Un titre cyrillique,
    japonais ou un emoji leverait alors UnicodeDecodeError ou UnicodeEncodeError
    en plein run. PEP 686 rend l'UTF-8 implicite en 3.15, pas en 3.14.

    `newline` est fixe dans la foulee : laisse a None, le wrapper traduit chaque
    `\\n` en `\\r\\n` sous Windows, et le lecteur de lignes de Tauri coupe sur le
    `\\r` seul des qu'un chunk de 8 Ko tombe avant le `\\n`.

    `line_buffering` sur la sortie : sans lui, un binaire PyInstaller lance par un
    pipe garde tout jusqu'a la fin du run, et `PYTHONUNBUFFERED` n'y peut rien
    (cf. ADR-005). Pose ici une fois, il dispense de flusher chaque evenement.
    """
    for stream in (sys.stdin, sys.stdout):
        # Un flux substitue (capture de test, redirection) n'est pas un
        # TextIOWrapper et n'a rien a reconfigurer : seul le cas reel compte ici.
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(
                encoding="utf-8",
                errors="strict",
                newline="\n",
                line_buffering=stream is sys.stdout,
            )


def main() -> None:
    _force_utf8_streams()

    # Avant tout traitement : un crash du parsing doit deja pouvoir remonter, et
    # `logger.exception` doit avoir un handler autre que celui de dernier recours.
    setup_logging(log_dir())
    init_sentry(SENTRY_DSN, RELEASE)
    # TODO: implement a l'etape 5, keyring.set_keyring(WinVaultKeyring()) avant tout
    # acces au secret : dans le binaire fige, la decouverte par entry points rend
    # une liste vide et keyring bascule sur son backend `fail`.

    asyncio.run(run_loop(sys.stdin, sys.stdout))


async def run_loop(stdin: TextIO, stdout: TextIO) -> None:
    """Lit les commandes ligne a ligne et emet les evenements produits.

    `stdin` est lu par `asyncio.to_thread` : sous Windows, `connect_read_pipe` sur
    stdin echoue en `OSError: [WinError 6]`, la lecture asynchrone native est donc
    hors jeu. La delegation en thread laisse la boucle libre, ce qui permet aux
    evenements `progress` de partir pendant qu'une commande bloquante est traitee.

    Une ligne rejetee a la validation ou une erreur metier produit un evenement
    `error` et la boucle continue : seuls `shutdown` et l'EOF l'arretent. Toute autre
    exception fait tomber le processus, volontairement : l'avaler cacherait un bug que
    Sentry remonte comme crash du sidecar (cf. PRODUCTION.md § Alertes).
    """
    while True:
        line = await asyncio.to_thread(stdin.readline)
        if not line:
            return

        stripped = line.strip()
        if not stripped:
            continue

        try:
            command = parse_command(stripped)
        except ValidationError as error:
            _write(stdout, emit(error_from_validation(error)))
            continue

        if isinstance(command, Shutdown):
            return
        # Mypy retire `Shutdown` de l'union a partir d'ici, ce dont `_dispatch` depend.

        try:
            await _dispatch(command, stdout)
        except TaggerError as error:
            logger.exception("command failed reason=%s", error.code)
            _write(stdout, emit(error_from_business(error)))


async def _dispatch(command: ExecutableCommand, stdout: TextIO) -> None:
    """Route une commande validee vers son handler.

    `Shutdown` est traite par la boucle et n'arrive jamais ici, ce que le type dit :
    le `match` couvre alors toutes les variantes et `assert_never` verrouille
    l'ajout d'une commande sans handler.

    Les handlers sont bloquants — SQLite, parcours du dossier source, copie de
    fichiers — et passent donc par `to_thread`, sans quoi la boucle gelerait.
    """
    match command:
        case GetVersion():
            _write(stdout, emit(handle_get_version()))
        case ListPlaylists():
            event = await asyncio.to_thread(handle_list_playlists, command)
            _write(stdout, emit(event))
        case ExtractPlaylist():

            def on_progress(progress: Progress) -> None:
                _write(stdout, emit(progress))

            finished = await asyncio.to_thread(handle_extract_playlist, command, on_progress)
            _write(stdout, emit(finished))
        case _:
            assert_never(command)


def _write(stdout: TextIO, line: str) -> None:
    """Une ligne, un evenement. Le `line_buffering` pose par `_force_utf8_streams`
    dispense de flusher ; un flux substitue en test n'en a pas besoin.
    """
    stdout.write(line + "\n")


if __name__ == "__main__":
    main()
