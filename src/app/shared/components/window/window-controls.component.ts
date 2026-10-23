import { Component, DestroyRef, inject, signal } from "@angular/core"
import { TranslatePipe } from "@ngx-translate/core"

import { APP_WINDOW } from "../../../core/platform/app-window"

/** Windows emet un redimensionnement par pas de glisser : l'etat se relit une fois le geste fini. */
export const RESIZE_SETTLE_MS = 150

/** 46px : la largeur des boutons de legende de Windows 11, que l'utilisateur vise sans regarder. */
const CONTROL =
  "grid w-[46px] place-items-center text-muted-color transition-colors hover:bg-emphasis hover:text-color focus-visible:outline-1 focus-visible:-outline-offset-2 focus-visible:outline-primary"

/** Boutons de fenetre de la barre de titre maison (`decorations: false`). */
@Component({
  selector: "app-window-controls",
  imports: [TranslatePipe],
  template: `
    <button
      type="button"
      [class]="control"
      data-action="minimize"
      [attr.aria-label]="'window.minimize' | translate"
      [attr.title]="'window.minimize' | translate"
      (click)="minimize()"
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M0 5.5h10" stroke="currentColor" />
      </svg>
    </button>
    <button
      type="button"
      [class]="control"
      data-action="maximize"
      [attr.aria-label]="(maximized() ? 'window.restore' : 'window.maximize') | translate"
      [attr.title]="(maximized() ? 'window.restore' : 'window.maximize') | translate"
      (click)="toggleMaximize()"
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        @if (maximized()) {
          <path d="M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z" fill="none" stroke="currentColor" />
        } @else {
          <rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor" />
        }
      </svg>
    </button>
    <!-- Rouge de la croix de Windows, pris dans la palette d'Aura. Glyphes de 10px dessines ici :
         ni le jeu d'IconComponent ni ses tailles (16, 20, 24) n'ont ceux de Windows. -->
    <button
      type="button"
      [class]="control + ' hover:bg-(--p-red-600) hover:text-surface-0'"
      data-action="close"
      [attr.aria-label]="'window.close' | translate"
      [attr.title]="'window.close' | translate"
      (click)="close()"
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M.5.5l9 9M9.5.5l-9 9" stroke="currentColor" />
      </svg>
    </button>
  `,
  host: { class: "flex self-stretch" },
})
export class WindowControlsComponent {
  private readonly appWindow = inject(APP_WINDOW)
  private readonly destroyRef = inject(DestroyRef)

  protected readonly maximized = signal(false)
  protected readonly control = CONTROL

  private resizeTimer: ReturnType<typeof setTimeout> | undefined
  private destroyed = false

  private readonly report = (error: unknown): void => {
    console.error("[window] geste refuse", error)
  }

  constructor() {
    this.syncMaximized()
    this.destroyRef.onDestroy(() => {
      this.destroyed = true
      clearTimeout(this.resizeTimer)
    })
    // L'ecouteur peut arriver apres la destruction : la barre de l'ecran bloquant va et vient.
    this.appWindow
      .onResized(() => {
        clearTimeout(this.resizeTimer)
        this.resizeTimer = setTimeout(() => {
          this.syncMaximized()
        }, RESIZE_SETTLE_MS)
      })
      .then((unlisten) => {
        if (this.destroyed) {
          unlisten()
        } else {
          this.destroyRef.onDestroy(unlisten)
        }
      })
      .catch(this.report)
  }

  protected minimize(): void {
    this.appWindow.minimize().catch(this.report)
  }

  protected toggleMaximize(): void {
    this.appWindow.toggleMaximize().catch(this.report)
  }

  /** `close` et non `destroy` : la fermeture passe par la garde de sortie, comme la croix de l'OS. */
  protected close(): void {
    this.appWindow.close().catch(this.report)
  }

  private syncMaximized(): void {
    this.appWindow
      .isMaximized()
      .then((maximized) => {
        this.maximized.set(maximized)
      })
      .catch(this.report)
  }
}
