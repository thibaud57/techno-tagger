import type { FeedbackReadyEvent } from "../app/core/sidecar/protocol"

import { RUN_ID } from "./tagging"

export const FEEDBACK_READY: FeedbackReadyEvent = {
  event: "feedback_ready",
  run_id: RUN_ID,
  url: "https://github.example/issues/new?template=matching-report.yml",
  export_path: String.raw`C:\data\feedback\20261006T211403Z-a3f9c1.json`,
}
