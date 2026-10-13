"""Fichiers horodates d'un run sous `appLocalDataDir()`, partages par les dumps et les plans.

Le nom s'ouvre sur l'horodatage de creation : age et ordre se lisent sans ouvrir le fichier.
"""

import contextlib
import json
import logging
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Final, Protocol

from pydantic import BaseModel, ValidationError

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

logger = logging.getLogger(__name__)

PENDING_SUFFIX: Final = ".tmp"
# Jamais `isoformat()` dans un nom de fichier : ses `:` sont interdits sous Windows.
TIMESTAMP_FORMAT: Final = "%Y%m%dT%H%M%SZ"
# Une seule duree pour les dumps et les plans : un run reste annulable aussi longtemps que repris.
RETENTION: Final = timedelta(days=30)


class Unreadable(Protocol):
    """Erreur d'un fichier de run illisible : `found` porte la version de schema trouvee."""

    def __call__(self, path: Path, found: int | str | None = None, /) -> Exception: ...


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


def find_by_run_id(folder: Path, suffix: str, run_id: str) -> Path | None:
    """Fichier d'un run ; compare, jamais glob : un `*` designerait tout."""
    return next((path for path in newest_first(folder, suffix) if run_id_of(path) == run_id), None)


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
    path: Path,
    model: type[Model],
    current: int,
    unreadable: Unreadable,
    *,
    migrates: bool = False,
) -> Model:
    """Relit un fichier de run de schema `current`.

    Deux politiques (ADR-018) : par defaut, seule la version courante se lit, jamais migree
    (plan et dump, jetables) ; `migrates` lit aussi une version passee, que le modele migre
    (rapport, permanent). Une version future est refusee dans les deux cas.
    """
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise unreadable(path) from exc

    found = raw.get("schema_version") if isinstance(raw, dict) else None
    # Entier ou chaine seuls : un JSON corrompu ou sans version n'a rien a rapporter.
    reported = found if isinstance(found, int | str) else None
    readable = (isinstance(found, int) and found <= current) if migrates else found == current
    if not readable:
        raise unreadable(path, reported)
    try:
        return model.model_validate(raw)
    except ValidationError as exc:
        # Version lisible, contenu invalide : un fichier corrompu, pas une autre version.
        raise unreadable(path) from exc


def unlink_logged(path: Path, label: str) -> None:
    """Un fichier verrouille (editeur, antivirus) ne doit pas bloquer les suivants : on logue."""
    try:
        path.unlink(missing_ok=True)
    except OSError:
        logger.warning("%s run=%s reason=unlink_failed", label, run_id_of(path))


def purge_stamped(
    folder: Path,
    suffixes: tuple[str, ...],
    now: datetime,
    label: str,
    *,
    also_drop: Callable[[Path], bool] = lambda _path: False,
) -> None:
    """Supprime les fichiers horodates passes la retention, ou que `also_drop` condamne."""
    if not folder.is_dir():
        return
    for path in folder.iterdir():
        if path.suffix not in suffixes:
            continue
        created = created_at_of(path)
        if created is None:
            continue
        if now - created > RETENTION or also_drop(path):
            unlink_logged(path, label)
