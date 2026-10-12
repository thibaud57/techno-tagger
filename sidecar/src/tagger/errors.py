"""Base de toutes les erreurs metier du sidecar, et celles que plusieurs domaines levent.

Le `code` et les `params` vivent en attributs et non dans le message : c'est ce que
serialise l'evenement `error` du protocole NDJSON, l'interface se chargeant de la
traduction (cf. ARCHITECTURE.md § API). Le message reste en anglais, destine aux
logs et non a l'utilisateur.
"""

from typing import ClassVar


class TaggerError(Exception):
    """Erreur metier du sidecar, porteuse d'un code stable et de parametres."""

    code: ClassVar[str] = "unknown_error"

    def __init__(self, message: str, **params: object) -> None:
        super().__init__(message)
        self.params: dict[str, object] = params


class RunNotFoundError(TaggerError):
    """Ni plan ni rapport pour ce run : supprime entre l'annonce et le geste, ou inconnu."""

    code: ClassVar[str] = "run_not_found"

    def __init__(self, run_id: str) -> None:
        super().__init__(f"run not found: {run_id}", run_id=run_id)
