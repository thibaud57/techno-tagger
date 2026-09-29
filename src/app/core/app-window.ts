import { InjectionToken } from "@angular/core"
import { getCurrentWindow } from "@tauri-apps/api/window"

export interface CloseRequest {
  preventDefault(): void
}

export interface AppWindow {
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
