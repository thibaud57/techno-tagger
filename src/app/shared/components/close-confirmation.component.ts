import { Component, ElementRef, afterRenderEffect, inject, viewChild } from "@angular/core"
import { TranslatePipe } from "@ngx-translate/core"
import { ButtonDirective } from "primeng/button"
import { Dialog } from "primeng/dialog"

import { CloseGuard } from "../../core/close-guard.service"

/** `p-dialog` et non `p-confirmdialog`, reserve aux actions qui touchent aux fichiers musicaux. */
@Component({
  selector: "app-close-confirmation",
  imports: [Dialog, ButtonDirective, TranslatePipe],
  template: `
    <!-- Mesuree sur le titre et les deux boutons en francais. -->
    <p-dialog
      [visible]="request() !== null"
      (visibleChange)="onVisibleChange($event)"
      [modal]="true"
      [draggable]="false"
      [resizable]="false"
      [closeOnEscape]="true"
      [focusOnShow]="false"
      styleClass="w-128"
      [closeAriaLabel]="'app.close.stay' | translate"
    >
      <ng-template #header>
        <h3 class="m-0 text-lg font-semibold">{{ "app.close.title" | translate }}</h3>
      </ng-template>

      <ul class="flex flex-col gap-2 text-sm">
        @for (work of request() ?? []; track work.kind) {
          <li>{{ "app.close." + work.kind | translate: work }}</li>
        }
      </ul>

      <ng-template #footer>
        <button
          pButton
          type="button"
          size="small"
          [outlined]="true"
          severity="secondary"
          data-action="leave"
          (click)="leave()"
        >
          {{ "app.close.leave" | translate }}
        </button>
        <button #stay pButton type="button" size="small" data-action="stay" (click)="stayOpen()">
          {{ "app.close.stay" | translate }}
        </button>
      </ng-template>
    </p-dialog>
  `,
})
export class CloseConfirmationComponent {
  private readonly guard = inject(CloseGuard)

  protected readonly request = this.guard.request

  private readonly stayButton = viewChild("stay", { read: ElementRef })

  constructor() {
    // Focus pose par code : `autofocus` est interdit par `templateAccessibility`, et le
    // `focusOnShow` du dialog le donnerait au premier bouton, « Quitter quand meme ».
    afterRenderEffect({
      write: () => {
        const button = this.stayButton()?.nativeElement as HTMLElement | undefined
        if (this.request() !== null) {
          button?.focus()
        }
      },
    })
  }

  protected onVisibleChange(visible: boolean): void {
    if (!visible) {
      this.stayOpen()
    }
  }

  protected stayOpen(): void {
    this.guard.stay()
  }

  protected leave(): void {
    void this.guard.leave()
  }
}
