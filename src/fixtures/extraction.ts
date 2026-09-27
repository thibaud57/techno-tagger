import type { ExtractionFinishedEvent } from "../app/core/models/protocol"

// Resultat d'extraction partage par les specs : vide, chaque test pose ses listes par spread.

export const EMPTY_EXTRACTION: ExtractionFinishedEvent = {
  event: "extraction_finished",
  extracted: [],
  already_present: [],
  missing: [],
  duplicates: [],
  failures: [],
  report_path: "C:/work/report.json",
}
