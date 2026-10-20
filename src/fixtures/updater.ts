import { vi } from "vitest"

import type { AppUpdater, AvailableUpdate, DownloadProgress } from "../app/core/platform/updater"

/** Mise a jour proposee ; le telechargement aboutit sauf surcharge. */
export const availableUpdate = (overrides: Partial<AvailableUpdate> = {}): AvailableUpdate => ({
  version: "2.0.0",
  currentVersion: "1.0.0",
  releasePage: "https://example.com/releases/tag/v2.0.0",
  downloadAndInstall: vi.fn<AvailableUpdate["downloadAndInstall"]>(() => Promise.resolve()),
  close: vi.fn<AvailableUpdate["close"]>(() => Promise.resolve()),
  ...overrides,
})

/** Telechargement refuse, comme sur une signature invalide. */
export const failingUpdate = (): AvailableUpdate =>
  availableUpdate({ downloadAndInstall: vi.fn(() => Promise.reject(new Error("signature"))) })

/** Telechargement qui ne finit pas, apres avoir annonce `progress` s'il est donne. */
export const hangingUpdate = (progress?: DownloadProgress): AvailableUpdate =>
  availableUpdate({
    downloadAndInstall: vi.fn<AvailableUpdate["downloadAndInstall"]>((onProgress) => {
      if (progress) {
        onProgress(progress)
      }
      return new Promise<void>(() => undefined)
    }),
  })

/** Faux `APP_UPDATER` : une `Error` fait echouer la verification. */
export const updaterStub = (result: AvailableUpdate | null | Error = null) => ({
  check: vi.fn<AppUpdater["check"]>(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  ),
})
