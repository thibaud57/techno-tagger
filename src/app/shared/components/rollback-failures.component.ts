import { Component, computed, input } from "@angular/core"
import { TranslatePipe } from "@ngx-translate/core"

import type { RollbackFailure } from "../../core/models/protocol"

import { MessageComponent } from "./message.component"

/** Fichiers qu'un rollback a laisses en l'etat, avec la phrase de leur motif. */
@Component({
  selector: "app-rollback-failures",
  imports: [MessageComponent, TranslatePipe],
  template: `
    @if (rows().length > 0) {
      <app-message severity="error" data-rollback-failures>
        <div class="flex flex-col gap-2">
          <span>{{ "rollback.failures" | translate: { count: rows().length } }}</span>
          <ul class="flex flex-col gap-1">
            @for (row of rows(); track row.trackId) {
              <li>
                {{
                  "rollback.failure"
                    | translate: { file: row.file, reason: (row.reasonKey | translate) }
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
      file: failure.file_name,
      reasonKey: `rollback.reason.${failure.reason}`,
    })),
  )
}
