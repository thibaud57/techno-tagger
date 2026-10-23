import { vi } from "vitest"

import type { AppWindow, CloseRequest } from "../app/core/platform/app-window"

/** Fausse fenetre Tauri : enregistre les ecouteurs et les gestes, sans rien fermer. */
export class FakeAppWindow implements AppWindow {
  handler: ((request: CloseRequest) => void) | null = null
  resizeHandler: (() => void) | null = null
  registrations = 0
  destroyed = 0
  maximized = false
  inTauri = true
  refuseDestroy = false

  readonly minimize = vi.fn(() => Promise.resolve())
  readonly toggleMaximize = vi.fn(() => Promise.resolve())
  readonly close = vi.fn(() => Promise.resolve())

  onCloseRequested(handler: (request: CloseRequest) => void): Promise<void> {
    this.registrations += 1
    if (this.inTauri) {
      this.handler = handler
    }

    return Promise.resolve()
  }

  onResized(handler: () => void): Promise<() => void> {
    this.resizeHandler = handler

    return Promise.resolve(() => {
      this.resizeHandler = null
    })
  }

  isMaximized(): Promise<boolean> {
    return Promise.resolve(this.maximized)
  }

  destroy(): Promise<void> {
    if (this.refuseDestroy) {
      return Promise.reject(new Error("window.destroy not allowed"))
    }
    this.destroyed += 1

    return Promise.resolve()
  }

  /** Simule une demande de fermeture de l'OS ; rend vrai si la garde l'a retenue. */
  requestClose(): boolean {
    let held = false
    this.handler?.({
      preventDefault: () => {
        held = true
      },
    })

    return held
  }

  /** Simule un agrandissement ou une restauration par l'OS. */
  resize(maximized: boolean): void {
    this.maximized = maximized
    this.resizeHandler?.()
  }
}
