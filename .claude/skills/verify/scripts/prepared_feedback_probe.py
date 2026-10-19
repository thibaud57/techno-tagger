"""Reponses de `prepare_feedback` relevees dans la sortie brute d'un run de `drive.py`.

Usage : `prepared_feedback_probe.py <sortie.ndjson>`, la sortie etant le second argument de
`drive.py` (le verdict de `drive.py` rogne les champs `url` et `export_path`, `params` des erreurs
compris, et ne suffit pas).

Pour chaque `feedback_ready` : longueur de l'URL (borne a 2048), formulaire cible, absence de
`labels`, fichier d'export present sous un dossier `feedback`, nomme dans le champ `export` de
l'URL. Pour chaque `error` d'une commande `prepare_feedback` : code et `params`. Le fichier et le
`run_id` d'une erreur d'ecriture se lisent dans `params`.
"""

import json
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from _probe import emit, fail

from tagger import REPOSITORY_URL
from tagger.reports.feedback import EXPORT_FIELD, ISSUE_TEMPLATE, MAX_URL_LENGTH


def _ready(event: dict[str, object]) -> dict[str, object]:
    url = str(event["url"])
    export = Path(str(event["export_path"]))
    parts = urlsplit(url)
    query = parse_qs(parts.query)
    return {
        "run_id": event["run_id"],
        "url_length": len(url),
        "within_budget": len(url) <= MAX_URL_LENGTH,
        "target": f"{parts.scheme}://{parts.netloc}{parts.path}" == f"{REPOSITORY_URL}/issues/new",
        "template": query.get("template") == [ISSUE_TEMPLATE],
        "has_labels": "labels" in query,
        "export_in_feedback_dir": export.parent.name == "feedback",
        "export_exists": export.is_file(),
        "export_named_in_url": query.get(EXPORT_FIELD) == [f"Drop {export.name} here"],
        "export_name": export.name,
    }


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage : prepared_feedback_probe.py <sortie.ndjson de drive.py>")
    events = [
        json.loads(line)
        for line in Path(sys.argv[1]).read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    refusals = [
        {"code": event["code"], "params": event["params"]}
        for event in events
        if event.get("event") == "error" and event.get("command") == "prepare_feedback"
    ]
    emit(
        {
            "success": True,
            "ready": [_ready(event) for event in events if event.get("event") == "feedback_ready"],
            "refusals": refusals,
        }
    )


main()
