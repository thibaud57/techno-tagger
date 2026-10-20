import { Component, computed, inject } from "@angular/core"
import { TranslatePipe, TranslateService } from "@ngx-translate/core"
import { ButtonDirective } from "primeng/button"
import { Dialog } from "primeng/dialog"
import { Tooltip } from "primeng/tooltip"

import { languageFromTag } from "../../../core/i18n/language"
import { NativeService } from "../../../core/platform/native.service"
import { UpdateService } from "../../../core/platform/update.service"
import { formatBytes } from "../../utils/bytes"
import { FADE_IN } from "../../utils/motion"
import { progressPercentage } from "../../utils/progress"
import { TOOLTIP } from "../../utils/tooltip"
import { IconComponent } from "../display/icon.component"
import { PhaseProgressComponent } from "../display/phase-progress.component"
import { MessageComponent } from "../feedback/message.component"

/**
 * Gabarit de l'invite de reprise, mais fermable : la croix et « Plus tard » renvoient au badge
 * (DESIGN.md § Arbitrages). Non fermable pendant le telechargement, l'installation suivant
 * sans autre geste.
 */
@Component({
  selector: "app-update-dialog",
  imports: [
    Dialog,
    ButtonDirective,
    Tooltip,
    TranslatePipe,
    IconComponent,
    PhaseProgressComponent,
    MessageComponent,
  ],
  template: `
    @if (update(); as offered) {
      <!-- Largeur de l'invite de reprise, mesuree sur la Dialog d'AppShell. -->
      <p-dialog
        [visible]="visible()"
        (visibleChange)="onVisibleChange($event)"
        [modal]="true"
        [closable]="!downloading()"
        [closeOnEscape]="!downloading()"
        [draggable]="false"
        [resizable]="false"
        [focusOnShow]="false"
        styleClass="w-120"
        [closeAriaLabel]="'update.later' | translate"
      >
        <ng-template #header>
          <h3 class="m-0 text-lg font-semibold">{{ "update.title" | translate }}</h3>
        </ng-template>

        @switch (state().kind) {
          @case ("downloading") {
            <div class="flex flex-col gap-4" [animate.enter]="fadeIn">
              <app-phase-progress
                [label]="'update.downloading' | translate"
                [counter]="counter()"
                [value]="percent()"
              />
              <p class="m-0 text-sm text-muted-color">{{ "update.closing" | translate }}</p>
            </div>
          }
          @case ("failed") {
            <app-message severity="error" [animate.enter]="fadeIn">{{
              "update.failed" | translate
            }}</app-message>
          }
          @default {
            <div
              class="flex flex-col gap-2 text-sm whitespace-pre-line text-muted-color"
              [animate.enter]="fadeIn"
            >
              <p class="m-0">
                {{
                  "update.available"
                    | translate: { version: offered.version, current: offered.currentVersion }
                }}
              </p>
              @if (offered.releasePage; as releasePage) {
                <button
                  pButton
                  type="button"
                  [link]="true"
                  class="self-start border-0 p-0 text-xs"
                  data-action="notes"
                  (click)="openNotes(releasePage)"
                >
                  {{ "update.notes" | translate }}
                  <app-icon name="external-link" [size]="16" />
                </button>
              }
            </div>
          }
        }

        <ng-template #footer>
          @if (!downloading()) {
            <button
              pButton
              type="button"
              size="small"
              [text]="true"
              severity="secondary"
              data-action="later"
              (click)="later()"
            >
              {{ "update.later" | translate }}
            </button>
            <button
              pButton
              type="button"
              size="small"
              data-action="install"
              [disabled]="!installable()"
              [pTooltip]="installable() ? undefined : ('update.busy' | translate)"
              [tooltipOptions]="tooltip"
              (click)="failed() ? retry() : install()"
            >
              {{ (failed() ? "update.retry" : "update.install") | translate }}
            </button>
          }
        </ng-template>
      </p-dialog>
    }
  `,
})
export class UpdateDialogComponent {
  private readonly service = inject(UpdateService)
  private readonly translate = inject(TranslateService)
  private readonly native = inject(NativeService)

  protected readonly state = this.service.state
  protected readonly update = this.service.update
  protected readonly visible = this.service.dialogVisible
  protected readonly installable = this.service.installable
  protected readonly tooltip = TOOLTIP
  protected readonly fadeIn = FADE_IN

  protected readonly downloading = computed(() => this.state().kind === "downloading")
  protected readonly failed = computed(() => this.state().kind === "failed")

  private readonly progress = computed(() => {
    const state = this.state()

    return state.kind === "downloading" ? state.progress : null
  })

  /** Absent tant que le total n'est pas connu : la barre tourne alors en continu. */
  protected readonly percent = computed(() => {
    const progress = this.progress()

    return progressPercentage(
      progress && { processed: progress.received, total: progress.total ?? 0 },
    )
  })

  protected readonly counter = computed(() => {
    const progress = this.progress()
    if (!progress?.total) {
      return undefined
    }
    const language = languageFromTag(this.translate.currentLang())

    return this.translate.instant("update.counter", {
      received: formatBytes(progress.received, language),
      total: formatBytes(progress.total, language),
    }) as string
  })

  protected onVisibleChange(visible: boolean): void {
    if (!visible) {
      this.service.dismiss()
    }
  }

  protected later(): void {
    this.service.dismiss()
  }

  protected install(): void {
    void this.service.install()
  }

  protected retry(): void {
    void this.service.retry()
  }

  protected openNotes(releasePage: string): void {
    this.native.openUrl(releasePage).catch((error: unknown) => {
      console.error("[update-dialog] page de la Release non ouverte", error)
    })
  }
}
