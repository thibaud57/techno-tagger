"""Base de toutes les erreurs metier du sidecar.

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
