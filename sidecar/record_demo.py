"""Reenregistre le scenario et les pochettes de la demo web dans `src/demo/` (ADR-023).

    uv run python record_demo.py     # ou `just record-demo`

Sous Windows seulement : l'enregistrement a besoin d'un fichier tenu verrouille.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "tests" / "helpers"))

from demo_recording import DEMO_FOLDER, record_demo_folder


def main() -> int:
    scenario, covers = record_demo_folder(DEMO_FOLDER)

    replies = len(scenario.stateless) + len(scenario.stateful)
    print(f"{replies} reponses, {len(covers)} pochettes : {DEMO_FOLDER}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
