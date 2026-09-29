"""Injection de commandes sur la boucle NDJSON, partagee par les tests d'integration.

Aucune interface n'est lancee : le contrat se teste en ligne de commande, ce qui est
sa raison d'etre (ADR-005).
"""

import asyncio
import io
import json
import queue
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, override

from tagger.__main__ import run_loop

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Callable
    from pathlib import Path

# Borne de chaque attente : un evenement qui n'arrive pas echoue au lieu de geler la suite.
EXPECT_TIMEOUT = 10


def start_tagging(folder: Path, **payload: object) -> str:
    """Ligne `start_tagging` prete a injecter."""
    return json.dumps({"command": "start_tagging", "folder": str(folder), **payload}) + "\n"


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
    """stdout qui decode chaque ligne complete et la remet a la conversation."""

    def __init__(self, on_event: Callable[[dict[str, object]], None]) -> None:
        super().__init__()
        self._on_event = on_event
        self._pending = ""

    @override
    def write(self, text: str, /) -> int:
        self._pending += text
        *lines, self._pending = self._pending.split("\n")
        for line in lines:
            if line:
                self._on_event(json.loads(line))
        return len(text)


class Conversation:
    """Dialogue avec la boucle ; l'extraction seule emet depuis `to_thread`, pas la boucle.

    Une commande ne part qu'apres l'evenement qui la rend valide.
    """

    def __init__(self) -> None:
        self.events: list[dict[str, object]] = []
        self._lines: queue.SimpleQueue[str] = queue.SimpleQueue()
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
                for index in range(self._read, len(self.events)):
                    received = self.events[index]
                    if received["event"] == event and all(
                        received.get(key) == value for key, value in fields.items()
                    ):
                        self._read = index + 1
                        return received
                self._arrived.clear()
                await self._arrived.wait()

    def _received(self, event: dict[str, object]) -> None:
        self.events.append(event)
        self._arrived.set()


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
