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

from tagging_api import ONE_TRACK

from tagger.__main__ import run_loop

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Callable
    from pathlib import Path

    import pytest

# Borne de chaque attente : un evenement qui n'arrive pas echoue au lieu de geler la suite.
EXPECT_TIMEOUT: Final = 10


CHOOSE_ON_BEATPORT: Final = {
    "command": "resolve_arbitration",
    "track_id": ONE_TRACK,
    "source": "beatport",
    "candidate": 0,
}


def start_command(folder: Path) -> dict[str, object]:
    """Champs d'un `start_tagging`, a envoyer tels quels ou en ligne."""
    return {"command": "start_tagging", "folder": str(folder)}


def start_tagging(folder: Path, **payload: object) -> str:
    """Ligne `start_tagging` prete a injecter."""
    return json.dumps({**start_command(folder), **payload}) + "\n"


def extraction_command(
    library: Path, dump: Path, destination: Path, playlist_name: str = "test playlist"
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
        self._lines.put(json.dumps(fields) + "\n")

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


async def resolved_run(talk: Conversation, folder: Path) -> str:
    """Lance un run sur `folder` et rend son `run_id`, phase reseau finie."""
    talk.send(**start_command(folder))
    started = await talk.expect("run_started")
    await talk.expect("run_finished", phase="network")
    run_id = started["run_id"]
    assert isinstance(run_id, str)
    return run_id


async def written_run(talk: Conversation, folder: Path) -> str:
    """Comme `resolved_run`, puis confirme le run et attend la fin de l'ecriture."""
    run_id = await resolved_run(talk, folder)
    talk.send(command="commit_run", run_id=run_id)
    await talk.expect("run_finished", phase="write")
    return run_id


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
