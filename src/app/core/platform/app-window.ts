import { InjectionToken } from "@angular/core"
import { isTauri } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"

export interface CloseRequest {
  preventDefault(): void
}

export interface AppWindow {
  onCloseRequested(handler: (request: CloseRequest) => void): Promise<void>
  /** Rend la fonction qui retire l'ecouteur. */
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
    try {
      // Un listener pose prend la fermeture a son compte : sans `preventDefault`, l'API
      // appelle `destroy()` apres lui, d'ou `core:window:allow-destroy` dans la capability.
      await getCurrentWindow().onCloseRequested(handler)
    } catch {
      // Hors Tauri, `getCurrentWindow` echoue faute de `window.__TAURI_INTERNALS__`.
    }
  }

  async onResized(handler: () => void): Promise<() => void> {
    try {
      return await getCurrentWindow().onResized(handler)
    } catch (error) {
      // Hors Tauri, rien a ecouter ni a retirer. Une vraie erreur remonte.
      if (!isTauri()) {
        return () => undefined
      }
      throw error
    }
  }

  async isMaximized(): Promise<boolean> {
    try {
      return await getCurrentWindow().isMaximized()
    } catch (error) {
      // Hors Tauri, aucune fenetre : restauree.
      if (!isTauri()) {
        return false
      }
      throw error
    }
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
