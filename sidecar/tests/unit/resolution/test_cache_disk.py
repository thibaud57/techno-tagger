import asyncio
import shutil
from datetime import timedelta
from typing import TYPE_CHECKING, Final

import pytest
from cache_files import fill_cache
from fs_listing import files
from stubs import locked_file

from tagger.resolution.cache import (
    ClearedCache,
    DiskCache,
    ResponseCache,
    cache_size,
    clear_cache,
    response_key,
)

if TYPE_CHECKING:
    from pathlib import Path
    from typing import BinaryIO

TEN_BYTES: Final = b"0123456789"


class FakeClock:
    """Horloge reglable en secondes epoch : TTL et LRU se testent sans attendre ni dormir."""

    def __init__(self, now: float = 1_800_000_000.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now

    def advance(self, delta: timedelta) -> None:
        self.now += delta.total_seconds()


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


def _write(cache: DiskCache, key: str, data: bytes = TEN_BYTES) -> None:
    with cache.writer(key, "bin") as file:
        file.write(data)


def _fail_after_writing(file: BinaryIO) -> None:
    file.write(b"partial")
    raise RuntimeError("interrupted")


def test_returns_a_written_entry_before_it_expires(tmp_path: Path, clock: FakeClock) -> None:
    cache = DiskCache(tmp_path, clock=clock)
    _write(cache, "a")
    clock.advance(timedelta(days=29))

    entry = cache.get("a")

    assert entry is not None
    assert entry.read_bytes() == TEN_BYTES


def test_touches_the_last_use_of_an_entry_on_read(tmp_path: Path, clock: FakeClock) -> None:
    cache = DiskCache(tmp_path, clock=clock)
    _write(cache, "a")
    clock.advance(timedelta(days=1))

    entry = cache.get("a")

    assert entry is not None
    assert entry.stat().st_mtime == clock.now


def test_deletes_and_misses_an_expired_entry(tmp_path: Path, clock: FakeClock) -> None:
    cache = DiskCache(tmp_path, clock=clock)
    _write(cache, "a")
    clock.advance(timedelta(days=31))

    entry = cache.get("a")

    assert entry is None
    assert files(tmp_path) == []


def test_evicts_the_least_recently_read_entries_above_the_ceiling(
    tmp_path: Path, clock: FakeClock
) -> None:
    cache = DiskCache(tmp_path, max_bytes=30, clock=clock)
    for key in ("a", "b", "c"):
        _write(cache, key)
        clock.advance(timedelta(seconds=1))
    cache.get("a")
    clock.advance(timedelta(seconds=1))

    _write(cache, "d")

    assert cache.get("b") is None
    assert all(cache.get(key) is not None for key in ("a", "c", "d"))


def test_never_evicts_the_entry_just_written(tmp_path: Path, clock: FakeClock) -> None:
    cache = DiskCache(tmp_path, max_bytes=5, clock=clock)

    _write(cache, "a")

    assert cache.get("a") is not None


def test_counts_the_entries_found_on_open_toward_the_ceiling(
    tmp_path: Path, clock: FakeClock
) -> None:
    first = DiskCache(tmp_path, clock=clock)
    _write(first, "a", b"x" * 10)
    clock.advance(timedelta(seconds=1))
    _write(first, "b", b"x" * 20)
    clock.advance(timedelta(seconds=1))
    reopened = DiskCache(tmp_path, max_bytes=35, clock=clock)

    _write(reopened, "c", b"x" * 10)

    assert reopened.get("a") is None
    assert all(reopened.get(key) is not None for key in ("b", "c"))


@pytest.mark.asyncio
async def test_holds_the_ceiling_under_concurrent_writes(tmp_path: Path, clock: FakeClock) -> None:
    cache = DiskCache(tmp_path, max_bytes=100, clock=clock)

    async with asyncio.TaskGroup() as group:
        for index in range(20):
            group.create_task(
                asyncio.to_thread(_write, cache, f"key-{index}"), name=f"write:{index}"
            )

    assert cache_size(tmp_path) <= 100


def test_removes_orphan_temporary_files_on_open(tmp_path: Path, clock: FakeClock) -> None:
    orphan = tmp_path / "left-by-a-crash.tmp"
    orphan.write_bytes(b"partial")

    DiskCache(tmp_path, clock=clock)

    assert not orphan.exists()


def test_replaces_the_previous_version_of_a_key(tmp_path: Path, clock: FakeClock) -> None:
    cache = DiskCache(tmp_path, clock=clock)
    _write(cache, "a", b"first")
    clock.advance(timedelta(days=1))

    _write(cache, "a", b"second")

    assert [path.read_bytes() for path in files(tmp_path)] == [b"second"]


def test_misses_without_error_once_the_folder_is_deleted_then_recreates_it(
    tmp_path: Path,
    clock: FakeClock,
) -> None:
    root = tmp_path / "cache"
    cache = DiskCache(root, max_bytes=30, clock=clock)
    _write(cache, "a")
    shutil.rmtree(root)

    entry = cache.get("a")
    _write(cache, "b")

    assert entry is None
    assert cache.get("b") is not None


def test_publishes_nothing_when_the_writer_fails(tmp_path: Path, clock: FakeClock) -> None:
    cache = DiskCache(tmp_path, clock=clock)

    with pytest.raises(RuntimeError), cache.writer("a", "bin") as file:
        _fail_after_writing(file)

    assert files(tmp_path) == []


def test_ignores_and_keeps_a_foreign_file(tmp_path: Path, clock: FakeClock) -> None:
    foreign = tmp_path / "readme.txt"
    foreign.write_text("not an entry", encoding="utf-8")
    cache = DiskCache(tmp_path, max_bytes=5, clock=clock)

    _write(cache, "a")

    assert foreign.exists()


def test_round_trips_a_response_whatever_the_parameter_order(
    tmp_path: Path, clock: FakeClock
) -> None:
    responses = ResponseCache(DiskCache(tmp_path, clock=clock))
    responses.put("/beatport/search", {"type": "tracks", "q": "x"}, {"items": []})

    cached = responses.get("/beatport/search", {"q": "x", "type": "tracks"})

    assert cached is not None
    assert cached.payload == {"items": []}
    assert cached.entry.exists()


def test_deletes_and_misses_an_unreadable_json_response(tmp_path: Path, clock: FakeClock) -> None:
    disk = DiskCache(tmp_path, clock=clock)
    with disk.writer(response_key("/beatport/search", {"q": "x"}), "json") as file:
        file.write(b"{not json")
    responses = ResponseCache(disk)

    cached = responses.get("/beatport/search", {"q": "x"})

    assert cached is None
    assert files(tmp_path) == []


def test_leaves_no_temporary_file_when_publishing_fails(
    tmp_path: Path, clock: FakeClock, monkeypatch: pytest.MonkeyPatch
) -> None:
    cache = DiskCache(tmp_path, clock=clock)
    monkeypatch.setattr("pathlib.Path.replace", locked_file())

    with pytest.raises(PermissionError):
        _write(cache, "a")

    assert files(tmp_path) == []


def test_publishes_an_entry_even_when_eviction_cannot_delete(
    tmp_path: Path, clock: FakeClock, monkeypatch: pytest.MonkeyPatch
) -> None:
    """ADR-013 : un fichier que Windows refuse de supprimer ne fait pas echouer l'appel."""
    cache = DiskCache(tmp_path, max_bytes=15, clock=clock)
    _write(cache, "a")
    clock.advance(timedelta(seconds=1))
    monkeypatch.setattr("pathlib.Path.unlink", locked_file())

    _write(cache, "b")

    assert cache.get("b") is not None


def test_measures_the_files_of_every_cache_folder(tmp_path: Path) -> None:
    fill_cache(tmp_path)

    size = cache_size(tmp_path)

    assert size == 30


def test_measures_an_absent_cache_as_empty(tmp_path: Path) -> None:
    size = cache_size(tmp_path / "missing")

    assert size == 0


def test_clears_every_file_and_keeps_the_folders(tmp_path: Path) -> None:
    fill_cache(tmp_path)

    cleared = clear_cache(tmp_path)

    assert cleared == ClearedCache(freed_bytes=30, size_bytes=0)
    assert files(tmp_path / "responses") == []
    assert files(tmp_path / "artworks") == []


def test_clears_an_absent_cache_without_error(tmp_path: Path) -> None:
    cleared = clear_cache(tmp_path / "missing")

    assert cleared == ClearedCache(freed_bytes=0, size_bytes=0)


def test_keeps_counts_and_logs_a_file_that_resists_deletion(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Sous Windows, un antivirus qui tient un fichier ouvert fait echouer `unlink`."""
    fill_cache(tmp_path)
    monkeypatch.setattr("pathlib.Path.unlink", locked_file())

    cleared = clear_cache(tmp_path)

    assert cleared == ClearedCache(freed_bytes=0, size_bytes=30)
    assert "cache entry not deleted reason=unlink_failed" in caplog.messages
