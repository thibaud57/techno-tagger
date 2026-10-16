import asyncio
import threading
from pathlib import Path
from typing import TYPE_CHECKING, Final

import pytest
from ndjson_loop import (
    EXPECT_TIMEOUT,
    LEAVING,
    conversation,
    drive,
    line,
    line_of,
    start_tagging,
)

from tagger import __main__ as main
from tagger import handlers

if TYPE_CHECKING:
    from collections.abc import Callable

    from ndjson_loop import Conversation

    from tagger.handlers import CurrentRun
    from tagger.protocol import Event, ExtractPlaylist, StartTagging

# Assez long pour que la boucle lise la commande suivante pendant que le run meurt.
STOP_DELAY: Final = 0.2


def test_answers_a_version_request() -> None:
    events = drive(line("get_version"))

    assert events[0]["event"] == "version"
    assert "api_key_configured" in events[0]


@pytest.mark.parametrize(
    "rejected",
    [
        line("list_playlists", playlist_path="C:/x", extra=1),
        "pas du json\n",
        line("unheard_of"),
    ],
    ids=["undeclared-field", "not-json", "unknown-command"],
)
def test_a_rejected_line_does_not_stop_the_loop(rejected: str) -> None:
    events = drive(rejected + line("get_version"))

    assert events[0]["event"] == "error"
    assert events[0]["code"] == "malformed_command"
    assert events[1]["event"] == "version"


def test_a_malformed_extraction_touches_no_file(extraction: dict[str, object]) -> None:
    """La validation precede l'execution : le handler n'est jamais atteint, donc meme
    le dossier destination reste a creer.
    """
    events = drive(line_of({**extraction, "extra": 1}))

    assert events[0]["code"] == "malformed_command"
    assert not Path(str(extraction["destination_folder"])).exists()


def test_an_empty_line_produces_nothing() -> None:
    events = drive("\n" + line("get_version"))

    assert len(events) == 1


@pytest.fixture
def extraction_waits_for_version(monkeypatch: pytest.MonkeyPatch) -> None:
    """L'extraction ne part qu'une fois `get_version` repondu : l'ordre est impose, pas
    espere. Si la boucle restait bloquee par la copie, la reponse ne viendrait jamais et
    l'attente expirerait.
    """
    answered = threading.Event()
    real_extract = handlers.handle_extract_playlist
    real_version = handlers.handle_get_version

    def blocked_extract(command: ExtractPlaylist, emit: Callable[[Event], None]) -> Event:
        assert answered.wait(timeout=EXPECT_TIMEOUT), "la boucle est restee bloquee par la copie"
        return real_extract(command, emit)

    def answering_version() -> Event:
        version = real_version()
        answered.set()
        return version

    monkeypatch.setattr(main, "handle_extract_playlist", blocked_extract)
    monkeypatch.setattr(main, "handle_get_version", answering_version)


@pytest.mark.usefixtures("extraction_waits_for_version")
def test_answers_a_version_request_while_an_extraction_is_in_progress(
    extraction: dict[str, object],
) -> None:
    """La copie ne gele pas la lecture de stdin : une commande courte passe devant.

    Sans cela, fermer la fenetre pendant l'extraction d'une grosse bibliotheque
    laissait le `shutdown` dans le pipe jusqu'a la fin des transferts.
    """
    events = drive(line_of(extraction) + line("get_version"))

    names = [event["event"] for event in events]
    assert names.index("version") < names.index("extraction_finished")


@pytest.mark.usefixtures("extraction_waits_for_version")
def test_refuses_a_second_extraction_while_one_is_in_progress(
    extraction: dict[str, object],
) -> None:
    """Regression : sans extraction retenue, la premiere finissait parfois avant la
    lecture de la seconde et rien n'etait refuse.
    """
    events = drive(line_of(extraction) * 2 + line("get_version"))

    refusals = [event for event in events if event["event"] == "error"]
    assert [(event["code"], event["params"]) for event in refusals] == [
        ("phase_busy", {"phase": "extraction"})
    ]
    assert [event["event"] for event in events].count("extraction_finished") == 1


@pytest.fixture
def tagging_slow_to_stop(monkeypatch: pytest.MonkeyPatch) -> None:
    """Un run sans fin qui met du temps a mourir, comme le vrai dont la sortie du cache
    attend les telechargements en vol. Borne : une annulation perdue echoue, sans geler.
    """

    async def endless(
        command: StartTagging,
        emit: Callable[[Event], None],
        adopt: Callable[[CurrentRun], None],
    ) -> Event:
        try:
            await asyncio.wait_for(asyncio.Event().wait(), timeout=EXPECT_TIMEOUT)
        finally:
            await asyncio.sleep(STOP_DELAY)
        raise AssertionError("un run annule ne rend jamais son evenement de fin")

    monkeypatch.setattr(main, "handle_start_tagging", endless)


@pytest.mark.usefixtures("tagging_slow_to_stop")
def test_a_cancelled_run_leaves_the_loop_alive(tmp_path: Path) -> None:
    """`CancelledError` termine la tache sans remonter au TaskGroup, qui l'ignore."""
    events = drive(start_tagging(tmp_path) + line("cancel_run") + line("get_version"))

    assert [event["event"] for event in events] == ["version"]


@pytest.mark.usefixtures("tagging_slow_to_stop")
def test_a_run_started_right_after_a_cancellation_is_not_refused(tmp_path: Path) -> None:
    """Regression : le run annule mourait encore quand la relance arrivait, qui repartait
    en `phase_busy` du run, code que l'interface lit comme un run qui continue.
    """
    commands = start_tagging(tmp_path) + line("cancel_run") + start_tagging(tmp_path)

    events = drive(commands + line("shutdown"))

    assert [event for event in events if event["event"] == "error"] == []


def test_waits_for_an_extraction_before_leaving_on_shutdown(extraction: dict[str, object]) -> None:
    """`shutdown` annule un run de re-tagging mais attend une extraction.

    Le run ne tient que du reseau et de la memoire ; une copie coupee en vol
    laisserait un fichier a moitie ecrit dans la destination de l'utilisateur.
    """
    events = drive(line_of(extraction) + line("shutdown"))

    assert [event["event"] for event in events].count("extraction_finished") == 1


@LEAVING
@pytest.mark.asyncio
async def test_the_loop_ends_without_answering_anything_further(
    leave: Callable[[Conversation], None],
) -> None:
    async with conversation() as talk:
        leave(talk)
        talk.send(command="get_version")

    assert talk.events == []
