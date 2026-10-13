import { AsyncPipe } from "@angular/common"
import { Component, computed, input } from "@angular/core"
import { TranslatePipe } from "@ngx-translate/core"

import type { RollbackFailure } from "../../../core/sidecar/protocol"

import { ReasonTextPipe, rollbackReasonKeys } from "../../utils/reason"

import { MessageComponent } from "../feedback/message.component"

/** Fichiers qu'un rollback a laisses en l'etat, avec la phrase de leur motif. */
@Component({
  selector: "app-rollback-failures",
  imports: [AsyncPipe, MessageComponent, ReasonTextPipe, TranslatePipe],
  template: `
    @if (failures().length > 0) {
      <app-message severity="error" data-rollback-failures>
        <div class="flex flex-col gap-2">
          <span>{{ "rollback.failures" | translate: { count: failures().length } }}</span>
          <ul class="flex flex-col gap-2">
            @for (row of rows(); track row.trackId) {
              <li>
                {{
                  "rollback.failure"
                    | translate: { file: row.fileName, reason: (row.reason | reasonText | async) }
                }}
              </li>
            }
          </ul>
        </div>
      </app-message>
    }
  `,
  // Hote vide dans une colonne : ni place ni gap.
  host: { class: "contents" },
})
export class RollbackFailuresComponent {
  readonly failures = input.required<readonly RollbackFailure[]>()

  protected readonly rows = computed(() =>
    this.failures().map((failure) => ({
      trackId: failure.track_id,
      fileName: failure.file_name,
      reason: rollbackReasonKeys(failure.reason),
    })),
  )
}
