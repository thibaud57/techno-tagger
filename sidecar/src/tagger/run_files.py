"""Fichiers horodates d'un run sous `appLocalDataDir()`, partages par les dumps et les plans.

Le nom s'ouvre sur l'horodatage de creation : age et ordre se lisent sans ouvrir le fichier.
"""

import contextlib
import json
import logging
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Final, Protocol

from pydantic import BaseModel, ValidationError

from tagger.reports import TIMESTAMP_FORMAT

if TYPE_CHECKING:
    from pathlib import Path

logger = logging.getLogger(__name__)

PENDING_SUFFIX: Final = ".tmp"
# Une seule duree pour les dumps et les plans : un run reste annulable aussi longtemps que repris.
RETENTION: Final = timedelta(days=30)


class Unreadable(Protocol):
    """Erreur d'un fichier de run illisible : `found` porte la version de schema trouvee."""

    def __call__(self, path: Path, found: object = None, /) -> Exception: ...


def stamped_name(created_at: datetime, run_id: str, suffix: str) -> str:
    """`<horodatage UTC>-<run_id><suffix>`, quel que soit le decalage de `created_at`."""
    stamp = created_at.astimezone(UTC).strftime(TIMESTAMP_FORMAT)
    return f"{stamp}-{run_id}{suffix}"


def created_at_of(path: Path) -> datetime | None:
    """Horodatage lu sur le nom, `None` pour un nom qui n'en porte pas."""
    stamp, _, _ = path.stem.partition("-")
    try:
        return datetime.strptime(stamp, TIMESTAMP_FORMAT).replace(tzinfo=UTC)
    except ValueError:
        return None


def run_id_of(path: Path) -> str:
    """Identifiant du run, quel que soit le suffixe du fichier (`.json`, `.tmp`, journal)."""
    _, _, run_id = path.name.partition("-")
    return run_id.partition(".")[0]


def newest_first(folder: Path, suffix: str) -> list[Path]:
    """Fichiers en `suffix` du plus recent au plus ancien ; tout nom non horodate est ecarte."""
    if not folder.is_dir():
        return []
    stamped = (path for path in folder.glob(f"*{suffix}") if created_at_of(path) is not None)
    return sorted(stamped, reverse=True)


def write_atomically(path: Path, text: str) -> None:
    """Temporaire voisin puis remplacement : une coupure ne laisse jamais un fichier tronque.

    Leve `OSError`, que l'appelant traduit dans son domaine.
    """
    pending = path.with_suffix(PENDING_SUFFIX)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        pending.write_text(text, encoding="utf-8")
        pending.replace(path)
    except OSError:
        with contextlib.suppress(OSError):
            pending.unlink(missing_ok=True)
        raise


def read_versioned[Model: BaseModel](
    path: Path, model: type[Model], version: int, unreadable: Unreadable
) -> Model:
    """Relit un fichier de run ; une version inconnue est refusee, jamais migree (ADR-018)."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise unreadable(path) from exc

    found = raw.get("schema_version") if isinstance(raw, dict) else None
    if found != version:
        raise unreadable(path, found)
    try:
        return model.model_validate(raw)
    except ValidationError as exc:
        raise unreadable(path, found) from exc


def unlink_logged(path: Path, label: str) -> None:
    """Un fichier verrouille (editeur, antivirus) ne doit pas bloquer les suivants : on logue."""
    try:
        path.unlink(missing_ok=True)
    except OSError:
        logger.warning("%s run=%s reason=unlink_failed", label, run_id_of(path))
