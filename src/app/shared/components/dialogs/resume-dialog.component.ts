import { Component, computed, inject } from "@angular/core"
import { Router } from "@angular/router"
import { TranslatePipe, TranslateService } from "@ngx-translate/core"
import { ButtonDirective } from "primeng/button"
import { Dialog } from "primeng/dialog"

import type { InterruptedRun } from "../../../core/sidecar/protocol"
import { SidecarService } from "../../../core/sidecar/sidecar.service"
import { FADE_IN } from "../../utils/motion"
import { runDate } from "../../utils/run-date"

import { TruncatedTextComponent } from "../display/truncated-text.component"

/**
 * Invite non fermable : le run interrompu attend un choix. « Plus tard » n'existe que pour un
 * dossier introuvable, qu'un disque rebranche rendra reprenable au lancement suivant. Aucun
 * focus a l'ouverture : le premier bouton est « Repartir de zero » et Entree supprimerait le plan.
 */
@Component({
  selector: "app-resume-dialog",
  imports: [Dialog, ButtonDirective, TranslatePipe, TruncatedTextComponent],
  template: `
    @if (run(); as detected) {
      <!-- Largeur de la Dialog d'AppShell (DESIGN.md § Structure de Page). -->
      <p-dialog
        [visible]="true"
        [modal]="true"
        [closable]="false"
        [draggable]="false"
        [resizable]="false"
        [focusOnShow]="false"
        styleClass="w-120"
      >
        <ng-template #header>
          <h3 class="text-lg font-semibold">{{ "resume.title" | translate }}</h3>
        </ng-template>

        <div
          class="flex flex-col gap-2 text-sm whitespace-pre-line text-muted-color"
          [animate.enter]="fadeIn"
        >
          @if (detected.kind === "unreadable") {
            <p>
              {{
                (detected.found === null
                  ? "resume.unreadable.corrupted"
                  : "resume.unreadable.version"
                ) | translate: { found: detected.found, expected: detected.expected }
              }}
            </p>
          } @else {
            <p>{{ "resume.summary" | translate: summary() }}</p>
            <app-truncated-text class="text-color" direction="rtl" [text]="detected.folder" />
            <p>
              {{ (detected.folder_missing ? "resume.folderMissing" : "resume.safe") | translate }}
            </p>
          }
        </div>

        <ng-template #footer>
          @if (detected.kind === "interrupted" && detected.folder_missing) {
            <button
              pButton
              type="button"
              size="small"
              [text]="true"
              severity="secondary"
              data-action="later"
              (click)="later()"
            >
              {{ "resume.later" | translate }}
            </button>
          }
          <button
            pButton
            type="button"
            size="small"
            [text]="true"
            severity="secondary"
            data-action="discard"
            (click)="discard(detected.run_id)"
          >
            {{ "resume.discard" | translate }}
          </button>
          @if (detected.kind === "interrupted" && !detected.folder_missing) {
            <button
              pButton
              type="button"
              size="small"
              data-action="resume"
              (click)="resume(detected)"
            >
              {{ "resume.resume" | translate }}
            </button>
          }
        </ng-template>
      </p-dialog>
    }
  `,
})
export class ResumeDialogComponent {
  private readonly sidecar = inject(SidecarService)
  private readonly router = inject(Router)
  private readonly translate = inject(TranslateService)

  protected readonly run = this.sidecar.interruptedRun
  protected readonly fadeIn = FADE_IN
  protected readonly summary = computed(() => {
    const run = this.run()

    return run?.kind === "interrupted"
      ? {
          date: runDate(run.started_at, this.translate.currentLang()),
          processed: run.processed,
          total: run.total,
        }
      : null
  })

  protected async resume(run: InterruptedRun): Promise<void> {
    if (await this.sidecar.resume(run)) {
      void this.router.navigate(["tagging"])
    }
  }

  protected discard(runId: string): void {
    void this.sidecar.discard(runId)
  }

  protected later(): void {
    this.sidecar.dismissInterruptedRun()
  }
}
