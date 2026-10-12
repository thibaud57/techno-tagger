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
from enum import UNIQUE, StrEnum, auto, verify
from typing import TYPE_CHECKING, ClassVar, NamedTuple, assert_never

import keyring
from keyring.backends.Windows import WinVaultKeyring
from pydantic import ValidationError

from tagger import RELEASE
from tagger.arbitration import ArbitrationNotPendingError
from tagger.build_info import SENTRY_DSN
from tagger.errors import RunNotFoundError, TaggerError
from tagger.handlers import (
    commit,
    handle_commit_run,
    handle_extract_playlist,
    handle_get_interrupted_run,
    handle_get_rollback_target,
    handle_get_version,
    handle_list_playlists,
    handle_list_runs,
    handle_load_run,
    handle_resume_run,
    handle_retry_write,
    handle_rollback,
    handle_set_api_key,
    handle_start_tagging,
    url_progress,
)
from tagger.logger import setup_logging
from tagger.observability import init_sentry
from tagger.paths import app_data_dir
from tagger.plan import discard_plan, find_plan, plan_dir, purge_plans
from tagger.protocol import (
    CancelRun,
    CommitRun,
    DiscardRun,
    Event,
    ExecutableCommand,
    ExtractPlaylist,
    GetInterruptedRun,
    GetRollbackTarget,
    GetVersion,
    ListPlaylists,
    ListRuns,
    LoadRun,
    ResolveArbitration,
    ResolveByUrl,
    ResumeRun,
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
from tagger.resume import load_resumable
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


@verify(UNIQUE)
class Phase(StrEnum):
    """Phase longue de la session, valeur du parametre `phase` de `phase_busy`."""

    EXTRACTION = auto()
    TAGGING = auto()
    WRITE = auto()
    ROLLBACK = auto()


class PhaseBusyError(TaggerError):
    """Une phase longue tourne encore : aucune autre ne demarre avant sa fin.

    Extraction, ecriture et rollback touchent aux fichiers de l'utilisateur, la recherche
    reseau lit ceux qu'elle va faire ecrire : deux phases melees pourraient viser le meme
    dossier.
    """

    code: ClassVar[str] = "phase_busy"

    def __init__(self, phase: Phase) -> None:
        super().__init__(f"a {phase} phase is already in progress", phase=phase)


class WriteNotOpenError(TaggerError):
    """Run inconnu ou remplace, phase reseau en cours, deja confirme pour `commit_run` ou
    jamais confirme pour `retry_write`."""

    code: ClassVar[str] = "write_not_open"

    def __init__(self) -> None:
        super().__init__("the run is not open to writing")


class RunCommittedError(TaggerError):
    """Run confirme : plus aucune decision n'entre sur ses morceaux, point de non-retour."""

    code: ClassVar[str] = "run_committed"

    def __init__(self, track_id: str) -> None:
        super().__init__("the run is committed", track_id=track_id)


class _RunningPhase(NamedTuple):
    phase: Phase
    task: asyncio.Task[None]


class _Session:
    """Etat de la session : le run de re-tagging tourne pendant que stdin est lu.

    Seul ecrivain sur `stdout` : la boucle et la tache de fond passent toutes deux
    par `send`, ce qui garde une ligne par evenement sans verrou.
    """

    def __init__(self, group: asyncio.TaskGroup, stdout: TextIO) -> None:
        self._group = group
        self._stdout = stdout
        # Une seule phase longue a la fois : le slot garde la derniere, `_running` dit si elle vit.
        self._phase_task: _RunningPhase | None = None
        self._current: CurrentRun | None = None
        # Chargements de runs passes en vol : lecture seule, annules a la fermeture de la session.
        self._loads: set[asyncio.Task[None]] = set()

    def start_tagging(self, command: StartTagging) -> None:
        """Lance le run en tache de fond ; il cesse aussitot d'etre le run courant.

        Le run remplace est abandonne : son plan non confirme est supprime, un seul run
        interrompu peut exister a la fois.
        """
        self._ensure_idle()
        replaced, self._current = self._current, None
        start_work = functools.partial(self._replace, replaced, command)
        self._spawn_phase(Phase.TAGGING, start_work, command)

    def resume_run(self, command: ResumeRun) -> None:
        """Le run affiche n'est remplace qu'une fois le plan valide : un refus ne lui coute rien."""
        self._ensure_idle()
        start_work = functools.partial(self._resume, command)
        self._spawn_phase(Phase.TAGGING, start_work, command)

    async def _resume(self, command: ResumeRun) -> None:
        plan = await asyncio.to_thread(load_resumable, plan_dir(), dump_dir(), command.run_id)
        replaced, self._current = self._current, None
        if replaced is not None:
            await replaced.abandon()
        await handle_resume_run(plan, self.send, self._adopt)

    def start_extraction(self, command: ExtractPlaylist) -> None:
        """Meme traitement que le run : sans quoi la copie gelerait la lecture de stdin."""
        self._ensure_idle()
        start_work = functools.partial(
            asyncio.to_thread, handle_extract_playlist, command, self.send
        )
        self._spawn_phase(Phase.EXTRACTION, start_work, command)

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
        self._ensure_idle()
        current = self._current
        live = (
            current.live if current is not None and current.live.run_id == command.run_id else None
        )
        start_work = functools.partial(handle_rollback, command, live, self.send)
        self._spawn_phase(Phase.ROLLBACK, start_work, command, command.track_id)

    def load_run(self, command: LoadRun) -> None:
        """Lecture seule en tache de fond : aucun fichier de musique n'est touche et les pochettes
        ne gelent pas la lecture de stdin. Refuse pendant une phase longue, dont elle partage le
        dossier des pochettes ; la fermeture de la session l'annule."""
        self._ensure_idle()
        start_work = functools.partial(handle_load_run, command)
        load = self._group.create_task(self._phase(start_work, command), name="load_run")
        self._loads.add(load)
        load.add_done_callback(self._loads.discard)

    async def _cancel_loads(self) -> None:
        """Rien a proteger dans un chargement : l'attendre retarderait seulement la sortie."""
        loads = tuple(self._loads)
        for load in loads:
            load.cancel()
        await asyncio.gather(*loads, return_exceptions=True)

    async def announce_interrupted_run(self) -> None:
        """Annonce le plan a reprendre, le run ouvert excepte."""
        current = self._current
        active_run_id = None if current is None else current.live.run_id
        self.send(await asyncio.to_thread(handle_get_interrupted_run, active_run_id))

    async def discard_run(self, command: DiscardRun) -> None:
        """Repartir de zero : le plan part ; sur le run courant, le run est abandonne avec lui.

        Refuse pendant une phase longue, qui peut tenir ce plan (une reprise en cours). L'annonce
        suivante part toujours : elle dit s'il reste un autre run a reprendre.
        """
        self._ensure_idle()
        current = self._current
        if current is not None and current.live.run_id == command.run_id:
            self._current = None
            await current.abandon()
        else:
            path = await asyncio.to_thread(find_plan, plan_dir(), command.run_id)
            if path is None:
                raise RunNotFoundError(command.run_id)
            await asyncio.to_thread(discard_plan, path)
        await self.announce_interrupted_run()

    async def close(self, *, cancel: bool) -> None:
        """`shutdown` annule la phase reseau, l'EOF l'attend ; le run courant se ferme ensuite.

        Extraction, ecriture et rollback ne sont jamais annules, le `TaskGroup` de la boucle
        les attend (cf. `cancel_run`).
        """
        await self._settle_run(cancel=cancel)
        await self._cancel_loads()
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
        self._spawn_phase(Phase.WRITE, start_work, command)

    def _spawn_phase(
        self,
        phase: Phase,
        start_work: Callable[[], Awaitable[Event | None]],
        command: (StartTagging | ExtractPlaylist | CommitRun | RetryWrite | Rollback | ResumeRun),
        track_id: str | None = None,
    ) -> None:
        """Garde de `_ensure_idle` deja passee : elle precede les effets de bord du demarrage."""
        task = self._group.create_task(self._phase(start_work, command, track_id), name=phase.value)
        self._phase_task = _RunningPhase(phase, task)

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

    def _ensure_idle(self) -> None:
        """Une seule phase longue a la fois, refusee en `phase_busy` portant celle qui tourne."""
        running = self._running()
        if running is not None:
            raise PhaseBusyError(running.phase)

    def _writable(self, run_id: str) -> CurrentRun:
        """Run courant designe, sans phase longue ni geste en vol.

        Un geste qui finirait pendant l'ecriture ecraserait un morceau ecrit. Une phase reseau
        en cours rend `write_not_open`, le run n'etant pas encore ouvert a l'ecriture.
        """
        running = self._running()
        if running is not None and running.phase is not Phase.TAGGING:
            raise PhaseBusyError(running.phase)
        current = self._current
        if current is None or current.live.run_id != run_id or current.busy or running is not None:
            raise WriteNotOpenError
        return current

    async def _replace(self, replaced: CurrentRun | None, command: StartTagging) -> None:
        if replaced is not None:
            await replaced.abandon()
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
        # refusee en `phase_busy`.
        await asyncio.wait({running})

    def send(self, event: Event) -> None:
        """Une ligne par evenement ; `line_buffering` (cf. `_force_utf8_streams`) evite le flush."""
        self._stdout.write(emit(event) + "\n")

    def _running(self) -> _RunningPhase | None:
        """La phase longue en cours, `None` si le slot est vide ou sa tache terminee."""
        if self._phase_task is None or self._phase_task.task.done():
            return None
        return self._phase_task

    def _active_run(self) -> asyncio.Task[None] | None:
        """La phase reseau en cours, `None` si une autre phase tourne ou si aucune."""
        running = self._running()
        return running.task if running is not None and running.phase is Phase.TAGGING else None

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
            | ResumeRun
            | LoadRun
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
    _purge_old_plans()
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


def _purge_old_plans() -> None:
    # Meme garde que les dumps : un plan qui reste quelques jours de plus ne gene personne.
    try:
        purge_plans(plan_dir(), datetime.now(UTC))
    except OSError:
        logger.exception("run plan purge failed")


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
    `error` et la boucle continue : seuls `shutdown` et l'EOF l'arretent. La phase
    d'ecriture isole l'echec inattendu d'un morceau (`write_error`) et remonte le bug par
    `capture_exception`. Partout ailleurs, toute autre exception fait tomber le processus,
    volontairement : l'avaler cacherait un bug que Sentry remonte comme crash du sidecar
    (cf. PRODUCTION.md § Alertes).
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
        case ListRuns():
            session.send(await asyncio.to_thread(handle_list_runs))
        case LoadRun():
            session.load_run(command)
        case ResumeRun():
            session.resume_run(command)
        case GetInterruptedRun():
            await session.announce_interrupted_run()
        case DiscardRun():
            await session.discard_run(command)
        case _:
            assert_never(command)


if __name__ == "__main__":
    main()
