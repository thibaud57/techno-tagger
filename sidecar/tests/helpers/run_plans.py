"""Plans de run : fabriques en memoire, puis lecture sur le disque du dossier de donnees
isole par la fixture `app_data`.
"""

from typing import TYPE_CHECKING, Final

from tagging_api import CREATED, tagged_mp3

from tagger.resolution.matching import DEFAULT_THRESHOLDS
from tagger.run.models import LiveRun, TrackRecord
from tagger.run.plan import RunPlan, load_plan, plan_dir, plan_path
from tagger.tags.files import IdentityTags

if TYPE_CHECKING:
    from collections.abc import Sequence
    from datetime import datetime
    from pathlib import Path

RUN_ID: Final = "a3f9c1"


def _letters(number: int) -> str:
    """Deux lettres par morceau : un chiffre dans le titre changerait la requete nettoyee."""
    return chr(97 + number // 26) + chr(97 + number % 26)


def music(folder: Path, count: int) -> list[TrackRecord]:
    """Morceaux de Adam Beyer, « Mind aa »..., sur `count` MP3 tagues `t000.mp3`..."""
    records: list[TrackRecord] = []
    for number in range(count):
        name, title = f"t{number:03d}.mp3", f"Mind {_letters(number)}"
        path = tagged_mp3(folder, name, "Adam Beyer", title)
        identity = IdentityTags(artist="Adam Beyer", title=title)
        records.append(TrackRecord(track_id=name, path=path, identity=identity))
    return records


def plan_of(
    folder: Path,
    records: Sequence[TrackRecord],
    *,
    run_id: str = RUN_ID,
    started_at: datetime = CREATED,
    committed: bool = False,
) -> RunPlan:
    plan = RunPlan.opened(LiveRun(run_id, folder, records), DEFAULT_THRESHOLDS, started_at)
    return plan.model_copy(update={"committed": committed})


def save_plan(plans: Path, plan: RunPlan) -> Path:
    """Ecrit le plan sous son nom horodate, dossier cree au besoin."""
    path = plan_path(plans, plan)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(plan.model_dump_json(), encoding="utf-8")
    return path


def plan_files() -> list[Path]:
    """Plans du dossier de donnees, temporaires exclus."""
    folder = plan_dir()
    return sorted(folder.glob("*.json")) if folder.is_dir() else []


def only_plan() -> RunPlan:
    """Le plan unique du dossier de donnees ; echoue s'il y en a zero ou plusieurs."""
    files = plan_files()
    assert len(files) == 1, files
    return load_plan(files[0])
