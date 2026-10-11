"""Point d'entree du sidecar : boucle de commandes NDJSON sur les flux standard.

stdin porte les commandes, stdout les evenements. stderr reste aux logs et n'est
jamais melange au protocole.
"""

import asyncio
import functools
import io
import logging
import sys
from datetime import UTC, datetime
from typing import TYPE_CHECKING, ClassVar, assert_never

import keyring
from keyring.backends.Windows import WinVaultKeyring
from pydantic import ValidationError

from tagger import RELEASE
from tagger.arbitration import ArbitrationNotPendingError
from tagger.build_info import SENTRY_DSN
from tagger.errors import TaggerError
from tagger.handlers import (
    commit,
    handle_commit_run,
    handle_extract_playlist,
    handle_get_rollback_target,
    handle_get_version,
    handle_list_playlists,
    handle_retry_write,
    handle_rollback,
    handle_set_api_key,
    handle_start_tagging,
    url_progress,
)
from tagger.logger import setup_logging
from tagger.observability import init_sentry
from tagger.paths import app_data_dir
from tagger.protocol import (
    CancelRun,
    CommitRun,
    Event,
    ExecutableCommand,
    ExtractPlaylist,
    GetRollbackTarget,
    GetVersion,
    ListPlaylists,
    ResolveArbitration,
    ResolveByUrl,
    RetryWrite,
    Rollback,
    SetApiKey,
    Shutdown,
    StartTagging,
    SwitchArbitrationSource,
    emit,
    error_from_business,
    error_from_validation,
    parse_command,
)
from tagger.tag_dump import dump_dir, purge_dumps
from tagger.url_recovery import UrlRecoveryNotOpenError

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable
    from pathlib import Path
    from typing import TextIO

    from tagger.handlers import CurrentRun

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
    (cf. ADR-005).
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
    """Un run cherche encore : aucune autre phase longue ne demarre avant sa fin."""

    code: ClassVar[str] = "tagging_in_progress"

    def __init__(self) -> None:
        super().__init__("a tagging run is already in progress")


class ExtractionInProgressError(TaggerError):
    """Une extraction copie encore : aucune autre phase longue ne demarre avant sa fin."""

    code: ClassVar[str] = "extraction_in_progress"

    def __init__(self) -> None:
        super().__init__("an extraction is already in progress")


class WriteNotOpenError(TaggerError):
    """Run inconnu ou remplace, phase reseau en cours, deja confirme pour `commit_run` ou
    jamais confirme pour `retry_write`."""

    code: ClassVar[str] = "write_not_open"

    def __init__(self) -> None:
        super().__init__("the run is not open to writing")


class WriteInProgressError(TaggerError):
    """Ecriture en cours : aucune autre phase longue ne demarre avant sa fin."""

    code: ClassVar[str] = "write_in_progress"

    def __init__(self) -> None:
        super().__init__("a write is already in progress")


class RunCommittedError(TaggerError):
    """Run confirme : plus aucune decision n'entre sur ses morceaux, point de non-retour."""

    code: ClassVar[str] = "run_committed"

    def __init__(self, track_id: str) -> None:
        super().__init__("the run is committed", track_id=track_id)


