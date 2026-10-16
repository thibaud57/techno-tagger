"""La cle API ne sort du trousseau que vers l'en-tete des appels : ni stdout, ni logs, ni Sentry."""

import json
import logging
import traceback
from typing import TYPE_CHECKING, Final

import keyring
import pytest
from memory_keyring import RefusingKeyring
from ndjson_loop import conversation, drive_raw, line, resolved_run
from scraper_responses import YOUR_MIND, found, invalid_track_payload
from sentry_sdk.utils import event_from_exception
from tagging_api import BEATPORT_SEARCH

from tagger.core.api_key import SERVICE, USERNAME
from tagger.core.observability import _scrub

if TYPE_CHECKING:
    from pathlib import Path
    from unittest.mock import MagicMock

    from memory_keyring import MemoryKeyring
    from tagging_api import FakeApi

SECRET: Final = "sk-live-9f8e7d6c5b4a"


def test_never_echoes_the_api_key_on_stdout_nor_in_the_logs(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)
    commands = line("set_api_key", api_key=SECRET) + line(
        "set_api_key", api_key=f"{SECRET} with-space"
    )

    output = drive_raw(commands)

    assert SECRET not in output
    assert SECRET not in caplog.text
    assert [json.loads(row)["event"] for row in output.splitlines()] == ["version", "error"]


def test_never_echoes_the_api_key_when_the_keyring_refuses_it(
    caplog: pytest.LogCaptureFixture,
) -> None:
    keyring.set_keyring(RefusingKeyring())
    caplog.set_level(logging.DEBUG)

    output = drive_raw(line("set_api_key", api_key=SECRET))

    assert SECRET not in output
    assert SECRET not in caplog.text
    assert json.loads(output)["code"] == "api_key_not_stored"


@pytest.mark.asyncio
@pytest.mark.usefixtures("_key")
async def test_never_sends_the_api_key_to_sentry(
    unresolved_folder: Path,
    api: FakeApi,
    memory_keyring: MemoryKeyring,
    captured_exceptions: MagicMock,
) -> None:
    """Une reponse hors contrat est le bug que le sidecar remonte a Sentry : l'exception
    traverse le client qui porte la cle, puis `before_send`.
    """
    api.on(BEATPORT_SEARCH, YOUR_MIND, found(invalid_track_payload()))
    api_key = memory_keyring.secrets[(SERVICE, USERNAME)]

    async with conversation() as talk:
        await resolved_run(talk, unresolved_folder)

    captured = [call.args[0] for call in captured_exceptions.call_args_list]
    assert captured
    for error in captured:
        sent = json.dumps(_scrub(event_from_exception(error)[0], {}), default=str)
        assert "api contract broken" in sent
        assert api_key not in sent
        assert api_key not in "".join(traceback.format_exception(error))
