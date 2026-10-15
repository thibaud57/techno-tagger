import type { Store } from "@tauri-apps/plugin-store"
import { vi } from "vitest"

// Le cast vit ici : le vrai `Store` a un constructeur prive, un stub ne peut que s'y faire passer.

const storeWith = (read: (key: string) => unknown): Store =>
  ({
    get: vi.fn((key: string) => Promise.resolve(read(key))),
    set: vi.fn(() => Promise.resolve()),
    save: vi.fn(() => Promise.resolve()),
  }) as unknown as Store

/** Store dont tout `get` rend `value` ; `set` et `save` sont des espions qui aboutissent. */
export const storeStub = (value?: unknown): Store => storeWith(() => value)

/** Store dont `get(cle)` rend la valeur de cette cle dans `entries`, `undefined` sinon. */
export const storeOf = (entries: Record<string, unknown>): Store => storeWith((key) => entries[key])
