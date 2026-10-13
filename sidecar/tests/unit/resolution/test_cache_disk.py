import asyncio
import shutil
from datetime import timedelta
from typing import TYPE_CHECKING, Final

import pytest
from stubs import raising

from tagger.resolution.cache import DiskCache, ResponseCache, response_key

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


def _files(root: Path) -> list[Path]:
    return sorted(root.iterdir()) if root.exists() else []


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
    assert _files(tmp_path) == []


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


def test_computes_the_total_size_of_existing_entries_on_open(
    tmp_path: Path, clock: FakeClock
) -> None:
    first = DiskCache(tmp_path, clock=clock)
    _write(first, "a", b"x" * 10)
    _write(first, "b", b"x" * 20)

    reopened = DiskCache(tmp_path, clock=clock)

    assert reopened.size == 30


@pytest.mark.asyncio
async def test_keeps_the_size_counter_consistent_under_concurrent_writes(
    tmp_path: Path, clock: FakeClock
) -> None:
    cache = DiskCache(tmp_path, clock=clock)

    async with asyncio.TaskGroup() as group:
        for index in range(20):
            group.create_task(
                asyncio.to_thread(_write, cache, f"key-{index}"), name=f"write:{index}"
            )

    assert cache.size == sum(path.stat().st_size for path in _files(tmp_path))


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

    assert [path.read_bytes() for path in _files(tmp_path)] == [b"second"]
    assert cache.size == len(b"second")


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

    assert _files(tmp_path) == []


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
    assert _files(tmp_path) == []


def test_leaves_no_temporary_file_when_publishing_fails(
    tmp_path: Path, clock: FakeClock, monkeypatch: pytest.MonkeyPatch
) -> None:
    cache = DiskCache(tmp_path, clock=clock)
    monkeypatch.setattr(
        "pathlib.Path.replace", raising(PermissionError(13, "locked by another process"))
    )

    with pytest.raises(PermissionError):
        _write(cache, "a")

    assert _files(tmp_path) == []


def test_publishes_an_entry_even_when_eviction_cannot_delete(
    tmp_path: Path, clock: FakeClock, monkeypatch: pytest.MonkeyPatch
) -> None:
    """ADR-013 : un fichier que Windows refuse de supprimer ne fait pas echouer l'appel."""
    cache = DiskCache(tmp_path, max_bytes=15, clock=clock)
    _write(cache, "a")
    clock.advance(timedelta(seconds=1))
    monkeypatch.setattr(
        "pathlib.Path.unlink", raising(PermissionError(13, "locked by another process"))
    )

    _write(cache, "b")

    assert cache.get("b") is not None
