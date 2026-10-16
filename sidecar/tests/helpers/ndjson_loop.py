"""Injection de commandes sur la boucle NDJSON, partagee par les tests d'integration.

Aucune interface n'est lancee : le contrat se teste en ligne de commande, ce qui est
sa raison d'etre (ADR-005).
"""

import asyncio
import io
import json
import queue
import threading
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Final, override

import pytest
from scraper_responses import BANDCAMP_TRACK
from tagging_api import ONE_TRACK
from vlc_dump import PLAYLIST_MAIN

from tagger.__main__ import run_loop

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Callable, Mapping
    from pathlib import Path

    from tagging_api import Gate

# Borne de chaque attente : un evenement qui n'arrive pas echoue au lieu de geler la suite.
EXPECT_TIMEOUT: Final = 10


# Run qu'aucun plan ni dump ne connait.
UNKNOWN_RUN: Final = "000000"


def line_of(message: Mapping[str, object]) -> str:
    """Ligne NDJSON prete a injecter."""
    return json.dumps(message) + "\n"


def line(command: str, **fields: object) -> str:
    return line_of({"command": command, **fields})


def arbitrate(source: str, candidate: int | None, track_id: str = ONE_TRACK) -> dict[str, object]:
    """Champs d'un `resolve_arbitration` ; `candidate` None refuse la liste de `source`."""
    return {
        "command": "resolve_arbitration",
        "track_id": track_id,
        "source": source,
        "candidate": candidate,
    }


CHOOSE_ON_BEATPORT: Final = arbitrate("beatport", 0)
REFUSE_BEATPORT: Final = arbitrate("beatport", None)


def recover_by_url(url: str = BANDCAMP_TRACK, track_id: str = ONE_TRACK) -> dict[str, object]:
    """Champs d'un `resolve_by_url`."""
    return {"command": "resolve_by_url", "track_id": track_id, "url": url}


def start_command(folder: Path) -> dict[str, object]:
    """Champs d'un `start_tagging`, a envoyer tels quels ou en ligne."""
    return {"command": "start_tagging", "folder": str(folder)}


def start_tagging(folder: Path, **payload: object) -> str:
    """Ligne `start_tagging` prete a injecter."""
    return line("start_tagging", folder=str(folder), **payload)


def sub(event: dict[str, object], key: str) -> dict[str, object]:
    """Objet imbrique d'un evenement ; le narrowing qu'exige mypy strict (le JSON rend `object`)."""
    value = event[key]
    assert isinstance(value, dict)
    return value


def rows(event: dict[str, object], key: str) -> list[dict[str, object]]:
    """Liste d'objets d'un evenement, avec le meme narrowing que `sub`."""
    value = event[key]
    assert isinstance(value, list)
    assert all(isinstance(row, dict) for row in value)
    return value


def extraction_command(
    library: Path, dump: Path, destination: Path, playlist_name: str = PLAYLIST_MAIN
) -> dict[str, object]:
    """Champs d'un `extract_playlist`, a envoyer tels quels ou en ligne."""
    return {
        "command": "extract_playlist",
        "source_folder": str(library),
        "destination_folder": str(destination),
        "playlist_path": str(dump),
        "playlist_name": playlist_name,
    }


def drive_raw(commands: str) -> str:
    """Injecte des commandes et rend la sortie brute, pour y chercher une fuite."""
    stdout = io.StringIO()
    asyncio.run(run_loop(io.StringIO(commands), stdout))

    return stdout.getvalue()


def drive(commands: str) -> list[dict[str, object]]:
    """Injecte des commandes et rend les evenements emis, un par ligne."""
    return [json.loads(line) for line in drive_raw(commands).splitlines() if line]


class _Inbox(io.StringIO):
    """stdin qui attend la prochaine ligne : `run_loop` le lit dans un thread."""

    def __init__(self, lines: queue.SimpleQueue[str]) -> None:
        super().__init__()
        self._lines = lines

    @override
    # Le `type: ignore` de l'override `_IOBase.readline` (bytes) n'est pas propage par typeshed.
    def readline(self, size: int | None = -1, /) -> str:  # type: ignore[override]
        return self._lines.get()


class _Outbox(io.StringIO):
    """stdout qui decode chaque ligne complete et la remet a la conversation.

    `write` s'execute aussi dans le thread de l'extraction, qui emet sa progression
    depuis `to_thread` : le tampon est donc verrouille.
    """

    def __init__(self, on_event: Callable[[dict[str, object]], None]) -> None:
        super().__init__()
        self._on_event = on_event
        self._pending = ""
        self._lock = threading.Lock()

    @override
    def write(self, text: str, /) -> int:
        with self._lock:
            self._pending += text
            *lines, self._pending = self._pending.split("\n")
            for line in lines:
                if line:
                    self._on_event(json.loads(line))
        return len(text)


