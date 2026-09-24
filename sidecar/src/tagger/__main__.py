"""Point d'entree du sidecar : boucle de commandes NDJSON sur les flux standard.

stdin porte les commandes, stdout les evenements. stderr reste aux logs et n'est
jamais melange au protocole.
"""

import asyncio
import io
import logging
import sys
from typing import TYPE_CHECKING, ClassVar, assert_never

import keyring
from keyring.backends.Windows import WinVaultKeyring
from pydantic import ValidationError

from tagger import RELEASE
from tagger.build_info import SENTRY_DSN
from tagger.errors import TaggerError
from tagger.handlers import (
    handle_extract_playlist,
    handle_get_version,
    handle_list_playlists,
    handle_set_api_key,
    handle_start_tagging,
)
from tagger.logger import setup_logging
from tagger.observability import init_sentry
from tagger.paths import app_data_dir
from tagger.protocol import (
    Event,
    ExecutableCommand,
    ExtractPlaylist,
    GetVersion,
    ListPlaylists,
    SetApiKey,
    Shutdown,
    StartTagging,
    emit,
    error_from_business,
    error_from_validation,
    parse_command,
)

if TYPE_CHECKING:
    from collections.abc import Awaitable
    from pathlib import Path
    from typing import TextIO

logger = logging.getLogger(__name__)


def log_dir() -> Path:
    """Dossier des logs, sous la racine des donnees de l'application."""
    # Recalcule et non recu de Tauri : le logger est arme avant la premiere lecture
    # de stdin, donc avant qu'aucune commande NDJSON ait pu porter le chemin. Un
    # argument de spawn demanderait d'ouvrir `args` dans le scope shell, ou un
    # argument non conforme est retire en silence.
    return app_data_dir() / "logs"


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


class TaggingInProgressError(TaggerError):
    """Un run tourne deja : le lancer deux fois ecrirait deux fois les memes fichiers."""

    code: ClassVar[str] = "tagging_in_progress"

    def __init__(self) -> None:
        super().__init__("a tagging run is already in progress")


class ExtractionInProgressError(TaggerError):
    """Une extraction tourne deja : la relancer copierait deux fois vers la meme destination."""

    code: ClassVar[str] = "extraction_in_progress"

    def __init__(self) -> None:
        super().__init__("an extraction is already in progress")


class _Session:
    """Etat de la session : le run de re-tagging tourne pendant que stdin est lu.

    Seul ecrivain sur `stdout` : la boucle et la tache de fond passent toutes deux
    par `send`, ce qui garde une ligne par evenement sans verrou.
    """

    def __init__(self, group: asyncio.TaskGroup, stdout: TextIO) -> None:
        self._group = group
        self._stdout = stdout
        self._run: asyncio.Task[None] | None = None
        self._extraction: asyncio.Task[None] | None = None

    def start_tagging(self, command: StartTagging) -> None:
        """Lance le run en tache de fond : la boucle repart lire la commande suivante."""
        if self._active_run() is not None:
            raise TaggingInProgressError
        work = handle_start_tagging(command, self.send)
        self._run = self._group.create_task(self._phase(work, command), name="tagging")

    def start_extraction(self, command: ExtractPlaylist) -> None:
        """Meme traitement que le run : sans quoi la copie gelerait la lecture de stdin."""
        if self._active(self._extraction) is not None:
            raise ExtractionInProgressError
        work = asyncio.to_thread(handle_extract_playlist, command, self.send)
        self._extraction = self._group.create_task(self._phase(work, command), name="extraction")

    def cancel_run(self) -> None:
        """`shutdown` n'attend pas la fin d'un run, il l'annule.

        L'extraction est au contraire attendue : le run ne tient que du reseau et de
        la memoire, quand une copie coupee en vol laisserait un fichier a moitie ecrit
        dans la destination de l'utilisateur.
        """
        running = self._active_run()
        if running is not None:
            running.cancel()

    def send(self, event: Event) -> None:
        """Une ligne, un evenement. Le `line_buffering` pose par `_force_utf8_streams`
        dispense de flusher ; un flux substitue en test n'en a pas besoin.
        """
        self._stdout.write(emit(event) + "\n")

    def _active_run(self) -> asyncio.Task[None] | None:
        """Le run en cours, `None` s'il n'y en a pas ou s'il est deja termine."""
        return self._active(self._run)

    @staticmethod
    def _active(task: asyncio.Task[None] | None) -> asyncio.Task[None] | None:
        if task is None or task.done():
            return None
        return task

    async def _phase(self, work: Awaitable[Event], command: StartTagging | ExtractPlaylist) -> None:
        """Deroule une phase de fond : son evenement de fin, ou son erreur metier.

        Une phase echouee ne remonte pas au `TaskGroup`, qui annulerait la session
        entiere pour un dossier illisible.
        """
        try:
            finished = await work
        except TaggerError as error:
            logger.exception("background phase failed reason=%s", error.code)
            self.send(error_from_business(error, command.command))
            return
        self.send(finished)


