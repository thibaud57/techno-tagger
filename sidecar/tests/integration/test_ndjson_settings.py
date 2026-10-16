"""Reglages servis par le sidecar : seuils par defaut, fichier de logs, cache."""

from typing import TYPE_CHECKING

import pytest
from cache_files import cached_files, fill_cache
from ndjson_loop import (
    committed,
    conversation,
    drive,
    held_call,
    line,
    resolved_run,
    rows,
    searching,
    start_command,
    written_in_a_previous_session,
    written_run,
)
from scraper_responses import YOUR_MIND
from tagging_api import BEATPORT_SEARCH

from tagger import handlers
from tagger.core.logger import LOG_FILE_NAME
from tagger.core.paths import log_dir
from tagger.resolution.cache import cache_dir
from tagger.resolution.matching import DEFAULT_THRESHOLDS
from tagger.run.plan import plan_dir

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable
    from pathlib import Path

    from ndjson_loop import Conversation
    from tagging_api import FakeApi

pytestmark = pytest.mark.usefixtures("_key")


def test_gives_the_default_thresholds_and_the_log_file() -> None:
    """Tels que l'interface les lit sur le fil : la valeur de depart des Reglages vient d'ici."""
    events = drive(line("get_version"))

    assert events[0]["default_thresholds"] == {
        "floor": DEFAULT_THRESHOLDS.floor,
        "ceiling": DEFAULT_THRESHOLDS.ceiling,
    }
    assert events[0]["log_file"] == str(log_dir() / LOG_FILE_NAME)


def test_measures_then_clears_the_cache_and_keeps_the_plans() -> None:
    filled = fill_cache(cache_dir())
    plan_dir().mkdir(parents=True)
    kept = plan_dir() / "kept.json"
    kept.write_text("{}", encoding="utf-8")

    events = drive(line("get_cache_size") + line("clear_cache"))

    assert events == [
        {"event": "cache_size", "size_bytes": filled},
        {"event": "cache_cleared", "freed_bytes": filled, "size_bytes": 0},
    ]
    assert cached_files(cache_dir()) == []
    assert kept.is_file()


def test_clears_an_already_empty_cache_without_error() -> None:
    """Double clic sur le bouton : le second vidage n'a rien a supprimer."""
    fill_cache(cache_dir())

    events = drive(line("clear_cache") * 2)

    assert events[1] == {"event": "cache_cleared", "freed_bytes": 0, "size_bytes": 0}


async def _resolved(talk: Conversation, folder: Path, _api: FakeApi) -> None:
    await resolved_run(talk, folder)


async def _cancelled(talk: Conversation, folder: Path, api: FakeApi) -> None:
    gate = api.gate(BEATPORT_SEARCH, YOUR_MIND)
    await searching(talk, folder, gate)
    talk.send(command="cancel_run")
    await talk.expect("progress", phase="url_recovery")


async def _write_failed(talk: Conversation, folder: Path, _api: FakeApi) -> None:
    run_id = await resolved_run(talk, folder)
    await committed(talk, run_id)


@pytest.mark.asyncio
@pytest.mark.usefixtures("locked_writes")
@pytest.mark.parametrize(
    "arrange",
    [_resolved, _cancelled, _write_failed],
    ids=["not-committed", "cancelled", "write-failed"],
)
async def test_refuses_to_clear_the_cache_of_a_run_not_written(
    folder: Path,
    api: FakeApi,
    arrange: Callable[[Conversation, Path, FakeApi], Awaitable[None]],
) -> None:
    """`write_tags` lit la pochette dans le cache au moment d'ecrire ; un run interrompu
    reste courant et garde son rattrapage, donc son ecriture.
    """
    async with conversation() as talk:
        await arrange(talk, folder, api)
        cached = cached_files(cache_dir())
        talk.send(command="clear_cache")
        error = await talk.expect("error")

    assert (error["code"], error["params"], error["command"]) == (
        "run_not_written",
        {},
        "clear_cache",
    )
    assert cached_files(cache_dir()) == cached


@pytest.mark.asyncio
async def test_clears_the_cache_of_a_written_run_and_runs_again(folder: Path) -> None:
    """Le cache est jetable : un run qui suit son vidage repaie ses appels et va au bout."""
    async with conversation() as talk:
        await written_run(talk, folder)
        talk.send(command="clear_cache")
        cleared = await talk.expect("cache_cleared")
        talk.send(**start_command(folder))
        await talk.expect("run_finished", phase="network")

    assert cleared["freed_bytes"] != 0
    assert cleared["size_bytes"] == 0


@pytest.mark.asyncio
async def test_clears_the_cache_while_a_past_run_loads(
    folder: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Une relecture ne retient pas le cache : ses pochettes manquantes se retelechargent."""
    run_id = await written_in_a_previous_session(folder)
    held = held_call(monkeypatch, handlers, "load_tagging_report")

    async with conversation() as talk:
        talk.send(command="load_run", run_id=run_id)
        await held.wait_reached()
        talk.send(command="clear_cache")
        cleared = await talk.expect("cache_cleared")
        held.release.set()
        loaded = await talk.expect("run_loaded", run_id=run_id)

    assert cleared["freed_bytes"] != 0
    assert len(rows(loaded, "tracks")) == 1
