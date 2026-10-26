"""Trousseaux de test : aucun test ne touche le Credential Manager de la machine."""

from contextlib import contextmanager
from typing import TYPE_CHECKING, override

import keyring
from keyring.backend import KeyringBackend
from keyring.errors import KeyringError, PasswordSetError

# Meme classe que celle que `WinVaultKeyring` laisse passer : non typee, sans `py.typed`.
from win32ctypes.pywin32.pywintypes import error as win32_error  # type: ignore[import-untyped]

if TYPE_CHECKING:
    from collections.abc import Iterator


class MemoryKeyring(KeyringBackend):
    """Secrets gardes en memoire, pour le temps d'un test."""

    priority = 1

    def __init__(self) -> None:
        # `KeyringBackend.__init__` n'annote pas son retour : `no-untyped-call` en mode strict.
        super().__init__()  # type: ignore[no-untyped-call]
        self.secrets: dict[tuple[str, str], str] = {}

    @override
    def get_password(self, service: str, username: str) -> str | None:
        return self.secrets.get((service, username))

    @override
    def set_password(self, service: str, username: str, password: str) -> None:
        self.secrets[(service, username)] = password

    @override
    def delete_password(self, service: str, username: str) -> None:
        self.secrets.pop((service, username), None)


@contextmanager
def installed(backend: MemoryKeyring) -> Iterator[MemoryKeyring]:
    """Pose `backend` comme trousseau du process, le precedent restaure a la sortie."""
    previous = keyring.get_keyring()
    keyring.set_keyring(backend)
    try:
        yield backend
    finally:
        keyring.set_keyring(previous)


class RefusingKeyring(MemoryKeyring):
    """Refuse l'ecriture, comme le Credential Manager sur un secret trop gros."""

    @override
    def set_password(self, service: str, username: str, password: str) -> None:
        raise PasswordSetError("refused")


class FailingKeyring(MemoryKeyring):
    """Echoue a la lecture, comme un trousseau verrouille."""

    @override
    def get_password(self, service: str, username: str) -> str | None:
        raise KeyringError("locked")


class CredentialManagerKeyring(MemoryKeyring):
    """Echoue comme `WinVaultKeyring` sur un `CredRead` / `CredWrite` en echec : l'erreur Win32
    brute, qui n'herite pas de `KeyringError`.
    """

    @override
    def get_password(self, service: str, username: str) -> str | None:
        raise win32_error(5, "CredRead", "Access is denied.")

    @override
    def set_password(self, service: str, username: str, password: str) -> None:
        raise win32_error(1783, "CredWrite", "The stub received bad data")
