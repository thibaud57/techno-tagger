import { InjectionToken } from "@angular/core"
import { getCurrentWindow } from "@tauri-apps/api/window"

/** Ce que la garde fait d'une demande de fermeture : la retenir. */
export interface CloseRequest {
  preventDefault(): void
}

/** La fenetre vue par la garde de fermeture : testable sans Tauri, comme le transport du sidecar. */
export interface AppWindow {
  /** Hors Tauri, l'inscription echoue sans lever : l'ecran reste utilisable. */
  onCloseRequested(handler: (request: CloseRequest) => void): Promise<void>
  destroy(): Promise<void>
}

class TauriAppWindow implements AppWindow {
  async onCloseRequested(handler: (request: CloseRequest) => void): Promise<void> {
    try {
      // Un ecouteur pose prend la fermeture a son compte : sans `preventDefault`, l'API
      // appelle `destroy()` apres lui, d'ou `core:window:allow-destroy` dans la capability.
      await getCurrentWindow().onCloseRequested(handler)
    } catch {
      // Hors Tauri, `getCurrentWindow` echoue faute de `window.__TAURI_INTERNALS__`.
    }
  }

  async destroy(): Promise<void> {
    await getCurrentWindow().destroy()
  }
}

export const APP_WINDOW = new InjectionToken<AppWindow>("AppWindow", {
  providedIn: "root",
  factory: () => new TauriAppWindow(),
})