def main() -> None:
    _force_utf8_streams()

    # Avant tout traitement : un crash du parsing doit deja pouvoir remonter, et
    # `logger.exception` doit avoir un handler autre que celui de dernier recours.
    setup_logging(log_dir())
    init_sentry(SENTRY_DSN, RELEASE)
    # Avant tout acces au secret : dans le binaire fige, la decouverte par entry
    # points rend une liste vide et keyring basculerait sur son backend `fail`.
    # `KeyringBackend.__init__` n'annote pas son retour (cf. memory_keyring.py).
    keyring.set_keyring(WinVaultKeyring())  # type: ignore[no-untyped-call]

    asyncio.run(run_loop(sys.stdin, sys.stdout))


async def run_loop(stdin: TextIO, stdout: TextIO) -> None:
    """Lit les commandes ligne a ligne et emet les evenements produits.

    `stdin` est lu par `asyncio.to_thread` : sous Windows, `connect_read_pipe` sur
    stdin echoue en `OSError: [WinError 6]`, la lecture asynchrone native est donc
    hors jeu. La delegation en thread laisse la boucle libre, ce qui permet aux
    evenements `progress` de partir pendant qu'une commande bloquante est traitee.

    Les deux phases longues, extraction et re-tagging, tournent en tache de fond dans
    le `TaskGroup` : la boucle lit les commandes suivantes pendant qu'elles avancent.
    `shutdown` annule le run mais attend l'extraction, une copie coupee en vol laissant
    un fichier a moitie ecrit ; l'EOF attend les deux.

    Une ligne rejetee a la validation ou une erreur metier produit un evenement
    `error` et la boucle continue : seuls `shutdown` et l'EOF l'arretent. Toute autre
    exception fait tomber le processus, volontairement : l'avaler cacherait un bug que
    Sentry remonte comme crash du sidecar (cf. PRODUCTION.md § Alertes).
    """
    async with asyncio.TaskGroup() as group:
        session = _Session(group, stdout)
        while True:
            line = await asyncio.to_thread(stdin.readline)
            if not line:
                # EOF : on sort du groupe, qui attend la fin d'un run en cours.
                return

            stripped = line.strip()
            if not stripped:
                continue

            try:
                command = parse_command(stripped)
            except ValidationError as error:
                session.send(error_from_validation(error))
                continue

            if isinstance(command, Shutdown):
                session.cancel_run()
                return
            # Mypy retire `Shutdown` de l'union a partir d'ici, ce dont `_dispatch` depend.

            try:
                await _dispatch(command, session)
            except TaggerError as error:
                logger.exception("command failed reason=%s", error.code)
                session.send(error_from_business(error, command.command))


async def _dispatch(command: ExecutableCommand, session: _Session) -> None:
    """Route une commande validee vers son handler.

    `Shutdown` est traite par la boucle et n'arrive jamais ici, ce que le type dit :
    le `match` couvre alors toutes les variantes et `assert_never` verrouille
    l'ajout d'une commande sans handler.

    Les handlers sont bloquants — SQLite, parcours du dossier source, copie de
    fichiers, trousseau Windows — et passent donc par `to_thread`, sans quoi la
    boucle gelerait. Les deux phases longues vont plus loin et partent en tache de
    fond, `to_thread` seul laissant la boucle attendre leur retour.
    """
    match command:
        case GetVersion():
            session.send(await asyncio.to_thread(handle_get_version))
        case SetApiKey():
            session.send(await asyncio.to_thread(handle_set_api_key, command))
        case ListPlaylists():
            session.send(await asyncio.to_thread(handle_list_playlists, command))
        case ExtractPlaylist():
            session.start_extraction(command)
        case StartTagging():
            session.start_tagging(command)
        case _:
            assert_never(command)


if __name__ == "__main__":
    main()