class Conversation:
    """Dialogue avec la boucle ; l'extraction seule emet depuis `to_thread`, pas la boucle,
    d'ou le reveil de `expect` par `call_soon_threadsafe`.

    Une commande ne part qu'apres l'evenement qui la rend valide.
    """

    def __init__(self) -> None:
        self.events: list[dict[str, object]] = []
        self._lines: queue.SimpleQueue[str] = queue.SimpleQueue()
        self._loop = asyncio.get_running_loop()
        self._arrived = asyncio.Event()
        self._read = 0
        self.stdin = _Inbox(self._lines)
        self.stdout = _Outbox(self._received)

    def send(self, **fields: object) -> None:
        self._lines.put(line_of(fields))

    def shut_down(self) -> None:
        self.send(command="shutdown")

    def hang_up(self) -> None:
        """EOF sur stdin."""
        self._lines.put("")

    async def expect(self, event: str, **fields: object) -> dict[str, object]:
        """Prochain evenement `event`/`fields` ; les precedents sont depasses, jamais revus."""
        async with asyncio.timeout(EXPECT_TIMEOUT):
            while True:
                self._arrived.clear()
                for index in range(self._read, len(self.events)):
                    received = self.events[index]
                    if received["event"] == event and all(
                        received.get(key) == value for key, value in fields.items()
                    ):
                        self._read = index + 1
                        return received
                await self._arrived.wait()

    def _received(self, event: dict[str, object]) -> None:
        self.events.append(event)
        self._loop.call_soon_threadsafe(self._arrived.set)


@asynccontextmanager
async def conversation() -> AsyncIterator[Conversation]:
    """Boucle lancee sur une conversation, raccrochee et attendue a la sortie."""
    talk = Conversation()
    loop = asyncio.create_task(run_loop(talk.stdin, talk.stdout), name="loop")
    try:
        yield talk
    finally:
        talk.hang_up()
        async with asyncio.timeout(EXPECT_TIMEOUT):
            await loop


def _run_id_of(event: dict[str, object]) -> str:
    run_id = event["run_id"]
    assert isinstance(run_id, str)
    return run_id


async def resolved_run(talk: Conversation, folder: Path) -> str:
    """Lance un run sur `folder` et rend son `run_id`, phase reseau finie."""
    talk.send(**start_command(folder))
    started = await talk.expect("run_started")
    await talk.expect("run_finished", phase="network")
    return _run_id_of(started)


async def searching(talk: Conversation, folder: Path, gate: Gate) -> str:
    """Lance un run sur `folder` et rend son `run_id`, la requete retenue par `gate` arrivee."""
    talk.send(**start_command(folder))
    started = await talk.expect("run_started")
    await gate.wait_reached()
    return _run_id_of(started)


async def committed(talk: Conversation, run_id: str) -> dict[str, object]:
    """Confirme le run et rend la fin de sa phase d'ecriture."""
    talk.send(command="commit_run", run_id=run_id)
    return await talk.expect("run_finished", phase="write")


async def retried(talk: Conversation, run_id: str) -> dict[str, object]:
    """Rejoue les echecs d'ecriture et rend la fin de la phase."""
    talk.send(command="retry_write", run_id=run_id)
    return await talk.expect("run_finished", phase="write")


async def rolled_back(
    talk: Conversation, run_id: str, track_id: str | None = None
) -> dict[str, object]:
    """Restaure le run (ou son seul `track_id`) et rend la fin du rollback."""
    extra = {} if track_id is None else {"track_id": track_id}
    talk.send(command="rollback", run_id=run_id, **extra)
    return await talk.expect("rollback_finished")


async def written_run(talk: Conversation, folder: Path) -> str:
    """Comme `resolved_run`, puis confirme le run et attend la fin de l'ecriture."""
    run_id = await resolved_run(talk, folder)
    await committed(talk, run_id)
    return run_id


async def written_in_a_previous_session(folder: Path) -> str:
    """Run ecrit puis session fermee : la suivante n'en connait que ce que le disque garde."""
    async with conversation() as talk:
        return await written_run(talk, folder)


class HeldCall:
    """Appel retenu dans son thread : `reached` a son arrivee, `release` le lache."""

    def __init__(self) -> None:
        self.reached = threading.Event()
        self.release = threading.Event()

    async def wait_reached(self) -> None:
        """Echoue a la cause : sans quoi le test poursuivrait sur un appel qui n'est pas retenu."""
        if not await asyncio.to_thread(self.reached.wait, EXPECT_TIMEOUT):
            raise TimeoutError("held call never reached")


def held_call(monkeypatch: pytest.MonkeyPatch, module: object, name: str) -> HeldCall:
    """Remplace `module.name` par un appel retenu jusqu'a `release`."""
    held = HeldCall()
    real = getattr(module, name)

    def wrapper(*args: object, **kwargs: object) -> object:
        held.reached.set()
        held.release.wait(timeout=EXPECT_TIMEOUT)
        return real(*args, **kwargs)

    monkeypatch.setattr(module, name, wrapper)
    return held


# Fin de session sans attendre : le parametre du test s'appelle `leave`.
LEAVING: Final = pytest.mark.parametrize(
    "leave", [Conversation.shut_down, Conversation.hang_up], ids=["shutdown", "end-of-input"]
)
