import { InjectionToken } from "@angular/core"
import { getCurrentWindow } from "@tauri-apps/api/window"

import { withFallback } from "./tauri-fallback"

export interface CloseRequest {
  preventDefault(): void
}

export interface AppWindow {
  onCloseRequested(handler: (request: CloseRequest) => void): Promise<void>
  onResized(handler: () => void): Promise<() => void>
  isMaximized(): Promise<boolean>
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  /** Passe par `onCloseRequested`, donc par la garde de sortie, a l'inverse de `destroy`. */
  close(): Promise<void>
  destroy(): Promise<void>
}

class TauriAppWindow implements AppWindow {
  async onCloseRequested(handler: (request: CloseRequest) => void): Promise<void> {
    // Un listener pose prend la fermeture a son compte : sans `preventDefault`, l'API
    // appelle `destroy()` apres lui, d'ou `core:window:allow-destroy` dans la capability.
    await withFallback(async () => {
      await getCurrentWindow().onCloseRequested(handler)
    }, undefined)
  }

  // Hors Tauri, rien a ecouter ni a retirer.
  onResized(handler: () => void): Promise<() => void> {
    return withFallback(
      () => getCurrentWindow().onResized(handler),
      () => undefined,
    )
  }

  // Hors Tauri, aucune fenetre : restauree.
  isMaximized(): Promise<boolean> {
    return withFallback(() => getCurrentWindow().isMaximized(), false)
  }

  async minimize(): Promise<void> {
    await getCurrentWindow().minimize()
  }

  async toggleMaximize(): Promise<void> {
    await getCurrentWindow().toggleMaximize()
  }

  async close(): Promise<void> {
    await getCurrentWindow().close()
  }

  async destroy(): Promise<void> {
    await getCurrentWindow().destroy()
  }
}

export const APP_WINDOW = new InjectionToken<AppWindow>("AppWindow", {
  providedIn: "root",
  factory: () => new TauriAppWindow(),
})