class RollbackInProgressError(TaggerError):
    """Un rollback tourne : extraction, ecriture, run ou rollback toucheraient ses fichiers."""

    code: ClassVar[str] = "rollback_in_progress"

    def __init__(self) -> None:
        super().__init__("a rollback is already in progress")


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
        self._write: asyncio.Task[None] | None = None
        self._rollback: asyncio.Task[None] | None = None
        self._current: CurrentRun | None = None

    def start_tagging(self, command: StartTagging) -> None:
        """Lance le run en tache de fond ; il cesse aussitot d'etre le run courant."""
        self._ensure_no_long_phase()
        replaced, self._current = self._current, None
        start_work = functools.partial(self._replace, replaced, command)
        self._run = self._group.create_task(self._phase(start_work, command), name="tagging")

    def start_extraction(self, command: ExtractPlaylist) -> None:
        """Meme traitement que le run : sans quoi la copie gelerait la lecture de stdin."""
        self._ensure_no_long_phase()
        start_work = functools.partial(
            asyncio.to_thread, handle_extract_playlist, command, self.send
        )
        self._extraction = self._group.create_task(
            self._phase(start_work, command), name="extraction"
        )

    async def cancel_run(self) -> None:
        """N'annule que la phase reseau, qui ne tient que du reseau et de la memoire.

        Une copie, une ecriture ou une restauration coupee en vol laisserait un fichier a
        moitie ecrit chez l'utilisateur.

        Une phase reseau interrompue ouvre le rattrapage : sa progression part, sans
        evenement de fin, l'interface sachant qu'elle a demande l'arret.
        """
        interrupted = self._active_run() is not None
        await self._settle_run(cancel=True)
        if interrupted and self._current is not None:
            self.send(url_progress(self._current))

    def resolve_arbitration(self, command: ResolveArbitration) -> None:
        """Choix ou refus en tache de fond : un appel Bandcamp ne gele pas stdin."""
        current = self._arbitrable(command.track_id)
        start_gesture: Callable[[], Awaitable[None]]
        if command.candidate is None:
            start_gesture = functools.partial(
                current.arbitration.refuse, command.track_id, command.source
            )
        else:
            start_gesture = functools.partial(
                current.arbitration.choose, command.track_id, command.source, command.candidate
            )
        settle = functools.partial(self._then_url_progress, current, start_gesture)
        self._spawn_gesture(current, settle, command, name="arbitration")

    def switch_arbitration_source(self, command: SwitchArbitrationSource) -> None:
        """Sans I/O : s'execute dans la boucle."""
        current = self._arbitrable(command.track_id)
        current.arbitration.show(command.track_id, command.source)

    def resolve_by_url(self, command: ResolveByUrl) -> None:
        """Geste en tache de fond, comme l'arbitrage : l'appel a l'API ne gele pas stdin."""
        current = self._recoverable(command.track_id)
        start_gesture = functools.partial(
            current.url_recovery.resolve, command.track_id, command.url
        )
        self._spawn_gesture(current, start_gesture, command, name="url_recovery")

    def commit_run(self, command: CommitRun) -> None:
        current = self._writable(command.run_id)
        if current.committed:
            raise WriteNotOpenError
        writer = commit(current, self.send)
        self._spawn_write(functools.partial(handle_commit_run, current, writer), command)

    def retry_write(self, command: RetryWrite) -> None:
        current = self._writable(command.run_id)
        if current.writer is None:
            raise WriteNotOpenError
        self._spawn_write(functools.partial(handle_retry_write, current, current.writer), command)

    def rollback(self, command: Rollback) -> None:
        """Rollback en tache de fond, seul sur les fichiers.

        Le run affiche ne suit que si c'est lui qu'on restaure : un ancien run du meme dossier
        porte les memes `track_id`.
        """
        self._ensure_no_long_phase()
        current = self._current
        live = (
            current.live if current is not None and current.live.run_id == command.run_id else None
        )
        start_work = functools.partial(handle_rollback, command, live, self.send)
        self._rollback = self._group.create_task(
            self._phase(start_work, command, command.track_id), name="rollback"
        )

    async def close(self, *, cancel: bool) -> None:
        """`shutdown` annule la phase reseau, l'EOF l'attend ; le run courant se ferme ensuite.

        Extraction, ecriture et rollback ne sont jamais annules, le `TaskGroup` de la boucle
        les attend (cf. `cancel_run`).
        """
        await self._settle_run(cancel=cancel)
        current, self._current = self._current, None
        if current is not None:
            await current.close()

    def _spawn_gesture(
        self,
        current: CurrentRun,
        start_gesture: Callable[[], Awaitable[Event | None]],
        command: ResolveArbitration | ResolveByUrl,
        *,
        name: str,
    ) -> None:
        """Le morceau du geste suit son erreur : celles du client ne le portent pas."""
        task = self._phase(start_gesture, command, command.track_id)
        current.track(self._group.create_task(task, name=name))

    def _spawn_write(
        self, start_work: Callable[[], Awaitable[Event]], command: CommitRun | RetryWrite
    ) -> None:
        """Ecriture en tache de fond, comme l'extraction : stdin reste lu pendant sa progression."""
        self._write = self._group.create_task(self._phase(start_work, command), name="write")

    def _arbitrable(self, track_id: str) -> CurrentRun:
        if self._current is None:
            raise ArbitrationNotPendingError(track_id)
        if self._current.committed:
            raise RunCommittedError(track_id)
        return self._current

    def _recoverable(self, track_id: str) -> CurrentRun:
        """Phase ouverte : un run courant dont la phase reseau ne tourne plus, finie ou
        interrompue (un run interrompu garde son ecriture, donc son rattrapage)."""
        if self._current is None or self._active_run() is not None:
            raise UrlRecoveryNotOpenError(track_id)
        if self._current.committed:
            raise RunCommittedError(track_id)
        return self._current

    def _ensure_no_long_phase(self) -> None:
        """Une seule phase longue a la fois, refusee par le code de celle qui tourne.

        Extraction, ecriture et rollback touchent aux fichiers de l'utilisateur, la recherche
        reseau lit ceux qu'elle va faire ecrire : deux phases melees pourraient viser le meme
        dossier.
        """
        self._ensure_no_files_phase()
        if self._active_run() is not None:
            raise TaggingInProgressError

    def _ensure_no_files_phase(self) -> None:
        """Les phases qui touchent aux fichiers ; `_writable` traite la phase reseau a part."""
        if self._active(self._rollback) is not None:
            raise RollbackInProgressError
        if self._active(self._extraction) is not None:
            raise ExtractionInProgressError
        if self._active(self._write) is not None:
            raise WriteInProgressError

    def _writable(self, run_id: str) -> CurrentRun:
        """Run courant designe, sans phase longue ni geste en vol.

        Un geste qui finirait pendant l'ecriture ecraserait un morceau ecrit. Une phase reseau
        en cours rend `write_not_open`, le run n'etant pas encore ouvert a l'ecriture.
        """
        self._ensure_no_files_phase()
        current = self._current
        if (
            current is None
            or current.live.run_id != run_id
            or current.busy
            or self._active_run() is not None
        ):
            raise WriteNotOpenError
        return current

    async def _replace(self, replaced: CurrentRun | None, command: StartTagging) -> None:
        if replaced is not None:
            await replaced.close()
        await handle_start_tagging(command, self.send, self._adopt)

    async def _then_url_progress(
        self, current: CurrentRun, gesture: Callable[[], Awaitable[None]]
    ) -> Event | None:
        """Hors phase reseau, un refus d'arbitrage grossit le total du rattrapage : sa
        progression suit le geste, calculee plutot que comparee a l'emission precedente."""
        await gesture()
        if self._active_run() is not None:
            return None
        return url_progress(current)

    def _adopt(self, current: CurrentRun) -> None:
        self._current = current

    async def _settle_run(self, *, cancel: bool) -> None:
        """Attend la fin de la phase reseau en cours, apres l'avoir annulee si `cancel`."""
        running = self._active_run()
        if running is None:
            return
        if cancel:
            running.cancel()
        # Attendu ici (`wait` ne releve pas l'annulation) : une relance trop tot serait
        # refusee en `tagging_in_progress`.
        await asyncio.wait({running})

    def send(self, event: Event) -> None:
        """Une ligne par evenement ; `line_buffering` (cf. `_force_utf8_streams`) evite le flush."""
        self._stdout.write(emit(event) + "\n")

    def _active_run(self) -> asyncio.Task[None] | None:
        """Le run en cours, `None` s'il n'y en a pas ou s'il est deja termine."""
        return self._active(self._run)

    @staticmethod
    def _active(task: asyncio.Task[None] | None) -> asyncio.Task[None] | None:
        if task is None or task.done():
            return None
        return task

    async def _phase(
        self,
        start_work: Callable[[], Awaitable[Event | None]],
        command: (
            StartTagging
            | ExtractPlaylist
            | ResolveArbitration
            | ResolveByUrl
            | CommitRun
            | RetryWrite
            | Rollback
        ),
        track_id: str | None = None,
    ) -> None:
        """Une tache echouee ne remonte pas au `TaskGroup`, qui annulerait toute la session."""
        # Factory : une coroutine creee d'avance ne serait jamais attendue si annulee avant.
        try:
            finished = await start_work()
        except TaggerError as error:
            logger.exception("background phase failed reason=%s", error.code)
            self.send(error_from_business(error, command.command, track_id))
            return
        if finished is not None:
            self.send(finished)


