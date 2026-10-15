"""Reglages servis par le sidecar : seuils par defaut, fichier de logs, cache."""

from typing import TYPE_CHECKING

import pytest
from ndjson_loop import conversation, drive, resolved_run, start_command, written_run
from scraper_responses import YOUR_MIND

from tagger.core.file_failures import FileFailureReason
from tagger.core.logger import LOG_FILE_NAME
from tagger.core.paths import log_dir
from tagger.resolution.cache import cache_dir
from tagger.resolution.matching import DEFAULT_THRESHOLDS
from tagger.run import writing
from tagger.run.plan import plan_dir
from tagger.tags.files import TagsWriteError

if TYPE_CHECKING:
    from pathlib import Path

    from tagging_api import FakeApi


@pytest.mark.usefixtures("app_data")
def test_gives_the_default_thresholds_and_the_log_file() -> None:
    """Tels que l'interface les lit sur le fil : la valeur de depart des Reglages vient d'ici."""
    events = drive('{"command":"get_version"}\n')

    assert events[0]["default_thresholds"] == {
        "floor": DEFAULT_THRESHOLDS.floor,
        "ceiling": DEFAULT_THRESHOLDS.ceiling,
    }
    assert events[0]["log_file"] == str(log_dir() / LOG_FILE_NAME)


def _cached_files() -> list[Path]:
    return sorted(path for path in cache_dir().rglob("*") if path.is_file())


def _fill_cache() -> int:
    """Une reponse et une pochette : rend la taille totale ecrite."""
    (cache_dir() / "responses").mkdir(parents=True)
    (cache_dir() / "artworks").mkdir()
    return (cache_dir() / "responses" / "a.json").write_bytes(b"r" * 10) + (
        cache_dir() / "artworks" / "b.jpg"
    ).write_bytes(b"p" * 32)


@pytest.mark.usefixtures("app_data")
def test_measures_then_clears_the_cache_and_keeps_the_plans() -> None:
    filled = _fill_cache()
    plan_dir().mkdir(parents=True)
    kept = plan_dir() / "kept.json"
    kept.write_text("{}", encoding="utf-8")

    events = drive('{"command":"get_cache_size"}\n{"command":"clear_cache"}\n')

    assert events == [
        {"event": "cache_size", "size_bytes": filled},
        {"event": "cache_cleared", "freed_bytes": filled, "size_bytes": 0},
    ]
    assert _cached_files() == []
    assert kept.is_file()


@pytest.mark.usefixtures("app_data")
def test_clears_an_already_empty_cache_without_error() -> None:
    """Double clic sur le bouton : le second vidage n'a rien a supprimer."""
    _fill_cache()

    events = drive('{"command":"clear_cache"}\n{"command":"clear_cache"}\n')

    assert events[1] == {"event": "cache_cleared", "freed_bytes": 0, "size_bytes": 0}


@pytest.mark.asyncio
@pytest.mark.usefixtures("_key")
async def test_refuses_to_clear_the_cache_of_a_run_not_written(folder: Path) -> None:
    """`write_tags` lit la pochette dans le cache au moment d'ecrire."""
    async with conversation() as talk:
        await resolved_run(talk, folder)
        cached = _cached_files()
        talk.send(command="clear_cache")
        error = await talk.expect("error")

    assert (error["code"], error["params"], error["command"]) == (
        "run_not_written",
        {},
        "clear_cache",
    )
    assert cached
    assert _cached_files() == cached


@pytest.mark.asyncio
@pytest.mark.usefixtures("_key")
async def test_refuses_to_clear_the_cache_of_a_cancelled_run(folder: Path, api: FakeApi) -> None:
    """Un run interrompu reste courant : il garde son rattrapage, donc son ecriture."""
    gate = api.gate("/beatport/search", YOUR_MIND)

    async with conversation() as talk:
        talk.send(**start_command(folder))
        await gate.reached.wait()
        talk.send(command="cancel_run")
        await talk.expect("progress", phase="url_recovery")
        talk.send(command="clear_cache")
        error = await talk.expect("error")

    assert error["code"] == "run_not_written"


@pytest.mark.asyncio
@pytest.mark.usefixtures("_key")
async def test_refuses_to_clear_the_cache_while_a_failed_write_awaits_its_retry(
    folder: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def locked(path: Path, *_args: object) -> object:
        raise TagsWriteError(path, FileFailureReason.FILE_LOCKED)

    monkeypatch.setattr(writing, "write_tags", locked)

    async with conversation() as talk:
        run_id = await resolved_run(talk, folder)
        talk.send(command="commit_run", run_id=run_id)
        await talk.expect("run_finished", phase="write")
        talk.send(command="clear_cache")
        error = await talk.expect("error")

    assert error["code"] == "run_not_written"


@pytest.mark.asyncio
@pytest.mark.usefixtures("_key")
async def test_refuses_to_clear_the_cache_while_a_run_searches(folder: Path, api: FakeApi) -> None:
    gate = api.gate("/beatport/search", YOUR_MIND)

    async with conversation() as talk:
        talk.send(**start_command(folder))
        await gate.reached.wait()
        talk.send(command="clear_cache")
        error = await talk.expect("error")
        gate.release.set()
        await talk.expect("run_finished", phase="network")

    assert (error["code"], error["params"], error["command"]) == (
        "phase_busy",
        {"phase": "tagging"},
        "clear_cache",
    )


@pytest.mark.asyncio
@pytest.mark.usefixtures("_key")
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
