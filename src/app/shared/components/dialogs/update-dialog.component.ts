import { Component, ElementRef, computed, inject, viewChild } from "@angular/core"
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
 * Gabarit de l'invite de reprise, mais fermable vers le badge (DESIGN.md § Arbitrages). Aucun
 * bouton focalise a l'ouverture, comme elle : le focus va au corps de la modale, sans quoi il
 * reste derriere le masque et Tab parcourt la page.
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
      <!-- Largeur mesuree sur la Dialog d'AppShell. -->
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
        (onShow)="focusBody()"
      >
        <ng-template #header let-ariaLabelledBy="ariaLabelledBy">
          <h3 class="text-lg font-semibold" [id]="ariaLabelledBy">
            {{ "update.title" | translate }}
          </h3>
        </ng-template>

        @switch (state().kind) {
          @case ("downloading") {
            <div #body tabindex="-1" class="flex flex-col gap-4" [animate.enter]="fadeIn">
              <app-phase-progress
                [label]="'update.downloading' | translate"
                [counter]="counter()"
                [value]="percent()"
              />
              <p class="text-sm text-muted-color">{{ "update.closing" | translate }}</p>
            </div>
          }
          @case ("failed") {
            <app-message #body tabindex="-1" severity="error" [animate.enter]="fadeIn">{{
              "update.failed" | translate
            }}</app-message>
          }
          @default {
            <div
              #body
              tabindex="-1"
              class="flex flex-col gap-2 text-sm whitespace-pre-line text-muted-color"
              [animate.enter]="fadeIn"
            >
              @if (installFailed()) {
                <app-message severity="warn">{{ "update.installFailed" | translate }}</app-message>
              }
              <p>
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
                  class="self-start"
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
              (click)="confirm()"
            >
              {{ (retryable() ? "update.retry" : "update.install") | translate }}
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
  protected readonly downloading = this.service.downloading
  protected readonly tooltip = TOOLTIP
  protected readonly fadeIn = FADE_IN
  private readonly dialog = viewChild(Dialog)
  // `read: ElementRef` : `#body` tombe sur un composant (`app-message`) dans l'etat echec.
  private readonly body = viewChild("body", { read: ElementRef })

  protected readonly installFailed = this.service.installFailed
  protected readonly failed = computed(() => this.state().kind === "failed")
  protected readonly retryable = computed(() => this.failed() || this.installFailed() !== null)

  private readonly progress = computed(() => {
    const state = this.state()

    return state.kind === "downloading" ? state.progress : null
  })

  /** Sans total connu, la barre reste indeterminee. */
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
    if (visible) {
      return
    }
    if (this.downloading()) {
      // PrimeNG ne lit `closable` et `closeOnEscape` qu'a l'ouverture : Echap ferme la modale en
      // interne sans que `dialogVisible` le sache. Elle disparaitrait en plein telechargement,
      // progression et echec avec elle, et `dismiss()` masquerait ensuite le badge.
      this.dialog()?.visible.set(true)

      return
    }
    this.service.dismiss()
  }

  protected focusBody(): void {
    const element: unknown = this.body()?.nativeElement
    if (element instanceof HTMLElement) {
      element.focus()
    }
  }

  protected later(): void {
    this.service.dismiss()
  }

  protected confirm(): void {
    void (this.failed() ? this.service.retry() : this.service.install())
  }

  protected openNotes(releasePage: string): void {
    this.native.openUrl(releasePage).catch((error: unknown) => {
      console.error("[update-dialog] page de la Release non ouverte", error)
    })
  }
}
