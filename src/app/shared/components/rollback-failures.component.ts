import { Component, input } from "@angular/core"
import { TranslatePipe } from "@ngx-translate/core"

import type { RollbackFailure } from "../../core/models/protocol"

import { MessageComponent } from "./message.component"

/** Fichiers qu'un rollback a laisses en l'etat, avec la phrase de leur motif. */
@Component({
  selector: "app-rollback-failures",
  imports: [MessageComponent, TranslatePipe],
  template: `
    @if (failures().length > 0) {
      <app-message severity="error" data-rollback-failures>
        <div class="flex flex-col gap-2">
          <span>{{ "rollback.failures" | translate: { count: failures().length } }}</span>
          <ul class="flex flex-col gap-2">
            @for (row of failures(); track row.track_id) {
              <li>
                {{
                  "rollback.failure"
                    | translate
                      : {
                          file: row.file_name,
                          reason: ("rollback.reason." + row.reason | translate),
                        }
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
}
