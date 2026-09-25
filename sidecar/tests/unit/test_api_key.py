"""Tests de la lecture et de l'ecriture de la cle dans le trousseau."""

import keyring
import pytest
from keyring.backends import fail
from memory_keyring import FailingKeyring, MemoryKeyring, RefusingKeyring

from tagger.api_key import (
    ApiKeyNotStoredError,
    KeyringUnavailableError,
    read_api_key,
    store_api_key,
)


def test_reads_no_key_from_an_empty_keyring(memory_keyring: MemoryKeyring) -> None:
    key = read_api_key()

    assert key is None


def test_stores_then_reads_the_key(memory_keyring: MemoryKeyring) -> None:
    store_api_key("k3y-t0k3n")

    key = read_api_key()

    assert key == "k3y-t0k3n"


def test_reads_no_key_when_the_keyring_fails_on_read() -> None:
    keyring.set_keyring(FailingKeyring())

    key = read_api_key()

    assert key is None


def test_raises_api_key_not_stored_when_the_keyring_refuses_the_write() -> None:
    keyring.set_keyring(RefusingKeyring())

    with pytest.raises(ApiKeyNotStoredError) as error:
        store_api_key("k3y-t0k3n")

    assert error.value.code == "api_key_not_stored"
    assert "k3y-t0k3n" not in str(error.value)
    assert error.value.params == {}


def test_raises_keyring_unavailable_without_backend() -> None:
    # `fail.Keyring.__init__` (herite de `KeyringBackend`) n'annote pas son retour.
    keyring.set_keyring(fail.Keyring())  # type: ignore[no-untyped-call]

    with pytest.raises(KeyringUnavailableError) as error:
        store_api_key("k3y-t0k3n")

    assert error.value.code == "keyring_unavailable"
