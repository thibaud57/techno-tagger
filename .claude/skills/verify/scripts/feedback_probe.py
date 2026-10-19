"""Issue de retour de matching sur le rapport REEL d'un run, hors protocole.

Deux temps autour d'un run de `drive.py` sur la fixture par defaut :

- `plant <dossier>` : pose un commentaire d'origine sur chaque MP3 et les range dans un
  sous-dossier, la fixture n'en portant aucun (sans eux, le controle de fuite serait vide)
- `check <dossier>` : relit le dernier `tagging-report-*.json` ecrit par le run, construit
  l'URL de l'issue (`feedback_issue_url`) et ecrit l'export (`write_feedback_export`) sous le
  `feedback/` de `LOCALAPPDATA`, puis releve la longueur de l'URL, le formulaire cible, l'absence
  de `labels`, les fragments prives retrouves dans l'URL decodee et dans l'export (dossier du run,
  compte de l'OS, sous-dossier, commentaires d'origine) et le nom de l'export dans le champ `export`

Le dossier de la fixture vit sous le profil de l'utilisateur : son chemin porte le nom du compte
de l'OS, ce qui rend le controle de fuite non trivial.
"""

import getpass
import json
import sys
from pathlib import Path
from typing import Final
from urllib.parse import parse_qs, unquote_plus, urlsplit

from _probe import emit, fail

from tagger import RELEASE, REPOSITORY_URL
from tagger.reports.feedback import (
    EXPORT_FIELD,
    ISSUE_TEMPLATE,
    MAX_URL_LENGTH,
    SUMMARY_FIELD,
    feedback_dir,
    feedback_issue_url,
    write_feedback_export,
)
from tagger.reports.tagging import load_tagging_report

SUBFOLDER: Final = "Night Shift"
PLANTED_COMMENT: Final = "ripped from vinyl, probe"


def _plant(folder: Path) -> None:
    # Importe ici : `check` n'a pas besoin de mutagen.
    from mutagen.id3 import COMM, ID3  # noqa: PLC0415

    target = folder / SUBFOLDER
    target.mkdir(exist_ok=True)
    moved = 0
    for path in sorted(folder.glob("*.mp3")):
        tags = ID3(path)
        tags.add(COMM(encoding=3, lang="eng", desc="", text=[PLANTED_COMMENT]))
        tags.save(path)
        path.rename(target / path.name)
        moved += 1
    emit({"success": True, "moved": moved, "subfolder": SUBFOLDER})


def _check(folder: Path) -> None:
    reports = sorted(folder.glob("tagging-report-*.json"))
    if not reports:
        fail(f"aucun tagging-report-*.json dans {folder.as_posix()} : lancer drive.py d'abord")
    report = load_tagging_report(reports[-1])

    export = write_feedback_export(feedback_dir(), report, RELEASE)
    url = feedback_issue_url(report, RELEASE, export.name)
    # Sans le depot : son nom peut contenir celui du compte de l'OS (faux positif releve le 2026-10-19).
    decoded = unquote_plus(url).removeprefix(REPOSITORY_URL)
    exported = export.read_text(encoding="utf-8")

    comments = {track.comment_before for track in report.tracks if track.comment_before}
    private = {
        "run_folder": str(report.folder),
        "run_folder_posix": report.folder.as_posix(),
        "os_account": getpass.getuser(),
        "subfolder": SUBFOLDER,
        **{f"comment:{comment}": comment for comment in comments},
    }
    query = parse_qs(urlsplit(url).query)
    parts = urlsplit(url)
    emit(
        {
            "success": True,
            "tracks": len(report.tracks),
            "tracks_with_comment": sum(1 for track in report.tracks if track.comment_before),
            "tracks_in_subfolder": sum(1 for track in report.tracks if "/" in track.track_id),
            "url_length": len(url),
            "within_budget": len(url) <= MAX_URL_LENGTH,
            "target": f"{parts.scheme}://{parts.netloc}{parts.path}"
            == f"{REPOSITORY_URL}/issues/new",
            "template": query.get("template") == [ISSUE_TEMPLATE],
            "has_labels": "labels" in query,
            "export_field_names_the_file": query[EXPORT_FIELD] == [f"Drop {export.name} here"],
            "summary_rows": sum(
                1 for line in query[SUMMARY_FIELD][0].splitlines() if line.startswith("| `")
            ),
            "leaks_in_url": [name for name, value in private.items() if value in decoded],
            "leaks_in_export": [name for name, value in private.items() if value in exported],
            "export_keys": sorted(json.loads(exported)),
            "export_name": export.name,
            "feedback_files": sorted(path.name for path in feedback_dir().iterdir()),
        }
    )


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] not in {"plant", "check"}:
        fail("usage : feedback_probe.py <plant|check> <dossier de la fixture>")
    folder = Path(sys.argv[2])
    if not folder.is_dir():
        fail(f"dossier introuvable : {folder.as_posix()}")
    (_plant if sys.argv[1] == "plant" else _check)(folder)


main()
