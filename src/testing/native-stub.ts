import { type Mocked, vi } from "vitest"

import type { NativeService } from "../app/core/platform/native.service"

// Faux `NativeService` des specs de composants : aucun plugin Tauri n'y est charge. Type contre
// la vraie classe, une divergence casse ici a la compilation.

export type NativeStub = Mocked<NativeService>

/** `picked` : ce que rend le selecteur de chemin ; `null` simule une annulation. */
export const nativeStub = (picked: string | null = "C:/x/vlc_media.db"): NativeStub => ({
  pickPath: vi.fn<NativeService["pickPath"]>(() => Promise.resolve(picked)),
  openUrl: vi.fn<NativeService["openUrl"]>(() => Promise.resolve()),
  revealItemInDir: vi.fn<NativeService["revealItemInDir"]>(() => Promise.resolve()),
  assetUrl: vi.fn<NativeService["assetUrl"]>((path) => `asset://localhost/${path}`),
})
