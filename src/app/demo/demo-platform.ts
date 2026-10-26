import type { AppWindow } from "../core/platform/app-window"
import type { AppUpdater } from "../core/platform/updater"

export const demoUpdater: AppUpdater = {
  check: () => Promise.resolve(null),
}

export const demoWindow: AppWindow = {
  onCloseRequested: () => Promise.resolve(),
  onResized: () => Promise.resolve(() => undefined),
  isMaximized: () => Promise.resolve(false),
  minimize: () => Promise.resolve(),
  toggleMaximize: () => Promise.resolve(),
  close: () => Promise.resolve(),
  destroy: () => Promise.resolve(),
}
