"""Base des modeles pydantic ecrits sur le disque (dumps, plans, rapports, index)."""

from pydantic import BaseModel, ConfigDict


class StrictFrozenModel(BaseModel):
    """Immuable et ferme : un champ inconnu signale un fichier d'une autre version ou corrompu."""

    model_config = ConfigDict(frozen=True, extra="forbid")
