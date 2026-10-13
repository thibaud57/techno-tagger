import type { Store } from "@tauri-apps/plugin-store"
import { vi } from "vitest"

// Le cast vit ici : le vrai `Store` a un constructeur prive, un stub ne peut que s'y faire passer.

/** Store dont tout `get` rend `value` ; `set` et `save` sont des espions qui aboutissent. */
export const storeStub = (value?: unknown): Store =>
  ({
    get: vi.fn(() => Promise.resolve(value)),
    set: vi.fn(() => Promise.resolve()),
    save: vi.fn(() => Promise.resolve()),
  }) as unknown as Store