def main() -> None:
    _force_utf8_streams()

    # Avant tout traitement : un crash du parsing doit deja pouvoir remonter, et
    # `logger.exception` doit avoir un handler autre que celui de dernier recours.
    setup_logging(log_dir())
    init_sentry(SENTRY_DSN, RELEASE)
    _purge_old_dumps()
    # Avant tout acces au secret : dans le binaire fige, la decouverte par entry
    # points rend une liste vide et keyring basculerait sur son backend `fail`.
    # `KeyringBackend.__init__` n'annote pas son retour (cf. memory_keyring.py).
    keyring.set_keyring(WinVaultKeyring())  # type: ignore[no-untyped-call]

    asyncio.run(run_loop(sys.stdin, sys.stdout))


def _purge_old_dumps() -> None:
    # Une purge ratee ne doit jamais empecher le sidecar de demarrer : le dump reste
    # au pire quelques jours de plus.
    try:
        purge_dumps(dump_dir(), datetime.now(UTC))
    except OSError:
        logger.exception("tag dump purge failed")


async def run_loop(stdin: TextIO, stdout: TextIO) -> None:
    """Lit les commandes ligne a ligne et emet les evenements produits.

    `stdin` est lu par `asyncio.to_thread` : sous Windows, `connect_read_pipe` sur
    stdin echoue en `OSError: [WinError 6]`, la lecture asynchrone native est donc
    hors jeu. La delegation en thread laisse la boucle libre, ce qui permet aux
    evenements `progress` de partir pendant qu'une commande bloquante est traitee.

    Les phases longues (extraction, re-tagging, ecriture, rollback) tournent en
    tache de fond dans le `TaskGroup` : la boucle lit les commandes suivantes pendant
    qu'elles avancent. `shutdown` n'annule que la phase reseau (cf. `_Session.close`),
    l'EOF les attend toutes.

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
                await session.close(cancel=False)
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
                await session.close(cancel=True)
                return
            # Mypy retire `Shutdown` de l'union a partir d'ici, ce dont `_dispatch` depend.

            try:
                await _dispatch(command, session)
            except TaggerError as error:
                logger.exception("command failed reason=%s", error.code)
                session.send(error_from_business(error, command.command))


# PLR0912 : une branche par commande, le `match` ferme par `assert_never` etant ce qui
# rend un oubli visible au typage.
async def _dispatch(command: ExecutableCommand, session: _Session) -> None:  # noqa: PLR0912
    """Route une commande validee vers son handler.

    `Shutdown` est traite par la boucle et n'arrive jamais ici, ce que le type dit :
    le `match` couvre alors toutes les variantes et `assert_never` verrouille
    l'ajout d'une commande sans handler.

    Les handlers sont bloquants (SQLite, parcours du dossier source, copie de
    fichiers, trousseau Windows) et passent donc par `to_thread`, sans quoi la
    boucle gelerait. Les phases longues partent en tache de fond, `to_thread`
    seul laissant la boucle attendre leur retour.
    """
    match command:
        case GetVersion():
            session.send(await asyncio.to_thread(handle_get_version))
        case SetApiKey():
            session.send(await asyncio.to_thread(handle_set_api_key, command))
        case ListPlaylists():
            session.send(await asyncio.to_thread(handle_list_playlists, command))
        case CancelRun():
            await session.cancel_run()
        case ExtractPlaylist():
            session.start_extraction(command)
        case StartTagging():
            session.start_tagging(command)
        case ResolveArbitration():
            session.resolve_arbitration(command)
        case SwitchArbitrationSource():
            session.switch_arbitration_source(command)
        case ResolveByUrl():
            session.resolve_by_url(command)
        case CommitRun():
            session.commit_run(command)
        case RetryWrite():
            session.retry_write(command)
        case GetRollbackTarget():
            session.send(await asyncio.to_thread(handle_get_rollback_target))
        case Rollback():
            session.rollback(command)
        case _:
            assert_never(command)


if __name__ == "__main__":
    main()
