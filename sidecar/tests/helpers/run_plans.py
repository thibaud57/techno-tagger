"""Plans de run : fabriques en memoire, puis lecture sur le disque du dossier de donnees
isole par la fixture `app_data`.
"""

import json
from typing import TYPE_CHECKING

from audio_samples import tagged_mp3
from tagging_records import CREATED, MUSIC, RUN_ID

from tagger.core.identifiers import RunId, TrackId
from tagger.resolution.matching import DEFAULT_THRESHOLDS
from tagger.run.models import LiveRun, TrackRecord, Waiting
from tagger.run.plan import RunPlan, load_plan, plan_dir, plan_path
from tagger.tags.files import IdentityTags

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence
    from datetime import datetime
    from pathlib import Path


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
        records.append(
            TrackRecord(track_id=TrackId(name), path=path, identity=identity, outcome=Waiting())
        )
    return records


def plan_of(
    folder: Path,
    records: Sequence[TrackRecord],
    *,
    run_id: RunId = RUN_ID,
    started_at: datetime = CREATED,
    committed: bool = False,
) -> RunPlan:
    plan = RunPlan.opened(LiveRun(run_id, folder, records), DEFAULT_THRESHOLDS, started_at)
    return plan.model_copy(update={"committed": committed})


def _save(plans: Path, plan: RunPlan, content: str) -> Path:
    path = plan_path(plans, plan)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path


def save_plan(plans: Path, plan: RunPlan) -> Path:
    """Ecrit le plan sous son nom horodate, dossier cree au besoin."""
    return _save(plans, plan, plan.model_dump_json())


def save_plan_document(plans: Path, tracks: Mapping[str, object]) -> Path:
    """Ecrit un plan dont les morceaux sont du JSON brut : un `PlanTrack` incoherent ne se
    construit plus, seul le disque peut en porter un."""
    plan = plan_of(MUSIC, [])
    document = plan.model_dump(mode="json") | {"tracks": tracks}
    return _save(plans, plan, json.dumps(document))


def plan_files() -> list[Path]:
    """Plans du dossier de donnees, temporaires exclus."""
    folder = plan_dir()
    return sorted(folder.glob("*.json")) if folder.is_dir() else []


def only_plan() -> RunPlan:
    """Le plan unique du dossier de donnees ; echoue s'il y en a zero ou plusieurs."""
    files = plan_files()
    assert len(files) == 1, files
    return load_plan(files[0])
