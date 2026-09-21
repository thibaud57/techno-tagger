"""Trousseaux de test : aucun test ne touche le Credential Manager de la machine."""

from typing import override

from keyring.backend import KeyringBackend
from keyring.errors import KeyringError, PasswordSetError


class MemoryKeyring(KeyringBackend):
    """Secrets gardes en memoire, pour le temps d'un test."""

    priority = 1

    def __init__(self) -> None:
        # `KeyringBackend.__init__` n'annote pas son retour, ce qui declenche
        # `no-untyped-call` en mode strict (cf. `audio_samples.py` pour le meme cas avec mutagen).
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
